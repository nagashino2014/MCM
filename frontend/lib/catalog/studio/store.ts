import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { getDocumentTheme } from "@/lib/catalog/projects";
import { isColorConcept, isCoverDesign, sanitizeDocumentTheme, type DocumentTheme } from "@/lib/catalog/document-theme";
import { isMeaningfulPage, sanitizeStudioPages, type StudioDoc, type StudioPageState } from "./doc";
import { sanitizePageEdits } from "./edits";

/*
 * 스튜디오 저장(서버) — 309 catalog_pages(쪽 상태)·catalog_versions(버전 스냅샷)·catalog_documents(설정·판 번호).
 *   catalog_pages.page_id = "{doc_id}:{쪽 키}", order_no = 사용자 순서 + 1(0 = 쪽 계획 순서), hidden, tree = 편집층(PageEdits)
 *   의미 없는 쪽(순서·숨김·편집 모두 없음)은 행을 두지 않는다.
 * 동시 편집: 저장 요청의 rev(불러온 때의 updated_at)가 지금 값과 다르면 거절한다(StudioConflictError).
 */

export class StudioConflictError extends Error {
  status = 409;
  constructor() {
    super("다른 곳에서 이 회사소개서를 먼저 고쳤습니다. 새로 불러온 뒤 다시 고쳐 주세요.");
  }
}

export interface StudioVersionRow {
  version: number;
  note: string;
  savedAt: string;
  savedByName: string;
  pages: number;
}

const s = (v: unknown): string => (v == null ? "" : String(v));
const parse = (v: unknown): unknown => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

export async function loadStudioDoc(docId: string): Promise<StudioDoc | null> {
  const db = await getDb();
  const doc = rowsToObjects(await db.exec("SELECT doc_id, title, current_version, updated_at FROM catalog_documents WHERE doc_id = $1", [docId]))[0];
  if (!doc) return null;
  const rows = rowsToObjects(await db.exec("SELECT page_id, order_no, hidden, tree FROM catalog_pages WHERE doc_id = $1 ORDER BY order_no, page_id", [docId]));
  const prefix = `${docId}:`;
  const pages: StudioPageState[] = sanitizeStudioPages(
    rows
      .filter((r) => s(r.page_id).startsWith(prefix))
      .map((r) => ({
        key: s(r.page_id).slice(prefix.length),
        order: Number(r.order_no) > 0 ? Number(r.order_no) - 1 : null,
        hidden: Number(r.hidden) === 1,
        edits: parse(r.tree),
      }))
  );
  return {
    docId,
    title: s(doc.title),
    theme: await getDocumentTheme(docId),
    pages,
    rev: s(doc.updated_at),
    version: Number(doc.current_version ?? 0),
  };
}

export interface StudioSaveInput {
  rev: string;
  pages: unknown;
  /** 쪽 키 → 쪽 유형·섹션(표시용 메타) */
  meta?: Record<string, { type?: string; section?: string }>;
  theme?: Partial<DocumentTheme>;
}

