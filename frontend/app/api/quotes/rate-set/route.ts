import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";
import { DEFAULT_MD_GRADES, sortGrades } from "@/lib/quote/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 세분류의 활성 견적 기준 세트 + 노임단가(당해 연도) + 상황 변수 사유 코드.
// 기준 세트가 없으면 set=null (작성 화면은 T3 자유입력으로 동작 — 블루프린트 §5-2).
// ?serviceType=통합허가&serviceSubtype=최초허가
export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.view");
    const sp = req.nextUrl.searchParams;
    const serviceType = sp.get("serviceType") ?? "";
    const serviceSubtype = sp.get("serviceSubtype") ?? "";
    const db = await getDb();

    // 노임단가 — 당해 연도가 없으면 최신 연도 폴백 + 자동 탐색 트리거(하루 1회, 비차단 —
    // 매년 1월 신년 단가 공표를 확보할 때까지 반복. lib/quote/labor-sync.ts)
    const year = new Date().getFullYear().toString();
    let laborRows = rowsToObjects(await db.exec(`SELECT year, grade, daily_rate FROM quote_labor_rates WHERE year = $1`, [year]));
    if (!laborRows.length) {
      void import("@/lib/quote/labor-sync")
        .then((m) => m.trySyncLaborRates(year))
        .catch(() => {});
    }
    if (!laborRows.length) {
      laborRows = rowsToObjects(
        await db.exec(`SELECT year, grade, daily_rate FROM quote_labor_rates WHERE year = (SELECT max(year) FROM quote_labor_rates)`)
      );
    }
    const laborRates: Record<string, number> = {};
    for (const r of laborRows) laborRates[String(r.grade)] = Number(r.daily_rate);
    const laborYear = laborRows.length ? String(laborRows[0].year) : year;

    const codes = rowsToObjects(
      await db.exec(`SELECT code, label, sort FROM quote_situation_codes WHERE enabled = 1 ORDER BY sort`)
    ).map((r) => ({ code: String(r.code), label: String(r.label) }));

    const sets = rowsToObjects(
      await db.exec(
        `SELECT * FROM quote_rate_sets
          WHERE service_type = $1 AND service_subtype = $2 AND status = 'active'
          ORDER BY version DESC LIMIT 1`,
        [serviceType, serviceSubtype]
      )
    );
    if (!sets.length) {
      return NextResponse.json({ set: null, laborRates, laborYear, situationCodes: codes });
    }
    const s = sets[0];
    const setId = String(s.set_id);
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
        version: Number(s.version),
        overheadRate: Number(s.overhead_rate),
        techFeeRate: Number(s.tech_fee_rate),
        directExpenseRate: Number(s.direct_expense_rate),
        marketAdjust: Number(s.market_adjust),
        // 세트별 가변 등급 축(143) — 작성 화면 MD 매트릭스 열·문서 출력 열 순서의 기준
        grades: (() => {
          try {
            const v = typeof s.grades === "string" ? JSON.parse(String(s.grades)) : s.grades;
            const list = Array.isArray(v) ? v.map((g) => String(g).trim()).filter(Boolean) : [];
            return list.length ? sortGrades(list) : [...DEFAULT_MD_GRADES];
          } catch {
            return [...DEFAULT_MD_GRADES];
          }
        })(),
        remarksTemplate: s.remarks_template != null ? String(s.remarks_template) : "",
        items,
        factors,
        bands,
      },
      laborRates,
      laborYear,
      situationCodes: codes,
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
