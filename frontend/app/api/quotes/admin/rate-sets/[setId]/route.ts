import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 견적 기준 세트 상세/저장/삭제(Q4) — 권한 approval.manage.
// 저장은 요율+항목 트리+인자+규모구간 통째 교체(설정 화면이 전체 페이로드 전송).

interface ItemPayload {
  itemId?: string; // 신규 행은 없음
  parentIdx?: number | null; // 페이로드 내 부모 인덱스(트리 재구성용)
  label: string;
  baseMd: Record<string, number>;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ setId: string }> }) {
  try {
    await requirePermission("approval.manage");
    const { setId } = await params;
    const db = await getDb();
    const sets = rowsToObjects(await db.exec(`SELECT * FROM quote_rate_sets WHERE set_id = $1`, [setId]));
    if (!sets.length) return NextResponse.json({ error: "세트를 찾을 수 없습니다." }, { status: 404 });
    const s = sets[0];
    const items = rowsToObjects(
      await db.exec(`SELECT item_id, parent_id, label, sort, base_md FROM quote_rate_items WHERE set_id = $1 ORDER BY sort`, [setId])
    ).map((r) => ({
      itemId: String(r.item_id),
      parentId: r.parent_id != null ? String(r.parent_id) : null,
      label: String(r.label),
      sort: Number(r.sort),
      baseMd: typeof r.base_md === "string" ? JSON.parse(String(r.base_md)) : (r.base_md ?? {}),
    }));
    const factors = rowsToObjects(
      await db.exec(`SELECT factor_key, label, unit, sort FROM quote_rate_factors WHERE set_id = $1 ORDER BY sort`, [setId])
    ).map((r) => ({ factorKey: String(r.factor_key), label: String(r.label), unit: r.unit != null ? String(r.unit) : "" }));
    const bands = rowsToObjects(
      await db.exec(`SELECT factor_key, min_val, max_val, coef FROM quote_rate_bands WHERE set_id = $1 ORDER BY factor_key, min_val`, [setId])
    ).map((r) => ({
      factorKey: String(r.factor_key),
      minVal: Number(r.min_val),
      maxVal: r.max_val != null ? Number(r.max_val) : null,
      coef: Number(r.coef),
    }));
    return NextResponse.json({
      set: {
        setId,
        serviceType: String(s.service_type),
        serviceSubtype: String(s.service_subtype),
        version: Number(s.version),
        overheadRate: Number(s.overhead_rate),
        techFeeRate: Number(s.tech_fee_rate),
        directExpenseRate: Number(s.direct_expense_rate),
        marketAdjust: Number(s.market_adjust),
        remarksTemplate: s.remarks_template != null ? String(s.remarks_template) : "",
        items,
        factors,
        bands,
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PUT: 세트 저장 — body = {overheadRate, techFeeRate, directExpenseRate, marketAdjust, remarksTemplate,
//   items: [{label, baseMd, parentIdx}], factors?, bands?}
export async function PUT(req: NextRequest, { params }: { params: Promise<{ setId: string }> }) {
  try {
    await requirePermission("approval.manage");
    const { setId } = await params;
    const body = (await req.json()) as {
      overheadRate?: number;
      techFeeRate?: number;
      directExpenseRate?: number;
      marketAdjust?: number;
      remarksTemplate?: string;
      items?: ItemPayload[];
      factors?: { factorKey: string; label: string; unit: string }[];
      bands?: { factorKey: string; minVal: number; maxVal: number | null; coef: number }[];
    };
    const db = await getDb();
    const exists = rowsToObjects(await db.exec(`SELECT set_id FROM quote_rate_sets WHERE set_id = $1`, [setId]));
    if (!exists.length) return NextResponse.json({ error: "세트를 찾을 수 없습니다." }, { status: 404 });
    const now = new Date().toISOString();
    await withDbWrite(async (txn) => {
      await txn.run(
        `UPDATE quote_rate_sets SET overhead_rate = $2, tech_fee_rate = $3, direct_expense_rate = $4, market_adjust = $5, remarks_template = $6, updated_at = $7
          WHERE set_id = $1`,
        [
          setId,
          Number(body.overheadRate ?? 1.1),
          Number(body.techFeeRate ?? 0.2),
          Number(body.directExpenseRate ?? 0),
          Number(body.marketAdjust ?? 1),
          String(body.remarksTemplate ?? ""),
          now,
        ]
      );
      if (Array.isArray(body.items)) {
        await txn.run(`DELETE FROM quote_rate_items WHERE set_id = $1`, [setId]);
        const ids = body.items.map(() => "qri-" + crypto.randomUUID().replace(/-/g, "").slice(0, 12));
        for (let i = 0; i < body.items.length; i++) {
          const it = body.items[i];
          const parentId = it.parentIdx != null && it.parentIdx >= 0 && it.parentIdx < i ? ids[it.parentIdx] : null;
          await txn.run(`INSERT INTO quote_rate_items (item_id, set_id, parent_id, label, sort, base_md) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`, [
            ids[i],
            setId,
            parentId,
            String(it.label ?? "").trim() || `항목 ${i + 1}`,
            (i + 1) * 10,
            JSON.stringify(it.baseMd ?? {}),
          ]);
        }
      }
      if (Array.isArray(body.factors)) {
        await txn.run(`DELETE FROM quote_rate_factors WHERE set_id = $1`, [setId]);
        for (let i = 0; i < body.factors.length; i++) {
          const f = body.factors[i];
          if (!String(f.factorKey ?? "").trim()) continue;
          await txn.run(`INSERT INTO quote_rate_factors (set_id, factor_key, label, unit, sort) VALUES ($1, $2, $3, $4, $5)`, [
            setId,
            String(f.factorKey).trim(),
            String(f.label ?? f.factorKey),
            String(f.unit ?? ""),
            i + 1,
          ]);
        }
      }
      if (Array.isArray(body.bands)) {
        await txn.run(`DELETE FROM quote_rate_bands WHERE set_id = $1`, [setId]);
        for (const b of body.bands) {
          if (!String(b.factorKey ?? "").trim()) continue;
          await txn.run(`INSERT INTO quote_rate_bands (set_id, factor_key, min_val, max_val, coef) VALUES ($1, $2, $3, $4, $5)`, [
            setId,
            String(b.factorKey).trim(),
            Number(b.minVal) || 0,
            b.maxVal != null && String(b.maxVal) !== "" ? Number(b.maxVal) : null,
            Number(b.coef) || 1,
          ]);
        }
      }
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE: 세트 삭제(세분류를 자유 입력형으로 되돌림) — 기존 견적은 스냅샷이라 영향 없음
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ setId: string }> }) {
  try {
    await requirePermission("approval.manage");
    const { setId } = await params;
    await withDbWrite(async (txn) => {
      await txn.run(`DELETE FROM quote_rate_sets WHERE set_id = $1`, [setId]);
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
