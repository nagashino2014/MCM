import assert from "node:assert/strict";
import test from "node:test";
import { parseQuickAdd } from "../lib/todo/quick-parse";

// 기준일 2026-10-13(화). 주 시작 월요일 → 이번 주 = 10-12(월)~10-18(일).
const TODAY = "2026-10-13";
const parse = (text: string) => parseQuickAdd(text, { today: TODAY });

test("전체 토큰이 한 줄에서 분리되고 제목만 남는다", () => {
  const r = parse("내일 오후 3시 ○○사 미팅 !높음 #영업 @홍길동 10/30까지 //자료 준비");
  assert.equal(r.title, "○○사 미팅");
  assert.equal(r.doDate, "2026-10-14");
  assert.equal(r.doTime, "15:00");
  assert.equal(r.dueDate, "2026-10-30");
  assert.equal(r.priority, 3);
  assert.equal(r.boardToken, "영업");
  assert.equal(r.assigneeToken, "홍길동");
  assert.equal(r.note, "자료 준비");
  assert.equal(r.recurrence, null);
  // 토큰 범위는 원문과 일치
  for (const t of r.tokens) assert.equal(t.text, "내일 오후 3시 ○○사 미팅 !높음 #영업 @홍길동 10/30까지 //자료 준비".slice(t.start, t.end));
  assert.deepEqual(
    r.tokens.map((t) => t.kind),
    ["do_date", "do_time", "priority", "board", "assignee", "due_date", "note"]
  );
});

test("상대 날짜 — 오늘·내일·모레·글피·N일 뒤·N주 뒤", () => {
  assert.equal(parse("오늘 정리").doDate, "2026-10-13");
  assert.equal(parse("모레 정리").doDate, "2026-10-15");
  assert.equal(parse("글피 정리").doDate, "2026-10-16");
  assert.equal(parse("3일 뒤 전화").doDate, "2026-10-16");
  assert.equal(parse("2주 후 전화").doDate, "2026-10-27");
  assert.equal(parse("3일 뒤 전화").title, "전화");
});

test("주 표현 — 이번 주·다음 주·다다음 주 + 요일(주 시작 월), 지난 요일도 그대로", () => {
  assert.equal(parse("이번 주 금 보고서").doDate, "2026-10-16");
  assert.equal(parse("이번주 월 회의").doDate, "2026-10-12"); // 지난 월요일 — 명시 존중
  assert.equal(parse("다음 주 월 회의").doDate, "2026-10-19");
  assert.equal(parse("다다음 주 수요일 점검").doDate, "2026-10-28");
  assert.equal(parse("금요일 회식").doDate, "2026-10-16");
  assert.equal(parse("화요일 회식").doDate, "2026-10-13"); // 오늘이 화요일이면 오늘
});

test("주 시작을 일요일로 두면 이번 주 범위가 바뀐다", () => {
  // 10-13(화), 일요일 시작 → 이번 주 = 10-11(일)~10-17(토); 이번 주 일 = 10-11
  assert.equal(parseQuickAdd("이번 주 일 쉬기", { today: TODAY, weekStart: 0 }).doDate, "2026-10-11");
  assert.equal(parseQuickAdd("이번 주 일 쉬기", { today: TODAY, weekStart: 1 }).doDate, "2026-10-18");
});

test("절대 날짜 — M/D·M월 D일·D일(지났으면 다음 달)", () => {
  assert.equal(parse("10/21 발표").doDate, "2026-10-21");
  assert.equal(parse("10월 21일 발표").doDate, "2026-10-21");
  assert.equal(parse("21일 제출").doDate, "2026-10-21");
  assert.equal(parse("5일 정산").doDate, "2026-11-05");
  assert.equal(parse("13일 정산").doDate, "2026-10-13");
  assert.equal(parse("2/30 없는날").doDate, null); // 존재하지 않는 날짜는 무시
});

