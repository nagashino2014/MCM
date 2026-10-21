/**
 * 외부 메일 프로그램 게이트웨이 — 원문 MIME 트리(바이트 위치)·BODYSTRUCTURE·ENVELOPE·본문 구간(BODY[section]).
 * 원문은 손대지 않고 위치만 계산한다(IMAP 은 같은 UID 의 바이트가 변하지 않아야 한다).
 * 헤더는 latin1 로 읽어 바이트 위치를 보존하고, 응답 문자열을 만들 때만 UTF-8 로 되돌린다.
 */
import { astring, nstring, type Out } from "@/lib/mail/gateway/imap-wire";

const MAX_DEPTH = 20;
const MAX_PARTS = 500;

export interface HeaderField {
  /** 소문자 이름. */
  name: string;
  /** 접힘을 푼 값(latin1 그대로). */
  value: string;
  /** 원문에서 이 필드의 바이트 구간(줄바꿈 포함). */
  start: number;
  end: number;
}

export interface MimeNode {
  start: number;
  /** 본문 시작(헤더 끝 빈 줄 다음). */
  headerEnd: number;
  end: number;
  headers: HeaderField[];
  type: string;
  subtype: string;
  params: [string, string][];
  children: MimeNode[];
  /** message/rfc822 의 내장 메시지. */
  message: MimeNode | null;
}

/** latin1 로 읽은 헤더 값을 UTF-8 문자열로(8비트 헤더 보존). */
export function fromBin(s: string): string {
  return Buffer.from(s, "latin1").toString("utf8");
}

function findHeaderEnd(buf: Buffer, start: number, end: number): number {
  let i = start;
  while (i < end) {
    const lf = buf.indexOf(0x0a, i);
    if (lf < 0 || lf >= end) return end;
    const lineLen = lf - i;
    if (lineLen === 0 || (lineLen === 1 && buf[i] === 0x0d)) return lf + 1;
    i = lf + 1;
  }
  return end;
}

/** 헤더 블록 → 필드 목록(접힘 해제). */
export function parseHeaderFields(buf: Buffer, start: number, end: number): HeaderField[] {
  const out: HeaderField[] = [];
  let i = start;
  let cur: { name: string; raw: string; start: number; end: number } | null = null;
  const push = () => {
    if (!cur) return;
    out.push({ name: cur.name, value: cur.raw.replace(/\r?\n[ \t]/g, " ").replace(/\r?\n$/, "").trim(), start: cur.start, end: cur.end });
    cur = null;
  };
  while (i < end) {
    let lf = buf.indexOf(0x0a, i);
    if (lf < 0 || lf >= end) lf = end - 1;
    const lineEnd = lf + 1;
    const line = buf.subarray(i, lineEnd).toString("latin1");
    if (line === "\r\n" || line === "\n") break;
    if ((line[0] === " " || line[0] === "\t") && cur) {
      cur.raw += line;
      cur.end = lineEnd;
    } else {
      push();
      const colon = line.indexOf(":");
      if (colon > 0) {
        cur = { name: line.slice(0, colon).trim().toLowerCase(), raw: line.slice(colon + 1), start: i, end: lineEnd };
      }
    }
    i = lineEnd;
  }
  push();
  return out;
}

export function headerValue(headers: HeaderField[], name: string): string | null {
  const f = headers.find((h) => h.name === name);
  return f ? f.value : null;
}

/** "type/subtype; a=b; c="d"" 형식의 매개변수 분해(따옴표 안 ; 무시). 키는 소문자. */
export function parseParams(s: string): { main: string; params: [string, string][] } {
  const parts: string[] = [];
  let curPart = "";
  let inQ = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' && s[i - 1] !== "\\") inQ = !inQ;
    if (c === ";" && !inQ) {
      parts.push(curPart);
      curPart = "";
      continue;
    }
    curPart += c;
  }
  parts.push(curPart);
  const main = (parts.shift() ?? "").trim();
  const params: [string, string][] = [];
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq <= 0) continue;
    const key = p.slice(0, eq).trim().toLowerCase();
    let val = p.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) val = val.slice(1, -1).replace(/\\(.)/g, "$1");
    if (key) params.push([key, val]);
  }
  return { main, params };
}

/** 원문 → MIME 트리. */
export function parseMime(buf: Buffer): MimeNode {
  const counter = { parts: 0 };
  return parseEntity(buf, 0, buf.length, 0, "text/plain", counter);
}

