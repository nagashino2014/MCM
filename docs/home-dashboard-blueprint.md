# 데스크톱 홈 화면(대시보드) 블루프린트 (확정 v3)

> 2026-07-14 작성, v2 = 사용자 피드백 반영(검수 대기열 제외, 용역 수행 인력·회계 담당자 위젯 추가,
> 세금계산서 발행 요청 워크플로 신설), v3 = 결정 논점 6개 확정 + 상세 구현 계획(§8).
> 로그인 후 첫 화면을 "오늘 내 업무의 출발점"으로 만드는 홈 대시보드 설계.
>
> **확정된 결정(2026-07-14)**: ①P1 = 8종(H1~H5·H9~H11) ②H4 완성 = 사업장 상세 패널 이동
> ③승격 = 관리자 "완성" 버튼(source→manual) ④루트 = 전 사용자 홈 통일 ⑤H10 = 대금지급단위별
> 요청, **계약원장(계약 관리) 트리뷰 양식 재사용**(용역 계약=부모, 대금단위=자식)
> ⑥H11 = 홈 카드에서 바로 발행 처리.

## 1. 문제 정의

- 현재 루트("/")는 `/data/status`(수집 현황)로 고정 리다이렉트 — 데이터 관리자 외에는
  자기 업무와 무관한 화면이 첫 화면이다.
- 사용자별 "지금 해야 할 일"(오늘 일정, 경과 미입력, 투찰 마감, 반려된 업무보고, 발행 요청,
  임시 등록 사업장 정리)이 각 메뉴에 흩어져 있어 로그인 직후 상황 파악에 여러 이동이 필요하다.
- **용역 수행 → 세금계산서 발행 흐름에 공백**: 수행 담당자가 대금 단계 도달을 회계에 알릴
  공식 채널이 없다(현재는 구두/메신저). 발행 완료 체크(invoice_issued)만 존재.

## 2. 설계 원칙

1. **역할이 아니라 권한으로 구성**: 위젯마다 필요한 RBAC 권한을 선언 — 가진 권한에 따라
   보이는 카드가 달라진다. 영업·관리·수행·회계 누구든 로그인하면 자기 일이 보이게.
2. **위젯 = 요약 + 딥링크**: 홈에서 일을 끝내려 하지 않는다(핵심 숫자·3~5건+이동 링크).
   예외 2개 — 임시 사업장 완성(H4), 세금계산서 발행 요청(H10)은 홈에서 바로 처리.
3. **기존 API 최대 재사용**: upcoming-activities/pending-reports/upcoming-bids/alerts/
   intel 신호/work-plan 쿼리 재사용. 신규는 홈 집계 + 발행 요청 워크플로만.
4. **cdash 카드 그리드**: CdPageHeader + 카드. 권한별 위젯 수가 달라 그리드는 유동 배치.

## 3. 위젯 구성 (P1 확정 후보)

| # | 위젯 | 내용 | 권한 | 데이터 소스 | 단계 |
|---|---|---|---|---|---|
| H1 | 오늘·이번 주 내 일정 | 영업 일정 리스트, 클릭 → 프로젝트 | sales.view | upcoming-activities | P1 |
| H2 | 경과 미입력 | N건 + 목록 → ProgressReportModal 재사용 | sales.view | pending-reports | P1 |
| H3 | 투찰 마감 임박 | D-day 목록(Salesboard W2 동일) | sales.view | upcoming-bids | P1 |
| H4 | **임시 등록 사업장 완성** | mobile-quick 리스트 + 완성 처리(§4) | facility.edit | facilities?source=mobile-quick | P1 |
| H5 | 운영 알림 요약 | 미확인 N건 + 최근 3건 → AlertDrawer | (공통) | alerts | P1 |
| H9 | **업무보고 할 일** | 이번 주 작성 대상 + **반려·보완 요구 재작성** 건 → /work-plan | (공통) | work-plan(반려 상태 쿼리) | P1 |
| H10 | **세금계산서 발행 요청**(수행자) | 내 참여 계약의 미발행 대금단위 → "발행 요청" 버튼(§5) | (참여자 본인) | service_participants×milestones | P1 |
| H11 | **발행 요청 수신함**(회계) | 요청된 대금단위 리스트 → billing 화면 딥링크·발행 처리 | billing.receivable.manage | 발행 요청 상태(§5) | P1 |
| H6 | 인텔 신호 하이라이트 | 야간 배치 수집 후보군 — 최근 7일 confirmed·direct top5 → /sales/intel | sales.view | intel_signals | P2 |
| H7 | 수금/발행 요약 | 미수·미발행 건수/금액 → /contracts/billing | billing.view | billing 집계 | P2 |

