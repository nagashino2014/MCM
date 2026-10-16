import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 연관 용역/사업장 검색(2026-10-16) — 지출 내역 표의 '연관 용역/사업장' 열·법인카드 불러오기·영수증 등록이 쓴다.
 * 계약·사업장 목록 API 는 contract.view/facility.view 가 필요해 일반 직원이 못 쓸 수 있어, 결재 권한만으로
 * 선택에 필요한 최소 정보(이름·ID)만 돌려준다.
 *   · 용역 우선 — 진행 중 계약을 먼저, 그다음 최근 계약일 순. 용역의 사업장 = 대상 사업장(없으면 발주처).
 *   · 사업장 — 계약 전 영업 출장처럼 용역이 없을 때 고른다(검색어가 있을 때만).
 * 검색어가 없으면 최근 진행 중 용역만 보여 준다.
 */
export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.view");
    const q = String(req.nextUrl.searchParams.get("q") ?? "").trim();
    const limit = Math.min(30, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? "15") || 15));
    const db = await getDb();
    const like = `%${q}%`;

    const contracts = rowsToObjects(
      await db.exec(
        `SELECT c.contract_id,
                c.contract_title,
                COALESCE(NULLIF(c.contract_date, ''), c.started_at) AS contract_date,
                c.contract_status,
                COALESCE(c.facility_id, c.counterparty_facility_id) AS facility_id,
                COALESCE(tf.company_name, cp.company_name) AS facility_name,
                cp.company_name AS counterparty_name
           FROM contracts c
           LEFT JOIN facilities tf ON tf.facility_id = c.facility_id
           LEFT JOIN facilities cp ON cp.facility_id = c.counterparty_facility_id
          WHERE c.deleted_at IS NULL
            AND ($1 = '' OR c.contract_title ILIKE $2 OR cp.company_name ILIKE $2 OR tf.company_name ILIKE $2)
          ORDER BY (c.contract_status = 'active' AND NULLIF(c.contract_terminated_at, '') IS NULL) DESC,
                   COALESCE(NULLIF(c.contract_date, ''), c.started_at, c.created_at) DESC
          LIMIT $3`,
        [q, like, limit]
      )
    );

    const facilities = q
      ? rowsToObjects(
          await db.exec(
            `SELECT f.facility_id, f.company_name, f.region_sido, f.region_sigungu
               FROM facilities f
              WHERE f.company_name ILIKE $1
              ORDER BY (f.company_name = $2) DESC, LENGTH(f.company_name), f.company_name
              LIMIT $3`,
            [like, q, limit]
          )
        )
      : [];

    return NextResponse.json({
      contracts: contracts.map((r) => ({
        contractId: String(r.contract_id),
        title: String(r.contract_title ?? ""),
        contractDate: r.contract_date != null ? String(r.contract_date).slice(0, 10) : null,
        facilityId: r.facility_id != null ? String(r.facility_id) : null,
        facilityName: r.facility_name != null ? String(r.facility_name) : null,
        counterpartyName: r.counterparty_name != null ? String(r.counterparty_name) : null,
      })),
      facilities: facilities.map((r) => ({
        facilityId: String(r.facility_id),
        name: String(r.company_name ?? ""),
        region: [r.region_sido, r.region_sigungu].filter((v) => v != null && String(v).trim()).join(" "),
      })),
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
