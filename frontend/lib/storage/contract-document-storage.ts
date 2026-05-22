import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getS3Client } from "@/lib/storage/logo-storage";

export interface StoredContractDocument {
  storageProvider: "local" | "s3";
  storageBucket: string | null;
  storageKey: string;
  publicPath: string;
}

/**
 * Mirror of the V:\계약 layout used by the legacy Excel workbook so the
 * S3 keys read like the local network drive paths the team is used to.
 *
 *   계약서:       contracts/documents/{YYYY}/(YYYY-MM-DD) {계약명}/(YYYY-MM-DD){계약명} 계약서.pdf
 *   변경계약서:    contracts/documents/{YYYY}/(YYYY-MM-DD) {계약명}/(YYYY-MM-DD){계약명} 변경계약서.pdf
 *   세금계산서:    contracts/invoices/{YYYY}/Q{N}/(YYYY-MM-DD){계약명} {단계명} 세금계산서.pdf
 *
 * The contract folder name is keyed off the *contract* date so that an
 * amendment uploaded later still lands in the original contract folder.
 */

const PATH_UNSAFE_RE = /[\\/:*?"<>|\x00-\x1f]+/g;

/**
 * Normalize a string for use as a file or folder name. Korean characters,
 * spaces, parentheses, dashes, and commas are preserved so that the keys
 * round-trip cleanly with the V: drive layout. Only path-unsafe characters
 * (\ / : * ? " < > | and control bytes) are collapsed to `_`.
 */
export function sanitizePathSegment(value: string): string {
  if (!value) return "";
  const normalized = value.normalize("NFKC").replace(PATH_UNSAFE_RE, "_").trim();
  // Collapse repeated whitespace while keeping single internal spaces.
  return normalized.replace(/\s+/g, " ");
}

/**
 * Legacy export: the previous version was much more aggressive (stripped
 * all whitespace) and is still referenced by older call sites for backwards
 * compatibility. New code should prefer `sanitizePathSegment`.
 */
export function sanitizeFilename(filename: string): string {
  const cleaned = sanitizePathSegment(filename);
  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw new Error("잘못된 파일명입니다.");
  }
  return cleaned.slice(0, 200);
}

function parseIsoDate(value: string, fieldLabel: string): Date {
  const date = new Date(value + "T00:00:00");
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldLabel}이 올바르지 않습니다.`);
  }
  return date;
}

/**
 * Build the canonical filename (without folder) for a contract document
 * (계약서/변경계약서). Always returns the form `(YYYY-MM-DD){title} {kind}.pdf`.
 */
export function buildContractDocumentFileName(
  date: string,
  contractTitle: string,
  docType: "contract" | "amendment"
): string {
  const title = sanitizePathSegment(contractTitle);
  const kind = docType === "amendment" ? "변경계약서" : "계약서";
  return sanitizeFilename(`(${date})${title} ${kind}.pdf`);
}

/**
 * Build the canonical filename for a tax invoice (세금계산서). The stage
 * label may be empty for invoices that pre-date the milestone schema.
 */
export function buildInvoiceFileName(
  issueDate: string,
  contractTitle: string,
  stageLabel: string | null | undefined
): string {
  const title = sanitizePathSegment(contractTitle);
  const stage = sanitizePathSegment(stageLabel ?? "").trim();
  const middle = stage ? ` ${stage}` : "";
  return sanitizeFilename(`(${issueDate})${title}${middle} 세금계산서.pdf`);
}

/**
 * S3 key for a contract document. The folder name is derived from the
 * *contract* date so amendments live alongside the original contract pdf.
 */
export function getContractDocumentStorageKey(params: {
  contractDate: string;
  documentDate: string;
  contractTitle: string;
  docType: "contract" | "amendment";
}): { storageKey: string; fileName: string; folderName: string } {
  const contractDate = parseIsoDate(params.contractDate, "계약일자");
  const year = String(contractDate.getFullYear());
  const folderName = sanitizePathSegment(`(${params.contractDate}) ${params.contractTitle}`);
  const fileName = buildContractDocumentFileName(
    params.documentDate,
    params.contractTitle,
    params.docType
  );
  const storageKey = ["contracts", "documents", year, folderName, fileName].join("/");
  return { storageKey, fileName, folderName };
}

export function getInvoiceStorageKey(params: {
  issueDate: string;
  contractTitle: string;
  stageLabel: string | null | undefined;
}): { storageKey: string; fileName: string } {
  const date = parseIsoDate(params.issueDate, "계산서 발행일");
  const year = String(date.getFullYear());
  const quarter = "Q" + (Math.floor(date.getMonth() / 3) + 1);
  const fileName = buildInvoiceFileName(params.issueDate, params.contractTitle, params.stageLabel);
  const storageKey = ["contracts", "invoices", year, quarter, fileName].join("/");
  return { storageKey, fileName };
}

export async function putContractDocument(
  storageKey: string,
  body: Buffer,
  contentType: string
): Promise<StoredContractDocument> {
  const localRoot = process.env.CONTRACT_DOCUMENT_STORAGE_ROOT?.trim();
  if (localRoot) {
    const target = path.resolve(localRoot, storageKey);
    const root = path.resolve(localRoot);
    if (!target.startsWith(root + path.sep)) {
      throw new Error("문서 저장 경로가 올바르지 않습니다.");
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
    return {
      storageProvider: "local",
      storageBucket: null,
      storageKey,
      publicPath: "/api/contracts/documents?key=" + encodeURIComponent(storageKey),
    };
  }

  const bucket = process.env.MCM_STORAGE_BUCKET?.trim();
  if (!bucket) {
    throw new Error("CONTRACT_DOCUMENT_STORAGE_ROOT 또는 MCM_STORAGE_BUCKET 환경변수가 필요합니다.");
  }
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: storageKey,
      Body: body,
      ContentType: contentType,
      CacheControl: "private, max-age=86400",
    })
  );
  return {
    storageProvider: "s3",
    storageBucket: bucket,
    storageKey,
    publicPath: "/api/contracts/documents?key=" + encodeURIComponent(storageKey),
  };
}
