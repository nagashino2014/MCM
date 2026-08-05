import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { LABOR_GRADES } from "@/lib/quote/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 노임단가 관리(Q4) — 연도별×등급별 CRUD. 권한 approval.manage.
// 매년 1월 자동 수집(labor-sync) 실패 시 여기서 수동 입력한다.

export async function GET() {
  try {
    await requirePermission("approval.manage");
    const db = await getDb();
    const rows = rowsToObjects(await db.exec(`SELECT year, grade, daily_rate, source_note FROM quote_labor_rates ORDER BY year DESC, grade`));
    const byYear: Record<string, { rates: Record<string, number>; sourceNote: string }> = {};
    for (const r of rows) {
      const y = String(r.year);
      byYear[y] ??= { rates: {}, sourceNote: "" };
      byYear[y].rates[String(r.grade)] = Number(r.daily_rate);
      if (!byYear[y].sourceNote && r.source_note) byYear[y].sourceNote = String(r.source_note);
    }
    const syncLog = rowsToObjects(
      await db.exec(`SELECT year, tried_date, ok, source_url, detail FROM quote_labor_rate_sync_log ORDER BY tried_date DESC LIMIT 10`)
    ).map((r) => ({
      year: String(r.year),
      triedDate: String(r.tried_date),
      ok: Number(r.ok) === 1,
      sourceUrl: r.source_url != null ? String(r.source_url) : null,
      detail: r.detail != null ? String(r.detail) : null,
    }));
    return NextResponse.json({ years: byYear, syncLog });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PUT: 한 연도 단가 저장(upsert). body = {year, rates: {기술사..초급}, sourceNote?}
export async function PUT(req: NextRequest) {
  try {
    await requirePermission("approval.manage");
    const body = (await req.json()) as { year?: string; rates?: Record<string, number>; sourceNote?: string };
    const year = String(body.year ?? "").trim();
    if (!/^\d{4}$/.test(year)) return NextResponse.json({ error: "연도(YYYY)가 필요합니다." }, { status: 400 });
    const rates = body.rates ?? {};
    await withDbWrite(async (txn) => {
      for (const g of LABOR_GRADES) {
        const v = Number(rates[g]);
        if (!v || v <= 0) continue;
        await txn.run(
          `INSERT INTO quote_labor_rates (year, grade, daily_rate, source_note) VALUES ($1, $2, $3, $4)
           ON CONFLICT (year, grade) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, source_note = EXCLUDED.source_note`,
          [year, g, Math.round(v), String(body.sourceNote ?? `수동 입력, ${year}-01-01 적용`)]
        );
      }
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
