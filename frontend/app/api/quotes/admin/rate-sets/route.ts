import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 견적 기준 세트 관리(Q4) — 목록/생성. 권한 approval.manage.
// 세트 수정은 기존 견적을 훼손하지 않는다(견적서에 산정 당시 스냅샷 박제 — quotation_sites.rates).

// GET: 전체 세트 목록(세분류별 최신 active) — 설정 화면 좌측 리스트
export async function GET() {
  try {
    await requirePermission("approval.manage");
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(
        `SELECT s.set_id, s.service_type, s.service_subtype, s.version, s.status,
                s.overhead_rate, s.tech_fee_rate, s.direct_expense_rate, s.market_adjust,
                (SELECT count(*) FROM quote_rate_items i WHERE i.set_id = s.set_id) AS item_count
           FROM quote_rate_sets s
          WHERE s.status = 'active'
          ORDER BY s.service_type, s.service_subtype`
      )
    );
    return NextResponse.json({
      sets: rows.map((r) => ({
        setId: String(r.set_id),
        serviceType: String(r.service_type),
        serviceSubtype: String(r.service_subtype),
        version: Number(r.version),
        itemCount: Number(r.item_count),
      })),
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST: 세분류에 새 기준 세트 생성(빈 세트 또는 다른 세트 복제). body={serviceType, serviceSubtype, copyFromSetId?}
export async function POST(req: NextRequest) {
  try {
    await requirePermission("approval.manage");
    const body = (await req.json()) as { serviceType?: string; serviceSubtype?: string; copyFromSetId?: string };
    const serviceType = String(body.serviceType ?? "").trim();
    const serviceSubtype = String(body.serviceSubtype ?? "").trim();
    if (!serviceType || !serviceSubtype) return NextResponse.json({ error: "용역 분류가 필요합니다." }, { status: 400 });
    const db = await getDb();
    const dup = rowsToObjects(
      await db.exec(`SELECT set_id FROM quote_rate_sets WHERE service_type = $1 AND service_subtype = $2 AND status = 'active'`, [
        serviceType,
        serviceSubtype,
      ])
    );
    if (dup.length) return NextResponse.json({ error: "이미 활성 기준 세트가 있는 세분류입니다." }, { status: 409 });

    const setId = "qrs-" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const now = new Date().toISOString();
    await withDbWrite(async (txn) => {
      if (body.copyFromSetId) {
        const src = rowsToObjects(await txn.exec(`SELECT * FROM quote_rate_sets WHERE set_id = $1`, [String(body.copyFromSetId)]));
        if (!src.length) throw new Error("복제할 세트를 찾을 수 없습니다.");
        const s = src[0];
        await txn.run(
          `INSERT INTO quote_rate_sets (set_id, service_type, service_subtype, version, status, overhead_rate, tech_fee_rate, direct_expense_rate, market_adjust, remarks_template, created_at, updated_at)
           VALUES ($1, $2, $3, 1, 'active', $4, $5, $6, $7, $8, $9, $9)`,
          [setId, serviceType, serviceSubtype, Number(s.overhead_rate), Number(s.tech_fee_rate), Number(s.direct_expense_rate), Number(s.market_adjust), s.remarks_template != null ? String(s.remarks_template) : null, now]
        );
        // 항목 트리 복제 — item_id 재발급하며 parent 매핑 유지
        const items = rowsToObjects(
          await txn.exec(`SELECT item_id, parent_id, label, sort, base_md FROM quote_rate_items WHERE set_id = $1 ORDER BY sort`, [String(body.copyFromSetId)])
        );
        const idMap = new Map<string, string>();
        for (const it of items) idMap.set(String(it.item_id), "qri-" + crypto.randomUUID().replace(/-/g, "").slice(0, 12));
        for (const it of items) {
          await txn.run(`INSERT INTO quote_rate_items (item_id, set_id, parent_id, label, sort, base_md) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`, [
            idMap.get(String(it.item_id)),
            setId,
            it.parent_id != null ? (idMap.get(String(it.parent_id)) ?? null) : null,
            String(it.label),
            Number(it.sort),
            typeof it.base_md === "string" ? String(it.base_md) : JSON.stringify(it.base_md ?? {}),
          ]);
        }
      } else {
        await txn.run(
          `INSERT INTO quote_rate_sets (set_id, service_type, service_subtype, version, status, created_at, updated_at)
           VALUES ($1, $2, $3, 1, 'active', $4, $4)`,
          [setId, serviceType, serviceSubtype, now]
        );
      }
    });
    return NextResponse.json({ setId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
