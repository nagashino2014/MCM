# 모바일 발행 요청·업무보고 구현 블루프린트

> 2026-08-20 확정. 배경: 모바일 홈 KPI 6종 중 "발행 요청"·"업무보고"는 숫자만 보여주고
> 눌러 들어갈 화면이 모바일(그리고 전체 메뉴)에 없다. 두 기능 모두 **웹 서버 자산이 이미 존재**하므로
> 원칙은 "새 도메인 로직 금지 — 기존 API 재사용 + 모바일 화면 + 부족한 라우트만 보강"이다.

## 0. 기존 자산 (재사용 대상)

| 자산 | 위치 | 비고 |
|---|---|---|
| 발행 요청 스키마 | `infra/aws/069_invoice_requests.sql` | `contract_payment_milestones.invoice_requested_at/by/note` — 마일스톤 열이 곧 상태 |
| 내 참여 계약 미발행 트리 | `GET /api/home/invoice-requests/mine` (H10) | 실무자용. `lib/home/invoice-requests.ts` |
| 발행 요청 수신함 | `GET /api/home/invoice-requests/inbox` (H11) | 담당자용, 권한 `billing.receivable.manage` |
| 요청/취소 액션 | `POST /api/contracts/{cid}/milestones/{mid}/invoice-request` | 요청 생성·취소 |
| 계산서 발행(바로빌) | `app/api/finance/tax-invoices` + 웹 발행 모달 | 발행 실행은 웹 자산 |
| 업무보고 저장/조회 | `GET·POST /api/work-plan/report`, `/report/[reportId]` | `lib/work-plan/reports.ts` |
| 검토(피드백·반려) | `POST /api/work-plan/report/[reportId]/review` | 부서장. `REVIEW_COMMENT_KINDS`·`REJECTABLE_KINDS` |
| 재보고 | `POST /api/work-plan/report/[reportId]/re-report` | 보완 후 재상신 |
| 임원 지시 | `/api/work-plan/report/[reportId]/directive`, `/api/work-plan/directives` | 지시 하달·회신 |
| 임원 합본/감독 | `/api/work-plan/consolidated`, `/api/work-plan/oversight` | 임원 열람 |
| 홈 KPI 소스 | `/api/home/invoice-requests/inbox·mine`, `/api/home/work-plan-todo` | 모바일 홈이 이미 호출 중 |

## 1. 발행 요청 (IR-M)

### 역할별 동작 (사용자 확정)
- **실무자**: 내가 수행 중인 용역 리스트 → 용역 선택 → 대금 단위(마일스톤) 선택 → 발행 담당자에게 요청.
- **발행 담당자**: 요청 들어온 대금 청구 단계 리스트 확인 → 바로빌 전자발행 모달 호출 → 계산서 발행.

### 화면 (`apps/mobile/src/app/invoice-requests.tsx`, 자체 헤더 + 탭)
- 진입: 홈 KPI "발행 요청" 타일 + 전체 메뉴(업무 섹션 신설) 타일.
- 권한 분기: `/api/home/invoice-requests/inbox` 가 403 이면 실무자 뷰만, 200 이면 탭 2개
  (`요청함`(담당자) / `내 용역`(실무자)). 별도 권한 조회 API 불필요 — 403 을 분기 신호로 쓴다.
- **내 용역 탭**: H10 트리(계약 → 미발행 마일스톤). 마일스톤 행 탭 → 확인 시트(금액·거래처·메모 입력)
  → `POST .../invoice-request`. 이미 요청된 건은 "요청됨 · 취소" 액션.
- **요청함 탭**: H11 리스트(요청자·계약·금액·요청일, 최신순).
  - **모바일에서 바로빌 발행 모달은 재구현하지 않는다**(공급받는자 확정·품목·부가세 구분 등 웹 전용 복잡도).
    1차: 행 탭 → 상세 시트(요청 메모·금액 확인) + "웹에서 발행" 안내 + **처리 완료 확인은 리스트 갱신**으로.
    2차(선택): 발행 완료 처리만 모바일에서 (`invoice_issued` 마킹 API 재사용) — 실발행은 웹.
