import type { HelpTopic } from "../types";

/**
 * 화면 안 ? 도움말(<CdHelp topic="id" />). 3~6줄로 짧게 쓰고 자세한 설명은 more 로 매뉴얼에 연결한다.
 * sources[0] 파일에 topic="id" 가 있어야 한다(test:manual).
 * 경고·필수 조건·실행 영향은 ? 안에 숨기지 말고 화면에도 남긴다(ui-precision-standard §3).
 */
export const HELP_TOPIC_LIST: HelpTopic[] = [
  // ── 전자결재 ──
  {
    id: "approval.inbox-boxes",
    label: "결재 대기·예정 도움말",
    blocks: [
      { kind: "list", items: [
        "**결재 대기**: 지금 내 차례인 문서입니다. 바로 승인·반려할 수 있습니다.",
        "**결재 예정**: 결재선에 내가 있지만 앞 순번이 아직 처리하지 않은 문서입니다. 앞 사람이 승인하면 결재 대기로 옮겨집니다.",
        "내가 부재로 등록돼 있으면 내 차례 문서가 대결자에게 넘어갈 수 있습니다(최종 결재 제외).",
      ] },
    ],
    more: { article: "approval.home", section: "boxes" },
    sources: ["components/approval/ApprovalHomeBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "approval.cancel-request",
    label: "반려 요청 도움말",
    blocks: [
      { kind: "p", text: "휴가·출장·교육 신청서를 고치거나 취소하려면 반려 요청을 보냅니다. 일반 결재 문서에는 회수 버튼이 없습니다." },
      { kind: "list", items: [
        "결재 중: 지금 차례인 결재자에게 반려 요청 알림이 갑니다. 반려되면 고쳐서 재상신합니다.",
        "승인 후: 관리자에게 결재 취소 요청이 갑니다. 취소되면 휴가로 차감된 연차가 돌아옵니다.",
      ] },
    ],
    more: { article: "approval.home", section: "fix" },
    sources: ["components/approval/ApprovalDocModal.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "approval.delete-resubmit",
    label: "삭제·재상신 도움말",
    blocks: [
      { kind: "list", items: [
        "**수정 후 재상신**: 문서번호는 그대로이고 결재선은 처음 단계부터 다시 진행합니다.",
        "**이어 작성**: 임시 저장한 문서를 계속 씁니다.",
        "**삭제**: 결재선·참조 기록까지 지워지고 되돌릴 수 없습니다. 휴가 문서면 차감된 연차가 복원됩니다.",
      ] },
    ],
    more: { article: "approval.home", section: "fix" },
    sources: ["components/approval/ApprovalDocModal.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "approval.draft-line",
    label: "결재선 도움말",
    blocks: [
      { kind: "list", items: [
        "위에서 아래 순서대로 한 사람씩 결재합니다. 앞 사람이 승인해야 다음 사람 차례가 됩니다.",
        "줄마다 합의(의견 확인) 또는 승인(결재 권한)을 고릅니다.",
        "결재자가 부재 중이면 그 사람이 정해 둔 대결자가 대신 결재하거나 다음 결재자로 넘어갑니다. 마지막 결재자는 넘어가지 않습니다.",
        "로그인 계정이 없는 직원은 지정할 수 없습니다. 자주 쓰는 결재선은 [[프리셋 저장]]해 두세요.",
      ] },
    ],
    more: { article: "approval.draft", section: "line" },
    sources: ["components/approval/ApprovalDraftBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "approval.draft-watchers",
    label: "참조·열람 도움말",
    blocks: [
      { kind: "list", items: [
        "참조·열람에 넣은 사람은 결재하지 않고 문서만 봅니다.",
        "상신한 뒤부터 결재가 진행 중일 때도 볼 수 있고, 그 사람의 문서함 [참조·열람] 탭에 나타납니다.",
        "참조와 열람은 문서에 표시되는 이름만 다릅니다.",
      ] },
    ],
    more: { article: "approval.draft", section: "line" },
    sources: ["components/approval/ApprovalDraftBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "approval.draft-expense",
    label: "지출 내역 작성 도움말",
    blocks: [
      { kind: "list", items: [
        "지출 내역은 불러오기 버튼으로만 담습니다. 사용일·상호·금액은 증빙 값 그대로이며 고칠 수 없습니다(잘못 담았으면 행을 지우고 다시 불러오기).",
        "계좌이체 확인증·수기 영수증은 [[기타 개인 지출증빙]]으로 올립니다(지출결의서(개인)·출장보고서).",
        "모든 행에 지출 목적을 목록에서 골라야 상신됩니다.",
        "출장 경비, 초과근무 식대, 인쇄/제본비는 연관 용역/사업장도 골라야 합니다.",
        "출장보고서는 출장 기간을 먼저 넣어야 하며, 기간 밖이거나 사용일을 모르는 카드·영수증 내역은 불러오지 않습니다.",
      ] },
    ],
    more: { article: "approval.draft", section: "expense" },
    sources: ["components/approval/ApprovalDraftBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "approval.draft-overtime",
    label: "초과근무 신청 도움말",
    blocks: [
      { kind: "list", items: [
        "이번 주 연장근로가 한도(기본 주 12시간)를 넘게 되면 상신할 때 ‘보상휴가 전환 동의서’가 뜹니다. 전자서명해야 올라갑니다.",
        "동의는 주 단위입니다. 다른 주로 다시 올리면 새로 동의합니다.",
        "승인된 초과근무는 실제 출퇴근 기록과 대조해 수당·대체휴가로 산정됩니다.",
      ] },
    ],
    more: { article: "approval.draft", section: "overtime" },
    sources: ["components/approval/ApprovalDraftBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "approval.draft-save",
    label: "임시저장 도움말",
    blocks: [
      { kind: "p", text: "기안 화면은 자동 저장되지 않습니다. 오래 작성할 때는 중간중간 임시저장을 누르세요. 저장한 문서는 결재함 [작성중 · 반려]에서 이어 씁니다." },
      { kind: "p", text: "공문·견적서·계약서·착수계 화면은 내용이 바뀌면 5분마다 자동 저장됩니다." },
    ],
    more: { article: "approval.draft", section: "submit" },
    sources: ["components/approval/ApprovalDraftBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "letter.recipients",
    label: "공문 수신처·참조 도움말",
    blocks: [
      { kind: "table", head: ["입력란", "실제 메일"], rows: [
        ["수신처(업체)", "공문 ‘수신’ 줄에만 적힘"],
        ["참조(담당자)", "받는 사람(To)"],
        ["외부 참조", "참조(Cc) — 공문 지면에는 안 적힘"],
        ["사내 참조", "참조(Cc)"],
      ] },
      { kind: "p", text: "수신처 1곳 이상, 메일 주소가 있는 참조 담당자 1명 이상이 있어야 상신됩니다." },
    ],
    more: { article: "approval.letter", section: "recipients" },
    sources: ["components/approval/ApprovalLetterBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "letter.number",
    label: "공문번호 도움말",
    blocks: [
      { kind: "list", items: [
        "보이는 번호는 예정 번호입니다. 상신할 때 확정되며, 다른 공문이 먼저 상신되면 그 번호를 가져갈 수 있습니다.",
        "삭제된 공문의 번호는 다음 상신 공문이 이어받습니다.",
        "결재 관리자는 번호를 직접 지정할 수 있고, 그때 건너뛴 번호는 ‘결번’으로 표시됩니다.",
      ] },
    ],
    more: { article: "approval.letter", section: "number" },
    sources: ["components/approval/ApprovalLetterBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "notice.number",
    label: "내부고시 번호 도움말",
    blocks: [
      { kind: "list", items: [
        "‘내부고시-N호’는 연도와 관계없이 이어지는 통산 번호입니다.",
        "상신할 때 확정되며, 다른 고시가 먼저 상신되면 그 번호를 가져갈 수 있습니다.",
        "승인 뒤 회수 후 수정해도 번호는 유지됩니다.",
      ] },
    ],
    more: { article: "approval.notice", section: "write" },
    sources: ["components/approval/ApprovalNoticeBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  // ── 메일 ──
  {
    id: "mail.attach",
    label: "첨부 파일 도움말",
    blocks: [
      { kind: "list", items: [
        "파일 1개 최대: 끌어다 놓기 30MB, [[내 PC]]로 고르기 2GB.",
        "일반 첨부 합계(본문 이미지 포함)가 25MB를 넘으면 넘친 파일은 ‘대용량 · 링크’가 되어 본문에 30일짜리 다운로드 링크로 들어갑니다.",
        "보안 정책으로 막힌 확장자는 추가할 때 자동으로 빠집니다.",
      ] },
    ],
    more: { article: "mail.compose", section: "attach" },
    sources: ["components/mail/MailComposePage.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "mail.draft-save",
    label: "메일 임시 저장 도움말",
    blocks: [
      { kind: "p", text: "메일 쓰기는 자동 저장되지 않습니다. 쓰다가 자리를 비울 때는 임시 저장을 누르세요. 저장한 메일은 임시보관함에서 이어 씁니다." },
    ],
    more: { article: "mail.compose", section: "draft" },
    sources: ["components/mail/MailComposePage.tsx"],
    reviewedAt: "2026-10-20",
  },
  // ── 할 일·일정 ──
  {
    id: "todo.scope",
    label: "할 일 범위·공유 도움말",
    blocks: [
      { kind: "list", items: [
        "**내 할 일**: 내가 만들었거나 내가 담당인 할 일.",
        "**공유받음**: 다른 사람이 만들고 나를 담당·공유로 넣었거나, 내가 멤버인 보드의 할 일.",
        "**맡긴 일**: 내가 만들어 다른 사람에게 담당을 맡긴 할 일.",
        "개인 할 일은 만든 사람만 봅니다. 함께 보려면 담당을 지정하거나 상세의 ‘공유’에 사람을 넣거나 프로젝트 보드로 옮기세요.",
      ] },
    ],
    more: { article: "todo.main", section: "scope" },
    sources: ["components/todo/TodoBoardPage.tsx", "lib/todo/visibility.ts"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "todo.quick-add",
    label: "빠른 입력 도움말",
    blocks: [
      { kind: "p", text: "예: **내일 오후 3시 한빛제지 협의 !높음 @김민수 10/30까지**" },
      { kind: "list", items: [
        "날짜(오늘·내일·다음주 화요일·10/30) · 시각(오후 3시·14:30) · 마감(…까지)",
        "반복(매일·평일·매주 월수·매월 말일) · !우선순위 · @담당 · #열(또는 보드) · //메모",
        "‘출장’·‘초과근무’로 시작하면 전자결재로 안내합니다.",
      ] },
    ],
    more: { article: "todo.main", section: "quick" },
    sources: ["components/todo/QuickAddBar.tsx", "lib/todo/quick-parse.ts"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "todo.complete-rules",
    label: "완료 조건 도움말",
    blocks: [
      { kind: "list", items: [
        "하위 작업 모두 완료 / 완료 메모 입력 / 검토 단계 경유 / 선행 작업 모두 완료 — 켜진 조건을 채워야 완료됩니다.",
        "선행 작업 조건을 켜지 않았다면 선행이 남아 있어도 경고만 하고 완료할 수 있습니다.",
        "완료 후 30일이 지나면 보관함으로 옮겨집니다.",
      ] },
    ],
    more: { article: "todo.main", section: "complete" },
    sources: ["components/todo/CompleteConfirmModal.tsx", "lib/todo/types.ts"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "calendar.day-action",
    label: "일정 추가 도움말",
    blocks: [
      { kind: "list", items: [
        "출장·휴가·교육은 달력에 직접 넣지 않고 전자결재 기안으로 신청합니다. 버튼을 누르면 날짜가 채워진 기안 화면이 열리고, 승인되면 달력에 표시됩니다.",
        "회의는 관리자·임원, 면접은 면접 관리자, 미팅은 누구나 등록합니다. 등록하면 참석자에게 알림이 갑니다.",
      ] },
    ],
    more: { article: "calendar.main", section: "add" },
    sources: ["components/calendar/DayActionModal.tsx"],
    reviewedAt: "2026-10-20",
  },
  // ── 근태·급여 ──
  {
    id: "hr.my-leave",
    label: "내 휴가 도움말",
    blocks: [
      { kind: "list", items: [
        "발생 연차: 올해 부여된 연차(조정 포함). ‘규정 발생’은 법 기준 참고값입니다.",
        "연차 발생일은 회사 기준에 따라 회계연도(1/1) 또는 입사일 기준입니다.",
        "연차·반차(0.5일)만 차감되고, 경조사·공가 같은 비연차 휴가는 차감되지 않습니다.",
        "휴가신청서가 승인되면 여기에 자동으로 반영됩니다.",
      ] },
    ],
    more: { article: "hr.my", section: "leave" },
    sources: ["components/approval/MyLeaveBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "hr.my-attendance",
    label: "내 근태·초과근무 도움말",
    blocks: [
      { kind: "list", items: [
        "연장·야간 수당 배율은 회사 설정을 따르며 기본 1.5배·2.0배입니다.",
        "‘12h 초과 주’는 연장근로가 주 한도(기본 12시간)를 넘은 주입니다.",
        "수당은 통상시급(통상임금 ÷ 209) 기준 예상치이며, 실제 지급은 확정된 급여대장을 따릅니다.",
      ] },
    ],
    more: { article: "hr.my", section: "attendance" },
    sources: ["components/approval/MyAttendanceBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "payroll.my-monthly",
    label: "월별 명세서 도움말",
    blocks: [
      { kind: "list", items: [
        "회사가 확정한 급여대장만 보입니다.",
        "발행된 명세서를 처음 열면 열람 시각이 ‘수신 확인’으로 회사에 기록됩니다. 발행 전 달은 ‘발행 대기’입니다.",
      ] },
    ],
    more: { article: "payroll.my", section: "monthly" },
    sources: ["components/payroll/MyPayrollBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  // ── 업무추진계획 ──
  {
    id: "work-plan.report-lock",
    label: "제출·수정 도움말",
    blocks: [
      { kind: "list", items: [
        "저장한 보고를 다시 열면 잠긴 상태입니다. [[수정]]을 누르면 풀리고, 고친 뒤 [[수정 제출]]합니다.",
        "제출한 보고는 부서장이 검토합니다. 반려되면 [재보고 대상]에 부서장 의견과 함께 나타납니다.",
      ] },
    ],
    more: { article: "work-plan.report", section: "lock" },
    sources: ["components/work-plan/ReportEditor.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "work-plan.stages",
    label: "공정표 도움말",
    blocks: [
      { kind: "list", items: [
        "단계를 눌러 상태·착수일·완료일·진행률을 입력합니다. 보고에는 이번에 바꾼 단계만 기록되고, 색이 칠해진 단계가 이번 보고분입니다.",
        "진행률은 상태가 ‘진행 중’일 때만, 단계별 단위(기본 10%)로 입력합니다.",
      ] },
    ],
    more: { article: "work-plan.report", section: "stages" },
    sources: ["components/work-plan/ReportEditor.tsx"],
    reviewedAt: "2026-10-20",
  },
  // ── 계약 ──
  {
    id: "contracts.tax-invoice",
    label: "전자세금계산서 발행 도움말",
    blocks: [
      { kind: "list", items: [
        "발행을 누르면 바로 발급됩니다. 발급된 계산서는 국세청 전송 전이라도 삭제·취소할 수 없습니다.",
        "국세청 전송은 보통 다음 날 일괄 처리됩니다. 금액·공급받는자를 고쳐야 하면 전송이 끝난 뒤 수정세금계산서로 정정합니다(회계 담당자에게 요청).",
        "입력 금액 기준: 공급가액(부가세 별도)을 고르면 세액은 그 10%, 합계금액(부가세 포함)을 고르면 입력액 ÷ 1.1이 공급가액이 됩니다. 면세는 세액 0원.",
        "발행 전에 공급받는자·금액·작성일자·수신 메일을 꼭 확인하세요.",
      ] },
    ],
    more: { article: "contracts.manage", section: "e-invoice" },
    sources: ["components/contracts/TaxInvoiceIssueModal.tsx"],
    reviewedAt: "2026-10-20",
  },
  // ── 파일함 ──
  {
    id: "files.delete",
    label: "파일 삭제 도움말",
    blocks: [
      { kind: "list", items: [
        "여기서 지운 파일은 원래 있던 곳(결재 문서 첨부·메신저·사업장 자료·게시판·업무추진 이슈)에서도 사라지며 복구할 수 없습니다.",
        "[[일괄 삭제]]는 현재 필터에 걸린 파일 전체가 대상입니다. 필터를 먼저 확인하세요.",
      ] },
    ],
    more: { article: "files.library", section: "delete" },
    sources: ["components/files/FileLibraryBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "files.retention",
    label: "파일 저장 정책 도움말",
    blocks: [
      { kind: "list", items: [
        "파일 크기 구간마다 보존 기간(6개월·1년·5년·영구)을 정합니다.",
        "보존 기간이 지난 파일은 ‘보존기간 경과’로 표시되고, 매일 한 번 자동 삭제 작업에서 지워집니다(한 번에 최대 1,000건).",
        "모든 구간이 ‘영구’면 자동 삭제는 하지 않습니다.",
      ] },
    ],
    more: { article: "files.library", section: "delete" },
    sources: ["components/files/FileLibraryBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
];
