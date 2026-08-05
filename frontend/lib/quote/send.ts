// 견적 자동 생성·발송 파이프라인 — 결재 최종 승인 커밋 후 fire-and-forget 으로 실행된다
// (lib/approval/docs.ts actOnDoc, 공문 processLetterSend 와 동일 패턴).
// 발송 모드(작성 시 선택 — 확정 사항 7):
//   mail   → 산출물 생성·S3 보관 후 참조자 메일로 PDF 발송(sent/failed)
//   direct → 산출물 생성·S3 보관까지만(generated). 사용자가 대장에서 PDF 를 다운로드해
//            발주처 전자조달시스템 등에 직접 제출한다.
// 실패해도 문서는 approved 유지, 대장에만 failed 마킹 → 발송견적 탭의 재발송 버튼이 재호출.

import { getDoc } from "@/lib/approval/docs";
import { sendMail } from "@/lib/mail/send";
import { COMPANY_KO } from "@/lib/letter/types";
import { generateQuoteArtifacts } from "./generate";
import { claimQuoteSend, finishQuoteSend } from "./store";
import type { QuoteFieldValues, QuoteRecipient } from "./types";

/** SES raw 10MB(base64 오버헤드 감안 실효 ~7MB) — 공문 발송과 동일 기준 */
const ATTACH_LIMIT_BYTES = 7 * 1024 * 1024;

function toAddresses(list: QuoteRecipient[]): { name?: string; address: string }[] {
  return (list ?? [])
    .filter((r) => (r.email ?? "").includes("@"))
    .map((r) => ({ name: [r.facilityName, r.name].filter(Boolean).join(" ") || undefined, address: String(r.email) }));
}

function buildMailBody(quoteNo: string, title: string, totalText: string, validUntil: string, drafterName: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const tr = (k: string, v: string) =>
    `<tr><td style="border:1px solid #d5d7dd;padding:6px 12px;background:#f4f5f8;font-weight:bold">${k}</td><td style="border:1px solid #d5d7dd;padding:6px 12px">${v}</td></tr>`;
  return [
    `<div style="font-size:14px;line-height:1.7;color:#222">`,
    `<p>안녕하십니까, ${esc(COMPANY_KO)}입니다.</p>`,
    `<p>아래 용역 견적서를 송부드리오니 검토 부탁드립니다.</p>`,
    `<table style="border-collapse:collapse;margin:12px 0">`,
    tr("견적번호", esc(quoteNo)),
    tr("건명", esc(title)),
    tr("견적금액", `${esc(totalText)} (V.A.T 별도)`),
    tr("유효기간", esc(validUntil) + " 까지"),
    `</table>`,
    `<p>감사합니다.<br>${esc(COMPANY_KO)} ${esc(drafterName)} 드림</p>`,
    `</div>`,
  ].join("");
}

/**
 * 견적 발송 처리 — ① 대장 선점(pending|failed|generated→generating) ② xlsx/PDF 생성·S3 보관
 * ③ (mail 모드) 참조자 메일로 PDF 발송 ④ sent|generated|failed 확정.
 */
export async function processQuoteSend(docId: string): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const claimed = await claimQuoteSend(docId);
  if (!claimed) return { ok: true, skipped: true };
  const mode = claimed.sendMode;
  try {
    const doc = await getDoc(docId);
    if (!doc) throw new Error("문서를 찾을 수 없습니다.");
    if (doc.status !== "approved") throw new Error("승인 완료 문서만 발송할 수 있습니다.");
    const values = doc.fieldValues as unknown as QuoteFieldValues;

    const artifacts = await generateQuoteArtifacts(docId, { persist: true });

    if (mode === "direct") {
      await finishQuoteSend(docId, { ok: true, mode });
      return { ok: true };
    }

    if (!doc.drafterUserId) throw new Error("기안자 계정을 확인할 수 없습니다.");
    // 발송 대상(To) = 참조 담당자 메일(공문과 동일 규약 — 수신처는 업체/기관 표기용).
    const toAll = [...toAddresses(values.cc_refs ?? []), ...toAddresses(values.recipients ?? [])];
    const seen = new Set<string>();
    const to = toAll.filter((a) => (seen.has(a.address.toLowerCase()) ? false : (seen.add(a.address.toLowerCase()), true)));
    if (!to.length) throw new Error("참조자에 유효한 메일주소가 없습니다. 참조자를 보완 후 재발송하세요.");

    // 외부 발송은 PDF만(확정 사항 2 — xlsx 원본 미제공)
    const attachments = [
      { filename: `${artifacts.fileBase}.pdf`, contentType: "application/pdf", content: Buffer.from(artifacts.pdfBytes) },
    ];
    const total = attachments.reduce((a, f) => a + f.content.length, 0);
    if (total > ATTACH_LIMIT_BYTES) {
      throw new Error(`견적서 PDF 가 메일 한도(7MB)를 초과합니다(${(total / 1024 / 1024).toFixed(1)}MB).`);
    }

    const totalAmount = (values.sites ?? []).reduce((acc, s) => acc + (Number(s?.amounts?.final) || 0), 0);
    const result = await sendMail({
      userId: doc.drafterUserId,
      to,
      subject: `[견적서] ${artifacts.quoteNo} ${artifacts.title}`,
      bodyHtml: buildMailBody(
        artifacts.quoteNo,
        artifacts.title,
        `${Math.round(totalAmount).toLocaleString("ko-KR")}원`,
        claimed.validUntil ?? "",
        doc.drafterName ?? ""
      ),
      attachments,
      idempotencyKey: `quote-send:${docId}:${claimed.sendAttempts}`,
    });
    if (!result.ok) throw new Error(result.error ?? "메일 발송 실패");

    await finishQuoteSend(docId, { ok: true, mode, messageId: result.messageId ?? null });
    return { ok: true };
  } catch (err) {
    const message = (err as Error).message ?? "발송 실패";
    await finishQuoteSend(docId, { ok: false, mode, error: message }).catch(() => {});
    return { ok: false, error: message };
  }
}
