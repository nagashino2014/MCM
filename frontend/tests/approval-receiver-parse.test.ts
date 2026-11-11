import assert from "node:assert/strict";
import test from "node:test";
import { formatReceivers, parseReceiverPiece, parseReceivers } from "../lib/approval/receiver-parse";

// 접견인 자유 입력 파서 — 미계약 업체 출장보고서(2026-11-11).

test("기본 — 성명 직함을 쉼표로 구분", () => {
  assert.deepEqual(parseReceivers("홍길동 부장, 김철수 대리"), [
    { name: "홍길동", title: "부장" },
    { name: "김철수", title: "대리" },
  ]);
});

test("구분자 — 전각 쉼표·세미콜론·슬래시·줄바꿈·연속 구분자", () => {
  assert.deepEqual(
    parseReceivers("홍길동 부장，김철수 대리、이영희 과장; 박민수 팀장 / 최지우 주임\n정하나 사원,, "),
    [
      { name: "홍길동", title: "부장" },
      { name: "김철수", title: "대리" },
      { name: "이영희", title: "과장" },
      { name: "박민수", title: "팀장" },
      { name: "최지우", title: "주임" },
      { name: "정하나", title: "사원" },
    ]
  );
});

test("붙여 쓴 직함 — 긴 직함부터 뗀다", () => {
  assert.deepEqual(parseReceiverPiece("홍길동부장"), { name: "홍길동", title: "부장" });
  assert.deepEqual(parseReceiverPiece("김철수대표이사"), { name: "김철수", title: "대표이사" });
  assert.deepEqual(parseReceiverPiece("이영희책임연구원"), { name: "이영희", title: "책임연구원" });
  assert.deepEqual(parseReceiverPiece("김대리"), { name: "김", title: "대리" });
});

test("직함 없음 — 성명만", () => {
  assert.deepEqual(parseReceivers("홍길동, 김철수"), [
    { name: "홍길동", title: "" },
    { name: "김철수", title: "" },
  ]);
  // 직함 낱말 그 자체는 성명으로 둔다(떼어 낼 이름이 없다)
  assert.deepEqual(parseReceiverPiece("부장"), { name: "부장", title: "" });
});

test("괄호·높임말·직함 먼저·부서 포함", () => {
  assert.deepEqual(parseReceiverPiece("홍길동(부장)"), { name: "홍길동", title: "부장" });
  assert.deepEqual(parseReceiverPiece("홍길동 （환경팀 부장）"), { name: "홍길동", title: "환경팀 부장" });
  assert.deepEqual(parseReceiverPiece("홍길동 부장님"), { name: "홍길동", title: "부장" });
  assert.deepEqual(parseReceiverPiece("부장 홍길동"), { name: "홍길동", title: "부장" });
  assert.deepEqual(parseReceiverPiece("홍길동 환경안전팀 팀장"), { name: "홍길동", title: "환경안전팀 팀장" });
  assert.deepEqual(parseReceiverPiece("  홍길동　  부장 "), { name: "홍길동", title: "부장" });
});

test("빈 입력·중복", () => {
  assert.deepEqual(parseReceivers(""), []);
  assert.deepEqual(parseReceivers(" , ,"), []);
  assert.deepEqual(parseReceivers("홍길동 부장, 홍길동 부장, 홍길동 차장"), [
    { name: "홍길동", title: "부장" },
    { name: "홍길동", title: "차장" },
  ]);
});

test("되돌리기 — 목록을 입력란 문자열로", () => {
  const text = formatReceivers([{ name: "홍길동", title: "부장" }, { name: "김철수", title: "" }, { name: "", title: "x" }]);
  assert.equal(text, "홍길동 부장, 김철수");
  assert.deepEqual(parseReceivers(text), [
    { name: "홍길동", title: "부장" },
    { name: "김철수", title: "" },
  ]);
});
