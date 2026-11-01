import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNewsEvidenceParts, createNewsContentQuality, checkNewsContentQuality, newsInputHash, newsReviewSummary, newsContentQualityCondition, isNewsContentQualityAccepted, validateNewsGroundedOutput, validateNewsGroundedSelection, type NewsGroundedOutput } from "../lib/intel/news-content-quality";
import { classifyNewsDetailed, classifyNews } from "../lib/intel/news-classifier";
import { collectNewsSignals } from "../lib/intel/collect-news";
import { collectPressSignals } from "../lib/intel/collect-press";

type Request = {messages:Array<{content:string}>;meta:Record<string,unknown>};
const state = {requests:[] as Request[], inserts:[] as unknown[][], alerts:0,
  invoke: async (_request:Request):Promise<unknown> => {throw new Error("응답을 설정해야 합니다.");},
  search:async (_keyword:string):Promise<{items:unknown[]}> => ({items:[]}),
  pressList:async ():Promise<unknown[]> => [], pressBody:async (_item:unknown):Promise<string|null> => null,
  db:{exec:async (sql:string,params:unknown[] = []) => {if(sql.includes("INSERT INTO intel_signals")){state.inserts.push(params);return [{signal_id:params[0]}];}return [];},run:async (sql:string) => {if(sql.includes("INSERT INTO alerts"))state.alerts++;}},
};
(globalThis as unknown as {__newsHarness:typeof state}).__newsHarness=state;
globalThis.fetch=async () => {throw new Error("오프라인 검사에서 네트워크 접근 금지");};
const title="테스트전자, 청주 공장 증설 투자 발표";
const description="테스트전자는 청주 공장 증설에 300억원을 투자하고 내년 2월 착공한다고 밝혔다.";
const grounded = (extra:Partial<NewsGroundedOutput> = {}):NewsGroundedOutput => ({decision:"accepted",titleRelation:"main",reason:"회사와 사업이 원문에 직접 명시됨",evidenceQuotes:[description],signalType:"expansion",companyName:"테스트전자",location:"청주",scale:"300억원",projectPeriod:"내년 2월",confidence:"high",industry:null,industryRelevance:null,relevanceNote:null,...extra});
const selection = (value:unknown):unknown => {
  if(!value||typeof value!=="object"||Array.isArray(value)||!Object.hasOwn(value,"evidenceQuotes"))return value;
  const {evidenceQuotes,...fields}=value as Record<string,unknown>;
  return {...fields,evidenceIds:Array.isArray(evidenceQuotes)?evidenceQuotes.map((_,index)=>`S${index+1}`):evidenceQuotes};
};
const response = (value:unknown,stopReason="end_turn") => ({ok:true,status:200,data:{model:"offline-haiku",stop_reason:stopReason},model:"offline-haiku",text:typeof value==="string"?value:JSON.stringify(selection(value))});
function mockResponse(value:unknown,stopReason="end_turn") {state.requests=[];state.invoke=async request=>{state.requests.push(request);return response(value,stopReason);};}
function basicInput() {return {title,description};}

