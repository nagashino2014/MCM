# 결재 양식 ↔ 마스터 데이터 연계 전수조사·개선 계획 (2026-10-21)

작성: 2026-10-21. 상태: **조사 완료 · 계획 초안(결정 D-1~D-6 대기)**.
대상 화면: `/approval/semantics` 데이터 관계 맵(SW-P1, [semantic-analytics-wizard-blueprint.md](semantic-analytics-wizard-blueprint.md) §4-2·§4-4).
근거: 스테이징 DB 읽기 전용 실측(`approval_forms` 24종 최신 정의·`approval_docs`·원장 행 수, 2026-10-21) + 코드 조사.
양식 정의는 빌더 편집분이 마이그레이션에 남지 않으므로 **DB 값을 기준**으로 했다.

---

## 1. 결론 요약

1. **관계 맵은 실제 연계를 거의 보여주지 못하고, 보여주는 연결도 실속이 없다.**
   - 맵의 엣지 9개는 모두 문서 단위 필드 타입 4종(`contract_select`·`company_select`·`user_select`·`dept_select`)에서만 나온다(`lib/approval/semantics.ts` `refFieldsOf`).
   - 제출 문서가 있는 유일한 엣지인 **초과근무 58건은 계약 연결 0건, 업체 연결 0건이고 58건 모두 직접 입력**이다. 이 58건은 다우오피스에서 이관한 문서(2026-04-27~05-23)이며, 용역명 31종 중 계약명과 정확히 일치하는 것은 2종뿐이다.
2. **반대로, 이미 있는데 맵이 못 보는 연계가 훨씬 많다.**
   - 이미 ID를 저장하는 참조 타입인데 맵이 세지 않는 것: `asset_select`(차량), `contact_select`(업체 담당자), `leave_type`, 표 열 `people`(동행자·발령 대상자), 표 열 `related`(지출 행의 연관 용역·사업장).
   - 전용 화면 양식 4종(견적·공문·계약서·내부고시)은 값 안에 facilityId·contractId를 가지고 있다. 그런데 양식 `fields`에는 표시용 text만 선언돼 있다.
   - **승인 후 결재 문서 id를 기록하는 원장이 20종 넘게 있다**: 연차 대장, 카드 승인내역, 영수증, 전표, 증명서 발급, 근로계약, 상여대장, 소득 대장, 운행일지 등. 맵에는 이 방향의 선이 아예 없다.
3. **"유휴" 시스템 소스 4종은 연결 키가 없어서 고립돼 있다.** 시스템 소스는 `employeeId`나 `contractId`로만 결합된다. 그런데 대부분의 양식에는 해당 필드가 없다. 지표 엔진은 문서의 `drafter_employee_id`·`dept_id`도 쓰지 않는다(`metric-engine.ts:195`). 그래서 휴가신청서와 연차 대장, 초과근무 신청과 ADT 근태처럼 당연히 이어져야 할 쌍조차 지표로 결합할 수 없다.
4. **경비 정책(§4-4)의 핵심 동기인 "용역별 경비 → 마진율"이 아직 구조적으로 막혀 있다.** 지출 행마다 `related` 열로 용역·사업장 ID를 받지만, 지표 엔진은 표 행 메타(`_relatedContractId`)를 읽지 않는다. 또 기성(세금계산서)·외주비 원장이 시스템 소스에 없어서 마진율의 분자를 만들 수 없다.
5. **지금이 바로잡을 적기다.** 제출 문서 83건 가운데 초과근무 58건(이관분), 공문 13건, 견적 5건을 빼면 18개 양식은 제출이 0~2건이다. 법인카드 승인내역 850건, 전표 881건도 결재 문서와 연결된 건이 0건이다(지출결의 운영 전). 양식 구조를 지금 고치면 소급 보정 비용이 거의 들지 않는다.

---

## 2. 양식별 전수표 (24종)

표기
- **맵**: 현재 관계 맵에 나오는 엣지
- **숨은 참조**: ID를 저장하지만 맵에 안 잡히는 참조
- **자유입력→마스터**: 마스터를 가리키는데 text·select로 받는 필드
- **승인 후 기록**: 결재 완료 시 문서 id를 기록하는 원장
- 제출 = draft를 제외한 문서 수