/** 저장 — 쪽 상태 전체를 바꾼다(의미 없는 쪽 행은 지움). 돌려주는 값 = 새 rev. */
export async function saveStudioDoc(docId: string, input: StudioSaveInput, actorUserId: string | null): Promise<{ rev: string; theme: DocumentTheme }> {
  const pages = sanitizeStudioPages(input.pages);
  const meta = input.meta ?? {};
  const now = new Date().toISOString();
  return withDbWrite(async (txn) => {
    const cur = rowsToObjects(await txn.exec("SELECT updated_at, theme FROM catalog_documents WHERE doc_id = $1 FOR UPDATE", [docId]))[0];
    if (!cur) throw new Error("회사소개서 문서를 찾지 못했습니다.");
    if (input.rev && s(cur.updated_at) !== input.rev) throw new StudioConflictError();
    // 설정(보낸 항목만, 올바른 값만)
    const before = sanitizeDocumentTheme(parse(cur.theme));
    const patch: Partial<DocumentTheme> = {};
    const t = input.theme ?? {};
    if (isCoverDesign(t.cover)) patch.cover = t.cover;
    if (t.coverPhoto === "photo" || t.coverPhoto === "none") patch.coverPhoto = t.coverPhoto;
    if (typeof t.fontSet === "string" && /^[a-z0-9-]{1,40}$/.test(t.fontSet)) patch.fontSet = t.fontSet;
    if (isColorConcept(t.concept)) patch.concept = t.concept;
    const theme = sanitizeDocumentTheme({ ...before, ...patch });
    const keep = pages.filter(isMeaningfulPage);
    const keepIds = keep.map((p) => `${docId}:${p.key}`);
    await txn.run(`DELETE FROM catalog_pages WHERE doc_id = $1 AND NOT (page_id = ANY($2))`, [docId, keepIds]);
    for (const p of keep) {
      const m = meta[p.key] ?? {};
      const type = typeof m.type === "string" && /^[A-Z0-9]{1,6}$/.test(m.type) ? m.type : "PAGE";
      const section = typeof m.section === "string" && m.section.length <= 10 ? m.section : null;
      await txn.run(
        `INSERT INTO catalog_pages (page_id, doc_id, order_no, page_type, section_key, tree, hidden, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
         ON CONFLICT (page_id) DO UPDATE SET order_no = EXCLUDED.order_no, page_type = EXCLUDED.page_type, section_key = EXCLUDED.section_key,
           tree = EXCLUDED.tree, hidden = EXCLUDED.hidden, updated_at = EXCLUDED.updated_at`,
        [`${docId}:${p.key}`, docId, p.order == null ? 0 : p.order + 1, type, section, JSON.stringify(sanitizePageEdits(p.edits)), p.hidden ? 1 : 0, now]
      );
    }
    await txn.run(`UPDATE catalog_documents SET theme = COALESCE(theme, '{}'::jsonb) || $2::jsonb, updated_at = $3, updated_by = $4 WHERE doc_id = $1`, [
      docId,
      JSON.stringify(theme),
      now,
      actorUserId,
    ]);
    return { rev: now, theme };
  });
}

/** 버전 저장 — 지금 저장된 상태(설정·쪽 상태)를 스냅샷으로 남기고 판 번호를 올린다 */
export async function snapshotStudioDoc(docId: string, note: string, actorUserId: string | null): Promise<{ version: number; rev: string }> {
  const doc = await loadStudioDoc(docId);
  if (!doc) throw new Error("회사소개서 문서를 찾지 못했습니다.");
  const now = new Date().toISOString();
  return withDbWrite(async (txn) => {
    const cur = rowsToObjects(await txn.exec("SELECT current_version FROM catalog_documents WHERE doc_id = $1 FOR UPDATE", [docId]))[0];
    const version = Number(cur?.current_version ?? 0) + 1;
    await txn.run(`INSERT INTO catalog_versions (doc_id, version, snapshot, note, saved_at, saved_by) VALUES ($1, $2, $3::jsonb, $4, $5, $6)`, [
      docId,
      version,
      JSON.stringify({ theme: doc.theme, pages: doc.pages }),
      note.slice(0, 200) || null,
      now,
      actorUserId,
    ]);
    await txn.run(`UPDATE catalog_documents SET current_version = $2, updated_at = $3, updated_by = $4 WHERE doc_id = $1`, [docId, version, now, actorUserId]);
    return { version, rev: now };
  });
}

