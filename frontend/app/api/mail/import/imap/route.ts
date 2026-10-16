import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { testImapImport } from "@/lib/mail/import/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 메일 가져오기(I-3) — IMAP 연결 확인 + 폴더 목록. body: { preset | host·port, user, password }
// 비밀번호는 이 요청 안에서만 쓰고 저장하지 않는다. 인증 실패는 자동으로 다시 시도하지 않는다(원 서버 계정 잠김 방지).
export async function POST(req: NextRequest) {
  try {
    await requireSession();
    const body = (await req.json().catch(() => ({}))) as { preset?: string; host?: string; port?: number; user?: string; password?: string };
    const folders = await testImapImport({
      preset: body.preset,
      host: body.host,
      port: typeof body.port === "number" ? body.port : undefined,
      user: body.user,
      password: body.password,
    });
    return NextResponse.json({ folders });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
