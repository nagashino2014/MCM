/**
 * 외부 메일 프로그램 게이트웨이 — IMAP 전송 계층(명령 읽기·토큰화·응답 인코딩).
 * RFC 3501(IMAP4rev1) 문법 중 클라이언트 명령에 필요한 부분과 LITERAL+(RFC 7888)를 다룬다.
 * 바이트 단위로 처리한다(리터럴 안 8비트 원문·UTF-8 문자열 보존). 설계: docs/mail-external-client-plan.md §3.
 */

/** 명령 한 줄을 이루는 조각 — 텍스트(리터럴 표식 `{n}` 포함)와 리터럴 바이트가 번갈아 온다. */
export type WireSegment = { kind: "text"; data: Buffer } | { kind: "literal"; data: Buffer };

export interface WireReaderOptions {
  /** 리터럴 하나의 최대 크기(APPEND 원문 포함). */
  maxLiteral: number;
  /** 리터럴을 뺀 한 줄의 최대 길이. */
  maxLine: number;
  /** 동기 리터럴(`{n}`) 수신 전 "+" 계속 응답을 보낸다. */
  onContinue: () => void;
  /** 완성된 명령(조각 묶음)을 넘긴다. */
  onCommand: (segments: WireSegment[]) => void;
  /** 한도 초과 등 회복 불가 오류. */
  onError: (message: string) => void;
}

const LITERAL_TAIL = /\{(\d{1,10})(\+)?\}$/;

/** 소켓 바이트를 명령 단위로 자른다. IDLE 의 DONE·AUTHENTICATE 응답 줄도 같은 경로로 한 줄 명령처럼 나온다. */
export class ImapWireReader {
  private buf: Buffer = Buffer.alloc(0);
  private segments: WireSegment[] = [];
  private literalLeft = 0;
  private literalChunks: Buffer[] = [];
  private lineBytes = 0;
  private failed = false;

  constructor(private readonly opts: WireReaderOptions) {}

  feed(chunk: Buffer): void {
    if (this.failed) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (this.buf.length && !this.failed) {
      if (this.literalLeft > 0) {
        const take = Math.min(this.literalLeft, this.buf.length);
        this.literalChunks.push(this.buf.subarray(0, take));
        this.buf = this.buf.subarray(take);
        this.literalLeft -= take;
        if (this.literalLeft === 0) {
          this.segments.push({ kind: "literal", data: Buffer.concat(this.literalChunks) });
          this.literalChunks = [];
        }
        continue;
      }
      const lf = this.buf.indexOf(0x0a);
      if (lf < 0) {
        if (this.buf.length + this.lineBytes > this.opts.maxLine) this.fail("명령 줄이 너무 깁니다.");
        return;
      }
      const end = lf > 0 && this.buf[lf - 1] === 0x0d ? lf - 1 : lf;
      const line = this.buf.subarray(0, end);
      this.buf = this.buf.subarray(lf + 1);
      this.lineBytes += line.length;
      if (this.lineBytes > this.opts.maxLine) {
        this.fail("명령 줄이 너무 깁니다.");
        return;
      }
      this.segments.push({ kind: "text", data: Buffer.from(line) });
      const tail = line.subarray(Math.max(0, line.length - 14)).toString("latin1");
      const m = tail.match(LITERAL_TAIL);
      if (m) {
        const size = Number(m[1]);
        if (size > this.opts.maxLiteral) {
          this.fail(`리터럴이 너무 큽니다(${size} 바이트).`);
          return;
        }
        if (!m[2]) this.opts.onContinue();
        if (size === 0) {
          this.segments.push({ kind: "literal", data: Buffer.alloc(0) });
        } else {
          this.literalLeft = size;
        }
        continue;
      }
      const segs = this.segments;
      this.segments = [];
      this.lineBytes = 0;
      this.opts.onCommand(segs);
    }
  }

  private fail(message: string): void {
    this.failed = true;
    this.opts.onError(message);
  }
}

