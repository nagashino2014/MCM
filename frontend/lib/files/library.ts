/**
 * 파일함(/files) — 그룹웨어 전반에 흩어진 업로드 파일의 통합 조회·열기·삭제.
 *
 * 소스 5종(1차): 전자결재 첨부(field_values.file_attachments jsonb) · 메신저(chat_attachments)
 *   · 사업장 시설 자료(facility_facility_documents) · 공지·게시판(board_attachments)
 *   · 업무추진 이슈(work_plan_issue_attachments).
 * 행 식별자(id)는 "{source}:{원본키}" — 열기·삭제가 이 id 하나로 동작한다.
 * 스토리지는 전 소스가 단일 버킷(MCM_STORAGE_BUCKET)이라 삭제·읽기는
 * contract-document-storage 의 공용 read/delete 를 재사용한다(로컬 폴백 포함).
 */

import { getDb, rowsToObjects } from "@/lib/db";
import { deleteContractDocument } from "@/lib/storage/contract-document-storage";

export type FileSource = "approval" | "chat" | "facility" | "board" | "issue";

export const SOURCE_LABEL: Record<FileSource, string> = {
  approval: "전자결재",
  chat: "메신저",
  facility: "사업장 자료",
  board: "공지·게시판",
  issue: "업무추진 이슈",
};

/** 형식 필터 그룹 — 확장자 화이트리스트. etc 는 "아래 어느 그룹에도 없음". */
export const FORMAT_GROUPS: Record<string, { label: string; exts: string[] }> = {
  pdf: { label: "PDF", exts: ["pdf"] },
  image: { label: "이미지", exts: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "heic"] },
  doc: { label: "문서", exts: ["doc", "docx", "hwp", "hwpx", "txt", "md", "rtf"] },
  sheet: { label: "스프레드시트", exts: ["xls", "xlsx", "csv"] },
  ppt: { label: "프레젠테이션", exts: ["ppt", "pptx"] },
  zip: { label: "압축", exts: ["zip", "7z", "rar", "tar", "gz"] },
};

export interface LibraryFileRow {
  id: string;
  source: FileSource;
  /** 목록의 소스 구분 표시 — "전자결재-출장보고서" / "사업장-공장등록증" / "메신저" 등 */
  sourceLabel: string;
  fileName: string;
  ext: string;
  byteSize: number | null;
  contentType: string | null;
  uploadedAt: string | null;
  /** 출처 맥락 — 결재 문서 제목·대화방 이름·사업장명·게시글 제목·이슈 제목 */
  context: string | null;
}

export interface LibraryFilter {
  source?: FileSource | "";
  /** FORMAT_GROUPS 키 또는 'etc' */
  format?: string;
  /** YYYYMM */
  fromYm?: string;
  toYm?: string;
  q?: string;
}

