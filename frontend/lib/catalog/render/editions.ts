import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { MASTER_DOC_ID } from "@/lib/catalog/projects";
import { renderHtmlPdf, type PrintWarning } from "@/lib/print-kit/converter";
import { putContractDocument, readContractDocument, sanitizeFilename } from "@/lib/storage/contract-document-storage";
import { loadStudioDoc } from "@/lib/catalog/studio/store";
import { computeCatalogFingerprint, resolvePendingByEdition, runCatalogRefresh } from "@/lib/catalog/refresh/service";
import { loadCatalogRenderData } from "./data";
import { buildCatalogHtml } from "./html";
import { EDITION_LABEL, NAMING_LABEL, SCOPE_LABEL, type EditionKind, type NamingMode, type RenderOptions, type ScopeMode } from "./types";

/*
 * 회사소개서 PDF 생성본·발행본 — 309 catalog_editions 에 이력을 남기고 파일은 문서 저장소 catalogs/{YYYY}/{edition_id}/ 에 둔다.
 *   생성본(options.stage = generated, P4): 미리보기·검토용. 데이터가 바뀌면 새로 만든다.
 *   발행본(options.stage = published, P7): 대외 배포본 확정. PDF·데이터 스냅샷·원천 지문·서체·쪽 지도를 고정 보관한다
 *     — 이후 데이터가 바뀌어도 같은 파일을 받는다. 발행하면 열린 반영 대기가 이 발행본으로 해소되고, 이 지문이 다음 비교 기준이 된다.
 *   발행 = 인쇄·배포본 생성본을 그대로 승격(검토한 PDF 가 곧 배포본). 대화상자의 [발행]은 만들기 + 승격을 한 번에 한다(넘침이 있으면 확인 후).
 * published_at = 생성본은 만든 때, 발행본은 발행한 때(만든 때는 options.generatedAt).
 */

export type EditionStage = "generated" | "published";

export interface CatalogDistribution {
  distId: string;
  recipient: string;
  purpose: string;
  givenOn: string;
  note: string;
  createdAt: string;
  createdByName: string;
}

export interface CatalogEditionSummary {
  editionId: string;
  docId: string;
  stage: EditionStage;
  edition: EditionKind;
  naming: NamingMode;
  scope: ScopeMode;
  label: string;
  pages: number;
  warnings: PrintWarning[];
  notices: string[];
  sizeBytes: number;
  renderMs: number;
  totalMs: number;
  fileName: string;
  /** 생성본 = 만든 때, 발행본 = 발행한 때 */
  createdAt: string;
  createdByName: string;
  /** 발행본이 만들어진 때(승격 전 생성 시각) */
  generatedAt: string;
  /** 발행 때 해소한 반영 대기 건수 */
  resolvedCount: number;
  /** 데이터 기준일 */
  asOf: string;
  distributions: CatalogDistribution[];
}

const s = (v: unknown): string => (v == null ? "" : String(v).trim());
const parse = (v: unknown): Record<string, unknown> => {
  if (v == null) return {};
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return v as Record<string, unknown>;
};

export function editionLabel(stage: EditionStage, edition: EditionKind, naming: NamingMode, scope: ScopeMode): string {
  // 발행본은 언제나 인쇄·배포본이라 범위·이름만 적는다
  if (stage === "published") return `${SCOPE_LABEL[scope]} · ${NAMING_LABEL[naming]}`;
  return [EDITION_LABEL[edition], ...(scope === "summary" ? [SCOPE_LABEL.summary] : []), NAMING_LABEL[naming]].join(" · ");
}

