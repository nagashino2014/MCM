import type { HelpTopic } from "../types";

/** 결재 운영 설정 화면의 ? 도움말. sources[0] 에 topic="id" 가 있어야 한다. */
export const APPROVAL_OPS_HELP: HelpTopic[] = [
  {
    id: "approval-ops.field-meaning",
    label: "데이터 의미 도움말",
    blocks: [
      { kind: "list", items: [
        "데이터 분석 지표는 필드 이름이 아니라 이 의미를 보고 값을 모읍니다. 양식이 달라도 같은 의미면 같은 지표에 집계됩니다.",
        "계약·업체·사용자·부서 검색 항목은 연결 대상이 자동으로 정해집니다.",
        "의미가 없는 금액·날짜 항목은 분석에 쓰이지 않습니다.",
      ] },
      { kind: "warn", text: "운영 중인 양식의 필드 키는 바꾸지 마세요. 그 전 문서 값이 지표·사전검토에서 읽히지 않습니다." },
    ],
    more: { article: "approval-ops.forms", section: "meaning" },
    sources: ["components/approval/ApprovalFormsBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "approval-ops.autofill",
    label: "자동 채움 도움말",
    blocks: [
      {
        kind: "table",
        head: ["검색 항목", "채울 수 있는 정보"],
        rows: [
          ["[[업체 검색]]", "주소, 대표자, 전화번호, 사업자번호, 지역"],
          ["[[계약 검색]]", "업체명, 용역 대분류·세분류, 계약일, 계약금액"],
        ],
      },
      { kind: "p", text: "기안자가 검색에서 골라 확정하면 채워진 칸은 잠깁니다. 직접 입력하면 잠기지 않습니다." },
    ],
    more: { article: "approval-ops.forms", section: "autofill" },
    sources: ["components/approval/ApprovalFormsBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "approval-ops.actions",
    label: "연계·드라이런 도움말",
    blocks: [
      { kind: "list", items: [
        "결재가 끝나면(또는 상신·반려 때) 고른 앱 기능이 자동으로 실행됩니다. 실패해도 결재는 되돌려지지 않고, 문서의 실행 기록에서 다시 실행할 수 있습니다.",
        "필드 키 대신 데이터 의미로 연결하면 필드 키가 바뀌어도 유지됩니다.",
        "[[드라이런]]은 최근 문서 하나에 대입해 보기만 하고 아무것도 쓰지 않습니다. 실제 적용은 [[연계 저장]] 뒤부터입니다.",
      ] },
      { kind: "warn", text: "연계를 삭제하면 실행 기록도 함께 지워집니다. 잠시 끄려면 [[사용]]을 끄세요." },
    ],
    more: { article: "approval-ops.forms", section: "actions" },
    sources: ["components/approval/FormActionsEditor.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "approval-ops.semantics-map",
    label: "관계 맵 읽는 법",
    blocks: [
      { kind: "list", items: [
        "선 하나는 양식의 검색 항목(계약·업체·사용자·부서) 하나입니다.",
        "선 색은 연결률입니다 — 파랑 90% 이상, 주황 60% 이상, 빨강 60% 미만, 회색은 제출 문서 없음.",
        "선을 누르면 [[연결 품질 상세]]에 직접 입력·미입력 문서가 나옵니다. 이 문서들은 그 대상 기준 집계에서 빠집니다.",
        "사용을 끈 양식은 맵에 나타나지 않습니다.",
      ] },
    ],
    more: { article: "approval-ops.semantics", section: "read" },
    sources: ["components/approval/ApprovalSemanticsBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "approval-ops.policy-levels",
    label: "사전검토 수준 도움말",
    blocks: [
      {
        kind: "table",
        head: ["수준", "상신할 때"],
        rows: [
          ["[[경고]]", "확인 창에서 ‘그래도 상신’을 고르면 상신됩니다."],
          ["[[차단]]", "상신이 멈춥니다. 내용을 고쳐야 상신됩니다."],
        ],
      },
      { kind: "list", items: [
        "[[본인 결재 경고]]는 정책과 관계없이 항상 경고로 동작합니다.",
        "[[연차 잔여 초과]]는 휴가신청서에서만 검사합니다.",
        "저장하면 그 양식의 규칙 전체가 화면 내용으로 바뀝니다.",
      ] },
    ],
    more: { article: "approval-ops.policies", section: "levels" },
    sources: ["components/approval/ApprovalPolicyBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "approval-ops.concepts-save",
    label: "의미 사전 저장·설정 패키지 도움말",
    blocks: [
      { kind: "list", items: [
        "[[저장]]은 사전 전체를 바꿔 씁니다. 표에서 지운 줄, 라벨·그룹이 비었거나 키 형식이 틀린 줄은 삭제됩니다.",
        "키는 지표 정의가 참조하므로 운영 중에는 바꾸지 마세요.",
        "[[설정 가져오기]]는 양식·의미 사전·지표를 덮어쓰고(삭제는 안 함) 되돌릴 수 없습니다. 덮어쓴 양식의 선행 양식 설정은 다시 지정해야 합니다.",
      ] },
    ],
    more: { article: "approval-ops.concepts", section: "package" },
    sources: ["components/approval/ApprovalSemanticConceptsBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "approval-ops.notify-channels",
    label: "결재 알림 채널 도움말",
    blocks: [
      { kind: "list", items: [
        "이 화면은 회사 전체의 [[이메일]]·[[알림톡]] 발송을 정합니다.",
        "모바일 앱 푸시는 여기서 끌 수 없고, 직원 각자의 앱 알림 설정을 따릅니다.",
        "발신 설정이 없는 채널과 연락처가 없는 직원은 자동으로 건너뜁니다.",
      ] },
      { kind: "warn", text: "[[미결재 리마인드]]의 이메일·알림톡을 모두 끄면 앱 푸시 리마인드도 가지 않습니다." },
    ],
    more: { article: "approval-ops.notify", section: "notes" },
    sources: ["components/approval/ApprovalNotifySettingsBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
];
