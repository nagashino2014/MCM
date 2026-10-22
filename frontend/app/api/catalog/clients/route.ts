import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { deleteClient, listClientCandidates, listClients, saveClient } from "@/lib/catalog/clients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 고객사·협력 기관(로고 월) + 아직 등록하지 않은 계약 거래처 후보
export async function GET() {
  try {
    await requirePermission("catalog.manage");
    const [clients, candidates] = await Promise.all([listClients(), listClientCandidates()]);
    return NextResponse.json({ clients, candidates });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST: 고객사 추가·수정 { clientId?, facilityId?, name, category, orderNo, isPublic }
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const body = (await req.json().catch(() => ({}))) as {
      clientId?: string | null;
      facilityId?: string | null;
      name?: string;
      category?: string;
      orderNo?: number;
      isPublic?: boolean;
    };
    const clientId = await saveClient({ ...body, name: String(body.name ?? "") }, actor.userId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "catalog_update",
      targetTable: "catalog_clients",
      targetId: clientId,
      after: { name: body.name, category: body.category, isPublic: body.isPublic },
    });
    const [clients, candidates] = await Promise.all([listClients(), listClientCandidates()]);
    return NextResponse.json({ clientId, clients, candidates });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE: 고객사 삭제 ?clientId=
export async function DELETE(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const clientId = String(req.nextUrl.searchParams.get("clientId") ?? "");
    if (!clientId) return NextResponse.json({ error: "clientId 가 필요합니다." }, { status: 400 });
    await deleteClient(clientId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "catalog_update",
      targetTable: "catalog_clients",
      targetId: clientId,
      after: { deleted: true },
    });
    const [clients, candidates] = await Promise.all([listClients(), listClientCandidates()]);
    return NextResponse.json({ clients, candidates });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
