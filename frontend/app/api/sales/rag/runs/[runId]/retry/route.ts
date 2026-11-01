import { requireBriefingPermission } from "@/lib/intel/briefing-api-access";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";
import { retryBriefingRun } from "@/lib/intel/briefing-delivery";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function POST(req: NextRequest, c: { params: Promise<{ runId: string }> }) { try { const a = await requireBriefingPermission("create"); const b = await req.json().catch(() => ({})); await retryBriefingRun((await c.params).runId, a.userId, b.resendUnknown === true); return NextResponse.json({ ok: true }); } catch (e) { return authErrorToResponse(e); } }
