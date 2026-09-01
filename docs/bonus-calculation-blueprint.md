# 성과급 산정 블루프린트 (Bonus Calculation)

> 2026-08-12 초안 → 같은 날 **전 쟁점 확정(최종 구현 계획)**. 근거 자료: `㈜한국환경안전연구원 성과 평가 시스템 개요.hwpx/pdf`(산정 프로세스·계산 예시),
> `성과급 산정 시스템.pdf`(메뉴별 UI 컨셉·기능 요구), `성과급 산정.xlsm`(현행 엑셀 산정 체계·열 구조·수식),
> `25년 하반기 개인별 성과급.xlsx`(개인별 명세 실물).
> 메뉴 개편 완료: `사업참여 수행인력` → **성과급 산정** (`/staffing`), 하위 3메뉴 = 지급 대상 LIST(`/staffing`) ·
> 참여도·평점(`/staffing/evaluations`) · 지급 명세서 생성(`/staffing/statements`).

## 0. 방침 전환 (2026-08-12 사용자 확정 ✔)

기존 확정(2026-06-15)은 "성과급 산정 본체는 **별도앱**(별도 schema `bonus.*`), MCM은 read-only
`/api/bonus-source/*`만 제공"이었다. **별도앱 방침을 철회하고 MCM 내장으로 확정**(사용자 답변).
- 스키마는 별도 schema 대신 기존 관례대로 `infra/aws/NNN_*.sql` 멱등 마이그레이션(public schema)으로 추가.
- 기구현 `/api/bonus-source/*` 4종(read-only)은 내부 lib 함수(`lib/bonus/source.ts`)로 흡수 재사용하고,
  API 라우트 자체는 존치(외부 계약 유지, 비용 없음).

## 1. 산정 모델 (개요 PDF + 엑셀 수식 검증 완료)

### 1.1 프로세스 6단계

1. **용역별 제비용 차감** — 용역별로 외주금액·영업비용을 개별 차감
   (개요 원문의 '도면 비용'은 **삭제 확정** — 도면 담당자 퇴사로 도면팀이 없어졌고, 외주 도면 작성은
   외주금액에 포함시킨다. 사용자 2026-08-12)
   - **외주금액 = 자동 반영**(사용자 확정): 계약 신규/변경계약 입력으로 `contract_outsourcing`에 등록된
     외주용역 건의 금액 합계만 반영. 성과급 화면에서 수동 입력 불가(읽기 전용).
   - **영업비용 = 수동 입력**: 제비용 설정 탭에서 직접 기입.
2. **성과급 지급 총액 산정** — 해당 반기 세금계산서 발행 총액(제비용 차감 후) × 적용비율 3.5~5%(경영 상황 따라)
3. **관련부서·부서장 비율 차감** — 영업/지원부서·임원·부서장 기여 비율만큼 차감
4. **용역별 참여인력 참여도 산정** — 부서장 판단 (%)
5. **참여인력별 평점 산정** — 부서장 판단, A~E 5등급
6. **개인별 성과급 산정** — 참여도·평점 가중치 반영해 최종 지급 목록 산출

### 1.2 산식 (엑셀 수식으로 확정)

용역 c, 반기 r 에 대해 (엑셀 `성과급 대상액 산정(*)` 시트 W~BP열 수식 실측):

```
단계별 제비용 반영액   stageNet(s) = (용역금액 - Σ제비용) × 단계금액(s) / 용역금액   ← 비례 배분
반기 적용금액          applied(c)  = Σ_{반기 내 발행 단계 s} stageNet(s)
용역별 지급대상액      pool(c)     = applied(c) × 적용비율(3.5~5%) × (1 - 기여도합계)
                                     기여도합계 = 지원/영업% + 임원% + 소속본부장%
개인별 성과급          bonus(i)    = Σ_c pool(c) × 참여도(i,c) × 평점가중치(i,c)
```

