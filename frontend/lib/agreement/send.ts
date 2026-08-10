// 계약서 수동 발송 파이프라인 — 공문(lib/letter/send.ts)과 달리 승인 시 자동 실행되지 않는다.
// 보드의 [발주처 발송] 다이얼로그에서 수신 담당자·첨부 구성을 확정해 호출한다(① 확정).
// 기본 첨부 = HWPX(초안 수정 협의용, ④ 확정) — PDF 는 옵션. HWPX 생성 실패 시 PDF 폴백.
// 실패해도 문서는 approved 유지, 대장만 failed → 재발송 버튼이 같은 함수를 다시 호출한다.

import { getDb, rowsToObjects } from "@/lib/db";
import { getDoc } from "@/lib/approval/docs";
import { MAIL_DOMAIN } from "@/lib/mail/mailbox";
import { sendMail } from "@/lib/mail/send";
import { listSignatures } from "@/lib/mail/signatures";
import { COMPANY_KO } from "@/lib/letter/types";
import { generateAgreementArtifacts } from "./generate";
import { claimAgreementSend, finishAgreementSend } from "./store";
import type { AgreementFieldValues, AgreementRecipient } from "./types";

/** 공문과 동일 상한 — SES 실효 한도·수신 측(네이버·Gmail 25MB 안팎) 고려 */
const ATTACH_LIMIT_BYTES = 20 * 1024 * 1024;

const COMPANY_SHORT = COMPANY_KO.replace(/^주식회사\s*/, "");

async function defaultSignatureHtml(userId: string): Promise<string | null> {
  try {
    const sigs = await listSignatures(userId);
    return sigs.find((s) => s.isDefault)?.bodyHtml?.trim() || null;
  } catch {
    return null;
  }
}

