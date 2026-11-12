/**
 * 메일 쓰기 보조(2026-11-12 직원 요청 2·14·16) — DOM 없이 시험할 수 있는 순수 함수만 둔다.
 * - 표 정렬: 받는 쪽(Outlook·Gmail·네이버)에서도 유지되도록 margin 인라인 스타일 + (가운데만) align 속성.
 *   align="left"/"right" 는 표를 띄워(float) 뒤 글이 옆으로 흘러들므로 쓰지 않는다.
 * - 개인별 보내기: 받는 사람마다 To 헤더를 그 사람 하나로 바꾼다.
 * - 다시보내기: 보낸 메일 상세 → 메일 쓰기 초기값.
 */
import type { MailAddress } from "./mime";

export type BlockAlign = "left" | "center" | "right";

/** 표 정렬별 바깥 여백(위아래 8px). 왼쪽 정렬은 indentPx 만큼 앞을 띄운다. */
export function tableMarginCss(align: BlockAlign, indentPx = 0): string {
  if (align === "center") return "margin:8px auto";
  if (align === "right") return "margin:8px 0 8px auto";
  return `margin:8px auto 8px ${Math.max(0, Math.round(indentPx))}px`;
}

/** 표 삽입 HTML 의 여는 태그 — Outlook(워드 엔진)은 auto 여백을 무시하므로 가운데는 align 속성을 함께 단다. */
export function tableOpenTag(align: BlockAlign): string {
  const attr = align === "center" ? ` align="center"` : "";
  return `<table${attr} style="border-collapse:collapse;${tableMarginCss(align)};width:92%;table-layout:fixed">`;
}

/** 발송 사본의 헤더 수신자 — 개인별 보내기면 그 사람 하나(참조 없음), 아니면 전체. */
export function recipientHeaders(
  individual: boolean,
  recipient: MailAddress,
  to: MailAddress[],
  cc: MailAddress[]
): { to: MailAddress[]; cc: MailAddress[] } {
  return individual ? { to: [recipient], cc: [] } : { to, cc };
}

/** 주소 목록 → 메일 쓰기 입력값("이름 <주소>, 주소"). */
export function formatAddrList(list: { name?: string; address: string }[]): string {
  return list
    .filter((a) => a && a.address)
    .map((a) => {
      const name = (a.name ?? "").replace(/[<>",]/g, " ").replace(/\s+/g, " ").trim();
      return name ? `${name} <${a.address}>` : a.address;
    })
    .join(", ");
}

export interface ResendSource {
  toAddrs: { name?: string; address: string }[];
  ccAddrs: { name?: string; address: string }[];
  bccAddrs?: { name?: string; address: string }[];
  subject: string;
  bodyHtml: string | null;
  bodyText: string | null;
  sendIndividual?: boolean;
}

/**
 * 다시보내기 초기값 — 받는 사람·참조·숨은참조·제목·본문을 그대로 옮긴다(제목 접두어·서명 추가 없음).
 * 본문의 대용량 첨부 안내 블록은 그대로 남는다(링크 유효기간 안에서는 그대로 열린다).
 */
export function resendSeed(d: ResendSource): {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  bodyHtml: string;
  individual: boolean;
} {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return {
    to: formatAddrList(d.toAddrs),
    cc: formatAddrList(d.ccAddrs),
    bcc: formatAddrList(d.bccAddrs ?? []),
    subject: d.subject ?? "",
    bodyHtml: d.bodyHtml && d.bodyHtml.trim() ? d.bodyHtml : `<div style="white-space:pre-wrap">${esc(d.bodyText ?? "")}</div>`,
    individual: !!d.sendIndividual,
  };
}
