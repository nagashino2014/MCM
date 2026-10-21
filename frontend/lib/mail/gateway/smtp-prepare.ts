/**
 * 외부 메일 프로그램 게이트웨이 — SMTP 제출 원문 점검·보정(순수 함수, DB·SES 없음 — 단위 테스트 대상).
 * 발신자 확인(헤더 From·봉투 MAIL FROM 모두 내 발신 주소), Message-ID·Date 보충, Bcc 제거(바깥 원문)·보존(보낸 사본).
 */
import crypto from "node:crypto";
import { parseAddressList, parseHeaderFields, headerValue } from "@/lib/mail/gateway/mime-tree";
import type { GwUser } from "@/lib/mail/gateway/types";

export class SmtpReject extends Error {
  constructor(public readonly responseCode: number, message: string) {
    super(message);
  }
}

function headerEndOf(raw: Buffer): number {
  let i = 0;
  while (i < raw.length) {
    const lf = raw.indexOf(0x0a, i);
    if (lf < 0) return raw.length;
    if (lf === i || (lf === i + 1 && raw[i] === 0x0d)) return lf + 1;
    i = lf + 1;
  }
  return raw.length;
}

function addrsOf(value: string | null): string[] {
  return (parseAddressList(value) ?? [])
    .filter((a) => a.mailbox && a.host)
    .map((a) => `${a.mailbox}@${a.host}`.toLowerCase());
}

export interface PreparedSubmission {
  /** 바깥으로 나갈 원문(Bcc 제거). */
  outgoing: Buffer;
  /** 보낸편지함 사본(숨은 수신자 Bcc 포함). */
  sentCopy: Buffer;
  messageIdHeader: string;
  fromAddress: string;
}

/**
 * 원문 점검·보정(순수 함수, 테스트 대상). Message-ID·Date 가 없으면 앞에 붙이고,
 * Bcc 헤더는 바깥 원문에서 뺀다.
 */
export function prepareSubmission(raw: Buffer, user: GwUser, mailFrom: string, rcpts: string[], now = new Date()): PreparedSubmission {
  const hEnd = headerEndOf(raw);
  const fields = parseHeaderFields(raw, 0, hEnd);
  const fromList = addrsOf(headerValue(fields, "from"));
  if (fromList.length !== 1) throw new SmtpReject(550, "From header must contain exactly one address");
  const fromAddress = fromList[0];
  const allowed = user.sendAddresses.map((a) => a.toLowerCase());
  if (!allowed.includes(fromAddress) || !allowed.includes(mailFrom.toLowerCase())) {
    throw new SmtpReject(553, "Sender address is not yours");
  }
  const prefix: string[] = [];
  let messageIdHeader = headerValue(fields, "message-id")?.trim() ?? "";
  if (!/^<[^<>\s]+@[^<>\s]+>$/.test(messageIdHeader)) {
    messageIdHeader = `<${crypto.randomUUID().replace(/-/g, "")}@${fromAddress.split("@")[1]}>`;
    prefix.push(`Message-ID: ${messageIdHeader}`);
  }
  if (!headerValue(fields, "date")) prefix.push(`Date: ${now.toUTCString().replace("GMT", "+0000")}`);
  const pre = Buffer.from(prefix.map((l) => l + "\r\n").join(""), "utf8");

  // 바깥 원문: Bcc 필드 바이트 구간을 잘라낸다.
  const bccFields = fields.filter((f) => f.name === "bcc");
  const keep: Buffer[] = [pre];
  let pos = 0;
  for (const f of bccFields) {
    keep.push(raw.subarray(pos, f.start));
    pos = f.end;
  }
  keep.push(raw.subarray(pos));
  const outgoing = Buffer.concat(keep);

  // 보낸 사본: 헤더 To/Cc 에 없는 봉투 수신자를 Bcc 로 남긴다(원문에 Bcc 가 있으면 그대로).
  const visible = new Set([...addrsOf(headerValue(fields, "to")), ...addrsOf(headerValue(fields, "cc"))]);
  const hidden = rcpts.map((r) => r.toLowerCase()).filter((r) => !visible.has(r));
  const bccLine = !bccFields.length && hidden.length ? Buffer.from(`Bcc: ${[...new Set(hidden)].join(", ")}\r\n`, "utf8") : Buffer.alloc(0);
  const sentCopy = Buffer.concat([pre, bccLine, raw]);
  return { outgoing, sentCopy, messageIdHeader, fromAddress };
}
