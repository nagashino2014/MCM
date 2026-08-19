import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import {
  getRetentionPolicies,
  saveRetentionPolicies,
  RETENTION_TIERS,
  RETENTION_VALUES,
  type RetentionPolicies,
  type RetentionValue,
} from "@/lib/files/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/files/policy — 파일 저장 정책(크기 구간별 보존기간) 조회.
export async function GET() {
  try {
    await requirePermission("files.manage");
    const policies = await getRetentionPolicies();
    return NextResponse.json({ policies });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PUT /api/files/policy — 저장 정책 저장. body: { policies: { le5mb, le50mb, gt50mb } }
export async function PUT(req: NextRequest) {
  try {
    const ctx = await requirePermission("files.manage");
    const body = (await req.json().catch(() => ({}))) as { policies?: Partial<RetentionPolicies> };
    const input = body.policies ?? {};
    const policies = {} as RetentionPolicies;
    for (const tier of RETENTION_TIERS) {
      const val = input[tier];
      if (!val || !RETENTION_VALUES.includes(val as RetentionValue)) {
        return NextResponse.json({ error: "보존기간 값이 올바르지 않습니다." }, { status: 400 });
      }
      policies[tier] = val as RetentionValue;
    }
    await saveRetentionPolicies(policies, ctx.userId);
    return NextResponse.json({ ok: true, policies });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