| # | 양식 (form_id) | 제출 | 맵 | 숨은 참조 | 자유입력→마스터 | 승인 후 기록 | 조치 |
|---|---|---|---|---|---|---|---|
| 1 | 초과/휴일근무 신청 (`frm-overtime-request` v10) | 58 | 계약·업체 (**연결률 0%**) | 같은 날 원 신청서 `ref_doc_id` 자동 연결 | — (기사용·잔여 시간은 `attendance_weekly` + 신청 합으로 이미 자동 채움, `overtime.ts:146`) | 승인 훅 없음. 급여가 승인 문서를 읽어 `attendance_daily`와 대조(`payroll/overtime.ts:326`) → `overtime_match_overrides`, 대체휴가 `special_leave_ledger` | 58건 소급 연결(L2), 기안자–ADT 결합(L3) |
| 2 | 국내 출장 신청 (`frm-biz-trip-request` v10) | 1 | 업체·계약·직원 | `car_name` asset_select | `contract_class`(용역분류: 계약의 파생값) | `vehicle_trip_logs.doc_id`, 할 일 후속 | 자산 엣지 승격, 분류를 계약에서 자동 채움 |
| 3 | 출장보고서 (`frm-biz-trip-report` v15) | 0 | 업체·계약 | `receiver` contact_select, 일정 `companions` people, 지출 `related` | 일정 `place`(방문지) | 카드·영수증 `doc_id`, 전표 | 표 열 엣지 집계, 방문지는 업체 검색 검토, 선행 출장신청 `ref_doc_id` 사용 |
| 4 | 지출 결의서(법인카드) (`frm-expense-report` v6) | 0 | **없음** | 행 `related`·`_cardTxnId` | `vendor`(카드 가맹점에서 자동 입력) | `card_transactions.doc_id`·`journal_entries.doc_id` | 행 단위 용역 귀속을 엔진에 반영(L3 핵심) |
| 5 | 지출 결의서(개인) (`frm-expense-personal` v3) | 0 | 없음 | 행 `related`·`_receiptId` | `vendor` | `personal_receipts.doc_id`·`expense_settlement_items` | 4와 같음 |
| 6 | 구매품의서 (`frm-purchase-request` v3) | 0 | 없음 | — | `item_name`(비품이면 자산) | 후행 지출결의의 선행 문서 | 관련 용역(선택)·부서 추가, 예산(`budget_lines`) 대조 |
| 7 | 휴가신청서 (`frm-leave-request` v4) | 2 | 없음 | `leave_type` → `leave_types` | — | `annual_leave_ledger.doc_id`·`special_leave_ledger` | 휴가 종류 엣지 승격, `use_days` 오태깅 수정(일수인데 `quantity.hours`) |
| 8 | 결근사유서 (`frm-absence-statement`) | 0 | 없음 | — | — | `absence_statement_requests.doc_id` | 기간 태깅, 근태(일별) 결합 |
| 9 | 휴직원 (`frm-leave-absence`) | 0 | 없음 | — | — | `employee_hr_events`(note 문자열에만 문서 번호) | 기간 태깅, 인사 이력에 doc_id 컬럼 추가 |
| 10 | 퇴직원 (`frm-resignation`) | 0 | 직원(인수인계자) | — | — | `employee_hr_events`, 계정 비활성화 | 인사 이력 doc_id |
| 11 | 인사 발령 (`frm-hr-appointment`) | 0 | 없음 | 표 `person` people | **`to_dept`·`new_position` text(코드가 이름 문자열로 맞춰 봄)** | `employee_hr_events`·`employee_dept_posts` | 부서·직급 선택 열 타입 신설(L1) |
| 12 | 연차수당 지급 신청서 (`frm-annual-leave-pay`) | 0 | 직원 | — | `remaining_days`(연차 대장 값), `daily_wage`(근로계약 값) 수기 입력 | `severance_settlements.leave_pay_doc_id` | 대장·근로계약에서 자동 채움 |
| 13 | 상여금 지급 계획 (`frm-bonus-payment-plan`) | 0 | 없음 | — | **표 `emp_no`·`name`·`dept`·`position` text(사번·이름으로 매칭)** | `payroll_ledgers.plan_doc_id` | 행에 `_employeeId` 메타 주입 |
| 14 | 성과급 지급 계획 (`frm-bonus-plan` v2) | 0 | 없음 | — | 표 `name`·`dept`·`position` text, `period` text | `bonus_period_settings.plan_doc_id` | 자동 생성 시 `_employeeId` 주입 |
| 15 | 근로계약서 갱신 계획 (`frm-labor-contract`) | 0 | 없음 | — | 표 `name`·`dept`·`position` text, `baseDate` 날짜를 text로 받음 | `labor_contracts`·`labor_contract_rounds.approval_doc_id` | 14와 같음, 날짜 타입 교정 |
| 16 | 증명신청서 (`frm-certificate-request`) | 2 | 없음 | — | `target_year` 연도를 text로 받음 | `certificate_issues.doc_id` | 원장 엣지 표시 |
| 17 | 교육훈련 신청 (`frm-education-request` v2) | 0 | 없음 | — | `edu_org`(교육기관) | 없음(교육 이력 원장 자체가 없음) | D-4: 교육 이력 원장 신설 여부 |
| 18 | 교육훈련 보고 (`frm-education-report` v2) | 0 | 없음 | — | 17과 같음 | 없음 | 선행 신청 `ref_doc_id` |
| 19 | 전문가활용비 지급 신청서 (`frm-expert-fee`) | 0 | 없음 | — | **`payee_name`·`payee_rrn`·`bank_info` text(매번 다시 입력)** | `income_payment_ledger.doc_id` | 관련 용역(외주 원가) 추가, 외부 소득자 마스터 검토(D-4), 주민번호 보관 방식 점검 |
| 20 | 업무기안 (`frm-work-proposal`) | 0 | 없음 | — | — (`budget` 미태깅) | 없음 | 관련 용역·부서(선택) 추가 |
| 21 | 견적서 (`frm-quotation`) | 5 | 없음 | 값 안에 수신처·사업장 facilityId, contractId | (표시용 text 필드만 선언) | `quotations.doc_id` (contract_id 0/5) | 전용 양식 연결 판정을 도메인 테이블로 수행 |
| 22 | 공문 (`frm-official-letter`) | 13 | 없음 | 수신처 facilityId·contactId | 〃 | `official_letters.doc_id`, `contract_deliverables.letter_doc_id` | 〃 |
| 23 | 계약서(초안 검토) (`frm-agreement`) | 1 | 없음 | 발주처 facilityId, contractId(null) | 〃 | `contract_agreements.doc_id` (contract_id 0/1) | 〃, 계약 등록 후 contract_id 역기입 |
| 24 | 내부고시 (`frm-internal-notice`) | 1 | 없음 | — | 수신·발신 text | `rule_amendments.approval_doc_id`(규정 개정 시) | 연계 불필요(공지성). 맵에서 "연계 대상 아님"으로 분류 |

