import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

// 생성·저장 경계만 대체한다. 실제 AI나 DB에 연결하지 않고 실제 rag-queries를 실행한다.
const doubles = {
  "@/lib/db": `const state=()=>globalThis.__ragCurationTest; export const getDb=async()=>({exec:async(sql,args=[])=>state().read(sql,args),run:async(sql,args=[])=>{state().writes.push({sql,args});}}); export const rowsToObjects=x=>x; export const withDbWrite=async fn=>fn(await getDb());`,
  "./embeddings": `export const EMBEDDING_MODEL="fixture"; export const isEmbeddingConfigured=()=>!!globalThis.__ragCurationTest.vectorMode; export const embedTexts=async(texts,type)=>{globalThis.__ragCurationTest.embeddingCalls.push({texts,type});return [[0.1]];}; export const toVectorLiteral=()=>"[0.1]";`,
  "./intel-queries": `export const sourceCondition=()=>"TRUE";`,
  "./official-sources-visibility": `export const assertLegacyBriefingSourcePolicy=()=>{}; export const legacySignalSourceCondition=()=>"TRUE";`,
  "./briefing-store": `export const assertBriefingAccess=async()=>{};`,
  "./briefing-curation": `export const curateBriefingReport=async input=>{globalThis.__ragCurationTest.calls.push(input);return globalThis.__ragCurationTest.curate(input);};`,
};
const built = await build({ entryPoints: ["lib/intel/rag-queries.ts"], bundle: true, write: false, platform: "node", format: "esm", packages: "external", tsconfig: "tsconfig.json", plugins: [{ name: "rag-boundary-doubles", setup(b) {
  b.onResolve({ filter: /.*/ }, args => Object.hasOwn(doubles, args.path) ? { path: args.path, namespace: "double" } : undefined);
  b.onLoad({ filter: /.*/, namespace: "double" }, args => ({ contents: doubles[args.path], loader: "js" }));
} }] });
const { generateBriefing, refineBriefing, getBriefing, searchSimilarSignals } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
const source = id => ({ signalId: id, score: 0.8, source: "news", companyName: "테스트 기업", reportName: `${id} 공장 투자`, disclosedAt: "2026-10-01", facilityName: "테스트 공장", url: `https://example.invalid/${id}` });
const report = () => ({ kpis: [{ label: "수집 신호", value: "1건", sub: null }], trends: ["확인된 투자 [1]"], companies: [], insights: [{ badge: "참고", text: "배경 [1]", importance: 99 }, { badge: "우선 검토", text: "접촉 [1]", importance: 50 }], etcNote: null });
const hit = id => ({ signal_id: id, source: "news", company_name: "테스트 기업", report_name: `${id} 공장 투자`, signal_type: "new_facility", signal_grade: "candidate", disclosed_at: "2026-10-01", url: `https://example.invalid/${id}`, facility_name: "테스트 공장", summary: "독립된 공장 투자", content: "확인된 위치와 착공 예정일", score: 0.8 });
function setup({ restricted = false, snapshot = true } = {}) {
  const row = { briefing_id: "old", question: "테스트 기업 투자", answer_md: JSON.stringify(report()), sources: [source("s1")], filters: {}, model: "old-model", status: "done", created_by: "u1", created_at: "2026-10-01T00:00:00Z", access_scope: restricted ? "restricted" : "legacy_sales" };
  const state = { row, calls: [], writes: [], searches: 0, embeddings: 0, embeddingCalls: [], currentRows: [hit("s1")], searchRows: [hit("s1"), hit("s2")], curate: input => ({ report: { ...report(), kpis: input.kpis }, sources: input.preserveSourceOrder ? input.items.map(item => source(item.id.replace(/^signal:/, ""))) : [source("s2")], model: "configured-model" }), read(sql) {
    if (sql.includes("SELECT s.signal_id FROM intel_signals s WHERE")) return state.heldNews ? [{ signal_id: "s1" }] : [];
    if (sql.includes("AS scope")) return [{ scope: row.access_scope, profile_id: restricted ? "profile1" : null, snapshot_id: restricted ? "snapshot1" : null }];
    if (sql.includes("SELECT payload")) return snapshot ? [{ payload: { items: [
      { id: "signal:s1", revision: "r1", kind: "signal", title: "발행 당시 투자", companyName: "테스트 기업", region: "충북", source: "news", url: source("s1").url, publishedAt: "2026-10-01", discoveredAt: "2026-10-01T00:00:00Z", text: "고정된 발행 당시 근거", changed: true, amount: null, relatedEvidenceIds: ["project:p1"] },
      { id: "project:p1", revision: "p1r1", kind: "project", title: "발행 당시 프로젝트", companyName: "테스트 기업", region: "충북", source: "project", url: null, publishedAt: null, discoveredAt: "2026-10-01T00:00:00Z", text: JSON.stringify({ stage: "approved", publicSummary: "공장 증설", currency: "KRW", amountScope: "project" }), changed: true, amount: 500, relatedEvidenceIds: ["signal:s1"] },
    ] } }] : [];
    if (sql.includes("WHERE s.signal_id=ANY($1::text[])")) return state.currentRows;
    if (sql.includes("FROM intel_rag_briefings b")) return [row];
    if (sql.includes("FROM intel_embeddings e")) return state.vectorRows ?? [];
    if (sql.includes("FROM intel_signals s")) { state.searches++; return state.searchRows; }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  globalThis.__ragCurationTest = state;
  return state;
}

test("수동 생성은 선별 근거·실제 모델·동일 JSON을 반환하고 저장한다", async () => {
  const state = setup();
  const result = await generateBriefing("테스트 기업 투자", {}, "u1");
  assert.equal(state.calls[0].feature, "intel.rag_briefing");
  assert.deepEqual(state.calls[0].items.map(item => item.id), ["signal:s1", "signal:s2"]);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].facilityName, "테스트 공장");
  assert.equal(result.model, "configured-model");
  assert.deepEqual(JSON.parse(result.answerMd), result.report);
  assert.equal(state.writes[0].args[2], result.answerMd);
  assert.equal(state.writes[0].args[5], "configured-model");
  assert.deepEqual(JSON.parse(state.writes[0].args[3]), result.sources);
});

