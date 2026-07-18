import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { getFormByOrg, saveForm } from "@/lib/bid/package-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 30 * 1024 * 1024;

// GET: 발주처 기본 양식 메타 조회
export async function GET(req: NextRequest) {
  try {
    await requirePermission("sales.view");
    const orgName = String(req.nextUrl.searchParams.get("orgName") ?? "").trim();
    if (!orgName) {
      return NextResponse.json({ error: "orgName 파라미터가 필요합니다." }, { status: 400 });
    }
    const form = await getFormByOrg(orgName);
    return NextResponse.json({ form });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST: 발주처 양식 업로드/교체(multipart: orgName, file) — 발주처당 1건, 교체 시 분석 결과 초기화
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const form = await req.formData();
    const orgName = String(form.get("orgName") ?? "").trim();
    const file = form.get("file");
    if (!orgName) {
      return NextResponse.json({ error: "발주처명이 필요합니다." }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "양식 파일이 필요합니다." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "양식 파일은 30MB 이하만 업로드할 수 있습니다." }, { status: 400 });
    }
    const saved = await saveForm({
      orgName,
      fileName: file.name || "form",
      contentType: file.type || "application/octet-stream",
      bytes: new Uint8Array(await file.arrayBuffer()),
      actorUserId: actor.userId,
    });
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "contract_update",
      targetTable: "bid_package_forms",
      targetId: saved.formId,
      after: { orgName, fileName: saved.displayName },
    });
    return NextResponse.json({ form: saved });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