**승인 처리 구조(맵에 안 보이는 쓰기 경로)**
- 상신·저장할 때: 카드·영수증·쇼핑몰 전표에 doc_id를 귀속하거나 해제한다(`app/api/approval/docs/route.ts:93-117`). 같은 시점에 한도·식대·선행 문서 판정을 스냅샷으로 저장한다(`docs.ts:771-776`).
- 최종 승인 시 하드코딩 훅 4개(`docs.ts:805-815`)가 실행된다: 휴가 → 연차 대장, 공문, 견적, 계약서.
- 같은 시점에 DB로 배선한 커넥터 9종(`actions.ts:484-494`, `approval_form_actions`)이 실행된다: 인사 3, 증명서, 소득 대장, 연차수당 정산, 상여대장, 결근 요청 마감, 할 일 후속.
- **훅이 아니라, 승인된 문서를 나중에 읽어 가는 파생 6곳**이 있다: 경비정산, 전표, 급여 초과근무 대조, 숙박수당, 운행기록, 캘린더·할 일. 이 경로는 원장에 doc_id가 남지 않을 수 있다.
- 반려 트리거에 배선된 커넥터는 0건이다.
- 인사 이력(`employee_hr_events`)에는 doc_id 컬럼이 없다. 문서 번호를 note 문자열에 넣고 LIKE로 중복을 판정한다.
- `special_leave_ledger.doc_id`·`rule_amendments.approval_doc_id`는 컬럼만 있고 코드가 쓰지 않는다(`ref_key`를 사용).