- 평점 가중치(고정 상수): **A 1.125 / B 1.0625 / C 1.0 / D 0.9375 / E 0.8875**
- 검산(개요 PDF 계산 예시): 가 용역 발행 8,000 − 비용 1,000 = 7,000만 × 4% = 280만 × (1−30%) = **196만**,
  개인 A = 196 × 50% × 1.125 = **110.25만** ✓
- 유관부서/임원 풀: `총 지급대상 기준액 × 지원/영업%` · `× 임원%` → 그 **할당액 한도 내에서** 관리자가
  개별 인원별 수기 배분(합계가 할당액 초과 금지, 미만은 허용).
- 부서장: `해당 본부의 Σpool(c) 산정 전 금액 × 본부장 비율` 이 그대로 확정액 (25H2 실적: 1본부장 13%, 2본부장 15%).
- 보정비율(엑셀 BQ열·"경과기간 반영"): **미채택 — 사용자 확정(무시)**. 산식에서 제외.

### 1.3 대체 산정방식 (지급 명세서 화면의 산정방식 옵션)

**v1은 '기존 산정방식'만 구현**(사용자 확정). 나머지 2종은 옵션 UI에 비활성(disabled)으로만 노출하고
급여 데이터 구축 후 후속(BS-P4)에서 구현한다.

- **기존 산정방식**: §1.2 (기본, v1 유일 동작).
- **인건비 반영 산정**(BS-P4 구현 완료, 2026-08-31 사용자 확정): 매출액에 N% 적용 후
  **참여인력 반기 인건비를 개인별로 차감**한다. 25H2 엑셀 실물이 원형(성과산정액2=급여×1 차감,
  성과산정액3=급여×1.5 차감) — 배수는 화면 입력값(기본 1.0).
  ```
  rate        = salary_apply_rate(미지정 시 apply_rate)
  pool(c)     = applied(c) × rate × (1 − 기여도합계)          ← base 와 동일 구조
  gross(i)    = Σ_c pool(c) × 참여도(i,c) × 평점가중치
  인건비(i)   = 반기(6개월) 급여대장의 통상임금 산입 항목 합계  ← payroll_entry_lines
  bonus(i)    = max(0, gross(i) − 인건비(i) × salary_multiplier)
  ```
  - 차감은 **참여분에만** 적용 — 본부장 산정액·유관부서/임원 수기 배분은 차감하지 않는다.
  - 급여 소스는 **기본급+고정수당만**(payroll_item_defs.in_ordinary_wage=1: 기본급·식대·자격증수당·
    연구수당·업무수당). 성과급·초과근무 등 변동분 제외, 별도 상여대장(ledger_kind='bonus')도 제외.
  - 급여대장에 반기 급여가 없는 인원은 차감 0으로 두고 산정 결과 메시지·개별 명세에 경고를 표시한다.
- **영업이익 기반 산정**(후속): 매출액 대신 영업이익 × 지정 비율. 영업이익은 수기 입력.

## 2. 데이터 소스 매핑 (기존 자산 재사용)

| 요구 데이터 | 기존 자산 | 비고 |
|---|---|---|
| 반기 발행 용역·단계·발행일·발행액 | `contract_payment_milestones`(invoice_issued/issued_at/invoice_amount) + `lib/bonus/source.ts`(listBonusContracts/Milestones) | 발행액 우선, 단계금액 폴백. `deleted_at IS NULL` |
| 용역 분류 | `contracts.service_type`(통합허가/장외&화관법/HAPs/ESG탄소중립/기타) | 연구소는 분류가 아니라 **부서**(`departments.dept_kind='lab'`, carbon-neutral-lab) |
| 본부 | `contracts.owning_dept_id` → `departments` | bonus-source가 이미 owning_dept 미지정 계약 제외 |
| 수행인력·역할(관리자/실무) | `service_participants` | UNIQUE(contract, employee, role_label) |
| **외주금액(제비용)** | `contract_outsourcing`(007, contract_id별 외주 건·amount) | `SUM(amount)` 자동 집계 — 계약 신규/변경 입력에서 등록된 건만, 성과급 화면 수동 입력 불가 |
| 참여도·평점 그릇 | `service_evaluations`(period_year/half, participation_pct, rating, finalized_at) | **A~E 등급 컬럼 신설 필요**(§3) |
| 인력 변동(합류/이탈/역할변경/교체) | `service_participation_changes` + `service_participation_spans` | 참여도 자동 배분 제안·변동 sorting의 근거 |
| 직원·직급·입사일 | `employee_profiles`(hired_at) + `positions`(rank_order) | 근속연수는 hired_at 파생 계산 |
| 조직도 트리 | `OrganizationTree`(embedded/hideHeader/checkbox) + `GET /api/organization` | 명세서 화면 좌측 트리 |
| 전자결재 기안 | `lib/approval/docs.ts` `saveDoc()`/`submitDoc()` | 성과급 기안 프로그래매틱 생성 |
| 권한 | `bonus.view`·`staffing.evaluation.read/write` 권한키(026 시드) + `requirePermission` | 설정·산정·기안은 admin 전용 |

