import { NextRequest, NextResponse } from "next/server";
import { processImportTick } from "@/lib/mail/import/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 메일 가져오기 틱(I-1, 281) — instrumentation.ts 주기 타이머가 자기호출(localhost). AUTH_SECRET 헤더 가드.
 * 작업 1건을 40초 예산으로 조금씩 처리한다. 진행 위치를 항목마다 저장하므로 중단돼도 다음 틱에 이어진다.
 */
export async function POST(req: NextRequest) {
  const key = req.headers.get("x-cron-key") ?? "";
  const secret = process.env.AUTH_SECRET ?? "";
  if (!secret || key !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    return NextResponse.json(await processImportTick());
  } catch (err) {
    console.error("[mail-import] tick error", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
