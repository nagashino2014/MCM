import { test } from "node:test";
import assert from "node:assert/strict";
import { facilityContractRefs, facilityDeleteBlockedMessage } from "@/lib/facilities/contract-refs";
import { ORDERING_SUBJECT_PARENT_CORP, resolveSiteDirectTarget, siteDirectMissMessage, validateOrderingTargetFacility } from "@/lib/ieps/ordering-subject";

/** db.exec 흉내 — 한 행짜리 결과 */
const fakeDb = (row: Record<string, unknown>) => ({
  exec: async (sql: string, params: unknown[]) => {
    assert.match(sql, /counterparty_facility_id = \$1/);
    assert.match(sql, /contract_facilities/);
    assert.match(sql, /purchase_contracts/);
    assert.deepEqual(params, ["facl_x"]);
    return [{ columns: Object.keys(row), values: [Object.values(row)] }];
  },
});

test("사업장 삭제 막기 — 계약이 걸리면 안내, 없으면 null", async () => {
  const refs = await facilityContractRefs(fakeDb({ sales_n: 4, purchase_n: 1, titles: "A 용역\nB 용역\nC 용역" }) as never, "facl_x");
  assert.deepEqual(refs, { sales: 4, purchase: 1, titles: ["A 용역", "B 용역", "C 용역"] });
  const msg = facilityDeleteBlockedMessage(refs)!;
  assert.match(msg, /매출 계약 4건·매입 계약 1건/);
  assert.match(msg, /예: A 용역, B 용역, C 용역 등/);
  assert.match(msg, /\[중복 병합\]/);
  assert.equal(facilityDeleteBlockedMessage({ sales: 0, purchase: 0, titles: [] }), null);
  assert.match(facilityDeleteBlockedMessage({ sales: 1, purchase: 0, titles: ["A"] })!, /매출 계약 1건 \(예: A\)\./);
});

type FetchFn = typeof fetch;
function withFetch(handler: (url: string) => { status: number; body: unknown }, fn: () => Promise<void>) {
  const prev = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const r = handler(url);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  }) as FetchFn;
  return fn().then(() => calls).finally(() => (globalThis.fetch = prev));
}

test("대상사업장 본인 — 계약상대 사업장이 살아 있으면 사업자번호 검색 없이 그대로", async () => {
  let got: Awaited<ReturnType<typeof resolveSiteDirectTarget>> | null = null;
  const calls = await withFetch(
    (url) =>
      url.startsWith("/api/facilities/69226-01")
        ? { status: 200, body: { facilityId: "69226-01", companyName: "씨제이제일제당㈜ 진천공장", businessRegistrationNo: "142-85-26432", siteAddress: "충북 진천군" } }
        : { status: 500, body: {} },
    async () => {
      got = await resolveSiteDirectTarget("69226-01", "301-85-32590", "씨제이제일제당㈜ 진천공장");
    }
  );
  assert.equal(calls.length, 1, "검색 API 를 부르지 않음");
  assert.equal(got!.match?.facilityId, "69226-01");
  assert.equal(got!.counterpartyDeleted, false);
});

test("대상사업장 본인 — 계약상대가 지워졌으면 사업자번호로 찾고, 못 찾으면 지워졌다고 안내", async () => {
  let got: Awaited<ReturnType<typeof resolveSiteDirectTarget>> | null = null;
  const calls = await withFetch(
    (url) => (url.startsWith("/api/facilities/facl_dead") ? { status: 404, body: { error: "not found" } } : { status: 200, body: { items: [] } }),
    async () => {
      got = await resolveSiteDirectTarget("facl_dead", "301-85-32590", "씨제이제일제당㈜ 진천공장");
    }
  );
  assert.ok(calls.some((u) => u.startsWith("/api/facilities?")), "사업자번호 검색으로 폴백");
  assert.equal(got!.match, null);
  assert.equal(got!.counterpartyDeleted, true);
  assert.match(siteDirectMissMessage(true), /삭제돼/);
  assert.match(siteDirectMissMessage(false), /사업자번호/);
});

test("소속 법인·모회사 — 연결 법인 또는 같은 그룹의 대표·본사 회사면 통과(2026-11-18 이웰·웰크론한텍)", () => {
  const ewell = {
    groupInfo: {
      company: { businessRegistrationNo: "607-86-06323" },
      parentCompanies: [{ businessRegistrationNo: "126-81-23094" }],
    },
  };
  // 그룹 대표 ㈜웰크론한텍이 계열사 ㈜이웰 사업장을 발주
  assert.deepEqual(validateOrderingTargetFacility(ORDERING_SUBJECT_PARENT_CORP, ewell, "1268123094"), { ok: true });
  // 연결 법인 자신
  assert.deepEqual(validateOrderingTargetFacility(ORDERING_SUBJECT_PARENT_CORP, ewell, "607-86-06323"), { ok: true });
  // 같은 그룹이 아니거나 대표·본사가 아닌 회사
  const r = validateOrderingTargetFacility(ORDERING_SUBJECT_PARENT_CORP, ewell, "111-11-11111");
  assert.equal(r.ok, false);
  assert.match(r.message!, /대표·본사/);
  // 예전 데이터(대표 목록 없음)는 연결 법인만
  assert.equal(validateOrderingTargetFacility(ORDERING_SUBJECT_PARENT_CORP, { groupInfo: { company: { businessRegistrationNo: "607-86-06323" } } }, "1268123094").ok, false);
  // 그룹 정보 없음
  assert.equal(validateOrderingTargetFacility(ORDERING_SUBJECT_PARENT_CORP, { groupInfo: null }, "1268123094").ok, false);
});