function mapEdition(r: Record<string, unknown>, dists: CatalogDistribution[] = []): CatalogEditionSummary {
  const options = parse(r.options);
  const map = parse(r.page_map);
  const snap = parse(r.snapshot_head);
  const stage: EditionStage = s(options.stage) === "published" ? "published" : "generated";
  const edition: EditionKind = s(options.edition) === "draft" ? "draft" : "print";
  const naming: NamingMode = s(options.naming) === "real" ? "real" : "masked";
  const scope: ScopeMode = s(options.scope) === "summary" ? "summary" : "full";
  return {
    editionId: s(r.edition_id),
    docId: s(r.doc_id),
    stage,
    edition,
    naming,
    scope,
    label: editionLabel(stage, edition, naming, scope),
    pages: Number(map.pages ?? 0),
    warnings: (Array.isArray(map.warnings) ? map.warnings : []) as PrintWarning[],
    notices: (Array.isArray(map.notices) ? map.notices : []) as string[],
    sizeBytes: Number(map.sizeBytes ?? 0),
    renderMs: Number(map.renderMs ?? 0),
    totalMs: Number(map.totalMs ?? 0),
    fileName: s(map.fileName),
    createdAt: s(r.published_at),
    createdByName: s(r.created_by_name),
    generatedAt: s(options.generatedAt) || s(r.published_at),
    resolvedCount: Number(options.resolvedCount ?? 0),
    asOf: s(snap.asOf),
    distributions: dists,
  };
}

const EDITION_SELECT = `SELECT e.edition_id, e.doc_id, e.options, e.page_map, e.published_at, e.pdf_key,
        jsonb_build_object('asOf', e.data_snapshot->'asOf') AS snapshot_head, COALESCE(u.name, '') AS created_by_name
   FROM catalog_editions e LEFT JOIN users u ON u.user_id = e.published_by`;