**정리**
- 입력 단계 참조가 정상인 양식은 2·3번 정도뿐이다.
- 승인 후 기록은 이미 17종에 구현돼 있다. 문제는 연계 자체가 없는 게 아니라 **보이지 않고 지표에서 결합되지 않는 것**이다.
- 실제로 연계가 빈 곳은 세 군데다.
  - HR 표 계열 5종(11·13·14·15·12): 이름 문자열로 매칭한다.
  - 원가 귀속 필드가 없는 양식 4종(6·17·19·20).
  - 이관 데이터(1).

---

## 3. 데이터 소스 — 현재 7종 + 추가 후보

### 3-1. 현재 7종의 상태

| 소스 | 행 | 결재와 결합 가능한 키 | 문제 |
|---|---|---|---|
| 계약(용역) — 마스터 | 1,254 (진행·2026 종료 130) | contractId | 초과근무 이관분 0% 연결. `owning_dept_id` 348/1,254만 채워짐 |
| 업체(사업장) — 마스터 | 2,072 | facilityId | facilityId를 차원으로 가진 시스템 소스가 없음. `contracts.counterparty_facility_id` 미노출 |
| 직원 — 마스터 | 41 | employeeId | 엔진이 기안자를 쓰지 않음. user_select가 없는 양식은 결합 불가 |
| system.contracts | 1,259 | contractId | 기성·세금계산서가 설명에는 있지만 실제 스펙에는 없음 |
| system.participants | 727 | contractId·employeeId (100% 채워짐) | 결합할 문서 쪽 키가 없음(기안자 미노출) |
| system.attendance | 680 | employeeId (**537/680, 21% 미매칭**) | ADT 사번 별칭 보강 필요 |
| system.leave | 454 | employeeId (doc_id 1/454) | doc_id를 차원으로 노출하지 않음 |

### 3-2. 추가 후보 (스테이징 행 수, 2026-10-21)

**A. 코드만 고치면 바로 엣지로 올릴 수 있는 마스터** — 양식에 이미 ID가 저장돼 있다.

| 후보 | 행 | 연결 양식 | 얻는 것 |
|---|---|---|---|
| 차량·자산 `reservable_assets` | 3 | 출장 신청(`asset_select`) | 차량별 출장 사용, 예약 대비 불일치 |
| 업체 담당자 `facility_contact_people` | 47 | 출장보고 접견인, 견적·공문 수신자 | 담당자별 접견·발송 이력(영업 활동과 연결) |
| 휴가 종류 `leave_types` | 25 | 휴가신청서 | 종류별 사용 통계 |
| 부서 `departments` | 8 | dept_select(현재 텍스트) → ID 저장 전환 후, 그리고 문서 `dept_id`(82/83 채워짐) | 부서별 경비·초과근무·휴가. 지금 맵에 부서 노드가 없는 이유 |

**B. 결재 doc_id를 이미 가진 원장** — "승인 후 기록" 선으로 맵에 표시하고 시스템 소스로 등록한다.

