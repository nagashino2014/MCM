import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireRole } from "@/lib/auth/guards";
import { provisionAccountForEmployee } from "@/lib/auth/account-provisioning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const ERROR_STATUS: Record<string, { status: number; message: string }> = {
  EMPLOYEE_NOT_FOUND: { status: 404, message: "직원을 찾을 수 없습니다." },
  ALREADY_PROVISIONED: { status: 409, message: "이미 계정이 발급된 직원입니다." },
  MISSING_REQUIRED_FOR_NO: {
    status: 400,
    message: "사번 발급에는 입사일·성별·생년월일이 모두 필요합니다.",
  },
  INVALID_HIRED_AT: { status: 400, message: "입사일 형식이 올바르지 않습니다." },
  EMPLOYEE_NAME_REQUIRED: { status: 400, message: "직원 이름이 필요합니다." },
};

// 조직 인원에게 사번 계정을 발급한다. (B 단계에서 requirePermission("account.manage") 로 교체 예정)
export async function POST(_: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireRole("admin");
    const { id } = await ctx.params;
    const result = await provisionAccountForEmployee(id, actor.userId);
    return NextResponse.json(result);
  } catch (err) {
    const mapped = ERROR_STATUS[(err as Error)?.message];
    if (mapped) return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    return authErrorToResponse(err);
  }
}
