import { NextRequest, NextResponse } from "next/server";
import { getDb, rowsToObjects } from "@/lib/db";
import { runCatalogRefresh } from "@/lib/catalog/refresh/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * 회사소개서 변경 감지 틱(P7, 블루프린트 §6-7) — instrumentation.ts 가 1시간마다 자기호출.
 * 원천 지문(계약·인물·회사 프로필·연혁·인증·인사말/조직도 확정판)을 최근 발행본 지문과 비교해 반영 대기를 맞추고,
 * 새 항목이 생기면 관리·발행 담당에게 알린다(하루 한 번). 자동 발행은 하지 않는다(D4 — 발행은 검토 후 사람이).
 * ⚠ Aurora auto-pause 보호(infra/aws/ops/README.md "틱을 새로 추가할 때"): 업무 시간(KST 09~18시) 밖이면 DB 를 열지 않고 끝낸다.
 *    같은 시(KST) 안의 두 번째 호출도 프로세스 메모리로 거른다. ?force=1 은 운영 점검용(시간대·중복 판정 생략).
 */
const RUN_HOURS = { from: 9, to: 18 };
const g = globalThis as { __catalogRefreshHour?: string };

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-cron-key") ?? "";
  const secret = process.env.AUTH_SECRET ?? "";
  if (!secret || key !== secret) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const hour = kst.getUTCHours();
  const slot = kst.toISOString().slice(0, 13);
  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force) {
    if (hour < RUN_HOURS.from || hour > RUN_HOURS.to) return NextResponse.json({ ok: true, skipped: "outside-window" });
    if (g.__catalogRefreshHour === slot) return NextResponse.json({ ok: true, skipped: "done-this-hour" });
  }
  g.__catalogRefreshHour = slot;
  try {
    const db = await getDb();
    const docs = rowsToObjects(await db.exec("SELECT doc_id FROM catalog_documents WHERE status <> 'archived' ORDER BY created_at")).map((r) => String(r.doc_id));
    const results = [];
    for (const docId of docs) results.push(await runCatalogRefresh({ docId, notify: true }));
    return NextResponse.json({ ok: true, results });
  } catch (err) {
    g.__catalogRefreshHour = undefined; // 다음 틱에 다시
    console.error("[catalog-refresh-tick] 실패", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
