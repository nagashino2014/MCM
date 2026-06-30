import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { listSignedCertificates } from "@/lib/contracts/certificate-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 선택한 계약들의 서명 증명서(S3) 첨부 여부를 한 번에 조회 → { [contractId]: { fileName } }
export async function POST(req: NextRequest) {
  try {
    await requireAuthenticated();
    const body = (await req.json().catch(() => ({}))) as { contractIds?: string[] };
    const map = await listSignedCertificates(body.contractIds ?? []);
    const out: Record<string, { fileName: string }> = {};
    for (const [id, v] of Object.entries(map)) out[id] = { fileName: v.displayName };
    return NextResponse.json({ signed: out });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
