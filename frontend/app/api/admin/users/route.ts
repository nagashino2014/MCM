import { NextResponse } from "next/server";
import { requireRole, authErrorToResponse } from "@/lib/auth/guards";
import { listUsers } from "@/lib/auth/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireRole("admin");
    const items = await listUsers();
    return NextResponse.json({ items });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// 계정 직접 생성(이메일/비밀번호)은 폐지됨. 계정은 조직 인원 발급(POST /api/admin/employees/[id]/provision-account)으로만 만든다.
export async function POST() {
  return NextResponse.json(
    { error: "계정 직접 생성은 폐지되었습니다. 사용자 등록·삭제 화면에서 조직 인원에게 계정을 발급하세요." },
    { status: 410 }
  );
}