## 3. 신규 DB 스키마 — `infra/aws/150_bonus_calculation.sql` (제안)

```sql
-- 1) 반기 설정 (기여도·적용비율·산정방식·절대평가) : 반기당 1행
bonus_period_settings (
  period_year integer, period_half text('H1'|'H2'),      -- PK
  apply_rate double DEFAULT 4.0,                          -- 매출액 중 적용 비율(%)
  contrib_support_pct double DEFAULT 0,                   -- 지원/영업 기여도(%)
  contrib_exec_pct double DEFAULT 0,                      -- 임원 기여도(%)
  dept_head_rates_json jsonb DEFAULT '{}',                -- 본부장 비율 {dept_id: pct} (1·2본부장/화학본부장… 가변)
  calc_method text DEFAULT 'base',                        -- 'base'|'salary'|'profit'
  salary_apply_rate double, profit_apply_rate double,     -- 대체 산정방식 비율
  operating_profit double,                                -- 영업이익 기반 산정용 수기 입력
  absolute_grading integer DEFAULT 0,                     -- 절대평가 옵션 on/off
  grade_cap_json jsonb DEFAULT '{}',                      -- {A:15, B:20, ...} 등급별 최대 비율(%)
  status text DEFAULT 'draft',                            -- 'draft'|'finalized'
  updated_by, updated_at, finalized_at
)

-- 2) 용역별 제비용 (계약 단위 — 영업비용만 저장. 외주금액은 저장하지 않고
--    contract_outsourcing(007)에서 SUM(amount) 실시간 집계 — 사용자 확정: 수동 입력 불가)
bonus_contract_costs (
  contract_id PK → contracts,
  sales_cost_amount double DEFAULT 0,    -- 영업비용 (수동 입력)
  updated_by, updated_at
)   -- ※ 엑셀 BQ열 보정비율(경과기간 반영)은 미채택(사용자 확정: 무시)
    -- ※ '도면작성' 항목 폐지 — 외주 도면 작성은 계약의 외주용역 건으로 등록

-- 3) service_evaluations 확장 (기존 rating 0~5는 존치, 신규 A~E 등급 병행)
ALTER TABLE service_evaluations ADD COLUMN IF NOT EXISTS grade text;   -- 'A'~'E'

-- 4) 산정 결과 스냅샷 (일괄산정 시 생성/재생성)
bonus_statements (
  statement_id PK, period_year, period_half,
  employee_id → employee_profiles,
  bucket text,               -- 'participant'|'dept_head'|'support'|'exec'
  total_amount double,       -- 금기 성과급
  prev_amount double,        -- 전기 성과급 (직전 반기 statements 조회 or 임포트)
  calc_method text, meta_json jsonb,   -- 산정 파라미터 스냅샷(적용비율·기여도·급여차감 등)
  calculated_by, calculated_at,
  UNIQUE(period_year, period_half, employee_id)
)
bonus_statement_lines (
  line_id PK, statement_id → bonus_statements,
  contract_id, applied_amount,          -- 제비용 반영 반기 발행액
  participation_pct, grade, grade_weight, amount
)

-- 5) 유관부서/임원 개별 수기 배분 (할당액 한도 내)
bonus_manual_allocations (
  period_year, period_half, employee_id, bucket('support'|'exec'),
  amount double, updated_by, updated_at,
  UNIQUE(period_year, period_half, employee_id)
)

-- 6) 반기 급여 그릇: 신설하지 않음(2026-08-31). 급여대장(155 payroll_ledgers/entries/entry_lines)이
--    이미 구축돼 lib/bonus/salary.ts 가 직접 집계한다 — 중복 그릇 방지.
--    infra/aws/211_bonus_salary_method.sql: bonus_period_settings 에
--      salary_multiplier double precision DEFAULT 1.0   -- 인건비 차감 배수(엑셀 ×1 / ×1.5)
--      plan_doc_id text                                 -- 성과급 기안 문서(명세서 발송 게이트)
```

