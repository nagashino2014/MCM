import type { ManualChapter } from "./types";

/** 장 순서 = 사이드바 그룹 순서(시작하기 → 홈 → 협업 → 업무 → 사업 운영 → 관리 → 시나리오 → 부록). */
export const MANUAL_CHAPTERS: ManualChapter[] = [
  { id: "start", title: "시작하기", group: "start" },
  { id: "home", title: "홈", group: "home" },
  { id: "mail", title: "메일", group: "collab" },
  { id: "approval", title: "전자결재", group: "collab" },
  { id: "files", title: "파일 · 문서함", group: "collab" },
  { id: "calendar", title: "일정", group: "collab" },
  { id: "todo", title: "할 일", group: "collab" },
  { id: "work-plan", title: "업무추진계획", group: "work" },
  { id: "payroll", title: "급여 · 근로계약", group: "work" },
  { id: "hr", title: "근태 · 휴가", group: "work" },
  { id: "scenario", title: "업무 시나리오", group: "scenario" },
];

export const MANUAL_GROUP_LABEL: Record<ManualChapter["group"], string> = {
  start: "시작하기",
  home: "홈",
  collab: "협업",
  work: "업무",
  main: "사업 운영",
  system: "관리",
  scenario: "따라하기",
  appendix: "부록",
};
