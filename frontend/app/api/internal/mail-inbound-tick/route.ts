import { NextRequest, NextResponse } from "next/server";
import { processInboundBatch } from "@/lib/mail/inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 코넨사인 메일 수신 틱(P2) — instrumentation.ts 주기 타이머가 자기호출(localhost).
 * 수신 SQS 를 1배치 폴링해 파싱·적재한다. AUTH_SECRET 헤더 가드.
 * 큐 미생성(인프라 미적용) 시 no-op(skipped). 처리 자체가 멱등(UNIQUE mailbox_id×rfc_message_id).
 */
export async function POST(req: NextRequest) {
  const key = req.headers.get("x-cron-key") ?? "";
  const secret = process.env.AUTH_SECRET ?? "";
  if (!secret || key !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const result = await processInboundBatch();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[mail-inbound] tick error", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
