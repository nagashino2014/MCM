# 바로빌(Barobill) 재무 연동 블루프린트 — 지출결의 자동작성 · 부가세 계정과목 분류 · 수금 자동대조 · 전자세금계산서 발행 (v1)

> 상태: **v1 초안 (2026-08-15)** — 벤더 = **바로빌 최종 확정**(사용자 지시). 이용 서비스 3종 = 계좌조회 · 카드조회(**매입내역만**) · 전자세금계산서.
> 선행 문서: [bank-reconciliation-blueprint.md](bank-reconciliation-blueprint.md) v2 — 수금 대조 엔진 설계(§3~§9)는 그대로 계승하며, 본 문서가 벤더 확정 이후의 **통합 상위 블루프린트**다.
> API 스펙 출처: dev.barobill.co.kr 레퍼런스(2026-08-15 실사) + `scripts/barobill-demo/` 기검증 SOAP 헬퍼.

---

## 0. 확정 결정 (사용자 지시)

| # | 결정 | 근거·영향 |
|---|---|---|
| B1 | **벤더 = 바로빌 최종 확정** | CODEF 견적 과다로 전환(선행 문서 D6). 계좌·카드·세금계산서 3종 통합 단일 벤더. |
| B2 | **카드 수집대상 = 매입내역(PURCHASE)만** (승인내역 미사용) | 바로빌 상담 결과 "매입내역이 정확하고 더 중요" — 매입내역은 공급가액/부가세 분리·가맹점 정보·매입확정 여부 제공. 트레이드오프: 수집주기 **DAY1만 가능**, 승인→매입 확정까지 통상 2~5일 지연(지출결의 작성 시점에 최근 며칠 건이 아직 안 보일 수 있음 — UI에 안내 문구 필요). |
| B3 | 지출결의서(법인카드 전용) = 매입내역에서 **사용자가 선택 → 지출 목록 자동 작성 → 사용 목적만 기입** 후 기안 | 출장 경비 제외(사무용품비·인쇄비·업무추진비·접대비 등 비출장 지출). |
| B4 | 출장보고서 경비 지출 내역 = 동일 방식(매입내역 선택 → 자동 작성 → 목적만 기입) | 출장 경비 채널. |
| B5 | 부가세 준비 = 매입내역 일괄 수집 → **가맹점 사업자번호 기준 업종 특정 → 계정과목 자동 분류** | 기존 카드별 엑셀 수작업 분류(코레일→여비교통비, 출장식대→복리후생비 등) 대체. |
| B6 | 수금 = 계좌 입금내역 ↔ 계산서 발행 건 매칭 → **수금 예상 검출 리스트를 사용자에게 제시, 최종 승인은 사용자** | 완전 자동확정 없음(선행 문서 D2 "일괄 원클릭 승인" 유지). |
| B7 | 계약 상세 "청구·수금 단계"에 **전자세금계산서 발행 버튼** → 앱에서 바로빌 발행 API 직접 호출 → 발행 기록을 단계에 자동 기록 | 기존 milestone PATCH 패턴 재사용. |

선행 문서에서 계승되는 결정: D2(일괄 원클릭 승인) · D3(`bank_remitter_links` 학습 테이블) · D4(출금은 원장 적재만 → 본 문서에서 카드 원장과 함께 부가세 준비로 승격) · D5(효성화학 sum_nto1 화이트리스트+폴백).

---

## 1. 바로빌 API 기술 사양 (실사 확정)

### 1.1 공통
- **통신 = SOAP(.asmx, XML)**. 네임스페이스 `http://tempuri.org/`. 파라미터는 **문서 순서 그대로** 삽입해야 함(`scripts/barobill-demo/barobill.js` 검증 완료).
- 엔드포인트: 테스트 `https://testws.baroservice.com/{SERVICE}.asmx` / 운영 `https://ws.baroservice.com/{SERVICE}.asmx`. 서비스: `BANKACCOUNT` · `CARD` · `TI`(세금계산서).
- 인증 = **CERTKEY(연동인증키) + CorpNum(사업자번호) + ID(바로빌 회원 아이디)** 매 호출 전달. 반환 음수(1~5자리) = 오류코드(`GetErrString`).
- **운영 전환 전(테스트베드) 전 기능 무료.** 별도 신청 없이 운영 전환 가능(운영 CERTKEY 별도).
- 요금 = 선불 충전 종량제, **구간별 차등 단가(견적제)**. 예전 견적 기준: 계좌 거래내역 계좌당 월 3,000(24h주기)·카드 카드당 월 3,000(24h)·세금계산서 발급 100원/건. **매입내역(PURCHASE) 단가는 견적 재확인 필요**(§8 논점).
- 등록 계좌·카드는 매월 1일 자동연장, 충전잔액에서 차감(잔액 부족 시 알림 메일/문자 → 수집 중단 리스크, 잔액 모니터링 `GetBalanceCostAmount` 활용).

### 1.2 계좌조회 (`BANKACCOUNT.asmx`)
- **등록**: `RegistBankAccountEx(CERTKEY, CorpNum, CollectCycle, Bank, BankAccountType, BankAccountNum, BankAccountPwd, WebId, WebPwd, IdentityNum, ...)` 또는 **`GetBankAccountManagementURL`**(바로빌 호스팅 등록 UI, URL 60초 유효 — **자격증명을 우리 서버에 태우지 않는 권장 경로**).
  - CollectCycle: `MINUTE10/MINUTE30/HOUR1/HOUR4/DAY1` → **DAY1 채택**(최저가, 수금 대조는 일 단위면 충분).
  - **수집 대상 = 국민 + 기업 2계좌만 유료 등록(확정 2026-08-15, 월 3,300원×2=6,600원)**. 나머지 4개 은행(신한·하나·우리·농협)은 어음/대금 수취·잔고이전 전용이라 미등록 — ⚠ **미등록 계좌로 들어오는 수금(어음 포함)은 자동대조(F4) 범위 밖**(기존 수동 입력 유지). 특히 효성화학 분리입금이 우리은행에서 관측된 이력이 있어, 효성화학 어음 케이스(D5 sum_nto1)의 실효성은 해당 수금이 국민/기업으로 들어오는지에 달림 — 필요해지면 계좌 추가 등록(계좌당 독립 신청) 또는 엑셀 업로드 폴백으로 확장. 은행 코드: `IBK / KB`(등록됨), 예비 `SHINHAN / HANA / WOORI / NH`.
  - 은행별 필수항목(실사): 기업·하나·우리·농협 = 계좌비밀번호+사업자번호 / 국민 = 계좌비밀번호+빠른조회ID / 신한 = 계좌비밀번호+빠른조회ID+PW. **전제: 각 은행 빠른조회(국민·기업·농협·하나)/간편조회(신한)/스피드조회(우리) 선등록 — 사용자 작업.**
- **조회**: `GetPeriodBankAccountTransLog(..., BankAccountNum, StartDate, EndDate, TransDirection(1전체/2입금/3출금), CountPerPage≤100, CurrentPage, OrderDirection)` — 최대 200일, 페이징(`MaxPageNum`).
- **응답 `BankAccountTransLog`**:

