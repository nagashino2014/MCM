import assert from "node:assert/strict";
import { test } from "node:test";
import { curateBriefingReport, evidenceCompleteness, validateBriefingDigest, type BriefingDigest, type BriefingCurationInput } from "../lib/intel/briefing-curation";
import { separateAmbiguousProjectLinks, sortBriefingInsights } from "../lib/intel/briefing-report-policy";
import { parseBriefingReport, type BriefingReport } from "../lib/intel/rag-queries";
import type { BriefingEvidence } from "../lib/intel/briefing-types";
import type { ClaudeMessagesResult } from "../lib/ai/claude-client";

const item = (n: number, extra: Partial<BriefingEvidence> = {}): BriefingEvidence => {
  const value:BriefingEvidence={ id: `signal:s${n}`, revision: "r1", kind: "signal", title: `회사A 공장 ${n}`, text: `회사A Y${n} 공장 ${n} 투자 검토`, companyName: "회사A", region: null, source: "news", url: `https://news.example/${n}`, publishedAt: "2026-10-30T00:00:00Z", discoveredAt: "2026-10-31T00:00:00Z", changed: true, amount: null, ...extra };
  return {...value,originalText:Object.hasOwn(extra,"originalText")?extra.originalText:value.kind==="project"?null:value.text,qualityInputKind:extra.qualityInputKind??(value.kind==="project"?"derived":value.kind==="official"?"full_text":"search_excerpt")};
};
const entry = (n: number, topic = `회사A|공장${n}|투자`, text = `공장${n} 투자 검토`) => ({ topic, text, representative: n, references: [n], importance: 50 });
const input = (items: BriefingEvidence[]): BriefingCurationInput => ({ items, question: "반도체 투자", reportLevel: "summary", context: "초기 기준 자료", feature: "intel.scheduled_briefing", model: "test", kpis: [] });
const response = (digest: BriefingDigest): ClaudeMessagesResult => ({ ok: true, status: 200, data: { stop_reason: "end_turn" }, errorText: null, requestId: "test", usage: null, costUsd: 0, model: "test", latencyMs: 0, text: JSON.stringify(digest) });

test("대표 원문만 인용하고 연결 프로젝트는 별도 업무 링크로 보존한다", async () => {
  const evidence = [item(1, { id: "project:p1", kind: "project", text: JSON.stringify({ publicSummary: "공장 증설", stage: "unknown" }), relatedEvidenceIds: ["signal:s3"] }), item(2), item(3, { text: "회사A 청주 공장 증설. 2027년 착공, 2030년 준공. 투자액 300억원, 클린룸 신설.", relatedEvidenceIds: ["project:p1"] }), item(4)];
  const before = JSON.stringify(evidence);
  const digest: BriefingDigest = { trends: [{ ...entry(3), references: [3, 1] }], investments: [{ ...entry(3), references: [3, 1], title: "청주 공장 증설" }], insights: [
    { ...entry(3, "참고", "산업 배경을 참고한다"), badge: "참고", importance: 99 },
    { ...entry(3, "후속", "준공 일정을 확인한다"), badge: "확인 필요", importance: 80 },
    { ...entry(3, "우선낮음", "공정 범위를 우선 확인한다"), badge: "우선 검토", importance: 30 },
    { ...entry(3, "우선높음", "착공 전 협의를 우선 검토한다"), badge: "우선 검토", importance: 95 },
  ] };
  const result = await curateBriefingReport(input(evidence), async () => response(digest));
  assert.deepEqual(result.sources.map(s => s.signalId), ["s3"]);
  assert.match(result.report.trends[0], /\[1\]$/); assert.match(result.report.companies[0].desc, /\[1\]$/);
  assert.equal(result.report.companies[0].projectId, "p1");
  assert.equal(result.report.companies.length, 1); assert.equal(result.report.companies[0].status, "미확인");
  assert.deepEqual(result.report.insights.map(i => i.badge), ["우선 검토", "우선 검토", "확인 필요", "참고"]);
  assert.match(result.report.insights[0].text, /착공 전/); assert.equal(JSON.stringify(evidence), before);
  assert(evidenceCompleteness(evidence[2]) > evidenceCompleteness(evidence[1]));
});

test("90개 경계의 반복 주제를 전역 병합하고 별도 공장·정정은 유지한다", async () => {
  const evidence = Array.from({ length: 91 }, (_, i) => item(i + 1));
  let calls = 0;
  const first = entry(1, "회사A|Y1|신설", "Y1 신설 계획"), correction = entry(2, "회사A|Y2|정정", "Y2 투자계획은 지연으로 정정됐다"), repeated = { ...entry(91, first.topic, "Y1 신설 상세 계획"), importance: 90 };
  const result = await curateBriefingReport(input(evidence), async request => {
    calls++;
    if (calls === 1) return response({ trends: [first, correction], investments: [{ ...first, title: "Y1" }, { ...correction, title: "Y2" }], insights: [] });
    if (calls === 2) return response({ trends: [repeated], investments: [{ ...repeated, title: "Y1" }], insights: [] });
    assert.match(JSON.stringify(request.messages), calls===3 ? /전역|서로 다른 묶음/ : /대조 검수/);
    return response({ trends: [{ ...repeated, references: [91, 1] }, correction], investments: [{ ...repeated, references: [91, 1], title: "Y1" }, { ...correction, title: "Y2" }], insights: [] });
  });
  assert.equal(calls, 4); assert.equal(result.report.trends.length, 2); assert.equal(result.report.companies.length, 2);
  assert(result.report.trends.some(text => text.includes("지연으로 정정")));
  assert.deepEqual(result.sources.map(s => s.signalId), ["s1", "s2", "s91"]);
});

test("최대15개·현재 묶음 출처·대표번호·중복·분류를 검증해 과다/무근거 발행을 거부한다", () => {
  const allowed = new Set(Array.from({ length: 20 }, (_, i) => i + 1));
  const digest = { trends: [entry(1)], investments: [], insights: [] };
  const check = (value: unknown) => validateBriefingDigest(JSON.stringify(value), allowed);
  assert.equal(check({ ...digest, trends: Array.from({ length: 15 }, (_, i) => entry(i + 1)) }).trends.length, 15);
  assert.throws(() => check({ ...digest, trends: Array.from({ length: 16 }, (_, i) => entry(i + 1)) }), /상한/);
  assert.throws(() => check({ ...digest, trends: [entry(21)] }), /출처 번호/);
  assert.throws(() => check({ ...digest, trends: [{ ...entry(1), representative: 2 }] }), /대표/);
  assert.throws(() => check({ ...digest, trends: [entry(1), entry(2, entry(1).topic)] }), /중복/);
  assert.throws(() => check({ ...digest, insights: [{ ...entry(1), badge: "확실한 수주" }] }), /분류/);
  assert.throws(() => check({ ...digest, trends: [{ ...entry(1), text: "다른 출처 [99]" }] }), /형식/);
  // 같은 충실한 기사에 별개 공장이 함께 등장할 수 있다. 중복 판단 단위는 기사 번호가 아닌 사건이다.
  assert.equal(check({ ...digest, investments: [{ ...entry(1, "회사A|Y1|신설", "Y1 공장 신설"), title: "Y1" }, { ...entry(1, "회사A|Y2|증설", "Y2 공장 증설"), title: "Y2" }] }).investments.length, 2);
});

