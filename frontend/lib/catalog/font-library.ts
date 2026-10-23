import { randomBytes } from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { prepareFont } from "@/lib/print-kit/converter";
import { readPublicFile } from "@/lib/print-kit/server";
import { analyzeFontFile, groupFamilies, judgeFamily, referenceMetrics } from "./font-analysis";
import {
  CSS_WEIGHTS,
  FONT_ROLES,
  LICENSE_SCOPES,
  LICENSE_TYPES,
  type CatalogFont,
  type CatalogFontFile,
  type CatalogFontLicense,
  type CatalogFontSet,
  type EmbedPolicy,
  type FontClass,
  type FontCoverage,
  type FontFamilyVerdict,
  type FontFileAnalysis,
  type FontMetrics,
  type FontRole,
  type FontUsage,
  type LicenseScope,
  type LicenseType,
  type WeightMap,
} from "./font-types";
import { BUNDLED_FONTS, DEFAULT_FONT_SET_ID, FONT_SETS, buildCustomFontSet, checkFontSetChoice, fontSetById, type FontSetDef } from "./fonts";

/*
 * 회사소개서 서체 라이브러리(서버) — 블루프린트 §5-3·5-5·§10. 309 catalog_fonts·catalog_font_sets 만 쓴다(마이그레이션 없음).
 *   catalog_fonts: 서체 = 패밀리 하나. files(jsonb) = 굵기 파일들 [{weight, style, storageKey(원본), woffKey(TrueType 윤곽 WOFF), coverage, metrics …}],
 *     roles_allowed = 쓸 수 있는 역할(display·body·figure), license_type + license_note(JSON: 출처·허용 범위·메모·확인자),
 *     embed_policy = fsType 판정, coverage·metrics·size_adjust = 패밀리 값(굵기 교집합·보통 굵기 수치). 지우지 않고 is_active 로 끈다(발행본 재현).
 *   기본 서체(프리텐다드·노토)는 source='bundled' 행으로도 둔다 — 사용자 세트의 FK(display/body/figure_font_id)가 가리킬 수 있게(세트 저장 때 채움).
 *   catalog_font_sets: 사용자 세트(is_preset=0). set_id = 'u-' + 8자리(문서 theme.fontSet 규칙 ^[a-z0-9-]{1,40}$).
 * 파일 저장: S3 catalog/fonts/{font_id}/src/… 원본 · catalog/fonts/{font_id}/… 변환본. 굵기를 바꿔 올려도 옛 파일은 지우지 않는다.
 */

