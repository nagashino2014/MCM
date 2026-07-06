import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { collectDartSignals } from "@/lib/intel/collect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DART 정형 신호 수동 수집(증분). 자동 폴링은 후속(EventBridge→HTTP).
export async function POST() {
  try {
    await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const result = await collectDartSignals();
    return NextResponse.json(result);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
