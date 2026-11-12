import assert from "node:assert/strict";
import test from "node:test";
import { assetSlotsOverlap, reservationRangeError, type AssetSlot } from "../lib/assets/reservation-range";
import { vehicleSlotsOverlap } from "../lib/assets/vehicle-booking-rules";
import { createReservation } from "../lib/assets/store";

// 자산 직접 예약 날짜 범위(2026-11-12, 직원 요청 19) — 회의실·기타만 시작일~종료일, 법인차량은 하루 안 그대로.
// store.ts 의 @/lib/db 는 scripts/test-asset-range-booking.mjs 가 tests/stubs/asset-store-db.ts 로 바꿔 묶는다.

const slot = (startDate: string, endDate: string, startTime: string | null = null, endTime: string | null = null): AssetSlot => ({
  startDate,
  endDate,
  startTime,
  endTime,
});

test("입력 검사 — 회의실·기타는 범위를 받고, 종료일이 시작일보다 앞이면 막는다", () => {
  const room = { kind: "room" as const, startDate: "2026-11-16" };
  assert.equal(reservationRangeError({ ...room, endDate: "2026-11-20" }), null, "4박 5일 종일");
  assert.equal(reservationRangeError({ ...room, endDate: "" }), null, "종료일을 비우면 하루");
  assert.equal(
    reservationRangeError({ ...room, endDate: "2026-11-20", startTime: "14:00", endTime: "12:00" }),
    null,
    "여러 날은 첫날 시작·마지막 날 종료라 시각 앞뒤가 바뀌어도 된다"
  );
  assert.match(reservationRangeError({ ...room, endDate: "2026-11-15" }) ?? "", /종료일은 시작일과 같거나 뒤/);
  assert.match(reservationRangeError({ ...room, endDate: "2026-11-31" }) ?? "", /종료일이 올바르지/);
  assert.match(reservationRangeError({ ...room, startDate: "2026-02-30" }) ?? "", /예약 날짜/);
  assert.ok(reservationRangeError({ ...room, startTime: "14:00", endTime: "12:00" }), "하루 안에서는 종료 시각이 뒤여야 한다");
  assert.ok(reservationRangeError({ ...room, endDate: "2026-11-18", startTime: "09:00" }), "시각은 함께");
  assert.equal(reservationRangeError({ kind: "etc", startDate: "2026-11-16", endDate: "2026-11-17" }), null);
});

test("입력 검사 — 법인차량은 하루 안의 시작·종료 시각만(종료일 불가, 출장은 출장신청서)", () => {
  const car = { kind: "vehicle" as const, startDate: "2026-11-16" };
  assert.match(reservationRangeError({ ...car, endDate: "2026-11-18", startTime: "10:00", endTime: "11:00" }) ?? "", /출장신청서/);
  assert.match(reservationRangeError({ ...car }) ?? "", /시작·종료 시각/);
  assert.equal(reservationRangeError({ ...car, startTime: "10:00", endTime: "11:00" }), null);
  assert.equal(reservationRangeError({ ...car, endDate: "2026-11-16", startTime: "10:00", endTime: "11:00" }), null);
});

test("겹침 — 여러 날 시각 지정 예약은 첫날 시작부터 마지막 날 종료까지", () => {
  const range = slot("2026-11-13", "2026-11-15", "14:00", "12:00");
  assert.equal(assetSlotsOverlap(range, slot("2026-11-13", "2026-11-13", "09:00", "11:00")), false, "첫날 오전은 비어 있다");
  assert.equal(assetSlotsOverlap(range, slot("2026-11-13", "2026-11-13", "13:00", "15:00")), true);
  assert.equal(assetSlotsOverlap(range, slot("2026-11-14", "2026-11-14", "09:00", "10:00")), true, "가운데 날은 전체");
  assert.equal(assetSlotsOverlap(range, slot("2026-11-15", "2026-11-15", "12:00", "13:00")), false, "마지막 날 오후는 비어 있다");
  assert.equal(assetSlotsOverlap(range, slot("2026-11-15", "2026-11-15")), true, "마지막 날 종일");
  assert.equal(assetSlotsOverlap(slot("2026-11-13", "2026-11-15"), slot("2026-11-16", "2026-11-17")), false, "맞닿은 기간");
  assert.equal(assetSlotsOverlap(slot("2026-11-13", "2026-11-15"), slot("2026-11-15", "2026-11-17")), true);
});

test("겹침 — 하루짜리·종일·출장 반나절은 기존 차량 판정(vehicleSlotsOverlap)과 같다", () => {
  const cases: AssetSlot[] = [
    slot("2026-11-16", "2026-11-16"),
    slot("2026-11-16", "2026-11-16", "00:00", "12:00"),
    slot("2026-11-16", "2026-11-16", "12:00", "24:00"),
    slot("2026-11-16", "2026-11-16", "10:00", "11:00"),
    slot("2026-11-16", "2026-11-16", "11:00", "12:00"),
    slot("2026-11-16", "2026-11-20"),
    slot("2026-11-17", "2026-11-17", "14:00", "15:00"),
    slot("2026-11-21", "2026-11-21", "09:00", "10:00"),
    slot("2026-11-15", "2026-11-15"),
  ];
  for (const a of cases) {
    for (const b of cases) {
      assert.equal(assetSlotsOverlap(a, b), vehicleSlotsOverlap(a, b), `${JSON.stringify(a)} × ${JSON.stringify(b)}`);
    }
  }
});

