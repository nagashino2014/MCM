import { createHash, randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { lockAccountingWrite } from "./write-lock";

export const VAT_FILING_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export interface VatFilingDocument {
  documentId: string;
  subjectId: string;
  requestId: string;
  uploaderUserId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  evidenceRef: `vat-document:${string}`;
  evidenceHash: string;
  createdAt: string;
}
export interface UploadVatFilingDocumentInput {
  subjectId: string;
  requestId: string;
  fileName: string;
  contentType: string;
  bytes: Buffer;
}
const columns = "document_id,subject_id,request_id,uploader_user_id,file_name,content_type,size_bytes,content_sha256,created_at";
const fail = (message: string, status = 400, code = "vat_filing_document_input") => Object.assign(new Error(message), { status, code });
const unavailable = () => fail("신고 증빙 보관 자료구조 또는 원문 무결성을 확인할 수 없습니다. 231 적용 상태와 보관 자료를 확인하세요.", 503, "vat_filing_document_unavailable");
const validId = (value: unknown): value is string => typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function translate(error: unknown): never {
  const e = error as { code?: string; status?: number };
  // A caller-owned transaction must restart as a whole after a serialization conflict.
  if (["40001", "40P01"].includes(String(e.code))) throw error;
  if (e.status) throw error;
  if (["42P01", "42703", "42883", "42501"].includes(String(e.code))) throw unavailable();
  if (["23505", "23514", "23503"].includes(String(e.code))) throw fail("신고 증빙의 요청 식별자·주체·보관 제약이 맞지 않습니다.", 409, "vat_filing_document_conflict");
  throw unavailable();
}
function text(bytes: Buffer, encoding = "utf-8"): string {
  try {
    const value = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw Error();
    return value;
  } catch { throw fail("증빙 텍스트의 문자 인코딩을 확인할 수 없습니다."); }
}

// XLSX의 ZIP 디렉터리와 필수 XML만 검사한다. 수식 실행·외부 참조 열기·원문 재저장은 하지 않는다.
function validateXlsx(bytes: Buffer) {
  try {
    let end = bytes.length - 22;
    const minimum = Math.max(0, bytes.length - 65557);
    while (end >= minimum && bytes.readUInt32LE(end) !== 0x06054b50) end--;
    if (end < minimum || end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length || bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0) throw Error();
    const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
    if (!count || count > 4096 || bytes.readUInt16LE(end + 8) !== count || start + size !== end) throw Error();
    const entries = new Map<string, { start: number; size: number; inflated: number; method: number }>();
    let cursor = start, inflatedTotal = 0;
    for (let i = 0; i < count; i++) {
      if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) throw Error();
      const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10), compressed = bytes.readUInt32LE(cursor + 20), inflated = bytes.readUInt32LE(cursor + 24);
      const nameLength = bytes.readUInt16LE(cursor + 28), extra = bytes.readUInt16LE(cursor + 30), comment = bytes.readUInt16LE(cursor + 32), local = bytes.readUInt32LE(cursor + 42);
      if ((flags & 1) || ![0, 8].includes(method) || cursor + 46 + nameLength + extra + comment > end || local + 30 > start || bytes.readUInt32LE(local) !== 0x04034b50) throw Error();
      const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
      if (entries.has(name) || name.includes("\\") || name.startsWith("/") || name.split("/").includes("..") || /vbaProject\.bin$/i.test(name)) throw Error();
      const localNameLength = bytes.readUInt16LE(local + 26), body = local + 30 + localNameLength + bytes.readUInt16LE(local + 28);
      if (body + compressed > start || bytes.readUInt16LE(local + 8) !== method || bytes.readUInt16LE(local + 6) !== flags || !bytes.subarray(local + 30, local + 30 + localNameLength).equals(bytes.subarray(cursor + 46, cursor + 46 + nameLength))) throw Error();
      inflatedTotal += inflated;
      if (inflatedTotal > 100 * 1024 * 1024) throw Error();
      entries.set(name, { start: body, size: compressed, inflated, method });
      cursor += 46 + nameLength + extra + comment;
    }
    if (cursor !== end || !entries.has("_rels/.rels") || ![...entries.keys()].some(n => /^xl\/worksheets\/sheet[^/]*\.xml$/.test(n))) throw Error();
    const xml = (name: string) => {
      const e = entries.get(name);
      if (!e || !e.inflated || e.inflated > 1024 * 1024) throw Error();
      const data = bytes.subarray(e.start, e.start + e.size);
      const unpacked = e.method === 0 ? data : inflateRawSync(data, { maxOutputLength: 1024 * 1024 });
      if (unpacked.length !== e.inflated) throw Error();
      return text(unpacked);
    };
    if (!xml("[Content_Types].xml").includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml") || !/<(?:\w+:)?workbook(?:\s|>)/.test(xml("xl/workbook.xml"))) throw Error();
  } catch { throw fail("암호화되지 않은 유효한 XLSX 증빙 파일이 필요합니다."); }
}

