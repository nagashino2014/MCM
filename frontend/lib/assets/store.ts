/**
 * 예약 자산 관리 — 법인차량·회의실 등 예약 가능 자산 마스터 + 직접 예약.
 * 차량 이용은 출장신청서 상신에서 자동 파생되므로(lib/approval/trip.ts) 여기서는
 * 자산 마스터 CRUD와 직접 예약(회의실 등, 결재 없는 즉시 예약)만 담당한다.
 * 저장 테이블: reservable_assets / asset_reservations (infra/aws/121_reservable_assets.sql)
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import type { AssetKind, AssetReservation, ReservableAsset, VehicleOwnership } from "@/lib/assets/types";

export type { AssetKind, AssetReservation, ReservableAsset, VehicleOwnership } from "@/lib/assets/types";

const newId = (p: string) => `${p}-${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;

function toKind(v: unknown): AssetKind {
  const s = String(v ?? "");
  return s === "vehicle" || s === "room" || s === "etc" ? s : "etc";
}

function toOwnership(v: unknown): VehicleOwnership | null {
  const s = String(v ?? "");
  return s === "rent" || s === "owned" || s === "lease" ? s : null;
}

const textOrNull = (v: unknown): string | null => (v != null && String(v).trim() !== "" ? String(v) : null);
const numOrNull = (v: unknown): number | null => (v != null && String(v).trim() !== "" ? Number(v) : null);

function toAsset(r: Record<string, unknown>): ReservableAsset {
  return {
    assetId: String(r.asset_id),
    kind: toKind(r.kind),
    name: String(r.name ?? ""),
    description: r.description != null ? String(r.description) : null,
    active: Number(r.active ?? 0) === 1,
    sortOrder: Number(r.sort_order ?? 0),
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
    plateNo: textOrNull(r.plate_no),
    ownership: toOwnership(r.ownership),
    ownerName: textOrNull(r.owner_name),
    acquiredAt: textOrNull(r.acquired_at),
    contractMonths: numOrNull(r.contract_months),
    returnedAt: textOrNull(r.returned_at),
    acquisitionPrice: numOrNull(r.acquisition_price),
    monthlyFee: numOrNull(r.monthly_fee),
    contractDocKey: textOrNull(r.contract_doc_key),
    contractDocName: textOrNull(r.contract_doc_name),
    registrationDocKey: textOrNull(r.registration_doc_key),
    registrationDocName: textOrNull(r.registration_doc_name),
  };
}

/** 차량 상세 입력(129) — create/update 공용. undefined = 변경 안 함, null = 비움. */
export interface VehicleDetailInput {
  plateNo?: string | null;
  ownership?: VehicleOwnership | null;
  ownerName?: string | null;
  acquiredAt?: string | null;
  contractMonths?: number | null;
  returnedAt?: string | null;
  acquisitionPrice?: number | null;
  monthlyFee?: number | null;
}

function toReservation(r: Record<string, unknown>): AssetReservation {
  return {
    reservationId: String(r.reservation_id),
    assetId: String(r.asset_id),
    assetName: r.asset_name != null ? String(r.asset_name) : null,
    assetKind: r.asset_kind != null ? toKind(r.asset_kind) : null,
    reservedBy: r.reserved_by != null ? String(r.reserved_by) : null,
    reservedByName: r.reserved_by_name != null ? String(r.reserved_by_name) : null,
    reservedOn: String(r.reserved_on ?? ""),
    startTime: r.start_time != null ? String(r.start_time) : null,
    endTime: r.end_time != null ? String(r.end_time) : null,
    purpose: r.purpose != null ? String(r.purpose) : null,
    createdAt: String(r.created_at ?? ""),
  };
}

/** 자산 목록. kind·활성 여부로 필터(관리 화면은 전체, 양식/예약 화면은 activeOnly). */
export async function listAssets(params?: {
  kind?: AssetKind;
  activeOnly?: boolean;
}): Promise<ReservableAsset[]> {
  const db = await getDb();
  const where: string[] = [];
  const args: unknown[] = [];
  if (params?.kind) {
    args.push(params.kind);
    where.push(`kind = $${args.length}`);
  }
  if (params?.activeOnly) where.push(`active = 1`);
  const rows = rowsToObjects(
    await db.exec(
      `SELECT * FROM reservable_assets
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY sort_order, name`,
      args
    )
  );
  return rows.map(toAsset);
}

