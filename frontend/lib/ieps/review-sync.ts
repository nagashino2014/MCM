/**
 * 검수 확정 값을 facilities / permits / permit_scales / product_outputs 마스터로 sync.
 *
 * 호출처: PATCH /api/parsed-fields/[id]  (frontend/app/api/parsed-fields/[id]/route.ts)
 * - withDbWrite 트랜잭션 안에서 호출하면 잠금 중첩이 발생하므로,
 *   syncReviewedFieldInline(db, ...) 형태로 동일 db handle 을 받아 동기화한다.
 * - 사용자 정의 룰(ruleId 가 BUILTIN_RULE_IDS 에 없으면)은 sync 대상에서 제외.
 */

import type { PgDatabase } from "../db";
import { extractRegion } from "@scraper/lib/ieps/region";

const BUILTIN_RULE_IDS = new Set([
  "decision_no",
  "company_name",
  "business_registration_no",
  "site_address",
  "phone_number",
  "industry_code_name",
  "permit_date",
  "permit_scale",
  "product_output",
]);

interface SyncContext {
  attachmentId: string;
  ruleId: string;
  reviewedValue: string;
}

export interface SyncResult {
  applied: boolean;
  reason: string;
  facilityId?: string | null;
  permitId?: string | null;
}

export async function syncReviewedFieldInline(db: PgDatabase, ctx: SyncContext): Promise<SyncResult> {
  if (!BUILTIN_RULE_IDS.has(ctx.ruleId)) {
    return { applied: false, reason: "사용자 정의 룰은 sync 대상이 아님" };
  }

  // attachment → permits row 식별 (가장 확실한 키는 permits.source_attachment_id)
  let permitId: string | null = null;
  let facilityId: string | null = null;
  try {
    const r = await db.exec(
      "SELECT permit_id, facility_id FROM permits WHERE source_attachment_id = $1 LIMIT 1",
      [ctx.attachmentId]
    );
    if (r.length && r[0].values.length) {
      permitId = String(r[0].values[0][0]);
      facilityId = String(r[0].values[0][1]);
    }
  } catch {
    return { applied: false, reason: "permits 조회 실패" };
  }
  if (!permitId || !facilityId) {
    return { applied: false, reason: "해당 첨부의 permit 을 찾을 수 없음" };
  }

  const now = new Date().toISOString();
  const value = ctx.reviewedValue.trim();

  switch (ctx.ruleId) {
    case "decision_no":
      await db.run(
        "UPDATE permits SET decision_no = $1, updated_at = $2 WHERE permit_id = $3",
        [value, now, permitId]
      );
      break;
    case "permit_date":
      await db.run(
        "UPDATE permits SET permit_date = $1, updated_at = $2 WHERE permit_id = $3",
        [value, now, permitId]
      );
      break;
    case "company_name": {
      const norm = value
        .replace(/\s+/g, "")
        .replace(/[\(\)（）]/g, "")
        .trim()
        .toLowerCase();
      await db.run(
        "UPDATE facilities SET company_name = $1, normalized_company_name = $2, updated_at = $3 WHERE facility_id = $4",
        [value, norm, now, facilityId]
      );
      break;
    }
    case "business_registration_no":
      await db.run(
        "UPDATE facilities SET business_registration_no = $1, updated_at = $2 WHERE facility_id = $3",
        [value, now, facilityId]
      );
      break;
    case "site_address": {
      const normAddr = value.replace(/\s+/g, " ").trim();
      const region = extractRegion(value);
      await db.run(
        `UPDATE facilities SET site_address = $1, normalized_address = $2,
                              region_sido = $3, region_sigungu = $4, updated_at = $5
         WHERE facility_id = $6`,
        [value, normAddr, region.sido, region.sigungu, now, facilityId]
      );
      break;
    }
    case "phone_number":
      await db.run(
        "UPDATE facilities SET phone_number = $1, updated_at = $2 WHERE facility_id = $3",
        [value, now, facilityId]
      );
      break;
    case "industry_code_name": {
      // "12345 제조업" 형식 가정
      const m = /^(\d{4,5})\s*(.+)?$/.exec(value);
      if (m) {
        await db.run(
          "UPDATE facilities SET industry_code = $1, industry_name = $2, updated_at = $3 WHERE facility_id = $4",
          [m[1], (m[2] ?? "").trim() || null, now, facilityId]
        );
      } else {
        await db.run(
          "UPDATE facilities SET industry_name = $1, updated_at = $2 WHERE facility_id = $3",
          [value, now, facilityId]
        );
      }
      break;
    }
    case "permit_scale": {
      // 예: "대기 3종 1.5 톤/년" / "수질 2종 50 m³/일"
      const re = /(대기|수질)\s*([1-5])\s*종(?:\s*([\d.]+)\s*(톤\/년|m\^?3\/일|m³\/일))?/g;
      let m: RegExpExecArray | null;
      const air: { cls: number | null; amount: number | null } = { cls: null, amount: null };
      const water: { cls: number | null; amount: number | null } = { cls: null, amount: null };
      while ((m = re.exec(value)) !== null) {
        const target = m[1] === "대기" ? air : water;
        target.cls = Number(m[2]);
        if (m[3]) target.amount = Number(m[3]);
      }
      // upsert permit_scales row
      const r = await db.exec("SELECT id FROM permit_scales WHERE permit_id = $1 LIMIT 1", [permitId]);
      if (r.length && r[0].values.length) {
        await db.run(
          `UPDATE permit_scales SET
             air_class = COALESCE($1, air_class),
             air_amount_ton_per_year = COALESCE($2, air_amount_ton_per_year),
             water_class = COALESCE($3, water_class),
             wastewater_amount_m3_per_day = COALESCE($4, wastewater_amount_m3_per_day),
             source_text = $5
           WHERE permit_id = $6`,
          [air.cls, air.amount, water.cls, water.amount, value, permitId]
        );
      } else {
        await db.run(
          `INSERT INTO permit_scales (permit_id, air_class, air_amount_ton_per_year, water_class, wastewater_amount_m3_per_day, source_text)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [permitId, air.cls, air.amount, water.cls, water.amount, value]
        );
      }
      break;
    }
    case "product_output": {
      // 단순 upsert: 기존 product_outputs 1행 갱신, 없으면 추가
      const r = await db.exec("SELECT id FROM product_outputs WHERE permit_id = $1 LIMIT 1", [permitId]);
      if (r.length && r[0].values.length) {
        const existingId = Number(r[0].values[0][0]);
        await db.run(
          "UPDATE product_outputs SET product_name = $1, source_text = $2 WHERE id = $3",
          [value, value, existingId]
        );
      } else {
        await db.run(
          "INSERT INTO product_outputs (permit_id, product_name, source_text) VALUES ($1, $2, $3)",
          [permitId, value, value]
        );
      }
      break;
    }
    default:
      return { applied: false, reason: "지원되지 않는 룰", facilityId, permitId };
  }

  return { applied: true, reason: "OK", facilityId, permitId };
}
