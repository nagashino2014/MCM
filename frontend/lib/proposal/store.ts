import { randomUUID, createHash } from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import type { ProposalDocument, ProposalEdition, ProposalSummary, SavedProposal } from "./types";
import { ProposalError, PROPOSAL_IMAGE_MAX_BYTES, PROPOSAL_MAX_BYTES, validateImageDataUrl, validateProposalDocument, validateProposalForPublication, validateProposalId, validateRevision, rasterTargets } from "./validate";
import { validatePngBytes } from "./png";

type QueryResult = Array<{ columns: string[]; values: unknown[][] }>;
export interface ProposalDb {
  exec(sql: string, params?: unknown[]): Promise<QueryResult>;
  run(sql: string, params?: unknown[]): Promise<unknown>;
}
export interface ProposalStoreDeps {
  readDb: () => Promise<ProposalDb>;
  transaction: <T>(work: (db: ProposalDb) => Promise<T>) => Promise<T>;
  render: (document: ProposalDocument, figures: Record<string, string>) => Promise<Uint8Array>;
  decodeImage: (bytes: Buffer) => Promise<{ width: number; height: number }>;
}
const parsed = (v: unknown): unknown => typeof v === "string" ? JSON.parse(v) : v;
const now = () => new Date().toISOString();
const conflict = () => new ProposalError("다른 곳에서 먼저 수정했습니다. 입력을 보관한 뒤 최신 문서를 다시 불러와 주세요.", 409);
function editionOf(r: Record<string, unknown>): ProposalEdition {
  return { id: String(r.edition_id), revision: Number(r.revision), fileName: String(r.file_name), createdAt: String(r.created_at), sizeBytes: Number(r.size_bytes) };
}
const EDITION_FIELDS = "edition_id, revision, file_name, created_at, octet_length(hwpx_bytes) AS size_bytes";

