/**
 * 홍보·채용공고 DB 액세스 계층 — recruit_templates / recruit_postings (마이그 212).
 */
import { getDb, rowsToObjects } from "@/lib/db";
import { sanitizeTree, sanitizeTheme } from "./sanitize";
import type { DocNode, DocTheme, RecruitPostingRow, RecruitTemplateRow } from "./types";

const nowIso = () => new Date().toISOString();

function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw === "object") return raw as T;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
}

function toTemplateRow(r: Record<string, unknown>): RecruitTemplateRow {
  return {
    templateId: String(r.template_id),
    name: String(r.name ?? ""),
    description: r.description != null ? String(r.description) : null,
    designTree: parseJson<DocNode>(r.design_tree, { id: "root", tag: "div" }),
    theme: parseJson<DocTheme>(r.theme, {}),
    docWidth: Number(r.doc_width ?? 900),
    isActive: Number(r.is_active ?? 1) === 1,
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  };
}

function toPostingRow(r: Record<string, unknown>): RecruitPostingRow {
  return {
    postingId: String(r.posting_id),
    templateId: String(r.template_id),
    templateName: r.template_name != null ? String(r.template_name) : undefined,
    title: String(r.title ?? ""),
    contentTree: parseJson<DocNode>(r.content_tree, { id: "root", tag: "div" }),
    theme: parseJson<DocTheme>(r.theme, {}),
    docWidth: r.doc_width != null ? Number(r.doc_width) : undefined,
    status: r.status === "final" ? "final" : "draft",
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
    updatedBy: r.updated_by != null ? String(r.updated_by) : null,
  };
}

// ── 템플릿 ──────────────────────────────────────────

export async function listTemplates(includeInactive = false): Promise<RecruitTemplateRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT template_id, name, description, design_tree, theme, doc_width, is_active, created_at, updated_at
         FROM recruit_templates
        ${includeInactive ? "" : "WHERE is_active = 1"}
        ORDER BY created_at DESC`
    )
  );
  return rows.map(toTemplateRow);
}

export async function getTemplate(templateId: string): Promise<RecruitTemplateRow | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT template_id, name, description, design_tree, theme, doc_width, is_active, created_at, updated_at
         FROM recruit_templates WHERE template_id = $1 LIMIT 1`,
      [templateId]
    )
  );
  return rows[0] ? toTemplateRow(rows[0]) : null;
}

export async function createTemplate(input: {
  name: string;
  description?: string;
  tree: unknown;
  theme: unknown;
  docWidth?: number;
  sourceFileKey?: string | null;
  createdBy: string;
}): Promise<RecruitTemplateRow> {
  const { tree } = sanitizeTree(input.tree); // 클라 파싱 결과를 신뢰하지 않고 서버에서 재정제
  const theme = sanitizeTheme(input.theme);
  const name = input.name.trim();
  if (!name) throw Object.assign(new Error("템플릿 이름을 입력하세요."), { status: 400 });
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = nowIso();
  await db.exec(
    `INSERT INTO recruit_templates
       (template_id, name, description, design_tree, theme, source_file_key, doc_width, is_active, created_at, created_by, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, 1, $8, $9, $8)`,
    [
      id, name, input.description?.trim() || null,
      JSON.stringify(tree), JSON.stringify(theme),
      input.sourceFileKey ?? null,
      Math.min(Math.max(Number(input.docWidth) || 900, 320), 2400),
      now, input.createdBy,
    ]
  );
  return (await getTemplate(id))!;
}

/**
 * 템플릿 갱신 — 주어진 필드만 바꾼다. 이름·설명 변경과
 * "기존 템플릿 덮어쓰기"(에디터 콘텐츠로 design_tree/theme 교체) 공용.
 */
export async function updateTemplate(input: {
  templateId: string;
  name?: string;
  description?: string;
  tree?: unknown;
  theme?: unknown;
  docWidth?: number;
}): Promise<RecruitTemplateRow> {
  const existing = await getTemplate(input.templateId);
  if (!existing) throw Object.assign(new Error("템플릿을 찾을 수 없습니다."), { status: 404 });
  const name = input.name != null ? input.name.trim() : existing.name;
  if (!name) throw Object.assign(new Error("템플릿 이름을 입력하세요."), { status: 400 });
  const tree = input.tree != null ? sanitizeTree(input.tree).tree : existing.designTree;
  const theme = input.theme != null ? sanitizeTheme(input.theme) : existing.theme;
  const description = input.description != null ? input.description.trim() || null : existing.description;
  const docWidth = input.docWidth != null
    ? Math.min(Math.max(Number(input.docWidth) || 900, 320), 2400)
    : existing.docWidth;
  const db = await getDb();
  await db.exec(
    `UPDATE recruit_templates
        SET name = $2, description = $3, design_tree = $4::jsonb, theme = $5::jsonb, doc_width = $6, updated_at = $7
      WHERE template_id = $1`,
    [input.templateId, name, description, JSON.stringify(tree), JSON.stringify(theme), docWidth, nowIso()]
  );
  return (await getTemplate(input.templateId))!;
}