test("항목 형식 오류는 원문 없이 절·1기준 항목·필드·길이·본문 인용 여부를 구분한다",()=>{
  const allowed=new Set([1,2]);
  const check=(bad:unknown,section="trends")=>{
    const digest:Record<string,unknown>={trends:[entry(1)],investments:[],insights:[]};digest[section]=[section==="investments"?{...entry(1),title:"정상제목"}:section==="insights"?{...entry(1),badge:"참고"}:entry(1),bad];
    try{validateBriefingDigest(JSON.stringify(digest),allowed);assert.fail("실패해야 합니다.");}catch(error){assert(error instanceof Error);return error.message;}
  };
  for(const [value,pattern]of [[null,/값 없음/],["",/0자/],["x".repeat(181),/181자; 허용 180자/]] as const){
    const message=check({...entry(2),topic:value});assert.match(message,/핵심 동향 2번 주제/);assert.match(message,pattern);assert.doesNotMatch(message,/공장2|회사A|field=|type=|length=/);
  }
  for(const [value,pattern]of [[{secret:"비공개본문"},/여러 값의 묶음/],["",/0자/],["비공개본문".repeat(181),/허용 900자/],["비공개본문 [2]",/본문 출처 번호 중복 표기: 있음/]] as const){
    const message=check({...entry(2),text:value});assert.match(message,/핵심 동향 2번 본문/);assert.match(message,pattern);assert.doesNotMatch(message,/비공개본문|field=|inlineCitation=/);
  }
  assert.match(check({...entry(2),title:"x".repeat(161)},"investments"),/투자계획 2번 제목: 입력은 글, 161자; 허용 160자/);
  assert.match(check({...entry(2),badge:"잘못된분류"},"insights"),/영업 시사점 2번 검토 분류/);
  assert.match(check({...entry(2),importance:101}),/중요도: 입력은 숫자; 정수: 예; 0~100 범위: 아니요/);
});

test("진단 보강 후에도 유효 인용의 본문 삽입·외부 번호·대표 누락·과다·중복을 엄격히 거부한다",()=>{
  const allowed=new Set([1,2,3,4,5,6]);const base={trends:[entry(1)],investments:[],insights:[]};
  const check=(trends:unknown[])=>validateBriefingDigest(JSON.stringify({...base,trends}),allowed);
  assert.throws(()=>check([{...entry(1),text:"이미 유효한 근거 [1]"}]),/본문.*본문 출처 번호 중복 표기: 있음/);
  assert.throws(()=>check([{...entry(1),references:[1,99]}]),/근거 번호.*사용할 수 없는 번호 1개/);
  assert.throws(()=>check([{...entry(1),references:[2]}]),/대표 근거 포함: 아니요/);
  assert.throws(()=>check([{...entry(1),references:[1,2,3,4,5,6]}]),/서로 다른 근거 6개/);
  assert.throws(()=>check([entry(1),entry(2,entry(1).topic)]),/핵심 동향 2번 주제: 앞선 항목과 중복/);
  assert.throws(()=>check(Array.from({length:16},()=>entry(1))),/현재 16개, 허용 15개/);
});

test("모델에는 현재 묶음 번호를 사용하는 유효한 JSON 예시와 본문 인용 금지를 제공한다",async()=>{
  let calls=0;
  await curateBriefingReport(input(Array.from({length:91},(_,i)=>item(i+1))),async request=>{
    calls++;const content=(request.messages as Array<{content:string}>)[0].content;
    const exampleLine=content.split("\n").find(line=>line.startsWith("출력 JSON 형식 예시: "));assert(exampleLine);
    const firstRef=calls===2?91:1;const example=validateBriefingDigest(exampleLine.slice("출력 JSON 형식 예시: ".length),new Set([firstRef]));assert.equal(example.trends[0].representative,firstRef);
    assert.match(String(request.system),/유효한 번호라도 본문에 쓰지 말고 references에만/);
    return response({trends:[entry(firstRef)],investments:[],insights:[]});
  });assert.equal(calls,4);
});

test("같은 제목의 다른 공시를 기계적으로 병합하지 않고 보강 출처 순서를 보존한다", async () => {
  const evidence = [item(1, { title: "신규시설투자등", source: "dart" }), item(2, { title: "신규시설투자등", source: "dart" }), item(3)];
  const result = await curateBriefingReport({ ...input(evidence), preserveSourceOrder: true }, async () => response({ trends: [entry(1), entry(2)], investments: [{ ...entry(1), title: "별도 접수번호 1" }, { ...entry(2), title: "별도 접수번호 2" }], insights: [] }));
  assert.equal(result.report.companies.length, 2); assert.equal(result.sources.length, 3);
  assert.match(result.report.trends[1], /\[2\]/);
  assert.deepEqual(sortBriefingInsights([{ badge: "참고" }, { badge: "한계" }, { badge: "우선 접촉" }]).map(i => i.badge), ["우선 검토", "확인 필요", "참고"]);
});

test("기사 하나에 여러 프로젝트가 연결되면 임의 프로젝트 금액·단계를 덧붙이지 않는다", async () => {
  const evidence = [item(1, { id: "project:p1", kind: "project", amount: 100, text: JSON.stringify({ stage: "construction", amount: 100 }) }), item(2, { id: "project:p2", kind: "project", amount: 200, text: JSON.stringify({ stage: "planned", amount: 200 }) }), item(3, { relatedEvidenceIds: ["project:p1", "project:p2"] })];
  const result = await curateBriefingReport(input(evidence), async () => response({ trends: [entry(3)], investments: [{ ...entry(3), title: "별도 투자계획" }], insights: [] }));
  assert.deepEqual(result.report.companies[0].facts, []); assert.equal(result.report.companies[0].status, null);
  assert.deepEqual(result.sources.map(s => s.signalId), ["s3"]);
});

