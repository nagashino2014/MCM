import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { listCertificateDocs, listSignedCertificates } from "@/lib/contracts/certificate-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 선택한 계약들의 서명 증명서/명단 PDF(S3) 저장 여부를 한 번에 조회
// → { signed: { [contractId]: { fileName } }, rosters: { [contractId]: { fileName } } }
export async function POST(req: NextRequest) {
  try {
    await requireAuthenticated();
    const body = (await req.json().catch(() => ({}))) as { contractIds?: string[] };
    const contractIds = body.contractIds ?? [];
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
