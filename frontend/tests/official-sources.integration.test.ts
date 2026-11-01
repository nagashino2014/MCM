import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { collectOfficialSource, ingestSignalEvidence, listOfficialEvidence, listOfficialSources, nextOfficialCollectionDue, updateOfficialSource } from "../lib/intel/official-sources";
import { emptyOfficialState } from "../lib/intel/official-sources-policy";
import type { OfficialFetcher } from "../lib/intel/official-sources-fetch";
import { createEndpoint, createSource, deleteEndpoint, deleteSource, getEndpoint, getSource, getSourceSecret, listEnabledCustomCollectors, listSources, updateEndpoint, updateSource } from "../lib/scraper/sources-store";
import { getDb } from "../lib/db";
import { getIntelSignalDetail, listIntelSignals } from "../lib/intel/intel-queries";
import { getBriefing, searchSimilarSignals } from "../lib/intel/rag-queries";
import { indexPendingEmbeddings } from "../lib/intel/rag-indexer";

test("공식소스 로컬 PostgreSQL fixture: 권리·정정·동시성·snapshot·스케줄", async (t) => {
  const raw = process.env.OFFICIAL_SOURCES_TEST_DATABASE_URL!, url = new URL(raw);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)); assert.equal(url.pathname, "/intel_sources_test");
  const adminUrl = new URL(raw); adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.toString(), ssl: false }); await admin.connect();
  if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname='intel_sources_test'")).rowCount) await admin.query("CREATE DATABASE intel_sources_test"); await admin.end();
  const db = new Client({ connectionString: raw, ssl: false }); await db.connect();
  const schema = `official_test_${Date.now()}`;
  await db.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema}`);
  await db.query(await readFile("tests/fixtures/official-sources-base.sql", "utf8"));
  const migration = await readFile("../infra/aws/319_official_intelligence_sources.sql", "utf8"); await db.query(migration); await db.query(migration);
  url.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.toString(); process.env.PGSSL = "disable"; Object.assign(process.env, { NODE_ENV: "test" }); process.env.AUTH_SECRET = "local-fixture-only"; delete process.env.MCM_DB_EXPECTED_ROLE; delete process.env.MCM_DB_ROLE_REQUIRED;
  const series = { label: "반도체", orgId: "101", tblId: "TABLE", itmId: "T1", objL1: "C26", prdSe: "M" as const };
  const permissions = { ...emptyOfficialState().permissions, collectionAllowed: true, storageAllowed: true, aiAllowed: true, internalReportAllowed: true, evidenceUrl: "https://kosis.kr/openapi/index/index.jsp", note: "Fixture 이용조건 확인; 실제 기관 권리 검증 아님" };
  let revisionA = "", snapshotAt = "", version = 0;
  const makeFetcher = (value: string): OfficialFetcher => async (_provider, requestUrl) => ({ text: JSON.stringify(["202608", "202609"].map(period => ({ ORG_ID: "101", TBL_ID: "TABLE", ITM_ID: "T1", C1: "C26", PRD_SE: "M", PRD_DE: period, DT: value, UNIT_NM: "지수" }))), url: requestUrl, contentType: "application/json" });
  const count = async (table: string) => Number((await db.query(`SELECT count(*) n FROM ${table}`)).rows[0].n);
  await t.test("초기 미설정·권리대기는 HTTP 호출과 문서 저장을 하지 않는다", async () => {
    const sources = await listOfficialSources(); assert.equal(sources.length, 8); assert.equal(sources.find(s => s.providerId === "kdi")?.state, "rights_pending");
    let called = false; const result = await collectOfficialSource("kdi", { fetcher: async () => { called = true; throw new Error("should not call"); } });
    assert.equal(result.status, "waiting"); assert.equal(called, false); assert.equal(await count("intel_source_documents"), 0);
  });
  await t.test("암호화키 저장·버전충돌·구형 collector 비활성·첫 응답 검증", async () => {
    const source = await updateOfficialSource({ providerId: "kosis", enabled: true, expectedVersion: 0, permissions, config: { series: [series] }, authSecret: "fixture-api-key" }, "tester");
    version = source.configVersion; assert.equal(source.state, "verification_pending"); assert.equal(source.lastSuccessAt, null); assert.equal(JSON.stringify(source).includes("fixture-api-key"), false);
    const stored = (await db.query("SELECT auth_secret_enc,enabled FROM scraper_sources WHERE official_provider='kosis'")).rows[0]; assert.notEqual(stored.auth_secret_enc, "fixture-api-key"); assert.equal(stored.enabled, 0);
    await assert.rejects(updateOfficialSource({ providerId: "kosis", enabled: true, expectedVersion: 0, permissions, config: { series: [series] } }, "tester"), e => (e as { status: number }).status === 409);
    const first = await collectOfficialSource("kosis", { fetcher: makeFetcher("100") }); assert.equal(first.inserted, 2); assert.equal(first.status, "collected");
    const current = (await listOfficialSources()).find(s => s.providerId === "kosis")!; assert.equal(current.state, "active"); assert.ok(current.lastSuccessAt); assert.ok(await nextOfficialCollectionDue());
    const firstEvidence = await listOfficialEvidence(); revisionA = firstEvidence.evidence[0].revisionId; snapshotAt = new Date().toISOString();
    assert.equal(firstEvidence.total, 2); assert.ok(firstEvidence.evidence.every(e => !JSON.stringify(e).includes("fixture-api-key")));
  });
  await t.test("같은 응답 재시도는 멱등이고 A→B→A 정정은 각 새 revision이다", async () => {
    const same = await collectOfficialSource("kosis", { fetcher: makeFetcher("100") }); assert.equal(same.status, "no_change"); assert.equal(await count("intel_source_document_revisions"), 2);
    const changed = await collectOfficialSource("kosis", { fetcher: makeFetcher("101") }); assert.equal(changed.changed, 2); assert.equal(await count("intel_source_document_revisions"), 4);
    const history = await listOfficialEvidence({ asOf: snapshotAt }); assert.equal(history.evidence[0].revisionId, revisionA); assert.equal(history.evidence[0].structuredData.value, 100);
    const reverted = await collectOfficialSource("kosis", { fetcher: makeFetcher("100") }); assert.equal(reverted.changed, 2); assert.equal(await count("intel_source_document_revisions"), 6);
    assert.equal(await count("intel_indicator_observations"), 6);
  });
  await t.test("페이지 끝에서도 전체 집계와 다음 offset이 정확하다", async () => {
    const first = await listOfficialEvidence({ limit: 1 }); const second = await listOfficialEvidence({ limit: 1, offset: first.nextOffset! }); const empty = await listOfficialEvidence({ limit: 1, offset: 50 });
    assert.equal(first.total, 2); assert.equal(first.nextOffset, 1); assert.equal(second.nextOffset, null); assert.notEqual(first.evidence[0].revisionId, second.evidence[0].revisionId); assert.equal(empty.total, 2); assert.equal(empty.evidence.length, 0);
  });
  await t.test("동시 수집은 lease로 차단하고 수집 중 권리 회수는 적재를 폐기한다", async () => {
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(r => { entered = r; }); const gate = new Promise<void>(r => { release = r; });
    const pending = collectOfficialSource("kosis", { fetcher: async (p, u) => { entered(); await gate; return makeFetcher("102")(p, u); } }); await started;
    assert.equal((await collectOfficialSource("kosis", { fetcher: makeFetcher("999") })).status, "busy");
    const source = await updateOfficialSource({ providerId: "kosis", enabled: true, expectedVersion: version, permissions: { ...permissions, aiAllowed: false }, config: { series: [series] } }, "tester"); version = source.configVersion;
    release(); assert.equal((await pending).status, "waiting"); assert.equal(await count("intel_source_document_revisions"), 6);
    assert.equal((await listOfficialEvidence({ asOf: snapshotAt })).total, 0); assert.equal(await nextOfficialCollectionDue(), null);
  });
  await t.test("회수 후 재승인은 새 검증·권리 snapshot을 요구하고 실패는 성공일자를 덮지 않는다", async () => {
    await updateOfficialSource({ providerId: "kosis", enabled: true, expectedVersion: version, permissions, config: { series: [series] } }, "tester");
    const saved = await collectOfficialSource("kosis", { fetcher: makeFetcher("100") }); assert.equal(saved.changed, 2);
    const before = (await listOfficialSources()).find(s => s.providerId === "kosis")!;
    const failed = await collectOfficialSource("kosis", { fetcher: async () => { throw new Error("fixture-api-key must never appear"); } }); assert.equal(failed.status, "failed"); assert.ok(!JSON.stringify(failed).includes("fixture-api-key"));
    const after = (await listOfficialSources()).find(s => s.providerId === "kosis")!; assert.equal(after.lastSuccessAt, before.lastSuccessAt); assert.equal(after.state, "error");
  });
  await t.test("기존 신호는 원문을 복사하지 않고 revision metadata만 생성한다", async () => {
    await db.query("INSERT INTO intel_signals(signal_id,source,external_id,company_name,report_name,summary,created_at,updated_at) VALUES('legacy1','news','legacy1','기업','투자 발표','복사하면 안 되는 기존 본문',now()::text,now()::text)");
    const a = await ingestSignalEvidence({ signalIds: ["legacy1"], mode: "initial_backfill" }); const b = await ingestSignalEvidence({ signalIds: ["legacy1"], mode: "live" }); assert.equal(a.revisionIds[0], b.revisionIds[0]);
    const stored = (await db.query("SELECT normalized_text,rights_snapshot FROM intel_source_document_revisions WHERE revision_id=$1", [a.revisionIds[0]])).rows[0]; assert.equal(stored.normalized_text, ""); assert.equal(stored.rights_snapshot.aiAllowed, false);
    await db.query("UPDATE intel_signals SET report_name='투자 계획 정정' WHERE signal_id='legacy1'"); const corrected = await ingestSignalEvidence({ signalIds: ["legacy1"] }); assert.notEqual(corrected.revisionIds[0], a.revisionIds[0]);
  });
  await t.test("기업 발표는 AI·보고 권리 없이 신호 우회가 없고, 승인 후 monitoring 후보 한 건만 유지한다", async () => {
    const home = "https://news.samsungsemiconductor.com/kr/", published = new Date().toISOString().slice(0, 10);
    const corporatePermissions = { ...permissions, evidenceUrl: home, aiAllowed: false };
    let title = "삼성전자 반도체 신설 투자계획";
    const fetcher: OfficialFetcher = async (_provider, requestUrl) => ({ text: requestUrl === home ? '<a href="/kr/test-investment/">투자 발표</a>' : `<html><title>${title}</title><meta property="article:published_time" content="${published}"><article>${"반도체 생산시설의 투자 계획을 공개했습니다. 아직 환경 인허가 수요는 검토가 필요합니다. ".repeat(5)}</article></html>`, url: requestUrl, contentType: "text/html" });
    const source = await updateOfficialSource({ providerId: "samsung_semiconductor", enabled: true, expectedVersion: 0, permissions: corporatePermissions, config: { channelUrl: home } }, "tester");
    const first = await collectOfficialSource("samsung_semiconductor", { fetcher }); assert.equal(first.inserted, 1); assert.equal(first.signalIds.length, 0);
    assert.equal((await listOfficialEvidence({ types: ["company_event"] })).total, 0);
    await updateOfficialSource({ providerId: "samsung_semiconductor", enabled: true, expectedVersion: source.configVersion, permissions: { ...corporatePermissions, aiAllowed: true }, config: { channelUrl: home } }, "tester");
    const approved = await collectOfficialSource("samsung_semiconductor", { fetcher }); assert.equal(approved.signalIds.length, 1);
    const signal = (await db.query("SELECT * FROM intel_signals WHERE signal_id=$1", [approved.signalIds[0]])).rows[0]; assert.equal(signal.signal_grade, "monitoring"); assert.equal(signal.signal_type, "new_site"); assert.equal(signal.industry, "semiconductor");
    const detail = await getIntelSignalDetail(approved.signalIds[0]); assert.equal(detail?.summary, title); assert.deepEqual(Object.keys(detail?.rawJson ?? {}).sort(), ["documentId", "revisionId"]);
    title = "삼성전자 반도체 신설 투자계획 정정";
    const correction = await collectOfficialSource("samsung_semiconductor", { fetcher }); assert.equal(correction.signalIds[0], approved.signalIds[0]);
    assert.equal((await db.query("SELECT report_name FROM intel_signals WHERE signal_id=$1", [approved.signalIds[0]])).rows[0].report_name, title);
    assert.equal((await listOfficialEvidence({ industries: ["semiconductor"], types: ["company_event"] })).total, 1);
    assert.equal((await listOfficialEvidence({ industries: ["electronics"], types: ["company_event"] })).total, 0);
  });
  await t.test("활성화를 중지하면 기존 공식 증거를 새 보고서 조회에서 제외한다", async () => {
    const source = (await listOfficialSources()).find(s => s.providerId === "samsung_semiconductor")!;
    await updateOfficialSource({ providerId: source.providerId, enabled: false, expectedVersion: source.configVersion, permissions: source.permissions, config: source.config }, "tester");
    assert.equal((await listOfficialEvidence({ types: ["company_event"] })).total, 0);
  });
  await t.test("회수된 공식 신호의 상세와 구형 브리핑·검색·임베딩 우회가 차단된다", async () => {
    const signalId = (await db.query("SELECT signal_id FROM intel_signals WHERE source='official:samsung_semiconductor'")).rows[0].signal_id;
    await assert.rejects(getIntelSignalDetail(signalId), e => (e as { status: number }).status === 403);
    assert.equal((await listIntelSignals({ grade: "all" })).signals.some(s => s.source.startsWith("official:")), false);
    await db.query("UPDATE intel_signals SET signal_grade='candidate',signal_type='investment',industry_relevance='direct' WHERE signal_id='legacy1'");
    const oldKey = process.env.VOYAGE_API_KEY; delete process.env.VOYAGE_API_KEY;
    const hits = await searchSimilarSignals("투자", {}, 40); assert.equal(hits.hits.some(s => s.source.startsWith("official:")), false); assert.ok(hits.hits.some(s => s.signalId === "legacy1"));
    await db.query("INSERT INTO intel_rag_briefings(briefing_id,question,sources) VALUES('unsafe','과거 혼입',$1::jsonb)", [JSON.stringify([{ signalId, source: "official:samsung_semiconductor" }])]);
    await assert.rejects(getBriefing("unsafe"), e => (e as { status: number }).status === 403);
    await db.query("INSERT INTO intel_embeddings(signal_id,content) VALUES('legacy1','기존 자료')");
    const fetch = globalThis.fetch; let externalCalls = 0;
    globalThis.fetch = async () => { externalCalls++; throw new Error("fixture 외부 호출 차단"); }; process.env.VOYAGE_API_KEY = "fixture-no-network";
    try { assert.deepEqual(await indexPendingEmbeddings(), { configured: true, indexed: 0, remaining: 0 }); assert.equal(externalCalls, 0); }
    finally { globalThis.fetch = fetch; if (oldKey === undefined) delete process.env.VOYAGE_API_KEY; else process.env.VOYAGE_API_KEY = oldKey; }
  });
  await t.test("범용 소스 API의 조회·키읽기·수정·삭제·endpoint추가·기존 배치가 공식소스를 우회하지 못한다", async () => {
    const sid = "official_kosis", eid = "official_endpoint_kosis", conflict = (e: unknown) => (e as { status: number }).status === 409;
    assert.equal(await getSource(sid), null); assert.equal(await getEndpoint(eid), null); assert.equal(await getSourceSecret(sid), null);
    assert.ok(!(await listSources()).some(s => s.sourceId === sid));
    await assert.rejects(updateSource(sid, { enabled: true }, "tester"), conflict);
    await assert.rejects(deleteSource(sid), conflict);
    await assert.rejects(createEndpoint({ sourceId: sid, name: "우회" }), conflict);
    await assert.rejects(updateEndpoint(eid, { enabled: true }), conflict);
    await assert.rejects(deleteEndpoint(eid), conflict);
    await db.query("UPDATE scraper_sources SET enabled=1 WHERE source_id=$1", [sid]); await db.query("UPDATE scraper_endpoints SET enabled=1 WHERE endpoint_id=$1", [eid]);
    assert.equal((await listEnabledCustomCollectors(await getDb(), "intel")).length, 0);
    const ordinary = await createSource({ name: "Fixture 일반 소스", slug: "fixture-generic", updatedBy: "tester" });
    const endpoint = await createEndpoint({ sourceId: ordinary.sourceId, name: "일반 엔드포인트" });
    await updateSource(ordinary.sourceId, { enabled: true }, "tester"); await updateEndpoint(endpoint.endpointId, { enabled: true });
    assert.equal((await listEnabledCustomCollectors(await getDb(), "intel")).length, 1);
    await deleteEndpoint(endpoint.endpointId); await deleteSource(ordinary.sourceId);
  });
  await db.end();
});
