import assert from "node:assert/strict";
import test from "node:test";
import { buildChunkConfig } from "../lib/scraper/backfill";
import { formatDateForApi, runApiCollect } from "../lib/scraper/execute-api";
import type { ApiConfig, ApiProfile } from "../lib/scraper/types";

// 나라장터 입찰공고 조회 기간 한도(2026-11) — 시작일과 종료일의 날짜 차이가 6일을 넘으면
// HTTP 200 에 오류 객체("입력범위값 초과 에러", 07)가 온다. 예전에는 그 오류 객체를 공고 1건으로
// 오인해 "수집 성공"으로 기록했고, 11월 10일 이후 공고가 9일간 들어오지 않았다.
// 여기서는 실제 API 대신 같은 규칙으로 답하는 fetch 를 끼워 수집 코어를 확인한다.

const PROFILE: ApiProfile = {
  base_url: "http://apis.data.go.kr",
  auth: { type: "param", in: "query", param_name: "serviceKey" },
  response_mapping: { list_path: "response.body.items" },
};

/** 입찰공고 용역 조회 설정 — relativeDays 일 전 0시부터 오늘 23:59 까지. */
function bidConfig(relativeDays: number): ApiConfig {
  return {
    primary_endpoint: { path: "/1230000/ad/BidPublicInfoService/getBidPblancListInfoServcPPSSrch" },
    params: { inqryDiv: "1", type: "json" },
    pagination: { type: "page", param_name: "pageNo", size_param: "numOfRows", page_size: 100, max_pages: 1 },
    date_filters: [
      { field: "inqryBgnDt", relative_days: relativeDays, format: "YYYYMMDDHHmm" },
      { field: "inqryEndDt", relative_days: 0, format: "YYYYMMDDHHmm" },
    ],
  };
}

const rangeError = (code = "07", msg = "입력범위값 초과 에러") => ({
  "nkoneps.com.response.ResponseError": { header: { resultCode: code, resultMsg: msg } },
});

const dayOf = (v: string) => new Date(Number(v.slice(0, 4)), Number(v.slice(4, 6)) - 1, Number(v.slice(6, 8)));
const dayKey = (d: Date) => formatDateForApi(d, "YYYYMMDD");

interface Call {
  bgn: string;
  end: string;
}

/**
 * 나라장터 흉내 — 날짜 차이가 maxDiffDays 를 넘으면 07 오류, 아니면 조회 기간의 날짜마다 공고 1건.
 * failDay 가 낀 조회는 다른 오류(99)로 답한다.
 */
function installFetch(maxDiffDays: number, failDay?: string): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const bgn = url.searchParams.get("inqryBgnDt") ?? url.searchParams.get("orderBgnYm") ?? "";
    const end = url.searchParams.get("inqryEndDt") ?? url.searchParams.get("orderEndYm") ?? "";
    calls.push({ bgn, end });
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (bgn.length < 8) return json(rangeError()); // 월 단위 조회(YYYYMM)는 무조건 초과로 답한다
    const from = dayOf(bgn);
    const to = dayOf(end);
    const diff = Math.round((to.getTime() - from.getTime()) / 86400000);
    if (diff > maxDiffDays) return json(rangeError());
    const item: Array<{ bidNtceNo: string }> = [];
    for (let i = 0; i <= diff; i++) {
      const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
      if (failDay && dayKey(d) === failDay) return json(rangeError("99", "기타 에러"));
      item.push({ bidNtceNo: dayKey(d) });
    }
    return json({ response: { header: { resultCode: "00", resultMsg: "정상" }, body: { items: item, totalCount: item.length } } });
  }) as typeof fetch;
  return calls;
}

const ids = (items: Record<string, unknown>[]) => items.map((it) => String(it.bidNtceNo));

function expectedDays(from: Date, to: Date): string[] {
  const out: string[] = [];
  for (let d = new Date(from); d <= to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) out.push(dayKey(d));
  return out;
}

const today = () => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
};
const daysAgo = (n: number) => {
  const t = today();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate() - n);
};

test("한도 안의 조회는 한 번에 끝난다", async () => {
  const calls = installFetch(6);
  const run = await runApiCollect(PROFILE, bidConfig(6), { secret: "k" });
  assert.equal(run.error, undefined);
  assert.equal(calls.length, 1);
  assert.deepEqual(ids(run.items), expectedDays(daysAgo(6), today()));
});

test("오류 응답을 공고 1건으로 적재하지 않는다", async () => {
  installFetch(-1); // 하루짜리 조회도 초과로 답한다
  const run = await runApiCollect(PROFILE, bidConfig(0), { secret: "k" });
  assert.equal(run.items.length, 0);
  assert.match(run.error ?? "", /07/);
  assert.match(run.error ?? "", /입력범위값 초과/);
});

test("7일 전부터 조회(달력 8일)는 한도에 걸리면 나눠서 빠짐없이 모은다", async () => {
  const calls = installFetch(6);
  const run = await runApiCollect(PROFILE, bidConfig(7), { secret: "k" });
  assert.equal(run.error, undefined);
  assert.deepEqual(ids(run.items), expectedDays(daysAgo(7), today()));
  // 첫 조회 1회(초과) + 나눈 두 구간
  assert.equal(calls.length, 3);
  assert.equal(calls[1].bgn.slice(8), "0000");
  assert.equal(calls[2].end.slice(8), "2359");
});