## 4. 화면 ① 지급 대상 LIST (`/staffing`)

레이아웃: 좌측 설정 사이드바 + 우측 탭 2개(대상 LIST / 제비용 설정). 우상단 대상 반기 셀렉트(연도+상/하반기).
cdash 관례(`cd-card`·`cd-fields-white`·`CdPageHeader title/meta/actions/tabs`).

### 좌측 사이드바
- **용역 분류 버튼 4개**: 통합허가 / 화관법 / HAPs / 연구소 — 단일 선택(라디오형), 탭 데이터 필터.
  '기타' 버튼은 만들지 않는다(사용자 확정): 엑셀의 '기타' 시트는 용역별 수행인력 정보를 못 넣던 시절의
  우회였고, MCM은 계약마다 수행부서·수행인력이 있으므로 기타 용역도 수행 본부 쪽 버튼에 귀속시킨다.
  - **귀속 규칙**: ① 연구소 버튼 = `owning_dept.dept_kind='lab'` (service_type 무관, 최우선).
    ② 그 외에서 `service_type`이 통합허가/장외&화관법/HAPs면 해당 버튼.
    ③ 나머지(기타·ESG탄소중립 등)는 **수행부서로 귀속**: 통합환경1/2본부·울산지사 → 통합허가 버튼,
    화학안전본부 → 화관법 버튼. (귀속 매핑은 dept_id 기반 상수 1곳으로 관리, 하드코딩 분산 금지)
- **연관부서/인원 기여도**: 지원/영업 % · 임원 % · 본부장별 %(1본부장/2본부장/화학본부장 — departments에서
  본부(dept_kind='division' 상당)를 동적 나열, 하드코딩 금지).
- **매출액 중 적용 비율** %(기본 4, 범위 3.5~5 안내).
- 저장 / 초기화 버튼 → `bonus_period_settings` upsert. **admin 전용 표시·편집**.

### 대상 LIST 탭
해당 반기 세금계산서 발행 실적이 있는 용역 전체(선택 분류). 열(엑셀 '성과급 대상액 산정' 시트 준거):
**용역명 · 발주처 · 계약일 · 단계별 금액(선급금/중도금1~N/준공금) · 단계별 금액(제비용 반영) · 발행일자 · 본부**.
- 단계 열은 데이터 최대 단계수에 맞춰 동적 생성(중도금1~7 고정 아님). 반기 내 발행 단계는 강조(cd-tint-primary).
- 제비용 반영액은 §1.2 비례 산식으로 서버 계산(읽기 전용).
- 우하단 고정 푸터: **총 지급대상 기준액 = Σ applied(c) × 적용비율** (설정 저장값 반영 즉시 재계산).

### 제비용 설정 탭
열: 용역명 · 발주처 · 계약일 · 단계별 금액 · **외주금액(자동, 읽기 전용)** · **영업비용(수동 입력)**.
(UI 컨셉 원문의 '도면작성' 항목은 폐지 확정 — 외주 도면 작성은 계약의 외주용역 건으로 등록)
- **외주금액**: `contract_outsourcing` SUM(amount) 자동 집계 표시. 수정하려면 계약 신규/변경계약 입력에서
  외주용역 건을 등록·수정해야 함 — 셀에 안내 툴팁 + 계약 상세 바로가기 링크 제공.
