import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RateCardItemBody {
  id?: unknown;
  groupName?: unknown;
  name?: unknown;
  unit?: unknown;
  unitPrice?: unknown;
  qty?: unknown;
  note?: unknown;
}

/** 저장 전 정제 — 숫자 필드는 숫자만, 문자열은 트림·길이 제한. 완전히 빈 행은 버린다. */
function sanitizeItems(raw: unknown): Array<Record<string, string>> {
  if (!Array.isArray(raw)) return [];
  const digits = (v: unknown) => String(v ?? "").replace(/[^0-9]/g, "").slice(0, 15);
  const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
  return raw
    .slice(0, 200)
    .map((r: RateCardItemBody, i: number) => ({
      id: text(r.id, 24) || `rci_${i}_${Date.now().toString(36)}`,
      groupName: text(r.groupName, 60),
      name: text(r.name, 200),
      unit: text(r.unit, 20),
      unitPrice: digits(r.unitPrice),
      qty: digits(r.qty),
      note: text(r.note, 300),
    }))
    .filter((r) => r.groupName || r.name || r.unitPrice);
}

/** 단가 기준표 조회 — 없으면 빈 배열(단가 계약이 아니어도 200, UI 분기는 클라이언트). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ contractId: string }> }) {
  try {
    await requirePermission("contract.view");
    const { contractId } = await params;
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(`SELECT items, updated_at FROM contract_rate_cards WHERE contract_id = $1`, [contractId])
    );
    if (!rows.length) return NextResponse.json({ items: [], updatedAt: null });
    const raw = rows[0].items;
    const items = typeof raw === "string" ? JSON.parse(raw) : raw;
    return NextResponse.json({ items: Array.isArray(items) ? items : [], updatedAt: rows[0].updated_at ?? null });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 단가 기준표 저장(전체 교체) — 신규 계약·변경계약 모달의 '단가 계약' 탭이 호출. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ contractId: string }> }) {
  try {
    const actor = await requirePermission("contract.edit", { fallbackRoles: ["editor"] });
    const { contractId } = await params;
    const body = (await req.json().catch(() => ({}))) as { items?: unknown };
    const items = sanitizeItems(body.items);
    const now = new Date().toISOString();
    await withDbWrite(async (db) => {
      await db.run(
        `INSERT INTO contract_rate_cards (contract_id, items, updated_at, updated_by)
         VALUES ($1, $2::jsonb, $3, $4)
         ON CONFLICT (contract_id) DO UPDATE
           SET items = EXCLUDED.items, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
        [contractId, JSON.stringify(items), now, actor.userId ?? null]
      );
    });
    return NextResponse.json({ ok: true, count: items.length });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
