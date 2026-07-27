import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { suggestRecipients } from "@/lib/directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 메일 수신자 자동완성(G6-A) — 임직원·별칭/배포리스트·외부 담당자(주소록 공유).
export async function GET(req: NextRequest) {
  try {
    await requireSession();
    const q = req.nextUrl.searchParams.get("q") ?? "";
    return NextResponse.json({ suggestions: await suggestRecipients(q) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