test("기존 발행본 조회는 본문을 압축하지 않고 중요도와 분류 순서를 유지한다", async () => {
  const state = setup();
  const old = report(); old.trends = Array.from({ length: 18 }, (_, n) => `보존 동향 ${n} [1]`);
  old.insights.push({ badge: "우선 검토", text: "높은 중요도 [1]", importance: 90 });
  state.row.answer_md = JSON.stringify(old);
  const result = await getBriefing("old");
  assert.equal(result.report.trends.length, 18);
  assert.deepEqual(result.report.insights.map(item => item.importance), [90, 50, 99]);
  assert.equal(result.answerMd, state.row.answer_md);
  assert.equal(state.writes.length, 0);
});

test("수동 추가 분석은 기존 출처를 유지하고 새 근거만 끝에 붙인다", async () => {
  const state = setup();
  const result = await refineBriefing("old", "착공 일정 보강", "u1");
  assert.equal(state.calls[0].preserveSourceOrder, true);
  assert.deepEqual(state.calls[0].items.map(item => item.id), ["signal:s1", "signal:s2"]);
  assert.match(state.calls[0].context, /착공 일정 보강/);
  assert.deepEqual(result.sources.map(item => item.signalId), ["s1", "s2"]);
  assert.match(state.writes[0].sql, /^UPDATE/);
  assert.equal(state.writes[0].args[0], result.answerMd);
  assert.equal(state.writes[0].args[2], "configured-model");
});

test("정기 발행본 추가 분석은 당시 근거만 사용하고 새 발행본으로 보존한다", async () => {
  const state = setup({ restricted: true });
  const result = await refineBriefing("old", "일정 검토", "u1");
  assert.equal(state.calls[0].items[0].text, "고정된 발행 당시 근거");
  assert.deepEqual(state.calls[0].items.map(item => item.id), ["signal:s1"]);
  assert.deepEqual(state.calls[0].items[0].relatedEvidenceIds, ["project:p1"]);
  assert.deepEqual(state.calls[0].linkedProjectMetadata.map(item => item.id), ["project:p1"]);
  assert.equal(state.calls[0].linkedProjectMetadata[0].amount, 500);
  assert.equal(state.calls[0].requireOfficialBackground, true);
  assert.deepEqual(result.sources.map(source => source.signalId), ["s1"], "업무 연결 메타데이터는 인용 출처번호를 추가하지 않는다");
  assert.equal(state.searches, 0); assert.equal(state.embeddings, 0);
  assert.notEqual(result.briefingId, "old");
  assert.match(state.writes[0].sql, /^INSERT/);
  assert.equal(state.writes[0].args.at(-1), "old");
  assert.equal(state.writes[0].args[5], "configured-model");
});

test("발행 당시 근거가 없으면 추가 분석·저장을 시작하지 않는다", async () => {
  const state = setup({ restricted: true, snapshot: false });
  await assert.rejects(refineBriefing("old", "일정 검토", "u1"), /발행 당시의 근거/);
  assert.equal(state.calls.length, 0); assert.equal(state.writes.length, 0); assert.equal(state.embeddings, 0);
});

test("발행 후 뉴스 근거가 보류되면 수동·정기 추가분석 모두 AI 호출 전에 차단한다", async () => {
  for (const restricted of [false, true]) {
    const state = setup({ restricted }); state.heldNews = true;
    await assert.rejects(refineBriefing("old", "일정 검토", "u1"), /재검증/);
    assert.equal(state.calls.length, 0); assert.equal(state.writes.length, 0); assert.equal(state.embeddings, 0);
  }
});

test("연결 프로젝트 ID는 원문 출처번호와 별도로 보존하고 잘못된 ID는 제거한다", async () => {
  const state = setup();
  state.row.answer_md = JSON.stringify({ ...report(), companies: [{ name: "회사", project: "공장 증설", projectId: "ip_valid-123" }, { name: "회사", projectId: "../outside" }] });
  const result = await getBriefing("old");
  assert.equal(result.report.companies[0].projectId, "ip_valid-123");
  assert.equal(result.report.companies[1].projectId, null);
  assert.deepEqual(result.sources.map(source => source.signalId), ["s1"]);
});

