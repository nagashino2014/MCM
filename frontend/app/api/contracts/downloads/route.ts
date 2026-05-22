import { readFile } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";
import { getS3Client } from "@/lib/storage/logo-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DownloadMode = "individualZip" | "mergedSingle" | "perContractMergedZip" | "mergedAll";
type DownloadScope =
  | { kind: "all" }
  | { kind: "contract" }
  | { kind: "amendment" }
  | { kind: "invoice"; milestoneId: string };

interface DownloadRequestBody {
  contractIds?: string[];
  mode?: DownloadMode;
  scope?: DownloadScope;
}

interface ContractBundle {
  contractId: string;
  contractTitle: string;
  contractDate: string;
  files: DownloadFile[];
}

interface DownloadFile {
  storageKey: string;
  displayName: string;
  sortOrder: number;
  documentType: "contract" | "amendment" | "invoice";
  milestoneId: string | null;
}

export async function POST(req: NextRequest) {
  try {
    await requireAuthenticated();
    const body = (await req.json()) as DownloadRequestBody;
    const contractIds = [...new Set((body.contractIds ?? []).map((id) => String(id).trim()).filter(Boolean))];
    const mode = body.mode ?? "individualZip";
    const scope = body.scope ?? { kind: "all" };

    if (contractIds.length === 0) {
      return NextResponse.json({ error: "다운로드할 계약을 선택하세요." }, { status: 400 });
    }
    if (mode === "mergedSingle" && contractIds.length !== 1) {
      return NextResponse.json({ error: "단일 병합은 계약 1건만 선택할 수 있습니다." }, { status: 400 });
    }
    if (contractIds.length > 100) {
      return NextResponse.json({ error: "한 번에 최대 100건까지 다운로드할 수 있습니다." }, { status: 400 });
    }

    const bundles = await loadBundles(contractIds, scope);
    const files = bundles.flatMap((bundle) => bundle.files);
    if (files.length === 0) {
      return NextResponse.json({ error: "다운로드할 PDF 파일이 없습니다." }, { status: 404 });
    }

    if (mode === "mergedSingle" || mode === "mergedAll") {
      const merged = await mergeFiles(bundles);
      const fileName = mode === "mergedSingle"
        ? `${bundles[0].contractTitle}_증빙자료.pdf`
        : `선택계약_증빙자료.pdf`;
      return binaryResponse(merged, "application/pdf", fileName);
    }

    const zip = new JSZip();
    if (mode === "perContractMergedZip") {
      for (const bundle of bundles) {
        if (bundle.files.length === 0) continue;
        const merged = await mergeFiles([bundle]);
        zip.file(`${sanitizeDownloadName(bundle.contractTitle)}_증빙자료.pdf`, merged);
      }
    } else {
      for (const bundle of bundles) {
        const folder = zip.folder(sanitizeDownloadName(bundle.contractTitle));
        for (const file of bundle.files) {
          folder?.file(sanitizeDownloadName(file.displayName), await readStorageObject(file.storageKey));
        }
      }
    }

    const zipped = await zip.generateAsync({ type: "uint8array" });
    return binaryResponse(zipped, "application/zip", `계약증빙_${new Date().toISOString().slice(0, 10)}.zip`);
  } catch (err) {
    return authErrorToResponse(err);
  }
}

async function loadBundles(contractIds: string[], scope: DownloadScope): Promise<ContractBundle[]> {
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

function matchesScope(file: DownloadFile, scope: DownloadScope): boolean {
  if (scope.kind === "all") return true;
  if (scope.kind === "contract") return file.documentType === "contract";
  if (scope.kind === "amendment") return file.documentType === "amendment";
  return file.documentType === "invoice" && file.milestoneId === scope.milestoneId;
}

async function mergeFiles(bundles: ContractBundle[]): Promise<Uint8Array> {
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

async function readStorageObject(storageKey: string): Promise<Uint8Array> {
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

function binaryResponse(body: Uint8Array, contentType: string, fileName: string): NextResponse {
  return new NextResponse(Buffer.from(body), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(sanitizeDownloadName(fileName))}`,
      "Cache-Control": "private, max-age=0, no-store",
    },
  });
}

function sanitizeDownloadName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160) || "download";
}
