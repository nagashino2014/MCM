/**
 * 외부 메일 프로그램 게이트웨이 — IMAP SEARCH 조건 해석·평가.
 * 본문 검색(BODY·TEXT)만 DB 조회가 필요하므로, 조건 트리에서 본문 검색어를 먼저 모아 한 번에 조회한 뒤
 * 메모리에서 평가한다. 헤더 검색은 DB 에 저장된 열(제목·주소·Message-ID)로 근사한다.
 */
import { inRanges, parseSearchDate, parseSequenceSet, tokenText, type ImapToken } from "@/lib/mail/gateway/imap-wire";

export interface SearchMsg {
  seq: number;
  uid: number;
  flags: string[];
  internalDate: Date;
  sentDate: Date | null;
  size: number;
  subject: string;
  from: string;
  to: string;
  cc: string;
  bcc: string;
  messageId: string;
}

export type SearchCrit =
  | { op: "all" }
  | { op: "flag"; flag: string; has: boolean }
  | { op: "seq"; set: string }
  | { op: "uid"; set: string }
  | { op: "not"; c: SearchCrit }
  | { op: "or"; a: SearchCrit; b: SearchCrit }
  | { op: "and"; list: SearchCrit[] }
  | { op: "date"; field: "internal" | "sent"; cmp: "before" | "on" | "since"; date: Date }
  | { op: "size"; cmp: "larger" | "smaller"; n: number }
  | { op: "field"; field: "subject" | "from" | "to" | "cc" | "bcc" | "messageId"; value: string }
  | { op: "header"; name: string; value: string }
  | { op: "body"; value: string; withHeaders: boolean };

export class SearchSyntaxError extends Error {}

const FLAG_KEYS: Record<string, [string, boolean]> = {
  ANSWERED: ["\\Answered", true],
  UNANSWERED: ["\\Answered", false],
  DELETED: ["\\Deleted", true],
  UNDELETED: ["\\Deleted", false],
  DRAFT: ["\\Draft", true],
  UNDRAFT: ["\\Draft", false],
  FLAGGED: ["\\Flagged", true],
  UNFLAGGED: ["\\Flagged", false],
  SEEN: ["\\Seen", true],
  UNSEEN: ["\\Seen", false],
};

/** 토큰 목록 → 조건 트리(최상위는 AND). */
export function parseSearch(tokens: ImapToken[]): SearchCrit {
  let i = 0;
  const str = (): string => {
    const v = tokenText(tokens[i++]);
    if (v == null) throw new SearchSyntaxError("검색 값이 없습니다.");
    return v;
  };
  const one = (): SearchCrit => {
    const tok = tokens[i++];
    if (!tok) throw new SearchSyntaxError("검색 조건이 없습니다.");
    if (tok.t === "list") return { op: "and", list: parseList(tok.v) };
    const key = tokenText(tok);
    if (key == null) throw new SearchSyntaxError("검색 조건이 올바르지 않습니다.");
    const K = key.toUpperCase();
    if (/^[0-9*:,]+$/.test(K)) return { op: "seq", set: K };
    if (FLAG_KEYS[K]) return { op: "flag", flag: FLAG_KEYS[K][0], has: FLAG_KEYS[K][1] };
    switch (K) {
      case "ALL":
        return { op: "all" };
      case "NEW":
        return { op: "flag", flag: "\\Seen", has: false };
      case "OLD":
        return { op: "all" };
      case "RECENT":
        return { op: "not", c: { op: "all" } };
      case "KEYWORD":
        return { op: "flag", flag: str(), has: true };
      case "UNKEYWORD":
        return { op: "flag", flag: str(), has: false };
      case "UID":
        return { op: "uid", set: str() };
      case "NOT":
        return { op: "not", c: one() };
      case "OR": {
        const a = one();
        const b = one();
        return { op: "or", a, b };
      }
      case "BEFORE":
      case "ON":
      case "SINCE":
      case "SENTBEFORE":
      case "SENTON":
      case "SENTSINCE": {
        const date = parseSearchDate(str());
        if (!date) throw new SearchSyntaxError("날짜 형식이 올바르지 않습니다.");
        const sent = K.startsWith("SENT");
        return { op: "date", field: sent ? "sent" : "internal", cmp: K.replace("SENT", "").toLowerCase() as "before" | "on" | "since", date };
      }
      case "LARGER":
      case "SMALLER": {
        const n = Number(str());
        if (!Number.isFinite(n)) throw new SearchSyntaxError("크기 값이 올바르지 않습니다.");
        return { op: "size", cmp: K === "LARGER" ? "larger" : "smaller", n };
      }
      case "SUBJECT":
      case "FROM":
      case "TO":
      case "CC":
      case "BCC":
        return { op: "field", field: K.toLowerCase() as "subject", value: str() };
      case "HEADER": {
        const name = str().toLowerCase();
        const value = str();
        if (name === "message-id") return { op: "field", field: "messageId", value };
        if (["subject", "from", "to", "cc", "bcc"].includes(name)) return { op: "field", field: name as "subject", value };
        return { op: "header", name, value };
      }
      case "BODY":
        return { op: "body", value: str(), withHeaders: false };
      case "TEXT":
        return { op: "body", value: str(), withHeaders: true };
      default:
        throw new SearchSyntaxError(`지원하지 않는 검색 조건: ${key}`);
    }
  };
  const parseList = (list: ImapToken[]): SearchCrit[] => {
    const saveTokens = tokens;
    const saveI = i;
    tokens = list;
    i = 0;
    const out: SearchCrit[] = [];
    while (i < tokens.length) out.push(one());
    tokens = saveTokens;
    i = saveI;
    return out;
  };
  const list: SearchCrit[] = [];
  while (i < tokens.length) list.push(one());
  if (!list.length) throw new SearchSyntaxError("검색 조건이 없습니다.");
  return list.length === 1 ? list[0] : { op: "and", list };
}

