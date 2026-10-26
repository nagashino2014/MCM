import { randomBytes } from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import {
  illustIdsIn,
  sanitizeFits,
  sanitizeIllustrationMeta,
  sanitizeLicense,
  sanitizePalette,
  sanitizeSlots,
  type IllustrationInfo,
  type IllustrationRender,
} from "./illustration-types";
import { ILLUST_SVG_MAX_BYTES, paletteizeSvg, sanitizeIllustrationSvg, type SanitizedSvg } from "./illustration-svg";
import { registerIllustrations } from "./render/infographic/illustration";
import { isInfoType } from "./render/infographic/types";

/*
 * 회사소개서 일러스트 라이브러리(서버) — 블루프린트 §4-5, 313 catalog_illustrations + catalog_assets(kind 'illustration').
 * 파일: 계약 문서 저장소 catalog/illustrations/{asset_id}/illust.svg(정리본)·thumb.png.
 * 더하기: 관리 화면에서 매처 묶음 폴더(일괄) 또는 SVG 한 건. 같은 source_key 를 다시 올리면 새 자산으로 바꾸고,
 *   옛 자산은 쓰는 곳이 없으면 지우고 있으면 보관(archived)한다.
 * 빼기: 쪽 편집층·버전·발행본이 쓰지 않으면 행과 파일을 지우고, 쓰면 보관(라이브러리에서만 숨김 — 그 쪽은 그대로 그려진다).
 */

export class IllustrationError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const s = (v: unknown): string => (v == null ? "" : String(v));
const parse = <T,>(v: unknown, fallback: T): T => {
  if (v == null) return fallback;
  if (typeof v !== "string") return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};
export const ILLUST_ID_RE = /^cil_[a-f0-9]{16}$/;

function rowToInfo(r: Record<string, unknown>): IllustrationInfo {
  const meta = sanitizeIllustrationMeta({
    key: r.source_key,
    title: r.title,
    type: r.info_type,
    altTypes: parse(r.alt_types, []),
    count: Number(r.item_count),
    center: Number(r.has_center) === 1,
    loop: Number(r.has_loop) === 1,
    quality: r.quality == null ? undefined : Number(r.quality),
    note: r.note,
    view: [Number(r.view_w), Number(r.view_h)],
    slots: parse(r.slots, []),
    palette: parse(r.palette, []),
    license: parse(r.license, {}),
    fits: parse(r.fits, []),
  });
  return {
    ...meta,
    assetId: s(r.asset_id),
    status: s(r.status) === "archived" ? "archived" : "active",
    svgBytes: r.svg_bytes == null ? null : Number(r.svg_bytes),
    updatedAt: s(r.updated_at),
  };
}

