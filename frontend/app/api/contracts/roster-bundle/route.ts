import JSZip from "jszip";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listCertificateDocs } from "@/lib/contracts/certificate-storage";
import {
  binaryResponse,
  loadBundles,
  mergePdfBytes,
  readStorageObject,
  sanitizeDownloadName,
} from "@/lib/contracts/document-bundle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * 명단+계약서 묶음: 계약별로 [수행인력 명단 PDF(S3 저장본 — 'PDF생성'으로 저장)]
 *  + [계약서/변경계약서/계산서(S3)] 를 순서대로 단일 PDF로 병합.
 * 증명서 없이 명단+계약서만 제출하는 실적보고용. 명단 PDF가 저장돼 있지 않은
 * 계약은 제외(+집계). 1건=단일 PDF, 복수=계약별 zip.
 */
export async function POST(req: NextRequest) {
  try {
    await requirePermission("contract.view");
    const body = (await req.json().catch(() => ({}))) as { contractIds?: string[] };
    const contractIds = [...new Set((body.contractIds ?? []).map((id) => String(id).trim()).filter(Boolean))];
    if (contractIds.length === 0) {
      return NextResponse.json({ error: "계약을 선택하세요." }, { status: 400 });
    }
    if (contractIds.length > 100) {
      return NextResponse.json({ error: "한 번에 최대 100건까지 생성할 수 있습니다." }, { status: 400 });
    }

    const rosters = await listCertificateDocs(contractIds, "roster_pdf");
    const bundles = await loadBundles(contractIds, { kind: "all" });
    const titleById = new Map(bundles.map((b) => [b.contractId, b.contractTitle]));

    const results: { title: string; pdf: Uint8Array }[] = [];
    let skipped = 0;

    for (const contractId of contractIds) {
      const roster = rosters[contractId];
      if (!roster?.storageKey) {
        skipped += 1; // 명단 PDF(S3 저장본) 필수
        continue;
      }
      const parts: Uint8Array[] = [await readStorageObject(roster.storageKey)];
      const bundle = bundles.find((b) => b.contractId === contractId);
      for (const file of bundle?.files ?? []) {
        parts.push(await readStorageObject(file.storageKey));
      }
      results.push({
        title: titleById.get(contractId) || contractId,
        pdf: await mergePdfBytes(parts),
      });
    }

    if (results.length === 0) {
      return NextResponse.json(
        { error: "명단 PDF가 저장된 계약이 없습니다. 수행실적 증명서 생성 카드의 ‘PDF생성’으로 먼저 명단을 저장하세요." },
        { status: 400 }
      );
    }

    if (results.length === 1) {
      return binaryResponse(results[0].pdf, "application/pdf", `명단+계약서(${results[0].title}).pdf`);
    }
    const zip = new JSZip();
    for (const r of results) {
      zip.file(`${sanitizeDownloadName(`명단+계약서(${r.title})`)}.pdf`, r.pdf);
    }
    const zipped = await zip.generateAsync({ type: "uint8array" });
    return binaryResponse(zipped, "application/zip", `명단+계약서_${new Date().toISOString().slice(0, 10)}.zip`);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