export async function listStudioVersions(docId: string, limit = 50): Promise<StudioVersionRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT v.version, v.note, v.saved_at, COALESCE(u.name, '') AS saved_by_name,
              (SELECT count(*) FROM jsonb_array_elements(COALESCE(v.snapshot->'pages', '[]'::jsonb)) p
                WHERE COALESCE(p->>'hidden', 'false') = 'true' OR COALESCE(p->'edits', '{}'::jsonb) - 'v' <> '{}'::jsonb) AS pages
         FROM catalog_versions v LEFT JOIN users u ON u.user_id = v.saved_by
        WHERE v.doc_id = $1 ORDER BY v.version DESC LIMIT $2`,
      [docId, limit]
    )
  );
  return rows.map((r) => ({ version: Number(r.version), note: s(r.note), savedAt: s(r.saved_at), savedByName: s(r.saved_by_name), pages: Number(r.pages ?? 0) }));
}

export async function getStudioVersion(docId: string, version: number): Promise<{ theme: DocumentTheme; pages: StudioPageState[] } | null> {
  const db = await getDb();
  const r = rowsToObjects(await db.exec("SELECT snapshot FROM catalog_versions WHERE doc_id = $1 AND version = $2", [docId, version]))[0];
  if (!r) return null;
  const snap = (parse(r.snapshot) ?? {}) as { theme?: unknown; pages?: unknown };
  return { theme: sanitizeDocumentTheme(snap.theme), pages: sanitizeStudioPages(snap.pages) };
}

export interface StudioImageAsset {
  key: string;
  label: string;
  kind: string;
  createdAt: string;
}

/** 스튜디오 사진 고르기 목록 — 키트 기본 사진(사옥) + 회사소개서 자산(사진·로고) */
export const KIT_IMAGES: StudioImageAsset[] = [
  { key: "k/assets/hq-cover-tall.webp", label: "사옥 사진(세로)", kind: "kit", createdAt: "" },
  { key: "k/assets/hq-cover-wide.webp", label: "사옥 사진(가로)", kind: "kit", createdAt: "" },
  { key: "k/assets/hq-building-3.webp", label: "사옥 사진(서울 본사)", kind: "kit", createdAt: "" },
  { key: "k/assets/kesi-ko-horizontal-gradient.png", label: "국문 로고(그라데이션)", kind: "kit", createdAt: "" },
  { key: "k/assets/kesi-signature-ko.png", label: "가로형 시그니처", kind: "kit", createdAt: "" },
];

export async function listStudioImageAssets(limit = 200): Promise<StudioImageAsset[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT asset_id, kind, COALESCE(file_name, '') AS file_name, created_at FROM catalog_assets
        WHERE kind IN ('photo', 'logo') AND COALESCE(content_type, '') LIKE 'image/%' ORDER BY created_at DESC LIMIT $1`,
      [limit]
    )
  );
  return [
    ...KIT_IMAGES,
    ...rows.map((r) => ({ key: `a/${s(r.asset_id)}`, label: s(r.file_name) || s(r.asset_id), kind: s(r.kind), createdAt: s(r.created_at) })),
  ];
}

/** 인포그래픽 유형 선택 기록(309 catalog_infographic_prefs) — 다음 생성·추천에서 같은 자리는 같은 유형을 앞에 둔다 */
export async function saveInfographicPref(slotKey: string, infoType: string, variant: string | null, actorUserId: string | null): Promise<void> {
  if (!/^[a-z0-9.-]{1,60}$/.test(slotKey) || !/^[A-Za-z]{1,20}$/.test(infoType)) return;
  await withDbWrite(async (txn) => {
    await txn.run(
      `INSERT INTO catalog_infographic_prefs (slot_key, info_type, variant, updated_at, updated_by) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (slot_key) DO UPDATE SET info_type = EXCLUDED.info_type, variant = EXCLUDED.variant, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
      [slotKey, infoType, variant, new Date().toISOString(), actorUserId]
    );
  });
}

export async function listInfographicPrefs(): Promise<Record<string, { type: string; variant: string | null }>> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec("SELECT slot_key, info_type, variant FROM catalog_infographic_prefs"));
  return Object.fromEntries(rows.map((r) => [s(r.slot_key), { type: s(r.info_type), variant: r.variant == null ? null : s(r.variant) }]));
}
