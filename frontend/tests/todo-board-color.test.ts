import assert from "node:assert/strict";
import test from "node:test";
import {
  TODO_APPROVAL_COLORS,
  TODO_BOARD_AUTO_COLOR_KEYS,
  TODO_BOARD_COLORS,
  isTodoBoardColorKey,
  pickBoardColorKey,
  todoApprovalColorHex,
  todoBoardColorHex,
} from "../lib/todo/types";

test("팔레트 — 8색, 자동 배정은 gray 제외 7색, 키 판정", () => {
  assert.equal(Object.keys(TODO_BOARD_COLORS).length, 8);
  assert.equal(TODO_BOARD_AUTO_COLOR_KEYS.length, 7);
  assert.ok(!TODO_BOARD_AUTO_COLOR_KEYS.includes("gray"));
  assert.ok(isTodoBoardColorKey("mint"));
  assert.ok(!isTodoBoardColorKey("#CDACE6"));
  assert.ok(!isTodoBoardColorKey("toString")); // 프로토타입 키는 거절
});

test("자동 배정 — 빈 목록이면 첫 색, 쓰인 색을 건너뛰어 순환, 삭제로 빈 색이 생기면 그 색부터", () => {
  assert.equal(pickBoardColorKey([]), "lavender");
  const used: string[] = [];
  const seq: string[] = [];
  for (let i = 0; i < 7; i++) {
    const k = pickBoardColorKey(used);
    seq.push(k);
    used.push(k);
  }
  assert.deepEqual(seq, TODO_BOARD_AUTO_COLOR_KEYS);
  // 7색 다 쓴 뒤 8번째는 다시 첫 색(순환)
  assert.equal(pickBoardColorKey(used), "lavender");
  // rose 가 비면 rose 를 우선(가장 적게 쓰인 색)
  assert.equal(pickBoardColorKey(used.filter((k) => k !== "rose")), "rose");
  // gray·null·알 수 없는 값은 집계에서 무시
  assert.equal(pickBoardColorKey(["gray", null, undefined, "neon"]), "lavender");
});

test("색 키 → hex, 종류 기본색", () => {
  assert.equal(todoBoardColorHex("lavender"), "#CDACE6");
  assert.equal(todoBoardColorHex(null, "personal"), TODO_BOARD_COLORS.gray);
  assert.equal(todoBoardColorHex(null, "project"), TODO_BOARD_COLORS.sky);
  assert.equal(todoBoardColorHex("bogus", "dept"), TODO_BOARD_COLORS.sky);
  assert.equal(todoBoardColorHex(undefined), TODO_BOARD_COLORS.gray);
});

test("결재 종류 색 — 출장·휴가·교육·초과근무 고정, 그 외 민트", () => {
  assert.equal(todoApprovalColorHex("trip"), TODO_APPROVAL_COLORS.trip);
  assert.equal(todoApprovalColorHex("leave"), "#BDD7EE");
  assert.equal(todoApprovalColorHex("meeting"), "#B9E4DC");
});
