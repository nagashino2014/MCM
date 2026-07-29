import { NextRequest, NextResponse } from "next/server";
import { AuthError, authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { createAlias, deleteAlias, listAliases, updateAlias } from "@/lib/mail/aliases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 별칭/배포리스트 관리(G5, 메일 P4) — 전부 관리자 전용. 라우팅은 inbound 가 mail_aliases 를 직접 읽는다.

export async function GET() {
  try {
    await requirePermission("mail.manage");
    return NextResponse.json({ aliases: await listAliases() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requirePermission("mail.manage");
    const body = (await req.json().catch(() => ({}))) as { aliasLocal?: string; kind?: "alias" | "list"; targetMailboxIds?: string[] };
    if (!body.aliasLocal?.trim()) {
      return NextResponse.json({ error: "aliasLocal 이 필요합니다." }, { status: 400 });
    }
    const created = await createAlias({
      aliasLocal: body.aliasLocal,
      kind: body.kind === "list" ? "list" : "alias",
      targetMailboxIds: Array.isArray(body.targetMailboxIds) ? body.targetMailboxIds.map(String) : [],
    });
    return NextResponse.json(created);
  } catch (err) {
    if (err instanceof AuthError) return authErrorToResponse(err);
    if (err instanceof Error && err.message) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return authErrorToResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requirePermission("mail.manage");
    const body = (await req.json().catch(() => ({}))) as {
      aliasId?: string;
      aliasLocal?: string;
      kind?: "alias" | "list";
      targetMailboxIds?: string[];
      active?: boolean;
    };
    if (!body.aliasId) return NextResponse.json({ error: "aliasId 가 필요합니다." }, { status: 400 });
    await updateAlias(body.aliasId, {
      aliasLocal: body.aliasLocal,
      kind: body.kind,
      targetMailboxIds: Array.isArray(body.targetMailboxIds) ? body.targetMailboxIds.map(String) : undefined,
      active: body.active,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return authErrorToResponse(err);
    if (err instanceof Error && err.message) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return authErrorToResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requirePermission("mail.manage");
    const aliasId = req.nextUrl.searchParams.get("aliasId");
    if (!aliasId) return NextResponse.json({ error: "aliasId 가 필요합니다." }, { status: 400 });
    await deleteAlias(aliasId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
