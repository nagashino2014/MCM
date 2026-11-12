import assert from "node:assert/strict";
import test from "node:test";
import { extractVehicleUse } from "../lib/approval/trip";
import { describeVehicleConflict, findVehicleBookingConflicts } from "../lib/assets/vehicle-booking";
import {
  formatVehicleSlot,
  tripVehicleSlot,
  vehicleReservationTimeError,
  vehicleSlotsOverlap,
  type VehicleSlot,
} from "../lib/assets/vehicle-booking-rules";
import type { PgDatabase } from "../lib/db";

// 법인차량 예약 규칙(2026-11-12) — 직접 예약은 하루 안의 짧은 사용, 출장은 출장신청서로 기간 전체.

const day = (d: string, startTime: string | null = null, endTime: string | null = null): VehicleSlot => ({
  startDate: d,
  endDate: d,
  startTime,
  endTime,
});

test("법인차량 직접 예약은 시작·종료 시각이 모두 있어야 하고 하루를 넘길 수 없다", () => {
  assert.match(vehicleReservationTimeError(null, null) ?? "", /출장신청서/);
  assert.ok(vehicleReservationTimeError("10:00", ""));
  assert.ok(vehicleReservationTimeError("", "11:00"));
  assert.ok(vehicleReservationTimeError("15:00", "09:00"), "자정을 넘기는 예약은 막는다");
  assert.ok(vehicleReservationTimeError("10:00", "10:00"));
  assert.ok(vehicleReservationTimeError("9:00", "11:00"), "HH:mm 형식만");
  assert.equal(vehicleReservationTimeError("10:00", "11:30"), null);
});

test("여러 날 출장은 기간 전체(종일), 하루 출장의 오전·오후는 반나절로 잡는다", () => {
  assert.deepEqual(tripVehicleSlot({ period: { from: "2026-11-16", to: "2026-11-20" }, carTime: "오전" }), {
    startDate: "2026-11-16",
    endDate: "2026-11-20",
    startTime: null,
    endTime: null,
  });
  assert.deepEqual(tripVehicleSlot({ period: { from: "2026-11-16", to: "2026-11-16" }, carTime: "종일" }), day("2026-11-16"));
  assert.deepEqual(tripVehicleSlot({ period: { from: "2026-11-16", to: "2026-11-16" }, carTime: "오전" }), day("2026-11-16", "00:00", "12:00"));
  assert.deepEqual(tripVehicleSlot({ period: { from: "2026-11-16", to: "2026-11-16" }, carTime: "오후" }), day("2026-11-16", "12:00", "24:00"));
  assert.deepEqual(tripVehicleSlot({ period: { from: "2026-11-16", to: "2026-11-16" }, carTime: null }), day("2026-11-16"));
});

test("겹침 판정 — 날짜가 갈리면 안 겹치고, 같은 날 시각이 갈리면 안 겹친다", () => {
  const trip = { startDate: "2026-11-16", endDate: "2026-11-20", startTime: null, endTime: null };
  assert.equal(vehicleSlotsOverlap(trip, day("2026-11-18", "10:00", "11:00")), true, "4박 5일 가운데 날의 짧은 예약");
  assert.equal(vehicleSlotsOverlap(trip, day("2026-11-21", "10:00", "11:00")), false);
  assert.equal(vehicleSlotsOverlap(trip, day("2026-11-15", "10:00", "11:00")), false);
  assert.equal(vehicleSlotsOverlap(day("2026-11-16", "00:00", "12:00"), day("2026-11-16", "14:00", "15:00")), false, "오전 출장 + 오후 우체국");
  assert.equal(vehicleSlotsOverlap(day("2026-11-16", "12:00", "24:00"), day("2026-11-16", "14:00", "15:00")), true);
  assert.equal(vehicleSlotsOverlap(day("2026-11-16", "10:00", "11:00"), day("2026-11-16", "11:00", "12:00")), false, "끝과 시작이 맞닿으면 안 겹친다");
  assert.equal(vehicleSlotsOverlap(day("2026-11-16"), day("2026-11-16", "11:00", "12:00")), true, "종일은 그날 전체");
});