export async function listIllustrations(opts: { includeArchived?: boolean } = {}): Promise<IllustrationInfo[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT * FROM catalog_illustrations ${opts.includeArchived ? "" : "WHERE status = 'active'"}
        ORDER BY status ASC, info_type ASC, item_count ASC, quality DESC NULLS LAST, title ASC`
    )
  );
  return rows.map(rowToInfo);
}

export async function getIllustration(assetId: string): Promise<IllustrationInfo | null> {
  if (!ILLUST_ID_RE.test(assetId)) return null;
  const db = await getDb();
  const r = rowsToObjects(await db.exec("SELECT * FROM catalog_illustrations WHERE asset_id = $1", [assetId]))[0];
  return r ? rowToInfo(r) : null;
}

async function storageKeys(assetId: string): Promise<{ svg: string; thumb: string | null } | null> {
  const db = await getDb();
  const r = rowsToObjects(
    await db.exec(
      `SELECT a.storage_key, i.thumb_key FROM catalog_assets a JOIN catalog_illustrations i ON i.asset_id = a.asset_id WHERE a.asset_id = $1`,
      [assetId]
    )
  )[0];
  return r ? { svg: s(r.storage_key), thumb: r.thumb_key ? s(r.thumb_key) : null } : null;
}

export async function readIllustrationFile(assetId: string, which: "svg" | "thumb"): Promise<Buffer | null> {
  if (!ILLUST_ID_RE.test(assetId)) return null;
  const keys = await storageKeys(assetId);
  const key = which === "svg" ? keys?.svg : keys?.thumb;
  if (!key) return null;
  const { readContractDocument } = await import("@/lib/storage/contract-document-storage");
  return readContractDocument(key);
}

// 정리본 SVG 캐시(자산 id + 갱신 시각) — 자산의 SVG 는 바뀌지 않고 정보(글자 자리)만 고쳐진다
const svgCache = new Map<string, string>();

/** 그릴 때 필요한 정보 + SVG(보관한 것도 포함 — 이미 쪽에 놓인 일러스트는 계속 그린다) */
export async function loadIllustrationRenders(ids: string[]): Promise<IllustrationRender[]> {
  const want = [...new Set(ids.filter((id) => ILLUST_ID_RE.test(id)))].slice(0, 200);
  if (!want.length) return [];
  const db = await getDb();
  const rows = rowsToObjects(await db.exec("SELECT * FROM catalog_illustrations WHERE asset_id = ANY($1::text[])", [want]));
  const out: IllustrationRender[] = [];
  for (const r of rows) {
    const info = rowToInfo(r);
    let svg = svgCache.get(info.assetId);
    if (svg == null) {
      const buf = await readIllustrationFile(info.assetId, "svg");
      if (!buf) continue;
      svg = buf.toString("utf8");
      if (svgCache.size > 120) svgCache.delete(svgCache.keys().next().value as string);
      svgCache.set(info.assetId, svg);
    }
    out.push({ info, svg });
  }
  return out;
}

/** 쪽 편집층·버전·발행본에 이 자산 id 가 나오는 곳 */
export async function illustrationUsage(assetId: string): Promise<{ pages: string[]; versions: number; editions: number }> {
  const db = await getDb();
  const [pages, versions, editions] = await Promise.all([
    db.exec("SELECT page_id FROM catalog_pages WHERE position($1 in tree::text) > 0 ORDER BY page_id", [assetId]),
    db.exec("SELECT count(*) AS n FROM catalog_versions WHERE position($1 in snapshot::text) > 0", [assetId]),
    db.exec("SELECT count(*) AS n FROM catalog_editions WHERE position($1 in options::text) > 0 OR position($1 in data_snapshot::text) > 0", [assetId]),
  ]);
  return {
    pages: rowsToObjects(pages).map((r) => s(r.page_id)),
    versions: Number(rowsToObjects(versions)[0]?.n ?? 0),
    editions: Number(rowsToObjects(editions)[0]?.n ?? 0),
  };
}

const inUse = (u: { pages: string[]; versions: number; editions: number }) => u.pages.length > 0 || u.versions > 0 || u.editions > 0;

async function removeFiles(assetId: string): Promise<void> {
  const keys = await storageKeys(assetId);
  if (!keys) return;
  const { deleteContractDocument } = await import("@/lib/storage/contract-document-storage");
  for (const k of [keys.svg, keys.thumb]) if (k) await deleteContractDocument(k).catch(() => undefined);
}

export interface ImportInput {
  /** 매처 meta.json(또는 관리 화면이 만든 같은 모양) */
  meta: unknown;
  svg: string;
  thumb?: Uint8Array | null;
  actorUserId: string | null;
}

export interface ImportResult {
  assetId: string;
  title: string;
  sourceKey: string;
  replaced: Array<{ assetId: string; action: "deleted" | "archived" }>;
  dropped: string[];
}

export async function importIllustration(input: ImportInput): Promise<ImportResult> {
  const meta = sanitizeIllustrationMeta(input.meta);
  if (!meta.sourceKey) throw new IllustrationError("일러스트 키(meta.key)가 없습니다.");
  const assetId = "cil_" + randomBytes(8).toString("hex");
  let clean: SanitizedSvg;
  try {
    clean = sanitizeIllustrationSvg(input.svg, `il${assetId.slice(4, 10)}-`);
  } catch (e) {
    throw new IllustrationError(`'${meta.title}' SVG 를 받을 수 없습니다: ${(e as Error).message}`);
  }
  // 매처를 거치지 않은 SVG — 색 값을 변수로 바꿔 팔레트를 만든다(재채색 가능하게)
  if (!meta.palette.length) {
    const p = paletteizeSvg(clean.svg);
    clean = { ...clean, svg: p.svg };
    meta.palette = sanitizePalette(p.palette);
  }
  const bytes = Buffer.from(clean.svg, "utf8");
  if (bytes.length > ILLUST_SVG_MAX_BYTES) throw new IllustrationError(`'${meta.title}' 정리한 SVG 가 3MB 를 넘습니다.`);
  // viewBox 비율이 정보와 다르면 SVG 쪽을 믿는다
  meta.view = [clean.viewBox[2], clean.viewBox[3]];
  const { putContractDocument } = await import("@/lib/storage/contract-document-storage");
  const dir = ["catalog", "illustrations", assetId].join("/");
  const svgStored = await putContractDocument(`${dir}/illust.svg`, bytes, "image/svg+xml");
  let thumbKey: string | null = null;
  if (input.thumb && input.thumb.length > 8 && input.thumb.length <= 2 * 1024 * 1024 && Buffer.from(input.thumb.slice(0, 8)).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    thumbKey = (await putContractDocument(`${dir}/thumb.png`, Buffer.from(input.thumb), "image/png")).storageKey;
  }
  const now = new Date().toISOString();
  const prev = rowsToObjects(
    await (await getDb()).exec("SELECT asset_id FROM catalog_illustrations WHERE source_key = $1 AND status = 'active'", [meta.sourceKey])
  ).map((r) => s(r.asset_id));
  const replaced: ImportResult["replaced"] = [];
  const toDelete: string[] = [];
  for (const id of prev) {
    const u = await illustrationUsage(id);
    if (inUse(u)) replaced.push({ assetId: id, action: "archived" });
    else {
      replaced.push({ assetId: id, action: "deleted" });
      toDelete.push(id);
    }
  }
  for (const id of toDelete) await removeFiles(id);
  await withDbWrite(async (txn) => {
    for (const r of replaced) {
      if (r.action === "archived") await txn.run("UPDATE catalog_illustrations SET status = 'archived', updated_at = $2, updated_by = $3 WHERE asset_id = $1", [r.assetId, now, input.actorUserId]);
      else {
        await txn.run("DELETE FROM catalog_illustrations WHERE asset_id = $1", [r.assetId]);
        await txn.run("DELETE FROM catalog_assets WHERE asset_id = $1 AND kind = 'illustration'", [r.assetId]);
      }
    }
    await txn.run(
      `INSERT INTO catalog_assets (asset_id, kind, storage_key, file_name, content_type, width, height, rights_note, created_by, created_at)
       VALUES ($1, 'illustration', $2, 'illust.svg', 'image/svg+xml', $3, $4, $5, $6, $7)`,
      [assetId, svgStored.storageKey, Math.round(meta.view[0]), Math.round(meta.view[1]), [meta.license.provider, meta.license.stockId, meta.license.license].filter(Boolean).join(" · ") || null, input.actorUserId, now]
    );
    await txn.run(
      `INSERT INTO catalog_illustrations (asset_id, source_key, title, info_type, alt_types, item_count, has_center, has_loop, quality, note,
         view_w, view_h, slots, palette, license, fits, thumb_key, svg_bytes, status, created_by, created_at, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb, $17, $18, 'active', $19, $20, $19, $20)`,
      [
        assetId,
        meta.sourceKey,
        meta.title,
        meta.type,
        JSON.stringify(meta.altTypes),
        meta.count,
        meta.center ? 1 : 0,
        meta.loop ? 1 : 0,
        meta.quality,
        meta.note || null,
        meta.view[0],
        meta.view[1],
        JSON.stringify(meta.slots),
        JSON.stringify(meta.palette),
        JSON.stringify(meta.license),
        JSON.stringify(meta.fits),
        thumbKey,
        bytes.length,
        input.actorUserId,
        now,
      ]
    );
  });
  return { assetId, title: meta.title, sourceKey: meta.sourceKey, replaced, dropped: clean.dropped };
}

export interface IllustrationPatch {
  title?: string;
  type?: string;
  altTypes?: string[];
  count?: number;
  center?: boolean;
  loop?: boolean;
  quality?: number | null;
  note?: string;
  slots?: unknown;
  license?: unknown;
  fits?: unknown;
  status?: "active" | "archived";
}

export async function updateIllustration(assetId: string, patch: IllustrationPatch, actorUserId: string | null): Promise<IllustrationInfo> {
  const cur = await getIllustration(assetId);
  if (!cur) throw new IllustrationError("일러스트를 찾을 수 없습니다.", 404);
  const next = { ...cur };
  if (patch.title != null) next.title = String(patch.title).trim().slice(0, 80) || cur.title;
  if (patch.type != null) {
    if (!isInfoType(patch.type)) throw new IllustrationError("유형이 올바르지 않습니다.");
    next.type = patch.type;
  }
  if (Array.isArray(patch.altTypes)) next.altTypes = patch.altTypes.filter(isInfoType).slice(0, 6);
  if (patch.count != null) {
    const n = Math.round(Number(patch.count));
    if (!(n >= 1 && n <= 30)) throw new IllustrationError("항목 수는 1~30 입니다.");
    next.count = n;
  }
  if (patch.center != null) next.center = patch.center === true;
  if (patch.loop != null) next.loop = patch.loop === true;
  if (patch.quality !== undefined) next.quality = patch.quality == null ? null : Math.max(1, Math.min(5, Math.round(Number(patch.quality))));
  if (patch.note != null) next.note = String(patch.note).slice(0, 300);
  if (patch.slots !== undefined) {
    next.slots = sanitizeSlots(patch.slots);
    if (!next.slots.length) throw new IllustrationError("글자 자리가 하나는 있어야 합니다.");
  }
  if (patch.license !== undefined) next.license = sanitizeLicense(patch.license);
  if (patch.fits !== undefined) next.fits = sanitizeFits(patch.fits);
  if (patch.status === "active" || patch.status === "archived") next.status = patch.status;
  const over = next.slots.filter((sl) => sl.item > next.count);
  if (over.length) throw new IllustrationError(`항목 수(${next.count})보다 큰 항목 번호를 가진 글자 자리가 ${over.length}개 있습니다.`);
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    await txn.run(
      `UPDATE catalog_illustrations SET title = $2, info_type = $3, alt_types = $4::jsonb, item_count = $5, has_center = $6, has_loop = $7,
          quality = $8, note = $9, slots = $10::jsonb, license = $11::jsonb, fits = $12::jsonb, status = $13, updated_by = $14, updated_at = $15
        WHERE asset_id = $1`,
      [
        assetId,
        next.title,
        next.type,
        JSON.stringify(next.altTypes),
        next.count,
        next.center ? 1 : 0,
        next.loop ? 1 : 0,
        next.quality,
        next.note || null,
        JSON.stringify(next.slots),
        JSON.stringify(next.license),
        JSON.stringify(next.fits),
        next.status,
        actorUserId,
        now,
      ]
    );
  });
  return { ...next, updatedAt: now };
}

/** 빼기 — 쓰는 곳이 없으면 지우고, 있으면 보관 */
export async function removeIllustration(assetId: string, actorUserId: string | null): Promise<{ action: "deleted" | "archived"; usage: Awaited<ReturnType<typeof illustrationUsage>> }> {
  const cur = await getIllustration(assetId);
  if (!cur) throw new IllustrationError("일러스트를 찾을 수 없습니다.", 404);
  const usage = await illustrationUsage(assetId);
  if (inUse(usage)) {
    await withDbWrite(async (txn) => {
      await txn.run("UPDATE catalog_illustrations SET status = 'archived', updated_by = $2, updated_at = $3 WHERE asset_id = $1", [assetId, actorUserId, new Date().toISOString()]);
    });
    return { action: "archived", usage };
  }
  await removeFiles(assetId);
  await withDbWrite(async (txn) => {
    await txn.run("DELETE FROM catalog_illustrations WHERE asset_id = $1", [assetId]);
    await txn.run("DELETE FROM catalog_assets WHERE asset_id = $1 AND kind = 'illustration'", [assetId]);
  });
  svgCache.delete(assetId);
  return { action: "deleted", usage };
}

/** 문서 상태(쪽 편집층)에 쓰인 일러스트를 등록한다 — 서버 PDF·HTML 이 그리기 전에 부른다 */
export async function registerUsedIllustrations(value: unknown): Promise<void> {
  const ids = illustIdsIn(value);
  if (ids.length) registerIllustrations(await loadIllustrationRenders(ids));
}