export class FontLibraryError extends Error {
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
const shortId = () => randomBytes(6).toString("hex");

// ── 기준 수치·기본 서체 ──

let refPromise: Promise<FontMetrics> | null = null;
export function referenceFontMetrics(): Promise<FontMetrics> {
  refPromise ??= readPublicFile("print-kit/fonts/Pretendard-Regular.woff").then((b) => referenceMetrics(new Uint8Array(b)));
  refPromise.catch(() => (refPromise = null));
  return refPromise;
}

let bundledPromise: Promise<CatalogFont[]> | null = null;

/** 기본 서체(번들) — 파일을 같은 분석으로 재서 업로드 서체와 같은 모양으로 보여 준다 */
export function bundledFonts(): Promise<CatalogFont[]> {
  bundledPromise ??= (async () => {
    const ref = await referenceFontMetrics();
    const out: CatalogFont[] = [];
    for (const b of BUNDLED_FONTS) {
      const files: CatalogFontFile[] = [];
      const parts: Array<{ weight: number; italic: boolean; coverage: FontCoverage; metrics: FontMetrics; embed: EmbedPolicy }> = [];
      for (const f of b.files) {
        const bytes = await readPublicFile(`print-kit/fonts/${f.file}`);
        const a = analyzeFontFile(new Uint8Array(bytes), f.file);
        parts.push({ weight: f.weight, italic: false, coverage: a.coverage, metrics: a.metrics, embed: a.embed });
        files.push({
          weight: f.weight,
          style: "normal",
          storageKey: null,
          woffKey: null,
          file: f.file,
          format: "woff",
          bytes: bytes.length,
          woffBytes: bytes.length,
          fileName: f.file,
          postscriptName: a.postscriptName,
          outline: a.outline ?? "truetype",
          converted: false,
          fromVariable: false,
          uploadedAt: "",
        });
      }
      const v = judgeFamily(parts, ref, { classification: b.classification });
      out.push({
        fontId: b.fontId,
        family: b.family,
        displayName: b.displayName,
        source: "bundled",
        files,
        roles: v.roles,
        bodyCapable: v.bodyCapable,
        reasons: v.reasons,
        classification: b.classification,
        license: { type: "ofl", source: b.license.source, scope: ["print", "pdf", "web"], note: b.license.note, confirmedBy: null, confirmedAt: "" },
        embed: v.embed,
        noSubsetting: false,
        coverage: v.coverage,
        metrics: parts.sort((x, y) => Math.abs(x.weight - 400) - Math.abs(y.weight - 400))[0].metrics,
        sizeAdjust: v.sizeAdjust,
        isActive: true,
        uploadedBy: null,
        uploadedByName: null,
        uploadedAt: "",
      });
    }
    return out;
  })();
  bundledPromise.catch(() => (bundledPromise = null));
  return bundledPromise;
}

// ── 행 ↔ 객체 ──

interface StoredFile extends CatalogFontFile {
  italic?: boolean;
  coverage?: FontCoverage;
  metrics?: FontMetrics;
  embed?: EmbedPolicy;
}

function rowToFont(r: Record<string, unknown>): CatalogFont {
  const files = parse<StoredFile[]>(r.files, []);
  const license = parse<Partial<CatalogFontLicense> | null>(r.license_note, null);
  const metrics = parse<FontMetrics & { classification?: FontClass; reasons?: string[]; noSubsetting?: boolean }>(r.metrics, {} as FontMetrics);
  const roles = parse<FontRole[]>(r.roles_allowed, ["display"]);
  return {
    fontId: s(r.font_id),
    family: s(r.family),
    displayName: s(r.display_name) || s(r.family),
    source: r.source === "bundled" ? "bundled" : "upload",
    files: files.map(({ coverage, metrics: _m, embed: _e, italic: _i, ...f }) => ({ ...f, hangul2350: coverage?.hangul2350 }) as CatalogFontFile),
    roles,
    bodyCapable: roles.includes("body"),
    reasons: metrics.reasons ?? [],
    classification: metrics.classification ?? "sans",
    license: license
      ? {
          type: (LICENSE_TYPES.some((t) => t.id === r.license_type) ? r.license_type : "other") as LicenseType,
          source: s(license.source),
          scope: (license.scope ?? []).filter((x): x is LicenseScope => LICENSE_SCOPES.some((sc) => sc.id === x)),
          note: s(license.note),
          confirmedBy: license.confirmedBy ?? null,
          confirmedAt: s(license.confirmedAt),
        }
      : null,
    embed: (s(r.embed_policy) || "installable") as EmbedPolicy,
    noSubsetting: Boolean(metrics.noSubsetting),
    coverage: parse<FontCoverage>(r.coverage, { hangul2350: 0, hangulMissing: "", hangulAll: 0, latin: false, digits: false, symbolsMissing: "", tnum: false, ranges: [] }),
    metrics,
    sizeAdjust: parse(r.size_adjust, { sizeAdjust: 100, ascentOverride: 95.2, descentOverride: 24.1, lineGapOverride: 0, basis: "none" as const }),
    isActive: Number(r.is_active ?? 1) === 1,
    uploadedBy: r.uploaded_by ? s(r.uploaded_by) : null,
    uploadedByName: r.uploaded_by_name ? s(r.uploaded_by_name) : null,
    uploadedAt: s(r.uploaded_at),
  };
}

async function uploadRows(where = "", params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const db = await getDb();
  return rowsToObjects(
    await db.exec(
      `SELECT f.*, COALESCE(u.name, '') AS uploaded_by_name FROM catalog_fonts f LEFT JOIN users u ON u.user_id = f.uploaded_by
        WHERE f.source = 'upload' ${where} ORDER BY lower(f.display_name), f.font_id`,
      params
    )
  );
}

/** 모든 서체(기본 + 업로드, 비활성 포함) */
export async function listCatalogFonts(): Promise<CatalogFont[]> {
  const [bundled, rows] = await Promise.all([bundledFonts(), uploadRows()]);
  return [...bundled, ...rows.map(rowToFont)];
}

export async function getCatalogFont(fontId: string): Promise<CatalogFont | null> {
  if (fontId.startsWith("b-")) return (await bundledFonts()).find((f) => f.fontId === fontId) ?? null;
  const rows = await uploadRows("AND f.font_id = $1", [fontId]);
  return rows[0] ? rowToFont(rows[0]) : null;
}

/** 업로드 서체 굵기 파일(TrueType 윤곽 WOFF) 저장소 키 */
export async function uploadedFaceKey(fontId: string, weight: number): Promise<string | null> {
  const db = await getDb();
  const r = rowsToObjects(await db.exec("SELECT files FROM catalog_fonts WHERE font_id = $1 AND source = 'upload'", [fontId]))[0];
  const files = parse<StoredFile[]>(r?.files, []);
  return files.find((f) => f.weight === weight && f.style === "normal")?.woffKey ?? null;
}

// ── 세트 ──

function rowToSet(r: Record<string, unknown>): CatalogFontSet {
  return {
    setId: s(r.set_id),
    name: s(r.name),
    displayFontId: s(r.display_font_id),
    bodyFontId: s(r.body_font_id),
    figureFontId: s(r.figure_font_id),
    weightMap: parse<WeightMap>(r.weight_map, { display: {}, body: {}, figure: {} }),
    orderNo: Number(r.order_no ?? 0),
    updatedAt: s(r.updated_at),
  };
}

export async function listFontSetRows(): Promise<CatalogFontSet[]> {
  const db = await getDb();
  return rowsToObjects(await db.exec("SELECT * FROM catalog_font_sets WHERE is_preset = 0 ORDER BY order_no, name, set_id")).map(rowToSet);
}

/** 사용자 세트 → 그릴 수 있는 세트 정의(스튜디오·PDF) */
export async function resolveCustomFontSets(): Promise<FontSetDef[]> {
  const [sets, fonts] = await Promise.all([listFontSetRows(), listCatalogFonts()]);
  const byId = new Map(fonts.map((f) => [f.fontId, f]));
  return sets.map((set) => buildCustomFontSet(set, byId));
}

/** 문서 서체 세트 id → 세트(고를 수 없으면 기본 세트 + 사유) */
export async function resolveFontSet(id: string | null | undefined): Promise<{ set: FontSetDef; notice: string | null }> {
  const preset = fontSetById(id);
  if (preset) return preset.available ? { set: preset, notice: null } : { set: fontSetById(DEFAULT_FONT_SET_ID)!, notice: `서체 세트 '${preset.label}'는 아직 서체 파일이 없어 기본 프리텐다드로 만들었습니다.` };
  const custom = id && id.startsWith("u-") ? (await resolveCustomFontSets()).find((x) => x.id === id) : undefined;
  if (custom?.available) return { set: custom, notice: null };
  const why = custom ? `서체 세트 '${custom.label}'를 쓸 수 없어(${custom.note}) 기본 프리텐다드로 만들었습니다.` : `서체 세트 '${id}'를 찾지 못해 기본 프리텐다드로 만들었습니다.`;
  return { set: fontSetById(DEFAULT_FONT_SET_ID)!, notice: why };
}

/** 세트 이름(표시용) — 기본 세트는 상수, 사용자 세트는 catalog_font_sets.name */
export async function fontSetLabel(id: string): Promise<string> {
  const preset = fontSetById(id);
  if (preset) return preset.label;
  const db = await getDb();
  const r = rowsToObjects(await db.exec("SELECT name FROM catalog_font_sets WHERE set_id = $1", [id]))[0];
  return r ? s(r.name) : id;
}

/** 사용자 세트의 FK 대상이 되도록 기본 서체 행을 채운다(이미 있으면 그대로) */
async function ensureBundledFontRows(txn: { run(sql: string, params?: unknown[]): Promise<void> }): Promise<void> {
  const now = new Date().toISOString();
  for (const f of await bundledFonts()) {
    await txn.run(
      `INSERT INTO catalog_fonts (font_id, family, display_name, source, files, roles_allowed, license_type, license_note, embed_policy, coverage, metrics, size_adjust, is_active, uploaded_at)
       VALUES ($1, $2, $3, 'bundled', $4::jsonb, $5::jsonb, 'ofl', $6, $7, '{}'::jsonb, $8::jsonb, $9::jsonb, 1, $10)
       ON CONFLICT (font_id) DO NOTHING`,
      [
        f.fontId,
        f.family,
        f.displayName,
        JSON.stringify(f.files.map((x) => ({ weight: x.weight, style: x.style, file: x.file }))),
        JSON.stringify(f.roles),
        JSON.stringify(f.license),
        f.embed,
        JSON.stringify({ classification: f.classification }),
        JSON.stringify(f.sizeAdjust),
        now,
      ]
    );
  }
}

export interface FontSetInput {
  setId?: string | null;
  name: string;
  displayFontId: string;
  bodyFontId: string;
  figureFontId: string;
  weightMap: WeightMap;
}

/** 세트 저장(새로 만들기·고치기) — 고르기 규칙(본문 제목 전용 금지 등)을 서버에서 다시 본다 */
export async function saveFontSet(input: FontSetInput): Promise<CatalogFontSet> {
  const name = s(input.name).trim().slice(0, 40);
  if (!name) throw new FontLibraryError("세트 이름을 적어 주세요.");
  const fonts = await listCatalogFonts();
  const byId = new Map(fonts.map((f) => [f.fontId, f]));
  const pick = (id: string) => byId.get(s(id));
  const chosen = { display: pick(input.displayFontId), body: pick(input.bodyFontId), figure: pick(input.figureFontId) } as Record<FontRole, CatalogFont | undefined>;
  const weightMap = {} as WeightMap;
  for (const role of FONT_ROLES) {
    weightMap[role] = {};
    for (const w of CSS_WEIGHTS) {
      const v = Number(input.weightMap?.[role]?.[String(w)]);
      if (Number.isFinite(v)) weightMap[role][String(w)] = v;
    }
  }
  const { errors } = checkFontSetChoice(chosen, weightMap);
  const existing = input.setId ? (await listFontSetRows()).find((x) => x.setId === input.setId) : undefined;
  if (input.setId && !existing) throw new FontLibraryError("세트를 찾지 못했습니다.", 404);
  // 비활성 서체는 새로 고를 수 없다(이미 그 세트에 있던 서체는 그대로 둔다)
  for (const role of FONT_ROLES) {
    const f = chosen[role];
    const before = existing ? { display: existing.displayFontId, body: existing.bodyFontId, figure: existing.figureFontId }[role] : null;
    if (f && !f.isActive && before !== f.fontId) errors.push(`'${f.displayName}'은 비활성 서체라 고를 수 없습니다.`);
  }
  if (errors.length) throw new FontLibraryError(errors.join(" "));
  const setId = existing?.setId ?? `u-${randomBytes(4).toString("hex")}`;
  const now = new Date().toISOString();
  let order = existing?.orderNo ?? 0;
  await withDbWrite(async (txn) => {
    await ensureBundledFontRows(txn);
    order = existing?.orderNo ?? Number(rowsToObjects(await txn.exec("SELECT COALESCE(max(order_no), 0) + 1 AS n FROM catalog_font_sets"))[0]?.n ?? 1);
    await txn.run(
      `INSERT INTO catalog_font_sets (set_id, name, display_font_id, body_font_id, figure_font_id, weight_map, is_preset, order_no, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, 0, $7, $8)
       ON CONFLICT (set_id) DO UPDATE SET name = EXCLUDED.name, display_font_id = EXCLUDED.display_font_id, body_font_id = EXCLUDED.body_font_id,
         figure_font_id = EXCLUDED.figure_font_id, weight_map = EXCLUDED.weight_map, updated_at = EXCLUDED.updated_at`,
      [setId, name, chosen.display!.fontId, chosen.body!.fontId, chosen.figure!.fontId, JSON.stringify(weightMap), order, now]
    );
  });
  return { setId, name, displayFontId: chosen.display!.fontId, bodyFontId: chosen.body!.fontId, figureFontId: chosen.figure!.fontId, weightMap, orderNo: order, updatedAt: now };
}

/** 세트 지우기 — 쓰는 문서가 있으면 막는다(지난 PDF 는 생성본에 서체 파일 키가 남아 다시 만들 수 있다) */
export async function deleteFontSet(setId: string): Promise<void> {
  const usage = await fontUsage();
  const docs = usage.documentsBySet[setId] ?? [];
  if (docs.length) throw new FontLibraryError(`이 세트를 쓰는 문서가 있어 지울 수 없습니다: ${docs.map((d) => d.title).join(", ")}. 스튜디오에서 다른 세트로 바꾼 뒤 지우세요.`);
  await withDbWrite(async (txn) => {
    await txn.run("DELETE FROM catalog_font_sets WHERE set_id = $1 AND is_preset = 0", [setId]);
  });
}

/** 서체·세트를 쓰는 곳 — 문서(theme.fontSet), 세트(역할 서체), PDF 생성본(options.fonts) */
export async function fontUsage(): Promise<FontUsage> {
  const db = await getDb();
  const [docs, sets, editions] = await Promise.all([
    db.exec("SELECT doc_id, title, COALESCE(theme->>'fontSet', $1) AS font_set FROM catalog_documents WHERE status <> 'archived'", [DEFAULT_FONT_SET_ID]),
    db.exec("SELECT set_id, display_font_id, body_font_id, figure_font_id FROM catalog_font_sets"),
    db.exec(
      `SELECT x->>'fontId' AS font_id, count(DISTINCT e.edition_id) AS n
         FROM catalog_editions e, jsonb_array_elements(CASE WHEN jsonb_typeof(e.options->'fonts') = 'array' THEN e.options->'fonts' ELSE '[]'::jsonb END) x
        GROUP BY 1`
    ),
  ]);
  const out: FontUsage = { documentsBySet: {}, setsByFont: {}, editionsByFont: {} };
  for (const r of rowsToObjects(docs)) (out.documentsBySet[s(r.font_set)] ??= []).push({ docId: s(r.doc_id), title: s(r.title) });
  for (const r of rowsToObjects(sets)) {
    for (const k of ["display_font_id", "body_font_id", "figure_font_id"]) {
      const id = s(r[k]);
      if (!id) continue;
      const list = (out.setsByFont[id] ??= []);
      if (!list.includes(s(r.set_id))) list.push(s(r.set_id));
    }
  }
  // 기본 세트가 쓰는 기본 서체
  const presetFonts: Record<string, string[]> = { pretendard: ["b-pretendard"], noto: ["b-noto-sans-kr", "b-pretendard"], serif: ["b-noto-serif-kr", "b-noto-sans-kr", "b-pretendard"] };
  for (const set of FONT_SETS) for (const id of presetFonts[set.id] ?? []) (out.setsByFont[id] ??= []).push(set.id);
  for (const r of rowsToObjects(editions)) out.editionsByFont[s(r.font_id)] = Number(r.n ?? 0);
  return out;
}

// ── 업로드 ──

export interface UploadFile {
  name: string;
  bytes: Uint8Array;
  /** 올린 크기(20MB 를 넘으면 bytes 는 비우고 크기만 넘긴다) */
  size?: number;
}

async function existingFamilies(): Promise<Map<string, string>> {
  const rows = await uploadRows();
  return new Map(rows.map((r) => [s(r.family).trim().toLowerCase(), s(r.font_id)]));
}

/** 미리 분석(저장 안 함) — 화면이 판정·경고를 보여 주고 라이선스를 받은 뒤 등록한다 */
export async function analyzeUploads(files: UploadFile[], classOverride?: FontClass | null): Promise<{ files: FontFileAnalysis[]; families: FontFamilyVerdict[] }> {
  const ref = await referenceFontMetrics();
  const analyses = files.map((f) => analyzeFontFile(f.bytes, f.name, f.size ?? f.bytes.length));
  const families = groupFamilies(analyses, ref, await existingFamilies(), classOverride);
  // 글자 범위 목록은 화면에 필요 없다(응답 크기)
  return { files: analyses.map((a) => ({ ...a, coverage: { ...a.coverage, ranges: [] } })), families };
}

export interface LicenseInput {
  type: string;
  source: string;
  scope: string[];
  note: string;
  confirmed: boolean;
}

function checkLicense(input: LicenseInput, actorUserId: string | null): CatalogFontLicense {
  const type = LICENSE_TYPES.find((t) => t.id === input.type)?.id;
  if (!type) throw new FontLibraryError("라이선스 종류를 고르세요.");
  const source = s(input.source).trim().slice(0, 300);
  if (!source) throw new FontLibraryError("서체 출처(내려받은 곳·구입처)를 적어 주세요.");
  const scope = Array.from(new Set(input.scope)).filter((x): x is LicenseScope => LICENSE_SCOPES.some((sc) => sc.id === x));
  if (!scope.includes("pdf")) throw new FontLibraryError("PDF 포함(임베딩)이 허용된 서체만 등록할 수 있습니다 — 회사소개서는 PDF 로 배포합니다.");
  const note = s(input.note).trim().slice(0, 1000);
  if (type === "purchased" && !note) throw new FontLibraryError("구매 서체는 라이선스 증빙 메모(구입처·계약 번호·허용 범위 등)를 적어야 합니다.");
  if (!input.confirmed) throw new FontLibraryError("라이선스를 확인했다는 항목에 표시해 주세요.");
  return { type, source, scope, note, confirmedBy: actorUserId, confirmedAt: new Date().toISOString() };
}

export interface RegisterResult {
  fonts: Array<{ fontId: string; displayName: string; weights: number[]; created: boolean; converted: number }>;
}

/**
 * 등록 — 다시 분석(화면 값을 믿지 않는다) → 거부 사유가 있으면 멈춤 → converter 로 정적 TrueType 윤곽 WOFF 만들기 →
 * 원본·변환본 저장 → 변환본으로 다시 재서 catalog_fonts 에 기록(같은 패밀리면 굵기를 더하거나 바꾼다).
 * 화면은 파일 하나씩(가변 서체는 instanceWeight 로 굵기 하나씩) 보낸다 — 운영 converter(0.5 vCPU)에서 CFF·가변 서체 한 굵기가
 * 수십 초라, 여러 굵기를 한 요청에 묶으면 ALB 제한 시간(300초)을 넘을 수 있다.
 */
export async function registerUploads(
  files: UploadFile[],
  opts: { license: LicenseInput; classification?: FontClass | null; displayName?: string | null; instanceWeight?: number | null },
  actorUserId: string | null
): Promise<RegisterResult> {
  if (!files.length) throw new FontLibraryError("서체 파일을 고르세요.");
  const license = checkLicense(opts.license, actorUserId);
  const ref = await referenceFontMetrics();
  const analyses = files.map((f) => analyzeFontFile(f.bytes, f.name, f.size ?? f.bytes.length));
  const rejected = analyses.filter((a) => a.errors.length);
  if (rejected.length) throw new FontLibraryError(rejected.map((a) => `${a.fileName}: ${a.errors.join(" ")}`).join(" / "));
  const families = groupFamilies(analyses, ref, await existingFamilies(), opts.classification ?? null);
  const { putContractDocument } = await import("@/lib/storage/contract-document-storage");
  const result: RegisterResult = { fonts: [] };

  for (const fam of families) {
    const fontId = fam.existingFontId ?? `f-${shortId()}`;
    const now = new Date().toISOString();
    const added: StoredFile[] = [];
    let converted = 0;
    // 같은 원본(이름·크기)을 이미 저장했으면(가변 서체를 굵기별로 나눠 보낸 경우) 원본은 다시 저장하지 않는다
    const savedBefore = fam.existingFontId
      ? parse<StoredFile[]>(rowsToObjects(await (await getDb()).exec("SELECT files FROM catalog_fonts WHERE font_id = $1", [fontId]))[0]?.files, [])
      : [];
    // converter 는 한 번에 하나씩(메모리 1GB — 한글 가변 서체 한 벌 ≈ 300MB)
    for (const i of fam.fileIndexes) {
      const a = analyses[i];
      const src = Buffer.from(files[i].bytes);
      const want = a.variable ? (opts.instanceWeight && a.instanceWeights.includes(opts.instanceWeight) ? [opts.instanceWeight] : a.instanceWeights) : [];
      const prepared = await prepareFont(src, want);
      const ext = a.format === "unknown" ? "bin" : a.format;
      const tag = shortId();
      const reuse = savedBefore.find((b) => b.fileName === a.fileName.slice(0, 200) && b.bytes === a.bytes && b.storageKey);
      const srcKey = reuse?.storageKey ?? `catalog/fonts/${fontId}/src/${a.variable ? "var" : a.weight}${a.italic ? "-italic" : ""}-${tag}.${ext}`;
      if (!reuse) await putContractDocument(srcKey, src, `font/${ext === "otf" ? "otf" : ext}`);
      for (const p of prepared.files) {
        const weight = a.variable ? p.weight : a.weight;
        const woffKey = `catalog/fonts/${fontId}/${weight}${a.italic ? "-italic" : ""}-${tag}.woff`;
        await putContractDocument(woffKey, p.data, "font/woff");
        // 변환본으로 다시 잰다(가변 서체는 고정한 굵기의 실제 폭·범위)
        const pa = analyzeFontFile(new Uint8Array(p.data), `${weight}.woff`);
        if (prepared.converted) converted++;
        added.push({
          weight,
          style: a.italic ? "italic" : "normal",
          storageKey: srcKey,
          woffKey,
          format: a.format,
          bytes: a.bytes,
          woffBytes: p.bytes,
          fileName: a.fileName.slice(0, 200),
          postscriptName: pa.postscriptName || a.postscriptName,
          outline: a.outline ?? "truetype",
          converted: prepared.converted,
          fromVariable: prepared.variable,
          uploadedAt: now,
          italic: a.italic,
          coverage: pa.errors.length ? a.coverage : pa.coverage,
          metrics: pa.errors.length ? a.metrics : pa.metrics,
          embed: a.embed,
        });
      }
    }

    // 같은 묶음에 같은 굵기가 둘이면 나중 파일(groupFamilies 가 경고)
    const unique = added.filter((x, i) => !added.slice(i + 1).some((y) => y.weight === x.weight && y.style === x.style));
    await withDbWrite(async (txn) => {
      const cur = fam.existingFontId ? rowsToObjects(await txn.exec("SELECT * FROM catalog_fonts WHERE font_id = $1 FOR UPDATE", [fontId]))[0] : null;
      const before = parse<StoredFile[]>(cur?.files, []);
      // 같은 굵기·꼴은 새 파일로 바꾼다(옛 저장소 파일은 남긴다 — 지난 PDF 재현)
      const merged = [...before.filter((b) => !unique.some((x) => x.weight === b.weight && x.style === b.style)), ...unique].sort((x, y) => x.weight - y.weight || x.style.localeCompare(y.style));
      const curMeta = parse<{ classification?: FontClass }>(cur?.metrics, {});
      const classification = opts.classification ?? curMeta.classification ?? fam.classification;
      const v = judgeFamily(
        merged.map((f) => ({ weight: f.weight, italic: f.style === "italic", coverage: f.coverage!, metrics: f.metrics!, embed: f.embed ?? "installable" })),
        ref,
        { classification }
      );
      const regular = merged.filter((f) => f.style === "normal").sort((x, y) => Math.abs(x.weight - 400) - Math.abs(y.weight - 400))[0] ?? merged[0];
      const metrics = { ...regular.metrics!, classification, reasons: v.reasons, noSubsetting: analyses.some((a) => a.noSubsetting) };
      const displayName = s(opts.displayName).trim().slice(0, 60) || s(cur?.display_name) || fam.displayName;
      if (cur) {
        await txn.run(
          `UPDATE catalog_fonts SET display_name = $2, files = $3::jsonb, roles_allowed = $4::jsonb, license_type = $5, license_note = $6, embed_policy = $7,
             coverage = $8::jsonb, metrics = $9::jsonb, size_adjust = $10::jsonb, uploaded_by = $11, uploaded_at = $12 WHERE font_id = $1`,
          [fontId, displayName, JSON.stringify(merged), JSON.stringify(v.roles), license.type, JSON.stringify(license), v.embed, JSON.stringify(v.coverage), JSON.stringify(metrics), JSON.stringify(v.sizeAdjust), actorUserId, now]
        );
      } else {
        await txn.run(
          `INSERT INTO catalog_fonts (font_id, family, display_name, source, files, roles_allowed, license_type, license_note, embed_policy, coverage, metrics, size_adjust, is_active, uploaded_by, uploaded_at)
           VALUES ($1, $2, $3, 'upload', $4::jsonb, $5::jsonb, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, 1, $12, $13)`,
          [fontId, fam.family, displayName, JSON.stringify(merged), JSON.stringify(v.roles), license.type, JSON.stringify(license), v.embed, JSON.stringify(v.coverage), JSON.stringify(metrics), JSON.stringify(v.sizeAdjust), actorUserId, now]
        );
      }
    });
    result.fonts.push({ fontId, displayName: s(opts.displayName).trim() || fam.displayName, weights: Array.from(new Set(unique.map((x) => x.weight))), created: !fam.existingFontId, converted });
  }
  return result;
}

/** 이름·분류·사용 여부 고치기. 분류를 장식체로 바꿔 본문 조건을 잃으면, 그 서체를 본문으로 쓰는 세트가 있을 때 막는다 */
export async function updateCatalogFont(fontId: string, patch: { displayName?: string; classification?: FontClass; isActive?: boolean }): Promise<CatalogFont> {
  const font = await getCatalogFont(fontId);
  if (!font || font.source !== "upload") throw new FontLibraryError("업로드 서체만 고칠 수 있습니다.", 404);
  const ref = await referenceFontMetrics();
  await withDbWrite(async (txn) => {
    const cur = rowsToObjects(await txn.exec("SELECT files, metrics FROM catalog_fonts WHERE font_id = $1 FOR UPDATE", [fontId]))[0];
    const files = parse<StoredFile[]>(cur?.files, []);
    const meta = parse<Record<string, unknown>>(cur?.metrics, {});
    const sets: string[] = [];
    let roles = font.roles;
    let reasons = font.reasons;
    if (patch.classification && patch.classification !== font.classification) {
      const v = judgeFamily(
        files.map((f) => ({ weight: f.weight, italic: f.style === "italic", coverage: f.coverage!, metrics: f.metrics!, embed: f.embed ?? "installable" })),
        ref,
        { classification: patch.classification }
      );
      if (!v.bodyCapable) {
        const rows = rowsToObjects(await txn.exec("SELECT name FROM catalog_font_sets WHERE body_font_id = $1", [fontId]));
        sets.push(...rows.map((r) => s(r.name)));
        if (sets.length) throw new FontLibraryError(`이 서체를 본문으로 쓰는 세트가 있어 '제목 전용'이 되게 바꿀 수 없습니다: ${sets.join(", ")}`);
      }
      roles = v.roles;
      reasons = v.reasons;
      meta.classification = patch.classification;
      meta.reasons = reasons;
    }
    const name = patch.displayName != null ? s(patch.displayName).trim().slice(0, 60) : null;
    await txn.run(
      `UPDATE catalog_fonts SET display_name = COALESCE(NULLIF($2, ''), display_name), roles_allowed = $3::jsonb, metrics = $4::jsonb,
         is_active = COALESCE($5, is_active) WHERE font_id = $1`,
      [fontId, name ?? "", JSON.stringify(roles), JSON.stringify(meta), patch.isActive == null ? null : patch.isActive ? 1 : 0]
    );
  });
  return (await getCatalogFont(fontId))!;
}

