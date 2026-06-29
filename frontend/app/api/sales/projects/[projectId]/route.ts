import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import {
  computeProjectKpi,
  deleteSalesProject,
  getSalesProject,
  updateSalesProject,
} from "@/lib/sales/queries";
import type { SalesProjectInput, SalesProjectPriority, SalesProjectStatus, SalesStage } from "@/lib/sales/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    await requirePermission("sales.view", { target: { projectId } });
    const project = await getSalesProject(projectId);
    if (!project) {
      return NextResponse.json({ error: "영업 프로젝트를 찾을 수 없습니다." }, { status: 404 });
    }
    const kpi = await computeProjectKpi(projectId);
    return NextResponse.json({ project, kpi });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    await requirePermission("sales.edit", { target: { projectId }, fallbackRoles: ["editor"] });
    const body = (await req.json()) as Partial<SalesProjectInput>;
    const facilityId = (body.facilityId ?? "").trim();
    const title = (body.title ?? "").trim();
    if (!facilityId || !title) {
      return NextResponse.json({ error: "사업장과 제목은 필수입니다." }, { status: 400 });
    }
    const input: SalesProjectInput = {
      facilityId,
      title,
      stage: (body.stage as SalesStage) ?? "lead",
      ownerEmployeeId: body.ownerEmployeeId ?? null,
      ownerDeptId: body.ownerDeptId ?? null,
      contractId: body.contractId ?? null,
      expectedAmount: body.expectedAmount ?? null,
      priority: (body.priority as SalesProjectPriority) ?? "normal",
      status: (body.status as SalesProjectStatus) ?? "open",
      openedAt: body.openedAt ?? null,
      closedAt: body.closedAt ?? null,
      memo: body.memo ?? null,
    };
    await updateSalesProject(projectId, input);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    await requirePermission("sales.delete", { target: { projectId }, fallbackRoles: ["editor"] });
    await deleteSalesProject(projectId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
