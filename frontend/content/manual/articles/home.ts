import type { ManualArticle } from "../types";

export const HOME_ARTICLES: ManualArticle[] = [
  {
    id: "home.dashboard",
    chapter: "home",
    title: "홈 대시보드",
    routes: ["/home"],
    requires: [],
    audience: ["staff", "head", "exec", "admin"],
    summary: [
      "결재 대기·안 읽은 메일·오늘 일정 같은 숫자 카드를 누르면 해당 목록으로 이동합니다.",
      "내 연차·초과근무, 내 차례인 결재, 캘린더, 오늘 할 일 등을 한 화면에서 봅니다.",
      "[[홈 화면 편집]]으로 카드를 켜고 끄고, 위치·크기를 바꾸고, 배치를 3개까지 저장합니다.",
    ],
    sections: [
      {
        id: "cards",
        title: "카드 읽기",
        blocks: [
          { kind: "list", items: [
            "맨 위 숫자 카드(결재 대기, 안읽은 메일, 오늘 일정 등)를 누르면 아래 해당 카드로 이동하고, 카드가 꺼져 있으면 그 화면으로 이동합니다.",
            "권한이 없는 카드는 목록에 나오지 않습니다. 예를 들어 영업 카드는 영업 담당자에게만 보입니다.",
            "캘린더 카드의 태그(본인·영업·부서·선택 등)를 눌러 보이는 일정을 고릅니다.",
          ] },
          { kind: "tip", text: "홈 캘린더의 ‘선택’ 대상(최대 10명)과 일정 메뉴의 ‘선택’ 대상은 서로 다른 설정입니다." },
        ],
      },
      {
        id: "edit",
        title: "내 홈 꾸미기",
        blocks: [
          { kind: "steps", items: [
            "[[홈 화면 편집]]을 누릅니다.",
            "[[표시할 카드]]에서 보고 싶은 카드를 켜고 끕니다.",
            "카드 손잡이를 끌어 옮기고, 가장자리를 끌어 너비·높이를 바꿉니다.",
            "[[배치 프리셋]]에서 현재 배치를 1~3번 칸에 저장해 두면, 홈 위쪽 번호 칩으로 바로 바꿀 수 있습니다.",
            "[[편집 완료]]를 누릅니다.",
          ] },
          { kind: "p", text: "바꾼 배치는 그때그때 바로 저장됩니다. 따로 저장 버튼이 없습니다." },
          { kind: "warn", text: "[[기본값]]을 누르면 카드 표시와 배치가 처음 상태로 돌아가고 되돌릴 수 없습니다. 필요하면 먼저 프리셋에 저장하세요." },
        ],
      },
    ],
    keywords: ["홈", "대시보드", "위젯", "카드", "배치", "프리셋"],
    sources: ["components/home/HomeBoard.tsx", "components/home/HomeEditGrid.tsx"],
    reviewedAt: "2026-10-20",
  },
];