| 후보 | 행 (doc 연결) | 연결 양식 | 얻는 것 | 우선 |
|---|---|---|---|---|
| 법인카드 승인내역 `card_transactions` (+`expense_card_tags`) | 850 (0) | 지출(법인카드)·출장보고 | **승인 대비 결의 누락률**, 미귀속 카드 지출, 용역별 카드 경비 | ★★★ |
| 개인·쇼핑몰 영수증 `personal_receipts`·`shop_receipts` | 5·83 (0·0) | 지출(개인)·구매품의 | 영수증 대비 정산 누락 | ★★ |
| 전표 `journal_entries`/`journal_lines` | 881 (0) | 지출 계열 전체 | 계정과목별 결재액, 전표 미생성 문서 | ★★ |
| 특별휴가 대장 `special_leave_ledger` | — | 휴가·초과근무(보상휴가) | 대체·장기근속 휴가 사용률 | ★ |
| 근로계약 `labor_contracts` | 203 | 근로계약 갱신·연차수당 | 통상임금 자동 채움, 갱신 정합 | ★★ |
| 급여·상여 대장 `payroll_ledgers`/`payroll_entries` | 125 / 3,202 | 상여·연차수당 | 결재액 대비 급여 반영 확인 | ★ |
| 성과급 `bonus_statements`·`bonus_period_settings` | 24 | 성과급 계획 | 계획 대비 명세 | ★ |
| 운행일지 `vehicle_trip_logs` | 1 (1) | 출장 신청 | 출장 대비 운행일지 누락 | ★ |
| 증명서 발급 `certificate_issues` | 2 | 증명신청 | 발급 리드타임 | ☆ |
| 소득 대장 `income_payment_ledger` | — | 전문가활용비 | 외부 자문료 집계 | ★ |
| 퇴직 정산 `severance_settlements` | — | 연차수당 | 정산 완료율 | ☆ |
| 견적·계약서·공문 `quotations`·`contract_agreements`·`official_letters` | 5·1·207 (doc 13) | 전용 양식 3종 | 견적 → 수주 전환율, 계약별 공문 이력 | ★★ |

**C. 계약 축을 넓히는 원장 — 마진율 계산에 필요** (§4-4 동기)

| 후보 | 행 | 결합 키 | 얻는 것 | 우선 |
|---|---|---|---|---|
| 기성·세금계산서 `contract_invoices`·`contract_payment_milestones`·`tax_invoices` | 1,904·2,162·25 | contract_id (100%) | **용역 매출(분자)**. 경비와 결합하면 용역 마진 | ★★★ |
| 외주 `contract_outsourcing` | 28 | contract_id | **용역 원가(외주비)** | ★★★ |
| 성과급 용역 원가 `bonus_contract_costs` | 18 | contract_id | 성과급 산정용 원가와 같은 축 | ★ |
| 업무추진 보고 `work_plan_reports` | 6 | contract_id·dept_id | 용역별 진척·보고 횟수 | ☆ |
| 영업 프로젝트·활동 `sales_projects`·`sales_activities` | 1·8 | facility_id·contract_id | 수주 전 영업비용(초과근무·출장의 직접 입력 계약 후보) | ☆ |

**D. 근태 축**

| 후보 | 행 | 결합 키 | 얻는 것 | 우선 |
|---|---|---|---|---|
| ADT 일별 `attendance_daily` | 3,489 (직원 매칭 2,690) | employeeId + 근무일 | 급여 초과근무 대조(`matchOvertimeRequests`)에서는 이미 쓰고 있음. 지표 소스로 올리면 신청 대비 실측 차이를 지표로 볼 수 있고 결근사유서 근거도 됨 | ★★ |

**E. 원장이 없음 — 신설 검토(D-4)**
- **교육 이력**: 교육훈련 신청·보고를 받을 곳이 없다. `employee_educations`는 학력 테이블이다.
- **외부 소득자(전문가) 마스터**: 전문가활용비를 낼 때마다 성명·주민번호·계좌를 다시 입력한다.

**연결 대상이 아님**: intel·공공입찰·메일·메신저·IEPS 파싱 데이터. 결재 문서와 업무 축이 다르다.

> 정리: 맵에 보여줄 소스는 7종에서 **최대 약 25종**으로 늘릴 수 있다. 다만 노드를 다 그리면 맵이 읽히지 않는다. 그래서 다음 세 묶음으로 접어서 보여주고, 펼치면 개별 원장이 나오게 하는 것을 권장한다(L0).
> - 입력 참조 마스터(A)
> - 결과 원장(B)
> - 분석 소스(C·D)

