import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { CATALOG_CATEGORIES } from "./areas";
import { MANUAL_ID_PREFIX, type CatalogProjectRow, type DisplayOverride, type ManualProject } from "./appendix";
import { regionGroupId } from "./regions";

/*
 * 계약 없는 실적(310 catalog_manual_projects) — 정식 계약 없이 수행한 실적을 회사소개서 지표·부록에만 넣는다.
 * 계약 관리(수주·매출·수금) 집계에는 들어가지 않는다. 예: 석문에너지 통합환경허가 — 한국종합기술 위임, 대금만 수령(10-22).
 * listCatalogProjects 가 이 행을 계약 행과 같은 모양(CatalogProjectRow, contractId="manual:{id}")으로 합친다.
 */

const s = (v: unknown): string => (v == null ? "" : String(v).trim());

function mapManual(r: Record<string, unknown>): ManualProject {
  const override = s(r.display_override);
  return {
    manualId: s(r.manual_id),
    category: s(r.category),
    subtype: s(r.subtype),
    title: s(r.title),
    displayTitle: s(r.display_title),
    counterpartyName: s(r.counterparty_name),
    siteName: s(r.site_name),
    regionSido: s(r.region_sido),
    industry: s(r.industry),
    startedAt: s(r.started_at),
    endedAt: s(r.ended_at),
    status: s(r.status) === "ongoing" ? "ongoing" : "completed",
    permitIssuedAt: s(r.permit_issued_at),
    permitNo: s(r.permit_no),
    siteCount: r.site_count != null && Number(r.site_count) >= 1 ? Number(r.site_count) : null,
    amount: r.amount != null && Number.isFinite(Number(r.amount)) ? Number(r.amount) : null,
    displayOverride: (override === "always" || override === "never" ? override : "auto") as DisplayOverride,
    isPublic: Number(r.is_public ?? 1) === 1,
    isFeatured: Number(r.is_featured ?? 0) === 1,
    groupKey: s(r.group_key),
    note: s(r.note),
  };
}

export async function listManualProjects(): Promise<ManualProject[]> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec("SELECT * FROM catalog_manual_projects ORDER BY COALESCE(started_at, created_at) ASC, title ASC"));
  return rows.map(mapManual);
}

/** 계약 없는 실적 → 부록 원천 행. 완료일 = 허가일, 없으면 완료 상태일 때 종료일(없으면 '완료'). */
export function manualToProjectRow(m: ManualProject): CatalogProjectRow {
  const ym = (v: string) => (/^\d{4}-\d{2}/.test(v) ? v : "");
  const contractDate = ym(m.startedAt) || ym(m.endedAt) || ym(m.permitIssuedAt);
  const completedAt = m.permitIssuedAt || (m.status === "completed" ? m.endedAt || "완료" : "");
  return {
    contractId: MANUAL_ID_PREFIX + m.manualId,
    source: "manual",
    contractTitle: m.title,
    category: (CATALOG_CATEGORIES as readonly string[]).includes(m.category) ? m.category : "기타 용역",
    subtype: m.subtype,
    contractDate,
    year: contractDate.slice(0, 4),
    startedAt: m.startedAt,
    endedAt: m.endedAt,
    amount: m.amount,
    isUnitPrice: false,
    counterpartyName: m.counterpartyName,
    siteName: m.siteName,
    regionSido: m.regionSido,
    regionGroup: regionGroupId(m.regionSido),
    industryCategory: m.industry,
    industryName: "",
    industryCode: "",
    permitIssuedAt: m.permitIssuedAt.slice(0, 10),
    permitNo: m.permitNo,
    completedAt,
    meta: {
      displayTitle: m.displayTitle,
      displayIndustry: "",
      isPublic: m.isPublic,
      isFeatured: m.isFeatured,
      displayOverride: m.displayOverride,
      groupKey: m.groupKey,
      note: m.note,
      siteCount: m.siteCount,
      // 직접 입력한 실적이라 검토가 끝난 것으로 본다(미검토 배지 없음)
      reviewedAt: "manual",
    },
  };
}