test("정기 브리핑은 제공된 공식 산업동향을 보존하고 누락 시 발행을 보류한다", async () => {
  const evidence = [item(1), item(2, { id: "official:kdi", kind: "official", companyName: null, source: "official:kdi" })];
  const withBackground = { ...input(evidence), requireOfficialBackground: true };
  await assert.rejects(curateBriefingReport(withBackground, async () => response({ trends: [entry(1)], investments: [], insights: [] })), /공식 산업동향/);
  const result = await curateBriefingReport(withBackground, async request => {
    assert.match(JSON.stringify(request.messages), /공식 산업동향 근거/);
    return response({ trends: [entry(1), entry(2, "산업|반도체|최신동향", "10월 공식 산업동향")], investments: [], insights: [] });
  });
  assert(result.sources.some(s => s.kind === "official"));
  // 공식 자료가 없는 질문에 외부 지식을 생성하도록 강요하지 않는다.
  const noBackground = await curateBriefingReport({ ...input([item(1)]), requireOfficialBackground: true }, async () => response({ trends: [entry(1)], investments: [], insights: [] }));
  assert.equal(noBackground.sources.length, 1);
});

test("추가 분석의 별도 프로젝트 정보는 인용번호를 늘리지 않고 연결·금액을 유지한다", async () => {
  const evidence = [item(1, { relatedEvidenceIds: ["project:p1"] })];
  const metadata = item(2, { id: "project:p1", kind: "project", amount: 300, text: JSON.stringify({ stage: "planned", currency: "KRW", amountScope: "facility" }) });
  const result = await curateBriefingReport({ ...input(evidence), preserveSourceOrder: true, linkedProjectMetadata: [metadata] }, async request => {
    assert(!JSON.stringify(request.messages).includes('"currency":"KRW"'));
    return response({ trends: [entry(1)], investments: [{ ...entry(1), title: "공장 신설" }], insights: [] });
  });
  assert.equal(result.report.companies[0].projectId, "p1");
  assert.equal(result.report.companies[0].status, "planned");
  assert.match(result.report.companies[0].facts[0].value, /300 KRW/);
  assert.deepEqual(result.sources.map(s => s.signalId), ["s1"]);
  assert.match(result.report.companies[0].desc, /\[1\]$/);
});

test("같은 기사에서 선별한 별개 사업은 본문·출처를 유지하고 중복 업무 연결을 보류한다", async () => {
  const evidence = [item(1, { relatedEvidenceIds: ["project:article_project"], text: "기사 한 건에서 Y2 공장 신설과 M17 별도 투자를 함께 보도했다." })];
  const metadata = item(2, { id: "project:article_project", kind: "project", amount: 900, text: JSON.stringify({ stage: "construction", currency: "KRW" }) });
  const before = JSON.stringify({ evidence, metadata });
  const result = await curateBriefingReport({ ...input(evidence), linkedProjectMetadata: [metadata] }, async () => response({ trends: [entry(1, "기사|복수사업", "Y2와 M17 사업이 별도로 보도됐다")], investments: [{ ...entry(1, "회사A|Y2|신설", "Y2 공장 신설 계획이 보도됐다"), title: "회사A Y2 공장" }, { ...entry(1, "회사A|M17|투자", "M17 별도 투자 계획이 보도됐다"), title: "회사A M17 투자" }], insights: [] }));
  assert.deepEqual(result.report.companies.map(row => row.project), ["회사A Y2 공장", "회사A M17 투자"]);
  assert.deepEqual(result.report.companies.map(row => row.desc), ["Y2 공장 신설 계획이 보도됐다 [1]", "M17 별도 투자 계획이 보도됐다 [1]"]);
  for (const row of result.report.companies) { assert.equal(row.projectId, null); assert.equal(row.status, null); assert.deepEqual(row.facts, []); assert.equal(row.note?.kind, "확인 필요"); assert.match(row.note?.text ?? "", /사업별 프로젝트를 확인한 뒤 영업에 연결하세요/); }
  assert.deepEqual(result.sources.map(row => row.signalId), ["s1"]); assert.equal(JSON.stringify({ evidence, metadata }), before);
});

test("중복 링크 표시 정책은 정상·미연결 항목과 기존 안내를 보존하며 원본을 바꾸지 않는다", () => {
  const company = (projectId: string | null, project: string): BriefingReport["companies"][number] => ({ name: "시험기업", region: null, project, projectId, status: "planned", desc: `${project} 본문 [1]`, facts: [{ label: "공개 투자액", value: "100 KRW" }], note: null });
  const companies = [company("shared", "Y2"), company("shared", "M17"), company("normal", "별도 정상 사업"), company(null, "미연결1"), company(null, "미연결2")];
  companies[0].note = { kind: "참고", text: "기존 보도 내용은 재확인이 필요합니다." };
  const before = JSON.stringify(companies), result = separateAmbiguousProjectLinks(companies);
  assert.equal(JSON.stringify(companies), before); assert.deepEqual(result.slice(2), companies.slice(2));
  assert.match(result[0].note?.text ?? "", /\[참고\] 기존 보도 내용은 재확인이 필요합니다/);
  assert.equal(result[1].note?.text, "여러 사업이 같은 수집 근거에 연결되어 있습니다. 사업별 프로젝트를 확인한 뒤 영업에 연결하세요.");
  assert.deepEqual(separateAmbiguousProjectLinks(result), result);
});

test("저장된 보고서 파싱도 중복 링크만 보류하고 본문·정상 링크·기존 안내를 유지한다", () => {
  const company = (projectId: string, project: string) => ({ name: "시험기업", region: null, projectId, project, status: "construction", desc: `${project}의 별도 투자 내용 [1]`, facts: [{ label: "공개 투자액", value: "900 KRW" }], note: { kind: "참고", text: "기존 안내" } });
  const stored = { kpis: [{ label: "투자계획", value: "3개", sub: null }], trends: ["원래 산업 동향 [1]"], companies: [company("shared", "Y2"), company("shared", "M17"), company("unique", "다른 사업")], insights: [], etcNote: "원래 참고 내용" };
  const answerMd = JSON.stringify(stored), parsed = parseBriefingReport(answerMd)!;
  assert.ok(parsed); assert.deepEqual(parsed.companies.map(row => row.desc), stored.companies.map(row => row.desc));
  assert.deepEqual(parsed.trends, stored.trends); assert.equal(parsed.etcNote, stored.etcNote);
  for (const row of parsed.companies.slice(0, 2)) { assert.equal(row.projectId, null); assert.equal(row.status, null); assert.deepEqual(row.facts, []); assert.match(row.note?.text ?? "", /기존 안내/); }
  assert.deepEqual(parsed.companies[2], stored.companies[2]); assert.equal(JSON.stringify(stored), answerMd);
});