function parseEntity(
  buf: Buffer,
  start: number,
  end: number,
  depth: number,
  defaultType: string,
  counter: { parts: number }
): MimeNode {
  counter.parts++;
  const headerEnd = findHeaderEnd(buf, start, end);
  const headers = parseHeaderFields(buf, start, headerEnd);
  const ct = headerValue(headers, "content-type");
  const parsed = parseParams(ct ?? defaultType);
  let [type, subtype] = parsed.main.toLowerCase().split("/").map((x) => (x ?? "").trim());
  let params = parsed.params;
  if (!type || !subtype) {
    [type, subtype] = defaultType.split("/");
    params = [];
  }
  if (!ct && type === "text" && !params.length) params = [["charset", "us-ascii"]];
  const node: MimeNode = { start, headerEnd, end, headers, type, subtype, params, children: [], message: null };
  if (depth >= MAX_DEPTH || counter.parts >= MAX_PARTS) return node;

  if (type === "multipart") {
    const boundary = params.find(([k]) => k === "boundary")?.[1];
    if (boundary) {
      node.children = splitMultipart(buf, headerEnd, end, boundary).map((r) =>
        parseEntity(buf, r[0], r[1], depth + 1, subtype === "digest" ? "message/rfc822" : "text/plain", counter)
      );
    }
  } else if (type === "message" && subtype === "rfc822") {
    const enc = (headerValue(headers, "content-transfer-encoding") ?? "7bit").toLowerCase();
    if (enc !== "base64" && enc !== "quoted-printable") {
      node.message = parseEntity(buf, headerEnd, end, depth + 1, "text/plain", counter);
    }
  }
  return node;
}

function splitMultipart(buf: Buffer, bodyStart: number, end: number, boundary: string): [number, number][] {
  const delim = Buffer.from("--" + boundary, "latin1");
  const out: [number, number][] = [];
  let partStart = -1;
  let pos = bodyStart;
  while (pos < end) {
    const idx = buf.indexOf(delim, pos);
    if (idx < 0 || idx + delim.length > end) break;
    const atLineStart = idx === bodyStart || buf[idx - 1] === 0x0a;
    if (!atLineStart) {
      pos = idx + 1;
      continue;
    }
    let after = idx + delim.length;
    const isClose = buf[after] === 0x2d && buf[after + 1] === 0x2d;
    if (isClose) after += 2;
    // 구분선 뒤에는 공백만 와야 한다(같은 접두의 다른 boundary 배제).
    let k = after;
    while (k < end && (buf[k] === 0x20 || buf[k] === 0x09)) k++;
    if (k < end && buf[k] !== 0x0d && buf[k] !== 0x0a) {
      pos = idx + 1;
      continue;
    }
    if (partStart >= 0) {
      let partEnd = idx;
      if (idx > bodyStart && buf[idx - 1] === 0x0a) partEnd = idx - 1;
      if (partEnd > bodyStart && buf[partEnd - 1] === 0x0d) partEnd--;
      out.push([partStart, Math.max(partStart, partEnd)]);
    }
    if (isClose) return out;
    const lf = buf.indexOf(0x0a, k);
    partStart = lf < 0 || lf >= end ? end : lf + 1;
    pos = partStart;
  }
  // 닫는 구분선 없이 끝난 마지막 파트
  if (partStart >= 0 && partStart < end) out.push([partStart, end]);
  return out;
}

// ── ENVELOPE ──────────────────────────────────────────────────────────

export interface EnvAddr {
  name: string | null;
  mailbox: string | null;
  host: string | null;
}

export interface EnvelopeData {
  date: string | null;
  subject: string | null;
  from: EnvAddr[] | null;
  sender: EnvAddr[] | null;
  replyTo: EnvAddr[] | null;
  to: EnvAddr[] | null;
  cc: EnvAddr[] | null;
  bcc: EnvAddr[] | null;
  inReplyTo: string | null;
  messageId: string | null;
}

type AddrTok = { k: "text" | "quoted" | "comment" | "op"; v: string };

function addrTokens(s: string): AddrTok[] {
  const out: AddrTok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      i++;
      continue;
    }
    if (c === '"') {
      let v = "";
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === "\\" && i + 1 < s.length) i++;
        v += s[i++];
      }
      i++;
      out.push({ k: "quoted", v });
      continue;
    }
    if (c === "(") {
      let depth = 1;
      let v = "";
      i++;
      while (i < s.length && depth > 0) {
        if (s[i] === "\\" && i + 1 < s.length) {
          v += s[i + 1];
          i += 2;
          continue;
        }
        if (s[i] === "(") depth++;
        else if (s[i] === ")") {
          depth--;
          if (!depth) break;
        }
        v += s[i++];
      }
      i++;
      out.push({ k: "comment", v });
      continue;
    }
    if ("<>@,;:".includes(c)) {
      out.push({ k: "op", v: c });
      i++;
      continue;
    }
    let v = "";
    while (i < s.length && !` \t\r\n"(<>@,;:`.includes(s[i])) v += s[i++];
    out.push({ k: "text", v });
  }
  return out;
}

