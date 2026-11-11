import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listUnlistedCompanies, resolveUnlistedCompany } from "@/lib/approval/unlisted-companies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 미계약 업체(직접 입력) 목록 — 업체별 문서·접견인·기존 업체 후보·명함 요청 상태(운영자용).
export async function GET() {
  try {
    await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    return NextResponse.json(await listUnlistedCompanies());
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST: 업체 한 곳 정리 — 기존 업체에 연결(link)하거나 새로 등록(create)하고 그 업체의 문서를 모두 연결한다.
//   body = { key, action: "link"|"create", facilityId?, listing?: "other"|"master", addContacts?: boolean }
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const key = String(body.key ?? "").trim();
    const action = body.action === "link" ? "link" : body.action === "create" ? "create" : null;
    if (!key || !action) return NextResponse.json({ error: "정리할 업체와 처리 방법(연결·신규 등록)이 필요합니다." }, { status: 400 });
    try {
      const result = await resolveUnlistedCompany({
        key,
        action,
        facilityId: body.facilityId != null ? String(body.facilityId) : null,
        listing: body.listing === "master" ? "master" : "other",
        addContacts: body.addContacts !== false,
        userId: actor.userId,
      });
      return NextResponse.json({ ok: true, ...result });
    } catch (e) {
      const status = Number((e as { status?: number }).status) || 400;
      return NextResponse.json({ error: (e as Error).message }, { status });
    }
  } catch (err) {
    return authErrorToResponse(err);
  }
}