- **영업비용**: 행 인라인 편집 + 일괄 저장 → `bonus_contract_costs` upsert. 수정 이력은 updated_by/at로 기록.

### API (신규)
- `GET /api/bonus/targets?period=YYYY-H1&category=...` — 대상 리스트(단계·발행일·제비용 반영액 포함)
- `GET/PUT /api/bonus/settings?period=` — 반기 설정 (admin)
- `PUT /api/bonus/costs` — 제비용 일괄 저장

## 5. 화면 ② 참여도·평점 (`/staffing/evaluations` 전면 개편)

레이아웃: 좌측 필터 사이드바 + 우측 탭 2개(참여도 / 평점). 우상단 대상 반기.
기존 0~5 평점 화면은 이 화면으로 **대체**(테이블은 `service_evaluations` 계속 사용, grade 컬럼 신설).

### 참여도 탭
행=성과급 대상 용역(반기 발행 존재). 열: 용역명 · 발주처 · 계약일 · 본부 · 관리자(부서장) ·
참여자N · 참여비율N (**동적 열** — 확정) · **적용대상액**(발행액−제비용, 읽기 전용).
- 참여자 = `service_participants`(role_label≠'관리자'), 관리자 열은 role_label='관리자'.
- **참여자 열은 동적 확장**(사용자 확정): 기본 4슬롯 폭으로 표시하되, 화면 내 최대 참여 인원수에 맞춰
  열을 생성(5인 이상 대형 용역 대응). 가로 스크롤 허용.
- 참여비율 입력(%). 합계 100% 검증(경고).
- **부서장이 입력**: `staffing.evaluation.write`(self_dept) + admin.

### 평점 탭
동일 행 구조, 열: … 참여자N · **평점N(A~E 셀렉트, 동적 열)** · 적용대상액.
- 가중치는 화면에 안내(1.125/1.0625/1/0.9375/0.8875).

### 좌측 사이드바
- **인력 변동 sorting**: 합류/이탈/역할 변경/교체 4버튼 — `service_participation_changes`의 반기 내
  change_kind 존재 용역만 필터(다중 토글).
- **절대평가 옵션**: 체크박스 + 등급별 최대 비율 입력(평점:A~E %). **admin 전용**.
  활성 시 저장 단계에서 등급 분포 상한 검증(전체 평점 부여 건수 대비) — **초과 시 저장 차단**(확정):
  서버 검증 + 화면에 등급별 현재 사용률/상한 게이지 표시로 입력 중 초과를 미리 인지시킨다.

### 인력 변동 반영 참여도 자동 제안
갑:을=6:4 진행 중 을이 3월 말 퇴사, 병이 승계한 경우 → 기간 가중으로 **6:2:2 자동 제안**
(퇴사자: 재직 기간분만 인정, 승계자: 본인 참여 기간분만 인정). `service_participation_spans`
(span_from/to × participation_pct)로 기간 가중 평균 계산 → "자동 배분 제안" 버튼으로 슬롯에 채움,
**부서장이 재조정 가능**(제안값은 강제 아님).

### API
- `GET /api/bonus/evaluations?period=&category=&changeKinds=` — 보드(참여자 슬롯·적용대상액·변동 태그)
- `PUT /api/bonus/evaluations` — 참여도/등급 일괄 저장(절대평가 검증 포함)
- `POST /api/bonus/evaluations/suggest` — 기간 가중 자동 배분 제안(계약 단위)

## 6. 화면 ③ 지급 명세서 생성 (`/staffing/statements`)

레이아웃: 좌측(조직도 트리 + 산정방식 옵션 + 비율 조정) + 우측 탭 2개(참여인력 성과 명세 / 유관부서·인력 명세).
우하단 **일괄산정** 버튼, 좌하단 저장/초기화, 하단 **성과급 기안** 버튼.

