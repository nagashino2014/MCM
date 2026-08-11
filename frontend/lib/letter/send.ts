// 공문 자동 발송 파이프라인 — 결재 최종 승인 커밋 후 fire-and-forget 으로 실행된다
// (lib/approval/docs.ts actOnDoc). 실패해도 문서는 approved 유지, 대장에만 failed 마킹
// → 발송공문 탭/팝업의 재발송 버튼이 같은 함수를 다시 호출한다.
// 발신 = 기안자 개인 @koensain.app 계정(lib/mail/send.ts — 첨부 S3 적재·발신함 기록·멱등).

import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getDb, rowsToObjects } from "@/lib/db";
import { getDoc } from "@/lib/approval/docs";
import { MAIL_DOMAIN } from "@/lib/mail/mailbox";
import { sendMail } from "@/lib/mail/send";
import { listSignatures } from "@/lib/mail/signatures";
import { readStorageObject } from "@/lib/contracts/document-bundle";
import { getS3Client } from "@/lib/storage/logo-storage";
import { markDeliverablesSent } from "@/lib/deliverable/store";
import { generateLetterArtifacts } from "./generate";
import { claimLetterSend, finishLetterSend } from "./store";
import { COMPANY_KO, type LetterFieldValues, type LetterRecipient } from "./types";

/** SES v2 raw 40MB(base64 오버헤드 감안 실효 ~28MB). 수신 측 한도(네이버·Gmail 25MB 안팎)를
 *  고려해 20MB 를 상한으로 둔다 — 웬만한 동봉 서류는 그대로 첨부되어 메일함에 남는다(사용자 확정).
 *  동봉 서류 총량은 200MB 까지 허용하되, 이 한도를 넘는 발송만 다운로드 링크(presigned, 7일)로 전환. */
const ATTACH_LIMIT_BYTES = 20 * 1024 * 1024;
const LINK_EXPIRES_SEC = 7 * 24 * 3600; // presigned GET 최대 유효기간(7일)

interface DownloadLink {
  name: string;
  url: string;
  sizeMB: string;
}

/** 동봉 서류 presigned 다운로드 링크 생성 — S3 모드에서만 가능(로컬 스토리지는 null). */
async function makeDownloadLink(key: string, name: string, size: number): Promise<DownloadLink | null> {
  const bucket = process.env.MCM_STORAGE_BUCKET?.trim();
  if (!bucket || process.env.CONTRACT_DOCUMENT_STORAGE_ROOT?.trim()) return null;
  try {
    const url = await getSignedUrl(getS3Client(), new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: LINK_EXPIRES_SEC });
    return { name, url, sizeMB: (size / 1024 / 1024).toFixed(1) };
  } catch {
    return null;
  }
}

/** 메일 제목 접두어 — 수신 측 메일함에서 발신 기관이 바로 보이도록(사용자 확정). */
const COMPANY_SHORT = COMPANY_KO.replace(/^주식회사\s*/, "");

