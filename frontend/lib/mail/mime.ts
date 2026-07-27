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

/** RFC2231 filename*=UTF-8''<pct> — 비ASCII 파일명 안전 처리. */
function encodeFilename(filename: string): string {
  if (isPlainAscii(filename) && !/["\\]/.test(filename)) {
    return `filename="${filename}"`;
  }
  return `filename*=UTF-8''${encodeURIComponent(filename)}`;
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

  const attachments = input.attachments ?? [];
  let body: string;
  if (attachments.length) {
    const mixedBoundary = newBoundary("mix");
    let s =
      `Content-Type: multipart/mixed; boundary="${mixedBoundary}"${CRLF}${CRLF}` +
      `--${mixedBoundary}${CRLF}` +
      `Content-Type: multipart/alternative; boundary="${altBoundary}"${CRLF}${CRLF}` +
      `${altBody}`;
    for (const att of attachments) {
      const disposition = att.contentId ? "inline" : "attachment";
      s +=
        `--${mixedBoundary}${CRLF}` +
        `Content-Type: ${att.contentType}; name="${isPlainAscii(att.filename) ? att.filename.replace(/"/g, "") : "attachment"}"${CRLF}` +
        `Content-Transfer-Encoding: base64${CRLF}` +
        (att.contentId ? `Content-ID: <${att.contentId}>${CRLF}` : "") +
        `Content-Disposition: ${disposition}; ${encodeFilename(att.filename)}${CRLF}${CRLF}` +
        `${foldBase64(att.content.toString("base64"))}${CRLF}`;
    }
    s += `--${mixedBoundary}--${CRLF}`;
    body = s;
  } else {
    body = `Content-Type: multipart/alternative; boundary="${altBoundary}"${CRLF}${CRLF}${altBody}`;
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