---

## 4. 개선 계획

### L0 — 맵을 사실대로 보이게 (진단 정확화) · 소~중

데이터를 바꾸지 않는다. 지금 있는 연계를 전부 드러내는 단계다.

1. **참조 타입 확장**: `REF_ENTITY`와 `AUTO_CONCEPT_BY_TYPE`에 `asset_select`→자산, `contact_select`→업체 담당자, `leave_type`→휴가 종류를 추가하고 `linkedCondition`도 보강한다.
2. **표 열 참조 집계**: `people` 열과 `related` 열(`_relatedContractId`·`_relatedFacilityId`)을 엣지로 집계하고 연결률을 **행 단위**로 낸다.
3. **전용 양식 4종**: 연결 판정을 도메인 테이블(`quotations`·`official_letters`·`contract_agreements`) 조인으로 한다.
4. **결과 원장 엣지**: 위 B 표의 원장을 "승인 후 기록" 선(점선 등 다른 모양)으로 그린다. 입력 참조와 결과 기록을 구분한다. 커넥터 배선(`approval_form_actions`)과 하드코딩 훅에서 자동으로 도출하고, 승인 문서를 읽어 가는 파생 6곳은 코드 목록으로 함께 등록한다.
5. **기안자·부서 암묵 엣지**: `approval_docs.drafter_employee_id`·`dept_id`(82/83 채워짐)를 표시할지는 D-5에서 정한다.
6. **"참조 필드 없음" 안내**: §4-2에 설계만 돼 있고 구현되지 않은 부분이다. 연계 후보 필드를 제안하고 빌더로 연결한다.
7. 양식을 **연계 대상 / 공지성(대상 아님)**으로 나눈다. 내부고시처럼 연계가 필요 없는 양식이 "미연결"로 보이는 일을 없앤다.
8. 함께 고칠 결함 두 건:
   - `lib/approval/summarize.ts:35-38` — 계약 요약이 `o.name`을 읽는데 계약 값에는 `title`만 있어 빈칸이 된다.
   - 휴가신청서 `use_days`가 `quantity.hours`로 태깅돼 있다. `quantity.days` 개념을 새로 만들어 교정한다.

### L1 — 입력 구조 교정 (양식·피커) · 중

새로 들어오는 문서부터 마스터에 붙게 한다. 제출이 거의 없어서 지금 고치면 비용이 가장 적다.

1. **부서**: `dept_select`가 `{deptId, name}`을 저장하게 바꾼다. `/api/org/snapshot`의 부서 목록과 `OrgPickerModal`의 부서 모드를 재사용한다. 표 열에도 부서·직급 선택 타입을 추가한다. 인사발령의 `to_dept`·`new_position`이 대상이고, 이름 문자열 매칭(`hr-actions.ts`)을 없앤다.
2. **HR 자동 생성 양식**(상여·성과급·근로계약): 기안을 생성할 때 행마다 `_employeeId` 메타를 넣는다(`TABLE_META_KEYS` 확장). 생성 코드는 이미 직원 ID를 가지고 있다. 승인 훅의 사번·이름 매칭을 ID 매칭으로 바꾼다.
3. **자동 채움**:
   - 연차수당의 `remaining_days`는 연차 대장에서, `daily_wage`는 근로계약에서 채운다.
   - 출장 신청·보고의 용역분류는 계약의 `service_type`에서 채운다(fillMap).
4. **원가 귀속 필드**: 구매품의·업무기안·전문가활용비·교육신청에 "관련 용역(계약 검색)"을 선택 항목으로 추가한다. 필수로 할지는 D-1에서 정한다.
5. **선후행 연결 사용**: 출장신청→출장보고, 교육신청→교육보고, 구매품의→지출결의의 `approval_docs.ref_doc_id`가 지금 **0건**이다. 후행 문서를 작성할 때 선행 문서 선택을 기본 흐름으로 만든다.
6. **타입·태그 교정**:
   - 날짜·월·연도를 text로 받는 필드 4건(`baseDate`·`pay_month`·`period`·`target_year`)을 date·month 타입으로 바꾼다.
   - 금액·날짜 미태깅 필드에 태그를 붙인다(관계 맵의 '미태깅' 경고 해소).
