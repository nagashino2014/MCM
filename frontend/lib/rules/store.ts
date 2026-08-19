// 사규 규정집(rule_documents / rule_versions, 193) DB 접근 — RB-P0.
// 판(版)은 발행 후 불변이다: 개정은 draft 새 행으로 만들고 발행 시 직전 published 를 superseded 로 내린다.
// ⚠ 발행된 판의 body 는 수정 경로를 두지 않는다(동의·신고 산출물의 근거라 사후 변조가 있어선 안 된다).

import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import type {
  RuleBody,
  RuleDocumentRow,
  RuleVersionDetail,
  RuleVersionRow,
  RuleVersionStatus,
} from "./types";

function newId(prefix: string): string {
  return prefix + crypto.randomUUID().replace(/-/g, "").slice(0, 14);
}

const nowIso = (): string => new Date().toISOString();
const sn = (v: unknown): string | null => (v == null ? null : String(v));

function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

const EMPTY_BODY: RuleBody = { chapters: [], addendum: [], appendices: [], history: [] };

// ── 규정 ──

function mapDoc(r: Record<string, unknown>): RuleDocumentRow {
  return {
    docId: String(r.doc_id ?? ""),
    title: String(r.title ?? ""),
    category: sn(r.category),
    sortOrder: Number(r.sort_order ?? 100),
    isActive: Number(r.is_active ?? 1) === 1,
  };
}

export async function listRuleDocuments(includeInactive = false): Promise<RuleDocumentRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT doc_id, title, category, sort_order, is_active
         FROM rule_documents
        ${includeInactive ? "" : "WHERE is_active = 1"}
        ORDER BY sort_order, title`,
    ),
  );
  return rows.map(mapDoc);
}

// ── 판 ──

function mapVersion(r: Record<string, unknown>): RuleVersionRow {
  return {
    versionId: String(r.version_id ?? ""),
    docId: String(r.doc_id ?? ""),
    version: Number(r.version ?? 1),
    status: (["draft", "in_consent", "published", "superseded"].includes(String(r.status))
      ? String(r.status)
      : "draft") as RuleVersionStatus,
    effectiveDate: sn(r.effective_date),
    revisionNote: sn(r.revision_note),
    sourceFileKey: sn(r.source_file_key),
    pdfFileKey: sn(r.pdf_file_key),
    publishedAt: sn(r.published_at),
    publishedBy: sn(r.published_by),
    createdAt: String(r.created_at ?? ""),
  };
}

const VERSION_COLS = `version_id, doc_id, version, status, effective_date, revision_note,
                      source_file_key, pdf_file_key, published_at, published_by, created_at`;

export async function listRuleVersions(docId: string): Promise<RuleVersionRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT ${VERSION_COLS} FROM rule_versions WHERE doc_id = $1 ORDER BY version DESC`, [docId]),
  );
  return rows.map(mapVersion);
}

export async function getRuleVersion(versionId: string): Promise<RuleVersionDetail | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT ${VERSION_COLS}, body FROM rule_versions WHERE version_id = $1`, [versionId]),
  );
  if (!rows.length) return null;
  return { ...mapVersion(rows[0]), body: parseJson<RuleBody>(rows[0].body, EMPTY_BODY) };
}

/** 현재 시행 중인 판 — 열람 화면의 기본값. */
export async function getPublishedVersion(docId: string): Promise<RuleVersionDetail | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT ${VERSION_COLS}, body FROM rule_versions
        WHERE doc_id = $1 AND status = 'published'
        ORDER BY version DESC LIMIT 1`,
      [docId],
    ),
  );
  if (!rows.length) return null;
  return { ...mapVersion(rows[0]), body: parseJson<RuleBody>(rows[0].body, EMPTY_BODY) };
}