/** 기안자의 기본 메일 서명(HTML). 미등록·조회 실패면 null — 발송을 막지 않는다. */
async function defaultSignatureHtml(userId: string): Promise<string | null> {
  try {
    const sigs = await listSignatures(userId);
    return sigs.find((s) => s.isDefault)?.bodyHtml?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * 내부 참조자(전자결재 참조/열람자) 메일 주소 조회.
 * target=personal → 개인 메일(employee_profiles.email) 우선, 없으면 회사 메일로 폴백.
 * target=company  → 회사 메일(@koensain.app) 우선, 없으면 개인 메일로 폴백.
 * 앱을 전사 배포하기 전에는 개인 메일이 기본이다(사용자 확정).
 */
async function internalCcAddresses(
  userIds: string[],
  target: "personal" | "company"
): Promise<{ name?: string; address: string }[]> {
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
    const picked = target === "personal" ? personal || company : company || personal;
    if (picked.includes("@")) out.push({ name: r.name != null ? String(r.name) : undefined, address: picked });
  }
  return out;
}

function toAddresses(list: LetterRecipient[]): { name?: string; address: string }[] {
  return (list ?? [])
    .filter((r) => (r.email ?? "").includes("@"))
    .map((r) => ({ name: [r.facilityName, r.name].filter(Boolean).join(" ") || undefined, address: String(r.email) }));
}

function buildMailBody(input: {
  letterNo: string;
  title: string;
  /** 발송자 표기 — "성명 직함"(직함 없으면 성명만) */
  senderLabel: string;
  attachNames: string[];
  links: DownloadLink[];
  /** 기안자의 기본 메일 서명(HTML) — 등록돼 있으면 맨 하단에 붙인다. */
  signatureHtml: string | null;
  /** 동봉 서류 존재 여부 — 인사말 문구가 "공문 및 첨부서류" / "공문" 으로 갈린다. */
  hasEnclosures: boolean;
}): string {
  const { letterNo, title, senderLabel, attachNames, links, signatureHtml, hasEnclosures } = input;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // 본문 전체를 왼쪽에서 30pt 들여 쓴다 — 왼쪽 끝에 붙으면 답답해 보인다(사용자 확정).
  // 표·서명까지 같은 기준선에 놓이도록 바깥 div 한 겹에만 준다.
  return [
    `<div style="font-size:14px;line-height:1.7;color:#222;padding-left:30pt">`,
    `<p>안녕하세요, ${esc(COMPANY_KO)} ${esc(senderLabel)} 입니다.</p>`,
    `<p>아래 공문${hasEnclosures ? " 및 첨부서류를" : "을"} 송부드리오니 검토하여 주시기 바랍니다.</p>`,
    `<table style="border-collapse:collapse;margin:12px 0">`,
    `<tr><td style="border:1px solid #d5d7dd;padding:6px 12px;background:#f4f5f8;font-weight:bold">문서번호</td><td style="border:1px solid #d5d7dd;padding:6px 12px">${esc(letterNo)}</td></tr>`,
    `<tr><td style="border:1px solid #d5d7dd;padding:6px 12px;background:#f4f5f8;font-weight:bold">제목</td><td style="border:1px solid #d5d7dd;padding:6px 12px">${esc(title)}</td></tr>`,
    attachNames.length
      ? `<tr><td style="border:1px solid #d5d7dd;padding:6px 12px;background:#f4f5f8;font-weight:bold">첨부</td><td style="border:1px solid #d5d7dd;padding:6px 12px">${attachNames.map(esc).join("<br>")}</td></tr>`
      : "",
    `</table>`,
    links.length
      ? [
          `<p style="margin-top:14px"><b>동봉 서류 다운로드</b> — 용량 관계로 아래 링크에서 받아주세요(7일간 유효):</p>`,
          `<ul style="margin:6px 0 12px">`,
          ...links.map((l) => `<li><a href="${l.url}">${esc(l.name)}</a> <span style="color:#888">(${l.sizeMB}MB)</span></li>`),
          `</ul>`,
        ].join("")
      : "",
    `<p>감사합니다.<br>${esc(COMPANY_KO)} ${esc(senderLabel)} 드림</p>`,
    // 메일 서명(등록돼 있을 때만) — 본문 data URL 이미지는 sendMail 이 cid 첨부로 바꿔 보낸다.
    signatureHtml ? `<div style="margin-top:18px">${signatureHtml}</div>` : "",
    `</div>`,
  ].join("");
}

/**
 * 공문 발송 처리 — ① 대장 선점(pending|failed→generating) ② PDF/HWPX 생성·S3 보관
 * ③ 수신처 메일 발송(To=수신, Cc=참조) ④ sent/failed 확정.
 * 반환: 발송 결과(중복 실행이면 skipped).
 */
export async function processLetterSend(docId: string): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const claimed = await claimLetterSend(docId);
  if (!claimed) return { ok: true, skipped: true };
  try {
    const doc = await getDoc(docId);
    if (!doc) throw new Error("문서를 찾을 수 없습니다.");
    if (doc.status !== "approved") throw new Error("승인 완료 문서만 발송할 수 있습니다.");
    if (!doc.drafterUserId) throw new Error("기안자 계정을 확인할 수 없습니다.");
    const values = doc.fieldValues as unknown as LetterFieldValues;

    const artifacts = await generateLetterArtifacts(docId, { persist: true });

    // 발송 대상(To) = 참조자(주소록 담당자) 메일 — 수신처(recipients)는 업체/기관 표기용(사용자 확정).
    // 구버전/백필 문서(수신처에 메일이 있는 구조)는 폴백으로 수신처 메일을 To 에 합류.
    const toAll = [...toAddresses(values.cc_refs ?? []), ...toAddresses(values.recipients ?? [])];
    const seen = new Set<string>();
    const to = toAll.filter((a) => (seen.has(a.address.toLowerCase()) ? false : (seen.add(a.address.toLowerCase()), true)));
    if (!to.length) throw new Error("참조자에 유효한 메일주소가 없습니다. 참조자를 보완 후 재발송하세요.");

    // 내부 참조자(Cc) — 전자결재 참조/열람자로 지정한 자사 직원. 별도 메뉴 없이 결재선 패널의
    // 참조자 기능을 그대로 쓴다(사용자 확정). To 와 겹치면 제외한다.
    const watcherIds = doc.watchers.map((w) => w.userId).filter(Boolean);
    const ccAll = await internalCcAddresses(watcherIds, values.internal_cc_target === "company" ? "company" : "personal");
    const cc = ccAll.filter((a) => (seen.has(a.address.toLowerCase()) ? false : (seen.add(a.address.toLowerCase()), true)));

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

    // 동봉 서류 — 공문 포함 총량이 메일 한도(7MB) 이내면 순서대로 직접 첨부하고,
    // 초과하면 동봉 서류 전체를 다운로드 링크(presigned 7일)로 전환한다(총 200MB 허용 — 사용자 확정).
    const docsTotal = attachments.reduce((a, f) => a + f.content.length, 0);
    const files = values.file_attachments ?? [];
    const filesTotal = files.reduce((a, f) => a + (f.size || 0), 0);
    const links: DownloadLink[] = [];
    if (files.length && docsTotal + filesTotal <= ATTACH_LIMIT_BYTES) {
      for (const f of files) {
        const bytes = await readStorageObject(f.key).catch(() => null);
        if (bytes) attachments.push({ filename: f.name, contentType: "application/octet-stream", content: Buffer.from(bytes) });
        else console.warn(`[letter] 동봉 첨부 로드 실패(제외): ${f.key}`);
      }
    } else if (files.length) {
      for (const f of files) {
        const link = await makeDownloadLink(f.key, f.name, f.size || 0);
        if (link) links.push(link);
        else console.warn(`[letter] 다운로드 링크 생성 실패(제외): ${f.key}`);
      }
      if (links.length < files.length) {
        throw new Error("동봉 서류 다운로드 링크 생성에 실패했습니다. 재발송하거나 파일을 재업로드하세요.");
      }
    }
    // 공문 자체(PDF+HWPX)가 한도를 넘으면 HWPX 제외
    let total = attachments.reduce((a, f) => a + f.content.length, 0);
    if (total > ATTACH_LIMIT_BYTES) {
      const hwpxIdx = attachments.findIndex((a) => a.filename.endsWith(".hwpx"));
      if (hwpxIdx >= 0) {
        attachments.splice(hwpxIdx, 1);
        total = attachments.reduce((a, f) => a + f.content.length, 0);
        console.warn(`[letter] 첨부 총량 초과 — HWPX 제외 발송: ${docId}`);
      }
    }
    if (total > ATTACH_LIMIT_BYTES) {
      throw new Error(`첨부 총량이 메일 한도(20MB)를 초과합니다(${(total / 1024 / 1024).toFixed(1)}MB).`);
    }

    // 발송자 표기 = "성명 직함"(기안 시점 스냅샷). 서명은 기안자의 기본 서명이 있을 때만.
    const senderLabel = [doc.drafterName ?? "", doc.drafterPosition ?? ""].filter(Boolean).join(" ").trim();
    const signatureHtml = await defaultSignatureHtml(doc.drafterUserId);

    const result = await sendMail({
      userId: doc.drafterUserId,
      to,
      cc,
      subject: `[${COMPANY_SHORT}] ${artifacts.letterNo} ${artifacts.title}`,
      bodyHtml: buildMailBody({
        letterNo: artifacts.letterNo,
        title: artifacts.title,
        senderLabel,
        attachNames: attachments.map((a) => a.filename),
        links,
        signatureHtml,
        hasEnclosures: files.length > 0,
      }),
      attachments,
      idempotencyKey: `letter-send:${docId}:${claimed.sendAttempts}`,
    });
    if (!result.ok) throw new Error(result.error ?? "메일 발송 실패");

    await finishLetterSend(docId, { ok: true, messageId: result.messageId ?? null });
    // 첨부된 착수계·준공계에 발송 사실을 역기록(계약 메뉴 이력에서 시행번호로 추적 가능)
    if (values.deliverable_ids?.length) {
      await markDeliverablesSent(docId, artifacts.letterNo).catch((e) =>
        console.warn("[letter] 착수계·준공계 상태 역기록 실패:", (e as Error).message)
      );
    }
    return { ok: true };
  } catch (err) {
    const message = (err as Error).message ?? "발송 실패";
    await finishLetterSend(docId, { ok: false, error: message }).catch(() => {});
    return { ok: false, error: message };
  }
}