/** 실제 DB와 순수 시험 모두 같은 저장·충돌·발행 흐름을 쓴다. */
export function createProposalStore(deps: ProposalStoreDeps) {
  async function get(id: string): Promise<SavedProposal> {
    validateProposalId(id);
    const db = await deps.readDb();
    const r = rowsToObjects(await db.exec("SELECT document, revision FROM proposal_documents WHERE document_id = $1", [id]))[0];
    if (!r) throw new ProposalError("제안서를 찾을 수 없습니다.", 404);
    return { document: validateProposalDocument(parsed(r.document)), rev: Number(r.revision) };
  }
  async function list(): Promise<ProposalSummary[]> {
    const db = await deps.readDb();
    const rows = rowsToObjects(await db.exec("SELECT document_id, document->>'title' AS title, document->>'client' AS client, document->>'projectName' AS project_name, document->>'templateId' AS template_id, revision, updated_at FROM proposal_documents ORDER BY updated_at DESC LIMIT 200"));
    return rows.map((r) => ({ id: String(r.document_id), title: String(r.title), client: String(r.client), projectName: String(r.project_name), templateId: r.template_id as ProposalSummary["templateId"], rev: Number(r.revision), updatedAt: String(r.updated_at) }));
  }
  async function create(input: unknown, revision: unknown, actor: string): Promise<SavedProposal> {
    if (validateRevision(revision) !== 0) throw new ProposalError("새 문서의 판 번호는 0이어야 합니다.");
    const document = validateProposalDocument(input);
    document.id = "prp_" + randomUUID().replace(/-/g, "");
    await deps.transaction(async (db) => {
      await db.run("INSERT INTO proposal_documents (document_id, document, revision, created_at, created_by, updated_at, updated_by) VALUES ($1, $2::jsonb, 1, $3, $4, $3, $4)", [document.id, JSON.stringify(document), now(), actor]);
    });
    return { document, rev: 1 };
  }
  async function save(id: string, input: unknown, revision: unknown, actor: string): Promise<SavedProposal> {
    validateProposalId(id); const rev = validateRevision(revision); const document = validateProposalDocument(input);
    if (document.id !== id) throw new ProposalError("문서 ID가 요청 주소와 다릅니다.");
    return deps.transaction(async (db) => {
      const r = rowsToObjects(await db.exec("SELECT revision, document->>'templateId' AS template_id FROM proposal_documents WHERE document_id = $1 FOR UPDATE", [id]))[0];
      if (!r) throw new ProposalError("제안서를 찾을 수 없습니다.", 404);
      if (Number(r.revision) !== rev) throw conflict();
      if (r.template_id !== document.templateId) throw new ProposalError("문서의 템플릿 종류는 바꿀 수 없습니다. 새 문서를 만들어 주세요.");
      await db.run("UPDATE proposal_documents SET document = $2::jsonb, revision = revision + 1, updated_at = $3, updated_by = $4 WHERE document_id = $1", [id, JSON.stringify(document), now(), actor]);
      return { document, rev: rev + 1 };
    });
  }
  async function listEditions(id: string): Promise<ProposalEdition[]> {
    await get(id);
    const db = await deps.readDb();
    return rowsToObjects(await db.exec(`SELECT ${EDITION_FIELDS} FROM proposal_editions WHERE document_id = $1 ORDER BY created_at DESC LIMIT 100`, [id])).map(editionOf);
  }
  async function checkedImage(dataUrl: unknown, widthMm: number, heightMm: number, label: string, pngOnly: boolean): Promise<string> {
    const value = validateImageDataUrl(dataUrl, pngOnly);
    const bytes = Buffer.from(value.slice(value.indexOf(",") + 1), "base64");
    if (bytes.length > PROPOSAL_IMAGE_MAX_BYTES) throw new ProposalError(`${label}: 그림 용량이 8 MB를 넘습니다.`, 422);
    if (pngOnly && (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")) throw new ProposalError(`${label}: PNG 파일을 인식하지 못했습니다.`, 422);
    if (bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") {
      if (bytes.length < 24) throw new ProposalError(`${label}: PNG 헤더를 읽지 못했습니다.`, 422);
      const pixels = bytes.readUInt32BE(16) * bytes.readUInt32BE(20);
      if (pixels < 1 || pixels > 30_000_000) throw new ProposalError(`${label}: 그림 픽셀 수가 허용 범위를 벗어났습니다.`, 422);
    }
    validatePngBytes(bytes);
    let size: { width: number; height: number };
    try { size = await deps.decodeImage(bytes); } catch { throw new ProposalError(`${label}: 그림 파일을 읽지 못했습니다.`, 422); }
    if (size.width < 1 || size.height < 1 || size.width * size.height > 30_000_000) throw new ProposalError(`${label}: 그림 크기를 확인해 주세요.`, 422);
    if (Math.abs((size.width / size.height) / (widthMm / heightMm) - 1) > 0.04) throw new ProposalError(`${label}: 그림과 삽입 영역의 가로세로 비율이 다릅니다.`, 422);
    if (Math.min(size.width / widthMm, size.height / heightMm) * 25.4 < 149) throw new ProposalError(`${label}: 150 dpi 이상의 그림으로 내보내 주세요.`, 422);
    return value;
  }
  async function publish(id: string, revision: unknown, inputFigures: unknown, actor: string): Promise<ProposalEdition> {
    const rev = validateRevision(revision); const saved = await get(id);
    if (saved.rev !== rev) throw conflict();
    const document = saved.document; validateProposalForPublication(document);
    if (!inputFigures || typeof inputFigures !== "object" || Array.isArray(inputFigures)) throw new ProposalError("도식 그림 목록을 확인해 주세요.");
    const input = inputFigures as Record<string, unknown>; const figures: Record<string, string> = Object.create(null);
    // 도식·인포그래픽 PNG와 표지(·간지) 배경 그림 — 문서에 있는 대상만, 빠짐없이 받는다.
    const targets = rasterTargets(document);
    const figureIds = new Set(targets.map((t) => t.id));
    if (Object.keys(input).some((key) => !figureIds.has(key))) throw new ProposalError("현재 문서에 없는 도식 그림이 포함되어 있습니다.", 422);
    for (const t of targets) {
      if (!Object.hasOwn(input, t.id)) throw new ProposalError(`${t.label}: 도식 그림을 다시 생성해 주세요.`, 422);
      figures[t.id] = await checkedImage(input[t.id], t.widthMm, t.heightMm, t.label, true);
    }
    for (const b of document.sections.flatMap((s) => s.blocks)) if (b.kind === "image") await checkedImage(b.dataUrl, b.widthMm, b.heightMm, b.title || b.id, false);
    const figureJson = JSON.stringify(figures);
    if (Buffer.byteLength(figureJson) + Buffer.byteLength(JSON.stringify(document)) > PROPOSAL_MAX_BYTES) throw new ProposalError("문서와 도식 그림의 합계가 30 MB를 넘습니다.", 413);
    const hwpx = Buffer.from(await deps.render(document, figures));
    if (hwpx.length < 4 || hwpx.subarray(0, 2).toString() !== "PK" || hwpx.length > PROPOSAL_MAX_BYTES) throw new ProposalError("HWPX 생성 결과를 확인하지 못했습니다.", 422);
    const edition: ProposalEdition = { id: "pre_" + randomUUID().replace(/-/g, ""), revision: rev, fileName: `${document.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 100) || "제안서"}_v${rev}.hwpx`, createdAt: now(), sizeBytes: hwpx.length };
    await deps.transaction(async (db) => {
      const r = rowsToObjects(await db.exec("SELECT revision FROM proposal_documents WHERE document_id = $1 FOR UPDATE", [id]))[0];
      if (!r) throw new ProposalError("제안서를 찾을 수 없습니다.", 404);
      if (Number(r.revision) !== rev) throw conflict();
      // 편집이 렌더 중 바뀌었으면 위에서 거절한다. 원본·그림·산출물은 같은 트랜잭션으로 고정한다.
      await db.run("INSERT INTO proposal_editions (edition_id, document_id, revision, document_snapshot, figure_snapshot, hwpx_bytes, hwpx_sha256, file_name, created_at, created_by) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10)", [edition.id, id, rev, JSON.stringify(document), figureJson, hwpx, createHash("sha256").update(hwpx).digest("hex"), edition.fileName, edition.createdAt, actor]);
    });
    return edition;
  }
  async function download(id: string, editionId: string): Promise<{ edition: ProposalEdition; bytes: Buffer }> {
    validateProposalId(id); validateProposalId(editionId);
    const db = await deps.readDb();
    const r = rowsToObjects(await db.exec(`SELECT ${EDITION_FIELDS}, hwpx_bytes, hwpx_sha256 FROM proposal_editions WHERE document_id = $1 AND edition_id = $2`, [id, editionId]))[0];
    if (!r) throw new ProposalError("발행본을 찾을 수 없습니다.", 404);
    const bytes = Buffer.from(r.hwpx_bytes as Uint8Array);
    if (createHash("sha256").update(bytes).digest("hex") !== r.hwpx_sha256) throw new ProposalError("발행본 파일의 무결성을 확인하지 못했습니다.", 500);
    return { edition: editionOf(r), bytes };
  }
  return { get, list, create, save, listEditions, publish, download };
}

export const proposalStore = createProposalStore({
  readDb: getDb,
  transaction: (work) => withDbWrite(work),
  render: async (document, figures) => (await import("./hwpx")).renderProposalHwpx(document, figures),
  decodeImage: async (bytes) => {
    const { loadImage } = await import("@napi-rs/canvas"); const image = await loadImage(bytes);
    return { width: image.width, height: image.height };
  },
});
export type ProposalStore = ReturnType<typeof createProposalStore>;
