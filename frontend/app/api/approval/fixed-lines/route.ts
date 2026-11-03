import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import {
  deleteRoleUser,
  fixedLineReady,
  listLineDepartments,
  listLineTemplates,
  listRoleUsers,
  previewFixedLines,
  saveLineTemplate,
  setRoleUser,
  type FixedLineRole,
} from "@/lib/approval/fixed-line";
import type { LineEnforceWhen, LineTemplateStep } from "@/lib/approval/fixed-line-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 고정 결재선(335, 결재 운영) — 양식별 결재 단계·역할 담당자·해석 미리보기. 결재 운영자 전용.

async function snapshot() {
  const [ready, templates, roleUsers, departments] = await Promise.all([
    fixedLineReady(),
    listLineTemplates(),
    listRoleUsers(),
    listLineDepartments(),
  ]);
  return { ready, templates, roleUsers, departments };
}

// GET: 템플릿·역할 담당자·부서 목록. ?preview=1 이면 재직자별 해석 결과를 함께 준다.
export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const data = await snapshot();
    if (req.nextUrl.searchParams.get("preview") === "1") {
      return NextResponse.json({ ...data, preview: await previewFixedLines() });
    }
    return NextResponse.json(data);
  } catch (err) {
    return authErrorToResponse(err);
  }
}

interface PutBody {
  kind?: "template" | "role";
  formId?: string;
  steps?: LineTemplateStep[];
  enforceWhen?: LineEnforceWhen | null;
  enabled?: boolean;
  role?: FixedLineRole;
  deptId?: string | null;
  userId?: string;
}

// PUT: { kind:'template', formId, steps, enforceWhen, enabled } | { kind:'role', role, deptId, userId }
export async function PUT(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const body = (await req.json().catch(() => ({}))) as PutBody;
    if (body.kind === "template") {
      await saveLineTemplate(actor.userId, {
        formId: String(body.formId ?? ""),
        steps: Array.isArray(body.steps) ? body.steps : [],
        enforceWhen: body.enforceWhen ?? null,
        enabled: body.enabled !== false,
      });
    } else if (body.kind === "role") {
      await setRoleUser(actor.userId, { role: body.role as FixedLineRole, deptId: body.deptId ?? null, userId: String(body.userId ?? "") });
    } else {
      return NextResponse.json({ error: "kind 가 올바르지 않습니다." }, { status: 400 });
    }
    return NextResponse.json(await snapshot());
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE ?entryId= : 역할 담당자 행 삭제(부서별 임원·임원 취급 인원)
export async function DELETE(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const entryId = req.nextUrl.searchParams.get("entryId") ?? "";
    if (!entryId) return NextResponse.json({ error: "entryId 가 필요합니다." }, { status: 400 });
    await deleteRoleUser(actor.userId, entryId);
    return NextResponse.json(await snapshot());
  } catch (err) {
    return authErrorToResponse(err);
  }
}
