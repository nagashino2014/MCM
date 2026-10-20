import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { loadUserAccess, grantDeptIds } from "@/lib/auth/rbac";
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
    const ctx = await requirePermission("sales.view");
    const sp = req.nextUrl.searchParams;
    const filter: SalesProjectFilter = {
      facilityId: sp.get("facilityId") || undefined,
      stage: (sp.get("stage") as SalesStage) || undefined,
      ownerEmployeeId: sp.get("ownerEmployeeId") || undefined,
      status: (sp.get("status") as SalesProjectStatus) || undefined,
      q: sp.get("q") || undefined,
    };
    let projects = await listSalesProjects(filter);
    // 목록도 단건 가드(target.projectId)와 같은 범위로 거른다(X-03, 2026-10-19):
    //   all = 전사 / self_dept·specific_dept = 담당 부서가 그 부서인 건 + 본인이 관계자인 건 / participant·self = 본인이 관계자인 건.
    const access = await loadUserAccess(ctx.userId);
    const grants = access.grants.filter((g) => g.permissionKey === "sales.view" && g.effect === "allow");
    if (!grants.some((g) => g.scopeKind === "all")) {
      const deptIds = new Set<string>();
      for (const g of grants) {
        for (const d of grantDeptIds(access, g)) deptIds.add(d); // self_dept = 보직 부서 전체(겸직 300)
      }
      projects = projects.filter(
        (p) => (p.ownerDeptId != null && deptIds.has(String(p.ownerDeptId))) || access.participantProjectIds.has(p.projectId)
      );
    }
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
