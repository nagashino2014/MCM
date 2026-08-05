import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 상황 변수 사유 코드 관리(Q4) — 권한 approval.manage. 코드 자체는 데이터로 관리(블루프린트 §5-1-b).

export async function GET() {
  try {
    await requirePermission("approval.manage");
    const db = await getDb();
    const rows = rowsToObjects(await db.exec(`SELECT code, label, sort, enabled FROM quote_situation_codes ORDER BY sort`));
    return NextResponse.json({
      codes: rows.map((r) => ({ code: String(r.code), label: String(r.label), sort: Number(r.sort), enabled: Number(r.enabled) === 1 })),
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PUT: 전체 목록 교체 저장. body = {codes: [{code,label,enabled}]}
export async function PUT(req: NextRequest) {
  try {
    await requirePermission("approval.manage");
    const body = (await req.json()) as { codes?: { code: string; label: string; enabled: boolean }[] };
    const codes = body.codes;
    if (!Array.isArray(codes)) return NextResponse.json({ error: "codes가 필요합니다." }, { status: 400 });
    await withDbWrite(async (txn) => {
      await txn.run(`DELETE FROM quote_situation_codes`);
      let i = 1;
      for (const c of codes) {
        const code = String(c.code ?? "").trim();
        if (!code) continue;
        await txn.run(`INSERT INTO quote_situation_codes (code, label, sort, enabled) VALUES ($1, $2, $3, $4) ON CONFLICT (code) DO NOTHING`, [
          code,
          String(c.label ?? code),
          i++,
          c.enabled === false ? 0 : 1,
        ]);
      }
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
