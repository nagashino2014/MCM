import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { listFolders, listForms, saveForm, type ApprovalFieldDef } from "@/lib/approval/forms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 전자결재 양식 목록 + 폴더 트리 (기안 양식 선택·양식 관리 공용)
export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.view");
    const includeDisabled = req.nextUrl.searchParams.get("all") === "1";
    const [folders, forms] = await Promise.all([listFolders(), listForms(includeDisabled)]);
    return NextResponse.json({ folders, forms });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

interface PostBody {
  formId?: string | null;
  folderId?: string | null;
  name?: string;
  description?: string | null;
  fields?: ApprovalFieldDef[];
  docNoRule?: string | null;
  retentionYears?: number | null;
  orgFolder?: string | null;
  deptFolder?: string | null;
  useYn?: boolean;
}

// POST: 양식 저장(신규/수정 — 필드 변경 시 버전 증가+스냅샷). 양식 관리는 admin 전용.
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const body = (await req.json().catch(() => ({}))) as PostBody;
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "양식 이름이 필요합니다." }, { status: 400 });
    }
    if (!Array.isArray(body.fields) || body.fields.length === 0) {
      return NextResponse.json({ error: "필드가 1개 이상 필요합니다." }, { status: 400 });
    }
    const saved = await saveForm({
      formId: body.formId ?? null,
      folderId: body.folderId ?? null,
      name: body.name,
      description: body.description ?? null,
      fields: body.fields,
      docNoRule: body.docNoRule ?? null,
      retentionYears: body.retentionYears ?? null,
      orgFolder: body.orgFolder ?? null,
      deptFolder: body.deptFolder ?? null,
      useYn: body.useYn !== false,
      actorUserId: actor.userId,
    });
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "approval_form_update",
      targetTable: "approval_forms",
      targetId: saved.formId,
      after: { name: saved.name, version: saved.version, fieldCount: saved.fields.length },
    });
    return NextResponse.json({ form: saved });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