test("시각 — 오전/오후·N시 반·HH:mm·오전/오후 없는 1~6시는 오후, 지난 시각도 오늘 그대로", () => {
  assert.equal(parse("15:00 점검").doTime, "15:00");
  assert.equal(parse("15:00 점검").doDate, TODAY);
  assert.equal(parse("15시 반 점검").doTime, "15:30");
  assert.equal(parse("오전 9시 점검").doTime, "09:00");
  assert.equal(parse("오전 9시 10분 점검").doTime, "09:10");
  assert.equal(parse("9시 점검").doTime, "09:00");
  assert.equal(parse("3시 점검").doTime, "15:00");
  assert.equal(parse("오후 12시 점검").doTime, "12:00");
  assert.equal(parse("오전 12시 점검").doTime, "00:00");
  assert.equal(parse("오후 3:30 점검").doTime, "15:30");
  const past = parse("오늘 오전 7시 조깅");
  assert.equal(past.doDate, TODAY);
  assert.equal(past.doTime, "07:00");
  assert.equal(parse("3시간 뒤 전화").doTime, null); // "3시간"은 시각이 아니다
});

test("마감 — ~까지 / 마감 … 는 due 로 가고 do 는 비어 있다", () => {
  const a = parse("~내일까지 회신");
  assert.equal(a.dueDate, "2026-10-14");
  assert.equal(a.doDate, null);
  assert.equal(a.title, "회신");
  const b = parse("마감 10/30 견적");
  assert.equal(b.dueDate, "2026-10-30");
  assert.equal(b.doDate, null);
  const c = parse("내일 초안 다음 주 금까지 제출");
  assert.equal(c.doDate, "2026-10-14");
  assert.equal(c.dueDate, "2026-10-23"); // 다음 주 금 = 10-23(이번 주 금은 10-16)
  assert.equal(c.title, "초안 제출");
});

test("반복 6종 + 매주(요일 없음)는 할 날짜 요일을 따른다", () => {
  assert.equal(parse("매일 운동").recurrence, "daily");
  assert.equal(parse("평일 체크").recurrence, "weekdays");
  assert.equal(parse("매주 월·수 회의").recurrence, "weekly:MO,WE");
  assert.equal(parse("매주 월요일 회의").recurrence, "weekly:MO");
  assert.equal(parse("매월 15일 보고").recurrence, "monthly:15");
  assert.equal(parse("매월 15일 보고").doDate, null); // 반복이 날짜로 오인되지 않는다
  assert.equal(parse("매월 말일 정산").recurrence, "monthly:last");
  assert.equal(parse("완료 후 7일 점검").recurrence, "after:7");
  assert.equal(parse("완료 후 7일 점검").doDate, null);
  assert.equal(parse("매주 보고 다음 주 금").recurrence, "weekly:FR");
  assert.equal(parse("매주 보고").recurrence, "weekly:TU");
  assert.equal(parse("매년 3월 1일 기념").recurrence, "yearly:03-01");
});

test("우선순위 — 한글·숫자(3=높음)", () => {
  assert.equal(parse("!보통 정리").priority, 2);
  assert.equal(parse("!낮음 정리").priority, 1);
  assert.equal(parse("정리 !3").priority, 3);
  assert.equal(parse("정리 !1").priority, 1);
  assert.equal(parse("정리!").priority, null);
  assert.equal(parse("정리 !1").title, "정리");
});

test("빈 입력·토큰만 입력", () => {
  const r = parse("");
  assert.equal(r.title, "");
  assert.equal(r.tokens.length, 0);
  const t = parse("내일");
  assert.equal(t.title, "");
  assert.equal(t.doDate, "2026-10-14");
});

test("잘못된 기준일은 오늘로 대체되어 예외가 없다", () => {
  const r = parseQuickAdd("내일 회의", { today: "not-a-date" });
  assert.match(r.doDate ?? "", /^\d{4}-\d{2}-\d{2}$/);
});
