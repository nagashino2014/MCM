import assert from "node:assert/strict";
import test from "node:test";
import { isSharedCard, rankTrips, regionMatch, scoreTrip, spendKind, verdictOf, type EvidenceTrip, type EvidenceTxn } from "../lib/finance/card-evidence-pure";

// 법인카드 증빙 대조 — 누락 내역 분석 판정 규칙(2026-11-11).

const txn = (p: Partial<EvidenceTxn>): EvidenceTxn => ({
  usedOn: "2026-11-05", storeName: null, storeAddr: null, storeBizType: null, cardDeptId: null, cardShared: false, ...p,
});
const trip = (p: Partial<EvidenceTrip>): EvidenceTrip => ({
  docId: "t1", from: "2026-11-05", to: "2026-11-06", deptId: "integrated-env-1", places: [], regions: [], ...p,
});

test("지출 성격 — 가맹점명·업태(공백 섞임 포함)", () => {
  assert.equal(spendKind("한국철도공사", null), "transport");
  assert.equal(spendKind("OO주차", "주 차 장"), "transport");
  assert.equal(spendKind("울산시티호텔", "숙박업"), "lodging");
  assert.equal(spendKind("할매국밥", "일반음식점"), "meal");
  assert.equal(spendKind("교보문고", "서적"), null);
});

test("지역 대조 — 시군구·시도·불일치·주소 없음", () => {
  const t = trip({ places: ["울산 남구 OO화학"] });
  assert.equal(regionMatch({ storeAddr: "울산광역시 남구 삼산로 1" }, t), "sigungu"); // 출장지 글자에서 시·군·구가 그대로 읽힘
  // '남'처럼 한 글자 어근은 글자 포함으로 보지 않는다 — 시도까지만
  assert.equal(regionMatch({ storeAddr: "울산광역시 남구 삼산로 1" }, trip({ places: ["울산 남부발전 OO"] })), "sido");
  assert.equal(regionMatch({ storeAddr: "경기도 수원시 영통구 광교로 1" }, trip({ places: ["수원 삼성전자"] })), "sigungu");
  assert.equal(regionMatch({ storeAddr: "경기도 수원시 영통구 광교로 1" }, trip({ places: ["OO산업"], regions: [{ sido: "경기도", sigungu: "수원시" }] })), "sigungu");
  assert.equal(regionMatch({ storeAddr: "경기도 수원시 영통구 광교로 1" }, trip({ places: ["경기 화성 OO"] })), "sido");
  assert.equal(regionMatch({ storeAddr: "서울특별시 강남구 테헤란로 1" }, trip({ places: ["울산 온산"] })), "none");
  assert.equal(regionMatch({ storeAddr: null }, t), "unknown");
});

test("기간 밖은 후보가 아니고, 전후 1일은 낮은 점수", () => {
  assert.equal(scoreTrip(txn({ usedOn: "2026-11-09" }), trip({})), null);
  assert.equal(scoreTrip(txn({ usedOn: "2026-11-04" }), trip({}))?.score, 15);
  assert.equal(scoreTrip(txn({ usedOn: "2026-11-07" }), trip({}))?.reasons[0], "출장 다음 날 사용");
});

test("확신도 — 날짜+시군구+교통이면 높음, 날짜뿐이면 낮음", () => {
  const high = scoreTrip(
    txn({ storeName: "수원역주차장", storeAddr: "경기도 수원시 팔달구 덕영대로 924", storeBizType: "주 차 장" }),
    trip({ places: ["수원 OO전자"] })
  );
  assert.equal(high?.score, 95);
  assert.equal(high?.confidence, "high");
  const low = scoreTrip(txn({ storeName: "OO상사" }), trip({ places: ["수원 OO전자"] }));
  assert.equal(low?.score, 40);
  assert.equal(low?.confidence, "low");
  assert.ok(low?.reasons.includes("가맹점 주소 없음(지역 대조 불가)"));
});

test("카드 부서는 가점일 뿐이고, 여러 부서가 쓰는 카드는 가점도 없다", () => {
  const own = scoreTrip(txn({ cardDeptId: "integrated-env-1" }), trip({}));
  assert.equal(own?.score, 50);
  // 영업관리본부 카드를 다른 부서 출장에 쓴 경우 — 부서가 달라도 후보에서 빠지지 않는다
  const other = scoreTrip(txn({ cardDeptId: "sales-management" }), trip({}));
  assert.equal(other?.score, 40);
  const shared = scoreTrip(txn({ cardDeptId: "integrated-env-1", cardShared: true }), trip({}));
  assert.equal(shared?.score, 40);
  assert.ok(shared?.reasons.some((r) => r.includes("여러 부서가 쓰는 카드")));
});

test("전 부서 출장을 후보로 삼고 점수순으로 낸다", () => {
  const t = txn({ storeName: "코레일", storeAddr: "울산광역시 울주군 삼남읍 1", cardDeptId: "sales-management" });
  const ranked = rankTrips(t, [
    trip({ docId: "a", deptId: "sales-management", places: ["서울 본사 회의"] }),
    trip({ docId: "b", deptId: "integrated-env-2", places: ["울산 울주 OO공장"] }),
    trip({ docId: "c", from: "2026-12-01", to: "2026-12-01" }),
  ]);
  assert.deepEqual(ranked.map((m) => m.docId), ["b", "a"]);
  assert.equal(ranked[0].confidence, "high");
  assert.equal(verdictOf(ranked), "trip_likely");
});

test("분류 — 후보 없음은 그 외 사용, 낮은 후보만 있으면 확인 필요", () => {
  assert.equal(verdictOf([]), "other");
  assert.equal(verdictOf(rankTrips(txn({ storeName: "OO상사" }), [trip({})])), "trip_possible");
});

test("공용 카드 판정 — 표본 5건 이상, 지정 부서 사용이 절반 미만", () => {
  assert.equal(isSharedCard("sales-management", { "sales-management": 2, "integrated-env-1": 5, "integrated-env-2": 4 }), true);
  assert.equal(isSharedCard("sales-management", { "sales-management": 6, "integrated-env-1": 2 }), false);
  assert.equal(isSharedCard("sales-management", { "integrated-env-1": 3 }), false); // 표본 부족
  assert.equal(isSharedCard(null, { a: 10 }), false);
});
