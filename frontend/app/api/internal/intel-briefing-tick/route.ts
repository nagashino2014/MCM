import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";
import { triggerDueBriefingWorker } from "@/lib/intel/briefing-scheduler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const key = req.headers.get("x-cron-key");
  if (!process.env.AUTH_SECRET || key !== process.env.AUTH_SECRET) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try { return NextResponse.json(await triggerDueBriefingWorker()); } catch (error) { return authErrorToResponse(error); }
}
