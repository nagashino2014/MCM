import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { loadContractRows } from "@/lib/bid/package-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PostBody {
  contractIds?: string[];
}

// POST: 선택 계약들의 총괄표 행 미리보기(자동 생성 용역개요 포함) — 용역개요 보정 모달용
export async function POST(req: NextRequest) {
  try {
    await requirePermission("sales.view");
    const body = (await req.json().catch(() => ({}))) as PostBody;
    const contractIds = (Array.isArray(body.contractIds) ? body.contractIds : []).map(String).filter(Boolean);
    if (contractIds.length === 0) return NextResponse.json({ contracts: [] });
    if (contractIds.length > 100) {
      return NextResponse.json({ error: "계약은 한 번에 최대 100건까지 조회할 수 있습니다." }, { status: 400 });
    }
    const rows = await loadContractRows(contractIds);
    return NextResponse.json({
      contracts: rows.map((r) => ({
        contractId: r.contractId,
        serviceName: r.serviceName,
        category: r.category,
        overview: r.overview,
      })),
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
