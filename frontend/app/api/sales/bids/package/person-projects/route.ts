import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { requireEmployeeScope } from "@/lib/auth/scope-guards";
import { hasGlobalScope } from "@/lib/auth/rbac";
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
    const ctx = await requirePermission("sales.view");
    const body = (await req.json().catch(() => ({}))) as PostBody;
    const employeeId = String(body.employeeId ?? "").trim();
    if (!employeeId) {
      return NextResponse.json({ error: "employeeId 가 필요합니다." }, { status: 400 });
    }
    // 직원 수행 이력은 영업 전사 범위(입찰 패키지 작성자) 또는 수행인력 실적 범위(staffing.record.view) 안에서만(2026-10-19 §7.7)
    if (!(await hasGlobalScope(ctx.userId, "sales.view"))) {
      await requireEmployeeScope("staffing.record.view", employeeId);
    }
    const projects = await loadPersonProjects(employeeId, body.perfFilter ?? null);
    return NextResponse.json({ projects });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