test("품질 표기는 입력 전체와 범위를 해시로 묶고 nested accepted만 자동 근거로 허용한다",()=>{
  const quality=createNewsContentQuality({...basicInput(),decision:"accepted",titleRelation:"main",evidenceQuotes:[description],reason:"직접 근거"});
  assert.equal(quality.inputHash,newsInputHash(title,description)); assert.notEqual(quality.inputHash,newsInputHash(title,description,"full_text"));
  assert.notEqual(quality.inputHash,newsInputHash(title,description+" "));
  assert(checkNewsContentQuality(quality));assert(isNewsContentQualityAccepted({classification:{contentQuality:quality}}));
  assert(isNewsContentQualityAccepted({classification:{summary:"기존 기록"}}));
  for(const invalid of [null,{}, {...quality,decision:"needs_review"}, {...quality,inputHash:"fake"}, {...quality,inputKind:["search_excerpt"]}, {...quality,evidenceQuotes:[null]}, {...quality,evidenceQuotes:[" "]}, {...quality,reason:""}])assert.equal(isNewsContentQualityAccepted({classification:{contentQuality:invalid}}),false);
  assert.match(newsContentQualityCondition("signal"),/^COALESCE\(/);assert.match(newsContentQualityCondition(),/jsonb_array_elements/);assert.throws(()=>newsContentQualityCondition("s;DROP"));
});

test("전체 JSON 계약과 모든 사실 필드를 검증하고 자유 생성 요약을 거부한다",()=>{
  assert.equal(validateNewsGroundedOutput(grounded(),basicInput()).decision,"accepted");
  for(const invalid of [null,[], {...grounded(),summary:"SK하이닉스 신규 공장 확정"}, {...grounded(),companyName:"SK하이닉스"}, {...grounded(),location:"부산"}, {...grounded(),scale:"3조원"}, {...grounded(),projectPeriod:"2027년 2월"}, {...grounded(),relevanceNote:"환경허가 발주 확정"}, {...grounded(),confidence:["high"]}])assert.throws(()=>validateNewsGroundedOutput(invalid,basicInput()),/뉴스 근거 검증 실패/);
  const missing={...grounded()} as Partial<NewsGroundedOutput>;delete missing.reason;assert.throws(()=>validateNewsGroundedOutput(missing,basicInput()),/필수/);
});

test("정부의 요구 문장에서 기업 투자 부분만 잘라 인용하면 거부하고 전체 문장도 확정으로 채택하지 않는다",()=>{
  const input={title:"정부, 국내 산업 투자 촉구",description:"한국 정부는 테스트전자에 청주 신규 공장 건설을 서두르라고 요구했다."};
  const result=validateNewsGroundedOutput(grounded({evidenceQuotes:[input.description],scale:null,projectPeriod:null}),input);
  assert.equal(result.decision,"needs_review");
  assert.throws(()=>validateNewsGroundedOutput(grounded({evidenceQuotes:["테스트전자에 청주 신규 공장 건설"],scale:null,projectPeriod:null}),input),/온전한 문장/);
});

test("다기업 공시의 주체를 제목 첫 회사에 귀속하거나 제목만으로 본문을 보완하지 않는다",()=>{
  const input={title:"[주요공시] SK하이닉스, HD현대마린솔루션, LIG디펜스앤에어로스페이스...",description:"양산공장 건설사업 EPC 계약을 체결했다. 계약금액은 479억5562만원으로 최근 매출액 3962억5636만원의... 계약기간은 실제 착공일부터 27개월이다."};
  const output=grounded({evidenceQuotes:[input.title,input.description],companyName:"SK하이닉스",location:null,scale:"479억5562만원",projectPeriod:"착공일부터 27개월"});
  assert.equal(validateNewsGroundedOutput(output,input).decision,"needs_review");
  assert.equal(validateNewsGroundedOutput(grounded({evidenceQuotes:[title],location:null,scale:null,projectPeriod:null}),{title,description:"이 기사는 다른 기업의 실적을 소개한다."}).decision,"needs_review");
});

test("실제 인사·안전·분양 발췌의 배경 투자는 새 투자 신호가 되지 않는다",()=>{
  const cases=[
    ["SK하이닉스 미주총괄 신설하고 안현 사장 배치, 美 빅테크 공략...곽노정...","미국 현지 생산시설 구축에도 나서고 있다. SK하이닉스는 지난 8월 미국 인디애나주 웨스트라피엣에서 40억 달러 이상을 투자해 건설하는 HBM 첨단 패키징 공장 기공식을 열었다. 해당 공장은 2029년 하반기 양산을..."],
    ["하이닉스 산안법 119건 위반에, 메가특구법 중단 이유 분명해져","기업에게 건설 단계의 안전장치까지 줄여주겠다는 것이라고 목소리를 높였다. 또한 충북도와 청주시가 6월 사고 이후 제대로 된 대책 논의도 없이 SK하이닉스의 신규 반도체 팹 증설을 위해 전담팀을 꾸리고 신속한..."],
    ["6300가구 브랜드타운 완성…청주 가경 아이파크 7·8단지 10월 분양","SK하이닉스는 글로벌 AI 메모리 수요에 대응하기 위해 총 6개 공장을 순차적으로 구축할 계획으로, 올해 4월 착공, 2027년 말 완공을 목표로 진행하고 있다. 광역교통망 확충을 통한 교통 인프라도 개선될 전망이다...."],
  ];
  for(const [t,d] of cases)assert.equal(validateNewsGroundedOutput(grounded({companyName:"SK하이닉스",location:null,scale:null,projectPeriod:null,evidenceQuotes:[d]}),{title:t,description:d}).decision,"background");
});

test("실제 미국 협의설·국내 촉구 발췌를 확정 투자로 승격하지 않는다",()=>{
  const input={title:"인텔·SK하이닉스, 미국 생산 협의설에 동반 상승",description:"최태원 SK그룹 회장은 7월 고객사와 정부가 공급 확대를 강하게 요구하고 있다며 미국 공장 건설 필요성을 언급했다. 한국 정부는 SK하이닉스와 삼성전자에 한국 남서부 신규 반도체 클러스터 추진을 서두르라고..."};
  assert.notEqual(validateNewsGroundedOutput(grounded({companyName:"SK하이닉스",location:"한국 남서부",scale:null,projectPeriod:null,evidenceQuotes:[input.description]}),input).decision,"accepted");
});

test("직접 보도된 P&T7 일정 변경과 Y2/M17 각각의 금액은 그대로 보존한다",async()=>{
  const cases=[
    ["SK하이닉스 '청주 공장' 시계 당긴 이유⋯HBM 증산 관문 된 '후공정'","SK하이닉스가 청주 첨단 패키징 공장 'P&T7'의 클린룸 오픈 일정을 앞당긴 것도 HBM을 포함한 AI 메모리 수요... ◆올해 투자 규모 40조원 후반, 설비투자 규율 유지 P&T7 일정 조정은 전공정 증설 시간표와 맞물린다. 약..."],
    ["SK하이닉스, 최태원 'AI 증설' 결단에 54조 베팅했는데… 美 감속론 확산...","실제로 SK하이닉스는 지난해 연간 매출의 56%에 달하는 54조3000억원을 들여 새 공장을 짓기로 했지만... 지난달에는 용인 D램 공장 Y2에 35조2000억원, 청주 낸드 공장 M17에 19조1000억원을 투자하기로 결정했다. 미국..."],
  ];
  for(const [t,d]of cases){mockResponse(grounded({companyName:"SK하이닉스",location:null,scale:null,projectPeriod:null,evidenceQuotes:[d]}));const result=await classifyNewsDetailed(t,d);assert.equal(result.status,"ok");assert.equal(result.classification?.isSignal,true);assert.equal(result.classification?.summary,d);assert.equal(result.classification?.scale,null);}
});

test("원문 요약·입력 범위·해시를 유지하고 검색 발췌의 high는 candidate용 medium으로 제한한다",async()=>{
  mockResponse(grounded());const result=await classifyNewsDetailed(title,description,undefined,undefined,{publishedAt:"2026-10-31"});
  assert.equal(result.status,"ok");assert.equal(result.model,"offline-haiku");assert.equal(result.classification?.summary,description);assert.equal(result.classification?.confidence,"medium");
  assert.equal(result.classification?.contentQuality?.inputHash,newsInputHash(title,description));
  assert.match(state.requests[0].messages[0].content,/검색 발췌/);assert.match(state.requests[0].messages[0].content,/search_excerpt/);assert.match(state.requests[0].messages[0].content,/evidenceParts/);assert.doesNotMatch(state.requests[0].messages[0].content,/\[본문\]/);
  mockResponse(grounded());const full=await classifyNewsDetailed(title,description,undefined,undefined,{inputKind:"full_text"});assert.equal(full.classification?.confidence,"high");assert.equal(full.classification?.contentQuality?.inputKind,"full_text");
});

test("잘린 응답·불완전 JSON·다른 기사 사실·빈 본문은 명시적으로 실패한다",async()=>{
  for(const [value,stop]of [[grounded(),"max_tokens"],[JSON.stringify(grounded())+" trailing","end_turn"],[{...grounded(),companyName:"다른회사"},"end_turn"],[null,"end_turn"]] as [unknown,string][]){mockResponse(value,stop);const result=await classifyNewsDetailed(title,description);assert.equal(result.status,"failed");assert.equal(result.classification,null);assert(result.error);}
  mockResponse(grounded());assert.equal((await classifyNewsDetailed(title,"")).status,"failed");assert.equal(state.requests.length,0);
  state.invoke=async()=>{throw new Error("secret-must-not-leak");};assert.doesNotMatch((await classifyNewsDetailed(title,description)).error??"",/secret/);assert.equal(await classifyNews(title,description),null);
});

test("비대상·검토 필요 결과와 API 오류를 구분하며 업종 자유 추정을 거부한다",async()=>{
  mockResponse(grounded({decision:"needs_review",titleRelation:"unclear"}));assert.equal((await classifyNewsDetailed(title,description)).classification?.isSignal,false);
  mockResponse(grounded({industry:"반도체",industryRelevance:"direct"}));assert.equal((await classifyNewsDetailed(title,description)).status,"failed");
  state.invoke=async()=>({ok:false,status:429,data:null,model:"offline",text:"",errorText:"secret"});const failed=await classifyNewsDetailed(title,description);assert.equal(failed.status,"failed");assert.match(failed.error??"",/429/);assert.doesNotMatch(failed.error??"",/secret/);
});

test("뉴스 중복 키워드와 배치 제한에서도 제목·발췌·요약 대응과 후보 상한을 보존한다",async()=>{
  state.inserts=[];state.alerts=0;
  const secondTitle="두번째전자 공장 신설 투자",secondBody="두번째전자는 부산 공장 신설에 500억원을 투자한다.";
  const first={title,description,link:"https://example.test/1",originalLink:"https://publisher.test/1",pubDate:"2026-10-30",press:"기사1"};
  const second={title:secondTitle,description:secondBody,link:"https://example.test/2",originalLink:null,pubDate:"2026-10-31",press:"기사2"};
  state.search=async keyword=>({items:keyword==="첫키워드"?[first,second]:[second,{...first,description:"중복 키워드의 다른 발췌"}]});
  state.invoke=async request=>response(request.messages[0].content.includes(JSON.stringify(secondTitle))?grounded({evidenceQuotes:[secondBody],companyName:"두번째전자",location:"부산",scale:"500억원",projectPeriod:null}):grounded());
  const result=await collectNewsSignals({keywords:["첫키워드","중복키워드"],maxClassify:2});
  assert.equal(result.scanned,2);assert.equal(result.inserted,2);assert.equal(result.byGrade.candidate,2);assert.equal(result.byGrade.confirmed,0);assert.equal(state.alerts,0);
  assert.deepEqual(state.inserts.map(row=>[row[3],row[9]]),[[title,description],[secondTitle,secondBody]]);
  for(const row of state.inserts){const raw=JSON.parse(String(row[8]));assert.equal(raw.classification.contentQuality.inputHash,newsInputHash(String(row[3]),raw.description));assert.equal(row[9],raw.classification.contentQuality.evidenceQuotes.join(" "));}
});

test("수집기는 검증 실패·비대상 자료를 저장하지 않고 별도 건수로 보고한다",async()=>{
  state.inserts=[];let calls=0;state.search=async()=>({items:[1,2].map(n=>({title,description,link:`https://example.test/skip${n}`,pubDate:null,press:null,originalLink:null}))});
  state.invoke=async()=>response(++calls===1?{...grounded(),companyName:"다른회사"}:grounded({decision:"background",titleRelation:"background"}));
  const result=await collectNewsSignals({keywords:["공장"],maxClassify:2});assert.equal(result.failed,1);assert.equal(result.skipped,1);assert.equal(result.inserted,0);assert.equal(state.inserts.length,0);
});

test("보도자료 목록 요약은 발췌로, 직접 확보한 본문만 full_text로 저장한다",async()=>{
  state.inserts=[];state.alerts=0;
  state.pressList=async()=>[1,2,3].map(n=>({sourceKey:"ulsan",title,url:`https://press.test/${n}`,dept:"투자과",publishedAt:"2026-10-31",body:n===1?description:null}));
  state.pressBody=async item=>String((item as {url:string}).url).endsWith("/3")?null:description;
  state.invoke=async()=>response(grounded());
  const result=await collectPressSignals({adapters:{ulsan:true,jeonnam:false,gyeongbuk:false,chungnam:false,gyeonggi:false,gyeongnam:false,jeonbuk:false,mcee:false}});
  assert.equal(result.inserted,2);assert.equal(result.failed,1);assert.equal(result.byGrade.candidate,1);assert.equal(result.byGrade.confirmed,1);
  const kinds=state.inserts.map(row=>JSON.parse(String(row[8])).classification.contentQuality.inputKind);assert.deepEqual(kinds,["search_excerpt","full_text"]);
});

test("실제 QA07/08의 줄임표 경계 오탐을 재현하고 ID 선택으로 원문 전체를 보존한다",async()=>{
  const inputs=[
    {title:"SK하이닉스 '청주 공장' 시계 당긴 이유⋯HBM 증산 관문 된 '후공정'",description:"SK하이닉스가 청주 첨단 패키징 공장 'P&T7'의 클린룸 오픈 일정을 앞당긴 것도 HBM을 포함한 AI 메모리 수요... ◆올해 투자 규모 40조원 후반, 설비투자 규율 유지 P&T7 일정 조정은 전공정 증설 시간표와 맞물린다. 약..."},
    {title:"SK하이닉스, 최태원 'AI 증설' 결단에 54조 베팅했는데… 美 감속론 확산...",description:"실제로 SK하이닉스는 지난해 연간 매출의 56%에 달하는 54조3000억원을 들여 새 공장을 짓기로 했지만... 지난달에는 용인 D램 공장 Y2에 35조2000억원, 청주 낸드 공장 M17에 19조1000억원을 투자하기로 결정했다. 미국..."},
  ];
  for(const input of inputs){
    const fields=grounded({companyName:"SK하이닉스",location:null,scale:null,projectPeriod:null,evidenceQuotes:[input.description.split("...")[0]]});
    // 이전 문장복사 방식은 끝의 ...가 빠진, 원문과 동일한 발췌조차 실패했다.
    assert.throws(()=>validateNewsGroundedOutput(fields,input),/온전한 문장/);
    const selected=validateNewsGroundedSelection({...selection(fields) as object,evidenceIds:["S1"]},input);
    assert.equal(selected.decision,"accepted");assert.deepEqual(selected.evidenceQuotes,[input.description]);
    mockResponse({...selection(fields) as object,evidenceIds:["S1"]});const actual=await classifyNewsDetailed(input.title,input.description);
    assert.equal(actual.classification?.isSignal,true);assert.equal(actual.classification?.confidence,"medium");assert.equal(actual.classification?.summary,input.description);
    assert.equal(actual.classification?.contentQuality?.inputHash,newsInputHash(input.title,input.description));
  }
});

test("ID 인용은 HTML entity·인용부호·줄임표를 바꾸지 않고 알 수 없는 ID와 직접 인용 응답을 거부한다",()=>{
  const input={title:"테스트전자 P&T7 공장 일정 변경",description:"테스트전자는 청주 공장 ‘P&amp;T7’의 클린룸 오픈 일정을 앞당긴다고 밝혔다… 이후 단계는 협의 중이다."};
  const fields=selection(grounded({location:null,scale:null,projectPeriod:null}));
  const result=validateNewsGroundedSelection(fields,input);assert.equal(result.decision,"accepted");assert.deepEqual(result.evidenceQuotes,[input.description]);
  assert.throws(()=>validateNewsGroundedSelection({...fields as object,evidenceIds:["S999"]},input),/근거 ID/);
  assert.throws(()=>validateNewsGroundedSelection(grounded(),input),/필수 필드/);
  assert.throws(()=>validateNewsGroundedSelection({...fields as object,scale:"500억원"},input),/scale/);
  assert.deepEqual(buildNewsEvidenceParts(input),[{id:"T",text:input.title},{id:"S1",text:input.description}]);
});

test("제목의 회사명은 근거로 보존해도 다기업 계약의 직접 사업 주체로 보완하지 않는다",()=>{
  const input={title:"[주요공시] 테스트전자, 다른전자",description:"청주 공장 건설에 300억원을 투자하기로 했다."};
  const fields={...selection(grounded({projectPeriod:null})) as object,evidenceIds:["T","S1"]};
  const result=validateNewsGroundedSelection(fields,input);assert.equal(result.decision,"needs_review");assert.deepEqual(result.evidenceQuotes,[input.title,input.description]);
  assert.throws(()=>validateNewsGroundedSelection({...fields,companyName:"세번째전자"},input),/companyName/);
});

test("비채택 요약은 제목과 분류 안내만 반환하고 배경 투자 문장은 metadata에만 남긴다",async()=>{
  for(const decision of ["background","needs_review","unrelated"] as const){
    mockResponse(grounded({decision,titleRelation:"background"}));const result=await classifyNewsDetailed("주택 분양 소식",description);
    assert.equal(result.status,"ok");assert.equal(result.classification?.summary,newsReviewSummary("주택 분양 소식",decision));
    assert.doesNotMatch(result.classification?.summary??"",/300억원|내년 2월/);assert.deepEqual(result.classification?.contentQuality?.evidenceQuotes,[description]);
  }
});

test("실제 응답의 위반 필드를 제한된 진단으로 반환하고 null enum을 추정 보정하지 않는다",async()=>{
  mockResponse({...selection(grounded({decision:"background",titleRelation:"background"})) as object,signalType:null,reason:"진단에 저장하면 안 되는 자유문장",extraSecret:"sk-ant-not-for-diagnostics"});
  const extra=await classifyNewsDetailed(title,description);assert.equal(extra.status,"failed");assert(!Object.hasOwn(extra.diagnostics?.fields??{},"extraSecret"));assert(!Object.hasOwn(extra.diagnostics?.fields??{},"reason"));
  mockResponse({...selection(grounded({decision:"background",titleRelation:"background"})) as object,signalType:null});
  const typeFailure=await classifyNewsDetailed(title,description);assert.match(typeFailure.error??"",/signalType/);assert.equal(typeFailure.diagnostics?.fields.signalType,null);assert.equal(typeFailure.diagnostics?.fields.confidence,"high");
  mockResponse({...selection(grounded()) as object,confidence:"unknown"});
  const confidenceFailure=await classifyNewsDetailed(title,description);assert.match(confidenceFailure.error??"",/confidence/);assert.equal(confidenceFailure.diagnostics?.fields.confidence,"unknown");
  mockResponse({...selection(grounded()) as object,relevanceNote:"sk-ant-test-secret "+"무근거설명".repeat(100)});
  const noteFailure=await classifyNewsDetailed(title,description);assert(noteFailure.diagnostics);assert(String(noteFailure.diagnostics.fields.relevanceNote).length<=180);assert.doesNotMatch(String(noteFailure.diagnostics.fields.relevanceNote),/sk-ant-test-secret/);
});

test("JSON 파싱 실패는 공개 응답 일부만 반환하며 프롬프트·헤더·API키를 진단에 넣지 않는다",async()=>{
  const invalid='```\n{"decision":"background", broken: "sk-ant-diagnostic-secret"}\n```';mockResponse(invalid);
  const result=await classifyNewsDetailed(title,description);assert.equal(result.status,"failed");assert.equal(result.diagnostics?.stage,"json");
  assert.equal(result.diagnostics?.responseChars,invalid.length);assert.match(result.diagnostics?.rawText??"",/broken/);assert.doesNotMatch(result.diagnostics?.rawText??"",/sk-ant-diagnostic-secret/);
  mockResponse("not-json "+"X".repeat(5000));assert.equal((await classifyNewsDetailed(title,description)).diagnostics?.rawText?.length,4000);
  mockResponse(grounded());await classifyNewsDetailed(title,description);const prompt=state.requests[0].messages[0].content;
  assert.doesNotMatch(prompt,/"signalType":"investment\|/);assert.match(prompt,/"signalType":"other"/);assert.match(prompt,/"confidence":"low"/);
});

test("기반시설 병목·제조기술 경쟁의 배경 투자를 신규 투자로 채택하지 않는다",async()=>{
  const inputs=[
    {title:"“용인팹 가동때 출입 6배로 늘어 도로 확장 시급…용수도 해결 안돼”",description:"SK하이닉스가 경기 용인에 조성중인 반도체클러스터 첫 번째 팹(공장) ‘Y1’은 내년 2월 클린룸 가동을... 앞으로 삼성전자와 SK하이닉스의 대대적인 팹 신설, 증설에 따라 용수 사용이 급증할 텐데 하수 재이용을..."},
    {title:"미세공정 넘어 'AI 제조'로···삼성·SK하닉, 반도체 혁신 경쟁 나섰다",description:"SK하이닉스는 첫 팹 시설에 2030년까지 21조6000억원을 투자할 계획이다. SK그룹은 용인·청주·서남권을 잇는 반도체 생산벨트 구축에도 나서고 있다. 동시에 전국에 단계적으로 총 15GW 규모의 AI 데이터센터를 구축하는..."},
  ];
  for(const input of inputs){
    mockResponse({...selection(grounded({companyName:"SK하이닉스",location:null,scale:null,projectPeriod:null})) as object,evidenceIds:["T","S1"]});
    const result=await classifyNewsDetailed(input.title,input.description);assert.equal(result.status,"ok");assert.equal(result.classification?.isSignal,false);assert.equal(result.classification?.contentQuality?.decision,"background");assert.equal(result.classification?.summary,newsReviewSummary(input.title,"background"));
    assert.deepEqual(result.classification?.contentQuality?.evidenceQuotes,[input.title,input.description]);
  }
});

test("배경 키워드가 함께 있어도 공장 증설 투자 발표가 제목의 중심이면 직접 근거를 보존한다",async()=>{
  for(const t of ["테스트전자 공장 증설 투자 발표, 전력 부족 대책도 추진","테스트전자 공장 증설 발표…공정기술 혁신도 추진"]){
    mockResponse(grounded());const result=await classifyNewsDetailed(t,description);assert.equal(result.classification?.isSignal,true);assert.equal(result.classification?.summary,description);
  }
});

test("줄임표를 건너 기업의 미완성 문장과 지자체 부지 공급을 하나의 투자 결정으로 결합하지 않는다",async()=>{
  const base="26일 업계와 전남광주통합특별시 등에 따르면 SK하이닉스는 광주 군공항 이전 부지 내에 대형 제조 공장을... 즉시 착공이 가능한 탄약고 이전 부지 등 약 63만평을 선제적으로 공급하기로 했다. 2027년 부지 조성을...";
  const t="SK '부지'·삼성 '속도'…호남 반도체 산단 구축 '탄력'";
  for(const omitted of ["...","…","⋯","···"]){
    const d=base.replace(/\.\.\./g,omitted);mockResponse(grounded({companyName:"SK하이닉스",location:"광주",scale:"63만평",projectPeriod:"2027년",evidenceQuotes:[d]}));
    const result=await classifyNewsDetailed(t,d);assert.equal(result.status,"ok");assert.equal(result.classification?.isSignal,false);assert.equal(result.classification?.contentQuality?.decision,"needs_review");assert.match(result.classification?.contentQuality?.reason??"",/같은 구간/);assert.deepEqual(result.classification?.contentQuality?.evidenceQuotes,[d]);
  }
});

test("연속 구간 기준에서도 실제 양성 4건의 명시된 행위와 기대 표현을 후보로 보존한다",async()=>{
  const cases=[
    ["SK하닉 3년치 물량 완판 청주 공장 신설 앞당긴다","/SK하이닉스 재공 SK하이닉스가 청주공장의 반도체 생산량을 확대하고 신규 생산시설 건설을 앞당긴다. 향후 3년간 생산할 D램과 고대역폭메모리(HBM) 물량이 모두 팔려 공급에 적극 대응하기 위한 결정이다...."],
    ["[이슈체크] SK하이닉스, AI 메모리 생산지도 넓힌다…용인서 인디애나까...","‘조세금융신문’은 SK하이닉스의 투자 전략 중 주요 생산시설의 클린룸 구축 일정과 국내외 거점별 역할 등을 짚어봤다. [편집자 주] ◇ 용인 1기 팹 첫 클린룸 내년 2월 완공 기대…후속 시설 순차 구축 예정 우선..."],
    ["SK하이닉스 '청주 공장' 시계 당긴 이유⋯HBM 증산 관문 된 '후공정'","SK하이닉스가 청주 첨단 패키징 공장 'P&T7'의 클린룸 오픈 일정을 앞당긴 것도 HBM을 포함한 AI 메모리 수요... ◆올해 투자 규모 40조원 후반, 설비투자 규율 유지 P&T7 일정 조정은 전공정 증설 시간표와 맞물린다. 약..."],
    ["SK하이닉스, 최태원 'AI 증설' 결단에 54조 베팅했는데… 美 감속론 확산...","실제로 SK하이닉스는 지난해 연간 매출의 56%에 달하는 54조3000억원을 들여 새 공장을 짓기로 했지만... 지난달에는 용인 D램 공장 Y2에 35조2000억원, 청주 낸드 공장 M17에 19조1000억원을 투자하기로 결정했다. 미국..."],
  ];
  for(const [t,d]of cases){
    mockResponse(grounded({companyName:"SK하이닉스",location:null,scale:null,projectPeriod:null,evidenceQuotes:[d]}));const result=await classifyNewsDetailed(t,d);
    assert.equal(result.classification?.isSignal,true,t);assert.equal(result.classification?.confidence,"medium");assert.equal(result.classification?.summary,d);assert.equal(result.classification?.scale,null);
  }
});
