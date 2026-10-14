/*
 * fractional index — 열·리스트 안의 수동 순서 키. 순수 TS(외부 패키지 없음, Figma 방식 자체 구현).
 *
 * 키 = 정수부 + (선택) 소수부. 문자는 ALPHABET(ASCII 순 '0-9A-Za-z') 이며 DB 는 `position text COLLATE "C"` 로
 * 바이트 순 비교한다. 정수부 첫 글자가 길이를 정한다('a'=2자리 … 'z'=27자리, 'Z'=음수 2자리 … 'A'=27자리) —
 * 그래서 맨 앞/맨 뒤 추가는 정수부만 ±1 해 키 길이가 늘지 않고, 사이 삽입만 소수부가 자란다.
 * 소수부는 '0'으로 끝나지 않는다(그래야 어떤 두 키 사이에도 항상 새 키가 있다). 첫 키는 "a0".
 */

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ZERO = ALPHABET[0];
const LAST = ALPHABET[ALPHABET.length - 1];
const BASE = ALPHABET.length;
const SMALLEST = "A" + ZERO.repeat(26);

/** 비어 있는 열에 처음 넣을 때의 키. */
export const FIRST_POSITION = "a0";

function integerLength(head: string): number {
  if (head >= "a" && head <= "z") return head.charCodeAt(0) - "a".charCodeAt(0) + 2;
  if (head >= "A" && head <= "Z") return "Z".charCodeAt(0) - head.charCodeAt(0) + 2;
  throw new Error(`position: invalid head ${JSON.stringify(head)}`);
}

function integerPart(key: string): string {
  const n = integerLength(key[0]);
  if (n > key.length) throw new Error(`position: invalid ${JSON.stringify(key)}`);
  return key.slice(0, n);
}

function validate(key: string): void {
  if (!key) throw new Error("position: empty");
  if (key === SMALLEST) throw new Error("position: smallest key");
  for (const ch of key) if (ALPHABET.indexOf(ch) < 0) throw new Error(`position: invalid char in ${JSON.stringify(key)}`);
  const i = integerPart(key);
  const f = key.slice(i.length);
  if (f.endsWith(ZERO)) throw new Error(`position: trailing zero ${JSON.stringify(key)}`);
}

export function isValidPosition(key: string): boolean {
  try {
    validate(key);
    return true;
  } catch {
    return false;
  }
}

function incrementInteger(x: string): string | null {
  const head = x[0];
  const digs = x.slice(1).split("");
  let carry = true;
  for (let i = digs.length - 1; carry && i >= 0; i--) {
    const d = ALPHABET.indexOf(digs[i]) + 1;
    if (d === BASE) digs[i] = ZERO;
    else {
      digs[i] = ALPHABET[d];
      carry = false;
    }
  }
  if (!carry) return head + digs.join("");
  if (head === "Z") return "a" + ZERO;
  if (head === "z") return null;
  const h = String.fromCharCode(head.charCodeAt(0) + 1);
  if (h > "a") digs.push(ZERO);
  else digs.pop();
  return h + digs.join("");
}

function decrementInteger(x: string): string | null {
  const head = x[0];
  const digs = x.slice(1).split("");
  let borrow = true;
  for (let i = digs.length - 1; borrow && i >= 0; i--) {
    const d = ALPHABET.indexOf(digs[i]) - 1;
    if (d === -1) digs[i] = LAST;
    else {
      digs[i] = ALPHABET[d];
      borrow = false;
    }
  }
  if (!borrow) return head + digs.join("");
  if (head === "a") return "Z" + LAST;
  if (head === "A") return null;
  const h = String.fromCharCode(head.charCodeAt(0) - 1);
  // 음수 정수부는 head 가 낮아질수록 자릿수가 늘어난다('Z'=2자리, 'Y'=3자리 …).
  if (h < "Z") digs.push(LAST);
  else digs.pop();
  return h + digs.join("");
}

/** a < b 인 두 소수부의 중간. b 가 undefined 면 상한 없음. 결과는 '0'으로 끝나지 않는다. */
function midpoint(a: string, b: string | undefined): string {
  if (b !== undefined && a >= b) throw new Error(`position order: ${JSON.stringify(a)} >= ${JSON.stringify(b)}`);
  if (a.endsWith(ZERO) || (b !== undefined && b.endsWith(ZERO))) throw new Error("position: trailing zero");
  if (b !== undefined) {
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? ALPHABET.indexOf(a[0]) : 0;
  const digitB = b !== undefined ? ALPHABET.indexOf(b[0]) : BASE;
  if (digitB - digitA > 1) return ALPHABET[Math.round(0.5 * (digitA + digitB))];
  if (b !== undefined && b.length > 1) return b.slice(0, 1);
  return ALPHABET[digitA] + midpoint(a.slice(1), undefined);
}

/**
 * a 와 b 사이의 새 키. a=null → 맨 앞, b=null → 맨 뒤, 둘 다 null → FIRST_POSITION.
 * a ≥ b 이면 예외(호출부가 정렬된 이웃을 넘겨야 한다).
 */
export function between(a: string | null | undefined, b: string | null | undefined): string {
  if (a != null) validate(a);
  if (b != null) validate(b);
  if (a != null && b != null && a >= b) throw new Error(`position order: ${JSON.stringify(a)} >= ${JSON.stringify(b)}`);
  if (a == null) {
    if (b == null) return FIRST_POSITION;
    const ib = integerPart(b);
    const fb = b.slice(ib.length);
    if (ib === SMALLEST) return ib + midpoint("", fb);
    if (ib < b) return ib;
    const res = decrementInteger(ib);
    if (res == null) throw new Error("position: cannot decrement any more");
    return res;
  }
  if (b == null) {
    const ia = integerPart(a);
    const fa = a.slice(ia.length);
    const i = incrementInteger(ia);
    return i == null ? ia + midpoint(fa, undefined) : i;
  }
  const ia = integerPart(a);
  const fa = a.slice(ia.length);
  const ib = integerPart(b);
  const fb = b.slice(ib.length);
  if (ia === ib) return ia + midpoint(fa, fb);
  const i = incrementInteger(ia);
  if (i == null) throw new Error("position: cannot increment any more");
  if (i < b) return i;
  return ia + midpoint(fa, undefined);
}

/** 바이트 순 비교(COLLATE "C" 와 동일). */
export function comparePosition(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 정렬된 키 목록에서 index 위치에 끼워 넣을 새 키(index 는 0..length). */
export function positionAt(sorted: string[], index: number): string {
  const i = Math.max(0, Math.min(index, sorted.length));
  return between(i > 0 ? sorted[i - 1] : null, i < sorted.length ? sorted[i] : null);
}