async function loadDistributions(editionIds: string[]): Promise<Map<string, CatalogDistribution[]>> {
  const out = new Map<string, CatalogDistribution[]>();
  if (!editionIds.length) return out;
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT d.*, COALESCE(u.name, '') AS created_by_name FROM catalog_edition_distributions d LEFT JOIN users u ON u.user_id = d.created_by
        WHERE d.edition_id = ANY($1::text[]) ORDER BY COALESCE(d.given_on, d.created_at) DESC, d.created_at DESC`,
      [editionIds]
    )
  );
  for (const r of rows) {
    const id = s(r.edition_id);
    if (!out.has(id)) out.set(id, []);
    out.get(id)!.push({
      distId: s(r.dist_id),
      recipient: s(r.recipient),
      purpose: s(r.purpose),
      givenOn: s(r.given_on),
      note: s(r.note),
      createdAt: s(r.created_at),
      createdByName: s(r.created_by_name),
    });
  }
  return out;
}

/** 목록 — stage 를 주면 그 단계만. withDistributions 는 발행본 목록(관리·발행 담당) 용 */
export async function listCatalogEditions(
  docId = MASTER_DOC_ID,
  limit = 20,
  opts: { stage?: EditionStage; withDistributions?: boolean } = {}
): Promise<CatalogEditionSummary[]> {
  const db = await getDb();
  const stageWhere = opts.stage === "published" ? `AND e.options->>'stage' = 'published'` : opts.stage === "generated" ? `AND COALESCE(e.options->>'stage', 'generated') <> 'published'` : "";
  const rows = rowsToObjects(await db.exec(`${EDITION_SELECT} WHERE e.doc_id = $1 ${stageWhere} ORDER BY e.published_at DESC LIMIT $2`, [docId, limit]));
  const dists = opts.withDistributions ? await loadDistributions(rows.map((r) => s(r.edition_id))) : new Map();
  return rows.map((r) => mapEdition(r, dists.get(s(r.edition_id)) ?? []));
}

export async function getCatalogEdition(editionId: string): Promise<(CatalogEditionSummary & { pdfKey: string }) | null> {
  const db = await getDb();
  const r = rowsToObjects(await db.exec(`${EDITION_SELECT} WHERE e.edition_id = $1`, [s(editionId)]))[0];
  if (!r) return null;
  return { ...mapEdition(r, (await loadDistributions([s(r.edition_id)])).get(s(r.edition_id)) ?? []), pdfKey: s(r.pdf_key) };
}

export async function getCatalogEditionFile(editionId: string): Promise<{ summary: CatalogEditionSummary; pdf: Buffer } | null> {
  const hit = await getCatalogEdition(editionId);
  if (!hit?.pdfKey) return null;
  const pdf = await readContractDocument(hit.pdfKey);
  return pdf ? { summary: hit, pdf } : null;
}

/**
 * PDF 생성 → 저장 → 이력(생성본). 스튜디오 편집본(쪽 순서·숨김·편집층)을 얹는다.
 * 원천 지문·데이터 스냅샷을 함께 남겨 그대로 발행(승격)할 수 있게 한다. 돌려주는 값 = 이력 요약(쪽 수·넘침 경고·크기·시간).
 */
export async function generateCatalogPdf(opts: RenderOptions, actorUserId: string | null, docId = MASTER_DOC_ID): Promise<CatalogEditionSummary> {
  const started = Date.now();
  const scope: ScopeMode = opts.scope === "summary" ? "summary" : "full";
  const [data, studio, fingerprint] = await Promise.all([loadCatalogRenderData({ ...opts, docId }), loadStudioDoc(docId), computeCatalogFingerprint()]);
  const built = await buildCatalogHtml(data, { ...opts, scope, target: "print", pages: studio?.pages ?? [] });
  const rendered = await renderHtmlPdf({ html: built.html, assets: built.assets });
  const totalMs = Date.now() - started;

  const editionId = "ced_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const ymd = data.asOf.replace(/-/g, "");
  const fileName =
    sanitizeFilename(`회사소개서_${ymd}_${NAMING_LABEL[opts.naming]}${scope === "summary" ? "_요약본" : ""}${opts.edition === "draft" ? "_작업본" : ""}.pdf`) ||
    `catalog_${ymd}.pdf`;
  const storageKey = ["catalogs", data.asOf.slice(0, 4), editionId, fileName].join("/");
  await putContractDocument(storageKey, rendered.pdf, "application/pdf");

  const db = await getDb();
  const version = Number(rowsToObjects(await db.exec("SELECT current_version FROM catalog_documents WHERE doc_id = $1", [docId]))[0]?.current_version ?? 0);
  const now = new Date().toISOString();
  const pageMap = {
    pages: rendered.pages,
    anchors: rendered.anchors,
    warnings: rendered.warnings,
    notices: built.notices,
    sizeBytes: rendered.pdf.length,
    renderMs: rendered.renderMs,
    totalMs,
    fileName,
    title: built.title,
  };
  // 데이터 스냅샷 = 그린 데이터 그대로(마스킹판 이름 가리기용 실명 목록만 뺀다). 발행본 재현·대조용 — 화면에는 기준일·지표만 쓴다.
  const { maskNames: _omit, ...snapshot } = data;
  void _omit;
  await withDbWrite(async (txn) => {
    await txn.run(
      `INSERT INTO catalog_editions (edition_id, doc_id, version, options, data_snapshot, fingerprint, pdf_key, page_map, published_by, published_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8::jsonb, $9, $10)`,
      [
        editionId,
        docId,
        version,
        JSON.stringify({
          stage: "generated",
          edition: opts.edition,
          naming: opts.naming,
          scope,
          cover: built.cover.cover,
          coverPhoto: Boolean(built.cover.photo),
          fontSet: built.fontSet,
          fonts: built.fonts,
          concept: data.theme.concept,
          studioRev: studio?.rev ?? null,
        }),
        JSON.stringify(snapshot),
        JSON.stringify(fingerprint),
        storageKey,
        JSON.stringify(pageMap),
        actorUserId,
        now,
      ]
    );
  });
  return {
    editionId,
    docId,
    stage: "generated",
    edition: opts.edition,
    naming: opts.naming,
    scope,
    label: editionLabel("generated", opts.edition, opts.naming, scope),
    pages: rendered.pages,
    warnings: rendered.warnings,
    notices: built.notices,
    sizeBytes: rendered.pdf.length,
    renderMs: rendered.renderMs,
    totalMs,
    fileName,
    createdAt: now,
    createdByName: "",
    generatedAt: now,
    resolvedCount: 0,
    asOf: data.asOf,
    distributions: [],
  };
}

export class EditionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * 생성본 → 발행본(승격). 인쇄·배포본만 발행할 수 있다(작업본은 초안 표시가 남는다).
 * 열린 반영 대기를 이 발행본으로 해소한 뒤, 이 발행본 지문을 기준으로 바로 다시 점검한다
 * — 만든 뒤 발행 전까지 바뀐 데이터는 새 반영 대기로 남는다(알림 없이).
 */
export async function publishCatalogEdition(editionId: string, actorUserId: string | null): Promise<CatalogEditionSummary> {
  const db = await getDb();
  const r = rowsToObjects(await db.exec("SELECT edition_id, doc_id, options, published_at, fingerprint FROM catalog_editions WHERE edition_id = $1", [s(editionId)]))[0];
  if (!r) throw new EditionError("생성본을 찾을 수 없습니다.", 404);
  const options = parse(r.options);
  if (s(options.stage) === "published") throw new EditionError("이미 발행한 판입니다.", 409);
  if (s(options.edition) === "draft") throw new EditionError("작업본은 발행할 수 없습니다. 인쇄·배포본으로 만든 PDF 를 발행하세요.", 400);
  const fp = parse(r.fingerprint);
  if (fp.v !== 1) throw new EditionError("원천 지문이 없는 옛 생성본입니다. 새로 만들어 발행하세요.", 400);
  const docId = s(r.doc_id);
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    await txn.run(
      `UPDATE catalog_editions
          SET options = options || jsonb_build_object('stage', 'published', 'generatedAt', $2::text, 'publishedAt', $3::text, 'generatedBy', COALESCE(published_by, '')),
              published_at = $3, published_by = $4
        WHERE edition_id = $1`,
      [s(editionId), s(r.published_at), now, actorUserId]
    );
  });
  const resolved = await resolvePendingByEdition(docId, s(editionId));
  await withDbWrite(async (txn) => {
    await txn.run(`UPDATE catalog_editions SET options = options || jsonb_build_object('resolvedCount', $2::int) WHERE edition_id = $1`, [s(editionId), resolved]);
  });
  try {
    await runCatalogRefresh({ docId, notify: false });
  } catch (e) {
    console.warn(`[catalog-publish] 발행 뒤 점검 실패(다음 tick 에 다시 본다): ${e instanceof Error ? e.message : String(e)}`);
  }
  const out = await getCatalogEdition(editionId);
  if (!out) throw new EditionError("발행본을 다시 읽지 못했습니다.", 500);
  const { pdfKey: _k, ...summary } = out;
  void _k;
  return summary;
}

export async function addDistribution(
  editionId: string,
  input: { recipient?: unknown; purpose?: unknown; givenOn?: unknown; note?: unknown },
  actorUserId: string | null
): Promise<string> {
  const recipient = s(input.recipient).slice(0, 200);
  if (!recipient) throw new EditionError("받은 곳을 적어 주세요.", 400);
  const givenOn = s(input.givenOn);
  // CdDateInput 과 같은 판정 — 형식(YYYY-MM-DD)과 달력에 있는 날인지
  const [y, m, d] = givenOn.split("-").map(Number);
  const real = /^\d{4}-\d{2}-\d{2}$/.test(givenOn) && new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === givenOn;
  if (givenOn && !real) throw new EditionError("낸 날은 YYYY-MM-DD 로, 달력에 있는 날짜로 적어 주세요.", 400);
  const db = await getDb();
  const ed = rowsToObjects(await db.exec("SELECT options->>'stage' AS stage FROM catalog_editions WHERE edition_id = $1", [s(editionId)]))[0];
  if (!ed) throw new EditionError("발행본을 찾을 수 없습니다.", 404);
  if (s(ed.stage) !== "published") throw new EditionError("배포 기록은 발행본에만 남깁니다.", 400);
  const distId = "cdd_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  await withDbWrite(async (txn) => {
    await txn.run(
      `INSERT INTO catalog_edition_distributions (dist_id, edition_id, recipient, purpose, given_on, note, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [distId, s(editionId), recipient, s(input.purpose).slice(0, 200) || null, givenOn || null, s(input.note).slice(0, 1000) || null, actorUserId, new Date().toISOString()]
    );
  });
  return distId;
}

export async function deleteDistribution(editionId: string, distId: string): Promise<void> {
  await withDbWrite(async (txn) => {
    await txn.run("DELETE FROM catalog_edition_distributions WHERE dist_id = $1 AND edition_id = $2", [s(distId), s(editionId)]);
  });
}
