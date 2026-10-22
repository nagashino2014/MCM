import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import {
  deleteCredential,
  listCredentials,
  listHistory,
  normalizeCredentialKind,
  saveCredential,
  setCredentialPublic,
} from "@/lib/company/profile";

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
  isPublic?: boolean;
  /** 문서 분석이 보관한 증빙(parse 응답의 file) */
  file?: { storageKey?: string; fileName?: string } | null;
}

// POST: 면허/인증 추가·수정(credentialId 있으면 수정). 취득일이 있으면 연혁 자동 줄을 함께 맞추므로 연혁도 돌려준다.
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("org.edit", { fallbackRoles: ["admin"] });
    const body = (await req.json().catch(() => ({}))) as CredentialBody;
    const saved = await saveCredential({
      credentialId: body.credentialId,
      kind: normalizeCredentialKind(body.kind),
      name: String(body.name ?? ""),
      credentialNo: body.credentialNo,
      issuedAt: body.issuedAt,
      validUntil: body.validUntil,
      issuer: body.issuer,
      note: body.note,
      isPublic: typeof body.isPublic === "boolean" ? body.isPublic : undefined,
      file: body.file?.storageKey ? { storageKey: String(body.file.storageKey), fileName: String(body.file.fileName ?? "") } : undefined,
    });
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "company_profile_update",
      targetTable: "company_credentials",
      targetId: saved.credentialId,
      after: { name: saved.name, kind: saved.kind, hasFile: Boolean(saved.file) },
    });
    const [credentials, history] = await Promise.all([listCredentials(), listHistory()]);
    return NextResponse.json({ credential: saved, credentials, history });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PATCH: 공개 여부만 변경 { credentialId, isPublic } — 회사소개서 인증 쪽 게재
export async function PATCH(req: NextRequest) {
  try {
    const actor = await requirePermission("org.edit", { fallbackRoles: ["admin"] });
    const body = (await req.json().catch(() => ({}))) as { credentialId?: string; isPublic?: boolean };
    const credentialId = String(body.credentialId ?? "");
    if (!credentialId) return NextResponse.json({ error: "credentialId 가 필요합니다." }, { status: 400 });
    await setCredentialPublic(credentialId, body.isPublic !== false);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "company_profile_update",
      targetTable: "company_credentials",
      targetId: credentialId,
      after: { isPublic: body.isPublic !== false },
    });
    return NextResponse.json({ credentials: await listCredentials() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE: 면허/인증 삭제 ?credentialId= (연혁 자동 줄도 함께 지운다)
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
    const [credentials, history] = await Promise.all([listCredentials(), listHistory()]);
    return NextResponse.json({ credentials, history });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