| 필드 | 의미 | → 원장 매핑 |
|---|---|---|
| `TransDT`(14) | 입출금일시 YYYYMMDDHHMMSS | `txn_at` |
| `TransDirection` | "입금"/"출금"/"기타" | `direction`('in'/'out'/'etc') |
| `Deposit` / `Withdraw` / `Balance` | 입금액/출금액/잔액 | `amount`·`balance_after` |
| `TransType` | 거래종류(은행 제공 시) | 비수금 제외 판정(이자·잔고이전·CMS 등) |
| `TransOffice` | 취급점 | `memo` 보조 |
| **`TransRemark1` / `TransRemark2`** | 비고1/2 — **입금자명이 은행별로 다른 위치에 실림** | `remitter_name_raw` — CODEF 실측(Desc1/Desc3 편차)과 동일하게 **"Remark1·Remark2 중 facilities 정규화 매칭되는 값 채택" 다중필드 휴리스틱** |
| **`TransRefKey`**(24) | 계좌 당 고유키 | **`dedup_key` = `BankAccountNum + TransRefKey`** |
| `CmsCode`, `CurrencyCode`, `Memo` | — | `raw_json` 보존 |

### 1.3 카드조회 (`CARD.asmx`) — 매입내역(PURCHASE) 전용 [B2]
- **등록**: `Register(CERTKEY, CorpNum, CollectTarget='PURCHASE', CollectCycle='DAY1', CardCompany, CardType='C', CardNum, WebId, WebPwd, Alias, Usage)` 또는 `GetCardManagementURL`(호스팅 UI, 60초).
  - **CollectTarget·CollectCycle·카드번호는 등록 후 수정 불가.** 매입내역은 DAY1만 허용.
  - 카드사 코드: `BC`(기업은행 법인카드는 BC망 — CODEF 실증과 동일) · `LOTTE`(주력 공용 18장) 등 12사. 로그인은 **카드사 홈페이지 ID/PW**(카드사별 계정 필요 — 사용자 작업).
  - 수집 시각: **매일 04:00**(카드마다 1~5분 오차). ⚠ **BC카드 함정**: BC 사이트 승인내역조회의 "회계양식" 설정에서 일부 항목만 선택돼 있으면 그 외 항목 수집 불가 → 전체 선택/해제 상태 확인(사용자 작업).
  - **활성 카드만 선별 등록** 정책 유지(카드당 월정액 — 스페어·저사용 카드 제외, §8 논점).
- **조회**: `GetPurchaseHistories(..., CardNum, StartDate, EndDate, CountPerPage≤100, CurrentPage, OrderDirection)` — 최대 200일. 월 단위 `GetMonthlyPurchaseHistories`(부가세 분기 집계에 유용).
- **응답 `CardPurchaseHistory`** (★ 계정과목 자동분류의 원천):

| 필드 | 의미 | 활용 |
|---|---|---|
| **`HistoryKey`**(30) | 카드 당 고유키 | **`dedup_key` = `CardNum + HistoryKey`** (공식 가이드 명시) |
| `ApprovalType` | 승인/취소/부분취소/거절/환불 | 취소·환불 건 상계 처리 |
| `ApprovalNum`, `ApprovalDT`(14) | 승인번호/승인일시 | `approved_at` |
| `UseDate`(8) | 사용일자 | 결의서 "사용일시" 열 |
| `ApprovalAmount` | 승인금액(총액) | 결의서 "금액" 열 |
| **`Amount` / `Tax` / `ServiceCharge`** | 공급가액/부가세/봉사료 분리 | **부가세 신고 매입세액 산정** |
| **`StoreCorpNum`**(10) | 가맹점 사업자번호 | **분류 학습 사전 키** |
| `StoreName` / `StoreCeo` / `StoreAddr` / `StoreTel` | 가맹점 상호/대표/주소/전화 | 결의서 "상호" 열·키워드 분류 |
| **`StoreBizType`** | 가맹점 업태 | **업종 기반 자동 분류 1차 소스** |
| `StoreCorpType` | 사업자유형(개인/법인/비영리/고유번호) | 분류 보조 |
| **`StoreTaxType`** | 과세유형(일반/간이/면세/비영리/고유번호…) | **매입세액 공제/불공제 판정 태그**(간이·면세 가맹점 = 공제 불가) |
| `IsPurchased` | 매입 완료 여부 | 매입 확정 상태 표시 |
| `PaymentPlan`, `InstallmentMonths`, `UseLocation`, `IsDebit`, `ViewCardNum` | 할부·사용지역·체크카드 등 | `raw_json` 보존 |

- ⚠ Store* 필드는 "카드사 사이트에서 제공되는 경우에만" — **카드사(BC·롯데)별 실제 제공 범위는 테스트베드에서 실측 필수**(P0 산출물).

### 1.4 전자세금계산서 (`TI.asmx`)
- **발행(즉시)**: `RegistAndIssueTaxInvoice(CERTKEY, CorpNum(공급자), Invoice: TaxInvoice, SendSMS, ForceIssue, MailTitle)` → int(1 성공). 성공 시 공급받는자에게 이메일 자동 발송.
  - **전제: 공급자(우리 회사) 공동인증서를 바로빌에 등록**(기존 범용 법인 인증서 재사용, 2027-01 만료 — 사용자 작업).
  - `ForceIssue`: 가산세 예상(지연발급) 시에도 강행 여부 — 기본 false, 실패 시 사유 안내.
