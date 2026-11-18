import { test } from "node:test";
import assert from "node:assert/strict";
import { facilityContractRefs, facilityDeleteBlockedMessage } from "@/lib/facilities/contract-refs";
import { resolveSiteDirectTarget, siteDirectMissMessage } from "@/lib/ieps/ordering-subject";

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