// ── 토큰 ──────────────────────────────────────────────────────────────

export type ImapToken =
  | { t: "atom"; v: string }
  | { t: "string"; v: Buffer }
  | { t: "list"; v: ImapToken[] }
  | { t: "nil" };

export class ImapParseError extends Error {}

/** 조각 묶음을 토큰 목록으로. 대괄호 안(BODY[HEADER.FIELDS (A B)])과 <부분 범위>는 아톰 한 개로 묶는다. */
export function tokenize(segments: WireSegment[]): ImapToken[] {
  const root: ImapToken[] = [];
  const stack: ImapToken[][] = [root];
  let segIdx = 0;

  const top = () => stack[stack.length - 1];

  while (segIdx < segments.length) {
    const seg = segments[segIdx];
    if (seg.kind === "literal") {
      // 리터럴은 바로 앞 텍스트의 {n} 이 소비한다 — 여기 오면 짝이 어긋난 것.
      throw new ImapParseError("리터럴 위치가 올바르지 않습니다.");
    }
    const s = seg.data;
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === 0x20) {
        i++;
        continue;
      }
      if (c === 0x28) {
        const list: ImapToken[] = [];
        top().push({ t: "list", v: list });
        stack.push(list);
        i++;
        continue;
      }
      if (c === 0x29) {
        if (stack.length === 1) throw new ImapParseError("괄호 짝이 맞지 않습니다.");
        stack.pop();
        i++;
        continue;
      }
      if (c === 0x22) {
        const out: number[] = [];
        i++;
        let closed = false;
        while (i < s.length) {
          const d = s[i];
          if (d === 0x5c && i + 1 < s.length) {
            out.push(s[i + 1]);
            i += 2;
            continue;
          }
          if (d === 0x22) {
            closed = true;
            i++;
            break;
          }
          out.push(d);
          i++;
        }
        if (!closed) throw new ImapParseError("따옴표 문자열이 닫히지 않았습니다.");
        top().push({ t: "string", v: Buffer.from(out) });
        continue;
      }
      if (c === 0x7b) {
        // {n} 또는 {n+} — 줄 끝에서만 유효, 다음 조각이 리터럴.
        const close = s.indexOf(0x7d, i);
        if (close !== s.length - 1) throw new ImapParseError("리터럴 표식이 올바르지 않습니다.");
        const next = segments[segIdx + 1];
        if (!next || next.kind !== "literal") throw new ImapParseError("리터럴 본문이 없습니다.");
        top().push({ t: "string", v: next.data });
        segIdx++;
        i = s.length;
        continue;
      }
      // 아톰(대괄호 구간은 공백·괄호를 포함해 통째로)
      const start = i;
      let depth = 0;
      while (i < s.length) {
        const d = s[i];
        if (depth > 0) {
          if (d === 0x5d) depth--;
          else if (d === 0x5b) depth++;
          i++;
          continue;
        }
        if (d === 0x5b) {
          depth++;
          i++;
          continue;
        }
        if (d === 0x20 || d === 0x28 || d === 0x29 || d === 0x22 || d === 0x7b) break;
        i++;
      }
      if (depth > 0) throw new ImapParseError("대괄호가 닫히지 않았습니다.");
      const word = s.subarray(start, i).toString("utf8");
      top().push(word.toUpperCase() === "NIL" ? { t: "nil" } : { t: "atom", v: word });
    }
    segIdx++;
  }
  if (stack.length !== 1) throw new ImapParseError("괄호가 닫히지 않았습니다.");
  return root;
}

/** 아톰·문자열 토큰을 문자열로(UTF-8). 그 밖은 null. */
export function tokenText(tok: ImapToken | undefined): string | null {
  if (!tok) return null;
  if (tok.t === "atom") return tok.v;
  if (tok.t === "string") return tok.v.toString("utf8");
  return null;
}

// ── 응답 인코딩 ────────────────────────────────────────────────────────

