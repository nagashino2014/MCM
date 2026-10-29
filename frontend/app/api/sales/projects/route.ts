import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { loadUserAccess } from "@/lib/auth/rbac";
import { filterBoardProjects, parseBoardFilter } from "@/lib/sales/board";
import { createSalesProject } from "@/lib/sales/queries";
import { listVisibleSalesProjects } from "@/lib/sales/visible-projects";
import type {
  SalesProjectFilter,
  SalesProjectInput,
  SalesProjectPriority,
  SalesProjectStatus,
  SalesStage,
} from "@/lib/sales/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("sales.view");
    const sp = req.nextUrl.searchParams;
    const access = await loadUserAccess(ctx.userId);

    // Salesboard 목록(limit 지정, 2026-10-29) — 검색·담당·연도·지역권·업종분류·KPI·도달 단계 필터와 쪽 나눔을 서버에서 한다.
    //   판정은 lib/sales/board.ts(예전 화면 판정 그대로)라 태그 건수·건수가 화면 계산과 같다. 응답은 한 쪽 분량만.
    if (sp.has("limit")) {
      const visible = await listVisibleSalesProjects(access);
      const { rows, regionCounts, categoryCounts } = filterBoardProjects(visible, parseBoardFilter(sp));
      const limit = Math.min(200, Math.max(1, Math.floor(Number(sp.get("limit")) || 50)));
      let offset = Math.max(0, Math.floor(Number(sp.get("offset")) || 0));
      // 결과가 줄어 쪽이 비면 마지막 쪽(useClientPaging 과 같은 동작)
      if (offset > 0 && offset >= rows.length) offset = Math.max(0, Math.floor((rows.length - 1) / limit) * limit);
      return NextResponse.json({
        projects: rows.slice(offset, offset + limit),
        total: rows.length,
        offset,
        visibleTotal: visible.length,
        regionCounts,
        categoryCounts,
      });
    }

    // 그 밖(연결 선택기·모바일 등) — 기존 응답 그대로(전건)
    const filter: SalesProjectFilter = {
      facilityId: sp.get("facilityId") || undefined,
      stage: (sp.get("stage") as SalesStage) || undefined,
      ownerEmployeeId: sp.get("ownerEmployeeId") || undefined,
      status: (sp.get("status") as SalesProjectStatus) || undefined,
      q: sp.get("q") || undefined,
    };
    const projects = await listVisibleSalesProjects(access, filter);
    return NextResponse.json({ projects });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const body = (await req.json()) as Partial<SalesProjectInput>;
    const facilityId = (body.facilityId ?? "").trim();
    const title = (body.title ?? "").trim();
    if (!facilityId || !title) {
      return NextResponse.json({ error: "사업장과 제목은 필수입니다." }, { status: 400 });
    }
    const input: SalesProjectInput = {
      facilityId,
      title,
      stage: body.stage ?? "lead",
      ownerEmployeeId: body.ownerEmployeeId ?? null,
      ownerDeptId: body.ownerDeptId ?? null,
      contractId: body.contractId ?? null,
      serviceCategory: body.serviceCategory ?? null,
      serviceSubcategory: body.serviceSubcategory ?? null,
      expectedAmount: body.expectedAmount ?? null,
      priority: (body.priority as SalesProjectPriority) ?? "normal",
      status: (body.status as SalesProjectStatus) ?? "open",
      openedAt: body.openedAt ?? null,
      closedAt: body.closedAt ?? null,
      memo: body.memo ?? null,
    };
    const projectId = await createSalesProject(input, ctx.userId || null);
    return NextResponse.json({ projectId }, { status: 201 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