test("키워드 검색·새 브리핑은 오래된 임베딩 본문 대신 현재 제목·요약·공개 발췌를 사용한다", async () => {
  const state = setup();
  state.searchRows = [{ ...hit("s1"), report_name: "정정된 공장 발표", summary: "현재 원문에 맞춘 요약", content: "폐기된 과거 확정투자 서술", signal_snapshot: { ...hit("s1"), report_name: "정정된 공장 발표", summary: "현재 원문에 맞춘 요약", raw_json: { description: "현재 공개 발췌" } } }];
  const found = await searchSimilarSignals("정정된 공장");
  assert.equal(found.mode,"keyword"); assert.match(found.hits[0].content,/정정된 공장 발표/); assert.match(found.hits[0].content,/현재 원문에 맞춘 요약/); assert.match(found.hits[0].content,/현재 공개 발췌/); assert.ok(!found.hits[0].content.includes("폐기된"));
  await generateBriefing("정정된 공장",{},"u1");assert.ok(!state.calls[0].items[0].text.includes("폐기된"));assert.match(state.calls[0].items[0].text,/현재 공개 발췌/);assert.equal(state.embeddingCalls.length,0);
  assert.equal(state.calls[0].items[0].originalText,'현재 공개 발췌');assert.equal(state.calls[0].items[0].qualityInputKind,'search_excerpt');
});

test("현재 입력과 다른 벡터는 순위에도 사용하지 않고 현재 자료 키워드 검색으로 전환한다", async () => {
  const state = setup();state.vectorMode = true;
  state.vectorRows = [{ ...hit("old"), content:"정정 전의 임베딩 입력",score:0.99 }];
  state.searchRows = [{ ...hit("corrected"),summary:"현재 정정 내용" }];
  const result=await searchSimilarSignals("현재 정정");assert.equal(result.mode,"keyword");assert.deepEqual(result.hits.map(h=>h.signalId),["corrected"]);assert.equal(state.searches,1);
  assert.deepEqual(state.embeddingCalls.map(call=>call.type),["query"],"문서 재임베딩 호출 없음");assert.equal(state.writes.length,0);
});

test("원자료와 일치하는 기존 벡터는 유지하고 원문·기업명·금액 변경도 stale로 판정한다", async () => {
  const state=setup();state.searchRows=[hit("same")];
  const current=(await searchSimilarSignals("공장")).hits[0].content;state.vectorMode=true;state.searches=0;
  state.vectorRows=[{...hit("same"),content:current,score:0.8}];
  assert.equal((await searchSimilarSignals("공장")).mode,"vector");assert.equal(state.searches,0);
  for(const change of [{summary:"변경된 요약"},{company_name:"정정 기업"},{amount:50000000000},{raw_json:{description:"정정 발췌"}}]){
    state.vectorRows=[{...hit("same"),...change,content:current}];assert.equal((await searchSimilarSignals("공장")).mode,"keyword");
  }
  assert.equal(state.writes.length,0);assert.ok(state.embeddingCalls.every(call=>call.type==='query'));
});

test("수동 추가 분석은 출처 제목과 본문을 함께 갱신하고 누락된 현재 원자료를 과거 제목으로 대체하지 않는다", async () => {
  let state=setup();state.currentRows=[{...hit('s1'),report_name:'정정된 출처 제목',summary:'현재 확인된 내용',content:'오래된 내용'}];
  await refineBriefing('old','정정 내용 반영','u1');assert.equal(state.calls[0].items[0].title,'정정된 출처 제목');assert.match(state.calls[0].items[0].text,/현재 확인된 내용/);assert.ok(!state.calls[0].items[0].text.includes('오래된 내용'));
  state=setup();state.currentRows=[];await assert.rejects(refineBriefing('old','정정 내용 반영','u1'),/기존 원자료를 확인/);assert.equal(state.calls.length,0);assert.equal(state.writes.length,0);
});

test("보강 원자료는 press 본문과 원문 없는 신호를 구분하고 원문 변경도 revision에 반영한다", async () => {
  let state=setup();state.searchRows=[{...hit('s1'),source:'press',raw_json:{body:'공개 기관 원문',classification:{summary:'파생 분류 요약'},privateMemo:'비공개 fixture'}}];
  await generateBriefing('공장',{},'u1');const first=state.calls[0].items[0];assert.equal(first.originalText,'공개 기관 원문');assert.equal(first.qualityInputKind,'full_text');assert.ok(!JSON.stringify(first).includes('비공개 fixture'));
  state.searchRows[0].raw_json.body='공개 기관 정정 원문';await generateBriefing('공장',{},'u1');assert.notEqual(state.calls[1].items[0].revision,first.revision);
  state=setup();await generateBriefing('공장',{},'u1');assert.equal(state.calls[0].items[0].originalText,null);assert.equal(state.calls[0].items[0].qualityInputKind,'title_only');
});
