import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { resolveVisibleContractIds } from "@/lib/auth/contract-scope";
import { listCertificateDocs, listSignedCertificates } from "@/lib/contracts/certificate-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 선택한 계약들의 서명 증명서/명단 PDF(S3) 저장 여부를 한 번에 조회
// → { signed: { [contractId]: { fileName } }, rosters: { [contractId]: { fileName } } }
// 가시 범위(contract.view scope) 밖의 계약 id 는 결과에서 제외한다(X-02, 2026-10-19).
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission("contract.view");
    const body = (await req.json().catch(() => ({}))) as { contractIds?: string[] };
    let contractIds = (body.contractIds ?? []).map(String);
    const visible = await resolveVisibleContractIds(ctx.userId, "contract.view");
    if (visible) {
      const allowed = new Set(visible);
      contractIds = contractIds.filter((id) => allowed.has(id));
    }
    const [signedMap, rosterMap] = await Promise.all([
      listSignedCertificates(contractIds),
      listCertificateDocs(contractIds, "roster_pdf"),
    ]);
    const signed: Record<string, { fileName: string }> = {};
    for (const [id, v] of Object.entries(signedMap)) signed[id] = { fileName: v.displayName };
    const rosters: Record<string, { fileName: string }> = {};
    for (const [id, v] of Object.entries(rosterMap)) rosters[id] = { fileName: v.displayName };
    return NextResponse.json({ signed, rosters });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
