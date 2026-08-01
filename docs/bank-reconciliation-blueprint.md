# 은행 계좌 내역 자동수집 · 미수금 자동대조/수금판정 블루프린트 (v1 초안)

> 상태: **v2 — 확정(2026-07-22)**. §0 결정 + 남은 소논점(§11 #3~#5) 제안대로 확정. 이후 착수 순서: CODEF 데모 검증 → 견적/은행지원 확인 → P0.
> 관련: [수금/미수금 도메인 = `contract_payment_milestones`], [official-letter-blueprint], [e-approval-blueprint]

---

## 0. 확정된 결정 (사용자 지시 반영)

| # | 결정 | 영향 |
|---|---|---|
| D1 | **수집 채널 = 처음부터 API 자동수집** (CODEF 등 상용 스크래핑 API) | P0에서 API 커넥터 구축. 업로드 파서는 폴백/미지원은행 백업으로만. |
| D2 | **자동확정 = 일괄 원클릭 승인** | 완전 자동확정 없음. 고신뢰건도 사람이 1클릭으로 배치 승인. |
| D3 | **입금자명 학습 = 전용 테이블 `bank_remitter_links` 신규** | facility_aliases 재사용 안 함. 학습 메타(확정횟수·가중) 독립 관리. |
| D4 | **출금(매입/경비) = 원장 적재만** | `bank_transactions`에 `direction='out'`도 적재. 자동대조는 입금만(출금 대조는 후속). |
| D5 | **어음 합계매칭(sum_nto1) = 화이트리스트(효성화학 포함) + 폴백** | 효성화학은 어음 일괄·분리입금 둘 다 존재 → 화이트리스트에 넣되 **합계매칭 우선 시도 → 실패 시 건별 exact/partial 폴백**. 비화이트리스트는 건별만. |
| D6 | ~~API 벤더 = CODEF~~ → **바로빌(Barobill)로 전환 (2026-07-23)** | CODEF 견적 과다(기본 월80만+항목10만+호출10원). 바로빌 종량제·기본료 없음: 계좌 거래내역 **계좌당 월정액**(24h 3,000·1h 4,000원), 6개 은행 전부 지원, 세금계산서 발급(100원/건)·홈택스 수집까지 통합 가능. 계좌 6개×3,000=월 18,000. CODEF 데모 실증(§12)은 기술 참고로 유지하되 실제 연동은 바로빌. |

**수집 대상 은행(사용자 제공)**: 주거래 = **기업은행(IBK)**. 거래 = **국민·신한·하나·우리·농협**. → 총 6개 계좌원(다계좌 가능).

---

## 1. 목표와 범위

### 1.1 최종 목표
1. **은행 계좌 거래내역 자동수집** — 회사 계좌의 입금(및 출금) 내역을 정기적으로 수집·적재.
2. **미수금 자동대조 & 수금판정** — 수집된 입금건을 미수 계산서(milestone)와 대조하여 자동으로 "수금 처리" 판정. 사람은 **확인/승인만**.
3. (2차) **결산·부가세 신고 준비** — 수집된 계좌원장을 회계 관리 기능의 기초 데이터로 재사용.

### 1.2 이번 블루프린트의 1차 범위
- **입금(수금) 방향 자동대조**에 집중. 출금(매입/경비)은 원장 적재만 하고 자동대조는 2차.
- 판정 결과는 기존 `contract_payment_milestones`(수금 플래그·부분입금)에 반영 → 기존 미수금/수금 화면과 그대로 호환.

### 1.3 핵심 설계 원칙
- **자동판정은 "제안"이 기본, "확정"은 신뢰도 임계값 초과분만 자동.** 나머지는 검토 큐로.
- **원장(raw)과 판정(match)을 분리.** 은행 원본은 불변 적재, 매칭은 그 위의 재계산 가능한 레이어.
- **기존 인프라 재사용**: 거래처 매칭은 `facilities` + `facility_aliases`, 수금 반영은 milestone PATCH/partial_payments 패턴.

---

## 2. 데이터 수집 방식 (수집 채널)

**[D1] 처음부터 API 자동수집(B)을 P0 주채널로 채택.** 업로드(A)는 폴백/미지원은행 백업으로 부차 구현. C(오픈뱅킹)는 기업계좌 제약으로 후보에서 제외(필요 시 재검토).

| 옵션 | 방식 | 장점 | 단점 | 판단 |
|---|---|---|---|---|
| **B. 상용 스크래핑 API** (CODEF·웹케시 등) | 인증서/계정 연동으로 거래내역 자동 pull | 완전 자동·정기수집, 다은행 통합 | 유료(건당/월정액), 인증서 위탁·보안 심사, 벤더 종속 | **P0 주채널 채택** ✅ |
| A. 파일 업로드 | 인터넷뱅킹 엑셀/CSV 다운로드 → 업로드 파서 적재 | 인증/보안 이슈 없음, API 장애·미지원 은행 대응 | 은행별 포맷 파서 필요, 수동 | **폴백으로만** |
| C. 오픈뱅킹 API (금융결제원) | 표준 API 조회 | 표준·공식 | 법인/기업계좌·기관 이용 제약 | 제외 |

### 2.1 API 커넥터 (옵션 B, P0 주채널)
- **벤더 = CODEF 잠정 1순위 [D6]**. 근거:
  - **개발 친화 REST API**: 자체 앱에 직접 통합하는 우리 구조에 최적. 20개 은행 + 저축은행 지원, **기업 수시입출 거래내역 API**(최대 12개월 이력) 제공 → 기업/국민/신한/하나/우리/농협 6개 모두 커버 가능성 높음(도입 전 지원목록 확정 필요).
  - **구독형 종량("쓴 만큼")** 요금 → 소규모 시작에 유리. 가입·심사가 가벼워 리드타임 짧음.
  - 대안 비교: **금융결제원 오픈뱅킹**은 최소 연 400만원+·서류심사 무겁고 기업계좌 제약 → 부적합. **웹케시(브랜치/경리나라)**는 ERP형 자금관리 SaaS로 API 단품 연동보다 패키지 성격 → 자체 통합엔 과함. 페이게이트 등 소규모 벤더는 규모·신뢰도 열위.
  - ⚠ 정확한 **건당 단가·월 최소비용은 견적 문의 필요**(공개 페이지가 JS 렌더라 수치 미확보). 6개 은행 **기업계좌** 지원 여부도 계약 전 확인(§11-1).
- **연동 방식(공통)**: 회사 계좌의 인증수단(공동인증서/기업뱅킹 계정)을 벤더에 등록 → 정기 배치로 거래내역 pull → `bank_transactions` 적재.
- **정기 수집**: ECS 스케줄 태스크 또는 서버 크론(예: 영업일 1일 수 회). 마지막 수집시점 이후 증분 조회 + `dedup_key`로 중복 방지.
- **최소 추출 필드**: 거래일시, 입출금 구분, 금액, 거래후잔액, 입금자명(의뢰인), 적요/메모, 은행측 고유참조.
- **보안(중요)**: 인증서/자격증명은 **앱 DB에 평문 저장 금지** — 벤더가 자격을 보관하는 위탁형이면 벤더 토큰만, 자체 보관이면 KMS/시크릿매니저. 계좌번호는 해시/마스킹(§3.1, §9).
- **폴백(A)**: 벤더 미지원 은행·장애 시 엑셀 업로드 경로. 은행별 컬럼 매핑 프로파일을 DB로 관리, 동일 `bank_transactions`에 `source='upload'`로 적재.

### 2.2 출금(매입/경비) 적재 [D4]
- `direction='out'` 거래도 **원장에 그대로 적재**(수집 시 입/출금 함께 pull). 
- 1차에서는 **출금 자동대조는 하지 않음**(recon 엔진 대상은 입금만). 적재된 출금 원장은 P5(결산·부가세 매입세액 준비)에서 재사용.

---

## 3. 데이터 모델 (신규 테이블 — 마이그레이션 `088_bank_reconciliation.sql`)

> 관례: `CREATE TABLE IF NOT EXISTS`, 타임스탬프 `text`, bool `integer`, 멱등. 다음 번호 = **088**.

### 3.1 `bank_accounts` — 회사 계좌 마스터
| 컬럼 | 타입 | 비고 |
|---|---|---|
| `account_id` | text PK | |
| `bank_code` / `bank_name` | text | 은행 식별 |
| `account_no_masked` | text | 표시용 마스킹 번호 |
| `account_no_hash` | text | 중복·매칭용 해시(평문 저장 지양) |
| `account_alias` | text | "주거래-국민", "부가세통장" 등 |
| `currency` | text DEFAULT 'KRW' | |
| `is_active` | integer DEFAULT 1 | |
| `created_at` | text | |

### 3.2 `bank_transactions` — 원본 거래내역(불변 원장)
| 컬럼 | 타입 | 비고 |
|---|---|---|
| `txn_id` | text PK | 앱 생성 |
| `account_id` | text FK→bank_accounts | |
| `txn_at` | text | 거래일시(YYYY-MM-DD HH:MM:SS, 없으면 날짜만) |
| `direction` | text | `'in'`(입금) / `'out'`(출금) |
| `amount` | numeric | 양수 |
| `balance_after` | numeric | 거래후잔액(중복키·검증용) |
| `remitter_name_raw` | text | **입금자명 원문**(의뢰인) |
| `remitter_name_norm` | text | 정규화(공백·괄호·㈜ 제거, `facilities` 정규화 규칙 재사용) |
| `memo` | text | 적요/메모 |
| `bank_ref` | text | 은행측 고유 거래번호(있을 때) |
| `dedup_key` | text UNIQUE | `account_id`+`bank_ref` 또는 `account_id`+`txn_at`+`amount`+`balance_after` 해시 |
| `source` | text | `'upload'` / `'codef'` / ... |
| `raw_json` | jsonb | 원본 행 보존 |
| `recon_status` | text DEFAULT `'unprocessed'` | `unprocessed`/`suggested`/`confirmed`/`ignored`/`unmatched`/`on_hold` |
| `created_at` | text | |

- `UNIQUE(dedup_key)` 로 재업로드 시 중복 무시(ON CONFLICT DO NOTHING).
- 인덱스: `(account_id, txn_at)`, `(recon_status)`, `(remitter_name_norm)`, `(direction, amount)`.

### 3.3 `recon_matches` — 매칭(판정) 헤더
하나의 입금 txn ↔ 하나의 매칭 결과(1:N 배분은 line으로).
| 컬럼 | 타입 | 비고 |
|---|---|---|
| `match_id` | text PK | |
| `txn_id` | text FK→bank_transactions | |
| `match_type` | text | `exact_1to1`/`sum_nto1`(어음일괄)/`partial`(부분)/`overpaid`/`prepaid`(선입금)/`unmatched`/`non_receivable`(오입금) |
| `status` | text | `suggested`/`confirmed`/`rejected`/`manual` |
| `confidence` | numeric | 0~100 스코어 |
| `matched_facility_id` | text FK→facilities | 판정된 거래처 |
| `matched_amount` | numeric | txn 중 미수와 매칭된 합계 |
| `residual_amount` | numeric | 미배분 잔액(과대입금·선수금) |
| `reason_json` | jsonb | 스코어 근거(디버그·UI 설명용) |
| `created_by` | text | `'system'` or employee_id |
| `confirmed_by` / `confirmed_at` | text | |
| `created_at` | text | |

### 3.4 `recon_match_lines` — 입금 1건의 milestone별 배분
| 컬럼 | 타입 | 비고 |
|---|---|---|
| `line_id` | text PK | |
| `match_id` | text FK→recon_matches | |
| `milestone_id` | text FK→contract_payment_milestones | (또는 `invoice_id`) |
| `allocated_amount` | numeric | 이 milestone에 귀속된 금액 |
| `created_at` | text | |

### 3.5 `bank_remitter_links` — 입금자명 학습(★ 자동화 핵심)
확정된 매칭에서 "입금자명 정규형 → 거래처" 매핑을 축적 → 다음부터 즉시 확정.
| 컬럼 | 타입 | 비고 |
|---|---|---|
| `remitter_name_norm` | text PK(부분) | |
| `facility_id` | text FK→facilities | |
| `confidence_seed` | numeric | 확정 횟수 기반 가중 |
| `confirm_count` | integer | |
| `last_confirmed_at` | text | |

> 대안: 기존 `facility_aliases`에 `alias_type='bank_remitter'`로 저장. 별칭 인프라 재사용 vs 학습 전용 테이블 분리는 §10 논점.

---

## 4. 매칭 엔진 설계 (★ 핵심)

입금 txn 1건에 대해 **파이프라인**으로 후보를 만들고 스코어링한다.

```
[입금 txn]
  → 1) 거래처 식별 (remitter → facility)
  → 2) 미수 후보군 축소 (해당 거래처 + 기간 윈도우)
  → 3) 매칭 유형별 후보 생성 (1:1 / 합계 N:1 / 부분 / 초과 / 선입금 / 오입금)
  → 4) 스코어링 & 신뢰도 산출
  → 5) 임계값 분기: 자동확정 / 검토큐 / 미매칭
```

### 4.1 1단계 — 거래처 식별 (입금자명 → facility)
입금자명(`remitter_name_norm`)을 다음 순서로 대조:
1. `bank_remitter_links` (학습된 확정 이력) — **최우선, 있으면 거래처 확정**
2. `facilities.normalized_company_name` (정확/부분일치, 인덱스 존재)
3. `facility_aliases.alias`
4. `facility_merge_aliases.previous_company_name` (구 상호)
5. 사업자번호/대표자명 보조(입금자명에 포함된 경우)

- 입금자명이 담당자 개인명·지점명 등 회사명과 무관할 수 있음 → 1단계 실패 시에도 **금액+시기 단독 매칭**(4.3)으로 후보를 만들되 신뢰도 감점.
- 결과: `matched_facility_id` 후보 0~N개(각각 매칭강도 점수).

### 4.2 2단계 — 미수 후보군 축소
- 대상: `contract_payment_milestones` 중 `invoice_issued=1 AND payment_collected=0 AND 잔액(invoice_amount - collected_amount) > 0`.
- **거래처 스코프**: 1단계에서 facility가 잡히면 그 거래처 계약의 milestone만. 못 잡으면 전체(단, 기간·금액으로 강하게 제한).
- **기간 윈도우**: 발행일 기준 `[입금일 - N개월, 입금일 + 소폭]`. 기본 N은 업체별 결제주기 학습값(4.6) 또는 전역 기본(예: 4개월). 어음 케이스 대응.

### 4.3 3단계 — 매칭 유형별 후보 생성

문제(사용자 제시 3난제)에 각각 대응:

#### (a) `exact_1to1` — 단일 계산서 정확일치
- 후보군 중 잔액 == 입금액인 milestone.
- **난제 1(동일금액 동시기 다업체)**: 금액만 같은 후보가 복수면 **거래처 매칭강도 + 시기근접 + 지급조건**으로 서열화. 최상위와 차상위 점수차가 작으면 → 자동확정 보류하고 검토큐로(모호).

#### (b) `sum_nto1` — 여러 계산서 합계 = 1 입금 (★ 난제 2, 어음 일괄지급) [D5]
- **화이트리스트 전용 정책**: 대부분 거래처는 **계산서 건별로 금액을 분리 입금**하는 것이 일반적(같은 날 여러 건이어도 건별). 따라서 합계매칭을 전역 적용하면 오히려 오매칭·조합폭발 위험 → **지정 업체(화이트리스트)에만 활성화.**
  - **초기 화이트리스트 = 효성화학만.** 이후 어음/일괄지급 패턴이 확인되는 업체를 운영 중 추가(설정 or 학습 4.6).
  - 저장: `bank_remitter_links` 또는 별도 플래그(예 `facilities`에 `sum_match_enabled`, 혹은 recon 설정 테이블). → §11 소논점.
- 화이트리스트 업체에 한해: 미수 milestone 집합에서 **부분집합의 합 == 입금액**인 조합 탐색(subset-sum).
- **조합 폭발 방지**:
  - 거래처 + 기간 윈도우로 후보를 소수(예 ≤ 15건)로 제한.
  - 금액 내림차순 그리디 + 백트래킹, 상한 시간/조합수 컷.
  - 후보가 여러 조합이면 "건수 최소 · 발행일 연속성" 우선.
- 매칭되면 `recon_match_lines`에 각 milestone별 배분. 입금이 **어음 만기 일괄지급**이므로 시기 윈도우를 넓게(발행 후 수개월) 허용.
- 어음 힌트: 적요/메모에 "어음/전자어음/만기/HYOSUNG" 등 키워드 있으면 가중.
- **화이트리스트 업체도 합계매칭이 유일 경로는 아님** [D5 폴백]: 효성화학은 어음 일괄지급과 B2B 분리입금이 **둘 다** 관측됨(우리은행 실데이터, 2026-06-29 같은 날 4,565,000+1,650,000 분리입금). → **합계매칭(sum_nto1) 우선 시도 → 조합 미발견 시 건별 exact/partial로 폴백**. 즉 화이트리스트는 "합계도 시도"이지 "합계만"이 아님.
- **비화이트리스트 업체**: 같은 날 복수 입금이 와도 각각 건별 exact/partial로 독립 매칭(합계 시도 안 함).

#### (c) `partial` — 부분입금 (난제 3-과소)
- 입금액 < 단일 milestone 잔액 → 부분입금 후보. 기존 `partial_payments_json` append 패턴으로 반영, milestone 잔액 갱신, 완료판정 안 함.
- 여러 회차 분납 업체 대응.

#### (d) `overpaid` — 과대입금 (난제 3-과대)
- 입금액 > 매칭 미수 합계 → 초과분 `residual_amount`로 표기. 초과분은 **선수금 or 오입금 조사** 상태로 남김(자동확정 금지, 검토큐).

#### (e) `prepaid` — 선입금 (난제 3, 계산서 미발행)
- 거래처는 식별되나 매칭할 발행 milestone이 없음(아직 미발행) → `prepaid`(선수금) 보류.
- **재매칭 훅**: 이후 해당 거래처 계산서 발행 시 보류 txn을 재평가.

#### (f) `non_receivable` — 오입금/무관 입금 (난제 3, 타사 입금 등)
- 거래처 식별 실패 + 금액·시기로도 미수 매칭 없음 → `non_receivable`(오입금/반환대기) 후보. 자동확정 절대 금지, 사람이 판단.

### 4.4 4단계 — 스코어링 & 신뢰도
`confidence` = 가중합(0~100). 예시 가중치(튜닝 대상):

| 요소 | 설명 | 가중 |
|---|---|---|
| 거래처 매칭강도 | 학습링크(100)/정규명 정확(90)/별칭(80)/부분(60)/미식별(0) | ×0.35 |
| 금액 일치도 | 정확(100)/합계정확(95)/부분(70)/초과(50) | ×0.35 |
| 시기 근접 | 발행~입금 간격이 업체 평균 결제주기에 부합할수록↑ | ×0.15 |
| 지급조건 부합 | `payment_terms`/`contract.payment_method`(어음 등) 부합 | ×0.10 |
| 모호성 페널티 | 동점 후보 존재 시 감점 | −α |

### 4.5 5단계 — 임계값 분기
- `confidence ≥ T_auto`(예 90) **그리고** 경쟁 후보 없음 → `status=suggested`(자동제안) 중 **자동확정 대상**으로 플래그. (초기엔 완전자동 대신 "원클릭 일괄승인" 권장 → §9)
- `T_review ≤ confidence < T_auto` → 검토 큐(`suggested`).
- `confidence < T_review` 또는 유형 e/f → 미매칭/보류(`unmatched`/`on_hold`/`non_receivable`).
- 임계값은 설정값으로 노출(운영 중 튜닝).

### 4.6 업체별 결제주기·패턴 학습(점진)
- 확정 이력에서 **거래처별 (발행일→입금일) 간격 분포, 어음 여부, 일괄지급 경향**을 집계 → 후보 기간 윈도우·가중치에 반영.
- 효성화학처럼 "1개월치 계산서를 N개월 후 어음 일괄" 패턴을 학습하면 `sum_nto1` 후보를 자신 있게 제안 가능.
- 초기엔 전역 기본값, 데이터 쌓이면 업체별 override.

---

## 5. 판정 결과 → 기존 수금 모델 반영

확정(`confirmed`) 시:
- `recon_match_lines`의 각 milestone에 대해 **기존 milestone PATCH/payments 로직 재사용**:
  - 전액 매칭 → `payment_collected=1`, `collected_amount`, `payment_collected_at=txn 일자`.
  - 부분 → `partial_payments_json` append(누적 재계산·자동완료 판정 기존 로직 그대로).
- 감사로그(audit)에 "자동대조 확정(match_id, txn_id)" 기록.
- **되돌리기**: 확정 취소 시 milestone 반영도 롤백(부분입금 항목 제거/플래그 원복). match는 원장과 분리돼 있어 재계산 안전.

> 이렇게 하면 기존 미수금/수금 현황·집계·export 화면을 **수정 없이** 재사용.

---

## 6. 예외·엣지 케이스 처리 요약

| 케이스 | 유형 | 처리 |
|---|---|---|
| 동일금액·동시기 다업체 | exact 경쟁 | 거래처강도+시기로 서열화, 모호하면 검토큐 |
| 어음 일괄지급(효성화학) | sum_nto1 | subset-sum, 넓은 기간창, 배분 라인 |
| 과소입금 | partial | 부분입금 append, 미완료 유지 |
| 과대입금 | overpaid | 초과분 residual, 선수금/오입금 조사 |
| 선입금(미발행) | prepaid | 보류, 발행 시 재매칭 |
| 완전 무관 입금 | non_receivable | 오입금/반환대기, 수동 |
| 분할·재업로드 | dedup_key | 중복 무시 |
| 출금(매입/경비) | (1차 대상 외) | 원장 적재만, 자동대조 2차 |

---

## 7. 워크플로 (End-to-End)

```
수집: (A)엑셀 업로드 or (B)API pull
  → bank_transactions 적재(중복제거)
엔진: 배치/온업로드로 매칭 후보 생성 → recon_matches(suggested)
검토: "자동대조 검토" 화면
  - 상단: 자동확정 후보(고신뢰) → [일괄 승인]
  - 중단: 검토 필요(모호/부분/합계) → 건별 확인·수정·확정/반려
  - 하단: 미매칭·보류(선입금/오입금) → 수동 지정 or 보류
확정: milestone 반영 + 학습(bank_remitter_links) 업데이트
집계: 기존 미수금/수금 현황에 자동 반영
```

---

## 8. UI 계획 (cdash 디자인 시스템)

신규 진입점: 계약관리 billing 영역에 탭 추가 or 별도 "자동대조" 메뉴.
- **`ReconciliationInbox`(검토 큐)**: 좌측 입금건 리스트(상태 필터), 우측 매칭 상세(후보·근거·배분). cdash 토큰·윤곽선 기본.
- **매칭 상세 카드**: 입금 정보(입금자명 원문/정규화, 금액, 일시, 적요) + 제안 매칭(거래처, milestone(들), 배분액, confidence, 근거 chips) + 액션(확정/수정/반려/보류).
- **수동 매칭 모달**: 거래처 검색(facilities 자동완성) + 미수 milestone 다중선택 + 배분액 입력. `sum_nto1`·부분 수동 처리.
- **계좌·업로드 화면**: 계좌 등록, 엑셀 업로드(은행 프로파일 선택), 수집 결과 요약.
- 기존 `CollectionEntryModal`과 톤 일치, 포털 모달은 cdash-vars 스코프 처리.

---

## 9. 안전장치 (자동화의 리스크 관리)
- **초기엔 "완전 자동확정" 대신 "고신뢰 일괄 원클릭 승인"** 로 시작 → 오판정 리스크 통제, 신뢰 쌓이면 자동확정 활성화(설정).
- 모든 자동확정/취소는 audit + 롤백 가능.
- 금액·거래처 동시 불일치 건은 절대 자동확정 금지(검토큐 강제).
- 계좌번호 평문 미저장(해시/마스킹), 원본 raw_json 접근 권한 분리.
- 권한: 기존 `billing.*` RBAC에 `recon.view`/`recon.confirm` 추가.

---

## 10. 단계별 구현 로드맵 (제안)

| 단계 | 내용 | 산출 |
|---|---|---|
| **P0** | 데이터 모델(088) + 계좌등록 + **API 커넥터(벤더 연동)·정기 배치 수집**(입금·출금 원장) + 원장 화면. 업로드 폴백은 최소 구현 | 자동 수집·적재 동작 |
| **P1** | 매칭 엔진 코어: 거래처식별 + exact_1to1 + partial + **검토 큐 UI(일괄 원클릭 승인)** + milestone 반영 | 기본 자동대조 |
| **P2** | `sum_nto1`(어음 일괄) + overpaid/prepaid/non_receivable + 수동매칭 모달 | 난제 2·3 대응 |
| **P3** | 학습(`bank_remitter_links`, 업체별 결제주기) + 임계값·승인정책 튜닝 UI | 정확도·자동화↑ |
| **P5** | (2차 도메인) 결산·부가세 준비 연계(입·출금 원장 → 회계) | 회계 관리 연동 |

> [D2] 완전 자동확정 단계는 두지 않음 — 모든 확정은 검토 큐의 일괄 승인을 거침. [D1]로 API 수집이 P0로 당겨져 기존 P4(API 자동수집)는 P0에 흡수됨.

---

## 11. 논점 (해결/미결)

### 해결됨 (§0)
- ✅ D1 API 수집 / D2 일괄 원클릭 승인 / D3 전용 학습테이블 / D4 출금 원장만 / **D5 어음 합계매칭=효성화학만** / **D6 벤더=CODEF 잠정1순위**
- ✅ 수집 은행 = 기업(주거래)·국민·신한·하나·우리·농협 6개

### 남은 결정 필요 논점
1. **CODEF 계약 확정** [D6 후속 — 사용자 확인 필요]:
   - CODEF에 **6개 은행 기업계좌 거래내역 지원 여부** + **견적(건당/월 최소)** 문의 → 회신 후 최종 확정.
   - 인증 방식(공동인증서 등록 위치·위탁형 여부) 확인.
   - → 확정되면 P0 커넥터 착수. (계약·비용 발생 작업이라 사용자 승인 후 진행)
2. **어음 스코프 세부** [D5 확정]: 기간 윈도우 기본값(제안: **4개월**), subset-sum 후보 상한(건수 ≤15). 화이트리스트 저장 위치(제안: recon 설정 or facilities 플래그). 이견 있으면 지시.
### 확정된 소논점 (사용자 "이대로 확정" 지시)
3. ✅ **선입금/오입금 UX** = 별도 "미매칭/선수금" 탭에서 관리. 오입금 반환 프로세스는 이번 범위 밖(상태 표기까지만, 반환은 수동).
4. ✅ **UI 진입점** = 기존 billing 탭에 "자동대조" 탭 추가.
5. ✅ **민감정보 보관** = CODEF 위탁형(자격증명은 CODEF connectedId로 대체, 앱은 client_id/secret·access_token만 시크릿매니저 보관). 계좌번호 해시+마스킹. RBAC `recon.view`/`recon.confirm` 신설.

---

## 12. CODEF 연동 기술 사양 (데모 검증 기준, 공식 SDK 근거)

> 출처: CODEF 공식 Node SDK(`codef-io/codef-node`), REST 공통 가이드.

- **OAuth 토큰**: `POST https://oauth.codef.io/oauth/token`, 헤더 `Authorization: Basic base64(client_id:client_secret)` + `Content-Type: application/x-www-form-urlencoded`, 바디 `grant_type=client_credentials&scope=read`. 응답 `access_token`(JWT), `expires_in≈604799`(약 1주) → **토큰 캐시 재사용**.
- **환경 호스트**: 샌드박스 `https://sandbox.codef.io` / **데모 `https://development.codef.io`** / 정식 `https://api.codef.io`.
- **API 호출**: `POST {host}{path}`, 헤더 `Authorization: Bearer {token}` + `Content-Type: application/json`. **바디 = `urlencode(JSON.stringify(body))`**(JSON을 URL 인코딩해 전송). **응답 = URL 인코딩된 문자열 → `decodeURIComponent` 후 `JSON.parse`**. HTTP 200이라도 `result.code`가 `CF-XXXXX`면 업무오류.
- **계정 등록(connectedId)**: `POST /v1/account/create`, `accountList[]`에 `countryCode:'KR'`, `businessType:'BK'`, `clientType`, `organization`(은행코드), `loginType`, `password=RSA(publicKey, 원문)`, 인증서형은 `derFile/keyFile`. 응답 `data.connectedId` → **이후 조회는 connectedId만 사용**(자격증명 재전송 없음).
- **보유계좌**: `POST /v1/kr/bank/b/account/account-list` (바디 `connectedId`, `organization`).
- **기업 수시입출 거래내역**: `POST /v1/kr/bank/b/account/transaction-list` (바디 `connectedId`, `organization`, `account`, `startDate`, `endDate`, `orderBy`, `inquiryType`). ✅ 데모 실측 확정.
- **여러 은행 추가 등록**: `POST /v1/account/add` (기존 `connectedId` + `accountList[]`). 동일 인증서로 6개 은행을 한 connectedId에 통합.
- **RSA**: `crypto.publicEncrypt({key: PEM(publicKey), padding: RSA_PKCS1_PADDING}, Buffer(원문)).toString('base64')`.
- **은행코드(organization) 6종**: 기업 `0003` · 국민 `0004` · 신한 `0088` · 하나 `0081` · 우리 `0020` · 농협 `0011`. (계약 시 CODEF 기관코드표로 최종 확인)

> 데모 테스트 스크립트: `scripts/codef-demo/` (키는 `.env`로 분리, git 제외).

### 12.1 데모 실증 결과 (2026-07-22) — 6개 은행 전부 성공 ✅
CODEF **데모버전(development)**으로 한국환경안전연구원 법인계좌 6개 은행 전 과정 실증 완료:
- ✅ OAuth 토큰 → ✅ `POST /v1/account/create`(하나, `CF-00000`) → ✅ `POST /v1/account/add`(기업·국민·신한·우리·농협 5개 일괄, `errorList: []`) → ✅ `POST /v1/kr/bank/b/account/transaction-list`(6개 은행 모두 `CF-00000`, 실거래 조회).
- **동일 범용 법인 공동인증서 하나로 6개 은행 전부** 등록·조회 가능 확인. connectedId 1개(`.connected-id.json`)에 6개 은행 통합.
- 은행별 거래 건수(최근 3개월): 국민 296 · 기업 77 · 농협 26 · 우리 18 · 신한 11 · 하나 6. → 국민이 주 거래계좌.
- 데모 제한: **일 100회·3개월**. 상시 6계좌 수집은 정식버전 필요(CODEF 심사).

### 12.2 공통 응답 필드 → `bank_transactions` 매핑
| CODEF 응답 필드 | 의미 | → 원장 컬럼 |
|---|---|---|
| `resAccountTrDate`(YYYYMMDD) + `resAccountTrTime`(HHMMSS) | 거래일시 | `txn_at` |
| `resAccountIn` / `resAccountOut` | 입금액 / 출금액 | `direction`(In>0→'in') · `amount` |
| `resAfterTranBalance` | 거래후잔고 | `balance_after` |
| `resAccountDesc1~4` | 적요·거래상대명·취급점(은행별 위치 상이 ↓) | `remitter_name_raw` · `memo` |
| `resCounterAccount` | 상대계좌번호(기업은행 등 일부만 제공) | 보조 매칭 키 |

### 12.3 ★ 은행별 입금자명(거래상대) 필드 위치 — 실측 (핵심 발견)
**입금건 기준, 거래상대명이 들어가는 Desc 필드가 은행마다 다르다:**

| 은행 | 입금자명 위치 | 실측 예 | 거래종류(Desc2) |
|---|---|---|---|
| 하나 | `Desc1` 또는 `Desc3`(거래종류별 상이) | "(주)코리아써키트", "(주)두산전자사업본사" | 대체/채권입금 |
| 기업(IBK) | `Desc1` (+`resCounterAccount` 상대계좌 제공) | "(주)청우엔지니어링" | 인터넷/타행이체 |
| 국민(KB) | **`Desc3`** (Desc1=적요 텍스트) | "주식회사 원라인에듀" | 인터넷출금이체/CMS |
| 신한 | **`Desc3`** (Desc1 빈값) | "LS MnM Inc." | FB이체 |
| 우리 | **`Desc3`** (Desc1 빈값) | "삼성전기(주)", "효성화학(주)" | 파트너/B2B |
| 농협 | **`Desc3`** (Desc4=취급점) | "씨제이제일제(당)", "모성폴리머" | 대금결제/인터넷당행 |

**설계 시사점(P0 파서에 직결):**
1. **단일 고정 매핑 불가** → 은행별 프로파일 필요. 다만 실무적으로는 **"Desc1·Desc3 중 `facilities`에 정규화 매칭되는 값을 `remitter`로 채택"하는 다중필드 휴리스틱**이 은행·거래종류 편차에 가장 견고. (하나처럼 거래종류별로 위치가 바뀌는 경우까지 흡수)
2. **은행이 상호를 잘라서 준다**(truncate): "씨제이제일제"(=CJ제일제당), "(주)한국환경안전연" → **전방/부분일치 정규화 매칭** 필수(정확일치만으로는 실패).
3. **비수금 자동 제외 유형**(Desc2 기준): 법인잔고이전(자행/타행 자금이동)·이자·예금결산·BC/CMS/지로·통신요금 등 → 미수 대조 대상에서 제외.
4. **효성화학 실데이터 확인**(우리은행, B2B): 2026-06-29 같은 날 4,565,000 + 1,650,000 **분리 입금** 관측 → §11-2 D5(어음 합계매칭) 재검토 필요(효성화학도 분리 입금 사례 존재 — 아래 논점).

### 12.4 효성화학 결제 형태 — 확정 (D5)
- 사용자 확인: 효성화학은 **어음 일괄지급과 분리입금이 둘 다** 있음. → **화이트리스트 포함 + 폴백** 확정: `sum_nto1`(합계매칭) 우선 시도 → 조합 미발견 시 건별 exact/partial 폴백. (§4.3-b 반영 완료)

---

## 13. 법인카드 경비 → 결재 문서 지출 내역 자동 기입 (플랜, 2026-08-01 추가 — 미착수)

> 사용자 지시(시맨틱 위저드 세션, 2026-08-01): 구현 착수는 하지 않고 본 세션의 구현 계획에만 반영.
> 전자결재 측 선행 작업(지출 내역 표 6열 개편: **연번·사용일시·분류·상호·금액·지출 목적**,
> 마이그 116)은 완료됨 — 자동 기입이 채울 그릇이 먼저 준비된 상태.

### 13.1 목표 흐름
1. **바로빌 API로 등록 법인카드 승인 내역 자동 조회**(D6 벤더 전환 결정과 동일 벤더 — 계좌·카드·세금계산서 통합).
2. 조회된 승인 건 목록에서 사용자가 **경비 사용 건을 선택**해 **지출결의서 또는 출장보고서의
   '지출 내역' 표로 기입**(행 단위 선택 → 대상 문서 지정). 사용일시·상호·금액은 API 값으로 자동 채움.
3. **분류 자동 설정**: 카드 승인 내역이 제공하는 **매입처(가맹점) 사업자번호**를 키로 업종 특성을
   로직화해 기본 분류를 자동 부여. 자동 분류 실패 건만 사용자가 수동 선택.
4. 사용자 입력은 **분류(자동 실패 건 한정) + 지출 목적** 2가지로 최소화.

### 13.2 자동 분류 설계 메모 (사업자번호 기반)
- 사업자번호 자체에는 업종 정보가 인코딩되어 있지 않으므로, "사업자번호 → 업종" 판정은 다음
  3단 휴리스틱으로 로직화한다(§3.5 `bank_remitter_links` 입금자명 학습과 동일한 학습 사전 패턴):
  1. **가맹점 분류 학습 사전**(`card_merchant_links` 신설): 사업자번호 → 분류를 1회 확정하면
     이후 같은 가맹점은 자동 분류(주유소·단골 식당·숙박 체인 등 반복 사용처에서 즉시 효과).
  2. **API 제공 가맹점 업종 정보**: 바로빌 카드 내역의 가맹점 업종(업종명/업종코드) 필드를
     분류 매핑 테이블로 변환(주유소→교통비(유류), 숙박→숙박비, 음식점→식비 등) — 정식 연동 시
     응답 스펙 실측 후 매핑 확정.
  3. **상호명 키워드 폴백**: "주유소·GS칼텍스·모텔·호텔·김밥·식당" 등 키워드 사전.
- 분류 체계는 결재 양식의 분류 옵션과 1:1(출장보고서: 교통비·숙박비·식비·일비·기타 /
  지출결의서: 사무용품·소모품비, 업무추진비 등 비출장 옵션) — 옵션이 양식 빌더에서 바뀔 수 있으므로
  매핑은 옵션 문자열이 아닌 분류 키로 관리하고 양식 옵션과 대조.

### 13.3 문서 귀속·경비 채널 정책과의 관계
- **경비 입력 채널 정책**(semantic-analytics-wizard-blueprint §4-4): 출장 경비는 출장보고서
  (계약 귀속 자동), 비출장 지출은 지출결의서. 카드 내역 선택 기입 UI에서 대상 문서 유형 선택이
  이 정책의 입력 시점 가드가 된다(출장성 분류인데 지출결의서 선택 시 경고).
- 시맨틱 태깅(마이그 115·116)이 이미 완료되어 있으므로, 자동 기입된 금액은 즉시
  `cost.travel`/`cost.etc` 지표 집계 대상이 된다.

### 13.4 선행 조건·순서
- 바로빌 정식 계약·카드 등록(사용자 몫) → 카드 내역 API 응답 스펙 실측(가맹점 사업자번호·업종
  필드 확인) → `card_transactions` 원장 + `card_merchant_links` 마이그 → 조회·선택 기입 UI
  (지출결의서/출장보고서 기안 화면에서 "카드 내역 불러오기") → 자동 분류 로직.
- 본 블루프린트 P0(계좌 수집·수금 대조)와 병행 가능하나, 벤더 계약·수집 커넥터 기반은 공유하므로
  **P0의 바로빌 커넥터 구축 이후**에 착수하는 것이 효율적.

---

_v2 확정본 + CODEF 6개 은행 데모 실증 반영(2026-07-22). 다음: CODEF 견적·정식 심사 요건 확인 → P0 착수(088 마이그레이션·계좌원장·API 커넥터)._
