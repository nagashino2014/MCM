import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listSalesContacts } from "@/lib/sales/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ?engagement=contract,sales — 소속 사업장이 용역/영업 진행 중인 담당자만(OR).
export async function GET(req: NextRequest) {
  try {
    // 주소록·모바일 담당자 화면도 이 API 를 쓴다 — 영업 메뉴 권한(sales.view)과 분리해 contact.view(전 직원)로 판정(298, 2026-10-19)
    await requirePermission("contact.view");
    const engagementRaw = new URL(req.url).searchParams.get("engagement");
    const engagement = engagementRaw
      ? engagementRaw
          .split(",")
          .map((s) => s.trim())
          .filter((s): s is "contract" | "sales" => s === "contract" || s === "sales")
      : undefined;
    const contacts = await listSalesContacts(engagement?.length ? { engagement } : undefined);
    return NextResponse.json({ contacts });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
