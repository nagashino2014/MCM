import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { autoAssignCompanySites, COMPANY_STAGE_SQL, COMPANY_STAGES, decideCompany, type CompanyStage, type DecisionItem } from "@/lib/contact-import/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// sites = 분류한 회사의 담당자를 추천 산하 사업장으로 자동 배속(분류는 바꾸지 않는다).
const DECISIONS = ["link", "partner", "other", "exclude", "reopen", "sites"];

/** 회사 단위 검토 목록. 담당자 개인정보는 싣지 않고 수만 준다(상세는 [id]). */
export async function GET(req: NextRequest) {
  try {
    await requirePermission("facility.edit");
    const params = req.nextUrl.searchParams;
    const stageParam = params.get("stage") ?? "connect";
    const stage: CompanyStage = (COMPANY_STAGES as readonly string[]).includes(stageParam) ? (stageParam as CompanyStage) : "connect";
    const q = (params.get("q") ?? "").trim();
    const limit = Math.min(Math.max(Number(params.get("limit")) || 50, 1), 200);
    const offset = Math.max(Number(params.get("offset")) || 0, 0);
    const db = await getDb();
    const counts: Record<string, number> = {};
    for (const row of rowsToObjects(await db.exec(`SELECT ${COMPANY_STAGE_SQL} AS stage, COUNT(*)::int AS n FROM contact_import_companies GROUP BY 1`))) {
      counts[String(row.stage)] = Number(row.n);
    }
    const where = `(${COMPANY_STAGE_SQL}) = $1 AND ($2 = '' OR display_name ILIKE '%' || $2 || '%')`;
    const total = Number(rowsToObjects(await db.exec(`SELECT COUNT(*)::int AS n FROM contact_import_companies WHERE ${where}`, [stage, q]))[0]?.n ?? 0);
    const companies = rowsToObjects(await db.exec(
      `SELECT c.company_id, c.display_name, c.address, c.region_sido, c.region_sigungu, c.homepage_url, c.email_domain, c.suggested_category,
              c.match_candidates, c.search_status, c.search_outcomes, c.search_candidates, c.search_verdict, c.found_brn, c.search_note,
              c.decision, c.decided_facility_id, c.decided_at,
              f.company_name AS decided_facility_name,
              (SELECT COUNT(*)::int FROM contact_import_rows r WHERE r.company_id = c.company_id) AS contact_count
         FROM contact_import_companies c
         LEFT JOIN facilities f ON f.facility_id = c.decided_facility_id
        WHERE ${where}
        ORDER BY contact_count DESC, c.display_name ASC
        LIMIT $3 OFFSET $4`,
      [stage, q, limit, offset]
    )).map((r) => ({
      companyId: String(r.company_id),
      displayName: String(r.display_name),
      address: r.address != null ? String(r.address) : null,
      region: [r.region_sido, r.region_sigungu].filter(Boolean).join(" ") || null,
      homepage: r.homepage_url != null ? String(r.homepage_url) : null,
      emailDomain: r.email_domain != null ? String(r.email_domain) : null,
      suggestedCategory: r.suggested_category != null ? String(r.suggested_category) : null,
      matchCandidates: r.match_candidates ?? [],
      searchStatus: String(r.search_status ?? ""),
      searchOutcomes: r.search_outcomes ?? {},
      searchCandidates: r.search_candidates ?? [],
      searchVerdict: r.search_verdict != null ? String(r.search_verdict) : null,
      foundBrn: r.found_brn != null ? String(r.found_brn) : null,
      searchNote: r.search_note != null ? String(r.search_note) : null,
      decision: r.decision != null ? String(r.decision) : null,
      decidedName: r.decided_facility_name != null ? String(r.decided_facility_name) : null,
      contactCount: Number(r.contact_count ?? 0),
    }));
    return NextResponse.json({ stage, counts, total, companies });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 관리자 분류. 회사마다 따로 저장해 일부가 건너뛰어져도 나머지는 반영된다. */
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("facility.edit");
    const body = (await req.json().catch(() => ({}))) as { items?: (Omit<DecisionItem, "action"> & { action: DecisionItem["action"] | "sites" })[] };
    const items = Array.isArray(body.items) ? body.items.slice(0, 200) : [];
    if (!items.length) return NextResponse.json({ error: "분류할 회사를 고르세요." }, { status: 400 });
    if (items.some((item) => !item.companyId || !DECISIONS.includes(item.action))) {
      return NextResponse.json({ error: "분류 값이 올바르지 않습니다." }, { status: 400 });
    }
    const results = [];
    for (const item of items) {
      const result = await withDbWrite((db) => item.action === "sites"
        ? autoAssignCompanySites(db, item.companyId, actor.userId)
        : decideCompany(db, item as DecisionItem, actor.userId));
      results.push({ companyId: item.companyId, ...result });
    }
    return NextResponse.json({ results });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
