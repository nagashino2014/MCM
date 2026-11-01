import { requireBriefingPermission } from "@/lib/intel/briefing-api-access";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";
import { getBriefingProfile } from "@/lib/intel/briefing-store";
import { buildBriefingEvidence } from "@/lib/intel/briefing-evidence";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function POST(_req: NextRequest, c: { params: Promise<{ profileId: string }> }) { try { const a = await requireBriefingPermission("view"); const p = await getBriefingProfile((await c.params).profileId, a.userId); const preview = await buildBriefingEvidence(p); return NextResponse.json({ preview: { ...preview, items: preview.items.slice(0, 30) } }); } catch (e) { return authErrorToResponse(e); } }