- **`TaxInvoice` 핵심 구조**:
  - `InvoicerParty`(공급자) / `InvoiceeParty`(공급받는자): **`MgtNum`(24자, 연동사 부여 고유키 — 정발급은 공급자 측 필수)**, `CorpNum`, `CorpName`(⚠ 특수문자 불가: "㈜"→"(주)" 변환 필요 — 기존 `formatCompanyName`이 ㈜로 통일하므로 **역변환 유틸 필요**), `CEOName`, `Addr`, `BizClass`(업종)/`BizType`(업태), `ContactID`(공급자 필수 = 바로빌 회원 ID), `ContactName`, `TEL`, `HP`, `Email`(공급자 필수, 수신처는 담당자 이메일).
  - `IssueDirection=1`(정발급) · `TaxInvoiceType=1`(세금계산서) · `TaxType`(1 과세/2 영세/3 면세) · `PurposeType`(1 영수/**2 청구** — 기성 청구는 청구가 기본).
  - `WriteDate`(작성일자 YYYYMMDD), `AmountTotal`(공급가액)/`TaxTotal`(세액)/`TotalAmount`(합계) — **문자열, 콤마·소수점 불가**.
  - `Cash/ChkBill/Note/Credit`(결제수단 구분), `Remark1~3`.
  - `TaxInvoiceTradeLineItems[]`(품목 ≤99): `PurchaseExpiry`(공급일자), `Name`(품목), `ChargeableUnit`(수량), `UnitPrice`(단가), `Amount`, `Tax`, `Description`.
  - 수정세금계산서 = 동일 API + `ModifyCode`(1 기재착오 / 2 공급가액 변동 / 3 환입 / 4 계약해제 / 5 내국신용장 / 6 이중발급) + `Remark1`에 원본 국세청 승인번호.
- **상태 조회**: `GetTaxInvoiceState(...MgtKey)` → `BarobillState`(1000 임시 / **3014 발급완료** / 5031 발급 후 취소 등), **`NTSSendState`**(1 전송전~4 전송완료/5 실패), **`NTSSendKey`(국세청 승인번호)**, `NTSSendDT`, `IsOpened`(수신 이메일 개봉).
  - 국세청 전송은 발급 후 바로빌이 일괄 처리(통상 익일) → **상태 폴링 배치로 NTSSendKey·전송결과 반영** 필요.
- 취소: `DeleteTaxInvoice`(국세청 전송 전) / 전송 후엔 수정세금계산서로만 정정.

---

## 2. 전체 아키텍처

```
[바로빌: 매일 04:00 은행·카드사 스크래핑 → 바로빌 DB 보관]
        │ (SOAP pull — 우리는 "이미 수집된 것"을 조회만)
        ▼
[수집 배치 (매일 아침, 전일+α 증분)]
  BANKACCOUNT.GetPeriodBankAccountTransLog ──▶ bank_transactions (원장, 불변)
  CARD.GetPurchaseHistories ────────────────▶ card_transactions (원장, 불변)
        │
        ├─ F1/F2. 지출결의서·출장보고서: 기안 화면 "법인카드 내역 불러오기"
        │    card_transactions(미사용 건) → 선택 → expenses/trip_expenses 표 자동 기입
        │    분류 자동: card_merchant_links → StoreBizType 규칙 → 키워드 폴백
        │
        ├─ F3. 부가세 준비: 카드 원장 보드(월/분기) + 계정과목 일괄 분류·확정
        │    → 분기 집계 리포트(공제/불공제·계정과목별) + xlsx export
        │
        ├─ F4. 수금 자동대조: bank_transactions(입금) × 미수 milestone + tax_invoices
        │    → recon_matches(suggested) → 검토 큐 → 일괄 승인 → milestone PATCH
        │
        └─ F5. 세금계산서 발행: 계약 상세 청구·수금 단계 → 발행 모달
             TI.RegistAndIssueTaxInvoice → tax_invoices 기록 + milestone 발행 플래그
             상태 폴링 배치 → NTSSendKey/전송결과 갱신 → F4 매칭 근거로 연결
```

- **원장(불변) / 파생(문서·매칭·분류) 분리** 원칙 유지. 문서·매칭·분류는 원장 위에서 재계산 가능.
- **커넥터 위치**: `frontend/lib/barobill/`(client.ts = SOAP 헬퍼 — `scripts/barobill-demo/barobill.js` 이식 + 타입, bank.ts / card.ts / taxinvoice.ts). Next API 라우트·배치가 공용.
- **수집 배치 실행**: EventBridge Scheduler → Next API 크론 엔드포인트(`/api/finance/sync`, 시크릿 헤더 가드) 호출 권장. 바로빌이 04:00 수집하므로 **매일 06:00 1회**면 충분(DAY1). 기존 next 자동 기동(08시)과 겹치지 않게 next 기동 후 보정 로직(놓친 날짜 catch-up: 마지막 수집일 이후 증분) 필수 — **야간 정지 스케줄 때문에 새벽 배치가 실행 불가**하므로 실제로는 **아침 첫 요청/기동 시 catch-up이 주 경로**(§8 논점).
- **시크릿**: CERTKEY·바로빌 ID는 ECS 태스크 정의 시크릿(기존 패턴). 은행 계좌비번·카드사 웹 비번은 **바로빌 호스팅 등록 UI(GetBankAccountManagementURL/GetCardManagementURL) 경유로 우리 서버에 저장하지 않음**(선행 문서 §11-5 위탁형 원칙 유지).

---

## 3. 데이터 모델 — 마이그레이션 `170_barobill_finance.sql`

> 관례: `CREATE TABLE IF NOT EXISTS`, 타임스탬프 text, bool integer, 멱등. **다음 번호 = 170**(169가 최신. ⚠ 032·133 번호 충돌 쌍 존재하므로 신규는 170 고정).

### 3.1 계좌·거래 원장 (선행 문서 §3 계승, 바로빌 필드로 확정)
- **`bank_accounts`**: `account_id` PK, `bank_code`(IBK/KB/…), `bank_name`, `account_no`(바로빌 조회 파라미터로 필요 — 평문 보관하되 화면은 마스킹), `account_alias`, `collect_cycle` DEFAULT 'DAY1', `is_active`, `registered_via`(managed_url/api), `created_at`.
  - 변경: 선행 설계의 hash 전용 보관 → **바로빌 조회 API가 계좌번호 원문을 요구**하므로 원문 컬럼 유지(RBAC로 접근 통제, 화면 마스킹).
- **`bank_transactions`**: `txn_id` PK, `account_id` FK, `txn_at`, `direction`('in'/'out'/'etc'), `amount`, `balance_after`, `remitter_name_raw`, `remitter_name_norm`, `trans_type`, `trans_office`, `remark1`, `remark2`, `bank_ref`(=TransRefKey), **`dedup_key` UNIQUE(= account_no+TransRefKey)**, `source` DEFAULT 'barobill', `raw_json` jsonb, `recon_status` DEFAULT 'unprocessed', `created_at`.
- **`recon_matches` / `recon_match_lines` / `bank_remitter_links`**: 선행 문서 §3.3~3.5 그대로.

### 3.2 카드 원장 (신규)
- **`card_registry`**: `card_id` PK, `card_company`(BC/LOTTE/…), `card_num`(조회 파라미터 — 원문 보관·화면 마스킹), `card_name`/`alias`, `holder_employee_id`(소지 직원 — 결의서 기본 필터), `card_type` DEFAULT 'C', `collect_target` DEFAULT 'PURCHASE', `is_active`(수집 활성 토글), `registered_at`, `created_at`.
- **`card_transactions`**: `card_txn_id` PK, `card_id` FK, `history_key`, **`dedup_key` UNIQUE(= card_num+history_key)**, `approval_type`(승인/취소/…), `approval_num`, `approved_at`(=ApprovalDT), `use_date`, `amount_total`(=ApprovalAmount), `supply_amount`(=Amount), `tax_amount`(=Tax), `service_charge`, `store_corp_num`, `store_name`, `store_ceo`, `store_addr`, `store_biz_type`, `store_corp_type` int, `store_tax_type` int, `is_purchased` int, `payment_plan`, `installment_months`, `use_location`, `is_debit` int, `raw_json` jsonb, — 파생 상태: **`category_key`**(계정과목, null=미분류), `category_source`('learned'/'rule'/'keyword'/'manual'), **`doc_id`**(귀속 결재문서, null=미사용), `doc_form_id`, `excluded` int DEFAULT 0(경비 아님/개인사용 등 제외 표시), `memo`, `created_at`.
  - 인덱스: `(use_date)`, `(store_corp_num)`, `(doc_id)`, `(category_key)`, `(approval_type)`.
  - 취소/환불 건: 원거래와 함께 적재, 화면에서 상계 표시(자동 소멸 처리 않음 — 원장 불변).
- **`card_merchant_links`** (★ 분류 학습 사전, `bank_remitter_links` 패턴): `store_corp_num` PK, `category_key`, `store_name_snapshot`, `confirm_count` int, `last_confirmed_at`, `created_at`. 확정(결재 상신 또는 부가세 보드에서 분류 확정) 시 upsert.
- **`expense_categories`** (계정과목 사전): `category_key` PK, `label`(여비교통비/복리후생비/사무용품비/접대비/도서인쇄비/소모품비/차량유지비/통신비/교육훈련비/지급수수료 등), `form_option_map` jsonb(결재 양식 select 옵션 문자열 ↔ 키 매핑 — 양식 옵션이 빌더에서 바뀌어도 키로 관리), `biz_type_rules` jsonb(업태/업종 키워드 배열), `store_keyword_rules` jsonb(상호 키워드 배열), `vat_deductible_default` int, `sort_order`, `is_active`.
  - 시드: 코레일/철도/고속버스/항공 → 여비교통비, 주유소/충전소 → 차량유지비, 음식점(출장 중) → 복리후생비, 문구/사무 → 사무용품비, 인쇄 → 도서인쇄비, 골프장/유흥 → 접대비(불공제) 등. 운영하며 규칙 보강.

### 3.3 세금계산서 발행 기록 (신규)
- **`tax_invoices`**: `invoice_id` PK, **`mgt_key` UNIQUE**(=바로빌 MgtNum, 채번 규칙 `TI{YYYYMMDD}-{milestone_id 축약}-{seq}` ≤24자), `contract_id` FK, `milestone_id` FK, `direction` DEFAULT 'sales', `write_date`, `amount_total`, `tax_total`, `total_amount`, `tax_type` int DEFAULT 1, `purpose_type` int DEFAULT 2, `invoicee_facility_id`(공급받는자 = counterparty), `invoicee_corp_num`, `invoicee_corp_name`, `invoicee_email`, `line_items` jsonb, `barobill_state` int, `nts_send_state` int, **`nts_send_key`**(국세청 승인번호), `nts_send_dt`, `nts_result`, `is_opened` int, `modify_code`, `original_invoice_id`(수정세금계산서의 원본), `issued_by`, `issued_at`, `canceled_at`, `raw_state_json` jsonb, `created_at`, `updated_at`.
  - milestone과 1:N(재발행·수정 발행 이력 보존). **milestone의 `invoice_issued/invoice_issued_at/invoice_amount`는 기존 그대로 두고 발행 성공 시 PATCH 로직 재사용**(기존 billing 화면 무수정 호환 — 선행 문서 §5 원칙과 동일).

### 3.4 배치 로그
- **`finance_sync_logs`**: `sync_id` PK, `kind`('bank'/'card'/'taxinvoice_state'), `target_id`(계좌/카드), `range_from`, `range_to`, `fetched` int, `inserted` int, `status`, `error`, `started_at`, `finished_at`. (수집 결과 카드 UI — universal-scraper 실행 로그 카드 패턴 재사용)

### 3.5 RBAC
- `finance.view`(원장·부가세 보드 조회) / `finance.manage`(계좌·카드 등록, 분류 확정, 수집 설정) / `recon.confirm`(수금 대조 확정) / `taxinvoice.issue`(세금계산서 발행) 신설 — 기존 `requirePermission` 카탈로그에 추가.

---

## 4. 기능 설계

### F0. 계좌·카드 연결 관리 (상시 운영 화면 — 사용자 요구로 정식 기능 승격, 2026-08-15)

> 배경: 현재는 국민+기업 2계좌로 시작하지만 **재정 여유가 생기면 전 계좌(6개) 등록으로 확장** 예정. 카드도 교체 주기·신규 발급·해지가 수시로 발생 → **앱 안에서 신규 등록/해지/재등록이 완결**되어야 함(바로빌 사이트 방문 없이).

**화면**: "재무 > 연결 관리"(`finance.manage` 권한, cdash). 계좌 탭 / 카드 탭.

| 동작 | 구현 | 비고 |
|---|---|---|
| 목록·상태 동기화 | `GetBankAccountEx2` / `GetCards`(ALL) → `bank_accounts`/`card_registry` upsert | 사용중/해지 상태·수집주기 표시. 바로빌 측이 진실원본, 앱 테이블은 캐시+메타(별칭·소지 직원·활성 토글) |
| **신규 등록** | 버튼 → `GetBankAccountManagementURL`/`GetCardManagementURL` 발급 → **새 창 팝업**(60초 유효 — 클릭 시점 발급, 만료 시 재발급 버튼) → 닫힘/복귀 시 목록 재동기화 | 자격증명(계좌비번·카드사 웹PW)이 우리 서버를 거치지 않는 권장 경로. 은행 빠른조회류 선가입 안내 문구 포함 |
| **해지** | `StopBankAccount` / `Stop`(카드) 직접 호출 | 확인 다이얼로그 필수(⚠ 해지 당월 요금 미환불·당월 말까지 수집 지속·익월 중단 — 등록 화면 실측 안내 그대로 표기) + audit 기록 |
| 해지 취소 | `CancelStopBankAccount` / `CancelStop` | **해지 당월에만 가능** — 목록에서 해지 상태 행에 조건부 노출 |
| 재등록 | `ReRegistBankAccount` / `ReRegister` | 해지 월 경과 후 다시 수집 신청(과금 재개) |
| 메타 편집 | 앱 로컬: 별칭, 카드 소지 직원(`holder_employee_id`), 수집 활성 토글, 메모 | `UpdateBankAccountEx`/`Update`는 자격 변경 시에만(가급적 호스팅 URL로 유도) |
| 잔액·과금 | `GetBalanceCostAmount` 표시 + 임계 미만 홈 알림 | 매월 1일 자동연장 차감이라 잔액 소진 = 수집 중단 사고 |

- 신규 계좌/카드 등록 직후 **소급 수집(계좌 3개월) 자동 반영** — 등록 감지 시(목록 동기화) 해당 대상의 초기 pull을 즉시 실행(다음 배치 대기 없이).
- 해지된 대상의 기존 원장은 보존(원장 불변) — 수집만 중단.

### F1. 지출결의서 자동 작성 (법인카드 매입내역 → `expenses` 표) [B3]

**그릇은 준비 완료**: `frm-expense-report`의 `expenses` 표 6열(마이그 116) = `no`(rowno 자동)/`used_on`(date)/`category`(select)/`vendor`(text)/`amount`(currency, sumColumn)/`detail`(text). 값은 `approval_docs.field_values.expenses = [{used_on, category, vendor, amount, detail}, ...]` 행 배열.

**UI 흐름** (`ApprovalDraftBoard.tsx` 확장):
1. 양식이 `frm-expense-report`/`frm-biz-trip-report`일 때 지출 내역 표 상단에 **"법인카드 내역 불러오기"** 버튼 노출.
2. 모달(cdash, 포털이므로 `cdash-vars`+`data-theme` 스코프): 기간(기본 최근 1개월)·카드 필터(기본 = 로그인 직원 `holder_employee_id` 카드), **미사용(doc_id IS NULL)·미제외·승인 건** 목록. 각 행 = 사용일자·상호·금액·자동분류 배지·카드 별칭. 취소/환불 건은 흐리게+배지.
3. 다중 선택 → "표에 추가": `used_on=use_date`, `vendor=store_name`, `amount=amount_total`(승인 총액), `category=자동분류 결과`(§F3 3단 로직, 실패 시 빈 값 = 사용자가 select 선택), `detail=""`(사용자 입력 몫). 행에 `_cardTxnId` 메타 보존(hidden — field_values에 함께 저장해 역추적).
4. 사용자는 **지출 목적(detail)만 기입**(+ 자동분류 실패 건의 분류) 후 기안.
5. **상신 성공 시** `card_transactions.doc_id = 문서ID` 마킹(사용 처리 → 다른 결의서에서 안 보임) + 분류 확정치를 `card_merchant_links`에 학습 upsert. 문서 삭제/반려 후 재작성 대비: 문서 삭제·기안 취소 시 doc_id 해제 훅.
- 이중 기입 방지: 모달 목록 자체가 미사용 건만. 이미 사용된 건은 "○○ 문서에 사용됨" 표시.
- **채널 가드**(선행 문서 §13.3): 출장성 분류(여비교통비 등) 건을 지출결의서에 담으면 경고 배너("출장 경비는 출장보고서 경비 내역 사용 권장") — 차단은 아님.
- 매입 지연 안내: 모달 하단에 "매입내역은 카드 사용 후 확정까지 2~5일 걸릴 수 있습니다 · 최종 수집 {finance_sync_logs 최근 시각}" 표기.

### F2. 출장보고서 경비 지출 내역 [B4]
F1과 동일 컴포넌트 재사용, 대상 표만 `trip_expenses`(키: `spent_on`/`category`/`vendor`/`amount`/`detail` — 사용일시 키가 양식별로 다름에 주의: 지출결의 `used_on`, 출장보고 `spent_on`). 분류 기본값은 출장 옵션 세트(교통비·숙박비·식비 등 — `expense_categories.form_option_map`으로 양식별 옵션 문자열 매핑). 금액은 시맨틱 태깅(115·116) 덕에 기입 즉시 `cost.travel`/`cost.etc` 지표 집계 대상.

### F3. 부가세 준비 — 계정과목 자동 분류 [B5]

**자동 분류 3단 파이프라인**(수집 배치 직후 신규 건에 일괄 적용, `category_source` 기록):
1. **`card_merchant_links`**(사업자번호 학습 사전) — 히트 시 즉시 확정 수준. 반복 사용처(코레일·주유소·단골 식당)는 1회 확정 후 전부 자동.
2. **`StoreBizType`(업태) + `expense_categories.biz_type_rules`** — "여객운송→여비교통비", "주유소→차량유지비", "일반음식점→복리후생비", "문구·사무용품→사무용품비" 등.
3. **상호 키워드 폴백**(`store_keyword_rules`) — "코레일", "GS칼텍스", "호텔", "김밥" 등.
- 미분류 잔여 건만 수동 — 보드에서 분류 지정 시 즉시 `card_merchant_links` 학습.
- **공제/불공제 태그**: `StoreTaxType`(간이 2·면세 4·비영리 6 등 = 매입세액공제 불가)+접대비 등 계정과목 기본값(`vat_deductible_default`)으로 자동 태깅 — 회계 담당자 검토 열.

**화면**: 신규 메뉴 **"재무 > 법인카드 원장"**(cdash, `finance.view`):
- 월/분기 필터 × 카드 필터. 행 = 매입 건(사용일·카드·상호·업태·공급가액·부가세·분류(인라인 select)·공제여부·귀속 문서 링크·상태).
- 툴바: "자동분류 재실행" · "선택 건 분류 일괄 지정" · **"부가세 집계"**(분기 선택 → 계정과목×공제여부 피벗 + 카드별 소계) · **xlsx export**(기존 회계 담당자 인수용 — 현행 카드사 엑셀 다운로드 대체).
- 취소·환불 상계 요약, 미분류/검토필요 카운트 KPI.

### F4. 수금 자동대조 [B6] — 선행 문서 §4~§9 엔진 그대로, 어댑터만 교체
- 입금자명 추출: **`TransRemark1`·`TransRemark2` 중 facilities 정규화 매칭(전방/부분일치) 되는 값 채택** 휴리스틱(은행별 프로파일 학습 겸용). 비수금 제외 = `TransType`/`TransRemark` 키워드(이자·법인잔고이전·CMS·지로 등).
- 거래처 식별 체인(학습링크→normalized_company_name→facility_aliases→merge_aliases), exact_1to1 / sum_nto1(효성화학 화이트리스트+폴백) / partial / overpaid / prepaid / non_receivable 유형, 신뢰도 스코어, 검토 큐(일괄 원클릭 승인) — 전부 선행 문서 확정안.
- **본 문서에서 강화되는 것**: F5의 `tax_invoices`가 쌓이면 매칭 후보를 "milestone"이 아니라 **"발행된 계산서(정확한 발행일·금액·NTSSendKey)"** 기준으로 잡을 수 있어 스코어링의 "시기 근접"·"금액 일치" 정확도가 오름(발행일 = `write_date` 사용). milestone 수기 발행 기록 건은 기존 방식 폴백.
- 확정 → 기존 milestone PATCH/`payments` append 라우트 로직 재사용(전액=`payment_collected=1`, 부분=`partial_payments_json` append) — 미수금/수금 화면 무수정 호환.
- UI = billing에 **"자동대조" 탭** 추가(기존 5탭 + 1): 검토 큐(고신뢰 일괄 승인/검토 필요/미매칭·선수금) — 선행 문서 §8 그대로.

### F5. 전자세금계산서 발행 [B7]
**진입점**: `ContractDetailPanel` 청구·수금 단계(contracts/page.tsx:1112~) 행 액션에 **"계산서 발행"** 버튼 추가(+기존 `InvoiceUploadModal`의 수기 발행 입력과 병존 — 수기 기록은 유지).

**발행 모달**(`TaxInvoiceIssueModal`, 포털 cdash 스코프, `taxinvoice.issue` 권한):
1. 자동 채움: 공급받는자 = `contracts.counterparty_facility_id` → facilities(사업자번호·상호(㈜→"(주)" 역변환)·대표자·주소) + 담당자/이메일(contacts에서 선택, 필수 — 이메일 수신처). 품목 1행 = 계약명+단계명(`stage_label`), 공급일자 = 작성일자. 금액 = milestone `amount`(공급가액/세액 자동 분해: 계약 금액이 부가세 포함인지 별도인지 **계약 데이터 관례 확인 후 확정**, §8 논점), `PurposeType=청구`, `TaxType=과세` 기본.
2. 편집 가능(작성일자·품목·금액·비고), 검증(사업자번호 10자리·금액 정합 AmountTotal+TaxTotal=TotalAmount·이메일).
3. 발행 → `/api/finance/tax-invoices` POST → `RegistAndIssueTaxInvoice`. 성공 시:
   - `tax_invoices` INSERT(mgt_key 채번·상태 3014 대기),
   - **기존 milestone PATCH 재사용**: `invoice_issued=1`, `invoice_issued_at=write_date`, `invoice_amount=total`(발행요청 회신 알림 로직도 그대로 타짐),
   - 단계 행에 "전자발행" 배지 + NTS 상태 칩(전송전→전송완료), `GetTaxInvoicePopUpURL`로 원본 보기 링크.
4. **상태 폴링 배치**(taxinvoice_state, 발행 후 미완 건 대상 일 1~2회): `GetTaxInvoiceState` → `nts_send_state/nts_send_key/nts_result` 갱신. 전송실패 시 홈 알림.
5. 취소·수정: 국세청 전송 전 = `DeleteTaxInvoice` + milestone 발행 플래그 롤백. 전송 후 = 수정세금계산서(ModifyCode 선택 모달, 2차 범위).
- 테스트베드에서 발행한 계산서는 국세청 미전송(테스트 환경)이므로 실증은 운영 전환 후 소액 1건으로.

---

## 5. 구현 로드맵

| 단계 | 내용 | 산출 |
|---|---|---|
| **P0 — 기반** | 마이그 170 + `lib/barobill` 커넥터(SOAP 3서비스) + 계좌·카드 등록 관리 화면(호스팅 URL 위임 + 목록/활성 토글/`holder_employee_id` 지정) + 수집 배치(`/api/finance/sync` + catch-up) + 원장 조회 화면(최소) + `finance_sync_logs` 카드. **테스트베드 CERTKEY로 응답 필드(특히 BC·롯데 Store* 제공 범위, TransRemark 은행별 위치) 실측** | 자동 수집·적재 동작 + 스펙 실측 보고 |
| **P1 — 지출결의 자동 작성** [우선] | F1+F2: 카드 내역 불러오기 모달 + 표 주입 + doc_id 마킹/해제 훅 + 분류 3단 로직 + `card_merchant_links` 학습 + `expense_categories` 시드 | 사용자는 목적만 기입하고 기안 |
| **P2 — 부가세 보드** | F3: 법인카드 원장 보드(분류 편집·일괄·재실행) + 공제/불공제 태그 + 분기 집계 + xlsx export | 회계 담당자 수작업 대체 |
| **P3 — 수금 자동대조** | F4: 매칭 엔진(선행 문서 P1~P2 범위: exact/partial 먼저, sum_nto1·특수유형 후속) + billing "자동대조" 탭 + 일괄 승인 + milestone 반영·롤백 + `bank_remitter_links` 학습 | 수금 예상 검출 리스트 → 원클릭 승인 |
| **P4 — 세금계산서 발행** | F5: 발행 모달 + tax_invoices + milestone 자동 기록 + 상태 폴링 + 발행분 기준 매칭 강화(F4 연계) | 앱에서 발행→기록→수금대조 폐루프 |
| **P5 — 고도화** | 수정세금계산서, 업체별 결제주기 학습, 임계값 튜닝 UI, 분류 규칙 관리 화면, 홈 위젯(미분류 카드 건·수금 검출 대기 건) | 정확도·자동화↑ |

> P1을 최우선으로 하되(사용자 지시 "우선적으로 지출결의서·출장보고서"), P0 실측에서 카드사별 Store* 필드 공백이 크면 분류 파이프라인 가중치를 키워드 쪽으로 재조정.
> P3와 P4는 독립적이라 순서 교체 가능 — 단 P4를 먼저 하면 F4 매칭 정확도가 처음부터 올라가는 이점이 있음.

### 5.1 구현 이후 추가된 결정 (2026-08-15)

**가맹점 계정과목 고정 규칙 (마이그 173 `card_store_rules`)** — 사용자 요구: "코레일에서 결제한 건은 전부 여비교통비"처럼 용도가 하나인 매입처는 일괄 지정하고 싶다. 단 이니시스·NHN·쿠팡 같은 전자상거래/PG는 건마다 계정과목이 달라 **자동 일원화 금지**.
- 자동 학습(`card_merchant_links`)과 **분리된 명시 규칙** 테이블. 분류 우선순위는 `store_rule → learned → keyword → rule`.
- 매칭 기준 2종: **사업자번호**(일반) / **상호**(PG 경유 결제라 사업자번호가 결제대행사인 경우 — "OPENAI *CHATGPT SUBSCR" 등).
- 저장 시 **소급 적용**: 매칭되는 기존 매입건을 일괄 갱신하되 **결의서 귀속(doc_id) 건과 excluded 건은 제외**(문서상 확정값 보호).
- 안전장치: PG 업태이거나 같은 사업자번호 아래 상호가 2개 이상이면 경고 + 별도 확인 체크 없이는 저장 불가.
- 규칙 목록·삭제는 부가세 집계 탭 하단 카드. 삭제해도 이미 적용된 분류는 유지(수동 확정과 동일 취급).

**F4 보정 2건 (2026-08-16 실사용 피드백)**
- **VAT 기준 이원화**: 위 §8-3 실측대로 `amountMatch()` 가 공급가액·VAT 포함 두 기준을 모두 본다(exact·sum·partial·overpaid 전부). 미적용 시 모든 정상 수금이 미매칭으로 떨어졌다.
- **이미 입력된 수금과의 대조(`already_collected`)**: 수기로 수금을 입력해 둔 단계도 후보에 실어(최근 18개월) 입금 건과 짝을 맞춘다. 승인해도 **배분액 0 이라 금액이 다시 더해지지 않고** 입금 건만 대조 완료로 닫히며 입금자명은 학습된다. 이 처리가 없으면 수기 입력분이 영구히 "선입금 의심"으로 남는다.

**F4 구현 범위 조정** — "자동대조" 탭은 계약 billing 이 아니라 **재무 보드의 탭**으로 배치했다(원장·수집 로그와 같은 맥락, `finance.view`/`recon.confirm` 가드 일원화). 확정 결과는 기존 milestone 모델에 그대로 반영되므로 billing 화면은 무수정으로 자동 반영된다.

**F5(P4) WSDL 실사 확정 (2026-08-16)** — `testws.baroservice.com/TI.asmx?WSDL` 에서 구조체 요소명·순서를 직접 확인했다(`s:sequence` 라 순서 준수 필수).
- `TaxInvoice` = InvoiceKey · InvoicerParty · InvoiceeParty · BrokerParty · InvoiceeASPEmail · IssueDirection · TaxInvoiceType · TaxType · **TaxCalcType**(문서에 없던 필수 int, 1 사용) · PurposeType · ModifyCode · Kwon · Ho · SerialNum · Cash · ChkBill · Note · Credit · WriteDate · AmountTotal · TaxTotal · TotalAmount · Remark1~3 · TaxInvoiceTradeLineItems.
- `InvoiceParty` = ContactID · CorpNum · **MgtNum** · CorpName · TaxRegID · CEOName · Addr · BizClass · BizType · ContactName · TEL · HP · Email.
- `GetTaxInvoiceState` 응답 = MgtKey · Remark1~2 · BarobillState · InvoiceKey · IsOpened · NTSSendState · NTSSendKey · **NTSSendResult** · NTSSendDT. 오류는 `BarobillState` 에 음수로 실린다.
- `GetTaxInvoicePopUpURL(CERTKEY, CorpNum, MgtKey, ID, PWD)` — PWD 는 빈 문자열.
- soapCall 은 평탄한 파라미터만 지원했으므로 `rawXml()` 마커를 추가해 중첩 구조체를 그대로 넣는다.

**금액 기준 논점(§8-3) 처리** — 계약 단계 금액이 공급가액인지 합계인지 데이터 관례가 확정되지 않아, 발행 모달에서 **"입력 금액 기준"(공급가액 / 합계금액)을 사용자가 고르게** 하고 공급가액·세액·합계를 즉시 보여준다. 국세청에 나가는 값이라 자동 판정하지 않는다.

**P5 구현 (2026-08-16)** — 로드맵 P5 중 3종 구현. 임계값 튜닝 UI 는 확정 데이터가 쌓인 뒤로 미룸(분류 규칙 관리는 가맹점 고정 규칙 카드로 기구현).
- **수정세금계산서**: `RegistModifyTaxInvoice(CERTKEY, CorpNum, Invoice(ModifyCode 포함), OriginalNTSSendKey)` — WSDL 실사로 원본 승인번호가 별도 파라미터임을 확인(Remark1 아님). 재무 세금계산서 탭에 "수정발행" 버튼(국세청 전송완료 + 승인번호 보유 건만) → 사유 6종 선택 모달, 환입(3)·계약해제(4)·이중발급(6)은 음수 발행 자동. milestone 은 자동 갱신하지 않음(수정 유형별 회계 처리가 달라 사용자가 계약 화면에서 확인).
- **업체별 결제주기 학습**: 확정 대조 이력에서 거래처별 평균 (발행일→입금일) 간격 집계(2건 이상만 신뢰) → timingScore 를 "그 업체의 평소 간격과의 편차"로 채점. 어음 업체의 150일 입금은 정상, 즉시 입금 업체의 150일은 이상 신호.
- **홈 위젯 "재무 알림"**(`financeAlerts`, finance.view): 수금 대조 고신뢰/검토 대기 · 이번 분기 미분류 카드 건 · 세금계산서 전송실패 — 각 행이 해당 탭 딥링크.

**발행 담당자 이메일** — 바로빌은 공급자 Email 을 필수로 받는다. `BAROBILL_INVOICER_EMAIL` env 로 기본값을 주되(현재 `kaikan00@koensain.com`), 미설정 시 모달에서 직접 입력한다.

**★발행 시퀀스 실증 (2026-08-16, 테스트베드 자가 발행 1건 — `scripts/barobill-demo/test-tax-invoice.js`)**
| 단계 | 결과 |
|---|---|
| `CheckCERTIsValid` | **1**(인증서 등록 후). 등록 전에는 -31100 — 테스트베드·운영은 **별개 계정이라 각각 등록** 필요 |
| `RegistAndIssueTaxInvoice` | **1 성공**. 위 XML 구조(요소 순서·`TaxCalcType` 포함)가 그대로 통과 |
| `GetTaxInvoiceState` | `BarobillState=3014`(발급완료) · `NTSSendState=1`(전송전) · **`NTSSendKey` 는 발행 즉시 채워짐**(테스트베드는 `2026...8888...` 더미) · `IsOpened=0` |
| `GetTaxInvoicePopUpURL` | 정상(`https://test.barobill.co.kr/interop/?TK=…`) |
| `DeleteTaxInvoice` | **-21003 "삭제 가능한 상태가 아닙니다"** |

⚠ **취소 설계 수정**: `DeleteTaxInvoice` 는 **임시저장(1000) 전용**이다. 즉시발행으로 발급완료된 건은 국세청 전송 전이라도 삭제되지 않으며, WSDL 에 발급 취소 API 자체가 없다(`RegistModifyTaxInvoice`/`ModifyCode` 뿐). → 화면의 "발행 취소"를 걷어내고 **발급분은 수정세금계산서로만 정정**한다고 안내한다(수정세금계산서 발행 UI 는 P5).

---

## 6. 사용자(비개발) 선행 작업 체크리스트

1. **바로빌 개발자센터 가입 + 파트너 등록 → 테스트베드 CERTKEY 확보** (운영 전환 전 무료) — 기존 `scripts/barobill-demo/.env`에 기입하면 즉시 스모크 테스트 가능.
2. 견적 협의(§8-1): 계좌 6 + 활성 카드 N + 매입내역 단가 + 세금계산서 발급 단가.
3. 은행 6곳 빠른조회/간편조회/스피드조회 등록(계좌 등록 전제).
4. 카드사(BC·롯데) 홈페이지 계정 확인 + **BC 회계양식 전체선택 상태 확인**.
5. 법인 공동인증서 바로빌 등록(세금계산서 발행용, 2027-01 만료 주의).
6. 운영 전환 시 결제정보 등록 + 선불 충전.

---

## 7. 안전장치·운영
- 자동확정 없음: 수금 확정·계산서 발행·결재 상신 모두 사람의 명시 액션. 확정·발행·취소는 기존 audit 패턴 기록.
- 발행 실패/이중 발행 방지: `mgt_key` UNIQUE + 발행 API 호출 전 동일 milestone 미완(3014 이전) 건 존재 시 경고. SOAP 타임아웃 시 상태조회로 실제 발행 여부 확인 후 재시도(멱등 확인).
- 수집 결손 감지: `finance_sync_logs` 최근 성공 시각이 48h 초과 시 홈 알림. 바로빌 충전잔액 임계 미만 알림(`GetBalanceCostAmount`).
- 원장 불변: 취소·환불도 행 추가로만. 분류·귀속(doc_id)은 파생 컬럼이라 재계산 안전.
- 민감정보: 은행·카드 자격증명은 바로빌 호스팅 UI 위탁(우리 DB 미저장). CERTKEY는 시크릿. 계좌·카드번호 화면 마스킹 + RBAC.

---

## 8. 결정 필요 논점 (사용자 확인)

1. **견적 확정**: 매입내역(PURCHASE) 카드당 월정액 단가(승인내역과 다를 수 있음), 세금계산서 발급 단가, 계좌 단가 — 바로빌 상담 시 확정. 등록 카드 선별(공용 18장 중 활성 몇 장?)도 비용 직결.
2. **수집 배치 실행 방식**: 권장 = EventBridge Scheduler → `/api/finance/sync`(시크릿 가드). 단 **next 서비스가 야간 정지(평일 22시~08시)라 06시 스케줄이 불가** → (a) 기동 직후 catch-up 자동 실행(권장, 스케줄러 불필요) vs (b) 08시 기동 스케줄 뒤에 08:10 sync 스케줄 추가. 어느 쪽?
3. ~~**계약 금액의 부가세 포함 여부 관례**~~ → **확정(2026-08-16 실측)**: milestone `amount`는 **공급가액(VAT 별도)**이고 실제 입금은 **VAT 포함**이다. 삼척블루파워 준공금 41,468,050 × 1.1 = 45,614,855(기업은행 입금액)로 원 단위 일치, 중도금1 27,531,950도 동일 구조, 계약금액 69,000,000 = 두 단계 공급가액 합. → ①수금 대조는 금액 비교를 **공급가액·VAT 포함 두 기준**으로 시도하고(배분액은 단계 금액=공급가액으로 기록), ②세금계산서 발행 모달은 기본값을 **공급가액 기준**으로 둔다.
4. **세금계산서 발행 권한자**: `taxinvoice.issue`를 누구에게(관리자만? 계약 담당자?).
5. **지출결의서 표에 부가세 분리 표시 여부**: 현행 6열 유지(총액만) 권장 — 공급가액/부가세는 원장·부가세 보드에서만 다루고 결재 문서는 총액. 이견 있으면 열 추가(마이그).
6. (P3 시점) 선행 문서 §11-2 소논점 재확인: sum_nto1 기간 윈도우 4개월·후보 상한 15건 기본값.

---

## 9. 실측으로 검증할 항목 (P0 테스트베드)
- [x] ~~롯데 매입내역 필드 제공률~~ → **롯데 실측(2026-08-15, 113건·약 2개월 소급·등록 후 ~5분 내 초기 수집 완료)**: 사업자번호 95%·업태 95%·과세유형 100%(미제공분은 전부 해외 결제 — OPENAI 등: 사업자·업태 없음·과세 0). **업태가 구체적**("철도"·"한식(한정식)"·"PG(온라인/오프라인)"·"비영리단체(기관)") → 코레일=철도→여비교통비 등 규칙 매핑 실효성 확인.
  - ★**롯데는 `Amount`(공급가액)=0으로 오고 `Tax`(부가세)만 정확** → 공급가액 = ApprovalAmount − Tax **역산 필요**. 해외·면세는 Tax=0.
  - ★**롯데는 `UseDate`=null** → 사용일시는 `ApprovalDT`(날짜만, 시각 000000) 사용.
  - ★**온라인 결제는 가맹점이 PG사로 잡힘**(이니시스·다우데이타, 쏘카도 업태 "PG(오프라인)") → 사업자번호 학습 사전이 PG 단위로 뭉개지는 한계. `StoreName`이 실서비스명("쏘카")인 경우가 있어 **상호 키워드 분류가 PG 건의 주 경로**. PG 사업자번호는 학습 사전에서 제외(오학습 방지).
  - `RefreshNow(CERTKEY, CorpNum, ID, CollectTarget, CardNum)` 즉시 수집 동작 확인(수집 중 -51008 "이미 수집중") — F0 "지금 수집" 버튼에 활용.
- [x] ~~BC(기업은행 법인카드) 재실측~~ → **BC 실측(2026-08-15, 28건·6월 초부터 소급·등록 직후 조회 가능)**: **사업자번호·업태·과세유형·UseDate 전부 100%**. `ApprovalDT`는 초 단위 시각까지 정확, `UseDate`=매입(청구) 일자 — 결의서 "사용일시"는 **`ApprovalDT` 우선**(실사용 시점, 롯데는 날짜만이므로 그대로 사용).
  - **공급가액 0은 BC도 동일** → **공통 규칙 확정: `supply = ApprovalAmount − Tax` 역산**(면세·해외는 Tax=0 → 전액 공급가액·불공제 검토 태그).
  - ★**BC 업태 문자열에 공백 혼입**("주 차 장"·"편 의 점"·"택   시"·"슈퍼 마켓") → 업태 규칙 매칭 전 **공백 제거 정규화 필수**.
  - 업태 구체성 우수: "GS주유소"→차량유지비, "일반한식"·"스넥"→복리후생비, "택시"·"주차장"→여비교통비 등 시드 규칙과 1:1 대응 확인.
- [x] ~~`TransRemark1/2` 입금자명 위치~~ → **국민·기업 실측(2026-08-15): 두 은행 모두 입금자명·출금상대 = `TransRemark1`, `TransRemark2`=이체메모(국민 인터넷이체만 관측)**. CODEF의 은행별 Desc 편차와 달리 바로빌이 R1로 정규화해 주는 것으로 보임(R1·R2 휴리스틱은 안전망으로 유지). `TransType` 실측: 전자금융·타행이체·타행환·인터넷·전화이체·펌이체·FBS출금·지로·공과금·대체출금·BC·CC(이자)·금결원PG출금.
  - ★**전각 문자 혼입**: "（주）영흥산업환경"·"２６０７국민연금"·"국세＿" 등 → `remitter_name_norm` 정규화에 **NFKC(전각→반각) 변환 필수**(기존 normalizeCompanyName 앞단에 추가).
  - ★**상호 truncate 재확인**: "주식회사한국환경안"(잘림)·"(사)한국포장재재활" → 전방/부분일치 매칭 필수(기존 설계대로).
  - ★**계좌 간 잔고이전이 양쪽 원장에 모두 잡힘**(국민 입금 "법인잔고이전" 1,500만 = 기업 출금 "주식회사한국환경안" 1,500만) → 비수금 제외 규칙에 **자사명(한국환경안전연구원 정규형) 매칭 + "법인잔고이전" 키워드** 포함.
- [ ] `Amount/Tax` 분리값 제공률 (미제공 시 총액/1.1 추정 폴백 필요 여부)
- [x] ~~계좌 수집 소급 범위~~ → **최초 신청 시 3개월 전 내역까지 소급 수집, 등록 직후 즉시 완료 실측**(다음 04시 배치 대기 없음). 최초 신청 월 무료·매월 1일 과금/자동연장(등록 화면 안내). 카드 매입내역 소급 범위는 카드 등록 시 별도 확인.
- [ ] 세금계산서 테스트 발행 → 상태 전이(3014→NTS) 시퀀스, `GetTaxInvoicePopUpURL` 동작
- [x] ~~SOAP 반복 요소 태그명~~ → **컨테이너 `BankAccountLogList` > 반복 `BankAccountTransLog`** 실측. SOAP NS = `http://ws.baroservice.com/`(tempuri 아님). leaf 값 XML 엔티티 언이스케이프 필수(`&amp;` — 관리 URL 실사고 발생).

---

_v1 (2026-08-15). 작성 근거: dev.barobill.co.kr 레퍼런스 실사(카드·계좌·세금계산서 API 전 필드), 선행 bank-reconciliation-blueprint v2, 마이그 116(지출 내역 표)·084(전자결재 코어)·004/005(milestone) 코드 실사. 다음: 사용자 CERTKEY 발급 → P0 착수._
