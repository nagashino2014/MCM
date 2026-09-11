// 공문 사전 검수(221) — 상신 전에 작성 중인 공문 PDF·첨부서류를 사내 검수자에게 보내 확인받는다.
// 결재선과 무관한 별도 경로다: 채번·발송 상태(official_letters)를 건드리지 않고, 회차 이력만 남긴다.
// 발신 = 기안자 개인 @koensain.app 계정(lib/mail/send.ts) — 대외 발송(send.ts)과 같은 첨부 규칙을 쓴다.

import crypto from "node:crypto";
import { getDb, rowsToObjects } from "@/lib/db";
import { getDoc } from "@/lib/approval/docs";
import { sendMail } from "@/lib/mail/send";
import { readStorageObject } from "@/lib/contracts/document-bundle";
import { generateLetterArtifacts } from "./generate";
import {
  ATTACH_LIMIT_BYTES,
  defaultSignatureHtml,
  internalCcAddresses,
  makeDownloadLink,
  type DownloadLink,
} from "./send";
import { COMPANY_KO, type LetterFieldValues } from "./types";

export interface LetterReviewer {
  userId: string;
  name: string;
  position?: string | null;
  address: string;
}

export interface LetterReviewRecord {
  reviewId: string;
  docId: string;
  requesterName: string | null;
  reviewers: LetterReviewer[];
  note: string | null;
  letterNo: string | null;
  subject: string | null;
  attachNames: string[];
  ok: boolean;
  error: string | null;
  createdAt: string;
}

/** 검수 요청 메일 본문 — 대외 공문 본문과 달리 "확인 부탁" 톤이고, 검수용임을 명시한다. */
function buildReviewMailBody(input: {
  letterNo: string;
  title: string;
  requesterLabel: string;
  note: string;
  attachNames: string[];
  links: DownloadLink[];
  signatureHtml: string | null;
}): string {
  const { letterNo, title, requesterLabel, note, attachNames, links, signatureHtml } = input;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return [
    `<div style="font-size:14px;line-height:1.7;color:#222;padding-left:30pt">`,
    `<p>안녕하세요, ${esc(COMPANY_KO)} ${esc(requesterLabel)} 입니다.</p>`,
    `<p>대외 발송 <b>전</b> 사전 검수를 요청드립니다. 첨부한 공문(안)과 첨부서류를 확인해 주시고, 수정이 필요한 부분은 이 메일로 회신해 주시기 바랍니다.</p>`,
    `<table style="border-collapse:collapse;margin:12px 0">`,
    `<tr><td style="border:1px solid #d5d7dd;padding:6px 12px;background:#f4f5f8;font-weight:bold">문서번호</td><td style="border:1px solid #d5d7dd;padding:6px 12px">${esc(letterNo)}</td></tr>`,
    `<tr><td style="border:1px solid #d5d7dd;padding:6px 12px;background:#f4f5f8;font-weight:bold">제목</td><td style="border:1px solid #d5d7dd;padding:6px 12px">${esc(title)}</td></tr>`,
    attachNames.length
      ? `<tr><td style="border:1px solid #d5d7dd;padding:6px 12px;background:#f4f5f8;font-weight:bold">첨부</td><td style="border:1px solid #d5d7dd;padding:6px 12px">${attachNames.map(esc).join("<br>")}</td></tr>`
      : "",
    `</table>`,
    note.trim()
      ? `<p style="margin:12px 0;padding:10px 12px;border-left:3px solid #5D87FF;background:#f7f9ff;white-space:pre-wrap">${esc(note.trim())}</p>`
      : "",
    links.length
      ? [
          `<p style="margin-top:14px"><b>첨부서류 다운로드</b> — 용량 관계로 아래 링크에서 받아주세요(7일간 유효):</p>`,
          `<ul style="margin:6px 0 12px">`,
          ...links.map((l) => `<li><a href="${l.url}">${esc(l.name)}</a> <span style="color:#888">(${l.sizeMB}MB)</span></li>`),
          `</ul>`,
        ].join("")
      : "",
    `<p style="color:#888;font-size:12.5px">※ 아직 결재 상신 전의 검수용 문서입니다. 대외 발송본이 아니며, 공문번호는 상신 시 확정됩니다.</p>`,
    `<p>감사합니다.<br>${esc(COMPANY_KO)} ${esc(requesterLabel)} 드림</p>`,
    signatureHtml ? `<div style="margin-top:18px">${signatureHtml}</div>` : "",
    `</div>`,
  ].join("");
}

function jsonArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function recordReview(input: {
  docId: string;
  requestedBy: string;
  requesterName: string | null;
  reviewers: LetterReviewer[];
  note: string;
  letterNo: string | null;
  subject: string;
  attachNames: string[];
  ok: boolean;
  error: string | null;
  messageId: string | null;
}): Promise<void> {
  const db = await getDb();
  await db.exec(
    `INSERT INTO letter_reviews
       (review_id, doc_id, requested_by, requester_name, reviewers, note, letter_no, subject, attach_names, ok, error, message_id, created_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb,$10,$11,$12,$13)`,
    [
      `lrv-${crypto.randomUUID()}`,
      input.docId,
      input.requestedBy,
      input.requesterName,
      JSON.stringify(input.reviewers),
      input.note.trim() || null,
      input.letterNo,
      input.subject,
      JSON.stringify(input.attachNames),
      input.ok ? 1 : 0,
      input.error,
      input.messageId,
      new Date().toISOString(),
    ]
  );
}

/** 한 공문의 사전 검수 이력(최근순) — 작성 화면이 "n차 검수 요청" 을 보여준다. */
export async function listLetterReviews(docId: string): Promise<LetterReviewRecord[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT review_id, doc_id, requester_name, reviewers, note, letter_no, subject, attach_names, ok, error, created_at
         FROM letter_reviews WHERE doc_id = $1 ORDER BY created_at DESC`,
      [docId]
    )
  );
  return rows.map((r) => ({
    reviewId: String(r.review_id),
    docId: String(r.doc_id),
    requesterName: r.requester_name != null ? String(r.requester_name) : null,
    reviewers: jsonArray(r.reviewers) as LetterReviewer[],
    note: r.note != null ? String(r.note) : null,
    letterNo: r.letter_no != null ? String(r.letter_no) : null,
    subject: r.subject != null ? String(r.subject) : null,
    attachNames: jsonArray(r.attach_names).map((x) => String(x)),
    ok: Number(r.ok ?? 0) === 1,
    error: r.error != null ? String(r.error) : null,
    createdAt: String(r.created_at),
  }));
}

/**
 * 사전 검수 발송 — 임시저장된 공문 문서(docId)의 PDF(+HWPX·동봉 서류)를 검수자 메일로 보낸다.
 * 승인 전 문서라 번호는 "미채번" 으로 렌더되고 S3 보관도 하지 않는다(persist=false).
 */
export async function sendLetterReview(input: {
  docId: string;
  requesterUserId: string;
  reviewerIds: string[];
  note?: string;
  /** 검수자에게 어느 주소로 보낼지 — 작성 화면의 참조 메일 설정과 같은 규칙(기본 개인 메일). */
  target?: "personal" | "company";
}): Promise<{ ok: boolean; error?: string; reviewers: LetterReviewer[]; attachNames: string[] }> {
  const { docId, requesterUserId } = input;
  const note = input.note ?? "";
  const reviewerIds = [...new Set((input.reviewerIds ?? []).filter(Boolean))];
  if (!reviewerIds.length) return { ok: false, error: "검수자를 1명 이상 선택하세요.", reviewers: [], attachNames: [] };

  const doc = await getDoc(docId);
  if (!doc) return { ok: false, error: "문서를 찾을 수 없습니다.", reviewers: [], attachNames: [] };
  if (doc.drafterUserId !== requesterUserId) {
    return { ok: false, error: "본인이 기안한 공문만 검수 요청할 수 있습니다.", reviewers: [], attachNames: [] };
  }
  const values = doc.fieldValues as unknown as LetterFieldValues;

  // 검수자 메일 주소 — 전자결재 참조자와 같은 규칙(개인 메일 우선, 없으면 회사 메일).
  // 메일주소가 없는 인원은 조회 결과에서 빠진다(선택 인원 < 실제 수신자일 수 있음).
  const addrs = await internalCcAddresses(reviewerIds, input.target === "company" ? "company" : "personal");
  if (!addrs.length) {
    return { ok: false, error: "선택한 검수자의 메일주소를 찾을 수 없습니다.", reviewers: [], attachNames: [] };
  }
  const reviewers: LetterReviewer[] = addrs.map((a) => ({
    userId: a.userId,
    name: a.name ?? "",
    position: null,
    address: a.address,
  }));

  let attachNames: string[] = [];
  try {
    const artifacts = await generateLetterArtifacts(docId, { persist: false });
    const attachments: { filename: string; contentType: string; content: Buffer }[] = [
      { filename: `${artifacts.fileBase}.pdf`, contentType: "application/pdf", content: Buffer.from(artifacts.pdfBytes) },
    ];
    if (values.include_hwpx === 1 && artifacts.hwpxBytes) {
      attachments.push({
        filename: `${artifacts.fileBase}.hwpx`,
        contentType: "application/vnd.hancom.hwpx",
        content: Buffer.from(artifacts.hwpxBytes),
      });
    }

    // 동봉 서류 — 대외 발송과 같은 규칙(총량 한도 이내면 직접 첨부, 넘으면 다운로드 링크).
    const files = values.file_attachments ?? [];
    const docsTotal = attachments.reduce((a, f) => a + f.content.length, 0);
    const filesTotal = files.reduce((a, f) => a + (f.size || 0), 0);
    const links: DownloadLink[] = [];
    if (files.length && docsTotal + filesTotal <= ATTACH_LIMIT_BYTES) {
      for (const f of files) {
        const bytes = await readStorageObject(f.key).catch(() => null);
        if (bytes) attachments.push({ filename: f.name, contentType: "application/octet-stream", content: Buffer.from(bytes) });
        else console.warn(`[letter] 검수 첨부 로드 실패(제외): ${f.key}`);
      }
    } else if (files.length) {
      for (const f of files) {
        const link = await makeDownloadLink(f.key, f.name, f.size || 0);
        if (link) links.push(link);
        else console.warn(`[letter] 검수 다운로드 링크 생성 실패(제외): ${f.key}`);
      }
    }
    let total = attachments.reduce((a, f) => a + f.content.length, 0);
    if (total > ATTACH_LIMIT_BYTES) {
      const hwpxIdx = attachments.findIndex((a) => a.filename.endsWith(".hwpx"));
      if (hwpxIdx >= 0) {
        attachments.splice(hwpxIdx, 1);
        total = attachments.reduce((a, f) => a + f.content.length, 0);
      }
    }
    if (total > ATTACH_LIMIT_BYTES) {
      throw new Error(`첨부 총량이 메일 한도(20MB)를 초과합니다(${(total / 1024 / 1024).toFixed(1)}MB).`);
    }
    attachNames = [...attachments.map((a) => a.filename), ...links.map((l) => l.name)];

    const requesterLabel = [doc.drafterName ?? "", doc.drafterPosition ?? ""].filter(Boolean).join(" ").trim();
    const signatureHtml = await defaultSignatureHtml(requesterUserId);
    const result = await sendMail({
      userId: requesterUserId,
      to: addrs,
      subject: `[사전검수] ${artifacts.letterNo} ${artifacts.title}`,
      bodyHtml: buildReviewMailBody({
        letterNo: artifacts.letterNo,
        title: artifacts.title,
        requesterLabel,
        note,
        attachNames,
        links,
        signatureHtml,
      }),
      attachments,
      // 수정 후 다시 보낼 수 있어야 한다(2차·3차 검수) → 시각으로 멱등키를 가른다.
      idempotencyKey: `letter-review:${docId}:${Date.now()}`,
    });
    if (!result.ok) throw new Error(result.error ?? "메일 발송 실패");

    await recordReview({
      docId,
      requestedBy: requesterUserId,
      requesterName: doc.drafterName ?? null,
      reviewers,
      note,
      letterNo: doc.docNo ?? null,
      subject: doc.title,
      attachNames,
      ok: true,
      error: null,
      messageId: result.messageId ?? null,
    });
    return { ok: true, reviewers, attachNames };
  } catch (err) {
    const message = (err as Error).message ?? "검수 요청 발송 실패";
    await recordReview({
      docId,
      requestedBy: requesterUserId,
      requesterName: doc.drafterName ?? null,
      reviewers,
      note,
      letterNo: doc.docNo ?? null,
      subject: doc.title,
      attachNames,
      ok: false,
      error: message,
      messageId: null,
    }).catch(() => {});
    return { ok: false, error: message, reviewers, attachNames };
  }
}
