import { readFile } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { PDFDocument } from "pdf-lib";
import { NextResponse } from "next/server";
import { getDb, rowsToObjects } from "@/lib/db";
import { getS3Client } from "@/lib/storage/logo-storage";

/*
 * 계약 증빙(계약서/변경계약서/계산서) 묶음 로드·병합·다운로드 공용 헬퍼.
 * 다운로드 API와 증명서 API가 공유한다. (downloads/route.ts 에서 추출 — 동작 불변)
 */

export type DownloadScope =
  | { kind: "all" }
  | { kind: "contract" }
  | { kind: "amendment" }
  | { kind: "invoice"; milestoneId: string };

export interface DownloadFile {
  storageKey: string;
  displayName: string;
  sortOrder: number;
  documentType: "contract" | "amendment" | "invoice";
  milestoneId: string | null;
}

export interface ContractBundle {
  contractId: string;
  contractTitle: string;
  contractDate: string;
  files: DownloadFile[];
}

export async function loadBundles(
  contractIds: string[],
  scope: DownloadScope
): Promise<ContractBundle[]> {
  const db = await getDb();
  const contracts = rowsToObjects(
    await db.exec(
      `SELECT contract_id, contract_title, COALESCE(NULLIF(contract_date, ''), started_at, created_at) AS contract_date
       FROM contracts
       WHERE contract_id = ANY($1::text[])
       ORDER BY COALESCE(NULLIF(contract_date, ''), started_at, created_at) ASC NULLS LAST, contract_title ASC`,
      [contractIds]
    )
  );
  if (contracts.length === 0) return [];

  const docs = rowsToObjects(
    await db.exec(
      `SELECT document_id, contract_id, milestone_id, document_type, display_name, storage_key, created_at
       FROM contract_documents
       WHERE contract_id = ANY($1::text[])
         AND document_type IN ('contract', 'amendment')
       ORDER BY
         CASE document_type WHEN 'contract' THEN 1 WHEN 'amendment' THEN 2 ELSE 9 END,
         created_at ASC`,
      [contractIds]
    )
  );
  const invoices = rowsToObjects(
    await db.exec(
      `SELECT d.document_id, d.contract_id, d.milestone_id, d.display_name, d.storage_key,
              m.stage_order, m.stage_label, i.issue_date, i.created_at
       FROM contract_invoices i
       JOIN contract_documents d ON d.document_id = i.document_id
       LEFT JOIN contract_payment_milestones m ON m.milestone_id = i.milestone_id
       WHERE i.contract_id = ANY($1::text[])
       ORDER BY COALESCE(m.stage_order, 9999) ASC, i.issue_date ASC, i.created_at ASC`,
      [contractIds]
    )
  );

  return contracts.map((contract) => {
    const contractId = String(contract.contract_id ?? "");
    const files: DownloadFile[] = [];
    for (const doc of docs.filter((item) => String(item.contract_id ?? "") === contractId)) {
      const documentType = String(doc.document_type ?? "") as "contract" | "amendment";
      files.push({
        storageKey: String(doc.storage_key ?? ""),
        displayName: String(doc.display_name ?? `${documentType}.pdf`),
        sortOrder: documentType === "contract" ? 100 : 200,
        documentType,
        milestoneId: doc.milestone_id != null ? String(doc.milestone_id) : null,
      });
    }
    for (const invoice of invoices.filter((item) => String(item.contract_id ?? "") === contractId)) {
      const stageOrder = Number(invoice.stage_order ?? 9999);
      files.push({
        storageKey: String(invoice.storage_key ?? ""),
        displayName: String(invoice.display_name ?? `${String(invoice.stage_label ?? "계산서")}.pdf`),
        sortOrder: 1000 + stageOrder,
        documentType: "invoice",
        milestoneId: invoice.milestone_id != null ? String(invoice.milestone_id) : null,
      });
    }

    return {
      contractId,
      contractTitle: String(contract.contract_title ?? contractId),
      contractDate: String(contract.contract_date ?? ""),
      files: files
        .filter((file) => file.storageKey && matchesScope(file, scope))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName, "ko")),
    };
  });
}

export function matchesScope(file: DownloadFile, scope: DownloadScope): boolean {
  if (scope.kind === "all") return true;
  if (scope.kind === "contract") return file.documentType === "contract";
  if (scope.kind === "amendment") return file.documentType === "amendment";
  return file.documentType === "invoice" && file.milestoneId === scope.milestoneId;
}

export async function mergeFiles(bundles: ContractBundle[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (const bundle of bundles) {
    for (const file of bundle.files) {
      const source = await PDFDocument.load(await readStorageObject(file.storageKey), { ignoreEncryption: true });
      const pages = await merged.copyPages(source, source.getPageIndices());
      for (const page of pages) merged.addPage(page);
    }
  }
  return merged.save();
}

/** 이미 메모리에 있는 여러 PDF 바이트를 순서대로 단일 PDF로 병합. */
export async function mergePdfBytes(parts: Uint8Array[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (const part of parts) {
    if (!part || part.length === 0) continue;
    const source = await PDFDocument.load(part, { ignoreEncryption: true });
    const pages = await merged.copyPages(source, source.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  return merged.save();
}

export async function readStorageObject(storageKey: string): Promise<Uint8Array> {
  if (!storageKey || storageKey.includes("..") || storageKey.startsWith("/") || storageKey.startsWith("\\")) {
    throw new Error("문서 키가 올바르지 않습니다.");
  }
  const localRoot = process.env.CONTRACT_DOCUMENT_STORAGE_ROOT?.trim();
  if (localRoot) {
    const root = path.resolve(localRoot);
    const target = path.resolve(root, storageKey);
    if (!target.startsWith(root + path.sep)) throw new Error("문서 키가 올바르지 않습니다.");
    return readFile(target);
  }

  const bucket = process.env.MCM_STORAGE_BUCKET?.trim();
  if (!bucket) throw new Error("문서 저장소 환경변수가 설정되지 않았습니다.");
  const out = await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: storageKey }));
  if (!out.Body) throw new Error("문서를 읽을 수 없습니다.");
  const body = out.Body as unknown;
  if (typeof (body as { transformToByteArray?: unknown }).transformToByteArray === "function") {
    return (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
  }
  if (typeof (body as ReadableStream<Uint8Array>).getReader === "function") {
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    return concatChunks(chunks);
  }
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array | Buffer>) {
    chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
  }
  return concatChunks(chunks);
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

export function binaryResponse(body: Uint8Array, contentType: string, fileName: string): NextResponse {
  return new NextResponse(Buffer.from(body), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(sanitizeDownloadName(fileName))}`,
      "Cache-Control": "private, max-age=0, no-store",
    },
  });
}

export function sanitizeDownloadName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160) || "download";
}
