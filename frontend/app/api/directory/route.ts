import { NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { listDirectory } from "@/lib/directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 주소록·조직도(G6-A) — 사내 임직원 디렉터리(재직자·연락처·회사메일). 로그인 전원 열람.
export async function GET() {
  try {
    await requireSession();
    return NextResponse.json(await listDirectory());
  } catch (err) {
    return authErrorToResponse(err);
  }
}