function oneAddress(toks: AddrTok[]): EnvAddr | null {
  if (!toks.length) return null;
  const lt = toks.findIndex((t) => t.k === "op" && t.v === "<");
  let nameToks: AddrTok[];
  let specToks: AddrTok[];
  if (lt >= 0) {
    const gt = toks.findIndex((t, i) => i > lt && t.k === "op" && t.v === ">");
    nameToks = toks.slice(0, lt).filter((t) => t.k !== "comment");
    specToks = toks.slice(lt + 1, gt < 0 ? toks.length : gt);
    // 경로(@a,@b:) 제거
    const colon = specToks.findIndex((t) => t.k === "op" && t.v === ":");
    if (colon >= 0) specToks = specToks.slice(colon + 1);
  } else {
    nameToks = toks.filter((t) => t.k === "comment");
    specToks = toks.filter((t) => t.k !== "comment");
  }
  const at = specToks.findIndex((t) => t.k === "op" && t.v === "@");
  const local = (at >= 0 ? specToks.slice(0, at) : specToks).map((t) => t.v).join("");
  const host = at >= 0 ? specToks.slice(at + 1).map((t) => t.v).join("") : null;
  const name = nameToks.map((t) => t.v).join(" ").trim();
  if (!local && !host && !name) return null;
  return { name: name ? fromBin(name) : null, mailbox: local ? fromBin(local) : null, host: host != null ? fromBin(host) : "" };
}

/** 주소 목록 헤더 → ENVELOPE 주소(그룹은 시작·끝 표식). */
export function parseAddressList(value: string | null): EnvAddr[] | null {
  if (value == null || !value.trim()) return null;
  const toks = addrTokens(value);
  const out: EnvAddr[] = [];
  let cur: AddrTok[] = [];
  let inGroup = false;
  const flush = () => {
    const a = oneAddress(cur);
    if (a && (a.mailbox || a.host)) out.push(a);
    cur = [];
  };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.k === "op" && t.v === ":" && !inGroup && !cur.some((x) => x.k === "op" && x.v === "<")) {
      const groupName = cur.map((x) => x.v).join(" ").trim();
      out.push({ name: null, mailbox: fromBin(groupName), host: null });
      cur = [];
      inGroup = true;
      continue;
    }
    if (t.k === "op" && t.v === ";" && inGroup) {
      flush();
      out.push({ name: null, mailbox: null, host: null });
      inGroup = false;
      continue;
    }
    if (t.k === "op" && t.v === ",") {
      flush();
      continue;
    }
    cur.push(t);
  }
  flush();
  if (inGroup) out.push({ name: null, mailbox: null, host: null });
  return out.length ? out : null;
}

export function envelopeFromHeaders(headers: HeaderField[]): EnvelopeData {
  const raw = (n: string) => {
    const v = headerValue(headers, n);
    return v != null ? fromBin(v) : null;
  };
  const from = parseAddressList(headerValue(headers, "from"));
  return {
    date: raw("date"),
    subject: raw("subject"),
    from,
    sender: parseAddressList(headerValue(headers, "sender")) ?? from,
    replyTo: parseAddressList(headerValue(headers, "reply-to")) ?? from,
    to: parseAddressList(headerValue(headers, "to")),
    cc: parseAddressList(headerValue(headers, "cc")),
    bcc: parseAddressList(headerValue(headers, "bcc")),
    inReplyTo: raw("in-reply-to"),
    messageId: raw("message-id"),
  };
}

function addrListOut(list: EnvAddr[] | null): Out[] {
  if (!list || !list.length) return ["NIL"];
  const out: Out[] = ["("];
  for (const a of list) {
    out.push("(", ...nstring(a.name), " NIL ", ...nstring(a.mailbox), " ", ...nstring(a.host), ")");
  }
  out.push(")");
  return out;
}

export function serializeEnvelope(e: EnvelopeData): Out[] {
  return [
    "(",
    ...nstring(e.date), " ",
    ...nstring(e.subject), " ",
    ...addrListOut(e.from), " ",
    ...addrListOut(e.sender), " ",
    ...addrListOut(e.replyTo), " ",
    ...addrListOut(e.to), " ",
    ...addrListOut(e.cc), " ",
    ...addrListOut(e.bcc), " ",
    ...nstring(e.inReplyTo), " ",
    ...nstring(e.messageId),
    ")",
  ];
}

