/**
 * 본문 조립(서버) — 모바일 앱 전용 경로.
 *
 * 앱은 본문을 **평문**으로 보낸다(블루프린트 §9.1 확정). 원문 HTML 을 앱 편집기에 실으면
 * 깨지거나 용량이 커지므로, 답장 인용·서명 삽입은 서버가 붙인다.
 * 웹은 지금처럼 완성된 bodyHtml 을 보내므로 이 모듈을 거치지 않는다.
 */
import { getMessageDetail } from "./messages";
import { listSignatures } from "./signatures";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 평문 → 최소 HTML(줄바꿈 보존). 앱이 보내는 본문은 신뢰하지 않고 이스케이프한다. */
export function plainToHtml(plain: string): string {
  const body = escapeHtml(plain ?? "").replace(/\r?\n/g, "<br />");
  return `<div>${body}</div>`;
}

function fmtQuoteHeader(from: string | null, at: string | null): string {
  const when = at ? new Date(at) : null;
  const date =
    when && !Number.isNaN(when.getTime())
      ? `${when.getFullYear()}년 ${when.getMonth() + 1}월 ${when.getDate()}일 ${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`
      : "";
  return escapeHtml(`${date} ${from ?? ""} 님이 작성:`.trim());
}

export type QuoteMode = "reply" | "forward";

/**
 * 앱이 보낸 평문에 인용·서명을 붙여 최종 HTML 을 만든다.
 * - quoteOf 가 있으면 원문을 blockquote 로 인용(전달은 헤더 요약을 함께 붙인다).
 * - 기본 서명이 있으면 본문 뒤에 삽입한다.
 * 원문 조회는 소유권 검증이 있는 getMessageDetail 을 쓴다(남의 메일은 인용되지 않는다).
 */
export async function assembleBody(input: {
  userId: string;
  plain: string;
  quoteOf?: string | null;
  quoteMode?: QuoteMode;
  applySignature?: boolean;
}): Promise<string> {
  const parts: string[] = [plainToHtml(input.plain)];

  if (input.applySignature !== false) {
    try {
      const sigs = await listSignatures(input.userId);
      const def = sigs.find((s) => s.isDefault) ?? null;
      if (def?.bodyHtml) parts.push(`<br /><div>${def.bodyHtml}</div>`);
    } catch {
      // 서명 조회 실패는 발송을 막지 않는다.
    }
  }

  if (input.quoteOf) {
    try {
      const src = await getMessageDetail(input.userId, input.quoteOf);
      if (src) {
        const original =
          src.bodyHtml && src.bodyHtml.trim()
            ? src.bodyHtml
            : `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(src.bodyText ?? "")}</pre>`;
        const header =
          input.quoteMode === "forward"
            ? `<div>---------- 전달된 메일 ----------<br />보낸사람: ${escapeHtml(src.fromAddr ?? "")}<br />제목: ${escapeHtml(src.subject ?? "")}<br />받는사람: ${escapeHtml((src.toAddrs ?? []).map((t) => t.address).join(", "))}</div>`
            : `<div>${fmtQuoteHeader(src.fromAddr, src.sentAt ?? src.createdAt)}</div>`;
        parts.push(
          `<br />${header}<blockquote style="margin:8px 0;padding-left:10px;border-left:3px solid #e5eaef;color:#5a6a85">${original}</blockquote>`
        );
      }
    } catch {
      // 원문을 못 읽으면 인용 없이 보낸다(발송 자체는 성공시킨다).
    }
  }

  return parts.join("");
}

/** 답장/전달 제목 — 중복 접두어를 만들지 않는다. */
export function quotedSubject(subject: string, mode: QuoteMode): string {
  const s = (subject ?? "").trim();
  if (mode === "reply") return /^re:/i.test(s) ? s : `Re: ${s}`;
  return /^(fwd|fw):/i.test(s) ? s : `Fwd: ${s}`;
}
