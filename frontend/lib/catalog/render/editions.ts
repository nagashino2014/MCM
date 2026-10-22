import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { MASTER_DOC_ID } from "@/lib/catalog/projects";
import { renderHtmlPdf, type PrintWarning } from "@/lib/print-kit/converter";
import { putContractDocument, readContractDocument, sanitizeFilename } from "@/lib/storage/contract-document-storage";
import { loadCatalogRenderData } from "./data";
import { buildCatalogHtml } from "./html";
import { EDITION_LABEL, NAMING_LABEL, type RenderOptions } from "./types";

/*
 * 회사소개서 PDF 생성본 — 309 catalog_editions 에 이력을 남기고 파일은 문서 저장소 catalogs/{YYYY}/{edition_id}/ 에 둔다.
 * P4 에서 만드는 것은 '생성본'(options.stage = generated)이다. 발행 확정(대외 제출 이력·반영 대기 해소)은 P7 몫이라
 * 여기서는 확정하지 않는다 — published_at 칸에는 생성 시각을 적는다(칸 이름은 309 그대로).
 */

export interface CatalogEditionSummary {
  editionId: string;
  docId: string;
  stage: string;
  edition: string;
  naming: string;
  label: string;
  pages: number;
  warnings: PrintWarning[];
  notices: string[];
  sizeBytes: number;
  renderMs: number;
  totalMs: number;
  fileName: string;
  createdAt: string;
  createdByName: string;
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

function mapEdition(r: Record<string, unknown>): CatalogEditionSummary {
  const options = parse(r.options);
  const map = parse(r.page_map);
  return {
    editionId: s(r.edition_id),
    docId: s(r.doc_id),
    stage: s(options.stage) || "generated",
    edition: s(options.edition) || "print",
    naming: s(options.naming) || "masked",
    label: `${EDITION_LABEL[(s(options.edition) || "print") as "print"] ?? ""} · ${NAMING_LABEL[(s(options.naming) || "masked") as "masked"] ?? ""}`,
    pages: Number(map.pages ?? 0),
    warnings: (Array.isArray(map.warnings) ? map.warnings : []) as PrintWarning[],
    notices: (Array.isArray(map.notices) ? map.notices : []) as string[],
    sizeBytes: Number(map.sizeBytes ?? 0),
    renderMs: Number(map.renderMs ?? 0),
    totalMs: Number(map.totalMs ?? 0),
    fileName: s(map.fileName),
    createdAt: s(r.published_at),
    createdByName: s(r.created_by_name),
  };
}

export async function listCatalogEditions(docId = MASTER_DOC_ID, limit = 20): Promise<CatalogEditionSummary[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT e.edition_id, e.doc_id, e.options, e.page_map, e.published_at, COALESCE(u.name, '') AS created_by_name
         FROM catalog_editions e LEFT JOIN users u ON u.user_id = e.published_by
        WHERE e.doc_id = $1 ORDER BY e.published_at DESC LIMIT $2`,
      [docId, limit]
    )
  );
  return rows.map(mapEdition);
}

export async function getCatalogEditionFile(editionId: string): Promise<{ summary: CatalogEditionSummary; pdf: Buffer } | null> {
  const db = await getDb();
  const r = rowsToObjects(
    await db.exec(
      `SELECT e.*, COALESCE(u.name, '') AS created_by_name FROM catalog_editions e LEFT JOIN users u ON u.user_id = e.published_by WHERE e.edition_id = $1`,
      [s(editionId)]
    )
  )[0];
  if (!r?.pdf_key) return null;
  const pdf = await readContractDocument(s(r.pdf_key));
  return pdf ? { summary: mapEdition(r), pdf } : null;
}

/** 마스터본 PDF 생성 → 저장 → 이력. 돌려주는 값 = 이력 요약(쪽 수·넘침 경고·크기·시간). */
export async function generateCatalogPdf(opts: RenderOptions, actorUserId: string | null, docId = MASTER_DOC_ID): Promise<CatalogEditionSummary> {
  const started = Date.now();
  const data = await loadCatalogRenderData({ ...opts, docId });
  const built = await buildCatalogHtml(data, { ...opts, target: "print" });
  const rendered = await renderHtmlPdf({ html: built.html, assets: built.assets });
  const totalMs = Date.now() - started;

  const editionId = "ced_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const ymd = data.asOf.replace(/-/g, "");
  const fileName = sanitizeFilename(`회사소개서_${ymd}_${NAMING_LABEL[opts.naming]}${opts.edition === "draft" ? "_작업본" : ""}.pdf`) || `catalog_${ymd}.pdf`;
  const storageKey = ["catalogs", data.asOf.slice(0, 4), editionId, fileName].join("/");
  await putContractDocument(storageKey, rendered.pdf, "application/pdf");

  const db = await getDb();
  const version = Number(rowsToObjects(await db.exec("SELECT current_version FROM catalog_documents WHERE doc_id = $1", [docId]))[0]?.current_version ?? 0);
  const now = new Date().toISOString();
  const metrics = Object.fromEntries(Object.values(data.metrics).map((m) => [m.id, m.value]));
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
  await withDbWrite(async (txn) => {
    await txn.run(
      `INSERT INTO catalog_editions (edition_id, doc_id, version, options, data_snapshot, fingerprint, pdf_key, page_map, published_by, published_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, '{}'::jsonb, $6, $7::jsonb, $8, $9)`,
      [
        editionId,
        docId,
        version,
        JSON.stringify({ stage: "generated", edition: opts.edition, naming: opts.naming, cover: built.cover.cover, coverPhoto: Boolean(built.cover.photo), fontSet: data.theme.fontSet }),
        JSON.stringify({
          asOf: data.asOf,
          metrics,
          appendix: { shownRows: data.appendix.shownRows, shownContracts: data.appendix.shownContracts, hiddenContracts: data.appendix.hiddenContracts },
          rules: data.rules,
        }),
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
    label: `${EDITION_LABEL[opts.edition]} · ${NAMING_LABEL[opts.naming]}`,
    pages: rendered.pages,
    warnings: rendered.warnings,
    notices: built.notices,
    sizeBytes: rendered.pdf.length,
    renderMs: rendered.renderMs,
    totalMs,
    fileName,
    createdAt: now,
    createdByName: "",
  };
}