export async function createAsset(input: {
  kind: AssetKind;
  name: string;
  description?: string | null;
  sortOrder?: number;
  vehicle?: VehicleDetailInput;
}): Promise<ReservableAsset> {
  const name = input.name.trim();
  if (!name) throw new Error("자산 이름을 입력하세요.");
  const now = new Date().toISOString();
  const v = input.vehicle ?? {};
  const assetId = newId("asset");
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO reservable_assets
         (asset_id, kind, name, description, active, sort_order, created_at, updated_at,
          plate_no, ownership, owner_name, acquired_at, contract_months, returned_at, acquisition_price, monthly_fee)
       VALUES ($1, $2, $3, $4, 1, $5, $6, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        assetId,
        input.kind,
        name,
        input.description?.trim() || null,
        input.sortOrder ?? 0,
        now,
        v.plateNo?.trim() || null,
        v.ownership ?? null,
        v.ownerName?.trim() || null,
        v.acquiredAt || null,
        v.contractMonths ?? null,
        v.returnedAt || null,
        v.acquisitionPrice ?? null,
        v.monthlyFee ?? null,
      ]
    );
  });
  const rows = rowsToObjects(await (await getDb()).exec(`SELECT * FROM reservable_assets WHERE asset_id = $1`, [assetId]));
  return toAsset(rows[0]);
}

export async function updateAsset(
  assetId: string,
  input: {
    kind?: AssetKind;
    name?: string;
    description?: string | null;
    active?: boolean;
    sortOrder?: number;
    vehicle?: VehicleDetailInput;
  }
): Promise<void> {
  const sets: string[] = [];
  const args: unknown[] = [];
  const push = (col: string, v: unknown) => {
    args.push(v);
    sets.push(`${col} = $${args.length}`);
  };
  if (input.kind) push("kind", input.kind);
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new Error("자산 이름을 입력하세요.");
    push("name", name);
  }
  if (input.description !== undefined) push("description", input.description?.trim() || null);
  if (input.active !== undefined) push("active", input.active ? 1 : 0);
  if (input.sortOrder !== undefined) push("sort_order", input.sortOrder);
  const v = input.vehicle;
  if (v) {
    if (v.plateNo !== undefined) push("plate_no", v.plateNo?.trim() || null);
    if (v.ownership !== undefined) push("ownership", v.ownership ?? null);
    if (v.ownerName !== undefined) push("owner_name", v.ownerName?.trim() || null);
    if (v.acquiredAt !== undefined) push("acquired_at", v.acquiredAt || null);
    if (v.contractMonths !== undefined) push("contract_months", v.contractMonths ?? null);
    if (v.returnedAt !== undefined) push("returned_at", v.returnedAt || null);
    if (v.acquisitionPrice !== undefined) push("acquisition_price", v.acquisitionPrice ?? null);
    if (v.monthlyFee !== undefined) push("monthly_fee", v.monthlyFee ?? null);
  }
  if (!sets.length) return;
  push("updated_at", new Date().toISOString());
  args.push(assetId);
  await withDbWrite(async (db) => {
    await db.run(`UPDATE reservable_assets SET ${sets.join(", ")} WHERE asset_id = $${args.length}`, args);
  });
}

/** 차량 서류(계약서/등록증) 키·파일명 저장(129) — 업로드 라우트가 S3 저장 후 호출한다. */
export async function setAssetDocument(
  assetId: string,
  docType: "contract" | "registration",
  key: string,
  fileName: string
): Promise<void> {
  const keyCol = docType === "contract" ? "contract_doc_key" : "registration_doc_key";
  const nameCol = docType === "contract" ? "contract_doc_name" : "registration_doc_name";
  await withDbWrite(async (db) => {
    await db.run(
      `UPDATE reservable_assets SET ${keyCol} = $2, ${nameCol} = $3, updated_at = $4 WHERE asset_id = $1`,
      [assetId, key, fileName, new Date().toISOString()]
    );
  });
}

/** 서류 기존 키 조회(교체 시 이전 파일 정리용). */
export async function getAssetDocumentKey(assetId: string, docType: "contract" | "registration"): Promise<string | null> {
  const db = await getDb();
  const col = docType === "contract" ? "contract_doc_key" : "registration_doc_key";
  const rows = rowsToObjects(await db.exec(`SELECT ${col} AS k FROM reservable_assets WHERE asset_id = $1`, [assetId]));
  return rows.length && rows[0].k != null && String(rows[0].k) ? String(rows[0].k) : null;
}

