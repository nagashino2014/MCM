import JSZip from "jszip";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { getContractRoster } from "@/lib/staffing/roster";
import { renderRosterPdf } from "@/lib/staffing/roster-pdf";
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
 * 통합묶음: 계약별로 [서명 증명서 PDF(클라이언트 업로드, 세션 한정)]
 *  + [수행인력 명단 PDF(현재 데이터로 새로 렌더 — staleness 방지)]
 *  + [계약서/변경계약서/계산서(S3)] 를 순서대로 단일 PDF로 병합.
 * 서명 증명서가 없는 계약은 제외(+집계). 1건=단일 PDF, 복수=계약별 zip.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAuthenticated();
    const form = await req.formData();
    let contractIds: string[] = [];
    try {
      contractIds = JSON.parse(String(form.get("contractIds") ?? "[]"));
    } catch {
      contractIds = [];
    }
    contractIds = [...new Set(contractIds.map((id) => String(id).trim()).filter(Boolean))];
    if (contractIds.length === 0) {
      return NextResponse.json({ error: "계약을 선택하세요." }, { status: 400 });
    }
    if (contractIds.length > 100) {
      return NextResponse.json({ error: "한 번에 최대 100건까지 생성할 수 있습니다." }, { status: 400 });
    }

    const bundles = await loadBundles(contractIds, { kind: "all" });
    const titleById = new Map(bundles.map((b) => [b.contractId, b.contractTitle]));

    const results: { title: string; pdf: Uint8Array }[] = [];
    let skipped = 0;

    for (const contractId of contractIds) {
      const signed = form.get(`file_${contractId}`);
      if (!(signed instanceof File)) {
        skipped += 1; // 서명 증명서 필수
        continue;
      }
      const parts: Uint8Array[] = [new Uint8Array(await signed.arrayBuffer())];
      const roster = await getContractRoster(contractId);
      if (roster) parts.push(await renderRosterPdf(roster));
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
        { error: "서명된 증명서가 첨부된 계약이 없습니다. 계약 목록에서 증명서 PDF를 먼저 첨부하세요." },
        { status: 400 }
      );
    }

    if (results.length === 1) {
      return binaryResponse(results[0].pdf, "application/pdf", `증명서묶음(${results[0].title}).pdf`);
    }
    const zip = new JSZip();
    for (const r of results) {
      zip.file(`${sanitizeDownloadName(`증명서묶음(${r.title})`)}.pdf`, r.pdf);
    }
    const zipped = await zip.generateAsync({ type: "uint8array" });
    return binaryResponse(zipped, "application/zip", `증명서묶음_${new Date().toISOString().slice(0, 10)}.zip`);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