export async function setTemplateActive(templateId: string, isActive: boolean): Promise<void> {
  const db = await getDb();
  await db.exec(
    `UPDATE recruit_templates SET is_active = $2, updated_at = $3 WHERE template_id = $1`,
    [templateId, isActive ? 1 : 0, nowIso()]
  );
}

// ── 공고 ────────────────────────────────────────────

export async function listPostings(): Promise<RecruitPostingRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT p.posting_id, p.template_id, t.name AS template_name, t.doc_width,
              p.title, p.status, p.created_at, p.updated_at, p.updated_by,
              '{}'::jsonb AS content_tree, p.theme
         FROM recruit_postings p
         JOIN recruit_templates t ON t.template_id = p.template_id
        WHERE p.deleted_at IS NULL
        ORDER BY p.updated_at DESC`
    )
  );
  return rows.map(toPostingRow);
}

export async function getPosting(postingId: string): Promise<RecruitPostingRow | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT p.posting_id, p.template_id, t.name AS template_name, t.doc_width,
              p.title, p.content_tree, p.theme, p.status, p.created_at, p.updated_at, p.updated_by
         FROM recruit_postings p
         JOIN recruit_templates t ON t.template_id = p.template_id
        WHERE p.posting_id = $1 AND p.deleted_at IS NULL LIMIT 1`,
      [postingId]
    )
  );
  return rows[0] ? toPostingRow(rows[0]) : null;
}

/** 템플릿에서 새 공고 생성 — design_tree 사본이 content_tree 의 출발점. */
export async function createPosting(input: {
  templateId: string;
  title?: string;
  createdBy: string;
}): Promise<RecruitPostingRow> {
  const template = await getTemplate(input.templateId);
  if (!template || !template.isActive) {
    throw Object.assign(new Error("템플릿을 찾을 수 없습니다."), { status: 404 });
  }
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = nowIso();
  const title = input.title?.trim() || `${template.name} — 새 공고`;
  await db.exec(
    `INSERT INTO recruit_postings
       (posting_id, template_id, title, content_tree, theme, status, created_at, created_by, updated_at, updated_by)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, 'draft', $6, $7, $6, $7)`,
    [id, template.templateId, title, JSON.stringify(template.designTree), JSON.stringify(template.theme), now, input.createdBy]
  );
  return (await getPosting(id))!;
}

/** 공고 저장(자동저장 포함). snapshot=true 면 버전 스냅샷도 남긴다. */
export async function savePosting(input: {
  postingId: string;
  title?: string;
  contentTree?: unknown;
  theme?: unknown;
  status?: "draft" | "final";
  snapshot?: boolean;
  updatedBy: string;
}): Promise<RecruitPostingRow> {
  const existing = await getPosting(input.postingId);
  if (!existing) throw Object.assign(new Error("공고를 찾을 수 없습니다."), { status: 404 });

  const tree = input.contentTree != null ? sanitizeTree(input.contentTree).tree : existing.contentTree;
  const theme = input.theme != null ? sanitizeTheme(input.theme) : existing.theme;
  const title = input.title?.trim() || existing.title;
  const status = input.status === "final" ? "final" : input.status === "draft" ? "draft" : existing.status;

  const db = await getDb();
  const now = nowIso();
  await db.exec(
    `UPDATE recruit_postings
        SET title = $2, content_tree = $3::jsonb, theme = $4::jsonb, status = $5, updated_at = $6, updated_by = $7
      WHERE posting_id = $1 AND deleted_at IS NULL`,
    [input.postingId, title, JSON.stringify(tree), JSON.stringify(theme), status, now, input.updatedBy]
  );

  if (input.snapshot) {
    await db.exec(
      `INSERT INTO recruit_posting_versions (posting_id, version, content_tree, theme, saved_at, saved_by)
       SELECT $1, COALESCE(MAX(version), 0) + 1, $2::jsonb, $3::jsonb, $4, $5
         FROM recruit_posting_versions WHERE posting_id = $1`,
      [input.postingId, JSON.stringify(tree), JSON.stringify(theme), now, input.updatedBy]
    );
  }
  return (await getPosting(input.postingId))!;
}

export async function deletePosting(postingId: string, deletedBy: string): Promise<void> {
  const db = await getDb();
  await db.exec(
    `UPDATE recruit_postings SET deleted_at = $2, updated_by = $3 WHERE posting_id = $1 AND deleted_at IS NULL`,
    [postingId, nowIso(), deletedBy]
  );
}