7. 인사 이력 `employee_hr_events`에 `doc_id` 컬럼을 추가한다. 지금처럼 note 문자열을 LIKE로 찾는 방식은 문서 번호 형식이 바뀌면 중복 판정이 깨진다.
8. 양식 정의를 바꾸는 작업은 빌더에서 한 뒤, 같은 내용을 **멱등 마이그레이션으로도 남긴다**. 빌더 편집분이 SQL에 없어서 이번 조사도 DB를 직접 봐야 했다.

### L2 — 과거·원천 데이터 보정 · 소~중

1. **초과근무 이관 58건**: 용역명 31종과 업체명을 계약·사업장에 대응시키는 표를 만든다.
   - 화면이 후보를 자동으로 제시한다(띄어쓰기 무시, 업체명, 기간 겹침 기준). 사람이 확정한다.
   - 확정한 값을 `field_values`에 `contractId`·`facilityId`로 넣는다. 원문은 `originalTitle`로 보존한다.
   - 관계 맵의 미연결 문서 목록에서 바로 보정하는 흐름(§4-2 설계)으로 구현한다.
2. **ADT 직원 매칭 21% 미매칭**: `attendance_emp_aliases`를 보강해 `attendance_weekly`와 `attendance_daily`의 `employee_id`를 채운다.
3. **계약의 수행 부서** `owning_dept_id` 72% 공백: 부서별 지표의 분모가 비어 있는 상태다. 계약 관리 화면에서 일괄로 채운다.
4. **견적·계약서의 contract_id 역기입**: 계약을 등록할 때 원본 견적·계약서를 선택하면 역으로 연결되게 한다.

### L3 — 지표 엔진 결합 확장 · 중~대

1. 문서 차원에 `drafter_employee_id`·`dept_id`를 노출한다. 그러면 휴가·초과근무·증명서 등 **모든 양식을 직원·부서 축**으로 participants·attendance·leave와 결합할 수 있다.
2. **표 행 단위 귀속**: 지출 행의 `_relatedContractId`로 groupBy한다. 문서 단위 계약 필드보다 행 귀속을 우선한다. 이것이 용역별 경비의 실현이다.
3. 시스템 소스를 추가한다. 1차는 다음과 같다.
   - `system.invoices`(기성·세금계산서)
   - `system.outsourcing`(외주)
   - `system.card`(카드 승인)
   - `system.attendance_daily`
   - `system.special_leave`

   `system.contracts`에는 `counterparty_facility_id`(ref.company)와 `owning_dept_id`(ref.dept) 차원을 추가한다.
4. 복합 지표에서 groupBy가 같은지 검사하고(지금은 주석으로만 적혀 있음), 시간축 결합을 지원한다. 그래야 "월별 용역 마진율"을 만들 수 있다.
5. 목표 지표 예시:
   - 용역 마진율 = (기성 − 외주 − 출장·기타 경비 − 투입 인건비) / 기성
   - 카드 승인 대비 결의 누락률
   - 초과근무 신청 대비 실측 차이
   - 부서별 휴가 사용률

### L4 — 재발 방지 가드 · 소

1. 양식 빌더에서 저장할 때 다음 경우 소프트 경고를 띄운다.
   - "금액이 있는데 관련 용역·부서 참조가 없음"
   - "사람·부서를 text로 받는 표 열"
2. 관계 맵에 **직접 입력 비율 경고**를 추가한다(예: 30% 초과). 직접 입력을 "나중에 연결" 대기열로 모아 담당자가 연결한다.
3. 매뉴얼: 화면이 바뀌면 같은 커밋에서 `content/manual`의 관계 맵·빌더 기사와 도움말을 갱신한다(CLAUDE.md 매뉴얼 동기화 규칙).

### 순서와 규모

```
L0 진단 정확화 ──┬─▶ L1 입력 구조 교정 ──▶ L4 가드
                 └─▶ L2 소급 보정(58건·ADT 별칭)
L1 + L2 ─────────────▶ L3 엔진 결합(마진율)
```

