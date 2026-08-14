import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 보험요율 관리(162) — ei(고용보험)·ltc(장기요양). 장기요양은 EDI 업로드 시 자동 역산 갱신. */
export async function GET() {
  try {
    await requireAdmin();
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(
        `SELECT rate_id, kind, valid_from, rate, source, note, updated_at
           FROM payroll_insurance_rates ORDER BY kind, valid_from DESC`
      )
    );
    return NextResponse.json({
      rates: rows.map((r) => ({
        rateId: String(r.rate_id),
        kind: String(r.kind),
        validFrom: String(r.valid_from),
        rate: Number(r.rate),
        source: String(r.source),
        note: r.note ? String(r.note) : null,
      })),
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 수동 추가/수정 — 같은 (kind, validFrom) 이면 갱신(source=manual, EDI 역산보다 우선 유지) */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json();
    const kind = ["ei", "ltc", "ei-exempt-age", "nps-max-age"].includes(String(body.kind)) ? String(body.kind) : null;
    const validFrom = String(body.validFrom ?? "");
    const rate = Number(body.rate);
    if (!kind || !/^\d{4}-\d{2}$/.test(validFrom) || !Number.isFinite(rate) || rate <= 0 || rate > 100) {
      return NextResponse.json({ error: "종류·적용 시작(YYYY-MM)·요율(%)을 확인하세요." }, { status: 400 });
    }
    await withDbWrite(async (db) => {
      await db.exec(
        `INSERT INTO payroll_insurance_rates (rate_id, kind, valid_from, rate, source, note, updated_at)
         VALUES ($1,$2,$3,$4,'manual',$5,$6)
         ON CONFLICT (kind, valid_from) DO UPDATE SET
           rate = EXCLUDED.rate, source = 'manual', note = EXCLUDED.note, updated_at = EXCLUDED.updated_at`,
        [`${kind}-${validFrom}`, kind, validFrom, rate, body.note ?? null, new Date().toISOString()]
      );
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