test("별개 시설 Y2·M17을 한 투자계획의 제목이나 주제로 묶으면 최종 발행을 거부한다",()=>{
  const allowed=new Set([1]);const check=(investments:unknown[])=>validateBriefingDigest(JSON.stringify({trends:[entry(1)],investments,insights:[]}),allowed);
  const merged={...entry(1,"SK하이닉스|용인Y2·청주M17|신설|투자","용인 Y2에 35조2000억원, 청주 M17에 19조1000억원을 투자하기로 했다고 보도됐다."),title:"SK하이닉스 용인 Y2·청주 M17 신규 공장"};
  assert.throws(()=>check([merged]),/서로 다른 투자사업.*투자계획 1번 제목.*시설별/);
  assert.throws(()=>check([{...merged,title:"SK하이닉스 신규 공장",topic:"SK하이닉스|Y2·M17|신설|투자"}]),/시설별/);
  const separated=[{...entry(1,"SK하이닉스|Y2|신설|투자","용인 Y2에 35조2000억원을 투자하기로 했다고 보도됐다."),title:"SK하이닉스 용인 Y2 공장"},{...entry(1,"SK하이닉스|M17|신설|투자","청주 M17에 19조1000억원을 투자하기로 했다고 보도됐다."),title:"SK하이닉스 청주 M17 공장"}];
  assert.equal(check(separated).investments.length,2);
});

test("투자카드는 개별 시설 금액만 보존하고 전사액·여러 사업 합계는 배분 설명과 관계없이 제외한다",()=>{
  const investment=(text:string)=>({...entry(1,"SK하이닉스|P&T7|패키징|일정",text),title:"SK하이닉스 청주 P&T7 패키징 공장"});
  const check=(text:string)=>validateBriefingDigest(JSON.stringify({trends:[entry(1)],investments:[investment(text)],insights:[]}),new Set([1]));
  assert.throws(()=>check("P&T7 클린룸 오픈 일정이 앞당겨졌다. 올해 투자 규모는 40조원 후반대로 설비투자 규율을 유지한다고 밝혔다."),/개별 시설 외 범위/);
  assert.throws(()=>check("P&T7 클린룸 일정을 앞당겼다. 회사 전체 설비투자액은 40조원 후반대다."),/개별 시설 외 범위/);
  assert.equal(check("P&T7 클린룸 일정이 앞당겨졌다고 보도됐다.").investments.length,1);
  assert.throws(()=>check("P&T7 클린룸 일정을 앞당겼다. 40조원 후반대는 회사 전체 설비투자액이며 개별 사업 배분은 미확인이다."),/개별 시설 외 범위/);
  assert.equal(check("P&T7 공장의 개별 사업 총투자액은 300억원으로 보도됐다.").investments.length,1);
  assert.equal(check("P&T7 공장의 1·2단계 합계 투자액은 300억원으로 보도됐다.").investments.length,1);
  assert.equal(validateBriefingDigest(JSON.stringify({trends:[entry(1)],investments:[{...entry(1,"회사|Y2|투자","Y2 신규 공장 투자 합계는 35조2000억원이다."),title:"용인 Y2 공장"}],insights:[]}),new Set([1])).investments.length,1);
  assert.equal(check("P&T7 개별 투자액은 현재 자료에서 미확인이다.").investments.length,1);
  for(const text of ["P&T7 투자 일정이 앞당겨졌다. 두 사업 합계는 54조3000억원이다.","P&T7 투자 일정이 앞당겨졌다. 여러 사업 투자액 54조3000억원이 보도됐다."]){assert.throws(()=>check(text),/개별 시설 외 범위/);}
});

test("개별 금액의 연간·총액 표기는 보존하되 실제 검수 응답의 전사액 면책 설명도 투자카드에서는 제외한다",()=>{
  const check=(text:string)=>validateBriefingDigest(JSON.stringify({trends:[entry(1)],investments:[{...entry(1,"SK하이닉스|P&T7|패키징|일정",text),title:"SK하이닉스 청주 P&T7 패키징 공장"}],insights:[]}),new Set([1]));
  const accepted=[
    "P&T7 공장의 올해 투자 규모는 300억원이다.",
    "P&T7 공장의 개별 투자액은 300억원이다. 회사 전체 투자계획은 추가 확인할 필요가 있다.",
    "P&T7 공장의 개별 투자액은 300억원이며 회사 전체 투자계획은 추가 확인할 필요가 있다.",
  ];
  for(const text of accepted)assert.equal(check(text).investments.length,1,text);
  const excluded=[
    "SK하이닉스는 청주 첨단 패키징 공장 P&T7의 클린룸 오픈 일정을 앞당겼다. 올해 전사 설비투자 규모가 40조원 후반대로 언급됐으나 이는 회사 전체 금액이며 P&T7 개별 배분은 미확인이다.",
    "P&T7 일정이 앞당겨졌다. 회사 전체 설비투자액은 40조원 후반대이며 사업별 배분금액은 공개되지 않았다.",
    "회사 전체 설비투자액은 40조원이며 P&T7 개별 투자액은 300억원으로 배정됐다.",
    "회사 전체 설비투자액은 40조원이다. P&T7에 300억원을 배분했다.",
    "회사 전체 설비투자액은 40조원 후반대다. 시설별 투자 내역은 미공개다.",
    "전사 설비투자액은 40조원 후반대이며 해당 공장의 투자액이 아니다.",
  ];
  for(const text of [...excluded,"P&T7 일정이 앞당겨졌다. 올해 투자 규모는 40조원 후반대다.","P&T7 일정이 앞당겨졌다. 전사 설비투자액은 40조원 후반대다."]){assert.throws(()=>check(text),/개별 시설 외 범위/);}
});

test("실제 검수 응답의 Y2·1기팹 일정 혼합과 명칭 미상 투자카드는 거부하고 Y1 분리는 허용한다",()=>{
  const check=(investments:unknown[])=>validateBriefingDigest(JSON.stringify({trends:[entry(1)],investments,insights:[]}),new Set([1]));
  const y2={...entry(1,"SK하이닉스|용인|Y2 D램 신규팹|투자 결정 및 클린룸 일정","SK하이닉스는 용인 D램 공장 Y2에 35조2000억원을 투자하기로 결정했다고 보도됐으며(2026년 9월 보도 기준), 1기 팹 첫 클린룸은 2027년 2월(2026년 9월 보도 기준) 완공이 기대된다."),title:"SK하이닉스 용인 Y2 D램 공장"};
  assert.throws(()=>check([y2]),/다른 시설의 금액이나 일정.*용인 1기/);
  const unknown={...entry(1,"SK하이닉스|청주|신규 생산시설(명칭 미상)|건설 가속화","청주공장 신규 생산시설 건설을 앞당긴다고 보도됐다. 보도에 구체적 공장명이 없어 별도 사업으로 추가 확인이 필요하다."),title:"SK하이닉스 청주 신규 생산시설(명칭 미상)"};
  assert.throws(()=>check([unknown]),/투자 대상 시설을 특정하지/);
  assert.throws(()=>check([{...unknown,title:"SK하이닉스 청주 신규 생산시설",topic:"회사|청주|신설|진행"}]),/투자 대상 시설을 특정하지/);
  const separated=[{...y2,text:"용인 Y2에 35조2000억원을 투자하기로 결정했다는 보도다."},{...entry(1,"SK하이닉스|용인 1기 팹|클린룸|일정","용인 1기 팹의 첫 클린룸은 2027년 2월 완공이 기대된다는 보도다."),title:"SK하이닉스 용인 Y1 공장"}];
  assert.equal(check(separated).investments.length,2);
  assert.equal(check([{...y2,text:"Y2는 M17과 별개 사업이다."}]).investments.length,1);
});