### 좌측
- **조직도 트리**(`OrganizationTree` embedded 재사용): 성과급 상세 산정 대상 = 통합환경1/2본부·화학안전본부·
  연구소·울산지사 인원. 연구소장(임원급) 제외는 **positions.rank_order 기준 임원 컷오프**로 규칙화(확정 —
  특정 인물 하드코딩 금지). 총괄(대표·총괄본부장)·영업관리본부는 유관부서/인력 명세 쪽에서만 취급.
- **산정방식 옵션**(체크박스 3종, §1.3 — '기존 산정방식'·'인건비 반영 산정' 활성, 영업이익은 disabled) +
  **비율 조정**: 인건비 반영 시 매출액 중 적용 비율 %, 인건비 차감 배수(1.0/1.5). 저장은 같은 카드의
  [산정방식 저장] → `PUT /api/bonus/settings`(calc_method·salary_apply_rate·salary_multiplier).
  **admin 전용 표시**, 반영은 일괄산정 재실행 시. 좌측 사이드바 폭은 332px.

### 참여인력 성과 명세 탭
- **전체 토글**: 반기 산정 리스트. 열: 성명 · 소속 · 직함 · 근속연수(hired_at 파생) ·
  **전기 성과급** · **금기 성과급** · **성과급 변동율**. (전기=직전 반기 bonus_statements, 최초는 25H2 임포트 §8)
- **개별 토글**: 트리에서 선택한 인원의 용역별 산정 내역. 열: 용역명 · 발주처 · 계약일 · 제비용 반영액 ·
  참여도 · 평점 · 성과급 산정액 (`bonus_statement_lines`).

### 유관부서/인력 명세 탭
- 상단: **영업/지원부서 할당액**(기준액×지원/영업%) · **임원 할당액**(기준액×임원%) 표시.
- 하단: 영업/지원 부서 인원 리스트 + 임원 리스트 — 인원별 성과급 수기 부여(`bonus_manual_allocations`).
  **버킷별 합계 ≤ 할당액 검증(초과 차단, 미만 허용)**.
- **부서장**: 본부장 비율로 산정된 금액이 그대로 확정 표시(수기 조정 없음).

### 일괄산정 (산정 엔진)
`POST /api/bonus/calculate?period=` (admin): 설정+제비용+참여도/평점 로드 → §1.2 산식으로
전 인원 산정 → `bonus_statements`/`bonus_statement_lines` 반기 단위 재생성(스냅샷).
급여 차감·영업이익 방식은 calc_method에 따라 분기. 산정 파라미터는 meta_json에 동결.
- **덮어쓰기 가드(2026-08-31)**: 반기 스냅샷 전량 재생성이라 근거 없이 실행하면 기존 명세가 사라진다.
  ① 엑셀 임포트 스냅샷(`meta_json.source`, 예: 25H2 `excel-25h2`)이 있는 반기,
  ② 참여도·평점이 0건인데 기존 명세는 있는 반기 → 409 + `needsForce`, 화면 확인(confirm) 후에만 진행.

### 성과급 기안 (전자결재 연동)
- 버튼 → 성과급 지급 계획서 1장: 전 인원 표(성명/부서/직함/지급대상액) + 하단 합계.
- `saveDoc()`으로 기안 생성(양식 신규 1종 필요 — 필드 최소, 표는 fieldValues jsonb), 결재선 =
  **대표이사 직결**(다른 결재선 불필요). 기안 권한 admin(관리자). 생성 후 결재 메뉴로 이동 링크.
- 생성 문서는 `bonus_period_settings.plan_doc_id` 에 물리고, 화면 헤더에 기안 상태 배지+문서 링크를 표시.
- **발송 게이트(2026-08-31 사용자 확정)**: 기안이 `approved` 가 되기 전에는 명세서를 발송할 수 없다 —
  서버(`lib/bonus/send.ts` 진입 가드) + 화면(일괄/개별/행별 발송 버튼 비활성 + 사유 툴팁). PDF 미리보기는 허용.

