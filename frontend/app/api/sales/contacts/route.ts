import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listSalesContacts } from "@/lib/sales/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePermission("sales.view");
    const contacts = await listSalesContacts();
    return NextResponse.json({ contacts });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
