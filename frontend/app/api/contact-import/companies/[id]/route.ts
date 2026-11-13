import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { listFacilities } from "@/lib/ieps/queries";
import { assignContactSite, loadCompanySites, registerSubSite } from "@/lib/contact-import/store";
import { suggestPersonSite } from "@/lib/contact-import/person-site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const text = (value: unknown): string | null => (value != null && value !== "" ? String(value) : null);

/**
 * 회사의 담당자 명단 — 행을 펼칠 때만 불러온다. 담당자별 배속 사업장과 같은 회사의 산하 사업장 후보·추천을 함께 준다.
 * ?q= 이면 담당자 배속용 사업장 직접 검색 결과만 준다.
 */
export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    await requirePermission("facility.edit");
    const { id } = await ctx.params;
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
    if (req.nextUrl.searchParams.has("q")) {
      if (q.length < 2) return NextResponse.json({ items: [] });
      const result = await listFacilities({ q, sort: "name", limit: 15, offset: 0 });
      return NextResponse.json({
        items: result.items.map((f) => ({ facilityId: f.facilityId, companyName: f.companyName, address: f.siteAddress ?? null })),
      });
    }
    const db = await getDb();
    const company = rowsToObjects(await db.exec(`SELECT * FROM contact_import_companies WHERE company_id = $1`, [id]))[0];
    if (!company) return NextResponse.json({ error: "회사를 찾을 수 없습니다." }, { status: 404 });
    const rows = rowsToObjects(await db.exec(
      `SELECT id, person_name, title, department, office_phone, mobile_phone, fax_number, email, address, facility_id, status
         FROM contact_import_rows WHERE company_id = $1 ORDER BY person_name ASC, id ASC`,
      [id]
    ));
    const decided = text(company.decided_facility_id);
    const chosenIds = [...new Set(rows.map((r) => text(r.facility_id)).filter((v): v is string => !!v))];
    const sites = await loadCompanySites(db, company, chosenIds);
    const displayName = String(company.display_name);
    const contacts = rows.map((r) => {
      const facilityId = text(r.facility_id);
      const suggestion = suggestPersonSite({ department: text(r.department), address: text(r.address) }, sites, displayName);
      return {
        id: Number(r.id),
        personName: String(r.person_name),
        title: text(r.title),
        department: text(r.department),
        officePhone: text(r.office_phone),
        mobilePhone: text(r.mobile_phone),
        email: text(r.email),
        address: text(r.address),
        status: String(r.status),
        // "" = 회사 분류대로. 옮겨진 담당자가 회사 사업장에 있으면 "" 로 보인다.
        siteId: facilityId && facilityId !== decided ? facilityId : "",
        suggestion: suggestion && suggestion.facilityId !== (facilityId ?? decided) ? suggestion : null,
      };
    });
    return NextResponse.json({
      contacts,
      decidedFacilityId: decided,
      sites: sites.map((s) => ({ facilityId: s.facilityId, companyName: s.companyName, address: s.address, kind: s.kind })),
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 담당자 한 명의 배속 사업장 바꾸기. facilityId 가 비면 회사 분류대로. */
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("facility.edit");
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { rowId?: number; facilityId?: string | null };
    const rowId = Number(body.rowId);
    if (!Number.isInteger(rowId) || rowId <= 0) return NextResponse.json({ error: "담당자를 고르세요." }, { status: 400 });
    const result = await withDbWrite((db) => assignContactSite(db, id, rowId, text(body.facilityId), actor.userId));
    if (result.status !== "ok") return NextResponse.json({ error: result.reason }, { status: 409 });
    return NextResponse.json(result);
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 산하 사업장 등록 — 마스터에 없는 공장·지사를 여기서 바로 만든다. */
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("facility.edit");
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { companyName?: string; address?: string | null; brn?: string | null; baseFacilityId?: string | null };
    const companyName = String(body.companyName ?? "").trim();
    if (!companyName) return NextResponse.json({ error: "사업장 이름을 적어 주세요." }, { status: 400 });
    const result = await withDbWrite((db) => registerSubSite(db, id, {
      companyName, address: text(String(body.address ?? "").trim()), brn: text(String(body.brn ?? "").replace(/\D/g, "")), baseFacilityId: text(body.baseFacilityId),
    }, actor.userId));
    return NextResponse.json(result);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
