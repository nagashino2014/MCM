import type { HelpTopic } from "../types";

export const WORK_MGMT_HELP: HelpTopic[] = [
  // ── 업무추진계획 ──
  {
    id: "work-plan.oversight-review",
    label: "부서장 검토 도움말",
    blocks: [
      { kind: "list", items: [
        "[[반려]]는 의견 분류가 [[보완 요구]] 또는 [[오기 정정 요청]]일 때만 누를 수 있습니다. 반려한 보고는 작성자의 [[재보고 대상]]으로 갑니다.",
        "[[확인]]한 보고는 [[Merging 대상]]에 모이고, 통합 보고를 만들면 임원 검토·지시로 올라갑니다.",
        "임원 지시는 [[임원지시]]에서 답하며, [[재보고]]는 지시마다 1회입니다. 임원이 [[의견]]으로 보낸 건은 답변이 선택입니다.",
      ] },
    ],
    more: { article: "work-plan.oversight", section: "review" },
    sources: ["components/work-plan/OversightWorkspace.tsx", "components/work-plan/ReportEditor.tsx", "components/work-plan/ServiceListPanel.tsx", "lib/work-plan/constants.ts"],
    reviewedAt: "2026-10-21",
  },
  {
    id: "work-plan.merge",
    label: "통합 보고 생성 도움말",
    blocks: [
      { kind: "list", items: [
        "감독 상세에서 [확인]한 보고만 여기에 모입니다. 카드를 눌러 체크하고 [[통합 보고 생성]]을 누릅니다.",
        "체크한 보고가 임원 검토·지시 화면에 올라가고, 보고마다 추진 내역 요약이 자동으로 만들어집니다.",
        "통합한 보고는 이 목록에서 빠지며 되돌릴 수 없습니다.",
      ] },
    ],
    more: { article: "work-plan.oversight", section: "merge" },
    sources: ["components/work-plan/OversightWorkspace.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "work-plan.exec-directive",
    label: "임원 지시 도움말",
    blocks: [
      { kind: "list", items: [
        "부서장이 통합한 보고만 [[용역]] / [[Task]] 탭에 나옵니다.",
        "지시 종류: [[보완 요구]] · [[진행 촉구]] · [[추가보고 지시]] · [[의견]] 모두 [[지시 하달]]할 수 있습니다. [[의견]]은 부서장 답변이 선택입니다.",
        "하달하면 부서장 감독 화면의 임원지시 목록으로 가고 알림이 갑니다. 부서장은 지시마다 1회 재보고하며, 재보고는 [[용역(재보고)]] / [[Task(재보고)]] 탭에서 봅니다.",
      ] },
    ],
    more: { article: "work-plan.exec", section: "directive" },
    sources: ["components/work-plan/ExecWorkspace.tsx", "components/work-plan/ReportEditor.tsx", "lib/work-plan/constants.ts"],
    reviewedAt: "2026-10-21",
  },
  // ── 성과급 ──
  {
    id: "bonus.targets",
    label: "지급 대상 LIST 도움말",
    blocks: [
      { kind: "list", items: [
        "대상: 고른 반기에 세금계산서를 발행한 용역입니다.",
        "[[반기 적용금액]] = 이 반기에 발행된 단계의 발행액 합 × (용역금액 − 외주금액 − 영업비용) ÷ 용역금액. 색이 칠해진 단계가 이 반기 발행분입니다.",
        "[[총 지급대상 기준액]] = 전체 분류 반기 적용금액 합 × 적용 비율(기본 4%).",
        "[[본부]]가 [[미지정]]이면 본부장 차감에서 빠지고 부서장 화면에 나오지 않아 참여도·평점을 넣을 수 없습니다. 계약 상세에서 수행부서를 지정하세요.",
      ] },
    ],
    more: { article: "staffing.targets", section: "formula" },
    sources: ["components/bonus/BonusTargetsBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "bonus.evaluations",
    label: "참여도·평점 도움말",
    blocks: [
      { kind: "list", items: [
        "참여도: 용역마다 참여자 비율 합을 100%로 맞춥니다. 100%가 아니면 빨갛게 표시되지만 저장은 되므로 직접 확인하세요.",
        "[[제안]]은 이 반기의 참여 기간을 가중해 비율을 채웁니다. 확인 후 [[저장]]해야 반영됩니다.",
        "평점 가중치: A 1.125 · B 1.0625 · C 1 · D 0.9375 · E 0.8875. 평점이 없으면 C로 계산합니다.",
        "[[절대평가 옵션]]을 켜면 등급별 상한(반기 전체 평점 건수 대비 %)을 넘는 저장이 거절됩니다.",
        "참여자 제거(X)는 확인 창을 거쳐, 관리자·참여자 지정과 함께 [[저장]]과 관계없이 즉시 반영됩니다. 제거하면 계약 수행인력에서도 빠집니다.",
        "등급별 상한 값은 입력을 마치고 칸을 벗어나거나 Enter를 누를 때 저장됩니다.",
      ] },
    ],
    more: { article: "staffing.evaluations", section: "participation" },
    sources: ["components/bonus/BonusEvaluationsBoard.tsx", "lib/bonus/shared.ts", "lib/bonus/evaluations.ts"],
    reviewedAt: "2026-10-21",
  },
  {
    id: "bonus.statements",
    label: "일괄산정·발송 도움말",
    blocks: [
      { kind: "list", items: [
        "개인 산정액 = 용역마다 반기 적용금액 × 적용 비율 × (1 − 지원/영업% − 임원% − 본부장%) × 참여도 × 평점 가중치의 합.",
        "[[일괄산정]]은 반기 명세를 모두 지우고 다시 만듭니다. 설정·참여도·평점·배분을 바꾸면 다시 실행하세요.",
        "명세서는 [[성과급 기안]]이 승인된 뒤에만 발송됩니다. 기안 뒤 다시 산정해 금액이 기안 표와 달라지면 ‘재기안 필요’가 표시되고 발송이 막히니, [[성과급 재기안]]으로 다시 승인받으세요.",
      ] },
    ],
    more: { article: "staffing.statements", section: "steps" },
    sources: ["components/bonus/BonusStatementsBoard.tsx", "lib/bonus/statements.ts"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "bonus.calc-method",
    label: "산정방식 도움말",
    blocks: [
      { kind: "list", items: [
        "[[기존 산정방식]]: 지급 대상 LIST의 적용 비율로 산정합니다.",
        "[[인건비 반영 산정]]: 아래 적용 비율(비우면 기존 비율)로 산정한 뒤, 개인 참여 산정액에서 본인 반기 인건비 × 배수를 뺍니다(음수면 0). 본부장·유관부서 배분액은 빼지 않습니다.",
        "[[산정방식 저장]] 후 [[일괄산정]]을 다시 실행해야 명세에 반영됩니다.",
      ] },
    ],
    more: { article: "staffing.statements", section: "method" },
    sources: ["components/bonus/BonusStatementsBoard.tsx", "lib/bonus/statements.ts"],
    reviewedAt: "2026-10-20",
  },
  // ── 수행인력 실적 ──
  {
    id: "staffing.records-download",
    label: "증빙 다운로드 도움말",
    blocks: [
      { kind: "list", items: [
        "[[담당 계약]]에서 체크한 용역만 들어갑니다. 이력사항에도 체크한 용역만 실립니다.",
        "[[용역수행 실적증명서]]는 직인 날인본이 첨부된 용역만 포함됩니다. 없는 서류는 빠지고 결과 메시지에 ‘제외’ 건수가 나옵니다.",
        "파일 구성: 하나의 PDF로 병합 / 용역 건별 PDF(ZIP) / 항목별 분리·용역 건별 폴더(ZIP).",
      ] },
    ],
    more: { article: "staffing.records", section: "download" },
    sources: ["components/staffing/StaffingRecordsBoard.tsx", "lib/staffing/record-bundle.ts"],
    reviewedAt: "2026-10-20",
  },
];
