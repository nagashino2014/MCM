import { NextRequest, NextResponse } from "next/server";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { generateMissingCardSlips } from "@/lib/finance/card-slip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 법인카드 전자 전표 생성 틱 — instrumentation.ts 주기 타이머가 자기호출(1시간).
 * 실제 생성은 야간(KST 02~04시)에 일 1회만 한다(사용자 확정: 작성 중 대기 제거가 목적이므로
 * 업무 시간에 돌 이유가 없다). 시간대 밖이면 DB 조회 없이 즉시 종료 — Aurora auto-pause 보호.
 * 멱등: card_slip_runs 의 마지막 실행일(KST)로 판정. 1회 상한 500건 — 초과분은 다음 날 이어서.
 */
const RUN_HOURS = [2, 3, 4];
const BATCH_LIMIT = 500;

function kstParts(): { date: string; hour: number } {
  const k = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return { date: k.toISOString().slice(0, 10), hour: k.getUTCHours() };
}

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-cron-key") ?? "";
  const secret = process.env.AUTH_SECRET ?? "";
  if (!secret || key !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { date, hour } = kstParts();
  // 강제 실행(운영 점검) — ?force=1 이면 시간대·일 1회 판정을 건너뛴다.
  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && !RUN_HOURS.includes(hour)) {
    return NextResponse.json({ ok: true, skipped: "outside-window" });
  }
  try {
    const db = await getDb();
    if (!force) {
      const last = rowsToObjects(await db.exec(`SELECT ran_at FROM card_slip_runs ORDER BY run_id DESC LIMIT 1`));
      if (last.length && String(last[0].ran_at).slice(0, 10) === date) {
        return NextResponse.json({ ok: true, skipped: "already-ran-today" });
      }
    }
    const { created, failed } = await generateMissingCardSlips(BATCH_LIMIT);
    await withDbWrite(async (w) => {
      await w.run(`INSERT INTO card_slip_runs (created, failed, note) VALUES ($1, $2, $3)`, [
        created,
        failed,
        force ? "force" : null,
      ]);
    });
    return NextResponse.json({ ok: true, created, failed });
  } catch (err) {
    console.error("[card-slip-tick] 실패", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
