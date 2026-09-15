# 전자결재 연계 정합성 · 숙박출장수당 · 영수증 직접 첨부 · 쇼핑몰 전표 (2026-09-15)

사용자 요청 6건을 한 묶음으로 구현한 기록. 마이그 `infra/aws/224_approval_link_integrity.sql`.

## 1. 선행 문서 연계 정합성 검증
- 판정 함수: `frontend/lib/approval/ref-link.ts` `compareWithRefDoc(fields, values, refValues, formId)` — 기안 화면(상시 배너·선택 시 alert·상신 confirm)과 서버(`lib/approval/ref-check.ts`, 상신 시 `field_values._ref_check` 스냅샷)가 같은 함수를 쓴다. 결재 화면(`ApprovalDocModal`)은 스냅샷으로 노란 배너.
- 범용: 업체명(company_select, 선행에 업체형 값이 없으면 출장신청서 `destination` 텍스트와 느슨 비교) · 대표 기간(period, 정확) · 계약명.
- 양식별(`FORM_RULES`):
  - 출장보고서 ↔ 출장신청서: 용역분류(`service_class`↔`contract_class` 집합, 122 개정 전 옵션 정규화). 출장기간·계약명은 범용.
  - 교육훈련 보고 ↔ 신청: `edu_name`·`edu_org` **느슨 매칭**(`looseMatch` — 법인표기·공백·구두점 제거 후 동일/포함/바이그램 Dice ≥ 0.6). 교육기간은 정확.
  - 지출결의서(법인카드) ↔ 구매품의서: 양식 간 연결만(202 `ref_form_id`가 이미 구매품의서로 고정 — 후보 검색도 그 양식만). 사용 내역 합계 > 품의 합계 × 1.1 이면 경고. 선행 필수 아님(기존 confirm 유지).
- 차단하지 않는다 — 기안자가 confirm 한 뒤 상신되고, 결재자가 배너로 본다.

## 2. 숙박출장수당 자동 산정
- 기준표 `trip_lodging_allowance_rules(rank_from, daily_amount)` 시드: 0→3만(차장 이하), 70→4만(부장 이상·임원 포함). 급여 항목·설정 → **출장 여비** 탭(`TripAllowancePanel`, API `/api/payroll/trip-allowance`).
- 산정 `lib/payroll/trip-allowance.ts` `tripLodgingAmounts(payYear, payMonth)`: **승인된 출장보고서**의 선행 출장신청서(`trip_class='숙박 출장'`, 승인)의 `trip_period` 일수(양끝 포함) 중 귀속 구간(전월 26~금월 25)에 드는 날 × 기안자 직급 단가. 구간을 걸치면 월별 분할. 결재 진행 중 보고서는 경고만.
- `generate.ts`: `trip-lodging`을 VOLATILE(전월 복사 금지)에 추가, `put("trip-lodging", …, "calc")`. 기존 `payroll_pay_rules.trip-lodging` 정액은 224에서 비활성(자동 산정으로 대체 — 사용자 확정), `rule_eligible=0`.
- 기안 화면: 숙박 출장신청서를 연결하면 본인 직급 기준 미리보기(`/api/payroll/trip-allowance/preview`). 상신 시 `_lodging_allowance` 스냅샷 → 결재 화면 안내.
- 동행자는 각자 신청·보고해야 산정된다(기안자 기준).

## 3. 영수증 첨부 탭(모바일앱 첨부 / 직접 첨부)
- `ReceiptPickerModal` 탭 2종. 직접 첨부 = 여러 행(파일·상호·사용일·금액·지불수단·지출 목적) 입력 → `POST /api/receipts/manual`(multipart) → 저장 즉시 표 행(`detail`=지출 목적 프리필)+첨부. 아래 목록에는 이전에 직접 첨부한 미사용 건.
- `personal_receipts.source('mobile'|'manual')·pay_method·purpose` 추가, `image_key` NULL 허용(PDF 원본). 이미지는 촬영 건과 같이 정규화+스탬프 PDF.
- 기간 입력 폭 150px 고정 → [기간 ~ 전체 기간 조회] 1행.

## 4. 쇼핑몰 전표 불러오기(지출결의서 법인카드)
- 재무 > 쇼핑몰 전표 수집(`shop_receipts`, 196~198)을 그대로 쓴다. 피커 API `/api/receipts/shop/picker`(approval.view), 모달 `ShopReceiptPickerModal`.
- 표에 이미 담긴 카드 승인건(`_cardTxnId`)과 매칭된 전표는 행을 만들지 않고 PDF 첨부만. 나머지는 행(`_shopReceiptId`, 매칭 승인건이 있으면 `_cardTxnId` 동반)+첨부. `shop_receipts.doc_id` 귀속 동기화.
- 첨부 미리보기 허용 프리픽스에 `shop-receipts/` 추가.