export async function getImportWarnings(versionId: string): Promise<string[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT import_warnings FROM rule_versions WHERE version_id = $1`, [versionId]),
  );
  return rows.length ? parseJson<string[]>(rows[0].import_warnings, []) : [];
}

/** 임포트·개정으로 새 draft 판을 만든다. version 은 해당 규정의 최대값 + 1. */
export async function createDraftVersion(params: {
  docId: string;
  body: RuleBody;
  warnings?: string[];
  effectiveDate?: string | null;
  revisionNote?: string | null;
  sourceFileKey?: string | null;
  actorUserId: string | null;
}): Promise<RuleVersionRow> {
  return withDbWrite(async (db) => {
    const maxRows = rowsToObjects(
      await db.exec(`SELECT COALESCE(MAX(version), 0) AS v FROM rule_versions WHERE doc_id = $1`, [params.docId]),
    );
    const version = Number(maxRows[0]?.v ?? 0) + 1;
    const versionId = newId("rv-");
    const now = nowIso();
    await db.run(
      `INSERT INTO rule_versions
         (version_id, doc_id, version, status, effective_date, body, revision_note,
          source_file_key, import_warnings, created_at, created_by)
       VALUES ($1, $2, $3, 'draft', $4, $5::jsonb, $6, $7, $8::jsonb, $9, $10)`,
      [
        versionId,
        params.docId,
        version,
        params.effectiveDate ?? null,
        JSON.stringify(params.body),
        params.revisionNote ?? null,
        params.sourceFileKey ?? null,
        JSON.stringify(params.warnings ?? []),
        now,
        params.actorUserId,
      ],
    );
    return {
      versionId,
      docId: params.docId,
      version,
      status: "draft" as const,
      effectiveDate: params.effectiveDate ?? null,
      revisionNote: params.revisionNote ?? null,
      sourceFileKey: params.sourceFileKey ?? null,
      pdfFileKey: null,
      publishedAt: null,
      publishedBy: null,
      createdAt: now,
    };
  });
}

/** 검수 저장 — draft 에만 허용한다. */
export async function updateDraftVersion(
  versionId: string,
  patch: { body?: RuleBody; effectiveDate?: string | null; revisionNote?: string | null; warnings?: string[] },
): Promise<void> {
  await withDbWrite(async (db) => {
    const rows = rowsToObjects(await db.exec(`SELECT status FROM rule_versions WHERE version_id = $1`, [versionId]));
    if (!rows.length) throw new Error("판을 찾을 수 없습니다.");
    if (String(rows[0].status) !== "draft") throw new Error("발행·동의 진행 중인 판은 수정할 수 없습니다.");

    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (patch.body !== undefined) {
      sets.push(`body = $${i}::jsonb`);
      vals.push(JSON.stringify(patch.body));
      i += 1;
    }
    if (patch.effectiveDate !== undefined) {
      sets.push(`effective_date = $${i}`);
      vals.push(patch.effectiveDate);
      i += 1;
    }
    if (patch.revisionNote !== undefined) {
      sets.push(`revision_note = $${i}`);
      vals.push(patch.revisionNote);
      i += 1;
    }
    if (patch.warnings !== undefined) {
      sets.push(`import_warnings = $${i}::jsonb`);
      vals.push(JSON.stringify(patch.warnings));
      i += 1;
    }
    if (!sets.length) return;
    vals.push(versionId);
    await db.run(`UPDATE rule_versions SET ${sets.join(", ")} WHERE version_id = $${i}`, vals);
  });
}

/** 발행 — 같은 규정의 기존 published 를 superseded 로 내리고 이 판을 시행판으로 세운다. */
export async function publishVersion(params: {
  versionId: string;
  effectiveDate: string;
  actorUserId: string | null;
}): Promise<void> {
  await withDbWrite(async (db) => {
    const rows = rowsToObjects(
      await db.exec(`SELECT doc_id, status FROM rule_versions WHERE version_id = $1`, [params.versionId]),
    );
    if (!rows.length) throw new Error("판을 찾을 수 없습니다.");
    const status = String(rows[0].status);
    if (status === "published") throw new Error("이미 시행 중인 판입니다.");
    if (status === "superseded") throw new Error("지난 판은 다시 발행할 수 없습니다.");
    const docId = String(rows[0].doc_id);

    await db.run(
      `UPDATE rule_versions SET status = 'superseded' WHERE doc_id = $1 AND status = 'published'`,
      [docId],
    );
    await db.run(
      `UPDATE rule_versions
          SET status = 'published', effective_date = $1, published_at = $2, published_by = $3
        WHERE version_id = $4`,
      [params.effectiveDate, nowIso(), params.actorUserId, params.versionId],
    );
  });
}

/** draft 폐기 — 발행된 판은 지우지 않는다. */
export async function deleteDraftVersion(versionId: string): Promise<void> {
  await withDbWrite(async (db) => {
    const rows = rowsToObjects(await db.exec(`SELECT status FROM rule_versions WHERE version_id = $1`, [versionId]));
    if (!rows.length) return;
    if (String(rows[0].status) !== "draft") throw new Error("발행된 판은 삭제할 수 없습니다.");
    await db.run(`DELETE FROM rule_versions WHERE version_id = $1`, [versionId]);
  });
}

/** 열람 확인 — 같은 사람이 다시 봐도 최초 시각을 유지한다. */
export async function markVersionRead(versionId: string, userId: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO rule_reads (version_id, user_id, read_at) VALUES ($1, $2, $3)
       ON CONFLICT (version_id, user_id) DO NOTHING`,
      [versionId, userId, nowIso()],
    );
  });
}