test("출장신청서 값 → 차량 이용: 교통편에 법인차량이 있어야 예약으로 본다", () => {
  const values = {
    transport: ["KTX", "법인차량"],
    trip_period: { from: "2026-11-16", to: "2026-11-20" },
    car_name: { assetId: "asset-niro", name: "니로" },
    car_time: "종일",
  };
  const use = extractVehicleUse(values);
  assert.ok(use);
  assert.equal(use.assetId, "asset-niro");
  assert.deepEqual(tripVehicleSlot(use), { startDate: "2026-11-16", endDate: "2026-11-20", startTime: null, endTime: null });
  assert.equal(extractVehicleUse({ ...values, transport: ["KTX"] }), null, "법인차량을 고르지 않으면 예약 아님");
});

test("겹침 문장 — 반나절 출장은 오전·오후, 직접 예약은 시각으로 적는다", () => {
  assert.equal(formatVehicleSlot({ startDate: "2026-11-16", endDate: "2026-11-20", startTime: null, endTime: null }), "11.16~11.20");
  assert.equal(formatVehicleSlot(day("2026-11-16", "00:00", "12:00")), "11.16 오전");
  assert.equal(
    describeVehicleConflict({ kind: "trip", slot: day("2026-11-16"), userName: "홍길동", docId: "d1", docNo: "출장-2026-0012", docStatus: "in_progress" }),
    "11.16 홍길동 출장신청서 출장-2026-0012(결재 중)"
  );
  assert.equal(
    describeVehicleConflict({ kind: "reservation", slot: day("2026-11-16", "10:00", "11:00"), userName: "김철수", docId: null, docNo: null, docStatus: null }),
    "11.16 10:00~11:00 김철수 직접 예약"
  );
});

/** SQL 머리말로 응답을 고르는 가짜 DB — 조회 조건(BETWEEN·상태·기간)은 실제 PG 리허설로 따로 확인한다. */
function fakeDb(tables: {
  assets: { asset_id: string; name: string }[];
  reservations: { reserved_on: string; start_time: string | null; end_time: string | null; user_name: string }[];
  trips: { doc_id: string; doc_no: string; status: string; field_values: unknown; user_name: string }[];
}): PgDatabase {
  const toResult = (rows: Record<string, unknown>[]) =>
    rows.length ? [{ columns: Object.keys(rows[0]), values: rows.map((r) => Object.values(r)) }] : [];
  return {
    exec: async (sql: string) => {
      if (sql.includes("FROM reservable_assets")) return toResult(tables.assets);
      if (sql.includes("FROM asset_reservations")) return toResult(tables.reservations);
      if (sql.includes("FROM approval_docs")) return toResult(tables.trips);
      throw new Error(`예상하지 못한 SQL: ${sql}`);
    },
  } as unknown as PgDatabase;
}

const trip = (doc_id: string, carName: unknown, from: string, to: string, carTime = "종일", status = "approved") => ({
  doc_id,
  doc_no: `출장-${doc_id}`,
  status,
  user_name: "홍길동",
  field_values: { transport: ["법인차량"], trip_period: { from, to }, car_name: carName, car_time: carTime },
});

test("겹침 조회 — 같은 차량(자산 id 또는 레거시 이름)만 고르고 시간이 갈리는 예약은 뺀다", async () => {
  const db = fakeDb({
    assets: [
      { asset_id: "asset-niro", name: "니로" },
      { asset_id: "asset-k8", name: "K8" },
    ],
    reservations: [
      { reserved_on: "2026-11-17", start_time: "10:00", end_time: "11:00", user_name: "김철수" },
    ],
    trips: [
      trip("t-legacy", "니로", "2026-11-19", "2026-11-19"), // 122 개정 전 문자열 값 — 이름으로 매칭
      trip("t-k8", { assetId: "asset-k8", name: "K8" }, "2026-11-16", "2026-11-20"), // 다른 차량
      trip("t-am", { assetId: "asset-niro", name: "니로" }, "2026-11-20", "2026-11-20", "오전"),
    ],
  });
  const conflicts = await findVehicleBookingConflicts(db, {
    assetId: "asset-niro",
    assetName: "니로",
    slot: { startDate: "2026-11-16", endDate: "2026-11-20", startTime: null, endTime: null },
    excludeDocId: "self",
  });
  assert.deepEqual(
    conflicts.map((c) => [c.kind, c.docId]),
    [["reservation", null], ["trip", "t-legacy"], ["trip", "t-am"]]
  );

  // 오후 우체국 방문은 오전 반나절 출장과 겹치지 않는다
  const afternoon = await findVehicleBookingConflicts(db, {
    assetId: "asset-niro",
    assetName: "니로",
    slot: day("2026-11-20", "14:00", "15:00"),
  });
  assert.deepEqual(afternoon.map((c) => c.docId), []);
});