/** 응답 조각 — 문자열은 UTF-8 로, Buffer 는 그대로 이어 붙인다. */
export type Out = string | Buffer;

function needsLiteral(b: Buffer): boolean {
  if (b.length > 1024) return true;
  for (const c of b) {
    if (c === 0x0d || c === 0x0a || c === 0x00 || c >= 0x80) return true;
  }
  return false;
}

/** 문자열 응답값 — 짧은 7비트는 따옴표, 그 밖(한글·줄바꿈·긴 값)은 리터럴. */
export function astring(v: string | Buffer): Out[] {
  const b = typeof v === "string" ? Buffer.from(v, "utf8") : v;
  if (needsLiteral(b)) return [`{${b.length}}\r\n`, b];
  return ['"' + b.toString("latin1").replace(/[\\"]/g, (m) => "\\" + m) + '"'];
}

/** nstring — null 이면 NIL. */
export function nstring(v: string | Buffer | null | undefined): Out[] {
  if (v == null) return ["NIL"];
  return astring(v);
}

/** 항상 리터럴(BODY[...] 본문). */
export function literal(b: Buffer): Out[] {
  return [`{${b.length}}\r\n`, b];
}

export function joinOut(parts: Out[]): Buffer {
  return Buffer.concat(parts.map((p) => (typeof p === "string" ? Buffer.from(p, "utf8") : p)));
}

/** IMAP 날짜시간 "17-Jul-1996 02:44:25 -0700" (UTC 로 표기). */
export function imapDateTime(d: Date): string {
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(d.getUTCDate())}-${mon}-${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} +0000`;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** SEARCH 날짜("1-Feb-1994") → 그날 0시(UTC). 형식이 아니면 null. */
export function parseSearchDate(s: string): Date | null {
  const m = String(s).match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const mon = MONTHS[m[2].toLowerCase()];
  if (mon == null) return null;
  return new Date(Date.UTC(Number(m[3]), mon, Number(m[1])));
}

/** APPEND 날짜시간("17-Jul-1996 02:44:25 -0700") → Date. 형식이 아니면 null. */
export function parseImapDateTime(s: string): Date | null {
  const m = String(s).trim().match(/^\s?(\d{1,2})-([A-Za-z]{3})-(\d{4}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/);
  if (!m) return null;
  const mon = MONTHS[m[2].toLowerCase()];
  if (mon == null) return null;
  const utc = Date.UTC(Number(m[3]), mon, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6]));
  const off = (Number(m[8]) * 60 + Number(m[9])) * (m[7] === "+" ? 1 : -1);
  return new Date(utc - off * 60_000);
}

// ── 시퀀스 집합 ────────────────────────────────────────────────────────

/** "1:3,7,9:*" 를 [시작, 끝] 구간들로. `*` = max. max 가 0 이면 `*` 는 0. */
export function parseSequenceSet(s: string, max: number): [number, number][] | null {
  if (!/^[0-9*:,]+$/.test(s)) return null;
  const out: [number, number][] = [];
  for (const part of s.split(",")) {
    if (!part) return null;
    const [a, b] = part.split(":");
    const conv = (x: string) => (x === "*" ? max : /^\d+$/.test(x) ? Number(x) : NaN);
    const lo = conv(a);
    const hi = b === undefined ? lo : conv(b);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || part.split(":").length > 2) return null;
    out.push(lo <= hi ? [lo, hi] : [hi, lo]);
  }
  return out;
}

export function inRanges(n: number, ranges: [number, number][]): boolean {
  for (const [lo, hi] of ranges) if (n >= lo && n <= hi) return true;
  return false;
}

/** 오름차순 정수 목록을 "1:3,7" 형태로(COPYUID·APPENDUID 응답). */
export function compressUids(uids: number[]): string {
  const sorted = [...uids].sort((a, b) => a - b);
  const out: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(i === j ? String(sorted[i]) : `${sorted[i]}:${sorted[j]}`);
    i = j + 1;
  }
  return out.join(",");
}
