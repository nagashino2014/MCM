import type { ManualArticle } from "../types";

export const CALENDAR_ARTICLES: ManualArticle[] = [
  {
    id: "calendar.main",
    chapter: "calendar",
    title: "일정",
    routes: ["/calendar"],
    requires: [],
    audience: ["staff", "head", "exec", "admin"],
    summary: [
      "내 일정·부서 일정·회의·면접·차량·할 일을 한 달력에서 봅니다. 위쪽 태그로 보이는 종류를 고릅니다.",
      "날짜 칸을 누르면 출장·휴가·교육 신청(전자결재)이나 회의·면접·미팅 등록을 시작합니다.",
      "할 일 막대를 다른 날짜로 끌어 놓으면 할 날(마감일)이 바뀝니다.",
    ],
    sections: [
      {
        id: "tags",
        title: "보이는 일정 고르기",
        blocks: [
          { kind: "p", text: "달력 위 태그(본인·부서·영업·선택·차량·회의·면접·할 일)를 눌러 켜고 끕니다. 고른 상태는 저장되어 다음에도 유지됩니다." },
          { kind: "list", items: [
            "‘선택’은 내가 지정한 사람·부서의 일정입니다. 부서 단위로 지정하면 인사이동이 자동 반영되고, [[전사 전체]]를 켜면 개별 선택은 무시됩니다.",
            "‘영업’은 영업 권한이 있을 때만, ‘면접’은 참석자·면접 관리자에게만 보입니다.",
            "한 칸에 다 보이지 않으면 ‘+N’을 눌러 펼칩니다.",
          ] },
        ],
      },
      {
        id: "add",
        title: "날짜를 눌러 일정 추가",
        blocks: [
          {
            kind: "table",
            head: ["버튼", "결과", "누가"],
            rows: [
              ["[[출장 신청]] · [[휴가 신청]] · [[교육 신청]]", "전자결재 기안 화면이 날짜가 채워진 채 열립니다. 승인되면 달력에 표시됩니다.", "누구나"],
              ["[[회의 일정 등록]]", "회의를 바로 등록하고 참석자에게 알림", "관리자·임원"],
              ["[[면접 일정 등록]]", "면접자·채용 공고·이력서(PDF)와 함께 등록", "면접 관리자"],
              ["[[미팅 일정 등록]]", "외부 손님·발주처 방문 미팅 등록", "누구나"],
            ],
          },
          { kind: "tip", text: "출장·휴가·교육은 달력에 직접 넣을 수 없고 결재 문서로 만들어집니다. 권한이 없는 등록 버튼은 눌리지 않습니다." },
        ],
      },
      {
        id: "regular",
        title: "정기 회의",
        blocks: [
          { kind: "list", items: [
            "[[정기 회의 설정]](회의 등록 권한자)에서 회의명·요일·매월 몇째 주·기본 참석자를 정하면 회차가 자동으로 달력에 놓입니다.",
            "규칙을 바꿔 저장하면 오늘 이후 회차 중 손대지 않은 회차가 다시 배치됩니다.",
            "회차 하나를 열어 날짜를 바꾸면 그 회차만 조정되고, [[미시행 처리]]하면 ‘미시행’으로 남습니다.",
          ] },
        ],
      },
    ],
    keywords: ["일정", "캘린더", "달력", "회의", "면접", "미팅", "정기 회의", "출장 신청", "휴가 신청"],
    sources: ["components/calendar/CalendarBoard.tsx", "components/calendar/DayActionModal.tsx", "components/calendar/MeetingRulesModal.tsx", "components/calendar/CalendarEntryModal.tsx", "components/calendar/CalendarRefsModal.tsx"],
    reviewedAt: "2026-10-20",
  },
];