/** 본문 검색 키(검색어 + 헤더 포함 여부) — DB 선조회 결과를 이 키로 찾는다. */
export function bodyTermKey(value: string, withHeaders: boolean): string {
  return (withHeaders ? "T" : "B") + ":" + value;
}

/** 본문 검색 조건 목록(DB 선조회용). 키 → 조건. */
export function collectBodyTerms(
  c: SearchCrit,
  out: Map<string, { value: string; withHeaders: boolean }> = new Map()
): Map<string, { value: string; withHeaders: boolean }> {
  switch (c.op) {
    case "body":
      out.set(bodyTermKey(c.value, c.withHeaders), { value: c.value, withHeaders: c.withHeaders });
      break;
    case "not":
      collectBodyTerms(c.c, out);
      break;
    case "or":
      collectBodyTerms(c.a, out);
      collectBodyTerms(c.b, out);
      break;
    case "and":
      c.list.forEach((x) => collectBodyTerms(x, out));
      break;
  }
  return out;
}

function dayUtc(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function has(hay: string, needle: string): boolean {
  return hay.toLowerCase().includes(needle.toLowerCase());
}

/**
 * 조건 평가. bodyHits = 본문 검색 키(bodyTermKey) → 맞은 UID 집합. maxSeq·maxUid 는 `*` 해석용.
 */
export function evalSearch(
  c: SearchCrit,
  m: SearchMsg,
  ctx: { maxSeq: number; maxUid: number; bodyHits: Map<string, Set<number>> }
): boolean {
  switch (c.op) {
    case "all":
      return true;
    case "flag":
      return m.flags.some((f) => f.toLowerCase() === c.flag.toLowerCase()) === c.has;
    case "seq": {
      const r = parseSequenceSet(c.set, ctx.maxSeq);
      return !!r && inRanges(m.seq, r);
    }
    case "uid": {
      const r = parseSequenceSet(c.set, ctx.maxUid);
      return !!r && inRanges(m.uid, r);
    }
    case "not":
      return !evalSearch(c.c, m, ctx);
    case "or":
      return evalSearch(c.a, m, ctx) || evalSearch(c.b, m, ctx);
    case "and":
      return c.list.every((x) => evalSearch(x, m, ctx));
    case "date": {
      const src = c.field === "sent" ? m.sentDate ?? m.internalDate : m.internalDate;
      const d = dayUtc(src);
      const t = c.date.getTime();
      if (c.cmp === "before") return d < t;
      if (c.cmp === "on") return d === t;
      return d >= t;
    }
    case "size":
      return c.cmp === "larger" ? m.size > c.n : m.size < c.n;
    case "field":
      return has(m[c.field], c.value);
    case "header":
      // 저장 열에 없는 헤더 — 빈 값 검색(헤더 존재 여부)만 참으로 본다.
      return c.value === "";
    case "body":
      return ctx.bodyHits.get(bodyTermKey(c.value, c.withHeaders))?.has(m.uid) ?? false;
  }
}
