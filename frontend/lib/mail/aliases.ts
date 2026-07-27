/**
 * 코넨사인 메일 — 별칭/배포리스트(mail_aliases) 관리(G5, 메일 P4).
 * 스키마·inbound fan-out(inbound.ts resolveTargets)은 095 에서 기구현 — 여기는 관리 CRUD 만 담당한다.
 * kind: 'alias'(대표 주소 → 소수 수신) / 'list'(배포리스트 → 다수 수신). 라우팅 동작은 동일(구분은 표시용).
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { MAIL_DOMAIN, normalizeLocalPart } from "@/lib/mail/mailbox";

export interface MailAliasTarget {
  mailboxId: string;
  address: string;
  displayName: string;
}

export interface MailAlias {
  aliasId: string;
  aliasLocal: string;
  address: string;
  kind: "alias" | "list";
  active: boolean;
  targets: MailAliasTarget[];
  createdAt: string;
}

function newId(): string {
  return "mal-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14);
}

function parseTargetIds(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw || "[]");
      return Array.isArray(v) ? v.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** 별칭 전체 목록 — 수신자 mailbox 정보(주소·이름)를 조인해 반환한다. */
export async function listAliases(): Promise<MailAlias[]> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT * FROM mail_aliases ORDER BY alias_local`));
  const allIds = new Set<string>();
  for (const r of rows) for (const id of parseTargetIds(r.target_mailbox_ids)) allIds.add(id);

  const boxMap = new Map<string, MailAliasTarget>();
  if (allIds.size) {
    const boxes = rowsToObjects(
      await db.exec(`SELECT mailbox_id, address, display_name FROM mailboxes WHERE mailbox_id = ANY($1::text[])`, [[...allIds]])
    );
    for (const b of boxes) {
      boxMap.set(String(b.mailbox_id), {
        mailboxId: String(b.mailbox_id),
        address: String(b.address),
        displayName: b.display_name != null ? String(b.display_name) : String(b.address),
      });
    }
  }

  return rows.map((r) => ({
    aliasId: String(r.alias_id),
    aliasLocal: String(r.alias_local),
    address: `${r.alias_local}@${MAIL_DOMAIN}`,
    kind: String(r.kind) === "list" ? "list" : "alias",
    active: Number(r.active) === 1,
    targets: parseTargetIds(r.target_mailbox_ids)
      .map((id) => boxMap.get(id))
      .filter((t): t is MailAliasTarget => !!t),
    createdAt: String(r.created_at),
  }));
}

/** local 검증 — 개인 메일함(local_part)·기존 별칭과 충돌하면 에러 문자열을 돌려준다(정상 시 null). */
async function validateLocal(local: string, excludeAliasId?: string): Promise<string | null> {
  if (!local) return "별칭 아이디를 입력하세요(영문 소문자·숫자·._-).";
  const db = await getDb();
  const box = rowsToObjects(await db.exec(`SELECT 1 FROM mailboxes WHERE local_part = $1 LIMIT 1`, [local]));
  if (box.length) return `'${local}' 은 개인 메일함 주소로 이미 사용 중입니다.`;
  const dup = rowsToObjects(
    await db.exec(`SELECT alias_id FROM mail_aliases WHERE alias_local = $1 LIMIT 1`, [local])
  );
  if (dup.length && String(dup[0].alias_id) !== excludeAliasId) return `'${local}' 별칭이 이미 있습니다.`;
  return null;
}

export async function createAlias(params: { aliasLocal: string; kind: "alias" | "list"; targetMailboxIds: string[] }): Promise<{ aliasId: string }> {
  const local = normalizeLocalPart(params.aliasLocal);
  const invalid = await validateLocal(local);
  if (invalid) throw new Error(invalid);
  const aliasId = newId();
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO mail_aliases (alias_id, alias_local, kind, target_mailbox_ids, active, created_at)
       VALUES ($1, $2, $3, $4::jsonb, 1, $5)`,
      [aliasId, local, params.kind === "list" ? "list" : "alias", JSON.stringify(params.targetMailboxIds ?? []), new Date().toISOString()]
    );
  });
  return { aliasId };
}

export async function updateAlias(
  aliasId: string,
  patch: { aliasLocal?: string; kind?: "alias" | "list"; targetMailboxIds?: string[]; active?: boolean }
): Promise<void> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT * FROM mail_aliases WHERE alias_id = $1`, [aliasId]));
  if (!rows.length) throw new Error("별칭을 찾을 수 없습니다.");
  const cur = rows[0];

  let local = String(cur.alias_local);
  if (patch.aliasLocal != null) {
    local = normalizeLocalPart(patch.aliasLocal);
    const invalid = await validateLocal(local, aliasId);
    if (invalid) throw new Error(invalid);
  }
  const kind = patch.kind != null ? (patch.kind === "list" ? "list" : "alias") : String(cur.kind);
  const targets = patch.targetMailboxIds != null ? patch.targetMailboxIds : parseTargetIds(cur.target_mailbox_ids);
  const active = patch.active != null ? (patch.active ? 1 : 0) : Number(cur.active);

  await withDbWrite(async (w) => {
    await w.run(
      `UPDATE mail_aliases SET alias_local = $2, kind = $3, target_mailbox_ids = $4::jsonb, active = $5 WHERE alias_id = $1`,
      [aliasId, local, kind, JSON.stringify(targets), active]
    );
  });
}

export async function deleteAlias(aliasId: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(`DELETE FROM mail_aliases WHERE alias_id = $1`, [aliasId]);
  });
}
