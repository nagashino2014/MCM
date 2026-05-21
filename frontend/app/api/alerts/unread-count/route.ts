import { NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { getAlertUnreadCount } from "@/lib/ieps/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuthenticated();
    const count = await getAlertUnreadCount();
    return NextResponse.json({ count });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
