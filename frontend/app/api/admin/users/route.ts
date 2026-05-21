import { NextRequest, NextResponse } from "next/server";
import { requireRole, authErrorToResponse } from "@/lib/auth/guards";
import { createUser, listUsers } from "@/lib/auth/users";
import { recordAuditLog } from "@/lib/auth/audit";
import type { Role } from "@/lib/auth/users";

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

interface CreateBody {
  email: string;
  password: string;
  name: string;
  role: Role;
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole("admin");
    const body = (await req.json()) as CreateBody;
    if (!body?.email || !body?.password || !body?.name || !body?.role) {
      return NextResponse.json(
        { error: "email, password, name, role 모두 필요합니다." },
        { status: 400 }
      );
    }
    if (body.password.length < 8) {
      return NextResponse.json(
        { error: "비밀번호는 최소 8자 이상이어야 합니다." },
        { status: 400 }
      );
    }
    const created = await createUser({
      email: body.email,
      password: body.password,
      name: body.name,
      role: body.role,
      createdBy: ctx.userId,
    });
    await recordAuditLog({
      actorUserId: ctx.userId,
      action: "user_create",
      targetTable: "users",
      targetId: created.userId,
      after: { email: created.email, role: created.role, name: created.name },
    });
    return NextResponse.json({ user: created });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
