/*
 * 자산 이용 현황(월 단위) — 직접 예약(asset_reservations) ∪ 출장 유래 차량(출장신청서 상신 건).
 * 자산 캘린더(/assets/reservations)와 홈 캘린더 vehicle 태그가 공유하는 단일 소스.
 * 차량은 결재 문서에서 파생되므로 이중 배정을 막지 않고 경고 플래그(conflict)만 세운다
 * (자산 가용성이 결재 흐름을 차단하면 안 된다). 직접 예약은 저장 시점에 겹침이 차단된다.
 */
import { getDb, rowsToObjects } from "@/lib/db";
import { TRIP_FORM_ID, extractVehicleUse } from "@/lib/approval/trip";
import type { AssetKind } from "@/lib/assets/types";

export interface AssetUsageItem {
  /** "resv:{reservationId}" | "doc:{docId}" */
  id: string;
  assetId: string | null; // 레거시 문자열 차량 값은 null(이름 매칭 실패 시)
  assetName: string;
  assetKind: AssetKind | null;
  source: "reservation" | "trip";
  startDate: string; // YYYY-MM-DD
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  /** 예약자(직접 예약) 또는 출장 기안자 이름 */
  userName: string | null;
  /** 예약자 user_id(직접 예약만 — 본인 취소 판정용) */
  reservedBy: string | null;
  purpose: string | null;
  docId: string | null;
  /** 같은 자산·같은 날짜에 다른 이용과 겹침(차량 이중 배정 경고) */
  conflict: boolean;
}

function overlaps(a: AssetUsageItem, b: AssetUsageItem): boolean {
  if (a.startDate > b.endDate || a.endDate < b.startDate) return false;
  // 같은 날짜라도 시간대가 명확히 갈리면 겹침이 아니다(종일=NULL 은 항상 겹침).
  if (a.startDate === a.endDate && b.startDate === b.endDate && a.startDate === b.startDate) {
    if (a.startTime && a.endTime && b.startTime && b.endTime) {
      return a.startTime < b.endTime && b.startTime < a.endTime;
    }
  }
  return true;
}

/** month = YYYY-MM. 자산별 이용 목록(직접 예약 + 출장 차량) + 겹침 플래그. */
export async function listAssetUsage(month: string): Promise<AssetUsageItem[]> {
  const db = await getDb();
  const items: AssetUsageItem[] = [];

  // 1) 직접 예약(회의실 등 — 저장 시 겹침 차단이라 자체 충돌은 없다)
  const resvRows = rowsToObjects(
    await db.exec(
      `SELECT r.*, a.name AS asset_name, a.kind AS asset_kind,
              COALESCE(ep.name, u.email) AS user_name
         FROM asset_reservations r
         JOIN reservable_assets a ON a.asset_id = r.asset_id
         LEFT JOIN users u ON u.user_id = r.reserved_by
         LEFT JOIN employee_profiles ep ON ep.user_id = r.reserved_by
        WHERE substr(r.reserved_on, 1, 7) = $1
        ORDER BY r.reserved_on, r.start_time NULLS FIRST`,
      [month]
    )
  );
  for (const r of resvRows) {
    const date = String(r.reserved_on);
    items.push({
      id: `resv:${r.reservation_id}`,
      assetId: String(r.asset_id),
      assetName: String(r.asset_name ?? ""),
      assetKind: (r.asset_kind === "vehicle" || r.asset_kind === "room" || r.asset_kind === "etc" ? r.asset_kind : null) as AssetKind | null,
      source: "reservation",
      startDate: date,
      endDate: date,
      startTime: r.start_time != null ? String(r.start_time) : null,
      endTime: r.end_time != null ? String(r.end_time) : null,
      userName: r.user_name != null ? String(r.user_name) : null,
      reservedBy: r.reserved_by != null ? String(r.reserved_by) : null,
      purpose: r.purpose != null ? String(r.purpose) : null,
      docId: null,
      conflict: false,
    });
  }

  // 2) 출장 유래 차량 — 상신(in_progress|approved) 출장신청서에서 파생.
  //    자산 이름 매칭으로 assetId 를 보정한다(122 개정 전 문자열 값 호환).
  const { first, last } = (() => {
    const [y, m] = month.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return { first: `${month}-01`, last: `${month}-${String(lastDay).padStart(2, "0")}` };
  })();
  const tripRows = rowsToObjects(
    await db.exec(
      `SELECT d.doc_id, d.field_values, COALESCE(ep.name, d.drafter_name) AS user_name
         FROM approval_docs d
         LEFT JOIN employee_profiles ep ON ep.employee_id = d.drafter_employee_id
        WHERE d.form_id = $1
          AND d.status IN ('in_progress', 'approved')
          AND (d.field_values->'trip_period'->>'from') <= $3
          AND COALESCE(NULLIF(d.field_values->'trip_period'->>'to', ''),
                       d.field_values->'trip_period'->>'from') >= $2`,
      [TRIP_FORM_ID, first, last]
    )
  );
  const assetRows = rowsToObjects(await db.exec(`SELECT asset_id, name, kind FROM reservable_assets`));
  const assetByName = new Map(assetRows.map((a) => [String(a.name), { id: String(a.asset_id), kind: String(a.kind) }]));
  for (const r of tripRows) {
    let values: Record<string, unknown> = {};
    try {
      const v = typeof r.field_values === "string" ? JSON.parse(r.field_values) : r.field_values;
      if (v && typeof v === "object") values = v as Record<string, unknown>;
    } catch {
      continue;
    }
    const use = extractVehicleUse(values);
    if (!use) continue;
    const matched = use.assetId ? null : assetByName.get(use.assetName);
    const destination = String(values.destination ?? "").trim();
    items.push({
      id: `doc:${r.doc_id}`,
      assetId: use.assetId ?? matched?.id ?? null,
      assetName: use.assetName,
      assetKind: "vehicle",
      source: "trip",
      startDate: use.period.from,
      endDate: use.period.to,
      startTime: null,
      endTime: null,
      userName: r.user_name != null ? String(r.user_name) : null,
      reservedBy: null,
      purpose: [destination || null, use.carTime ? `이용시간 ${use.carTime}` : null].filter(Boolean).join(" · ") || null,
      docId: String(r.doc_id),
      conflict: false,
    });
  }

  // 3) 겹침 플래그 — 같은 자산끼리 비교(assetId 없으면 이름으로). 차량 이중 배정 경고용.
  const assetKey = (x: AssetUsageItem) => x.assetId ?? `name:${x.assetName}`;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (assetKey(a) !== assetKey(b)) continue;
      if (overlaps(a, b)) {
        a.conflict = true;
        b.conflict = true;
      }
    }
  }

  items.sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
  return items;
}
