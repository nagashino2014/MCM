/**
 * 코넨사인 메일 — 의존성 없는 MIME 메시지 빌더(발송용, SES SendRawEmail 입력).
 * 구조: 첨부 있으면 multipart/mixed > multipart/alternative(text+html) + 첨부, 없으면 alternative.
 * 인코딩: 본문·첨부 base64(76자 폴딩), 헤더 비-ASCII 는 RFC2047 encoded-word(=?UTF-8?B?..?=).
 * CLAUDE.md "새 라이브러리 임의 도입 금지" 에 따라 nodemailer 없이 자체 구현.
 */
import crypto from "node:crypto";

export interface MailAddress {
  name?: string;
  address: string;
}

export interface MimeAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
  contentId?: string;
}

export interface BuildMimeInput {
  from: MailAddress;
  to: MailAddress[];
  cc?: MailAddress[];
  subject: string;
  text: string;
  html: string;
  attachments?: MimeAttachment[];
  messageId: string; // <uuid@domain>
  inReplyTo?: string | null;
  references?: string[];
  replyTo?: string | null;
  date?: Date;
}

const CRLF = "\r\n";

/** base64 문자열을 76자마다 CRLF 로 접는다(RFC 2045). */
function foldBase64(b64: string): string {
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines.join(CRLF);
}

function b64Body(s: string): string {
  return foldBase64(Buffer.from(s, "utf8").toString("base64"));
}

/** ASCII 전용(제어문자·비ASCII 없음)인지. */
function isPlainAscii(s: string): boolean {
  return /^[\x20-\x7e]*$/.test(s);
}

/**
 * 헤더 값(제목 등)을 RFC2047 encoded-word 로. 비ASCII 없으면 원문 그대로.
 * UTF-8 바이트 기준 ~30바이트씩 잘라 여러 encoded-word 로 나눠 각 word 를 75자 이하로 유지한다.
 */
function encodeHeaderValue(value: string): string {
  if (isPlainAscii(value)) return value;
  const words: string[] = [];
  let chunk = "";
  let chunkBytes = 0;
  for (const ch of value) {
    const chBytes = Buffer.byteLength(ch, "utf8");
    if (chunkBytes + chBytes > 30 && chunk) {
      words.push(`=?UTF-8?B?${Buffer.from(chunk, "utf8").toString("base64")}?=`);
      chunk = "";
      chunkBytes = 0;
    }
    chunk += ch;
    chunkBytes += chBytes;
  }
  if (chunk) words.push(`=?UTF-8?B?${Buffer.from(chunk, "utf8").toString("base64")}?=`);
  // 여러 encoded-word 는 CRLF+SPACE 로 이어붙인다(폴딩).
  return words.join(CRLF + " ");
}

/** 주소 헤더 1개: "표시이름 <addr>". 표시이름은 필요 시 encoded-word. */
function formatAddress(a: MailAddress): string {
  const addr = a.address.trim();
  if (!a.name) return addr;
  return `${encodeHeaderValue(a.name)} <${addr}>`;
}

function formatAddressList(list: MailAddress[]): string {
  return list.map(formatAddress).join(", ");
}

/** RFC2231 ext-value(pct-encoded).
 *  ⚠ encodeURIComponent 는 !'()* 를 남기는데, RFC2231 ext-value 에서 괄호·아포스트로피는
 *  attribute-char 가 아니라 SES 가 헤더 파싱을 거부한다(실사고: "(2026-대외-…)" 공문 파일명
 *  발송 실패) — 잔여 특수문자까지 pct-encoding 한다. */
function pctFilename(filename: string): string {
  return encodeURIComponent(filename).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * 비ASCII 파일명의 폴백 이름 — **확장자를 반드시 남긴다**.
 * 한글을 걷어내고 남은 ASCII 조각(공문번호 등)을 이어 붙이고, 남는 게 없으면 attachment.
 * 예) "(2026-대외-01050)한국동서발전 당진발전본부 준공계 제출.pdf" → "2026-01050.pdf"
 */