| 단계 | 규모 | DB 마이그레이션 | 배포 |
|---|---|---|---|
| L0 | 소~중 (주로 `semantics.ts`·맵 화면) | `quantity.days` 개념 시드 1건 | next만 |
| L1 | 중 (렌더러·모바일·빌더·PDF 등 신규 타입 10곳, 조사 메모 §4) | 양식 정의 갱신 여러 건 | next(+모바일 OTA) |
| L2 | 소~중 (보정 화면 + 일회성 갱신) | 일회성 보정 SQL | next |
| L3 | 중~대 (`metric-engine`·`metric-types`) | 없음 또는 뷰 | next |
| L4 | 소 | 없음 | next |

마이그레이션 번호는 착수 시점에 `git fetch` 후 원격의 모든 브랜치를 확인하고 정한다. 이 체크아웃에는 `306`이 미커밋 상태로 있다.

---

## 5. 결정 필요 사항

| ID | 논점 | 권장안 |
|---|---|---|
| D-1 | 원가 귀속 필드(관련 용역)를 필수로 할 범위 | 지출 계열 행의 `related`는 현행 조건부 필수 유지. 구매품의·업무기안·전문가활용비는 **선택**으로 시작하고, 직접 입력 비율을 본 뒤 필수화 |
| D-2 | 계약 검색의 직접 입력 허용 | 허용 유지(영업 중이라 계약 미등록인 건이 있음). 대신 "나중에 연결" 대기열과 맵 경고로 관리 |
| D-3 | 이관 58건 보정 방식 | 후보 자동 제시 + 사람 확정. 자동 확정은 안 함. 31종이라 한 번에 처리 가능 |
| D-4 | 교육 이력·외부 소득자 마스터 신설 | 교육 이력은 **보류**(교육 결재 0건). 외부 소득자는 L1 이후, 주민번호 암호화 보관 설계와 함께 검토 |
| D-5 | 맵에 기안자·부서 암묵 엣지 표시 | 표시하지 않고, 지표 엔진 차원으로만 노출(맵이 모든 양식→직원 선으로 덮이는 것 방지) |
| D-6 | 결과 원장 엣지의 표시 범위 | 묶음(입력 참조 / 결과 원장 / 분석 소스) 접기 방식, 기본은 접힘 |

---

## 부록 — 조사 방법·근거

- 양식 정의: 스테이징 `approval_forms.fields` 24종을 2026-10-21에 읽기 전용 세션(`default_transaction_read_only=on`)으로 조회했다. 마이그레이션 기준 정의와 다른 양식은 초과근무(v10)·출장 신청(v10)·출장보고(v15)다. 빌더로 계약·업체·직원 검색 필드가 추가돼 있다.
- 초과근무 연결률: `field_9`(계약) `contractId` 0/58, `company_name` `facilityId` 0/58, 직접 입력 58/58. 제출 기간 2026-04-27~05-23, 기안자 15명.
- 원장 연결률: `card_transactions.doc_id` 0/850, `journal_entries.doc_id` 0/881, `annual_leave_ledger.doc_id` 1/454, `official_letters.doc_id` 13/207, `contract_deliverables.letter_doc_id` 8/49, `attendance_weekly.employee_id` 537/680, `attendance_daily.employee_id` 2,690/3,489, `contracts.owning_dept_id` 348/1,254, `approval_docs.ref_doc_id` 0건.
- 코드 근거:
  - 관계 맵: `frontend/lib/approval/semantics.ts`(REF_ENTITY·refFieldsOf·linkedCondition)
  - 엣지 자동 개념: `frontend/lib/approval/fields.ts:124`(AUTO_CONCEPT_BY_TYPE), `:267`(TABLE_META_KEYS)
  - 지표 엔진: `frontend/lib/analytics/metric-engine.ts`(refValueOf 140-164, 문서 SELECT 195, 복합 결합 487-502)
  - 승인 훅 등록: `frontend/lib/approval/actions.ts:484-493`