// ── BODYSTRUCTURE ─────────────────────────────────────────────────────

/** 저장용 구조 요약(mail_messages.imap_structure). 원문 없이 BODYSTRUCTURE 를 다시 만들 수 있다. */
export interface StructNode {
  type: string;
  subtype: string;
  params: [string, string][];
  id: string | null;
  desc: string | null;
  enc: string;
  size: number;
  lines: number | null;
  md5: string | null;
  disp: [string, [string, string][]] | null;
  lang: string[] | null;
  loc: string | null;
  parts?: StructNode[];
  env?: EnvelopeData;
  msg?: StructNode;
}

function countLines(buf: Buffer, start: number, end: number): number {
  let n = 0;
  for (let i = start; i < end; i++) if (buf[i] === 0x0a) n++;
  // 마지막 줄이 줄바꿈 없이 끝나도 한 줄로 센다.
  if (end > start && buf[end - 1] !== 0x0a) n++;
  return n;
}

export function describeStructure(buf: Buffer, node: MimeNode): StructNode {
  const hv = (n: string) => {
    const v = headerValue(node.headers, n);
    return v != null ? fromBin(v) : null;
  };
  const params = node.params.map(([k, v]) => [k, fromBin(v)] as [string, string]);
  const dispRaw = headerValue(node.headers, "content-disposition");
  let disp: StructNode["disp"] = null;
  if (dispRaw) {
    const d = parseParams(dispRaw);
    if (d.main) disp = [d.main.toLowerCase(), d.params.map(([k, v]) => [k, fromBin(v)] as [string, string])];
  }
  const langRaw = hv("content-language");
  const base: StructNode = {
    type: node.type,
    subtype: node.subtype,
    params,
    id: hv("content-id"),
    desc: hv("content-description"),
    enc: (hv("content-transfer-encoding") ?? "7bit").toLowerCase(),
    size: node.end - node.headerEnd,
    lines: null,
    md5: hv("content-md5"),
    disp,
    lang: langRaw ? langRaw.split(",").map((x) => x.trim()).filter(Boolean) : null,
    loc: hv("content-location"),
  };
  if (node.type === "multipart") {
    base.parts = node.children.map((c) => describeStructure(buf, c));
    if (!base.parts.length) {
      // 구분선을 못 찾은 multipart — 빈 text/plain 하나로 둔다(BODYSTRUCTURE 는 최소 1파트).
      base.parts = [
        { type: "text", subtype: "plain", params: [["charset", "us-ascii"]], id: null, desc: null, enc: "7bit", size: 0, lines: 0, md5: null, disp: null, lang: null, loc: null },
      ];
    }
  } else if (node.type === "text") {
    base.lines = countLines(buf, node.headerEnd, node.end);
  } else if (node.message) {
    base.env = envelopeFromHeaders(node.message.headers);
    base.msg = describeStructure(buf, node.message);
    base.lines = countLines(buf, node.headerEnd, node.end);
  }
  return base;
}

function paramsOut(p: [string, string][]): Out[] {
  if (!p.length) return ["NIL"];
  const out: Out[] = ["("];
  p.forEach(([k, v], i) => {
    if (i) out.push(" ");
    out.push(...astring(k), " ", ...astring(v));
  });
  out.push(")");
  return out;
}

function dispOut(d: StructNode["disp"]): Out[] {
  if (!d) return ["NIL"];
  return ["(", ...astring(d[0]), " ", ...paramsOut(d[1]), ")"];
}

function langOut(l: string[] | null): Out[] {
  if (!l || !l.length) return ["NIL"];
  if (l.length === 1) return astring(l[0]);
  const out: Out[] = ["("];
  l.forEach((x, i) => {
    if (i) out.push(" ");
    out.push(...astring(x));
  });
  out.push(")");
  return out;
}

