import { requireBriefingPermission } from "@/lib/intel/briefing-api-access";
import { NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";
import { getBriefingCapabilities } from "@/lib/intel/briefing-access";
import { briefingError } from "@/lib/intel/briefing-schedule";
import { getDb, rowsToObjects } from "@/lib/db";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function GET() { try { const actor = await requireBriefingPermission("view"); const caps = await getBriefingCapabilities(actor.userId); if(!caps.canCreate && !caps.canShare) throw briefingError("수신자를 지정할 권한이 없습니다.",403); const db = await getDb(); const rows = rowsToObjects(await db.exec("SELECT user_id,name,email FROM users WHERE status='active' ORDER BY name LIMIT 1000")); const users = []; for (const row of rows) if ((await getBriefingCapabilities(String(row.user_id))).canView) users.push({ userId: String(row.user_id), name: String(row.name ?? row.email), email: String(row.email ?? "") }); return NextResponse.json({ users }); } catch (e) { return authErrorToResponse(e); } }
