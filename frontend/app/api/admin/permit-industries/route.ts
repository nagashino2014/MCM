import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { getDb, withDbWrite } from "@/lib/db";
import {
  PermitIndustryInputError,
  countFacilitiesByPermitIndustry,
  createPermitIndustry,
  invalidatePermitIndustriesCache,
  loadPermitIndustriesWithSource,
  reorderPermitIndustries,
  setPermitIndustryActive,
  updatePermitIndustry,
  type PermitIndustryInput,
} from "@/lib/ieps/permit-industries-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PERM = "master.permit_industry.manage";

/** 통합허가 대상 업종 관리(/admin/permit-industries) — 목록 + 업종별 KSIC 매칭 사업장 수. */
export async function GET() {
  try {
    await requirePermission(PERM, { fallbackRoles: ["admin"] });
    invalidatePermitIndustriesCache();
    const db = await getDb();
    const { list, fromTable } = await loadPermitIndustriesWithSource(db);
    const facilityCounts = await countFacilitiesByPermitIndustry(db, list).catch(() => ({}));
    return NextResponse.json({ industries: list, fromTable, facilityCounts });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

type Body =
  | { action: "create"; industry: PermitIndustryInput }
  | { action: "update"; industry: PermitIndustryInput }
  | { action: "setActive"; id: string; active: boolean }
  | { action: "reorder"; ids: string[] };

export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission(PERM, { fallbackRoles: ["admin"] });
    const body = (await req.json().catch(() => ({}))) as Body;
    const { fromTable } = await loadPermitIndustriesWithSource();
    if (!fromTable) {
      return NextResponse.json({ error: "업종 표(325)가 아직 적용되지 않아 기본 목록으로 동작 중입니다. 마이그레이션 적용 후 편집하세요." }, { status: 409 });
    }
    let result: unknown = null;
    try {
      result = await withDbWrite(async (db) => {
        switch (body.action) {
          case "create":
            return createPermitIndustry(db, body.industry ?? { label: "" }, actor.userId);
          case "update":
            return updatePermitIndustry(db, body.industry ?? { label: "" }, actor.userId);
          case "setActive":
            await setPermitIndustryActive(db, String(body.id ?? ""), body.active === true, actor.userId);
            return null;
          case "reorder":
            await reorderPermitIndustries(db, Array.isArray(body.ids) ? body.ids : [], actor.userId);
            return null;
          default:
            throw new PermitIndustryInputError("알 수 없는 요청입니다.");
        }
      });
    } catch (err) {
      if (err instanceof PermitIndustryInputError) return NextResponse.json({ error: err.message }, { status: 400 });
      throw err;
    } finally {
      invalidatePermitIndustriesCache();
    }
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "permit_industry_change",
      targetTable: "permit_industries",
      targetId: body.action === "setActive" ? String(body.id) : body.action === "reorder" ? "reorder" : String(body.industry?.id ?? ""),
      after: body,
    });
    return NextResponse.json({ ok: true, industry: result });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