### 지급 명세서 (개인별) — 발송 채널 확정(사용자)
- 참여인력: 용역별 산정액 리스트(용역명+계산서 발행일, 용역별 산정액만 — **참여도·평점 미표시**).
- 부서장: 해당 반기 부서 총 제비용 반영액 · 부서장 비율 · 산정 성과급.
- 영업/지원·임원: 발송 불필요.
- **개별 발송**: 참여인력 성과 명세의 '개별' 토글에서 선택한 인원은 일괄 발송 버튼과 같은 자리의
  [OOO 명세서 발송] 버튼으로 단건 발송한다(전체 토글의 행별 [발송]과 동일 API).
- **발송 = 이메일 + PDF 첨부**: pdf-lib 전용 렌더러(관례: roster-pdf/certificate-pdf 패턴, malgun.ttf) +
  기존 SES 발송 인프라(`lib/mail`, 첨부는 mime.ts RFC2231 인코딩 주의). 수신 주소 = employee_profiles.email.
  발송 이력 기록(발송일시·수신자) 및 재발송 버튼.
- **홈 위젯 카드(신규)**: 본인 반기별 성과급 지급내역 확인 카드 — 로그인 user → employee 매핑으로
  `bonus_statements` 본인 건 조회(반기 셀렉트+금액·용역별 내역 요약). 홈 대시보드 위젯 관례를 따름.

## 7. 권한 정리

| 기능 | 권한 |
|---|---|
| 화면 열람 | `bonus.view` (fallback editor) |
| 기여도·적용비율·제비용·절대평가·산정방식·일괄산정·기안·유관부서 배분 | **admin 전용** (UI 비노출 + 서버 requireAdmin) |
| 참여도·평점 입력 | `staffing.evaluation.write` scope self_dept(부서장) + admin |
| 명세 열람(개인) | 홈 위젯 = 본인 statements만(로그인 user→employee 매핑, 서버에서 강제) + 이메일 명세서 |

## 8. 초기 데이터 · 마이그레이션 작업

- **25H2 전기 성과급 임포트**: `25년 하반기 개인별 성과급.xlsx` → `bonus_statements(2025,H2)` 1회성
  스크립트(`scripts/import_bonus_2025h2.py`, openpyxl+psycopg 관례). 26H1 화면의 "전기 성과급" 열 근거.
- **제비용 백필**(계약명 매칭, 기존 `scripts/migrate_staffing_from_excel.py` 매칭 패턴 재사용):
  - V열(영업비용) → `bonus_contract_costs.sales_cost_amount`.
  - **T(외주)+U(도면작성) 합산 → `contract_outsourcing` 건 생성**(외주금액은 이 테이블에서만 오므로,
    `source='bonus_excel_backfill'`·title '외주비용(성과급 엑셀 이관)'로 1건 적재). 해당 계약에 이미
    등록된 외주 건이 있으면 **금액 대조 후 스킵/보정**(중복 계상 방지 — 백필 리포트로 확인).
- 도면팀 별도 산정: **제외 확정** — 도면 담당자 퇴사로 도면팀이 없어짐. 외주 도면 작성은 외주금액 항목으로
  흡수. (25H2 실물의 도면팀 시트는 임포트 시 통상 statements로 취급하지 않고 스킵)

## 9. 결정 사항

### 확정 (2026-08-12 사용자 답변)
- ✔ **분류 버튼 4개 유지, '기타' 버튼 없음** — 기타/ESG 용역은 수행부서 기준으로 4버튼에 귀속(§4 귀속 규칙).
- ✔ **MCM 내장**(별도앱 철회), public schema NNN 마이그레이션.
- ✔ **명세서 = 이메일 발송 + PDF 첨부** + **홈 위젯 카드**(본인 반기별 지급내역 확인).
- ✔ **v1은 기존 산정방식만** — 인건비/영업이익 방식은 급여 데이터 구축 후 후속(옵션 UI는 disabled 노출).
- ✔ **보정비율(엑셀 BQ열) 무시** — 산식·스키마에서 제외.

