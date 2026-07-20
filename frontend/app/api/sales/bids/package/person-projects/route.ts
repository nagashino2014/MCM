import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { loadPersonProjects } from "@/lib/bid/package-data";
import type { StaffConfig } from "@/lib/bid/package-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PostBody {
  employeeId?: string;
  perfFilter?: StaffConfig["perfFilter"] | null;
  excluded?: string[];
}

// POST: 실적 미리보기 — 현재 수행실적 설정(perfFilter) 기준으로 해당 인력의 개별 이력에
// 들어갈 실적 목록을 반환한다(제외 목록은 제외하지 않고 화면에서 표시·토글하도록 전체 반환).
export async function POST(req: NextRequest) {
  try {
    await requirePermission("sales.view");
    const body = (await req.json().catch(() => ({}))) as PostBody;
    const employeeId = String(body.employeeId ?? "").trim();
    if (!employeeId) {
      return NextResponse.json({ error: "employeeId 가 필요합니다." }, { status: 400 });
    }
    const projects = await loadPersonProjects(employeeId, body.perfFilter ?? null);
    return NextResponse.json({ projects });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
