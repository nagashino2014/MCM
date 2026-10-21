import type { HelpTopic } from "../types";

/** 협업 나머지 화면의 ? 도움말 — sources[0] 파일에 topic="id" 가 있어야 한다(test:manual). */
export const COLLAB_MORE_HELP: HelpTopic[] = [
  // ── 주소록 ──
  {
    id: "directory.org-category",
    label: "연락처 구분 도움말",
    blocks: [
      { kind: "list", items: [
        "연락처 구분은 담당자 개인이 아니라 **소속 기관·업체의 속성**입니다.",
        "한 사람의 구분을 바꾸면 같은 기관·업체의 담당자 전원에게 함께 적용됩니다.",
        "아직 정하지 않은 곳의 담당자는 [[미지정]]으로 모입니다.",
        "구분 변경과 담당자 수정·삭제는 사업장 편집 권한이 있어야 하며, 권한이 있는 사람에게만 [[관리]] 열의 아이콘이 보입니다.",
      ] },
    ],
    more: { article: "directory.main", section: "edit" },
    sources: ["components/directory/DirectoryBoard.tsx"],
    reviewedAt: "2026-10-21",
  },

  // ── 공지·게시판 ──
  {
    id: "board.page",
    label: "공지·게시판 도움말",
    blocks: [
      { kind: "list", items: [
        "**전사 공지**는 전 임직원이 봅니다. 게시판 운영 권한이 있는 사람만 씁니다.",
        "**부서 게시판**은 내 소속 부서원끼리만 보고 씁니다. 소속 부서가 없으면 쓸 수 없습니다.",
        "고정 공지는 고정 기간 동안 위쪽 카드로 보이고, 공지 기간이 끝난 글에는 ‘종료’가 붙습니다.",
        "파란 점·굵은 제목은 아직 읽지 않은 글입니다.",
      ] },
    ],
    more: { article: "board.main", section: "read" },
    sources: ["components/board/BoardListBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "board.notify",
    label: "공지 알림 도움말",
    blocks: [
      { kind: "list", items: [
        "알림은 **처음 [[등록]]할 때 한 번만** 보냅니다. 수정해도 다시 보내지 않습니다.",
        "대상: 전사 공지는 재직 중인 전 임직원, 부서 게시판은 같은 부서원입니다.",
        "앱 푸시는 작성자 본인을 빼고, MCM 앱에서 알림을 켠 사람에게만 갑니다.",
        "알림 발송이 실패해도 글은 그대로 등록됩니다. 첨부는 한 글에 합계 20MB까지입니다.",
      ] },
    ],
    more: { article: "board.main", section: "write" },
    sources: ["components/board/BoardWriteBoard.tsx"],
    reviewedAt: "2026-10-20",
  },

  // ── 사규·내규 ──
  {
    id: "rules.publish",
    label: "사규 발행 도움말",
    blocks: [
      { kind: "list", items: [
        "[[저장]]은 검수 중인 판의 수정 내용을 보관합니다. 저장하지 않은 수정이 있으면 발행되지 않습니다.",
        "[[발행]]하면 시행일부터 효력이 있는 시행판이 되고, 전 임직원이 사규 열람에서 봅니다. 직전 시행판은 지난 판으로 남습니다.",
        "발행한 판은 조문을 고치거나 삭제할 수 없습니다. 개정은 원문을 다시 임포트해 새 판으로 진행합니다.",
        "휴지통 아이콘은 검수 중인 판을 폐기합니다.",
      ] },
    ],
    more: { article: "rules.admin", section: "publish" },
    sources: ["components/rules/RuleAdminBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "rules.internal-enact",
    label: "시행·개정안 도움말",
    blocks: [
      { kind: "list", items: [
        "[[시행]]: 시행일을 넣고 누르면 판이 고정되어 내부 규정 일람에 공개됩니다. 이후 그 판의 조문은 고칠 수 없습니다.",
        "[[개정안 만들기]]: 시행 중인 판을 복사한 새 판을 만들어 고칩니다. 다시 시행하면 이전 판은 지난 판으로 남습니다.",
        "머리 정보(규정번호·주관부서·승인·제정일)는 시행 뒤에도 [[저장]]으로 고칠 수 있습니다.",
        "휴지통 아이콘: 개정안이면 개정안만 폐기하고, 한 번도 시행하지 않은 규정이면 규정을 삭제합니다(되돌릴 수 없음).",
      ] },
    ],
    more: { article: "rules.internal", section: "enact" },
    sources: ["components/rules/InternalRuleEditorBoard.tsx"],
    reviewedAt: "2026-10-20",
  },

  // ── 자산 ──
  {
    id: "assets.legend",
    label: "이용 현황 표시 도움말",
    blocks: [
      { kind: "list", items: [
        "**출장 법인차량**: 출장신청서에 법인차량을 고르고 상신하면 자동으로 표시됩니다(결재 중·승인 문서). 바꾸거나 취소하려면 결재 문서에서 처리합니다.",
        "**직접 예약**: 이 화면에서 등록한 회의실·기타 자산 예약입니다. 겹치는 직접 예약은 등록되지 않습니다. 본인 예약은 목록의 휴지통 아이콘으로 취소하고, 자산 관리 권한자는 다른 사람 예약도 취소할 수 있습니다.",
        "**⚠ 이중 배정**: 같은 자산의 이용이 겹친다는 경고입니다. 출장 결재를 막지 않으니 당사자끼리 조정하세요.",
      ] },
    ],
    more: { article: "assets.reservations", section: "legend" },
    sources: ["components/assets/AssetCalendarBoard.tsx"],
    reviewedAt: "2026-10-21",
  },

  // ── 설문 ──
  {
    id: "survey.questions",
    label: "문항 저장·잠금 도움말",
    blocks: [
      { kind: "list", items: [
        "설정 탭은 자동 저장되지만, 문항은 [[문항 저장]]을 눌러야 저장됩니다. 저장하지 않으면 접수 상태를 바꿀 수 없습니다.",
        "응답이 1건이라도 들어오면 문항이 잠깁니다. 기존 응답과 문항의 짝이 깨지지 않게 하기 위해서입니다.",
        "문항을 바꾸려면 설문 목록에서 복제 아이콘을 눌러 문항까지 복사한 새 설문을 만드세요. 응답은 복사되지 않습니다.",
      ] },
    ],
    more: { article: "survey.internal", section: "make" },
    sources: ["components/survey/SurveyBuilderBoard.tsx", "components/survey/SurveyListBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "survey.anonymous",
    label: "익명 설문 도움말",
    blocks: [
      { kind: "list", items: [
        "사내 설문: 집계 화면과 CSV에 응답자를 표시하지 않습니다. 한 사람이 한 번만 응답하도록 누가 응답했는지는 시스템에 남습니다.",
        "외부 설문: 구글 폼에서 이메일을 수집하지 않습니다.",
        "응답이 1건이라도 들어오면 익명 설정을 바꿀 수 없습니다(이미 받은 응답의 응답자가 드러나지 않게). 바꾸려면 설문을 복제해 새로 받으세요.",
      ] },
    ],
    more: { article: "survey.internal", section: "results" },
    sources: ["components/survey/SurveyBuilderBoard.tsx", "lib/survey/store.ts"],
    reviewedAt: "2026-10-21",
  },

  // ── 휴지통 ──
  {
    id: "trash.page",
    label: "휴지통 도움말",
    blocks: [
      { kind: "list", items: [
        "사업장과 계약을 삭제하면 여기에 남습니다. 다른 메뉴에서 지운 자료는 나오지 않습니다.",
        "잘못 지운 항목은 [[복원]]으로 원래 목록에 되돌립니다(휴지통 복원 권한 필요).",
        "[[영구 삭제]]는 관리자만 할 수 있고 되돌릴 수 없습니다. 사업장이면 담당자·연락 이력 같은 딸린 자료도 함께 지워집니다.",
      ] },
    ],
    more: { article: "admin.trash" },
    sources: ["app/(app)/trash/page.tsx"],
    reviewedAt: "2026-10-21",
  },
];