/** createReservation 이 쓰는 SQL 을 내용으로 골라 응답하는 가짜 DB. INSERT 인자를 모은다. */
function useFakeDb(asset: { kind: string; name: string }, existing: Record<string, unknown>[]) {
  const inserts: unknown[][] = [];
  const toResult = (rows: Record<string, unknown>[]) =>
    rows.length ? [{ columns: Object.keys(rows[0]), values: rows.map((r) => Object.values(r)) }] : [];
  (globalThis as { __assetStoreDb?: unknown }).__assetStoreDb = {
    exec: async (sql: string) => {
      if (sql.includes("SELECT active, kind, name FROM reservable_assets")) return toResult([{ active: 1, ...asset }]);
      if (sql.includes("FROM reservable_assets WHERE kind = 'vehicle'")) return toResult([{ asset_id: "a1", name: asset.name }]);
      if (sql.includes("FROM asset_reservations")) return toResult(existing);
      if (sql.includes("FROM approval_docs")) return [];
      throw new Error(`예상하지 못한 SQL: ${sql}`);
    },
    run: async (sql: string, args: unknown[]) => {
      if (sql.includes("INSERT INTO asset_reservations")) inserts.push(args);
    },
  };
  return inserts;
}

const base = { assetId: "a1", reservedBy: "u1", purpose: "워크숍" };

test("서버 저장 — 회의실 여러 날은 reserved_until 을 담아 한 건으로 저장한다", async () => {
  const inserts = useFakeDb({ kind: "room", name: "대회의실" }, []);
  const r = await createReservation({ ...base, reservedOn: "2026-11-16", reservedUntil: "2026-11-20" });
  assert.equal(r.reservedUntil, "2026-11-20");
  assert.equal(inserts.length, 1);
  assert.deepEqual(inserts[0].slice(3, 7), ["2026-11-16", "2026-11-20", null, null]);

  const single = useFakeDb({ kind: "room", name: "대회의실" }, []);
  const one = await createReservation({ ...base, reservedOn: "2026-11-16", reservedUntil: "2026-11-16", startTime: "10:00", endTime: "11:00" });
  assert.equal(one.reservedUntil, null, "하루짜리는 기존 모양(NULL) 그대로");
  assert.equal(single[0][4], null);
});

test("서버 저장 — 기간 안에 같은 자산 예약이 있으면 막고, 시각이 갈리면 받는다", async () => {
  const busy = [{ reserved_on: "2026-11-18", reserved_until: null, start_time: "10:00", end_time: "11:00" }];
  useFakeDb({ kind: "room", name: "대회의실" }, busy);
  await assert.rejects(createReservation({ ...base, reservedOn: "2026-11-16", reservedUntil: "2026-11-20" }), /예약 기간에 이미/);

  const edge = [{ reserved_on: "2026-11-13", reserved_until: null, start_time: "09:00", end_time: "11:00" }];
  const inserts = useFakeDb({ kind: "room", name: "대회의실" }, edge);
  await createReservation({ ...base, reservedOn: "2026-11-13", reservedUntil: "2026-11-15", startTime: "14:00", endTime: "12:00" });
  assert.equal(inserts.length, 1, "첫날 오전 회의와 첫날 오후부터의 범위 예약은 함께 들어간다");

  const longOne = [{ reserved_on: "2026-11-10", reserved_until: "2026-11-14", start_time: null, end_time: null }];
  useFakeDb({ kind: "etc", name: "빔프로젝터" }, longOne);
  await assert.rejects(createReservation({ ...base, reservedOn: "2026-11-12", startTime: "10:00", endTime: "11:00" }), /이미 예약/);
});

test("서버 저장 — 종료일이 시작일보다 앞이면 막는다", async () => {
  useFakeDb({ kind: "room", name: "대회의실" }, []);
  await assert.rejects(createReservation({ ...base, reservedOn: "2026-11-16", reservedUntil: "2026-11-15" }), /종료일은 시작일과 같거나 뒤/);
});

test("서버 저장 — 법인차량은 여러 날을 받지 않고 하루 안 시각만 받는다", async () => {
  const car = { kind: "vehicle", name: "니로" };
  useFakeDb(car, []);
  await assert.rejects(
    createReservation({ ...base, reservedOn: "2026-11-16", reservedUntil: "2026-11-18", startTime: "10:00", endTime: "11:00" }),
    /출장신청서/
  );
  useFakeDb(car, []);
  await assert.rejects(createReservation({ ...base, reservedOn: "2026-11-16" }), /시작·종료 시각/);
  const inserts = useFakeDb(car, []);
  const ok = await createReservation({ ...base, reservedOn: "2026-11-16", startTime: "10:00", endTime: "11:00" });
  assert.equal(ok.reservedUntil, null);
  assert.equal(inserts.length, 1);
});