test("백필 한 달 청크도 한도에 맞게 나뉘고 날짜가 겹치거나 빠지지 않는다", async () => {
  installFetch(6);
  const cfg = buildChunkConfig(bidConfig(7), "2026-10");
  const run = await runApiCollect(PROFILE, { ...cfg, pagination: { ...cfg.pagination!, max_pages: 1 } }, { secret: "k" });
  assert.equal(run.error, undefined);
  assert.deepEqual(ids(run.items), expectedDays(new Date(2026, 9, 1), new Date(2026, 9, 31)));
});

test("나눈 구간 중 하나가 실패하면 모은 건과 함께 오류를 돌려준다", async () => {
  installFetch(6, dayKey(daysAgo(1)));
  const run = await runApiCollect(PROFILE, bidConfig(7), { secret: "k" });
  assert.deepEqual(ids(run.items), expectedDays(daysAgo(7), daysAgo(4)));
  assert.match(run.error ?? "", /일부 구간 실패/);
  assert.match(run.error ?? "", /99/);
});

// 포털 게이트웨이 오류(OpenAPI_ServiceResponse) — 인증키 미등록·요청 한도 초과 등.
// 2026-11-19 실측: 키 오류는 HTTP 401/403 에 JSON 본문으로 온다. 같은 본문이 HTTP 200 으로 오면
// JSON 은 오류 객체가 공고 1건으로, XML(옛 형식)은 0건 성공으로 지나가므로 둘 다 실패로 잡는다.

const gatewayJson = (errMsg: string, authMsg: string, code: string) =>
  JSON.stringify({ OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg, returnAuthMsg: authMsg, returnReasonCode: code } } });

const gatewayXml = (authMsg: string, code: string) =>
  `<OpenAPI_ServiceResponse>\n\t<cmmMsgHeader>\n\t\t<errMsg>SERVICE ERROR</errMsg>\n\t\t<returnAuthMsg>${authMsg}</returnAuthMsg>\n\t\t<returnReasonCode>${code}</returnReasonCode>\n\t</cmmMsgHeader>\n</OpenAPI_ServiceResponse>`;

/** 모든 요청에 같은 응답을 돌려주는 fetch — 호출 횟수를 센다. */
function installFixedFetch(status: number, contentType: string, body: string): { count: number } {
  const calls = { count: 0 };
  globalThis.fetch = (async () => {
    calls.count++;
    return new Response(body, { status, headers: { "content-type": contentType } });
  }) as typeof fetch;
  return calls;
}

test("포털 오류 본문이 HTTP 200 JSON 으로 와도 공고 1건으로 적재하지 않는다", async () => {
  installFixedFetch(200, "application/json", gatewayJson("SERVICE_KEY_IS_NOT_REGISTERED_ERROR", "등록되지 않은 서비스키", "30"));
  const run = await runApiCollect(PROFILE, bidConfig(6), { secret: "k" });
  assert.equal(run.items.length, 0);
  assert.match(run.error ?? "", /30/);
  assert.match(run.error ?? "", /등록되지 않은 서비스키/);
});

test("포털 오류가 XML 본문으로 와도 0건 성공으로 넘기지 않는다", async () => {
  installFixedFetch(200, "text/xml;charset=UTF-8", gatewayXml("LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR", "22"));
  const run = await runApiCollect(PROFILE, bidConfig(6), { secret: "k" });
  assert.equal(run.items.length, 0);
  assert.match(run.error ?? "", /22/);
  assert.match(run.error ?? "", /LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR/);
});

test("HTTP 403 응답은 본문의 사유를 오류에 싣는다", async () => {
  installFixedFetch(403, "application/json", gatewayJson("SERVICE_KEY_IS_NOT_REGISTERED_ERROR", "등록되지 않은 서비스키", "30"));
  const run = await runApiCollect(PROFILE, bidConfig(6), { secret: "k" });
  assert.equal(run.items.length, 0);
  assert.match(run.error ?? "", /HTTP 403/);
  assert.match(run.error ?? "", /등록되지 않은 서비스키/);
});

test("본문이 없는 HTTP 오류는 상태만 남긴다", async () => {
  installFixedFetch(502, "text/html", "<html>Bad Gateway</html>");
  const run = await runApiCollect(PROFILE, bidConfig(6), { secret: "k" });
  assert.equal(run.items.length, 0);
  assert.match(run.error ?? "", /^HTTP 502/);
});

test("포털 오류는 사유 번호가 07 이어도 조회 기간을 나누지 않는다", async () => {
  const calls = installFixedFetch(200, "text/xml", gatewayXml("SOME_GATEWAY_ERROR", "07"));
  const run = await runApiCollect(PROFILE, bidConfig(7), { secret: "k" });
  assert.equal(calls.count, 1);
  assert.equal(run.items.length, 0);
  assert.match(run.error ?? "", /SOME_GATEWAY_ERROR/);
});

test("월 단위 조회(YYYYMM)는 나누지 않고 오류로 끝낸다", async () => {
  const calls = installFetch(6);
  const cfg: ApiConfig = {
    primary_endpoint: { path: "/1230000/ao/OrderPlanSttusService/getOrderPlanSttusListServcPPSSrch" },
    params: { type: "json" },
    date_filters: [
      { field: "orderBgnYm", relative_days: 30, format: "YYYYMM" },
      { field: "orderEndYm", relative_days: 0, format: "YYYYMM" },
    ],
  };
  const run = await runApiCollect(PROFILE, cfg, { secret: "k" });
  assert.equal(calls.length, 1);
  assert.equal(run.items.length, 0);
  assert.match(run.error ?? "", /07/);
});
