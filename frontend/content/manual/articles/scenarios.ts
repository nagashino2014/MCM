import type { ManualArticle } from "../types";

/** 여러 메뉴를 가로지르는 따라하기(docs/manual-help-blueprint.md §2.1). 화면이 없으므로 routes 는 비운다. */
export const SCENARIO_ARTICLES: ManualArticle[] = [
  {
    id: "scenario.leave",
    chapter: "scenario",
    title: "휴가 신청부터 연차 차감까지",
    routes: [],
    requires: [],
    audience: ["staff", "head", "exec", "admin"],
    summary: [
      "휴가는 전자결재의 휴가신청서로 신청합니다.",
      "승인되면 내 휴가에 자동으로 기록되고 연차가 차감됩니다.",
      "취소·변경은 반려 요청으로 합니다.",
    ],
    sections: [
      {
        id: "steps",
        title: "따라하기",
        blocks: [
          { kind: "steps", items: [
            "일정 메뉴에서 휴가 첫날을 누르고 [[휴가 신청]]을 고릅니다. (또는 [[새로 작성]] → [[새 기안]] → 휴가신청서)",
            "휴가 종류와 기간을 넣습니다. 화면 위쪽에 잔여 연차가 보입니다. 반차는 0.5일입니다.",
            "결재선을 확인하고 [[상신]]합니다.",
            "결재자가 승인하면 [[내 휴가·근태]]의 사용 내역과 잔여 연차에 바로 반영되고, 달력에도 표시됩니다.",
          ] },
          { kind: "p", text: "결재 중에 일정을 바꿔야 하면 결재함의 내 문서에서 반려 요청을 보내고, 반려되면 고쳐서 다시 올립니다. 이미 승인된 휴가를 취소하려면 반려 요청으로 관리자에게 결재 취소를 요청합니다. 취소되면 차감된 연차가 돌아옵니다." },
          { kind: "tip", text: "휴가 중 결재가 멈추지 않게 하려면 [[휴가 연동 기본 대결자]]를 미리 지정해 두세요." },
          { kind: "link", article: "approval.absence", label: "부재·대결 설정" },
        ],
      },
    ],
    keywords: ["휴가 신청", "연차 신청", "반차", "휴가 취소"],
    sources: ["components/calendar/DayActionModal.tsx", "components/layout/TopBar.tsx", "components/approval/ApprovalDraftBoard.tsx", "components/approval/MyHrBoard.tsx", "components/approval/ApprovalAbsenceBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "scenario.trip",
    chapter: "scenario",
    title: "출장 신청부터 경비 정산까지",
    routes: [],
    requires: [],
    audience: ["staff", "head", "exec", "admin"],
    summary: [
      "출장신청서로 신청하면 법인차량 이용이 자산 예약 현황에 표시됩니다.",
      "다녀온 뒤 출장보고서에 신청서를 선행 문서로 연결하고 카드·영수증 내역을 불러옵니다.",
      "숙박 출장이면 승인 후 숙박출장수당이 급여에 반영됩니다.",
    ],
    sections: [
      {
        id: "steps",
        title: "따라하기",
        blocks: [
          { kind: "steps", items: [
            "일정에서 출장 첫날을 누르고 [[출장 신청]]을 고릅니다. 기간·목적·법인차량을 넣고 상신합니다.",
            "출장 중 개인카드로 쓴 영수증은 휴대폰 앱의 영수증 촬영으로 바로 찍어 둡니다(지출 목적: 출장 경비).",
            "다녀오면 출장보고서를 엽니다. [[선행 문서 선택]]으로 출장신청서를 연결합니다.",
            "출장 기간을 확인하고 [[법인카드 내역 불러오기]] / [[개인카드 영수증 불러오기]]로 지출 내역을 채웁니다. 각 행의 지출 목적과 연관 용역을 고릅니다.",
            "상신합니다. 신청서와 다른 값이 있으면 결재자에게 경고로 보이니, 바뀐 사유를 본문에 적어 두세요.",
          ] },
          { kind: "flow", items: [
            { from: "출장보고서 승인(숙박)", to: "급여대장 숙박출장수당" },
            { from: "개인카드 지출", to: "월 1회 경비 정산 후 개인 계좌로 환급" },
          ] },
        ],
      },
    ],
    keywords: ["출장", "출장 신청", "출장보고서", "법인차량", "영수증", "경비 정산", "숙박"],
    sources: ["components/calendar/DayActionModal.tsx", "components/approval/ApprovalDraftBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "scenario.letter",
    chapter: "scenario",
    title: "공문 보내기 — 작성부터 재발송까지",
    routes: [],
    requires: [],
    audience: ["staff", "head", "exec", "admin"],
    summary: [
      "공문을 작성해 결재를 받으면 승인과 동시에 상대 담당자에게 메일로 발송됩니다.",
      "발송 실패나 내용 수정은 문서에서 다시 처리합니다.",
    ],
    sections: [
      {
        id: "steps",
        title: "따라하기",
        blocks: [
          { kind: "steps", items: [
            "[[새로 작성]] → [[새 기안]] → 공문 양식을 고릅니다.",
            "수신처(업체)를 고르고, 실제로 메일을 받을 담당자를 [[참조]]에 넣습니다. 필요하면 [[외부 참조]]를 추가합니다.",
            "제목·본문·붙임을 쓰고 [[미리보기·조정]]으로 지면을 확인합니다.",
            "결재선을 정하고 [[상신]]합니다. 이때 공문번호가 확정됩니다.",
            "최종 승인되면 PDF가 만들어져 기안자 명의로 참조 담당자에게 메일이 나갑니다.",
            "문서함 [[발송공문]]에서 발송 결과를 확인합니다. 실패했으면 눌러서 다시 보냅니다.",
          ] },
          { kind: "p", text: "보낸 공문을 고쳐 다시 보내야 하면 문서에서 [[수정 후 재발송]]을 눌러 재결재를 받습니다. 발송 이력이 차수별로 남습니다." },
          { kind: "link", article: "approval.letter", label: "공문 작성 자세히" },
        ],
      },
    ],
    keywords: ["공문 발송", "공문 보내기", "재발송"],
    sources: ["components/layout/TopBar.tsx", "components/approval/ApprovalLetterBoard.tsx", "components/approval/ApprovalArchiveBoard.tsx", "components/approval/ApprovalDocModal.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "scenario.weekly-report",
    chapter: "scenario",
    title: "주간 업무보고 — 작성에서 임원 보고까지",
    routes: [],
    requires: ["work_plan.view"],
    audience: ["staff", "head", "exec"],
    summary: [
      "담당자가 용역별로 보고를 제출하면 부서장이 확인해 부서 통합 보고를 만들고, 임원이 검토·지시합니다.",
    ],
    sections: [
      {
        id: "staff",
        title: "담당자",
        blocks: [
          { kind: "steps", items: [
            "업무추진계획 화면에서 진행 중인 용역을 고릅니다.",
            "공정표에서 이번 주에 바뀐 단계만 갱신하고, [[이번 기간]]·[[다음 기간]] 추진 내역을 씁니다.",
            "[[제출]]합니다. 반려되면 [[재보고 대상]]에서 부서장 의견을 보고 고쳐 [[수정 제출]]합니다.",
          ] },
          { kind: "tip", text: "할 일에서 계약과 연결된 작업을 관리하고 있다면, 할 일 상세의 업무 보고 초안으로 시작할 수 있습니다." },
        ],
      },
      {
        id: "head",
        title: "부서장",
        requires: ["work_plan.merge", "work_plan.lock_release"],
        blocks: [
          { kind: "steps", items: [
            "부서장 감독 화면에서 부서원 보고를 열고 의견을 남깁니다.",
            "보완이 필요하면 의견 분류를 고른 뒤 [[반려]], 문제가 없으면 [[확인]]합니다.",
            "확인한 보고를 모아 통합 보고를 만들면 임원 화면으로 올라갑니다.",
            "임원 지시가 내려오면 [[임원지시]]에서 답변을 쓰고 [[재보고]]합니다.",
          ] },
        ],
      },
      {
        id: "exec",
        title: "임원",
        requires: ["work_plan.directive"],
        blocks: [
          { kind: "p", text: "임원 검토·지시 화면에는 부서장이 통합 보고까지 마친 건만 나옵니다. 지시 종류를 골라 [[지시 하달]]하고, 회의에서는 발표 모드(←/→ 키)로 넘겨 봅니다." },
        ],
      },
    ],
    keywords: ["주간 보고", "업무보고 절차", "부서장 검토", "임원 지시"],
    sources: ["components/work-plan/ReportEditor.tsx", "components/work-plan/ServiceListPanel.tsx", "components/work-plan/OversightWorkspace.tsx", "components/work-plan/ExecWorkspace.tsx"],
    reviewedAt: "2026-10-20",
  },
];