test("검수 입력에 기계가 찾은 행별 문제를 전달하고 검수본에도 같은 검사를 적용한다",async()=>{
  const mixed={...entry(1,"회사|용인|Y2|투자","용인 Y2에 투자한다. 1기 팹의 클린룸은 2027년 2월 완공이 기대된다."),title:"회사 용인 Y2 공장"};
  const unknown={...entry(1,"회사|청주|명칭 미상|진행","청주 시설 신설 보도"),title:"청주 신규시설(명칭 미상)"};
  const ambiguous={...entry(1,"회사|P&T7|패키징|일정","올해 투자 규모는 40조원 후반대다."),title:"청주 P&T7 공장"};
  const draft:BriefingDigest={trends:[entry(1)],investments:[mixed,unknown,ambiguous],insights:[]};let calls=0;
  const sources=[item(1,{text:"용인 Y2 투자 보도와 용인 1기 팹 일정, 청주 P&T7 공장 및 명칭 미상 신설 자료"})];
  const result=await curateBriefingReport(input(sources),async request=>{
    calls++;if(calls===1)return response(draft);
    const content=(request.messages as Array<{content:string}>)[0].content;const payload=JSON.parse(content.slice(content.indexOf('{"draft":')));
    assert.deepEqual(payload.specificIssues.map((issue:{item:number;code:string})=>[issue.item,issue.code]),[[1,"mixed_facility_facts"],[2,"unidentified_facility"],[3,"company_amount_scope"]]);
    assert.match(content,/지목된 각 문제를 반드시 교정/);
    return response({trends:[entry(1)],investments:[{...mixed,text:"Y2의 투자 계획이 보도됐다."}],insights:[]});
  });assert.equal(calls,2);assert.equal(result.report.companies.length,1);
  calls=0;await assert.rejects(curateBriefingReport(input(sources),async()=>{calls++;return response(draft);}),/다른 시설의 금액이나 일정/);assert.equal(calls,2);
});

test("최종 검수 1회가 원자료 전체로 초안을 교정하며 분리된 같은 근거 사업의 업무 링크는 보류한다",async()=>{
  const evidence=[item(1,{companyName:"SK하이닉스",title:"Y2·M17 별도 투자 보도",text:"용인 Y2에 35조2000억원, 청주 M17에 19조1000억원을 투자하기로 했다고 보도됐다."+" 원문 확인 내용".repeat(700)+" 원문 끝 검수표식",relatedEvidenceIds:["project:shared"]}),item(2,{text:"인용되지 않은 원자료"})];
  const metadata=item(3,{id:"project:shared",kind:"project",amount:900,text:JSON.stringify({stage:"construction"})});
  const draft:BriefingDigest={trends:[entry(1,"회사|별개공장|투자","서로 다른 시설 투자")],investments:[{...entry(1,"회사|Y2·M17|투자","Y2·M17에 투자했다."),title:"용인 Y2·청주 M17 공장"}],insights:[]};
  const corrected:BriefingDigest={trends:[entry(1,"회사|투자|동향","보도된 서로 다른 공장 투자계획")],investments:[{...entry(1,"회사|Y2|투자","용인 Y2에 35조2000억원을 투자하기로 했다고 보도됐다."),title:"용인 Y2 공장"},{...entry(1,"회사|M17|투자","청주 M17에 19조1000억원을 투자하기로 했다고 보도됐다."),title:"청주 M17 공장"}],insights:[]};
  const phases:unknown[]=[];
  const result=await curateBriefingReport({...input(evidence),linkedProjectMetadata:[metadata]},async request=>{
    phases.push(request.meta?.briefing_phase);const content=(request.messages as Array<{content:string}>)[0].content;
    if(phases.length===1){assert.doesNotMatch(content,/원문 끝 검수표식/);return response(draft);}
    assert.match(content,/draft는 사실 근거가 아닌 검수 대상/);assert.match(content,/원문 끝 검수표식/);assert.doesNotMatch(content,/인용되지 않은 원자료/);
    const payload=JSON.parse(content.slice(content.indexOf('{"draft":')));assert.equal(payload.sourceEvidence.length,1);assert.deepEqual(Object.keys(payload.sourceEvidence[0]),["reference","title","publishedAt","qualityInputKind","text"]);assert.equal(payload.sourceEvidence[0].text,evidence[0].originalText);
    return response(corrected);
  });
  assert.deepEqual(phases,["draft","evidence_review"]);assert.equal(result.report.companies.length,2);assert.equal(result.report.trends[0],"보도된 서로 다른 공장 투자계획 [1]");
  for(const company of result.report.companies){assert.equal(company.projectId,null);assert.equal(company.status,null);assert.deepEqual(company.facts,[]);}
});

test("정상 초안도 검수 1회를 거치고 검수의 잘못된 번호·범위·실패는 추가 재시도 없이 보류한다",async()=>{
  const valid:BriefingDigest={trends:[entry(1)],investments:[],insights:[]};let calls=0;
  await curateBriefingReport(input([item(1)]),async()=>{calls++;return response(valid);});assert.equal(calls,2);
  for(const failure of ["refs","scope","api"]){
    calls=0;
    await assert.rejects(curateBriefingReport(input([item(1)]),async()=>{
      calls++;if(calls===1)return response(valid);
      if(failure==="api")return {...response(valid),ok:false,status:502,errorText:"검수 응답 실패"};
      return response(failure==="refs"?{...valid,trends:[entry(99)]}:{...valid,investments:[{...entry(1,"회사|Y2·M17|투자","별개 시설 투자"),title:"Y2·M17 공장"}]});
    }),failure==="refs"?/출처 번호/:failure==="scope"?/시설별/:/AI 생성 실패/);
    assert.equal(calls,2);
  }
});

test("검수 자료 상한을 넘으면 원문을 잘라 보내거나 추가 호출하지 않는다",async()=>{
  let calls=0;await assert.rejects(curateBriefingReport(input([item(1,{text:"원".repeat(240001)})]),async()=>{calls++;return response({trends:[entry(1)],investments:[],insights:[]});}),/근거 대조 검수 자료가 허용 범위/);assert.equal(calls,1);
});

