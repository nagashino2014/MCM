import type { HelpTopic } from "../types";

/** 관리(계정·권한·회사 프로필·AI·첨부 정책·채용공고) 화면의 ? 도움말. sources[0] 에 topic="id" 가 있어야 한다. */
export const ADMIN_HELP: HelpTopic[] = [
  {
    id: "admin.account-header",
    label: "계정 상태·권한 반영 도움말",
    blocks: [
      { kind: "list", items: [
        "권한을 부여·회수하면 저장·조회 같은 실제 동작에는 **즉시** 반영됩니다.",
        "왼쪽 메뉴와 화면 버튼은 대상자가 **로그아웃 후 다시 로그인**해야 바뀝니다.",
        "[[활성]] / [[비활성]]을 누르면 계정 상태가 바뀝니다. 비활성 계정은 로그인할 수 없습니다.",
        "휴지통 아이콘은 계정 **영구 삭제**입니다. 퇴사자는 삭제하지 말고 사용자 등록의 인사관리 탭에서 퇴사를 기록하세요.",
      ] },
    ],
    more: { article: "admin.users", section: "relogin" },
    sources: ["components/admin/users/PermissionManagementPanel.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "admin.assign-scope",
    label: "권한 부여 범위 도움말",
    blocks: [
      {
        kind: "table",
        head: ["범위", "뜻"],
        rows: [
          ["[[템플릿 기본]]", "템플릿에 권한별로 정한 범위 그대로"],
          ["[[참여 용역]]", "본인이 참여인력인 계약·영업 건만"],
          ["[[본인]]", "본인 자료만"],
          ["[[소속 부서]]", "본인 부서(겸직 부서 포함)"],
          ["[[선택 부서]]", "왼쪽 조직도에서 고른 부서"],
          ["[[전사]]", "회사 전체"],
        ],
      },
      { kind: "p", text: "기본이 아닌 범위를 고르면 그 템플릿의 **모든 권한**이 같은 범위가 됩니다. 이미 받은 템플릿은 ✓로 잠겨 있습니다." },
    ],
    more: { article: "admin.users", section: "assign" },
    sources: ["components/admin/users/PermissionManagementPanel.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "admin.template-perms",
    label: "권한 선택 도움말",
    blocks: [
      { kind: "list", items: [
        "왼쪽 트리에서 세부 권한을 누르면 오른쪽에 추가되고, 다시 누르면 빠집니다.",
        "오른쪽 권한 칩을 눌러 활성화한 뒤 위쪽 범위 태그를 누르면 범위가 더해집니다. 흐린 태그는 그 권한이 지원하지 않는 범위입니다.",
        "범위 칩을 **마우스 오른쪽 버튼**으로 누르면 그 범위가 빠집니다. 범위가 하나뿐이면 지울 수 없습니다.",
        "[[선택 부서]]는 저장할 때 왼쪽 조직도에서 선택돼 있던 부서가 기준입니다.",
      ] },
      { kind: "warn", text: "저장하면 이 템플릿을 받은 모든 계정의 권한이 함께 바뀝니다." },
    ],
    more: { article: "admin.users", section: "templates" },
    sources: ["components/admin/users/PermissionManagementPanel.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "admin.account-purge",
    label: "영구 삭제와 퇴사 처리 도움말",
    blocks: [
      {
        kind: "table",
        head: ["상황", "할 일"],
        rows: [
          ["실제 직원의 퇴사", "사용자 등록 → 인사관리 탭의 퇴사 기록. 기록은 남고 퇴사일에 계정이 비활성화됩니다."],
          ["테스트·잘못 발급한 계정", "이 창에서 [[영구 삭제]]"],
        ],
      },
      { kind: "p", text: "업무 기록이 걸려 있으면 영향 확인란을 체크하고, 로그인 ID를 그대로 입력해야 삭제됩니다. 되돌릴 수 없습니다." },
    ],
    more: { article: "admin.users", section: "status" },
    sources: ["components/admin/users/AccountPurgeModal.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "admin.provision",
    label: "계정 발급 도움말",
    blocks: [
      { kind: "list", items: [
        "[[계정 발급]]에는 **입사일·성별·생년월일**이 필요합니다. 성별·생년월일은 주민번호를 넣고 저장하면 채워집니다.",
        "발급하면 사번(입사일 8자리 + 성별 2자리 + 순번 2자리)이 로그인 ID가 되고, 초기 비밀번호는 사번입니다. 처음 로그인할 때 바꿔야 합니다.",
        "직급에 기본 권한 템플릿이 있으면 자동 부여됩니다. 없으면 권한이 비어 있습니다.",
        "인사카드를 저장하거나 [[새로고침]]을 누르면 이 안내도 바로 갱신됩니다.",
      ] },
    ],
    more: { article: "admin.registry", section: "provision" },
    sources: ["app/(app)/admin/users/registry/page.tsx"],
    reviewedAt: "2026-10-21",
  },
  {
    id: "admin.positions",
    label: "사용 가능 직급 도움말",
    blocks: [
      { kind: "list", items: [
        "직급 칩을 누르면 이 부서에서 쓸 직급이 켜지고 꺼집니다. [[부서 저장]]을 눌러야 남습니다.",
        "점선 + 칩으로 새 직급을 추가합니다. 이때 고른 [[기본 권한 템플릿]]은 그 직급으로 계정을 발급할 때 자동 부여됩니다.",
      ] },
      { kind: "warn", text: "칩을 마우스 오른쪽 버튼으로 누르면 직급 삭제 확인이 뜹니다. 삭제는 회사 전체에서 그 직급을 지웁니다." },
    ],
    more: { article: "admin.registry", section: "org" },
    sources: ["components/admin/users/EmployeeRegistryPanel.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "admin.company-save",
    label: "회사 프로필 저장 도움말",
    blocks: [
      { kind: "list", items: [
        "[[일반현황 저장]]으로 저장: 업체 일반현황 입력란, 신용평가 등급 행, 재정상황 표, 주요 사업내용.",
        "바로 저장: 등급 이미지 업로드, 주요 연혁, 면허·인증 보유현황.",
        "인적구성은 사용자 등록의 환경부 등급(대행업)으로 자동 집계됩니다.",
      ] },
      { kind: "warn", text: "등급서·표준재무제표 분석으로 채운 행도 [[일반현황 저장]]을 눌러야 남습니다." },
    ],
    more: { article: "admin.company-profile", section: "save" },
    sources: ["components/admin/company/CompanyProfilePanel.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "admin.company-history-auto",
    label: "연혁 분류·자동 줄 도움말",
    blocks: [
      { kind: "list", items: [
        "면허·인증·특허·수상을 취득일과 함께 저장하면 연혁 줄이 자동으로 생깁니다. 연월·내용은 원본에서 고칩니다.",
        "눈 아이콘 = 회사소개서 연혁에 싣기/빼기, 별 아이콘 = 주요 연혁 강조.",
        "[[분류]]는 회사소개서 연혁 쪽에서 묶음·아이콘에 쓰입니다.",
      ] },
    ],
    more: { article: "admin.company-profile", section: "history-auto" },
    sources: ["components/admin/company/CompanyProfilePanel.tsx"],
    reviewedAt: "2026-10-21",
  },
  {
    id: "admin.ai-budget",
    label: "AI 예산·초과 시 정책 도움말",
    blocks: [
      { kind: "list", items: [
        "예산은 전체 1개 + 기능별·모델별을 합쳐 최대 3개입니다. 경고 임계(예: 50,80,100%)를 넘을 때마다 알림이 갑니다.",
        "**경고만**: 한도를 넘어도 호출은 계속됩니다(기본).",
        "**비필수 기능 차단**: 한도 100%에서 결재 요약·영수증 파싱 같은 필수 기능만 남기고 나머지를 막습니다.",
        "**전체 차단**: 한도 100%에서 모든 AI 호출을 막습니다. 막힌 기능은 AI 없이 기존 방식으로 동작합니다.",
      ] },
    ],
    more: { article: "admin.ai-usage", section: "budget" },
    sources: ["components/admin/ai-usage/BudgetsTab.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "admin.attach-user-mode",
    label: "인원 모드 도움말",
    blocks: [
      {
        kind: "table",
        head: ["모드", "뜻"],
        rows: [
          ["[[전사 기본 따름]]", "전사 기본 정책 그대로"],
          ["[[모두 허용]]", "목록 전체 허용. 확장자별 차단 규칙은 계속 적용"],
          ["[[목록 전체 차단]]", "목록 전체 차단. 확장자별 허용 규칙은 계속 적용"],
        ],
      },
      { kind: "p", text: "판정 순서는 확장자별 개인 규칙 → 인원 모드 → 전사 기본 정책입니다. 여러 명을 체크하면 같은 설정이 한꺼번에 적용됩니다." },
    ],
    more: { article: "admin.attachment-policy", section: "users" },
    sources: ["components/admin/AttachmentPolicyBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "admin.recruit-save",
    label: "자동 저장·버전 저장 도움말",
    blocks: [
      { kind: "list", items: [
        "**자동 저장**: 고친 뒤 잠시(약 1.5초) 멈추면 저장됩니다. 제목 옆 ‘모든 변경사항 저장됨’을 확인하세요.",
        "[[버전 저장]]: 지금 상태를 별도 버전으로 기록합니다. 크게 고치기 전이나 확정 직전에 누르세요.",
        "[[버전 목록]]: 저장한 버전을 보고 [[이 버전으로 복원]]합니다. 복원한 내용도 자동 저장됩니다.",
        "공고기간을 입력하다 만 상태에서는 저장하지 않습니다. 날짜 8자리를 끝까지 넣으세요.",
      ] },
    ],
    more: { article: "admin.recruit", section: "editor" },
    sources: ["components/recruit/RecruitEditorBoard.tsx"],
    reviewedAt: "2026-10-21",
  },
  {
    id: "admin.integrations",
    label: "외부 연동 상태 도움말",
    blocks: [
      { kind: "list", items: [
        "근태·영업 수집·공공입찰·바로빌 연동이 정해진 주기 안에 성공했는지 매일 08~20시에 매시 점검합니다.",
        "[[이상]]이 생기면 시스템 관리자에게 운영 알람·모바일 앱 알림·메일로 알리고, 계속되면 24시간마다, 복구되면 한 번 더 알립니다.",
        "[[확인 불가]]는 판정 근거가 없는 상태(수집기 갱신 전 등)라 알리지 않습니다.",
        "[[지금 점검]]을 누르면 바로 판정합니다. 알림 규칙은 같습니다.",
      ] },
    ],
    more: { article: "admin.integrations", section: "targets" },
    sources: ["components/admin/IntegrationHealthBoard.tsx"],
    reviewedAt: "2026-10-30",
  },
];
