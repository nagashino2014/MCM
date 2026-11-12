/*
 * 법인차량 예약 겹침 조회(서버) — 출장신청서 상신 사전검토(lib/approval/precheck.ts)와
 * 직접 예약 저장(lib/assets/store.ts)이 같은 기준으로 막는다. 규칙: lib/assets/vehicle-booking-rules.ts
 * 출장 차량은 진행 중(가예약)·승인(확정) 문서만 예약으로 본다. 레거시 문자열 차량 값은 자산 이름으로 맞춘다
 * (⚠ 자산 이름을 바꾸면 옛 문서와의 매칭이 끊긴다).
 */
import { rowsToObjects, type PgDatabase } from "@/lib/db";
import { TRIP_FORM_ID, extractVehicleUse } from "@/lib/approval/trip";
import { formatVehicleSlot, tripVehicleSlot, vehicleSlotsOverlap, type VehicleSlot } from "@/lib/assets/vehicle-booking-rules";

export interface VehicleBookingConflict {
  kind: "reservation" | "trip";
  slot: VehicleSlot;
  userName: string | null;
  docId: string | null;
  docNo: string | null;
  /** 진행 중(가예약) | 승인(확정) — 출장만 */
  docStatus: string | null;
}

/** 겹침 한 건을 사람이 읽을 문장으로. */
export function describeVehicleConflict(c: VehicleBookingConflict): string {
  const when = formatVehicleSlot(c.slot);
  const who = c.userName ? `${c.userName} ` : "";
  if (c.kind === "reservation") return `${when} ${who}직접 예약`;
  const state = c.docStatus === "approved" ? "승인" : "결재 중";
  return `${when} ${who}출장신청서${c.docNo ? ` ${c.docNo}` : ""}(${state})`;
}

/**
 * 한 차량의 주어진 구간과 겹치는 기존 예약(직접 예약 + 상신·승인 출장)을 찾는다.
 * assetId 가 없으면(레거시 문자열 값) 자산 이름으로 찾는다. excludeDocId 는 상신하려는 출장 문서 자신.
 */
export async function findVehicleBookingConflicts(
  db: PgDatabase,
  params: { assetId: string | null; assetName: string; slot: VehicleSlot; excludeDocId?: string | null }
): Promise<VehicleBookingConflict[]> {
  const assets = rowsToObjects(await db.exec(`SELECT asset_id, name FROM reservable_assets WHERE kind = 'vehicle'`));
  const idByName = new Map(assets.map((a) => [String(a.name), String(a.asset_id)]));
  const assetId = params.assetId ?? idByName.get(params.assetName) ?? null;
  const sameVehicle = (id: string | null, name: string) => {
    const resolved = id ?? idByName.get(name) ?? null;
    return assetId && resolved ? resolved === assetId : name === params.assetName;
  };
  const { startDate, endDate } = params.slot;
  const out: VehicleBookingConflict[] = [];

  // 1) 직접 예약(같은 차량, 날짜 범위 안)
  if (assetId) {
    const rows = rowsToObjects(
      await db.exec(
        `SELECT r.reserved_on, r.start_time, r.end_time, COALESCE(ep.name, u.email) AS user_name
           FROM asset_reservations r
           LEFT JOIN users u ON u.user_id = r.reserved_by
           LEFT JOIN employee_profiles ep ON ep.user_id = r.reserved_by
          WHERE r.asset_id = $1 AND r.reserved_on BETWEEN $2 AND $3
          ORDER BY r.reserved_on, r.start_time NULLS FIRST`,
        [assetId, startDate, endDate]
      )
    );
    for (const r of rows) {
      const slot: VehicleSlot = {
        startDate: String(r.reserved_on),
        endDate: String(r.reserved_on),
        startTime: r.start_time != null ? String(r.start_time) : null,
        endTime: r.end_time != null ? String(r.end_time) : null,
      };
      if (!vehicleSlotsOverlap(params.slot, slot)) continue;
      out.push({ kind: "reservation", slot, userName: r.user_name != null ? String(r.user_name) : null, docId: null, docNo: null, docStatus: null });
    }
  }

  // 2) 다른 출장(진행 중·승인, 기간이 걸치는 문서)
  const trips = rowsToObjects(
    await db.exec(
      `SELECT d.doc_id, d.doc_no, d.status, d.field_values, COALESCE(ep.name, d.drafter_name) AS user_name
         FROM approval_docs d
         LEFT JOIN employee_profiles ep ON ep.employee_id = d.drafter_employee_id
        WHERE d.form_id = $1
          AND d.status IN ('in_progress', 'approved')
          AND d.doc_id <> COALESCE($4::text, '')
          AND (d.field_values->'trip_period'->>'from') <= $3
          AND COALESCE(NULLIF(d.field_values->'trip_period'->>'to', ''),
                       d.field_values->'trip_period'->>'from') >= $2
        ORDER BY d.field_values->'trip_period'->>'from'`,
      [TRIP_FORM_ID, startDate, endDate, params.excludeDocId ?? null]
    )
  );
  for (const r of trips) {
    let values: Record<string, unknown> = {};
    try {
      const v = typeof r.field_values === "string" ? JSON.parse(r.field_values) : r.field_values;
      if (v && typeof v === "object") values = v as Record<string, unknown>;
    } catch {
      continue;
    }
    const use = extractVehicleUse(values);
    if (!use || !sameVehicle(use.assetId, use.assetName)) continue;
    const slot = tripVehicleSlot(use);
    if (!vehicleSlotsOverlap(params.slot, slot)) continue;
    out.push({
      kind: "trip",
      slot,
      userName: r.user_name != null ? String(r.user_name) : null,
      docId: String(r.doc_id),
      docNo: r.doc_no != null ? String(r.doc_no) : null,
      docStatus: String(r.status),
    });
  }
  return out;
}
