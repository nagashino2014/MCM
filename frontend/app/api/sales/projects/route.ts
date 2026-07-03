import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { createSalesProject, listSalesProjects } from "@/lib/sales/queries";
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
    await requirePermission("sales.view");
    const sp = req.nextUrl.searchParams;
    const filter: SalesProjectFilter = {
      facilityId: sp.get("facilityId") || undefined,
      stage: (sp.get("stage") as SalesStage) || undefined,
      ownerEmployeeId: sp.get("ownerEmployeeId") || undefined,
      status: (sp.get("status") as SalesProjectStatus) || undefined,
      q: sp.get("q") || undefined,
    };
    const projects = await listSalesProjects(filter);
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
