import { NextRequest, NextResponse } from "next/server";
import { withDbWrite } from "@/lib/db";
import { ingestCapsEventFiles } from "@/lib/adt/events";
import { ingestStaging } from "@/lib/adt/ingest";
import { recordHeartbeat } from "@/lib/ops/heartbeat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 캡스 근태 이벤트 로그(txt) 반입구 — 사내 수집기(scripts/collect-caps-local.mjs)가
 * export 폴더의 파일 원문을 올린다(gosi-eum-ingest 와 동일한 AUTH_SECRET 헤더 가드).
 * 파싱 → adt_event_raw 적재 → (사번, 일자) 집계 → 스테이징 → 일별·주별 산정까지 동기 처리.
 * 전 단계 멱등이라 같은 파일 재전송에 안전하다.
 */
export async function POST(req: NextRequest) {
  const key = req.headers.get("x-cron-key") ?? "";
  const secret = process.env.AUTH_SECRET ?? "";
  if (!secret || key !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const body = (await req.json().catch(() => ({}))) as { files?: unknown; heartbeat?: unknown };
    // 외부 연동 감시(316) — 수집기는 보낼 파일이 없어도 매시 심장박동만 보낸다(수집기·사내 PC 생존 확인).
    if (body.heartbeat === true) {
      await recordHeartbeat("adt.collector", { ok: true, detail: { files: 0 } });
      return NextResponse.json({ ok: true, heartbeat: true });
    }
    const rawFiles = Array.isArray(body.files) ? body.files : [];
    const files = rawFiles
      .filter((f): f is { name?: unknown; content?: unknown } => !!f && typeof f === "object")
      .map((f) => ({ name: String(f.name ?? ""), content: typeof f.content === "string" ? f.content : "" }))
      .filter((f) => f.content !== "");
    if (!files.length) return NextResponse.json({ error: "files가 비어 있습니다." }, { status: 400 });
    if (files.length > 200) return NextResponse.json({ error: "files가 너무 많습니다(최대 200)." }, { status: 400 });
    const totalBytes = files.reduce((s, f) => s + f.content.length, 0);
    if (totalBytes > 20_000_000) return NextResponse.json({ error: "본문이 너무 큽니다(최대 20MB)." }, { status: 400 });

    const result = await withDbWrite(async (db) => {
      const events = await ingestCapsEventFiles(db, files);
      // 변경된 (사번, 일자)만 processed=false 라 산정은 실제 변경분에 대해서만 돈다.
      const ing = await ingestStaging(db, {});
      return { ...events, ...ing };
    });
    console.log("[adt-events-ingest]", JSON.stringify(result));
    await recordHeartbeat("adt.collector", { ok: true, detail: { files: files.length } });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[adt-events-ingest] error", err);
    await recordHeartbeat("adt.collector", { ok: false, error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