test("프로젝트만 선택한 초안도 연결된 원문을 검수하고 충실한 원문 대표로 바꿔 이중 인용을 없앤다",async()=>{
  const evidence=[item(1,{id:"project:p1",kind:"project",text:JSON.stringify({publicSummary:"프로젝트 파생 요약",stage:"unknown"}),relatedEvidenceIds:["signal:s2","signal:s3"]}),item(2,{text:"회사A 청주 공장 증설. 2027년 착공, 2030년 준공. 투자액 300억원, 클린룸 신설.",relatedEvidenceIds:["project:p1"]}),item(3,{text:"회사A 공장 증설",url:null}),item(4,{text:"무관한 일반 자료"})];
  let calls=0;
  const result=await curateBriefingReport(input(evidence),async request=>{
    calls++;const content=(request.messages as Array<{content:string}>)[0].content;
    if(calls===2){
      const payload=JSON.parse(content.slice(content.indexOf('{"draft":')));assert.deepEqual(payload.sourceEvidence.map((source:{reference:number})=>source.reference),[1,2,3]);
      assert.equal(payload.sourceEvidence[0].qualityInputKind,"derived");assert.equal(payload.sourceEvidence[0].text,null);
      assert.equal(payload.sourceEvidence[1].text,evidence[1].originalText);assert.equal(payload.draft.trends[0].representative,2);assert.deepEqual(payload.draft.trends[0].references,[2]);
    }
    // 검수 응답이 다시 프로젝트를 대표로 택해도 허용된 연결 원문으로 정규화한다.
    return response({trends:[entry(1,"회사A|청주|증설","청주 공장 증설 보도")],investments:[{...entry(1,"회사A|청주|증설","청주 공장 증설 보도"),title:"회사A 청주 공장"}],insights:[]});
  });
  assert.equal(calls,2);assert.deepEqual(result.sources.map(source=>source.signalId),["s2"]);assert.equal(result.report.trends[0],"청주 공장 증설 보도 [1]");assert.equal(result.report.companies[0].projectId,"p1");
});

test("옛 요약을 원문으로 가정하지 않으며 연결 원문이 없는 프로젝트 대표는 유지한다",async()=>{
  const legacy=item(1,{originalText:undefined,qualityInputKind:undefined,text:"요약에만 있던 미검증 금액 999억원"});delete legacy.qualityInputKind;
  const project=item(2,{id:"project:manual",kind:"project",text:"사용자가 작성한 프로젝트 요약"});
  let calls=0;
  const result=await curateBriefingReport(input([legacy,project]),async request=>{
    calls++;if(calls===2){
      const content=(request.messages as Array<{content:string}>)[0].content;const payload=JSON.parse(content.slice(content.indexOf('{"draft":')));
      assert.equal(payload.sourceEvidence[0].qualityInputKind,"title_only");assert.equal(payload.sourceEvidence[0].text,null);assert.equal(payload.sourceEvidence[1].qualityInputKind,"derived");assert.equal(payload.sourceEvidence[1].text,null);
      assert.match(content,/파생 프로젝트 요약을 사실 원문으로 가정하지/);
    }
    return response({trends:[entry(1)],investments:[{...entry(2),title:"사용자 검토 프로젝트"}],insights:[]});
  });assert.equal(result.sources[1].kind,"project");assert.equal(result.report.companies[0].projectId,"manual");
});

test("실제 매출 비교 연도를 투자 결정 연도로 옮긴 응답은 차단하고 원문의 지난달 결정은 보존한다",()=>{
  const source=item(1,{publishedAt:"2026-09-15T00:00:00Z",text:"실제로 SK하이닉스는 지난해 연간 매출의 56%에 달하는 54조3000억원을 들여 새 공장을 짓기로 했지만... 지난달에는 용인 D램 공장 Y2에 35조2000억원, 청주 낸드 공장 M17에 19조1000억원을 투자하기로 결정했다. 미국..."});
  const check=(text:string,evidence=[source])=>validateBriefingDigest(JSON.stringify({trends:[entry(1,"회사|투자|시점",text)],investments:[],insights:[]}),new Set([1]),{evidence});
  const actual="2026년 9월 보도는 SK하이닉스가 2025년(지난해)에 매출의 56%에 달하는 54조3000억원 규모 신공장 투자를 결정했다고 전했으며, 미국발 AI 투자 감속론 확산이 변수로 거론되고 있다고 밝혔다.";
  assert.throws(()=>check(actual),/매출 등의 비교 연도가 투자 결정 시점/);
  assert.equal(check("2025년 연간 매출의 56% 규모이며, 지난달인 2026년 8월에 Y2·M17 투자를 결정했다는 2026년 9월 보도다.").trends.length,1);
  assert.equal(check("지난해 연간 매출의 56% 규모인 54조3000억원을 투자하기로 결정했다는 보도다.").trends.length,1);
  const explicit=item(1,{publishedAt:"2026-09-15T00:00:00Z",text:"지난해 연간 매출의 56%에 달하는 투자 규모다. 2025년에 용인 Y2 공장 투자를 결정했다."});
  assert.equal(check("2025년에 용인 Y2 공장 투자를 결정했다는 보도다.",[explicit]).trends.length,1);
});

test("제목만 수집한 공시의 자료 공백을 원문 비공개로 단정하지 않는다",()=>{
  const sources=[item(1,{text:"용인 Y2 및 청주 M17 투자 보도"}),item(2,{source:"dart",title:"신규시설투자등",originalText:null,qualityInputKind:"title_only"}),item(3,{source:"dart",title:"신규시설투자등",originalText:null,qualityInputKind:"title_only"})];
  const check=(text:string,evidence=sources)=>validateBriefingDigest(JSON.stringify({trends:[entry(1)],investments:[],insights:[{...entry(2,"회사|공시|확인",text),references:[2,3],badge:"확인 필요"}]}),new Set([1,2,3]),{evidence});
  assert.throws(()=>check("7월·8월 접수된 신규시설투자등 공시 3건은 규모·대상이 비공개 상태이므로, 공시 원문 조회를 통해 Y2·M17 등 기존 보도와의 연계 여부를 확인할 필요가 있다."),/원문의 비공개 정보로 단정/);
  assert.equal(check("제목만 수집해 현재 자료로 규모·대상을 확인하지 못했다. 원문을 확인해야 한다.").insights.length,1);
  assert.equal(check("세부내용 비공개 여부는 공시 원문을 확인해야 한다.").insights.length,1);
  assert.equal(check("공시 제목에서 투자규모 비공개를 알렸다.",[sources[0],{...sources[1],title:"투자 규모 비공개"},sources[2]]).insights.length,1);
});

