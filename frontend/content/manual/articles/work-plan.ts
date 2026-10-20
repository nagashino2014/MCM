import type { ManualArticle } from "../types";

export const WORK_PLAN_ARTICLES: ManualArticle[] = [
  {
    id: "work-plan.report",
    chapter: "work-plan",
    title: "업무추진계획 보고 작성",
    routes: ["/work-plan$", "/work-plan/new", "/work-plan/*"],
    audience: ["staff", "head", "exec", "admin"],
    summary: [
      "내가 수행 중인 용역(계약) 또는 사내 업무(Task)의 공정·진행 상황·추진 내역을 주기적으로 보고합니다.",
      "제출한 보고는 부서장이 검토해 확인·반려하고, 확인된 보고는 부서 통합 보고로 임원에게 올라갑니다.",
      "반려된 보고는 [[재보고 대상]]에 부서장 의견과 함께 나타납니다.",
    ],
    sections: [
      {
        id: "flow",
        title: "보고가 흘러가는 길",
        blocks: [
          { kind: "flow", items: [
            { from: "담당자 [[제출]]", to: "부서장 감독 화면에서 검토" },
            { from: "부서장 [[반려]]", to: "담당자의 [[재보고 대상]]으로 — 고쳐서 [[수정 제출]]" },
            { from: "부서장 [[확인]]", to: "통합 대상 → 부서 통합 보고 → 임원 검토" },
            { from: "임원 [[지시 하달]]", to: "부서장이 답변(재보고)" },
          ] },
        ],
      },
      {
        id: "write",
        title: "보고 쓰기",
        blocks: [
          { kind: "steps", items: [
            "왼쪽에서 [[용역]] 또는 Task 탭을 고르고 진행 중인 항목을 누릅니다. 처음이면 [[새 업무추진계획]]을 누릅니다.",
            "용역은 [[용역 선택 (내 수행 용역)]]에서 고르고, 사내 업무는 업무분류를 고른 뒤 [[Task 생성]]으로 만듭니다.",
            "보고 기간·[[회의 종류]]·[[회의일자]]를 확인합니다. 회차는 회의 종류마다 자동으로 매겨집니다.",
            "공정표에서 이번 기간에 바뀐 단계를 눌러 상태·착수일·완료일·진행률을 입력합니다.",
            "[[추진 내역]]에 [[이번 기간]] 한 일과 [[다음 기간]] 할 일을 적습니다.",
            "[[임시 저장]]하거나 [[제출]]합니다.",
          ] },
        ],
      },
      {
        id: "stages",
        title: "공정표와 진행률",
        blocks: [
          { kind: "list", items: [
            "보고에는 **이번에 바꾼 단계만** 기록됩니다. 색이 칠해진 단계가 이번 보고분이고, 나머지는 지난 보고까지 쌓인 상태입니다.",
            "진행률은 상태가 ‘진행 중’일 때만 입력할 수 있고, 단계마다 정한 단위(기본 10%)로만 움직입니다. 완료는 100%, 대기는 0%로 고정됩니다.",
            "단계 구성은 [[공정표 설정]]에서 바꾸며, 자주 쓰는 구성은 프리셋으로 저장합니다.",
          ] },
        ],
      },
      {
        id: "lock",
        title: "제출 뒤 고치기",
        blocks: [
          { kind: "p", text: "저장한 보고를 다시 열면 잠긴 상태로 보입니다. [[수정]]을 누르면 풀리고, 고친 뒤 [[수정 제출]]합니다." },
          { kind: "tip", text: "‘수행 중인 용역이 없습니다’가 나오면 계정이 직원 정보와 연결돼 있는지, 계약에 수행인력으로 지정돼 있는지 관리자에게 확인하세요." },
          { kind: "warn", text: "목록에서 우클릭 → [[이 용역의 업무보고 삭제]]는 그 용역의 보고를 모두 지우며 되돌릴 수 없습니다(계약·공정표 원본은 남습니다)." },
        ],
      },
    ],
    keywords: ["업무추진계획", "업무보고", "주간보고", "공정표", "진행률", "추진 내역", "재보고", "Task"],
    sources: ["components/work-plan/ServiceWorkspace.tsx", "components/work-plan/ServiceListPanel.tsx", "components/work-plan/NewEntryPanel.tsx", "components/work-plan/TaskCreateForm.tsx", "components/work-plan/ReportEditor.tsx", "components/work-plan/OversightWorkspace.tsx", "components/work-plan/ExecWorkspace.tsx"],
    reviewedAt: "2026-10-20",
  },
];