const dateOrEmpty = (v: unknown): string => {
  const t = s(v);
  if (!t) return "";
  const m = t.match(/^(\d{4})\D?(\d{1,2})(?:\D?(\d{1,2}))?/);
  if (!m) throw Object.assign(new Error(`날짜 형식을 확인하세요: ${t} (YYYY-MM-DD 또는 YYYY-MM)`), { status: 400 });
  const mm = m[2].padStart(2, "0");
  return m[3] ? `${m[1]}-${mm}-${m[3].padStart(2, "0")}` : `${m[1]}-${mm}`;
};

export async function saveManualProject(input: Partial<ManualProject>, actorUserId: string | null): Promise<string> {
  const title = s(input.title);
  if (!title) throw Object.assign(new Error("실적 이름을 입력하세요."), { status: 400 });
  const category = s(input.category);
  if (!(CATALOG_CATEGORIES as readonly string[]).includes(category)) {
    throw Object.assign(new Error("분류를 고르세요."), { status: 400 });
  }
  const manualId = s(input.manualId) || "cmp_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const siteCount = input.siteCount == null ? NaN : Math.round(Number(input.siteCount));
  const amount = input.amount == null ? NaN : Number(input.amount);
  const override = input.displayOverride === "always" || input.displayOverride === "never" ? input.displayOverride : "auto";
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    await txn.run(
      `INSERT INTO catalog_manual_projects
         (manual_id, category, subtype, title, display_title, counterparty_name, site_name, region_sido, industry,
          started_at, ended_at, status, permit_issued_at, permit_no, site_count, amount,
          display_override, is_public, is_featured, group_key, note, created_at, created_by, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $22, $23)
       ON CONFLICT (manual_id) DO UPDATE SET
         category = EXCLUDED.category, subtype = EXCLUDED.subtype, title = EXCLUDED.title, display_title = EXCLUDED.display_title,
         counterparty_name = EXCLUDED.counterparty_name, site_name = EXCLUDED.site_name, region_sido = EXCLUDED.region_sido,
         industry = EXCLUDED.industry, started_at = EXCLUDED.started_at, ended_at = EXCLUDED.ended_at, status = EXCLUDED.status,
         permit_issued_at = EXCLUDED.permit_issued_at, permit_no = EXCLUDED.permit_no, site_count = EXCLUDED.site_count,
         amount = EXCLUDED.amount, display_override = EXCLUDED.display_override, is_public = EXCLUDED.is_public,
         is_featured = EXCLUDED.is_featured, group_key = EXCLUDED.group_key, note = EXCLUDED.note,
         updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
      [
        manualId,
        category,
        s(input.subtype).slice(0, 50) || null,
        title.slice(0, 300),
        s(input.displayTitle).slice(0, 500) || null,
        s(input.counterpartyName).slice(0, 200) || null,
        s(input.siteName).slice(0, 200) || null,
        s(input.regionSido).slice(0, 50) || null,
        s(input.industry).slice(0, 100) || null,
        dateOrEmpty(input.startedAt) || null,
        dateOrEmpty(input.endedAt) || null,
        input.status === "ongoing" ? "ongoing" : "completed",
        dateOrEmpty(input.permitIssuedAt) || null,
        s(input.permitNo).slice(0, 200) || null,
        Number.isFinite(siteCount) && siteCount >= 1 && siteCount <= 50 ? siteCount : null,
        Number.isFinite(amount) && amount > 0 ? amount : null,
        override,
        input.isPublic === false ? 0 : 1,
        input.isFeatured ? 1 : 0,
        s(input.groupKey).slice(0, 200) || null,
        s(input.note).slice(0, 1000) || null,
        now,
        actorUserId,
      ]
    );
  });
  return manualId;
}

export async function deleteManualProject(manualId: string): Promise<void> {
  await withDbWrite(async (txn) => {
    await txn.run("DELETE FROM catalog_manual_projects WHERE manual_id = $1", [s(manualId)]);
  });
}