test("원문에 없는 공장 별칭·코드는 파생 프로젝트나 검수 지식으로 보완하지 않는다",()=>{
  const sources=[item(1,{title:"용인 1기 팹 클린룸",text:"용인 1기 팹 첫 클린룸은 내년 2월 완공이 기대된다."}),item(2,{id:"project:derived",kind:"project",title:"용인 Y1 공장",text:"파생 요약 Y1"})];
  const check=(text:string,topic="회사|용인|클린룸")=>validateBriefingDigest(JSON.stringify({trends:[entry(1,topic,text)],investments:[],insights:[]}),new Set([1,2]),{evidence:sources});
  assert.throws(()=>check("용인 Y1 공장 클린룸 완공이 기대된다."),/원자료에 없는 시설 식별자/);
  assert.throws(()=>check("용인 1기 팹 클린룸 완공이 기대된다.","회사|Y1|클린룸"),/원자료에 없는 시설 식별자/);
  assert.equal(check("용인 1기 팹 클린룸 완공이 기대된다.").trends.length,1);
});

test("날짜 역할·수집 공백·없는 시설 코드 문제를 1회 검수에 넘기고 최종 결과도 차단한다",async()=>{
  const sources=[item(1,{publishedAt:"2026-09-15T00:00:00Z",text:"지난해 연간 매출의 56% 규모이며 지난달 Y2·M17에 투자하기로 결정했다."}),item(2,{source:"dart",title:"신규시설투자등",originalText:null,qualityInputKind:"title_only"})];
  const draft:BriefingDigest={trends:[entry(1,"회사|비교|투자","2025년(지난해)에 54조3000억원 투자를 결정했다고 보도됐다."),entry(1,"회사|시설|Y1","용인 Y1의 일정")],investments:[],insights:[{...entry(2,"회사|공시|확인","공시 금액이 비공개 상태다."),badge:"확인 필요"}]};
  let calls=0;
  await curateBriefingReport(input(sources),async request=>{
    calls++;if(calls===1)return response(draft);
    const content=(request.messages as Array<{content:string}>)[0].content;const payload=JSON.parse(content.slice(content.indexOf('{"draft":')));
    assert(payload.specificIssues.some((issue:{code:string})=>issue.code==="comparison_year_as_decision_year"));
    assert(payload.specificIssues.some((issue:{code:string})=>issue.code==="collection_gap_as_nondisclosure"));
    assert(payload.specificIssues.some((issue:{code:string})=>issue.code==="unsupported_facility_code"));
    assert.doesNotMatch(String(request.system),/첫 번째 팹은 Y1|첫 번째 팹.*Y1을/);
    return response({trends:[entry(1,"회사|지난달|투자","지난달 투자를 결정했다는 2026년 9월 보도다.")],investments:[],insights:[{...entry(2,"회사|공시|확인","제목만 수집해 세부 사항은 현재 자료로 확인하지 못했다."),badge:"확인 필요"}]});
  });assert.equal(calls,2);
  calls=0;await assert.rejects(curateBriefingReport(input(sources),async()=>{calls++;return response(draft);}),/비교 연도가 투자 결정 시점/);assert.equal(calls,2);
});

test("과거 투자 결정과 감속론만으로 현재 계획 유지·변경 없음·재확인을 단정하지 않는다",()=>{
  const source=item(1,{title:"SK하이닉스 Y2·M17 투자와 AI 투자 감속론",text:"지난달에는 용인 D램 공장 Y2에 35조2000억원, 청주 낸드 공장 M17에 19조1000억원을 투자하기로 결정했다."});
  const check=(text:string,evidence=[source])=>validateBriefingDigest(JSON.stringify({trends:[entry(1,"SK하이닉스|Y2|투자계획",text)],investments:[],insights:[]}),new Set([1]),{evidence});
  for(const text of ["미국 내 AI 투자 감속론 확산에도 해당 투자 결정/계획은 유지되는 것으로 전해졌다.","Y2 투자계획에는 변경이 없다.","Y2 투자계획을 재확인했다.","Y2 기존 계획을 당초대로 추진한다."]){
    assert.throws(()=>check(text),/유지·재확인을 뒷받침하는 직접 근거/);
  }
  for(const text of ["지난달 Y2 투자 결정이 보도됐다. 현재 투자계획 유지 여부는 확인이 필요하다.","Y2 투자계획이 유지되는지는 확인되지 않았다.","Y2 투자계획을 재확인할 필요가 있다.","투자 취소·지연이 확인되지 않았다는 이유로 계획을 유지한다고 단정할 수 없다."]){
    assert.equal(check(text).trends.length,1);
  }
  assert.equal(check("Y2 투자계획은 유지한다고 보도됐다.",[item(1,{title:"Y2 투자계획",text:"회사는 Y2 투자계획을 유지한다고 밝혔다."})]).trends.length,1);
  assert.equal(check("Y2 투자계획을 재확인했다.",[item(1,{title:"Y2 투자계획",text:"회사는 Y2 투자계획을 재확인했다."})]).trends.length,1);
  assert.throws(()=>check("Y2 투자계획을 재확인했다.",[item(1,{title:"Y2 투자계획",text:"회사는 Y2 투자계획을 유지한다고 밝혔다."})]),/직접 근거/);
});

test("다른 시설·전사 예산·투자 규율의 유지나 부정 문장은 개별 사업 유지 근거가 아니다",()=>{
  const check=(text:string)=>validateBriefingDigest(JSON.stringify({trends:[entry(1,"회사|Y2|투자","Y2 투자계획은 유지된다.")],investments:[],insights:[]}),new Set([1]),{evidence:[item(1,{title:"Y2·P&T7 투자 현황",text})]});
  for(const text of ["Y2 투자계획을 검토했다. P&T7 투자계획을 유지한다고 밝혔다.","Y2 투자계획을 검토했다. 회사 전체 투자계획은 유지한다.","Y2 투자계획을 검토했다. P&T7의 설비투자 규율을 유지한다.","Y2 투자계획은 유지하지 않기로 했다.","Y2 투자계획 유지 여부는 확인되지 않았다."]){
    assert.throws(()=>check(text),/직접 근거/);
  }
  assert.equal(check("Y2 투자계획을 유지한다고 밝혔다. P&T7 투자계획도 검토 중이다.").trends.length,1);
});

test("제목만 수집한 DART 공시 기간은 실제 인용한 발표월로 한정한다",()=>{
  const sources=[item(1,{source:"dart",title:"신규시설투자등",publishedAt:"2026-07-22T00:00:00Z",originalText:null,qualityInputKind:"title_only"}),item(2,{source:"dart",title:"신규시설투자등",publishedAt:"2026-08-07T00:00:00Z",originalText:null,qualityInputKind:"title_only"}),item(3,{source:"dart",title:"신규시설투자등",publishedAt:"2026-10-06T00:00:00Z",originalText:null,qualityInputKind:"title_only"})];
  const check=(text:string,references=[1,2])=>validateBriefingDigest(JSON.stringify({trends:[{...entry(1,"회사|DART|접수",text),references}],investments:[],insights:[]}),new Set([1,2,3]),{evidence:sources});
  assert.throws(()=>check("2026년 7~10월 DART 신규시설투자 공시가 접수됐다."),/공시 기간의 시작·끝 달/);
  assert.throws(()=>check("2026년 7월~10월 DART 공시 접수가 확인된다."),/공시 기간의 시작·끝 달/);
  assert.equal(check("2026년 7~8월 DART 신규시설투자 공시가 접수됐다.").trends.length,1);
  assert.equal(check("2026년 7~10월 DART 신규시설투자 공시가 접수됐다.",[1,2,3]).trends.length,1);
});