interface RawRow {
  source: FileSource;
  item_id: string;
  file_name: string;
  byte_size: number | string | null;
  content_type: string | null;
  uploaded_at: string | null;
  sub_label: string | null;
  context: string | null;
  storage_key: string | null;
  total_count?: number | string;
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

function ymToKey(ym: string | undefined): string | null {
  const m = /^(\d{4})(\d{2})$/.exec((ym ?? "").trim());
  return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${m[1]}-${m[2]}` : null;
}

/** 전 소스 공통 컬럼으로 정규화한 UNION ALL 서브쿼리. */
const UNION_SQL = `
  SELECT 'approval' AS source,
         d.doc_id || ':' || (att.ord - 1)::text AS item_id,
         COALESCE(NULLIF(att.item->>'name', ''), '(이름 없음)') AS file_name,
         NULLIF(att.item->>'size', '')::bigint AS byte_size,
         NULL::text AS content_type,
         COALESCE(d.submitted_at, d.created_at) AS uploaded_at,
         COALESCE(f.name, d.form_id) AS sub_label,
         d.title AS context,
         att.item->>'key' AS storage_key
    FROM approval_docs d
    LEFT JOIN approval_forms f ON f.form_id = d.form_id
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(d.field_values->'file_attachments') = 'array'
           THEN d.field_values->'file_attachments' ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS att(item, ord)
  UNION ALL
  SELECT 'chat', a.attachment_id::text, a.file_name, a.byte_size, a.content_type, a.created_at,
         NULL, COALESCE(NULLIF(r.name, ''), '1:1 대화'), a.storage_key
    FROM chat_attachments a
    JOIN chat_messages m ON m.message_id = a.message_id
    JOIN chat_rooms r ON r.room_id = m.room_id
  UNION ALL
  SELECT 'facility', ffd.facility_id || ':' || ffd.doc_type,
         COALESCE(NULLIF(ffd.display_name, ''), NULLIF(ffd.original_filename, ''), ffd.doc_type),
         ffd.byte_size, ffd.content_type, ffd.uploaded_at,
         CASE ffd.doc_type
           WHEN 'integrated_plan' THEN '통합환경계획서'
           WHEN 'media_permit' THEN '매체별 인허가'
           WHEN 'factory_reg' THEN '공장등록증'
           ELSE '기타 자료' END,
         fac.company_name, ffd.storage_key
    FROM facility_facility_documents ffd
    JOIN facilities fac ON fac.facility_id = ffd.facility_id
   WHERE ffd.storage_key IS NOT NULL
  UNION ALL
  SELECT 'board', a.attachment_id, a.file_name, a.byte_size, a.content_type, a.created_at,
         NULL, p.title, a.storage_key
    FROM board_attachments a
    JOIN board_posts p ON p.post_id = a.post_id
  UNION ALL
  SELECT 'issue', a.attachment_id, a.file_name, a.byte_size, a.content_type, a.created_at,
         NULL, COALESCE(NULLIF(i.title, ''), i.issue_kind), a.storage_key
    FROM work_plan_issue_attachments a
    JOIN work_plan_issues i ON i.issue_id = a.issue_id
`;

function buildWhere(filter: LibraryFilter, params: unknown[]): string {
  const conds: string[] = [];
  if (filter.source) {
    params.push(filter.source);
    conds.push(`t.source = $${params.length}`);
  }
  const fromKey = ymToKey(filter.fromYm);
  if (fromKey) {
    params.push(fromKey);
    conds.push(`substring(COALESCE(t.uploaded_at, ''), 1, 7) >= $${params.length}`);
  }
  const toKey = ymToKey(filter.toYm);
  if (toKey) {
    params.push(toKey);
    conds.push(`substring(COALESCE(t.uploaded_at, ''), 1, 7) <= $${params.length}`);
  }
  const q = (filter.q ?? "").trim();
  if (q) {
    params.push(`%${q}%`);
    const p = `$${params.length}`;
    conds.push(`(t.file_name ILIKE ${p} OR COALESCE(t.context, '') ILIKE ${p} OR COALESCE(t.sub_label, '') ILIKE ${p})`);
  }
  const format = (filter.format ?? "").trim();
  if (format) {
    const extExpr = `lower(COALESCE(substring(t.file_name from '\\.([^.]+)$'), ''))`;
    if (format === "etc") {
      const known = Object.values(FORMAT_GROUPS).flatMap((g) => g.exts);
      params.push(known);
      conds.push(`NOT (${extExpr} = ANY($${params.length}::text[]))`);
    } else if (FORMAT_GROUPS[format]) {
      params.push(FORMAT_GROUPS[format].exts);
      conds.push(`${extExpr} = ANY($${params.length}::text[])`);
    }
  }
  return conds.length ? `WHERE ${conds.join(" AND ")}` : "";
}

function toRow(r: RawRow): LibraryFileRow {
  const sub = r.sub_label ? String(r.sub_label) : null;
  const base = SOURCE_LABEL[r.source] ?? r.source;
  return {
    id: `${r.source}:${r.item_id}`,
    source: r.source,
    sourceLabel: sub ? `${base}-${sub}` : base,
    fileName: String(r.file_name ?? ""),
    ext: extOf(String(r.file_name ?? "")),
    byteSize: r.byte_size != null ? Number(r.byte_size) : null,
    contentType: r.content_type != null ? String(r.content_type) : null,
    uploadedAt: r.uploaded_at != null ? String(r.uploaded_at) : null,
    context: r.context != null ? String(r.context) : null,
  };
}

export async function listLibraryFiles(
  filter: LibraryFilter,
  page: number,
  pageSize: number
): Promise<{ rows: LibraryFileRow[]; total: number }> {
  const db = await getDb();
  const params: unknown[] = [];
  const where = buildWhere(filter, params);
  params.push(pageSize, (page - 1) * pageSize);
  const sql = `
    SELECT t.*, count(*) OVER() AS total_count
      FROM (${UNION_SQL}) t
      ${where}
     ORDER BY t.uploaded_at DESC NULLS LAST, t.item_id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`;
  const rows = rowsToObjects(await db.exec(sql, params)) as unknown as RawRow[];
  const total = rows.length ? Number(rows[0].total_count ?? 0) : 0;
  return { rows: rows.map(toRow), total };
}

/** 필터 전체 삭제(일괄 삭제)용 — LIMIT 없이 id 만 수집한다(안전 상한 10,000건). */
export async function listLibraryFileIds(filter: LibraryFilter): Promise<string[]> {
  const db = await getDb();
  const params: unknown[] = [];
  const where = buildWhere(filter, params);
  const sql = `
    SELECT t.source, t.item_id FROM (${UNION_SQL}) t ${where}
     ORDER BY t.uploaded_at DESC NULLS LAST LIMIT 10000`;
  const rows = rowsToObjects(await db.exec(sql, params)) as unknown as RawRow[];
  return rows.map((r) => `${r.source}:${r.item_id}`);
}

interface ParsedId {
  source: FileSource;
  key1: string;
  /** approval 은 첨부 index, facility 는 doc_type */
  key2: string | null;
}

/** "{source}:{키}" 파싱 — approval/facility 는 마지막 ':' 뒤가 부속 키다. */
export function parseLibraryId(id: string): ParsedId | null {
  const sep = id.indexOf(":");
  if (sep <= 0) return null;
  const source = id.slice(0, sep) as FileSource;
  const rest = id.slice(sep + 1);
  if (!rest) return null;
  if (source === "approval" || source === "facility") {
    const last = rest.lastIndexOf(":");
    if (last <= 0) return null;
    return { source, key1: rest.slice(0, last), key2: rest.slice(last + 1) };
  }
  if (source === "chat" || source === "board" || source === "issue") {
    return { source, key1: rest, key2: null };
  }
  return null;
}

export interface OpenTarget {
  storageKey: string;
  fileName: string;
  contentType: string | null;
}

/** 열기용 — id 하나를 스토리지 키·파일명으로 해석한다. 없으면 null. */
export async function resolveLibraryFile(id: string): Promise<OpenTarget | null> {
  const parsed = parseLibraryId(id);
  if (!parsed) return null;
  const db = await getDb();

  if (parsed.source === "approval") {
    const idx = Number(parsed.key2);
    if (!Number.isInteger(idx) || idx < 0) return null;
    const rows = rowsToObjects(
      await db.exec(
        `SELECT field_values->'file_attachments'->($2::int) AS item FROM approval_docs WHERE doc_id = $1`,
        [parsed.key1, idx]
      )
    );
    const item = rows[0]?.item as { name?: string; key?: string } | null | undefined;
    if (!item?.key) return null;
    return { storageKey: String(item.key), fileName: String(item.name ?? "attachment"), contentType: null };
  }
  if (parsed.source === "chat") {
    const rows = rowsToObjects(
      await db.exec(
        `SELECT storage_key, file_name, content_type FROM chat_attachments WHERE attachment_id = $1`,
        [Number(parsed.key1)]
      )
    );
    if (!rows[0]?.storage_key) return null;
    return {
      storageKey: String(rows[0].storage_key),
      fileName: String(rows[0].file_name ?? "attachment"),
      contentType: rows[0].content_type != null ? String(rows[0].content_type) : null,
    };
  }
  if (parsed.source === "facility") {
    const rows = rowsToObjects(
      await db.exec(
        `SELECT storage_key, COALESCE(NULLIF(display_name, ''), NULLIF(original_filename, ''), doc_type) AS file_name, content_type
           FROM facility_facility_documents WHERE facility_id = $1 AND doc_type = $2`,
        [parsed.key1, parsed.key2]
      )
    );
    if (!rows[0]?.storage_key) return null;
    return {
      storageKey: String(rows[0].storage_key),
      fileName: String(rows[0].file_name ?? "attachment"),
      contentType: rows[0].content_type != null ? String(rows[0].content_type) : null,
    };
  }
  // board · issue — 같은 컬럼 셋
  const table = parsed.source === "board" ? "board_attachments" : "work_plan_issue_attachments";
  const rows = rowsToObjects(
    await db.exec(
      `SELECT storage_key, file_name, content_type FROM ${table} WHERE attachment_id = $1`,
      [parsed.key1]
    )
  );
  if (!rows[0]?.storage_key) return null;
  return {
    storageKey: String(rows[0].storage_key),
    fileName: String(rows[0].file_name ?? "attachment"),
    contentType: rows[0].content_type != null ? String(rows[0].content_type) : null,
  };
}

/**
 * 선택 삭제 — DB 행(전자결재는 jsonb 항목) 제거 후 S3 객체를 best-effort 삭제한다.
 * 전자결재 첨부는 문서별로 index 를 모아 한 번에 배열을 재구성한다(index 밀림 방지).
 */
export async function deleteLibraryFiles(ids: string[]): Promise<{ deleted: number; failed: string[] }> {
  const db = await getDb();
  const failed: string[] = [];
  let deleted = 0;
  const storageKeys: string[] = [];

  const approvalByDoc = new Map<string, number[]>();
  const chatIds: number[] = [];
  const boardIds: string[] = [];
  const issueIds: string[] = [];
  const facilityPairs: Array<{ facilityId: string; docType: string }> = [];

  for (const id of ids) {
    const parsed = parseLibraryId(id);
    if (!parsed) {
      failed.push(id);
      continue;
    }
    if (parsed.source === "approval") {
      const idx = Number(parsed.key2);
      if (!Number.isInteger(idx) || idx < 0) {
        failed.push(id);
        continue;
      }
      const list = approvalByDoc.get(parsed.key1) ?? [];
      list.push(idx);
      approvalByDoc.set(parsed.key1, list);
    } else if (parsed.source === "chat") chatIds.push(Number(parsed.key1));
    else if (parsed.source === "board") boardIds.push(parsed.key1);
    else if (parsed.source === "issue") issueIds.push(parsed.key1);
    else if (parsed.source === "facility") facilityPairs.push({ facilityId: parsed.key1, docType: String(parsed.key2) });
  }

  // 전자결재 — 문서별 jsonb 배열 재구성.
  for (const [docId, idxList] of approvalByDoc) {
    const rows = rowsToObjects(
      await db.exec(`SELECT field_values->'file_attachments' AS atts FROM approval_docs WHERE doc_id = $1`, [docId])
    );
    const atts = rows[0]?.atts as Array<{ name?: string; key?: string; size?: number }> | null | undefined;
    if (!Array.isArray(atts)) {
      failed.push(...idxList.map((i) => `approval:${docId}:${i}`));
      continue;
    }
    const drop = new Set(idxList.filter((i) => i < atts.length));
    if (drop.size === 0) {
      failed.push(...idxList.map((i) => `approval:${docId}:${i}`));
      continue;
    }
    const next = atts.filter((_, i) => !drop.has(i));
    await db.exec(
      `UPDATE approval_docs SET field_values = jsonb_set(field_values, '{file_attachments}', $2::jsonb) WHERE doc_id = $1`,
      [docId, JSON.stringify(next)]
    );
    for (const i of drop) {
      const key = atts[i]?.key;
      if (key) {
        storageKeys.push(String(key));
        // 오피스·hwpx 미리보기 변환 캐시도 함께 정리.
        storageKeys.push(`${key}.preview.pdf`);
      }
      deleted += 1;
    }
  }

  if (chatIds.length) {
    const rows = rowsToObjects(
      await db.exec(`DELETE FROM chat_attachments WHERE attachment_id = ANY($1::bigint[]) RETURNING storage_key`, [chatIds])
    );
    for (const r of rows) if (r.storage_key) storageKeys.push(String(r.storage_key));
    deleted += rows.length;
  }
  if (boardIds.length) {
    const rows = rowsToObjects(
      await db.exec(`DELETE FROM board_attachments WHERE attachment_id = ANY($1::text[]) RETURNING storage_key`, [boardIds])
    );
    for (const r of rows) if (r.storage_key) storageKeys.push(String(r.storage_key));
    deleted += rows.length;
  }
  if (issueIds.length) {
    const rows = rowsToObjects(
      await db.exec(`DELETE FROM work_plan_issue_attachments WHERE attachment_id = ANY($1::text[]) RETURNING storage_key`, [issueIds])
    );
    for (const r of rows) if (r.storage_key) storageKeys.push(String(r.storage_key));
    deleted += rows.length;
  }
  for (const pair of facilityPairs) {
    const rows = rowsToObjects(
      await db.exec(
        `DELETE FROM facility_facility_documents WHERE facility_id = $1 AND doc_type = $2 RETURNING storage_key`,
        [pair.facilityId, pair.docType]
      )
    );
    if (rows.length) {
      if (rows[0].storage_key) storageKeys.push(String(rows[0].storage_key));
      deleted += rows.length;
    } else {
      failed.push(`facility:${pair.facilityId}:${pair.docType}`);
    }
  }

  // 스토리지 정리 — best-effort(deleteContractDocument 는 예외를 던지지 않는다).
  for (const key of storageKeys) {
    await deleteContractDocument(key);
  }
  return { deleted, failed };
}

// ── 파일 저장 정책 ─────────────────────────────────────────

export type RetentionTier = "le5mb" | "le50mb" | "gt50mb";
export type RetentionValue = "6m" | "1y" | "5y" | "permanent";

export const RETENTION_TIERS: RetentionTier[] = ["le5mb", "le50mb", "gt50mb"];
export const RETENTION_VALUES: RetentionValue[] = ["6m", "1y", "5y", "permanent"];

export type RetentionPolicies = Record<RetentionTier, RetentionValue>;

const DEFAULT_POLICIES: RetentionPolicies = { le5mb: "permanent", le50mb: "permanent", gt50mb: "permanent" };

export async function getRetentionPolicies(): Promise<RetentionPolicies> {
  const db = await getDb();
  try {
    const rows = rowsToObjects(await db.exec(`SELECT size_tier, retention FROM file_retention_policies`));
    const out: RetentionPolicies = { ...DEFAULT_POLICIES };
    for (const r of rows) {
      const tier = String(r.size_tier) as RetentionTier;
      const val = String(r.retention) as RetentionValue;
      if (RETENTION_TIERS.includes(tier) && RETENTION_VALUES.includes(val)) out[tier] = val;
    }
    return out;
  } catch {
    // 마이그 190 미적용 환경 — 기본값(전부 영구)으로 응답한다.
    return { ...DEFAULT_POLICIES };
  }
}

/** retention 값 → 개월 수(permanent 는 null). */
function retentionMonths(value: RetentionValue): number | null {
  return value === "6m" ? 6 : value === "1y" ? 12 : value === "5y" ? 60 : null;
}

/**
 * 보존기간이 지난 파일 id 목록 — 자동 삭제 배치(file-retention-tick)용.
 * tier 조건: le5mb ≤5MB < le50mb ≤50MB < gt50mb. permanent tier 는 대상에서 제외.
 * uploaded_at 이 없는 행은 판정 불가라 건드리지 않는다.
 */
export async function listExpiredLibraryFileIds(policies: RetentionPolicies, limit = 1000): Promise<string[]> {
  const MB = 1024 * 1024;
  const tiers: Array<{ min: number | null; max: number | null; retention: RetentionValue }> = [
    { min: null, max: 5 * MB, retention: policies.le5mb },
    { min: 5 * MB, max: 50 * MB, retention: policies.le50mb },
    { min: 50 * MB, max: null, retention: policies.gt50mb },
  ];
  const params: unknown[] = [];
  const conds: string[] = [];
  const now = new Date();
  for (const tier of tiers) {
    const months = retentionMonths(tier.retention);
    if (months == null) continue;
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - months);
    const parts: string[] = [];
    if (tier.min != null) {
      params.push(tier.min);
      parts.push(`COALESCE(t.byte_size, 0) > $${params.length}`);
    }
    if (tier.max != null) {
      params.push(tier.max);
      parts.push(`COALESCE(t.byte_size, 0) <= $${params.length}`);
    }
    params.push(cutoff.toISOString());
    parts.push(`COALESCE(t.uploaded_at, '') <> '' AND t.uploaded_at < $${params.length}`);
    conds.push(`(${parts.join(" AND ")})`);
  }
  if (!conds.length) return [];
  params.push(limit);
  const db = await getDb();
  const sql = `
    SELECT t.source, t.item_id FROM (${UNION_SQL}) t
     WHERE ${conds.join(" OR ")}
     ORDER BY t.uploaded_at ASC LIMIT $${params.length}`;
  const rows = rowsToObjects(await db.exec(sql, params)) as unknown as RawRow[];
  return rows.map((r) => `${r.source}:${r.item_id}`);
}

export async function saveRetentionPolicies(policies: RetentionPolicies, userId: string): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  for (const tier of RETENTION_TIERS) {
    const val = policies[tier];
    if (!RETENTION_VALUES.includes(val)) {
      throw Object.assign(new Error("잘못된 보존기간 값입니다."), { status: 400 });
    }
    await db.exec(
      `INSERT INTO file_retention_policies (size_tier, retention, updated_at, updated_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (size_tier) DO UPDATE SET retention = $2, updated_at = $3, updated_by = $4`,
      [tier, val, now, userId]
    );
  }
}
