import { requireBriefingPermission } from "@/lib/intel/briefing-api-access";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";
import { assertBriefingAccess, getBriefingRun } from "@/lib/intel/briefing-store";
import { listBriefingDeliveries } from "@/lib/intel/briefing-delivery";
import { getBriefing } from "@/lib/intel/rag-queries";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function GET(_req: NextRequest, c: { params: Promise<{ runId: string }> }) { try { const a = await requireBriefingPermission("view"); const run = await getBriefingRun((await c.params).runId, a.userId); if(run.briefingId) await assertBriefingAccess(run.briefingId,a.userId); return NextResponse.json({ run, briefing: run.briefingId ? await getBriefing(run.briefingId, a.userId) : null, deliveries: await listBriefingDeliveries(run.runId, a.userId) }); } catch (e) { return authErrorToResponse(e); } }