function validateFile(input: UploadVatFilingDocumentInput): string {
  if (typeof input.fileName !== "string" || !input.fileName.trim() || input.fileName.trim() !== input.fileName || input.fileName.length > 200 || /[\u0000-\u001f\u007f/\\]/.test(input.fileName) || /[\uD800-\uDFFF]/u.test(input.fileName)) throw fail("증빙 파일 이름이 올바르지 않습니다.");
  if (!Buffer.isBuffer(input.bytes) || input.bytes.length === 0 || input.bytes.length > VAT_FILING_DOCUMENT_MAX_BYTES) throw fail("증빙 파일은 비어 있지 않은 10 MiB 이하 파일이어야 합니다.");
  const extension = input.fileName.split(".").at(-1)?.toLowerCase();
  const mime: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", json: "application/json", csv: "text/csv", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  const csvMime = ["text/csv", "application/csv", "application/vnd.ms-excel", "text/plain", ""];
  if (!extension || !mime[extension] || (extension === "csv" ? !csvMime.includes(input.contentType) : input.contentType !== mime[extension])) throw fail("PDF·JPEG·PNG·JSON·CSV·XLSX 파일의 이름과 형식이 일치해야 합니다.");
  const bytes = input.bytes;
  if (extension === "pdf" && !(bytes.subarray(0, 8).toString("ascii").match(/^%PDF-\d\.\d/) && /%%EOF\s*$/.test(bytes.subarray(-1024).toString("latin1")))) throw fail("유효한 PDF 증빙 파일이 필요합니다.");
  if (["jpg", "jpeg"].includes(extension) && !(bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9)) throw fail("유효한 JPEG 증빙 파일이 필요합니다.");
  if (extension === "png" && !(bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.subarray(12, 16).toString("ascii") === "IHDR" && bytes.subarray(-8, -4).toString("ascii") === "IEND")) throw fail("유효한 PNG 증빙 파일이 필요합니다.");
  if (extension === "json") { try { JSON.parse(text(bytes)); } catch { throw fail("유효한 UTF-8 JSON 증빙 파일이 필요합니다."); } }
  if (extension === "csv") {
    let value: string;
    try { value = text(bytes); } catch { try { value = text(bytes, "euc-kr"); } catch { throw fail("CSV 증빙은 유효한 UTF-8 또는 CP949 텍스트여야 합니다."); } }
    if (!value.trim() || /^\s*(?:<!doctype\s+html|<html\b|<\?xml\b|%PDF-)/i.test(value)) throw fail("CSV 증빙 파일의 내용을 확인하세요.");
    // 문자열을 저장용 CSV로 다시 만들지 않는다. 인코딩·인용부호만 확인하고 원문을 보관한다.
    let quoted = false, afterQuote = false, fieldStart = true;
    for (let i = 0; i < value.length; i++) {
      const c = value[i];
      if (quoted) { if (c === '"') { if (value[i + 1] === '"') i++; else { quoted = false; afterQuote = true; } } continue; }
      if ([",", ";", "\t", "\r", "\n"].includes(c)) { fieldStart = true; afterQuote = false; continue; }
      if (afterQuote || (c === '"' && !fieldStart)) throw fail("CSV 증빙의 인용부호 형식이 올바르지 않습니다.");
      if (c === '"') quoted = true;
      fieldStart = false;
    }
    if (quoted) throw fail("CSV 증빙의 인용부호가 닫히지 않았습니다.");
  }
  if (extension === "xlsx") validateXlsx(bytes);
  return mime[extension];
}
function metadata(row: Record<string, unknown>): VatFilingDocument {
  const sizeBytes = Number(row.size_bytes), createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? "");
  if (![row.document_id, row.subject_id, row.request_id, row.uploader_user_id].every(validId) || !Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > VAT_FILING_DOCUMENT_MAX_BYTES || !/^[a-f0-9]{64}$/.test(String(row.content_sha256)) || !createdAt) throw unavailable();
  return { documentId: String(row.document_id), subjectId: String(row.subject_id), requestId: String(row.request_id), uploaderUserId: String(row.uploader_user_id), fileName: String(row.file_name), contentType: String(row.content_type), sizeBytes, evidenceRef: `vat-document:${row.document_id}`, evidenceHash: String(row.content_sha256), createdAt };
}
function verified(row: Record<string, unknown>): VatFilingDocument & { bytes: Buffer } {
  const document = metadata(row), bytes = row.content_bytes;
  if (!Buffer.isBuffer(bytes) || bytes.length !== document.sizeBytes || sha256(bytes) !== document.evidenceHash) throw unavailable();
  return { ...document, bytes };
}