/** BODYSTRUCTURE(extended=true) 또는 BODY(false). */
export function serializeStructure(n: StructNode, extended: boolean): Out[] {
  if (n.parts) {
    const out: Out[] = ["("];
    for (const p of n.parts) out.push(...serializeStructure(p, extended));
    out.push(" ", ...astring(n.subtype));
    if (extended) {
      out.push(" ", ...paramsOut(n.params), " ", ...dispOut(n.disp), " ", ...langOut(n.lang), " ", ...nstring(n.loc));
    }
    out.push(")");
    return out;
  }
  const out: Out[] = [
    "(",
    ...astring(n.type), " ",
    ...astring(n.subtype), " ",
    ...paramsOut(n.params), " ",
    ...nstring(n.id), " ",
    ...nstring(n.desc), " ",
    ...astring(n.enc), " ",
    String(n.size),
  ];
  if (n.msg && n.env) {
    out.push(" ", ...serializeEnvelope(n.env), " ", ...serializeStructure(n.msg, extended), " ", String(n.lines ?? 0));
  } else if (n.type === "text") {
    out.push(" ", String(n.lines ?? 0));
  }
  if (extended) {
    out.push(" ", ...nstring(n.md5), " ", ...dispOut(n.disp), " ", ...langOut(n.lang), " ", ...nstring(n.loc));
  }
  out.push(")");
  return out;
}

// ── BODY[section] ─────────────────────────────────────────────────────

export interface SectionSpec {
  path: number[];
  /** "" | HEADER | HEADER.FIELDS | HEADER.FIELDS.NOT | TEXT | MIME */
  part: string;
  fields: string[];
}

/** "1.2.HEADER.FIELDS (FROM TO)" 같은 섹션 문자열 해석(대괄호 안). 문법 오류면 null. */
export function parseSection(s: string): SectionSpec | null {
  const m = s.trim().match(/^((?:\d+\.)*\d+)?(?:\.?(HEADER\.FIELDS\.NOT|HEADER\.FIELDS|HEADER|TEXT|MIME))?\s*(?:\((.*)\))?$/i);
  if (!m) return null;
  const path = m[1] ? m[1].split(".").map(Number) : [];
  if (path.some((n) => !Number.isInteger(n) || n < 1)) return null;
  const part = (m[2] ?? "").toUpperCase();
  if (part === "MIME" && !path.length) return null;
  const fields = m[3] != null ? m[3].replace(/"/g, "").split(/\s+/).filter(Boolean).map((f) => f.toLowerCase()) : [];
  if ((part === "HEADER.FIELDS" || part === "HEADER.FIELDS.NOT") && !fields.length) return null;
  if (m[3] != null && !part.startsWith("HEADER.FIELDS")) return null;
  return { path, part, fields };
}

function locate(root: MimeNode, path: number[]): MimeNode | null {
  let node = root;
  for (let i = 0; i < path.length; i++) {
    let container = node;
    if (i > 0 && container.message) container = container.message;
    const n = path[i];
    if (container.type === "multipart") {
      const c = container.children[n - 1];
      if (!c) return null;
      node = c;
    } else if (n === 1) {
      node = container;
    } else {
      return null;
    }
  }
  return node;
}

function headerSubset(buf: Buffer, headers: HeaderField[], fields: string[], not: boolean): Buffer {
  const pick = headers.filter((h) => fields.includes(h.name) !== not);
  return Buffer.concat([...pick.map((h) => buf.subarray(h.start, h.end)), Buffer.from("\r\n")]);
}

/** 섹션 바이트. 없는 파트면 빈 버퍼(RFC 3501: 존재하지 않는 섹션은 빈 문자열). */
export function extractSection(buf: Buffer, root: MimeNode, spec: SectionSpec): Buffer {
  const node = spec.path.length ? locate(root, spec.path) : root;
  if (!node) return Buffer.alloc(0);
  if (spec.part === "MIME") return buf.subarray(node.start, node.headerEnd);
  if (!spec.part) {
    if (!spec.path.length) return buf.subarray(root.start, root.end);
    return buf.subarray(node.headerEnd, node.end);
  }
  // HEADER·TEXT 계열은 메시지(최상위 또는 message/rfc822 내장)에 적용된다.
  const msg = spec.path.length ? node.message : root;
  if (!msg) return Buffer.alloc(0);
  if (spec.part === "HEADER") return buf.subarray(msg.start, msg.headerEnd);
  if (spec.part === "TEXT") return buf.subarray(msg.headerEnd, msg.end);
  return headerSubset(buf, msg.headers, spec.fields, spec.part === "HEADER.FIELDS.NOT");
}

/** 헤더 블록만으로 HEADER.FIELDS 계열을 뽑는다(원문을 내려받지 않는 빠른 경로). */
export function headerOnlySection(header: Buffer, spec: SectionSpec): Buffer | null {
  if (spec.path.length) return null;
  if (spec.part === "HEADER") return header;
  if (spec.part === "HEADER.FIELDS" || spec.part === "HEADER.FIELDS.NOT") {
    return headerSubset(header, parseHeaderFields(header, 0, header.length), spec.fields, spec.part === "HEADER.FIELDS.NOT");
  }
  return null;
}
