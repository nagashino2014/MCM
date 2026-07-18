import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { deleteCredential, listCredentials, saveCredential, type CredentialKind } from "@/lib/company/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CredentialBody {
  credentialId?: string | null;
  kind?: string;
  name?: string;
  credentialNo?: string;
  issuedAt?: string;
  validUntil?: string;
  issuer?: string;
  note?: string;
}

// POST: 면허/인증 추가·수정(credentialId 있으면 수정)
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("org.edit", { fallbackRoles: ["admin"] });
    const body = (await req.json().catch(() => ({}))) as CredentialBody;
    const saved = await saveCredential({
      credentialId: body.credentialId,
      kind: (body.kind === "certification" ? "certification" : "license") as CredentialKind,
      name: String(body.name ?? ""),
      credentialNo: body.credentialNo,
      issuedAt: body.issuedAt,
      validUntil: body.validUntil,
      issuer: body.issuer,
      note: body.note,
    });
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "company_profile_update",
      targetTable: "company_credentials",
      targetId: saved.credentialId,
      after: { name: saved.name, kind: saved.kind },
    });
    return NextResponse.json({ credential: saved, credentials: await listCredentials() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE: 면허/인증 삭제 ?credentialId=
export async function DELETE(req: NextRequest) {
  try {
    const actor = await requirePermission("org.edit", { fallbackRoles: ["admin"] });
    const credentialId = String(req.nextUrl.searchParams.get("credentialId") ?? "");
    if (!credentialId) return NextResponse.json({ error: "credentialId 가 필요합니다." }, { status: 400 });
    await deleteCredential(credentialId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "company_profile_update",
      targetTable: "company_credentials",
      targetId: credentialId,
      after: { deleted: true },
    });
    return NextResponse.json({ credentials: await listCredentials() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
