// 운행기록부 (블루프린트 P6-B) — 업무용승용차 운행기록 초안을 출장신청서에서 자동 파생 + 수동 보완.
// 파생 규칙: 승인(approved) 출장신청서의 법인차량 이용(extractVehicleUse) → 출장 기간을 일자별로 전개해
//   (asset_id, drive_date, doc_id) upsert. 주행거리는 문서에 없으므로 초안은 null(화면에서 수기 입력).
// 문서가 회수·반려되면 거리 미입력 파생 행만 정리한다(사람이 채운 거리는 보존).

import { createHash } from "node:crypto";
import { getDb, withDbWrite, rowsToObjects } from "@/lib/db";
import ExcelJS from "exceljs";
import { TRIP_FORM_ID, extractVehicleUse } from "@/lib/approval/trip";

const KST_NOW = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
const hashId = (prefix: string, source: string) =>
  `${prefix}-${createHash("sha256").update(source).digest("hex").slice(0, 12)}`;

export interface TripLog {
  logId: string;
  assetId: string;
  assetName: string;
  driveDate: string;
  driverUserId: string | null;
  driverName: string | null;
  useKind: string;
  purpose: string | null;
  distanceKm: number | null;
  docId: string | null;
  source: string;
  memo: string | null;
}

const expandDates = (from: string, to: string): string[] => {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  for (let d = start; d <= end && out.length < 62; d = new Date(d.getTime() + 86400000)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
};

/** 승인 출장 문서에서 연도분 운행기록 초안 동기화. */
export async function syncTripLogsFromDocs(year: number): Promise<{ scanned: number; inserted: number; removed: number }> {
  const db = await getDb();
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const docs = rowsToObjects(
    await db.exec(
      `SELECT d.doc_id, d.field_values, d.drafter_user_id, COALESCE(ep.name, d.drafter_name) AS drafter_name
         FROM approval_docs d
         LEFT JOIN employee_profiles ep ON ep.employee_id = d.drafter_employee_id
        WHERE d.form_id = $1 AND d.status = 'approved'
          AND (d.field_values->'trip_period'->>'from') <= $3
          AND COALESCE(NULLIF(d.field_values->'trip_period'->>'to', ''), d.field_values->'trip_period'->>'from') >= $2`,
      [TRIP_FORM_ID, from, to],
    ),
  );
  const assets = rowsToObjects(await db.exec(`SELECT asset_id, name FROM reservable_assets WHERE kind = 'vehicle'`));
  const assetByName = new Map(assets.map((a) => [String(a.name), String(a.asset_id)]));

  let inserted = 0;
  let removed = 0;
  const validDocIds: string[] = [];
  await withDbWrite(async (tx) => {
    for (const doc of docs) {
      let values: Record<string, unknown> = {};
      try {
        const v = typeof doc.field_values === "string" ? JSON.parse(String(doc.field_values)) : doc.field_values;
        if (v && typeof v === "object") values = v as Record<string, unknown>;
      } catch {
        continue;
      }
      const use = extractVehicleUse(values);
      if (!use) continue;
      const assetId = use.assetId ?? assetByName.get(use.assetName);
      if (!assetId) continue;
      validDocIds.push(String(doc.doc_id));
      const destination = String(values.destination ?? "").trim();
      for (const date of expandDates(use.period.from, use.period.to)) {
        if (date < from || date > to) continue;
        const res = await tx.exec(
          `INSERT INTO vehicle_trip_logs
             (log_id, asset_id, drive_date, driver_user_id, driver_name, use_kind, purpose, doc_id, source, created_at)
           VALUES ($1, $2, $3, NULLIF($4, ''), NULLIF($5, ''), 'business', NULLIF($6, ''), $7, 'trip_doc', $8)
           ON CONFLICT (asset_id, drive_date, doc_id) WHERE doc_id IS NOT NULL DO NOTHING
           RETURNING log_id`,
          [
            hashId("vtl", `${assetId}:${date}:${doc.doc_id}`),
            assetId,
            date,
            doc.drafter_user_id ? String(doc.drafter_user_id) : "",
            doc.drafter_name ? String(doc.drafter_name) : "",
            destination,
            String(doc.doc_id),
            KST_NOW(),
          ],
        );
        if (rowsToObjects(res).length) inserted += 1;
      }
    }
    // 승인 목록에서 빠진 문서의 파생 행 정리 — 거리 미입력분만(사람 입력 보존)
    const removedRes = await tx.exec(
      validDocIds.length
        ? `DELETE FROM vehicle_trip_logs
            WHERE source = 'trip_doc' AND drive_date BETWEEN $1 AND $2 AND distance_km IS NULL
              AND NOT (doc_id = ANY($3::text[])) RETURNING log_id`
        : `DELETE FROM vehicle_trip_logs
            WHERE source = 'trip_doc' AND drive_date BETWEEN $1 AND $2 AND distance_km IS NULL RETURNING log_id`,
      validDocIds.length ? [from, to, validDocIds] : [from, to],
    );
    removed = rowsToObjects(removedRes).length;
  });
  return { scanned: docs.length, inserted, removed };
}

export async function listTripLogs(params: { assetId?: string; year: number; month?: string }): Promise<TripLog[]> {
  const db = await getDb();
  const args: unknown[] = [];
  const where: string[] = [];
  if (params.month && /^\d{4}-\d{2}$/.test(params.month)) {
    args.push(params.month);
    where.push(`substr(l.drive_date, 1, 7) = $${args.length}`);
  } else {
    args.push(String(params.year));
    where.push(`substr(l.drive_date, 1, 4) = $${args.length}`);
  }
  if (params.assetId) {
    args.push(params.assetId);
    where.push(`l.asset_id = $${args.length}`);
  }
  const rows = rowsToObjects(
    await db.exec(
      `SELECT l.*, a.name AS asset_name FROM vehicle_trip_logs l
         JOIN reservable_assets a ON a.asset_id = l.asset_id
        WHERE ${where.join(" AND ")}
        ORDER BY l.drive_date, a.name`,
      args,
    ),
  );
  return rows.map((r) => ({
    logId: String(r.log_id),
    assetId: String(r.asset_id),
    assetName: String(r.asset_name ?? ""),
    driveDate: String(r.drive_date),
    driverUserId: r.driver_user_id ? String(r.driver_user_id) : null,
    driverName: r.driver_name ? String(r.driver_name) : null,
    useKind: String(r.use_kind ?? "business"),
    purpose: r.purpose ? String(r.purpose) : null,
    distanceKm: r.distance_km == null ? null : Number(r.distance_km),
    docId: r.doc_id ? String(r.doc_id) : null,
    source: String(r.source ?? "manual"),
    memo: r.memo ? String(r.memo) : null,
  }));
}

export async function saveTripLog(input: {
  logId?: string;
  assetId: string;
  driveDate: string;
  driverName?: string | null;
  useKind?: string;
  purpose?: string | null;
  distanceKm?: number | null;
  memo?: string | null;
}): Promise<string> {
  const logId = input.logId || hashId("vtl", `${input.assetId}:${input.driveDate}:manual:${Date.now()}`);
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO vehicle_trip_logs (log_id, asset_id, drive_date, driver_name, use_kind, purpose, distance_km, memo, source, created_at)
       VALUES ($1, $2, $3, NULLIF($4, ''), $5, NULLIF($6, ''), $7, NULLIF($8, ''), 'manual', $9)
       ON CONFLICT (log_id) DO UPDATE SET
         drive_date = EXCLUDED.drive_date, driver_name = EXCLUDED.driver_name, use_kind = EXCLUDED.use_kind,
         purpose = EXCLUDED.purpose, distance_km = EXCLUDED.distance_km, memo = EXCLUDED.memo, updated_at = $9`,
      [
        logId,
        input.assetId,
        input.driveDate,
        input.driverName ?? "",
        input.useKind === "commute" || input.useKind === "etc" ? input.useKind : "business",
        input.purpose ?? "",
        input.distanceKm ?? null,
        input.memo ?? "",
        KST_NOW(),
      ],
    );
  });
  return logId;
}

/** 파생 행의 거리·비고만 갱신(문서 유래 필드는 보존). */
export async function updateTripLogDistance(logId: string, distanceKm: number | null, memo?: string | null): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(
      `UPDATE vehicle_trip_logs SET distance_km = $2, memo = COALESCE(NULLIF($3, ''), memo), updated_at = $4 WHERE log_id = $1`,
      [logId, distanceKm, memo ?? "", KST_NOW()],
    );
  });
}

export async function deleteTripLog(logId: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(`DELETE FROM vehicle_trip_logs WHERE log_id = $1`, [logId]);
  });
}

export interface TripLogSummary {
  assetId: string;
  assetName: string;
  year: number;
  totalDays: number;
  businessDays: number;
  totalKm: number;
  businessKm: number;
  businessRatio: number | null; // 거리 기준(거리 미입력 시 일수 기준)
}

export async function tripLogYearlySummary(year: number): Promise<TripLogSummary[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT l.asset_id, a.name AS asset_name,
              count(*) AS total_days,
              count(*) FILTER (WHERE l.use_kind = 'business') AS business_days,
              COALESCE(SUM(l.distance_km), 0) AS total_km,
              COALESCE(SUM(l.distance_km) FILTER (WHERE l.use_kind = 'business'), 0) AS business_km
         FROM vehicle_trip_logs l
         JOIN reservable_assets a ON a.asset_id = l.asset_id
        WHERE substr(l.drive_date, 1, 4) = $1
        GROUP BY l.asset_id, a.name ORDER BY a.name`,
      [String(year)],
    ),
  );
  return rows.map((r) => {
    const totalKm = Number(r.total_km || 0);
    const businessKm = Number(r.business_km || 0);
    const totalDays = Number(r.total_days || 0);
    const businessDays = Number(r.business_days || 0);
    return {
      assetId: String(r.asset_id),
      assetName: String(r.asset_name ?? ""),
      year,
      totalDays,
      businessDays,
      totalKm,
      businessKm,
      businessRatio: totalKm > 0 ? businessKm / totalKm : totalDays > 0 ? businessDays / totalDays : null,
    };
  });
}

