import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

// DB와 권리 승인 조회의 반환만 fixture로 대체한다. 실제 DB/API를 사용하지 않는다.
const doubles={
  "@/lib/db":`const db={exec:async sql=>globalThis.__originalTextFixture.read(sql)};export const getDb=async()=>db;export const withDbRead=async fn=>fn(db);export const rowsToObjects=rows=>rows;`,
  "./project-intelligence":`export const queryBriefingProjects=async()=>({projects:globalThis.__originalTextFixture.projects,total:globalThis.__originalTextFixture.projects.length});`,
  "./official-sources":`export const listOfficialEvidence=async()=>({evidence:globalThis.__originalTextFixture.official,total:globalThis.__originalTextFixture.official.length,nextOffset:null});`,
  "./briefing-store":`export const iso=value=>String(value);`,
};
const built=await build({entryPoints:["lib/intel/briefing-evidence.ts"],bundle:true,write:false,platform:"node",format:"esm",packages:"external",tsconfig:"tsconfig.json",plugins:[{name:"public-original-fixture",setup(b){b.onResolve({filter:/.*/},args=>Object.hasOwn(doubles,args.path)?{path:args.path,namespace:"fixture"}:undefined);b.onLoad({filter:/.*/,namespace:"fixture"},args=>({contents:doubles[args.path],loader:"js"}));}}]});
const {buildBriefingEvidence}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const stamp='2026-10-31T00:00:00.000Z';
const profile={profileId:'fixture',version:1,filters:{industries:[],regions:[],signalTypes:[],companyNames:[],services:[],amountMin:null,amountMax:null,includeUnknownScale:true},requiredSources:[]};
function setup(){
  const row=(id,source,raw)=>({signal_id:id,source,report_name:`${id} 제목`,summary:'분류기가 작성한 요약',company_name:'검증회사',disclosed_at:'2026-10-01',created_at:stamp,updated_at:stamp,region:null,amount:null,url:null,signal_type:'investment',raw_json:raw});
  const state={
    signals:[row('news','news',{description:'공개 뉴스 발췌',classification:{summary:'다른 파생 요약'},privateMemo:'비공개 fixture'}),row('press','press',JSON.stringify({body:'공개 기관 보도자료 원문',privateMemo:'비공개 fixture'})),row('legacy','dart',{summary:'원문이 아닌 분류 요약',body:'허용 경로가 확인되지 않은 본문'})],
    projects:[{projectId:'p1',title:'업무 프로젝트',companyName:'검증회사',region:null,stage:'unknown',amount:null,currency:'KRW',amountScope:'project',publicSummary:'업무상 파생 요약',updatedAt:stamp}],
    official:[{documentId:'allowed',revisionId:'allowed-rev',title:'권리 허용 공식자료',sourceName:'공식기관',url:'https://example.test/allowed',publishedAt:'2026-10-01',fetchedAt:stamp,normalizedText:'허용된 공식 원문 전체'}],
    read(sql){
      if(sql.includes(' AS held '))return [{held:0}];
      if(sql.includes('SELECT s.signal_id,s.source')){assert.match(sql,/s\.raw_json/);return state.signals;}
      if(sql.includes('FROM intel_project_signals'))return [{project_id:'p1',signal_id:'news',source:'news',document_id:null}];
      if(/intel_profile_seen_revisions|intel_collect_state|scraper_run_logs|scraper_sources/.test(sql))return [];
      throw Error(`Unexpected fixture query: ${sql}`);
    },
  };globalThis.__originalTextFixture=state;return state;
}

test('새 스냅샷은 공개 원문·파생자료·제목 한정을 구분하고 비공개 raw 필드를 포함하지 않는다',async()=>{
  setup();const preview=await buildBriefingEvidence(profile,stamp),byId=new Map(preview.items.map(item=>[item.id,item]));
  assert.equal(byId.get('signal:news').originalText,'공개 뉴스 발췌');assert.equal(byId.get('signal:news').qualityInputKind,'search_excerpt');
  assert.equal(byId.get('signal:press').originalText,'공개 기관 보도자료 원문');assert.equal(byId.get('signal:press').qualityInputKind,'full_text');
  assert.equal(byId.get('signal:legacy').originalText,null);assert.equal(byId.get('signal:legacy').qualityInputKind,'title_only');
  assert.equal(byId.get('project:p1').originalText,null);assert.equal(byId.get('project:p1').qualityInputKind,'derived');
  assert.equal(byId.get('official:allowed').originalText,'허용된 공식 원문 전체');assert.equal(byId.get('official:allowed').qualityInputKind,'full_text');assert.equal(byId.get('official:allowed').revision,'allowed-rev');
  const snapshot=JSON.parse(JSON.stringify(preview));assert.deepEqual(snapshot.items,preview.items);assert.ok(!JSON.stringify(snapshot).includes('비공개 fixture'));assert.ok(!JSON.stringify(snapshot).includes('허용 경로가 확인되지 않은 본문'));
});

test('분류 요약이 같아도 공개 원문이나 발표일 변경은 새 revision으로 감지한다',async()=>{
  const state=setup();const first=(await buildBriefingEvidence(profile,stamp)).items.find(item=>item.id==='signal:news');
  state.signals[0].raw_json.description='정정된 공개 뉴스 발췌';const revised=(await buildBriefingEvidence(profile,stamp)).items.find(item=>item.id==='signal:news');
  assert.equal(revised.text,first.text);assert.notEqual(revised.revision,first.revision);
  state.signals[0].disclosed_at='2026-10-02';assert.notEqual((await buildBriefingEvidence(profile,stamp)).items.find(item=>item.id==='signal:news').revision,revised.revision);
});

test('press 공개 body가 목록 발췌로 표시되어 있으면 본문 전체로 승격하지 않는다',async()=>{
  const state=setup();state.signals[1].raw_json=JSON.stringify({body:'보도자료 목록의 공개 발췌',classification:{contentQuality:{inputKind:'search_excerpt'}}});
  const excerpt=(await buildBriefingEvidence(profile,stamp)).items.find(item=>item.id==='signal:press');
  assert.equal(excerpt.originalText,'보도자료 목록의 공개 발췌');assert.equal(excerpt.qualityInputKind,'search_excerpt');
  state.signals[1].raw_json=JSON.stringify({body:'보도자료 목록의 공개 발췌'});
  const legacy=(await buildBriefingEvidence(profile,stamp)).items.find(item=>item.id==='signal:press');assert.equal(legacy.qualityInputKind,'full_text');assert.notEqual(excerpt.revision,legacy.revision);
});