function asciiFallbackName(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const ext = dot > 0 ? filename.slice(dot).replace(/[^A-Za-z0-9.]/g, "") : "";
  const base = (dot > 0 ? filename.slice(0, dot) : filename)
    .replace(/[^\x20-\x7e]+/g, " ")
    .replace(/["\\()';=,]/g, " ")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  return (base || "attachment") + ext;
}

/**
 * 첨부 파일명 파라미터 — Content-Type 의 name 과 Content-Disposition 의 filename 을 함께 만든다.
 *
 * ⚠ 2026-09-01 실사고: 한글 파일명일 때 name 을 "attachment" 고정으로 두고 filename 은
 * RFC2231(filename*=) 만 보냈다. RFC2231 을 해석하지 못하는 수신 측(공기업 내부 그룹웨어 등)은
 * 폴백으로 name 을 쓰는데 그 값이 확장자 없는 "attachment" 라, 받는 사람 화면에 확장자 없는
 * 파일로 떨어져 열리지 않았다(한국동서발전 ewp.co.kr 사례).
 * → name·filename 에는 **확장자가 살아 있는 ASCII 폴백**을 넣고, filename* 로 원본 한글명을
 *   함께 보낸다. RFC2231 을 아는 클라이언트는 한글 이름으로, 모르는 쪽도 확장자가 있어 열린다.
 *   (filename 에 RFC2047 encoded-word 를 넣는 방식은 quoted-string 안에서 접히면 파서마다
 *    해석이 갈리고, 그마저 못 읽으면 "=?UTF-8?B?…?=" 가 그대로 이름이 돼 확장자를 잃는다.)
 */
function filenameParams(filename: string, fallbackOf: (f: string) => string): { name: string; disposition: string } {
  // 따옴표·역슬래시·괄호·세미콜론 등은 quoted-string 파싱을 흔들 수 있어 ASCII 라도 폴백을 쓴다
  if (isPlainAscii(filename) && !/["\\()';=]/.test(filename)) {
    return { name: `name="${filename}"`, disposition: `filename="${filename}"` };
  }
  const fallback = fallbackOf(filename);
  return {
    name: `name="${fallback}"`,
    disposition: `filename="${fallback}"; filename*=UTF-8''${pctFilename(filename)}`,
  };
}

/** 메시지 안에서 폴백 이름이 겹치지 않게(첨부가 여럿이면 모두 attachment.pdf 가 될 수 있다) */
function fallbackNamer(): (filename: string) => string {
  const used = new Set<string>();
  return (filename: string): string => {
    const base = asciiFallbackName(filename);
    if (!used.has(base)) {
      used.add(base);
      return base;
    }
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : "";
    for (let i = 2; ; i += 1) {
      const cand = `${stem}-${i}${ext}`;
      if (!used.has(cand)) {
        used.add(cand);
        return cand;
      }
    }
  };
}

function newBoundary(tag: string): string {
  return `----=_${tag}_${crypto.randomUUID().replace(/-/g, "")}`;
}

/** 완성된 MIME 메시지(헤더+본문)를 Buffer 로 반환. */
export function buildMimeMessage(input: BuildMimeInput): Buffer {
  const date = input.date ?? new Date();
  const headers: string[] = [];
  headers.push(`From: ${formatAddress(input.from)}`);
  headers.push(`To: ${formatAddressList(input.to)}`);
  if (input.cc && input.cc.length) headers.push(`Cc: ${formatAddressList(input.cc)}`);
  if (input.replyTo) headers.push(`Reply-To: ${input.replyTo}`);
  headers.push(`Subject: ${encodeHeaderValue(input.subject)}`);
  headers.push(`Date: ${date.toUTCString().replace("GMT", "+0000")}`);
  headers.push(`Message-ID: ${input.messageId}`);
  if (input.inReplyTo) headers.push(`In-Reply-To: ${input.inReplyTo}`);
  if (input.references && input.references.length) headers.push(`References: ${input.references.join(" ")}`);
  headers.push(`MIME-Version: 1.0`);

  const altBoundary = newBoundary("alt");
  const altBody =
    `--${altBoundary}${CRLF}` +
    `Content-Type: text/plain; charset=UTF-8${CRLF}Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
    `${b64Body(input.text)}${CRLF}` +
    `--${altBoundary}${CRLF}` +
    `Content-Type: text/html; charset=UTF-8${CRLF}Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
    `${b64Body(input.html)}${CRLF}` +
    `--${altBoundary}--${CRLF}`;

  const all = input.attachments ?? [];
  // 인라인 이미지(cid)는 본문과 함께 multipart/related 안에 있어야 한다.
  // mixed 레벨에 일반 첨부와 나란히 두면 관대한 클라이언트(Gmail)는 찾아 주지만
  // 엄격한 쪽(네이버 메일 등)은 cid: 참조를 해석하지 못해 이미지가 깨진다.
  const inlineImages = all.filter((a) => a.contentId);
  const files = all.filter((a) => !a.contentId);

  const nextFallback = fallbackNamer();
  const partOf = (att: MimeAttachment, boundary: string): string => {
    const fn = filenameParams(att.filename, nextFallback);
    return (
      `--${boundary}${CRLF}` +
      `Content-Type: ${att.contentType}; ${fn.name}${CRLF}` +
      `Content-Transfer-Encoding: base64${CRLF}` +
      (att.contentId ? `Content-ID: <${att.contentId}>${CRLF}` : "") +
      `Content-Disposition: ${att.contentId ? "inline" : "attachment"}; ${fn.disposition}${CRLF}${CRLF}` +
      `${foldBase64(att.content.toString("base64"))}${CRLF}`
    );
  };

  const altPart = `Content-Type: multipart/alternative; boundary="${altBoundary}"${CRLF}${CRLF}${altBody}`;

  // 본문 = alternative, 인라인 이미지가 있으면 related 로 한 번 감싼다
  let content = altPart;
  if (inlineImages.length) {
    const relBoundary = newBoundary("rel");
    content =
      `Content-Type: multipart/related; type="multipart/alternative"; boundary="${relBoundary}"${CRLF}${CRLF}` +
      `--${relBoundary}${CRLF}${altPart}` +
      inlineImages.map((a) => partOf(a, relBoundary)).join("") +
      `--${relBoundary}--${CRLF}`;
  }

  let body: string;
  if (files.length) {
    const mixedBoundary = newBoundary("mix");
    body =
      `Content-Type: multipart/mixed; boundary="${mixedBoundary}"${CRLF}${CRLF}` +
      `--${mixedBoundary}${CRLF}${content}` +
      files.map((a) => partOf(a, mixedBoundary)).join("") +
      `--${mixedBoundary}--${CRLF}`;
  } else {
    body = content;
  }

  return Buffer.from(headers.join(CRLF) + CRLF + body, "utf8");
}

/** 아주 단순한 HTML→plain 변환(alternative text 파트·snippet 용). */
export function htmlToPlainText(html: string): string {
  return String(html ?? "")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}
