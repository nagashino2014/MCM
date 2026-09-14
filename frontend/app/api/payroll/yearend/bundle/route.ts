import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin } from "@/lib/auth/guards";
import { recordAccessLog } from "@/lib/auth/access-log";
import { buildYearendBundle } from "@/lib/finance/yearend-self";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ATTACH = "attachment; filename*=UTF-8'" + "'";

/** 관리자 — 세무사 제출용 바인딩(zip): 직원 업로드 자료 + 원본 영수증 + 정산 요약 CSV. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAdmin();
    const year = Number(req.nextUrl.searchParams.get("year") ?? 0);
    if (!year) return NextResponse.json({ error: "year 가 필요합니다." }, { status: 400 });
    const out = await buildYearendBundle(year);
    await recordAccessLog({ actorUserId: ctx.userId, action: "export", targetKind: "yearend", targetId: String(year) });
    return new NextResponse(new Uint8Array(out.zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": ATTACH + encodeURIComponent(out.fileName),
        "X-Bundle-Files": String(out.files),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