/** 운행기록부 xlsx — 차량별 시트(일자·운전자·용무·구분·거리). 업무용승용차 운행기록부 작성 기초자료. */
export async function buildTripLogWorkbook(year: number, assetId?: string): Promise<Buffer> {
  const logs = await listTripLogs({ year, assetId });
  const byAsset = new Map<string, TripLog[]>();
  for (const l of logs) {
    const arr = byAsset.get(l.assetId) ?? [];
    arr.push(l);
    byAsset.set(l.assetId, arr);
  }
  const wb = new ExcelJS.Workbook();
  for (const [aid, arr] of byAsset) {
    const name = arr[0]?.assetName || aid;
    const ws = wb.addWorksheet(name.slice(0, 28));
    ws.addRow([`업무용승용차 운행기록 (${year}년) — ${name}`]).font = { bold: true, size: 13 };
    ws.addRow(["일자", "운전자", "구분", "용무(출장지)", "주행거리(km)", "근거 문서", "비고"]).font = { bold: true };
    for (const l of arr) {
      ws.addRow([
        l.driveDate,
        l.driverName ?? "",
        l.useKind === "business" ? "업무" : l.useKind === "commute" ? "출퇴근" : "기타",
        l.purpose ?? "",
        l.distanceKm ?? "",
        l.docId ? "출장신청서" : "수기",
        l.memo ?? "",
      ]);
    }
    const totalKm = arr.reduce((acc, l) => acc + (l.distanceKm ?? 0), 0);
    const bizKm = arr.reduce((acc, l) => acc + (l.useKind === "business" ? l.distanceKm ?? 0 : 0), 0);
    ws.addRow(["합계", "", "", "", totalKm, "", totalKm > 0 ? `업무사용비율 ${((bizKm / totalKm) * 100).toFixed(1)}%` : ""]).font = { bold: true };
    ws.columns.forEach((col, i) => (col.width = [12, 12, 8, 30, 14, 12, 18][i] ?? 12));
  }
  if (!byAsset.size) {
    wb.addWorksheet("운행기록 없음").addRow([`${year}년 운행기록이 없습니다.`]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