- ~~검수 대기열~~ 제외(IEPS 정보공개 파싱용 — 현재 미사용, 메뉴는 온존하되 홈 배치 없음).
- 권한별 첫 화면 예: 영업=H1·H2·H3·H5·H9(+H10 참여 시) / 수행부서=H9·H10·H5 /
  회계=H11·H7·H5·H9 / 관리자=H4·H5·H9(+전체).

## 4. 임시 등록 사업장 완성 (H4)

- 리스트: `source='mobile-quick'` 카드(사업장명·소재지·등록일).
- 완성 플로우·승격 기준은 결정 논점(§7 #2·#3).

## 5. 세금계산서 발행 요청 워크플로 (신규, H10·H11의 기반)

- **데이터**: 069 마이그레이션 — `contract_payment_milestones` 확장:
  `invoice_requested_at text, invoice_requested_by text(employee_id), invoice_request_note text`.
  발행 요청 상태 = requested_at 존재 & invoice_issued=0. 발행 완료 처리 시 요청 자동 해소.
- **요청(수행자, H10)**: 내 참여 계약(service_participants.employee_id = 나)의 대금단위 중
  미발행 건 리스트 → "발행 요청" 버튼(메모 선택 입력) → requested_at 기록 +
  **alerts 발행**(source='billing', code='invoice-request') → 회계 담당자에게 운영 알림.
- **수신(회계, H11)**: 요청된 대금단위 리스트(계약·사업장·금액·요청자·메모) →
  "발행 처리" 시 기존 billing 흐름(invoice_issued=1, 발행일) 재사용 — 홈에서 처리하거나
  billing 화면 딥링크.
- 중복 방지: 이미 요청된 단위는 버튼 비활성("요청됨 · N일 전"). 취소는 요청자 본인만.

## 6. 루트 진입 동작

- `/` → 홈 대시보드. 사이드바 최상단 "홈" 메뉴 추가. 모바일 UA 는 기존대로 /m.
- 기존 /data/status 직행 문제는 §7 #4.

## 7. 결정 사항 (2026-07-14 확정)

| # | 논점 | 결정 |
|---|---|---|
| 1 | P1 범위 | **8종 확정**(H1~H5·H9~H11) |
| 2 | H4 완성 방식 | **사업장 상세 패널 이동** — `/facilities?focus=<facilityId>` 딥링크(기존 focus 파라미터 재사용) |
| 3 | H4 승격 기준 | **관리자 "완성" 버튼** — 클릭 시 source: mobile-quick→manual |
| 4 | 루트 동작 | **전 사용자 홈으로 통일**(/ → /home, 모바일 UA 는 기존대로 /m) |
| 5 | H10 요청 단위 | **대금지급단위별** — 계약원장(계약 관리 /contracts) 트리뷰 양식 재사용: 용역 계약=부모 노드, 대금단위=자식 노드, 자식 클릭으로 발행 요청 |
| 6 | H11 발행 처리 | **홈 카드에서 바로 발행 처리**(발행일·금액 입력 → 기존 milestone PATCH 재사용) |

## 8. 상세 구현 계획 (확정)

### 8-1. 기반 (마이그레이션·루트)

- **069 마이그레이션**(`infra/aws/069_invoice_requests.sql`, 멱등):
  `contract_payment_milestones` 에 `invoice_requested_at text, invoice_requested_by text,
  invoice_request_note text` 3컬럼 추가. 요청 상태 = requested_at 존재 AND invoice_issued=0.
- **루트 전환**: `app/page.tsx` redirect → `/home`. `app/(app)/home/page.tsx` 신설.
  `config/menu.ts` 최상단에 "홈"(Home 아이콘, group 없음 또는 별도) 추가.
  모바일 UA 리다이렉트(authorized 의 path==="/" 체크)는 무변경 — 체인상 데스크톱만 /home.

### 8-2. 서버 (신규 API 4종 + 재사용)

- 재사용(무변경): upcoming-activities(H1)·pending-reports(H2)·upcoming-bids(H3)·
  alerts(H5)·facilities?source=mobile-quick(H4 리스트)·milestone PATCH(H11 발행 처리).
- **POST/DELETE `/api/contracts/[contractId]/milestones/[milestoneId]/invoice-request`**:
  요청 기록(requested_at/by/note) + alerts 발행(source='billing', code='invoice-request',
  회계 대상) / DELETE = 요청자 본인 취소. 권한: 해당 계약 service_participants 참여자
  (또는 billing.edit).
- **GET `/api/home/invoice-requests/mine`**(H10): 내 참여 계약(service_participants ×
  employee_profiles → 세션 사용자 매핑) + 각 계약의 대금단위(미발행 위주, 요청 상태 포함)
  트리 데이터.
- **GET `/api/home/invoice-requests/inbox`**(H11): 요청됨(& 미발행) 대금단위 리스트 —
  계약·사업장·금액·요청자·메모·요청일. 권한: billing.receivable.manage.
- **GET `/api/home/work-plan-todo`**(H9): 이번 주 작성 대상 + 반려·보완 요구 재작성 건(내 것) —
  기존 lib/work-plan 쿼리 재사용, 없으면 경량 신설.
- **POST `/api/facilities/[id]/promote`**(H4 승격): source mobile-quick→manual,
  facility.edit 권한 + audit log.
- 발행 완료 시(기존 PATCH 경유) 요청자에게 alerts 회신(code='invoice-issued') — PATCH 에
  requested 상태였으면 회신하는 소폭 훅 추가.

### 8-3. 화면 (components/home/*)

- `HomeBoard.tsx`: cdash + CdPageHeader("홈"), 위젯 카드 유동 그리드(2~3열).
  **권한별 노출 = 각 위젯 API 가 403 이면 카드 숨김**(프론트 권한 분기 코드 없음).
- 위젯 8종: `widgets/TodayScheduleCard`(H1)·`PendingProgressCard`(H2, ProgressReportModal
  재사용)·`UpcomingBidsCard`(H3)·`QuickFacilitiesCard`(H4: 리스트+정보 완성 링크+완성 버튼)·
  `AlertsCard`(H5)·`WorkPlanTodoCard`(H9)·`InvoiceRequestCard`(H10: 계약원장 트리 마크업
  재현 — 그룹 헤더(계약)+자식 행(대금단위)+Chevron 토글+요청 버튼/요청됨 뱃지)·
  `InvoiceInboxCard`(H11: 리스트+인라인 발행 폼[발행일·금액]→milestone PATCH).
- H10 트리 스타일: `/contracts` 페이지의 TreeFlatRow(그룹 헤더+자식 행) 마크업·색 체계
  (resolveServiceTypeStyle)를 그대로 따른다(가상 스크롤은 불필요 — 참여 계약 수가 적음).

### 8-4. 작업 순서·검증 게이트

1. 069 적용(staging) + 발행 요청 API·홈 API → 쿼리·권한 실증(참여자/회계 계정 시나리오)
2. HomeBoard + 위젯 8종 → dev 렌더·플로우 검증(요청→알림→수신함→발행→해소)
3. 루트/menu 전환 → 회귀 확인(모바일 UA /m, 기존 북마크 경로)
4. tsc → **사용자 확인** → 커밋·배포(주제별 분리: 기반+API / 화면 / 루트 전환)