test("근거 없는 계획 유지와 공시 기간 문제를 1회 검수에서 교정하고 남으면 발행을 막는다",async()=>{
  const sources=[item(1,{title:"Y2 신규시설 투자",text:"지난달 Y2 투자계획을 결정했다."}),item(2,{source:"dart",title:"신규시설투자등",publishedAt:"2026-07-22T00:00:00Z",originalText:null,qualityInputKind:"title_only"}),item(3,{source:"dart",title:"신규시설투자등",publishedAt:"2026-08-07T00:00:00Z",originalText:null,qualityInputKind:"title_only"})];
  const draft:BriefingDigest={trends:[entry(1,"회사|Y2|계획","투자 감속론에도 Y2 투자계획은 유지되는 것으로 전해졌다."),{...entry(2,"회사|DART|접수","2026년 7~10월 DART 공시가 접수됐다."),references:[2,3]}],investments:[],insights:[]};
  let calls=0;
  await curateBriefingReport(input(sources),async request=>{
    calls++;if(calls===1)return response(draft);
    const content=(request.messages as Array<{content:string}>)[0].content;const payload=JSON.parse(content.slice(content.indexOf('{"draft":')));
    assert(payload.specificIssues.some((issue:{code:string})=>issue.code==="unsupported_plan_continuity"));
    assert(payload.specificIssues.some((issue:{code:string})=>issue.code==="unsupported_disclosure_month_range"));
    assert.match(String(request.system),/과거 투자 결정, 취소·지연 보도의 부재/);
    assert.match(String(request.system),/개별 투자액은 현재 자료에서 미확인/);assert.doesNotMatch(String(request.system),/개별 사업 배분 미확인\/미공개/);
    return response({trends:[entry(1,"회사|Y2|계획","지난달 Y2 투자를 결정했다는 보도다."),{...entry(2,"회사|DART|접수","2026년 7~8월 DART 공시가 접수됐다."),references:[2,3]}],investments:[],insights:[]});
  });assert.equal(calls,2);
  calls=0;await assert.rejects(curateBriefingReport(input(sources),async()=>{calls++;return response(draft);}),/유지·재확인을 뒷받침하는 직접 근거/);assert.equal(calls,2);
});

test("투자 규율 유지와 투자액·계획 유지를 구분하며 실제 금액 유지 원문은 허용한다",()=>{
  const source=item(1,{title:"P&T7 일정과 회사 투자",text:"올해 전사 설비투자 규모는 40조원 후반대로 예상하며 설비투자 규율을 유지한다고 밝혔다."});
  const check=(text:string,evidence=[source])=>validateBriefingDigest(JSON.stringify({trends:[entry(1,"회사|전사|투자액",text)],investments:[],insights:[]}),new Set([1]),{evidence});
  assert.throws(()=>check("올해 전사 설비투자 규모는 40조원 후반대로 유지된다고 보도됐다."),/유지·재확인을 뒷받침하는 직접 근거/);
  assert.throws(()=>check("올해 전사 투자계획은 유지된다고 보도됐다."),/직접 근거/);
  assert.equal(check("올해 전사 설비투자 규모는 40조원 후반대로 예상하며 투자 규율을 유지한다고 보도됐다.").trends.length,1);
  const maintained=item(1,{title:"회사의 전사 투자액",text:"회사는 올해 전사 설비투자액을 40조원으로 유지한다고 밝혔다."});
  assert.equal(check("올해 전사 설비투자액은 40조원으로 유지된다고 보도됐다.",[maintained]).trends.length,1);
  assert.throws(()=>check("전사 투자계획이 유지된다고 보도됐다.",[maintained]),/직접 근거/);
});

test("실제 두 금액 오류를 검수에 전달하고 개별액만 남긴 카드와 정확한 복수사업 합계 동향을 허용한다",async()=>{
  const sources=[item(1,{title:"Y2·M17 신규 투자",text:"Y2에 35조2000억원과 M17에 19조1000억원을 투자하기로 결정했다. 두 사업 합계는 54조3000억원이다."}),item(2,{title:"P&T7 클린룸 일정",text:"P&T7 클린룸 오픈 일정을 앞당긴다. 올해 전사 설비투자 규모는 40조원 후반대로 예상하며 설비투자 규율을 유지한다고 밝혔다."})];
  const draft:BriefingDigest={trends:[entry(1,"회사|두사업|합계","두 사업의 투자 합계는 54조3000억원이다.")],investments:[{...entry(1,"회사|Y2|투자","Y2에 35조2000억원을 투자한다. 전사 투자액은 54조3000억원이다."),title:"용인 Y2 공장"},{...entry(2,"회사|P&T7|일정","P&T7 클린룸 일정이 앞당겨졌다. 올해 전사 설비투자 규모는 40조원 후반대로 유지된다."),title:"청주 P&T7 공장"}],insights:[]};
  let calls=0;
  const result=await curateBriefingReport(input(sources),async request=>{
    calls++;if(calls===1)return response(draft);
    const content=(request.messages as Array<{content:string}>)[0].content;const payload=JSON.parse(content.slice(content.indexOf('{"draft":')));
    assert.equal(payload.specificIssues.filter((issue:{code:string})=>issue.code==="company_amount_scope").length,2);
    assert(payload.specificIssues.some((issue:{code:string})=>issue.code==="unsupported_plan_continuity"));
    assert.match(content,/전사 투자액이나 여러 시설·사업 합계는 배분 설명 유무와 관계없이/);
    assert.match(String(request.system),/복수 사업의 합계는 그 사업들의 합계로만 표현/);
    return response({...draft,investments:[{...draft.investments[0],text:"Y2에 35조2000억원을 투자하기로 했다는 보도다."},{...draft.investments[1],text:"P&T7 클린룸 오픈 일정을 앞당긴다는 보도다. 개별 투자액은 현재 자료에서 미확인이다."}]});
  });
  assert.equal(calls,2);assert.match(result.report.companies[0].desc,/35조2000억원/);assert.doesNotMatch(result.report.companies.map(row=>row.desc).join(" "),/54조3000|40조/);assert.match(result.report.trends[0],/두 사업.*54조3000/);
  calls=0;await assert.rejects(curateBriefingReport(input(sources),async()=>{calls++;return response(draft);}),/개별 시설 외 범위/);assert.equal(calls,2);
});