/** 내부 참조(Cc) — 결재선의 참조/열람자. 개인 메일 우선(공문 관례, 전사 배포 전) */
async function internalCcAddresses(userIds: string[]): Promise<{ name?: string; address: string }[]> {
  if (!userIds.length) return [];
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT u.user_id, COALESCE(ep.name, u.email) AS name, ep.email AS personal_email,
              COALESCE(mb.address, NULLIF(LOWER(u.email_local), '') || '@' || $2) AS company_email
         FROM users u
         LEFT JOIN employee_profiles ep ON ep.user_id = u.user_id
         LEFT JOIN mailboxes mb ON mb.user_id = u.user_id AND mb.status = 'active'
        WHERE u.user_id = ANY($1)`,
      [userIds, MAIL_DOMAIN]
    )
  );
  const out: { name?: string; address: string }[] = [];
  for (const r of rows) {
    const personal = r.personal_email != null ? String(r.personal_email).trim() : "";
    const company = r.company_email != null ? String(r.company_email).trim() : "";
    const picked = personal || company;
    if (picked.includes("@")) out.push({ name: r.name != null ? String(r.name) : undefined, address: picked });
  }
  return out;
}

function buildMailBody(input: {
  title: string;
  ordererName: string;
  senderLabel: string;
  attachNames: string[];
  signatureHtml: string | null;
  note?: string | null;
}): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return [
    `<div style="font-size:14px;line-height:1.7;color:#222">`,
    `<p>안녕하세요, ${esc(COMPANY_KO)} ${esc(input.senderLabel)} 입니다.</p>`,
    `<p>「${esc(input.title)}」 계약서 초안을 송부드립니다.<br>검토하시고 수정·보완이 필요한 사항이 있으면 회신 부탁드립니다.</p>`,
    input.note?.trim() ? `<p>${esc(input.note.trim()).replace(/\n/g, "<br>")}</p>` : "",
    `<table style="border-collapse:collapse;margin:12px 0">`,
    `<tr><td style="border:1px solid #d5d7dd;padding:6px 12px;background:#f4f5f8;font-weight:bold">계약명</td><td style="border:1px solid #d5d7dd;padding:6px 12px">${esc(input.title)}</td></tr>`,
    `<tr><td style="border:1px solid #d5d7dd;padding:6px 12px;background:#f4f5f8;font-weight:bold">발주처</td><td style="border:1px solid #d5d7dd;padding:6px 12px">${esc(input.ordererName)}</td></tr>`,
    input.attachNames.length
      ? `<tr><td style="border:1px solid #d5d7dd;padding:6px 12px;background:#f4f5f8;font-weight:bold">첨부</td><td style="border:1px solid #d5d7dd;padding:6px 12px">${input.attachNames.map(esc).join("<br>")}</td></tr>`
      : "",
    `</table>`,
    `<p>감사합니다.<br>${esc(COMPANY_KO)} ${esc(input.senderLabel)} 드림</p>`,
    input.signatureHtml ? `<div style="margin-top:18px">${input.signatureHtml}</div>` : "",
    `</div>`,
  ].join("");
}

export interface AgreementSendOptions {
  recipients: AgreementRecipient[];
  /** 기본 true — 초안은 HWPX 로 협의(④ 확정) */
  includeHwpx?: boolean;
  /** 기본 false — 필요 시 PDF 병행 첨부 */
  includePdf?: boolean;
  /** 메일 본문 추가 안내 문구(선택) */
  note?: string | null;
}

/**
 * 계약서 발송 — ① 대장 선점(approved|failed→sending) ② PDF/HWPX 생성·S3 보관
 * ③ 발주처 담당자 메일 발송(To=담당자, Cc=결재 참조자) ④ sent/failed 확정.
 */
export async function processAgreementSend(
  docId: string,
  opts: AgreementSendOptions
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const claimed = await claimAgreementSend(docId);
  if (!claimed) return { ok: false, skipped: true, error: "발송 가능한 상태가 아닙니다(승인 완료 후 발송 가능)." };
  try {
    const doc = await getDoc(docId);
    if (!doc) throw new Error("문서를 찾을 수 없습니다.");
    if (doc.status !== "approved") throw new Error("승인 완료 문서만 발송할 수 있습니다.");
    if (!doc.drafterUserId) throw new Error("기안자 계정을 확인할 수 없습니다.");
    const fv = doc.fieldValues as unknown as AgreementFieldValues;

    const to = (opts.recipients ?? [])
      .filter((r) => (r.email ?? "").includes("@"))
      .map((r) => ({ name: [r.facilityName, r.name].filter(Boolean).join(" ") || undefined, address: String(r.email) }));
    if (!to.length) throw new Error("수신 담당자에 유효한 메일주소가 없습니다.");

    const artifacts = await generateAgreementArtifacts(docId, { persist: true });

    const includeHwpx = opts.includeHwpx !== false;
    const includePdf = opts.includePdf === true;
    const attachments: { filename: string; contentType: string; content: Buffer }[] = [];
    if (includeHwpx && artifacts.hwpxBytes) {
      attachments.push({
        filename: `${artifacts.fileBase}.hwpx`,
        contentType: "application/vnd.hancom.hwpx",
        content: Buffer.from(artifacts.hwpxBytes),
      });
    }
    if (includePdf || attachments.length === 0) {
      // PDF 옵션 또는 HWPX 미생성 폴백 — 빈 첨부 발송은 하지 않는다
      attachments.push({ filename: `${artifacts.fileBase}.pdf`, contentType: "application/pdf", content: Buffer.from(artifacts.pdfBytes) });
    }
    const total = attachments.reduce((a, f) => a + f.content.length, 0);
    if (total > ATTACH_LIMIT_BYTES) {
      throw new Error(`첨부 총량이 메일 한도(20MB)를 초과합니다(${(total / 1024 / 1024).toFixed(1)}MB).`);
    }

    const seen = new Set(to.map((a) => a.address.toLowerCase()));
    const watcherIds = doc.watchers.map((w) => w.userId).filter(Boolean);
    const cc = (await internalCcAddresses(watcherIds)).filter((a) =>
      seen.has(a.address.toLowerCase()) ? false : (seen.add(a.address.toLowerCase()), true)
    );

    const senderLabel = [doc.drafterName ?? "", doc.drafterPosition ?? ""].filter(Boolean).join(" ").trim();
    const signatureHtml = await defaultSignatureHtml(doc.drafterUserId);

    const result = await sendMail({
      userId: doc.drafterUserId,
      to,
      cc,
      subject: `[${COMPANY_SHORT}] 계약서 초안 검토 요청 — ${artifacts.title}`,
      bodyHtml: buildMailBody({
        title: artifacts.title,
        ordererName: fv.orderer?.name ?? "",
        senderLabel,
        attachNames: attachments.map((a) => a.filename),
        signatureHtml,
        note: opts.note,
      }),
      attachments,
      idempotencyKey: `agreement-send:${docId}:${claimed.sendAttempts}`,
    });
    if (!result.ok) throw new Error(result.error ?? "메일 발송 실패");

    await finishAgreementSend(docId, {
      ok: true,
      sentTo: { recipients: opts.recipients, includeHwpx, includePdf },
      messageId: result.messageId ?? null,
    });
    return { ok: true };
  } catch (err) {
    const message = (err as Error).message ?? "발송 실패";
    await finishAgreementSend(docId, { ok: false, error: message }).catch(() => {});
    return { ok: false, error: message };
  }
}
