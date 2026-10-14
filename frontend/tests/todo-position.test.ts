import assert from "node:assert/strict";
import test from "node:test";
import { FIRST_POSITION, between, comparePosition, isValidPosition, positionAt } from "../lib/todo/position";

test("기본 키·앞뒤 삽입", () => {
  assert.equal(between(null, null), FIRST_POSITION);
  assert.ok(isValidPosition(FIRST_POSITION));
  const after = between(FIRST_POSITION, null);
  const before = between(null, FIRST_POSITION);
  assert.ok(before < FIRST_POSITION && FIRST_POSITION < after);
  assert.ok(isValidPosition(after) && isValidPosition(before));
  assert.equal(after, "a1");
  assert.equal(before, "Zz");
});

test("맨 뒤에 연속 추가하면 단조 증가하고 키 길이가 늘지 않는다(정수부 증가)", () => {
  let prev = between(null, null);
  for (let i = 0; i < 500; i++) {
    const next = between(prev, null);
    assert.ok(next > prev, `${prev} < ${next}`);
    assert.ok(isValidPosition(next));
    prev = next;
  }
  assert.ok(prev.length <= 3, `길이 ${prev.length}`);
});

test("맨 앞에 연속 추가", () => {
  let prev = between(null, null);
  for (let i = 0; i < 500; i++) {
    const next = between(null, prev);
    assert.ok(next < prev, `${next} < ${prev}`);
    assert.ok(isValidPosition(next));
    prev = next;
  }
  assert.ok(prev.length <= 3, `길이 ${prev.length}`);
});

test("두 키 사이에 계속 끼워 넣어도 순서가 유지된다(소수부 성장)", () => {
  const a = between(null, null);
  const b = between(a, null);
  let lo = a;
  let hi = b;
  for (let i = 0; i < 100; i++) {
    const mid = between(lo, hi);
    assert.ok(lo < mid && mid < hi, `${lo} < ${mid} < ${hi}`);
    assert.ok(isValidPosition(mid));
    if (i % 2 === 0) lo = mid;
    else hi = mid;
  }
});

test("인접 정수 키 사이·소수부 있는 키 사이", () => {
  const mid = between("a0", "a1");
  assert.ok("a0" < mid && mid < "a1");
  assert.equal(mid, "a0V");
  const mid2 = between("a0V", "a1");
  assert.ok("a0V" < mid2 && mid2 < "a1");
  const mid3 = between("a0", "a0V");
  assert.ok("a0" < mid3 && mid3 < "a0V");
  // 정수부 자리 올림: a9 → aA, az → b00
  assert.equal(between("a9", null), "aA");
  assert.equal(between("az", null), "b00");
  assert.equal(between(null, "a0"), "Zz");
});

test("무작위 삽입 결과가 바이트 정렬과 일치한다", () => {
  const keys: string[] = [between(null, null)];
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 300; i++) {
    const idx = Math.floor(rnd() * (keys.length + 1));
    const key = positionAt(keys, idx);
    keys.splice(idx, 0, key);
  }
  const sorted = [...keys].sort(comparePosition);
  assert.deepEqual(keys, sorted);
  assert.equal(new Set(keys).size, keys.length);
});

test("잘못된 입력은 예외", () => {
  assert.throws(() => between("a1", "a0"));
  assert.throws(() => between("a0", "a0"));
  assert.throws(() => between("a0V0", null)); // 소수부 끝 0
  assert.throws(() => between("가", null));
  assert.throws(() => between("V", null)); // 정수부 길이 부족
  assert.equal(isValidPosition(""), false);
  assert.equal(isValidPosition("a0"), true);
  assert.equal(isValidPosition("A00000000000000000000000000"), false); // 최소 키는 쓰지 않는다
});