- 요청 시 담당자 푸시 알림: 기존 push 파이프라인(`lib/push.ts`) 재사용, 서버 훅은
  invoice-request POST 라우트에 알림 1줄 추가.

### 단계
- **IR-M1**: 화면 + 두 탭 + 요청/취소 + 홈 타일 라우팅 연결. (서버 변경: 푸시 알림 훅만)
- **IR-M2**(후속): 담당자 발행완료 마킹, 요청 반려(사유) — 필요 시 069 열 추가 없이 note 재사용.

## 2. 업무보고 (WR-M)

### 역할별 동작 (사용자 확정)
- **실무자**: 보고 작성, 작성한 보고 확인, 반려·보완 요청 확인 및 수정(재보고).
- **부서장**: 부서원 보고 열람, 의견 첨삭·보완 요구 피드백, 반려, 임원 단계 토스.
- **임원**: 올라온 모든 보고 확인, 임원 검토 의견 첨부 후 지시 하달.

### 화면 (`apps/mobile/src/app/work-report/` — 목록 `index.tsx` + 상세 `[reportId].tsx`)
- 진입: 홈 KPI "업무보고" 타일 + 전체 메뉴 타일.
- 역할 판정: 기존 work-plan API 의 응답/403 으로 분기(부서장 `review-context`, 임원 `consolidated`).
- **목록**: 탭 = `내 보고`(실무자, 상태 배지: 작성중·제출·보완요청·반려·확인) /
  `부서 보고`(부서장) / `전체 보고`(임원). 주차 선택은 내 근태와 같은 연/월→주 패턴 재사용.
- **작성/수정**: 모바일은 **경량 작성**만 — 항목(업무·진행·계획) 텍스트 위주, 표·구조화 노트는 웹 안내.
  `saveWorkPlanReport` 입력 중 모바일이 채우는 필드를 최소 집합으로 제한(빈 구조 필드는 서버 기본).
- **상세**: 보고 본문 + 검토 코멘트 타임라인. 역할별 액션바:
  - 실무자: 수정(보완요청 상태일 때) → 재보고(`re-report`)
  - 부서장: 의견(첨삭 kind 선택)·보완 요구·반려(`review`), 임원 토스(승급 플래그 — 기존 review kind 재사용,
    없으면 `escalate` kind 1개를 `REVIEW_COMMENT_KINDS` 에 추가하는 마이그 없이 상수 확장)
  - 임원: 검토 의견 + 지시 하달(`directive`) — 지시는 기존 directives 파이프라인으로 실무자 홈에 회신 표시
- 푸시: 제출→부서장, 피드백/반려→실무자, 토스→임원, 지시→실무자. 기존 push prefs 카테고리에 `workReport` 추가.

### 단계
- **WR-M1**: 목록(3탭)+상세 열람+실무자 작성·재보고. (서버 변경: 없음 목표 — 기존 라우트로 충당)
- **WR-M2**: 부서장 피드백·반려·토스 + 푸시.
- **WR-M3**: 임원 검토·지시 + 홈 KPI 상세화(반려/지시 대기 분리).

## 3. 공통 원칙
- 모든 신규 화면은 자체 헤더(`ScreenHeader`) — `_layout.tsx` Stack 등록 필수(iOS 헤더 루프 회피).
- 시트에 폼이 실리면 반드시 `ScrollView flexShrink:1` 패턴(영업 일정 등록 겹침 실측 2026-08-20).
- 역할 분기는 전용 권한 API 를 만들지 않고 **기존 라우트의 403 을 신호**로 쓴다(권한 로직 이원화 방지).
- 구현 순서 제안: IR-M1 → WR-M1 → WR-M2 → IR-M2 → WR-M3 (실무자 가치 우선).
