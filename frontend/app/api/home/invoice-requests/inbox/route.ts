import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listInvoiceRequestInbox } from "@/lib/home/invoice-requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** H11 — 발행 요청됨(& 미발행) 대금단위 수신함. 회계 담당자용(billing.receivable.manage). */
export async function GET() {
  try {
    await requirePermission("billing.receivable.manage", { fallbackRoles: ["editor"] });
    const items = await listInvoiceRequestInbox();
    return NextResponse.json({ items });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