### 확정 3차 (2026-08-31 사용자 답변 — 인건비 반영 산정 BS-P4)
- ✔ **차감 지점 = 개인별** — 전사 총액 일괄 차감이 아니라 개인별 산정액에서 본인 인건비를 뺀다(음수는 0).
- ✔ **차감 배수는 입력 항목** — 비율 조정 카드에 노출(기본 1.0, 엑셀 성과산정액3은 1.5).
- ✔ **급여 소스 = 기본급+고정수당만**(통상임금 산입 항목) — 성과급·초과근무 등 변동분 제외.
- ✔ **급여 그릇 신설 없음** — 급여대장(155)을 직접 집계(§3-6).
- ✔ **명세서 발송은 성과급 기안 승인 후에만** 가능(서버 가드 + 버튼 비활성).
- ✔ **개별 탭 단건 발송 버튼** — 일괄 발송 버튼과 동일 위치.

### 확정 2차 (2026-08-12 사용자 답변 — 전 쟁점 종결)
- ✔ **참여자 열 동적 확장** — 4슬롯 고정 아님, 5인 이상 대형 용역 대응(향후 대형 수주 대비).
- ✔ **절대평가 위반 = 저장 차단** (서버 검증 + 등급별 사용률 게이지).
- ✔ **임원 컷오프 규칙 일반화** — 연구소장 제외를 positions.rank_order 기준으로, 인물 하드코딩 금지.
  총괄·영업관리본부는 유관부서/임원 명세로만.
- ✔ **도면팀 산정 제외 + '도면작성' 제비용 항목 폐지** — 도면 담당자 퇴사로 도면팀 소멸, 외주 도면 작성은
  외주금액으로 통일. 제비용 = 외주금액·영업비용 2항목.
- ✔ **외주금액 = 자동 반영 전용** — 계약 신규/변경계약 입력으로 `contract_outsourcing`에 등록된 외주용역
  건만 집계(성과급 화면 수동 입력 불가). **영업비용만 수동 입력**.
- ✔ **기존 0~5 평점 화면 완전 대체** — 새 A~E 체계 화면으로 교체(0~5 rating 컬럼은 사장,
  participation_pct는 계속 사용 — 시맨틱 분석 연계 영향 없음).

## 10. 구현 페이즈 (확정 후 착수)

| 페이즈 | 내용 | 산출물 |
|---|---|---|
| **BS-P0** | 마이그 150 + 지급 대상 LIST 화면(대상 LIST/제비용 설정 탭, 분류 필터, 설정 사이드바, 총 기준액) + 제비용 백필 | `/staffing` 실기능 |
| **BS-P1** | 참여도·평점 개편(참여자 슬롯·A~E·적용대상액, 인력 변동 sorting, 자동 배분 제안, 절대평가) | `/staffing/evaluations` 개편 |
| **BS-P2** | 산정 엔진 + 지급 명세서 화면(전체/개별, 유관부서 배분, 산정방식 옵션, 일괄산정) + 25H2 임포트 | `/staffing/statements` 실기능 |
| **BS-P3** | 성과급 기안(전자결재 양식+saveDoc 연동) + 지급 명세서 PDF·이메일 발송 + 홈 위젯 카드 | 기안·명세서·위젯 |
| **BS-P4** | 인건비 반영 산정(§1.3) — 마이그 211 + `lib/bonus/salary.ts` + 산정 엔진 분기 + 산정방식/비율 UI + 명세서 발송 게이트·개별 발송 | 완료(2026-08-31) |
| **BS-P5** | (후속) 영업이익 기반 산정 — 영업이익 수기 입력 후 착수 | 후속 |

각 페이즈 완료 시 `npx tsc --noEmit`(수정 파일 필터) + 사용자 dev 확인, staging 마이그레이션·배포는 사용자 확인 후.
