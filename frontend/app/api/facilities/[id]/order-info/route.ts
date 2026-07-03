import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const text = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
};
const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const ORDER_TYPES = new Set(["negotiated", "limited", "qualification"]);

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    await requirePermission("facility.view");
    const { id } = await ctx.params;
    const db = await getDb();
    const row = rowsToObjects(
      await db.exec("SELECT * FROM facility_order_info WHERE facility_id = $1 LIMIT 1", [id])
    )[0];
    if (!row) return NextResponse.json({ info: null });
    let participants: string[] = [];
    try {
      const raw = row.participants;
      const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (Array.isArray(arr)) participants = arr.map((x) => String(x));
    } catch {
      participants = [];
    }
    return NextResponse.json({
      info: {
        orderType: row.order_type ?? null,
        orderAt: row.order_at ?? null,
        bidStart: row.bid_start ?? null,
        bidEnd: row.bid_end ?? null,
        estimatedPrice: row.estimated_price != null ? Number(row.estimated_price) : null,
        minBidRate: row.min_bid_rate != null ? Number(row.min_bid_rate) : null,
        participants,
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("facility.edit", { fallbackRoles: ["editor"] });
    const { id } = await ctx.params;
    const b = await req.json();
    const now = new Date().toISOString();
    const orderType = text(b.orderType);
    const participants = Array.isArray(b.participants)
      ? b.participants.map((x: unknown) => String(x ?? "").trim()).filter(Boolean)
      : [];
    await withDbWrite(async (db) => {
      await db.run(
        `INSERT INTO facility_order_info
           (facility_id, order_type, order_at, bid_start, bid_end, estimated_price, min_bid_rate, participants, updated_at, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
         ON CONFLICT (facility_id) DO UPDATE SET
           order_type = EXCLUDED.order_type, order_at = EXCLUDED.order_at, bid_start = EXCLUDED.bid_start,
           bid_end = EXCLUDED.bid_end, estimated_price = EXCLUDED.estimated_price, min_bid_rate = EXCLUDED.min_bid_rate,
           participants = EXCLUDED.participants, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
        [
          id,
          orderType && ORDER_TYPES.has(orderType) ? orderType : null,
          text(b.orderAt),
          text(b.bidStart),
          text(b.bidEnd),
          num(b.estimatedPrice),
          num(b.minBidRate),
          JSON.stringify(participants),
          now,
          actor.userId || null,
        ]
      );
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
