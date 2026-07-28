/**
 * 코넨사인 메일 — 서명 템플릿 CRUD(G2-9). 서식명 지정·복수 저장·기본 지정(네이버 메일 방식).
 * 기본 서명은 새 메일 작성 시 자동 삽입. 소유 mailbox 한정.
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { getMailboxByUser } from "@/lib/mail/mailbox";

export interface MailSignature {
  signatureId: string;
  name: string;
  bodyHtml: string;
  isDefault: boolean;
  /** 제목 접두어(사명 표시) — 예: "한국환경안전연구원" → 제목 앞에 "[한국환경안전연구원] ". */
  subjectPrefix: string | null;
  updatedAt: string;
}

function toSig(r: Record<string, unknown>): MailSignature {
  return {
    signatureId: String(r.signature_id),
    name: String(r.name),
    bodyHtml: String(r.body_html ?? ""),
    isDefault: Number(r.is_default ?? 0) === 1,
    subjectPrefix: r.subject_prefix != null && String(r.subject_prefix).trim() !== "" ? String(r.subject_prefix) : null,
    updatedAt: String(r.updated_at),
  };
}

export async function listSignatures(userId: string): Promise<MailSignature[]> {
  const mailbox = await getMailboxByUser(userId);
  if (!mailbox) return [];
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT * FROM mail_signatures WHERE mailbox_id = $1 ORDER BY is_default DESC, updated_at DESC`, [mailbox.mailboxId])
  );
  return rows.map(toSig);
}

/** upsert — isDefault=true 면 같은 메일함의 나머지 기본 해제. 반환 = signatureId. */
export async function saveSignature(
  userId: string,
  input: { signatureId?: string | null; name: string; bodyHtml: string; isDefault?: boolean; subjectPrefix?: string | null }
): Promise<string> {
  const mailbox = await getMailboxByUser(userId);
  if (!mailbox) throw new Error("메일함이 없습니다.");
  const name = input.name.trim();
  if (!name) throw new Error("서식명을 입력하세요.");
  const sigId = input.signatureId || "msig-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14);
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    if (input.isDefault) {
      await db.run(`UPDATE mail_signatures SET is_default = 0 WHERE mailbox_id = $1`, [mailbox.mailboxId]);
    }
    await db.run(
      `INSERT INTO mail_signatures (signature_id, mailbox_id, name, body_html, is_default, subject_prefix, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
       ON CONFLICT (signature_id) DO UPDATE SET name = EXCLUDED.name, body_html = EXCLUDED.body_html,
         is_default = EXCLUDED.is_default, subject_prefix = EXCLUDED.subject_prefix, updated_at = EXCLUDED.updated_at`,
      [sigId, mailbox.mailboxId, name, input.bodyHtml, input.isDefault ? 1 : 0, input.subjectPrefix?.trim() || null, now]
    );
  });
  return sigId;
}

export async function deleteSignature(userId: string, signatureId: string): Promise<void> {
  const mailbox = await getMailboxByUser(userId);
  if (!mailbox) return;
  await withDbWrite(async (db) => {
    await db.run(`DELETE FROM mail_signatures WHERE signature_id = $1 AND mailbox_id = $2`, [signatureId, mailbox.mailboxId]);
  });
}
