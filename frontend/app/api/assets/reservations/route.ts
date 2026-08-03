import { NextRequest, NextResponse } from "next/server";
import { AuthError, authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { createReservation } from "@/lib/assets/store";
import { listAssetUsage } from "@/lib/assets/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?month=YYYY-MM : 자산 이용 현황(직접 예약 + 출장 유래 차량, 겹침 경고 포함).
// mine = 본인 직접 예약 여부(취소 버튼 노출 판정).
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const month = req.nextUrl.searchParams.get("month") ?? "";
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: "month=YYYY-MM 형식이 필요합니다." }, { status: 400 });
    }
    const usage = (await listAssetUsage(month)).map((u) => ({ ...u, mine: u.reservedBy != null && u.reservedBy === ctx.userId }));
    return NextResponse.json({ usage });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST : 직접 예약(회의실 등 — 결재 없이 즉시 등록). 겹침은 저장이 차단된다.
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const body = (await req.json()) as {
      assetId?: string;
      reservedOn?: string;
      startTime?: string | null;
      endTime?: string | null;
      purpose?: string | null;
    };
    if (!body.assetId) return NextResponse.json({ error: "자산을 선택하세요." }, { status: 400 });
    const reservation = await createReservation({
      assetId: body.assetId,
      reservedBy: ctx.userId,
      reservedOn: String(body.reservedOn ?? ""),
      startTime: body.startTime ?? null,
      endTime: body.endTime ?? null,
      purpose: body.purpose ?? null,
    });
    return NextResponse.json({ ok: true, reservation });
  } catch (err) {
    if (err instanceof AuthError) return authErrorToResponse(err);
    if (err instanceof Error && err.message) return NextResponse.json({ error: err.message }, { status: 400 });
    return authErrorToResponse(err);
  }
}