export async function uploadVatFilingDocument(input: UploadVatFilingDocumentInput, actor: string): Promise<VatFilingDocument & { replayed: boolean }> {
  if (!input || !validId(input.subjectId) || !validId(input.requestId) || !validId(actor)) throw fail("주체·요청 식별자·담당자가 올바르지 않습니다.");
  const contentType = validateFile(input);
  // 호출자가 비동기 대기 중 Buffer를 바꿔도 보관 원문이 달라지지 않도록 입력을 복사한다.
  const value = { ...input, contentType, bytes: Buffer.from(input.bytes) }, evidenceHash = sha256(value.bytes);
  for (let attempt = 0; ; attempt++) {
    try {
      return await withDbWrite(async db => {
        await lockAccountingWrite(db);
        const old = rowsToObjects(await db.exec(`SELECT ${columns},content_bytes FROM vat_filing_documents WHERE request_id=$1`, [value.requestId]))[0];
        if (old) {
          const doc = verified(old);
          if (doc.uploaderUserId !== actor || doc.subjectId !== value.subjectId || doc.fileName !== value.fileName || doc.contentType !== value.contentType || doc.evidenceHash !== evidenceHash || !doc.bytes.equals(value.bytes)) throw fail("같은 요청 식별자에 다른 담당자 또는 증빙 내용이 있습니다.", 409, "vat_filing_document_conflict");
          const { bytes: _bytes, ...result } = doc;
          return { ...result, replayed: true };
        }
        if (!rowsToObjects(await db.exec("SELECT subject_id FROM vat_filing_subjects WHERE subject_id=$1 FOR KEY SHARE", [value.subjectId])).length) throw fail("신고 주체를 먼저 등록하세요. 미확인 주체도 등록할 수 있습니다.", 404, "vat_filing_subject_missing");
        const id = `vfd-${randomUUID()}`;
        const row = rowsToObjects(await db.exec(`INSERT INTO vat_filing_documents(document_id,subject_id,request_id,uploader_user_id,file_name,content_type,size_bytes,content_sha256,content_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${columns}`, [id, value.subjectId, value.requestId, actor, value.fileName, value.contentType, value.bytes.length, evidenceHash, value.bytes]))[0];
        const result = metadata(row);
        await recordAuditLogInline(db, { actorUserId: actor, action: "finance_vat_filing_basis", targetTable: "vat_filing_documents", targetId: id, after: { action: "document_upload", ...result } });
        return { ...result, replayed: false };
      }, { accountingSnapshot: true });
    } catch (error) {
      if (attempt < 2 && ["40001", "40P01"].includes(String((error as { code?: string }).code))) continue;
      return translate(error);
    }
  }
}

export async function listVatFilingDocuments(subjectId: string, db?: PgDatabase): Promise<VatFilingDocument[]> {
  if (!validId(subjectId)) throw fail("신고 주체 식별자가 올바르지 않습니다.");
  try {
    const tx = db ?? await getDb();
    // 빈 목록에서도 bytea 필수 열 누락을 정상 빈 결과로 처리하지 않는다. 원문 행은 가져오지 않는다.
    await tx.exec("SELECT content_bytes FROM vat_filing_documents WHERE FALSE");
    const documents = rowsToObjects(await tx.exec(`SELECT ${columns} FROM vat_filing_documents WHERE subject_id=$1 ORDER BY created_at DESC,document_id`, [subjectId]));
    if (!rowsToObjects(await tx.exec("SELECT subject_id FROM vat_filing_subjects WHERE subject_id=$1", [subjectId])).length) throw fail("신고 주체를 찾을 수 없습니다.", 404, "vat_filing_subject_missing");
    return documents.map(metadata);
  } catch (error) { return translate(error); }
}

export async function readVatFilingDocument(documentId: string, subjectId?: string, db?: PgDatabase): Promise<VatFilingDocument & { bytes: Buffer }> {
  if (!validId(documentId) || (subjectId !== undefined && !validId(subjectId))) throw fail("신고 증빙·주체 식별자가 올바르지 않습니다.");
  try {
    const row = rowsToObjects(await (db ?? await getDb()).exec(`SELECT ${columns},content_bytes FROM vat_filing_documents WHERE document_id=$1`, [documentId]))[0];
    if (!row) throw fail("신고 증빙을 찾을 수 없습니다.", 404, "vat_filing_document_missing");
    if (subjectId !== undefined && row.subject_id !== subjectId) throw fail("선택한 신고 주체의 증빙이 아닙니다.", 403, "vat_filing_document_subject_mismatch");
    return verified(row);
  } catch (error) { return translate(error); }
}

/** 기존 근거 저장 트랜잭션의 db를 받아 주체와 보관 원문의 지문을 검증한다. */
export async function requireVatFilingDocument(documentId: string, subjectId: string, db: PgDatabase): Promise<VatFilingDocument> {
  if (!validId(subjectId)) throw fail("신고 주체 식별자가 올바르지 않습니다.");
  const { bytes: _bytes, ...document } = await readVatFilingDocument(documentId, subjectId, db);
  return document;
}