/** 삭제 — 예약 이력이 있으면 이력 보존을 위해 비활성화로 대체한다. */
export async function deleteAsset(assetId: string): Promise<{ deactivated: boolean }> {
  return withDbWrite(async (db) => {
    const used = rowsToObjects(
      await db.exec(`SELECT count(*)::int AS cnt FROM asset_reservations WHERE asset_id = $1`, [assetId])
    );
    if (Number(used[0]?.cnt ?? 0) > 0) {
      await db.run(`UPDATE reservable_assets SET active = 0, updated_at = $2 WHERE asset_id = $1`, [
        assetId,
        new Date().toISOString(),
      ]);
      return { deactivated: true };
    }
    await db.run(`DELETE FROM reservable_assets WHERE asset_id = $1`, [assetId]);
    return { deactivated: false };
  });
}

/** 월별 직접 예약 목록(자산·예약자 조인). month = YYYY-MM. */
export async function listReservations(month: string): Promise<AssetReservation[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT r.*, a.name AS asset_name, a.kind AS asset_kind,
              COALESCE(ep.name, u.email) AS reserved_by_name
         FROM asset_reservations r
         JOIN reservable_assets a ON a.asset_id = r.asset_id
         LEFT JOIN users u ON u.user_id = r.reserved_by
         LEFT JOIN employee_profiles ep ON ep.user_id = r.reserved_by
        WHERE substr(r.reserved_on, 1, 7) = $1
        ORDER BY r.reserved_on, r.start_time NULLS FIRST`,
      [month]
    )
  );
  return rows.map(toReservation);
}

/**
 * 직접 예약 생성. 같은 자산·같은 날짜의 시간대 겹침은 저장을 차단한다
 * (직접 예약이 해당 자산의 유일 데이터원이므로 충돌 없는 상태를 보장할 수 있다).
 * 시간 미지정(종일)은 그날 전체와 겹치는 것으로 본다.
 */
export async function createReservation(input: {
  assetId: string;
  reservedBy: string;
  reservedOn: string; // YYYY-MM-DD
  startTime?: string | null;
  endTime?: string | null;
  purpose?: string | null;
}): Promise<AssetReservation> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.reservedOn)) throw new Error("예약 날짜가 올바르지 않습니다.");
  const start = input.startTime?.trim() || null;
  const end = input.endTime?.trim() || null;
  if ((start && !end) || (!start && end)) throw new Error("시작·종료 시각은 함께 입력하세요.");
  if (start && end && start >= end) throw new Error("종료 시각은 시작 시각보다 뒤여야 합니다.");
  const now = new Date().toISOString();
  const reservationId = newId("resv");

  await withDbWrite(async (db) => {
    const asset = rowsToObjects(
      await db.exec(`SELECT active FROM reservable_assets WHERE asset_id = $1`, [input.assetId])
    );
    if (!asset.length) throw new Error("자산을 찾을 수 없습니다.");
    if (Number(asset[0].active ?? 0) !== 1) throw new Error("비활성화된 자산입니다.");

    // 겹침 검사 — 종일 예약(NULL 시간)은 그날 모든 예약과 겹친다.
    const conflicts = rowsToObjects(
      await db.exec(
        `SELECT count(*)::int AS cnt
           FROM asset_reservations
          WHERE asset_id = $1 AND reserved_on = $2
            AND ($3::text IS NULL OR start_time IS NULL OR (start_time < $4 AND end_time > $3))`,
        [input.assetId, input.reservedOn, start, end]
      )
    );
    if (Number(conflicts[0]?.cnt ?? 0) > 0) {
      throw new Error("해당 시간대에 이미 예약이 있습니다.");
    }

    await db.run(
      `INSERT INTO asset_reservations
         (reservation_id, asset_id, reserved_by, reserved_on, start_time, end_time, purpose, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [reservationId, input.assetId, input.reservedBy, input.reservedOn, start, end, input.purpose?.trim() || null, now]
    );
  });

  return {
    reservationId,
    assetId: input.assetId,
    assetName: null,
    assetKind: null,
    reservedBy: input.reservedBy,
    reservedByName: null,
    reservedOn: input.reservedOn,
    startTime: start,
    endTime: end,
    purpose: input.purpose?.trim() || null,
    createdAt: now,
  };
}

/** 예약 취소 — 본인 또는 관리 권한(canManage). */
export async function deleteReservation(
  reservationId: string,
  userId: string,
  canManage: boolean
): Promise<void> {
  await withDbWrite(async (db) => {
    const rows = rowsToObjects(
      await db.exec(`SELECT reserved_by FROM asset_reservations WHERE reservation_id = $1`, [reservationId])
    );
    if (!rows.length) throw new Error("예약을 찾을 수 없습니다.");
    if (!canManage && String(rows[0].reserved_by ?? "") !== userId) {
      throw new Error("본인 예약만 취소할 수 있습니다.");
    }
    await db.run(`DELETE FROM asset_reservations WHERE reservation_id = $1`, [reservationId]);
  });
}
