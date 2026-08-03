import { NextRequest, NextResponse } from "next/server";
import { AuthError, authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/rbac";
import { deleteReservation } from "@/lib/assets/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DELETE : 예약 취소 — 본인 예약 또는 asset.manage 보유자.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ reservationId: string }> }) {
  try {
    const ctx = await requireSession();
    const { reservationId } = await params;
    const canManage = await hasPermission(ctx.userId, "asset.manage");
    await deleteReservation(reservationId, ctx.userId, canManage);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return authErrorToResponse(err);
    if (err instanceof Error && err.message) {
      const status = err.message.includes("본인 예약만") ? 403 : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
    return authErrorToResponse(err);
  }
}
