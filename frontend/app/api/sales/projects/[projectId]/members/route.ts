import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listProjectMembers, setProjectMembers } from "@/lib/sales/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

interface MemberBody {
  employeeId?: string | null;
  roleLabel?: string | null;
}

export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    await requirePermission("sales.edit", { target: { projectId }, fallbackRoles: ["editor"] });
    const body = (await req.json()) as { members?: MemberBody[] };
    const members = (body.members ?? [])
      .map((m) => ({ employeeId: (m.employeeId ?? "").trim(), roleLabel: (m.roleLabel ?? "담당").trim() || "담당" }))
      .filter((m) => m.employeeId);
    await setProjectMembers(projectId, members);
    const saved = await listProjectMembers(projectId);
    return NextResponse.json({ members: saved });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
