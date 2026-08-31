import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { upgradeRateCard } from "@/lib/contracts/rate-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 단가 기준표 조회 — 없으면 빈 v2 구조(단가 계약이 아니어도 200, UI 분기는 클라이언트).
 * v1(평탄 배열)으로 저장된 기존 데이터도 v2(차수 매트릭스)로 승격해 내려준다(2026-08-25).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ contractId: string }> }) {
  try {
    const { contractId } = await params;
    // 다른 계약 라우트와 동일하게 target 을 넘긴다 — 참여자 스코프 권한이 임의 계약에 닿지 않게.
    await requirePermission("contract.view", { target: { contractId } });
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(`SELECT items, updated_at FROM contract_rate_cards WHERE contract_id = $1`, [contractId])
    );
    const raw = rows.length ? rows[0].items : null;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return NextResponse.json({ card: upgradeRateCard(parsed), updatedAt: rows.length ? rows[0].updated_at ?? null : null });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 단가 기준표 저장(전체 교체) — 신규 계약·변경계약 모달의 '단가 계약' 탭이 호출. v2 구조로 정제해 저장. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ contractId: string }> }) {
  try {
    const { contractId } = await params;
    const actor = await requirePermission("contract.edit", { fallbackRoles: ["editor"], target: { contractId } });
    const body = (await req.json().catch(() => ({}))) as { card?: unknown; items?: unknown };
    // 구버전 클라이언트({items: [...]})와 신버전({card: {...}}) 모두 수용한다.
    const card = upgradeRateCard(body.card ?? body.items);
    const now = new Date().toISOString();
    await withDbWrite(async (db) => {
      await db.run(
        `INSERT INTO contract_rate_cards (contract_id, items, updated_at, updated_by)
         VALUES ($1, $2::jsonb, $3, $4)
         ON CONFLICT (contract_id) DO UPDATE
           SET items = EXCLUDED.items, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
        [contractId, JSON.stringify(card), now, actor.userId ?? null]
      );
    });
    return NextResponse.json({ ok: true, count: card.items.length });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
