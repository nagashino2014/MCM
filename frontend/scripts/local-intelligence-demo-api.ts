/** 로컬 실증 전용 어댑터. 운영 라우트·인증을 변경하지 않고 실제 도메인 함수를 호출한다. */
import { getDb, rowsToObjects } from "../lib/db";
import { checkPermission, type UserAccess } from "../lib/auth/rbac";
import { assertBriefingCapability, getBriefingCapabilities } from "../lib/intel/briefing-access";
import { listActiveEmployees, listSalesProjects, getSalesProject } from "../lib/sales/queries";
import { getIntelSignalDetail } from "../lib/intel/intel-queries";
import { assessIntelProject, createActionSuggestion, createFacilityCandidate, createIntelProject, getIntelProjectDetail, ingestSignalProjects, linkIntelProject, listFacilityCandidates, listProjectEvents, loadProjectIntelligenceActor, mergeIntelProjects, queryBriefingProjects, resolveActionSuggestion, resolveFacilityCandidate, setManualPriority, splitIntelProject, unlinkIntelProject, updateIntelProject } from "../lib/intel/project-intelligence";
import { intelError, requiredText } from "../lib/intel/project-intelligence-rules";
import type { BriefingProjectFilter } from "../lib/intel/project-intelligence-types";
import { assertBriefingAccess, getBriefingProfile, getBriefingRun, listBriefingProfiles, listBriefingRuns, queueDueBriefings, queueManualBriefing, saveBriefingProfile } from "../lib/intel/briefing-store";
import { buildBriefingEvidence } from "../lib/intel/briefing-evidence";
import { claimBriefingRun, executeClaimedBriefing, type GeneratedBriefing } from "../lib/intel/briefing-runner";
import { dispatchBriefingDeliveries, listBriefingDeliveries, retryBriefingRun } from "../lib/intel/briefing-delivery";
import type { BriefingPreview, BriefingProfile, BriefingRunStatus } from "../lib/intel/briefing-types";
import { getBriefing, getRagStatus, listBriefings, listDiscoveryCandidates, listSharedBriefings, markShareRead, type BriefingReport } from "../lib/intel/rag-queries";
import { createBriefingPdf } from "../lib/intel/briefing-pdf";
import { collectOfficialSource, listOfficialSources, updateOfficialSource } from "../lib/intel/official-sources";
import { canManageOfficialSources } from "../lib/intel/official-sources-access";
import { getAiFeature } from "../lib/ai/features";
import { resolveModel } from "../lib/ai/claude-client";
import { loadAiSettings } from "../lib/ai/settings";
import { getBriefingShareResult, listBriefingShareRecipients, shareBriefingWithChannels } from "../lib/intel/briefing-share";
import type { BriefingShareInput } from "../lib/intel/briefing-share-types";
import { getRoomDetail, listMessages } from "../lib/chat/queries";
import { candidateSummaries, discoveryExtras, intelOverview } from "../lib/intel/discovery-overview";
import { buildBriefingTree } from "../lib/intel/briefing-tree";

export interface LocalIntelligenceRequest { url: URL; method: string; body: unknown }
export interface LocalIntelligenceResponse { status?: number; body: unknown; headers?: Record<string,string> }
const ACTOR_ID = "u1";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
type Row = Record<string,unknown>;
const output = (body:unknown,status=200):LocalIntelligenceResponse => ({status,body});
function objectBody(value:unknown):Row { if(value==null)return {};if(typeof value!=="object"||Array.isArray(value))throw intelError("요청은 JSON 객체여야 합니다.");return value as Row; }
function demand(actor:UserAccess,permission:string,target:Parameters<typeof checkPermission>[2]={}){if(!checkPermission(actor,permission,target))throw intelError("시험 사용자의 현재 권한으로 이 작업을 수행할 수 없습니다.",403);}
function localMode():"demo"|"real"{const mode=process.env.MCM_LOCAL_INTELLIGENCE_MODE?.trim()||"demo";if(mode!=="demo"&&mode!=="real")throw intelError("로컬 실행 모드는 demo 또는 real이어야 합니다.",503);return mode;}

/** URL뿐 아니라 연결된 DB 이름도 확인하여 재사용된 연결의 대상 착오를 막는다. */
async function assertLocalDatabase(requestUrl?:URL){
  const databaseName=localMode()==="real"?"intel_live":"intel_demo";
  let database:URL;try{database=new URL(process.env.DATABASE_URL??"");}catch{throw intelError("로컬 실증 데이터베이스 주소가 설정되지 않았습니다.",503);}
  if(!["postgres:","postgresql:"].includes(database.protocol)||!LOCAL_HOSTS.has(database.hostname)||database.port!=="55439"||database.pathname!==`/${databaseName}`||database.search||database.hash)throw intelError(`현재 모드는 localhost:55439/${databaseName} 전용입니다. 연결 주소의 추가 옵션은 허용하지 않습니다.`,503);
  if(requestUrl&&!LOCAL_HOSTS.has(requestUrl.hostname))throw intelError("로컬 주소에서만 실증 API를 사용할 수 있습니다.",403);
  if(process.env.MCM_STORAGE_BUCKET?.trim()||process.env.INTEL_BRIEFING_ENABLED==="true")throw intelError("실증 프로세스에서 외부 저장소·배치 실행 설정을 제거해야 합니다.",503);
  const db=await getDb();const check=rowsToObjects(await db.exec("SELECT current_database() AS name,host(inet_server_addr()) AS address"))[0];
  if(check?.name!==databaseName||!new Set(["127.0.0.1","::1"]).has(String(check.address)))throw intelError("연결된 데이터베이스가 로컬 실증 대상과 일치하지 않습니다.",503);
  return db;
}
async function assertRealAiReady(db:Awaited<ReturnType<typeof getDb>>){
  if(!process.env.ANTHROPIC_API_KEY?.trim())throw intelError("실제 AI 모드의 인증키가 설정되지 않았습니다. 예시 결과로 대체하지 않습니다.",503);
  const schemas=rowsToObjects(await db.exec("SELECT name FROM unnest(ARRAY['ai_usage_log','ai_settings','ai_model_prices','ai_budgets','ai_budget_alerts']) name WHERE to_regclass('public.'||name) IS NULL"));
  if(schemas.length)throw intelError("실제 AI 호출의 사용량·예산 테이블 준비가 필요합니다.",503);
  const settings=await loadAiSettings({fresh:true});
  const warnings=rowsToObjects(await db.exec("SELECT budget_id FROM ai_budgets WHERE enabled=1 AND COALESCE(cardinality(warn_pcts),0)>0 LIMIT 1"));
  if(settings.singleCallAlertUsd||warnings.length)throw intelError("로컬 실제 모드에서는 AI 비용 외부 알림을 꺼야 합니다. 단건 경고와 예산 경고는 끄고 차단 한도는 유지할 수 있습니다.",503);
}
function assertInboxRecipients(body:Row){
  if(body.recipients==null)return;
  if(!Array.isArray(body.recipients))throw intelError("수신자 목록을 확인하세요.");
  for(const item of body.recipients){const recipient=objectBody(item);if(!Array.isArray(recipient.channels)||recipient.channels.some(channel=>channel!=="inbox"))throw intelError("로컬 실증에서는 사내 수신함(inbox)만 선택할 수 있습니다. 외부 이메일·앱 푸시는 발송하지 않습니다.");}
}
function projectFilter(url:URL):BriefingProjectFilter{
  const p=url.searchParams;const list=(key:string)=>p.get(key)?.split(",").map(s=>s.trim()).filter(Boolean);
  const num=(key:string)=>{const raw=p.get(key)?.trim();if(!raw)return undefined;const value=Number(raw);if(!Number.isFinite(value))throw intelError(`${key} 값을 확인하세요.`);return value;};
  const review=p.get("reviewState")?.trim()||undefined;if(review&&!['confirmed','needs_review'].includes(review))throw intelError("검토 상태를 확인하세요.");
  return {q:p.get("q")??undefined,reviewState:review as BriefingProjectFilter["reviewState"],sortByPriority:p.get("sortByPriority")!=="false",industries:list("industries"),regions:list("regions"),types:list("types"),companyNames:list("companyNames"),serviceCodes:list("serviceCodes"),amountMin:num("amountMin"),amountMax:num("amountMax"),includeUnknownAmount:p.get("includeUnknownAmount")!=="false",from:p.get("from")||undefined,to:p.get("to")||undefined,limit:num("limit"),offset:num("offset")};
}
const pageLimit=(url:URL,fallback=50)=>{const raw=url.searchParams.get("limit");const n=raw?Number(raw):fallback;if(!Number.isInteger(n)||n<1)throw intelError("조회 건수를 확인하세요.");return Math.min(200,n);};

/** 실제 preview의 출처·집계만 사용하며 문구 생성은 명시적인 로컬 예시다. LLM을 호출하지 않는다. */
async function generateLocalExample(preview:BriefingPreview,profile:BriefingProfile):Promise<GeneratedBriefing>{
  const evidence=preview.items.filter(e=>e.kind==="project"||e.changed||e.kind==="official");
  if(evidence.length>1200)throw intelError("실증 분석 대상이 1,200건을 넘습니다. 관심 조건을 좁혀 주세요.",422);
  const report:BriefingReport={
    kpis:[{label:"투자 프로젝트",value:`${preview.totalProjects}개`,sub:"로컬 DB 조건 전체 집계"},{label:"수집 신호",value:`${preview.totalSignals}건`,sub:"프로젝트와 별도 집계"},{label:"새로 확인한 자료",value:`${preview.changedCount}건`,sub:"실제 근거 버전 비교"},{label:"생성 방식",value:"로컬 예시",sub:"외부 AI 호출 없음"}],
    trends:evidence.slice(0,6).map((e,i)=>`[로컬 예시 문구] ${e.title} — ${e.changed?"이번 분석에서 새로 확인한 자료":"배경 참고자료"}. [${i+1}]`),
    companies:evidence.filter(e=>e.kind==="project").map(e=>{const facts=JSON.parse(e.text) as Row;const n=evidence.indexOf(e)+1;return {name:e.companyName??"기업 미확인",region:e.region,status:String(facts.stage??"unknown"),project:e.title,desc:`${String(facts.publicSummary??e.title)} [${n}]`,facts:e.amount==null?[]:[{label:"공개 투자액",value:`${e.amount.toLocaleString("ko-KR")} ${String(facts.currency??"KRW")}`}],note:{kind:"참고",text:"로컬 시험 데이터입니다. 외부 AI 분석 결과가 아닙니다."}};}),
    insights:evidence.filter(e=>e.kind==="project").slice(0,3).map(e=>({badge:"확인 필요",text:`[로컬 예시 문구] ${e.title}의 공개 근거를 검토하고 담당자·일정을 확인하세요. [${evidence.indexOf(e)+1}]`})),
    etcNote:`${profile.name} · 로컬 실증 전용 규칙 문구입니다. 조건·근거·실행 이력·사내 수신함은 실제 로컬 DB에서 처리하며, 외부 AI·이메일·푸시는 호출하지 않았습니다. 자료 확보 ${preview.asOf}.`,
  };
  if(!report.trends.length)report.trends=["[로컬 예시 문구] 현재 조건에 해당하는 새로운 자료가 없습니다."];
  return {model:"local-example-no-llm",report,sources:evidence.map(e=>({signalId:e.kind==="signal"?e.id.slice(7):e.id,kind:e.kind,revision:e.revision,score:null,source:e.source,companyName:e.companyName,reportName:e.title,disclosedAt:e.publishedAt,facilityName:null,url:e.url}))};
}
let runningTick:Promise<{queued:number;processed:Array<{runId:string;status:BriefingRunStatus}>;delivery:{sent:number;failed:number;skipped:number}}> | null=null;
/** 실제 시각의 예정 회차를 처리한다. root 서버가 30초 간격으로 호출하며 동시 호출은 하나로 합친다. */
export function tickLocalIntelligenceDemo(){
  if(runningTick)return runningTick;
  runningTick=(async()=>{
    const db=await assertLocalDatabase();const real=localMode()==="real";if(real)await assertRealAiReady(db);const queued=await queueDueBriefings();const processed:Array<{runId:string;status:BriefingRunStatus}>=[];
    for(let i=0;i<20;i++){const run=await claimBriefingRun();if(!run)break;assertInboxRecipients(run.profile as unknown as Row);processed.push({runId:run.runId,status:real?await executeClaimedBriefing(run):await executeClaimedBriefing(run,generateLocalExample)});}
    const unsafe=rowsToObjects(await db.exec("SELECT delivery_id FROM intel_notification_outbox WHERE channel<>'inbox' AND status IN('pending','failed','sending') LIMIT 1"));
    if(unsafe.length)throw intelError("외부 채널 전달 항목이 발견되어 로컬 발송을 중지했습니다. 사내 수신함만 허용됩니다.",503);
    return {queued,processed,delivery:await dispatchBriefingDeliveries(100)};
  })().finally(()=>{runningTick=null;});
  return runningTick;
}
function startBackgroundTick(){void tickLocalIntelligenceDemo().catch(error=>console.error("[local-intelligence] 백그라운드 실행 실패:",error instanceof Error?error.message:"실행 오류"));}

export async function handleLocalIntelligenceApi(request:LocalIntelligenceRequest):Promise<LocalIntelligenceResponse>{
  try{
    const db=await assertLocalDatabase(request.url);const actor=await loadProjectIntelligenceActor(ACTOR_ID);
    const method=request.method.toUpperCase();const path=request.url.pathname.replace(/\/+$/,"");const body=objectBody(request.body);
    const briefingPath=path==="/api/local-demo/meta" || (path.startsWith("/api/sales/rag/") && !["/api/sales/rag/discovery","/api/sales/rag/index"].includes(path));
    if(briefingPath){
      await assertBriefingCapability(ACTOR_ID,"view");
      if(method!=="GET"&&method!=="HEAD"&&!path.endsWith("/preview")&&path!=="/api/sales/rag/briefings/shared")await assertBriefingCapability(ACTOR_ID,path.endsWith("/share")?"share":"create");
    }else{demand(actor,"sales.view");if(method!=="GET"&&method!=="HEAD")demand(actor,"sales.edit");}
    const match=(pattern:RegExp)=>{const found=path.match(pattern);if(!found)return null;try{return found.slice(1).map(decodeURIComponent);}catch{throw intelError("주소 형식이 올바르지 않습니다.");}};
    let ids:string[]|null;

    if(path==="/api/local-demo/meta"&&method==="GET"){
      const mode=localMode();const real=mode==="real";
      const counts=rowsToObjects(await db.exec("SELECT (SELECT count(*)::int FROM intel_signals) AS signals,(SELECT count(*)::int FROM intel_projects WHERE state='active') AS projects,(SELECT count(*)::int FROM intel_source_documents) AS source_documents,(SELECT count(*)::int FROM intel_rag_briefings) AS briefings"))[0];
      let imported:Row|null=null;let lastAiCall:Row|null=null;
      if(real){
        const exists=rowsToObjects(await db.exec("SELECT to_regclass('public.local_intelligence_imports') IS NOT NULL AS imports,to_regclass('public.ai_usage_log') IS NOT NULL AS usage"))[0];
        if(exists.imports){const row=rowsToObjects(await db.exec("SELECT import_id,completed_at,lookback_days,limit_count,source_total,imported_signals,imported_facilities,projects_created,source_counts,source_log_summary,coverage FROM local_intelligence_imports WHERE status='completed' AND completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 1"))[0];if(row)imported={importId:row.import_id,importedAt:row.completed_at,lookbackDays:row.lookback_days,limitCount:row.limit_count,sourceTotal:row.source_total,importedSignals:row.imported_signals,importedFacilities:row.imported_facilities,projectsCreated:row.projects_created,sourceCounts:row.source_counts,sourceLogSummary:row.source_log_summary,coverage:row.coverage};}
        if(exists.usage){const last=rowsToObjects(await db.exec("SELECT model,status,cost_usd,called_at FROM ai_usage_log WHERE feature_key='intel.scheduled_briefing' ORDER BY called_at DESC,log_id DESC LIMIT 1"))[0];if(last)lastAiCall={model:last.model,status:last.status,costUsd:last.cost_usd==null?null:Number(last.cost_usd),calledAt:last.called_at};}
      }
      return output({mode,database:real?"intel_live":"intel_demo",useStoredData:process.env.MCM_INTEL_USE_STORED_DATA==="1",aiConfigured:real&&!!process.env.ANTHROPIC_API_KEY?.trim(),aiModel:real?await resolveModel("intel.scheduled_briefing",getAiFeature("intel.scheduled_briefing").defaultModel):"local-example-no-llm",lastAiCall,import:imported,counts:{signals:Number(counts.signals),projects:Number(counts.projects),sourceDocuments:Number(counts.source_documents),briefings:Number(counts.briefings)},notificationChannels:["inbox"],shareChannels:["shared","inbox","messenger"],blockedShareChannels:["push"]});
    }

    if(path==="/api/sales/rag/profiles/recipients"&&method==="GET"){
      const caps=await getBriefingCapabilities(ACTOR_ID);if(!caps.canCreate&&!caps.canShare)throw intelError("수신자를 지정할 권한이 없습니다.",403);const users=[];for(const row of rowsToObjects(await db.exec("SELECT user_id,name,email FROM users WHERE status='active' ORDER BY name LIMIT 1000")))if((await getBriefingCapabilities(String(row.user_id))).canView)users.push({userId:String(row.user_id),name:String(row.name??row.email),email:String(row.email??"")});return output({users});
    }
    if(path==="/api/sales/rag/profiles"){
      if(method==="GET")return output({profiles:await listBriefingProfiles(ACTOR_ID),capabilities:await getBriefingCapabilities(ACTOR_ID)});
      if(method==="POST"){assertInboxRecipients(body);return output({profile:await saveBriefingProfile(ACTOR_ID,body)},201);}
    }
    if((ids=match(/^\/api\/sales\/rag\/profiles\/([^/]+)\/(preview|run)$/))&&method==="POST"){
      const profile=await getBriefingProfile(ids[0],ACTOR_ID,ids[1]==="run");assertInboxRecipients(profile as unknown as Row);
      if(ids[1]==="preview"){const preview=await buildBriefingEvidence(profile);return output({preview:{...preview,items:preview.items.slice(0,30)}});}
      if(localMode()==="real")await assertRealAiReady(db);
      const queued=await queueManualBriefing(ids[0],ACTOR_ID,requiredText(body.requestKey,"요청 키",100));if(localMode()==="real"){startBackgroundTick();return output({run:queued},202);}await tickLocalIntelligenceDemo();return output({run:await getBriefingRun(queued.runId,ACTOR_ID)});
    }
    if((ids=match(/^\/api\/sales\/rag\/profiles\/([^/]+)$/))){
      if(method==="GET")return output({profile:await getBriefingProfile(ids[0],ACTOR_ID)});
      if(method==="PATCH"){assertInboxRecipients(body);const previous=await getBriefingProfile(ids[0],ACTOR_ID,true);assertInboxRecipients(previous as unknown as Row);return output({profile:await saveBriefingProfile(ACTOR_ID,body,ids[0])});}
    }
    if(path==="/api/sales/rag/runs"&&method==="GET")return output({runs:await listBriefingRuns(ACTOR_ID,request.url.searchParams.get("profileId")||undefined)});
    if((ids=match(/^\/api\/sales\/rag\/runs\/([^/]+)\/retry$/))&&method==="POST"){if(localMode()==="real")await assertRealAiReady(db);await retryBriefingRun(ids[0],ACTOR_ID,body.resendUnknown===true);if(localMode()==="real"){startBackgroundTick();return output({run:await getBriefingRun(ids[0],ACTOR_ID)},202);}await tickLocalIntelligenceDemo();return output({run:await getBriefingRun(ids[0],ACTOR_ID)});}
    if((ids=match(/^\/api\/sales\/rag\/runs\/([^/]+)$/))&&method==="GET"){
      const run=await getBriefingRun(ids[0],ACTOR_ID);if(run.briefingId)await assertBriefingAccess(run.briefingId,ACTOR_ID);return output({run,briefing:run.briefingId?await getBriefing(run.briefingId,ACTOR_ID):null,deliveries:await listBriefingDeliveries(run.runId,ACTOR_ID)});
    }
    if((ids=match(/^\/api\/sales\/rag\/briefings\/([^/]+)\/export$/))&&method==="GET"){
      await assertBriefingAccess(ids[0],ACTOR_ID);const briefing=await getBriefing(ids[0]);if(!briefing)throw intelError("브리핑을 찾을 수 없습니다.",404);
      try{return {status:200,body:await createBriefingPdf(briefing),headers:{"Content-Type":"application/pdf","Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent("로컬실증_브리핑.pdf")}`}};}catch(error){if((error as {code?:string}).code==="ENOENT")throw intelError("로컬 PDF에 필요한 한글 글꼴이 없습니다. frontend 폴더에서 서버를 실행하세요.",503);throw error;}
    }
    if((ids=match(/^\/api\/sales\/rag\/briefings\/([^/]+)\/share$/))){
      if(method==="GET")return request.url.searchParams.get("recipients")==="1"?output({snapshot:await listBriefingShareRecipients(ids[0],ACTOR_ID)}):output(await getBriefingShareResult(ids[0],ACTOR_ID,request.url.searchParams.get("requestId")??""));
      if(method==="POST")return output(await shareBriefingWithChannels(ids[0],ACTOR_ID,body as unknown as BriefingShareInput,{blockExternalPush:true}));
    }
    if(path==="/api/sales/rag/briefings"&&method==="GET")return output({briefings:await listBriefings(pageLimit(request.url,20),ACTOR_ID)});
    if(path==="/api/sales/rag/briefings/shared"){
      if(method==="GET")return output({briefings:await listSharedBriefings(ACTOR_ID,pageLimit(request.url,20))});
      if(method==="PATCH"){const id=requiredText(body.briefingId,"브리핑");await assertBriefingAccess(id,ACTOR_ID);await markShareRead(id,ACTOR_ID);return output({briefingId:id,read:true});}
    }
    if((ids=match(/^\/api\/sales\/rag\/briefings\/([^/]+)$/))&&method==="GET"){await assertBriefingAccess(ids[0],ACTOR_ID);return output({briefing:await getBriefing(ids[0],ACTOR_ID)});}
    if(path==="/api/sales/rag/status"&&method==="GET")return output({...await getRagStatus(),embeddingReady:false,briefingReady:false,capabilities:await getBriefingCapabilities(ACTOR_ID)});
    if(path==="/api/sales/rag/discovery"&&method==="GET")return output({candidates:await listDiscoveryCandidates(pageLimit(request.url,30))});
    if(method==="POST"&&(path==="/api/sales/rag/briefings"||path==="/api/sales/rag/index"||/^\/api\/sales\/rag\/briefings\/[^/]+\/refine$/.test(path)))throw intelError(localMode()==="real"?"이 로컬 서버의 실제 AI 호출은 정기 브리핑에서 지원합니다. ‘지금 생성’을 이용하세요. 구형 수동 질의·임베딩 호출은 제공하지 않습니다.":"로컬 예시 모드에서는 외부 AI·임베딩을 호출하지 않습니다. 정기 브리핑의 ‘지금 생성’에서 시험 DB를 이용한 예시 보고서를 확인하세요.",503);

    if(path==="/api/sales/rag/briefing-tree"&&method==="GET")return output(await buildBriefingTree(ACTOR_ID));
    if(path==="/api/sales/intel/overview"&&method==="GET")return output(await intelOverview(actor,{days:Number(request.url.searchParams.get("days")??14)}));
    if(path==="/api/sales/intel/projects"){
      if(method==="GET"){const result=await queryBriefingProjects(projectFilter(request.url));return output({...result,extras:await discoveryExtras(result.projects.map(p=>p.projectId),actor)});}
      if(method==="POST")return output({project:await createIntelProject(body as unknown as Parameters<typeof createIntelProject>[0],actor)},201);
    }
    if(path==="/api/sales/intel/projects/sync"&&method==="POST"){if(!canManageOfficialSources(actor))throw intelError("공용 수집 반영에는 전사 편집 권한이 필요합니다.",403);return output(await ingestSignalProjects(body as unknown as Parameters<typeof ingestSignalProjects>[0]));}
    if((ids=match(/^\/api\/sales\/intel\/projects\/([^/]+)\/links\/([^/]+)$/))&&method==="DELETE")return output(await unlinkIntelProject(ids[0],ids[1],body as unknown as Parameters<typeof unlinkIntelProject>[2],actor));
    if((ids=match(/^\/api\/sales\/intel\/projects\/([^/]+)\/(links|priority|assessments|merge|split|events)$/))){
      const id=ids[0];if(method==="GET"&&ids[1]==="events")return output({events:await listProjectEvents({projectId:id,limit:500})});
      if(method==="POST")switch(ids[1]){
        case "links":return output(await linkIntelProject(id,body as unknown as Parameters<typeof linkIntelProject>[1],actor));
        case "priority":return output(await setManualPriority(id,body as unknown as Parameters<typeof setManualPriority>[1],actor));
        case "assessments":return output(await assessIntelProject(id,actor));
        case "merge":return output(await mergeIntelProjects(id,body as unknown as Parameters<typeof mergeIntelProjects>[1],actor));
        case "split":return output(await splitIntelProject(id,body as unknown as Parameters<typeof splitIntelProject>[1],actor));
        case "events":return output({project:await updateIntelProject(id,body as unknown as Parameters<typeof updateIntelProject>[1],actor)});
      }
    }
    if((ids=match(/^\/api\/sales\/intel\/projects\/([^/]+)$/))){if(method==="GET")return output(await getIntelProjectDetail(ids[0],actor));if(method==="PATCH")return output({project:await updateIntelProject(ids[0],body as unknown as Parameters<typeof updateIntelProject>[1],actor)});}
    if(path==="/api/sales/intel/candidates"){
      if(method==="GET"){const f=projectFilter(request.url);const result=await listFacilityCandidates(actor,{status:request.url.searchParams.get("status")?.trim()||undefined,limit:f.limit,offset:f.offset});return output({...result,summaries:await candidateSummaries(result.candidates)});}
      if(method==="POST")return output({candidate:await createFacilityCandidate(body as unknown as Parameters<typeof createFacilityCandidate>[0],actor)},201);
    }
    if((ids=match(/^\/api\/sales\/intel\/candidates\/([^/]+)$/))&&method==="PATCH")return output({candidate:await resolveFacilityCandidate(ids[0],body as unknown as Parameters<typeof resolveFacilityCandidate>[1],actor)});
    if(path==="/api/sales/intel/actions"&&method==="POST")return output({action:await createActionSuggestion(body as unknown as Parameters<typeof createActionSuggestion>[0],actor)},201);
    if((ids=match(/^\/api\/sales\/intel\/actions\/([^/]+)$/))&&method==="PATCH")return output(await resolveActionSuggestion(ids[0],body as unknown as Parameters<typeof resolveActionSuggestion>[1],actor));
    if((ids=match(/^\/api\/sales\/intel\/signals\/([^/]+)$/))&&method==="GET"){const signal=await getIntelSignalDetail(ids[0]);if(!signal)throw intelError("신호를 찾을 수 없습니다.",404);return output({signal});}
    if(path==="/api/sales/intel/official-sources"){
      if(method==="GET")return output({sources:await listOfficialSources(),canManage:canManageOfficialSources(actor)});
      if(method==="PUT"){if(!canManageOfficialSources(actor))throw intelError("전사 영업 편집 권한이 필요합니다.",403);if(Buffer.byteLength(JSON.stringify(body),"utf8")>40000)throw intelError("설정 내용이 너무 큽니다.",413);return output({source:await updateOfficialSource(body,ACTOR_ID)});}
    }
    if((ids=match(/^\/api\/sales\/intel\/official-sources\/([^/]+)\/(collect|test)$/))&&method==="POST"){
      if(localMode()!=="real")throw intelError("로컬 예시 모드에서는 공식 정보원 외부 호출을 실행하지 않습니다. 설정 저장과 검증 상태 화면만 시험 DB에서 확인할 수 있습니다.",503);
      if(!canManageOfficialSources(actor))throw intelError("전사 영업 편집 권한이 필요합니다.",403);
      const source=(await listOfficialSources()).find(s=>s.providerId===ids![0]);if(!source)throw intelError("공식 정보원을 찾을 수 없습니다.",404);
      if(source.requiresSecret&&!source.hasSecret)throw intelError("이 정보원의 실제 인증 설정을 먼저 저장하세요.",503);
      const result=await collectOfficialSource(source.providerId);
      if(result.signalIds.length)await ingestSignalProjects({signalIds:result.signalIds,revisionIds:result.revisionIds,mode:"live"});
      return output({result});
    }

    if(path==="/api/sales/employees"&&method==="GET")return output({employees:await listActiveEmployees()});
    if(path==="/api/sales/projects"&&method==="GET"){const projects=(await listSalesProjects({q:request.url.searchParams.get("q")||undefined})).filter(p=>checkPermission(actor,"sales.view",{projectId:p.projectId}));return output({projects:projects.slice(0,pageLimit(request.url,30))});}
    if(path==="/api/facilities"&&method==="GET"){
      const q=request.url.searchParams.get("q")?.trim()??"";const rows=rowsToObjects(await db.exec("SELECT facility_id,company_name,site_address FROM facilities WHERE deleted_at IS NULL AND ($1='' OR strpos(lower(COALESCE(company_name,'')),lower($1))>0 OR strpos(lower(COALESCE(site_address,'')),lower($1))>0) ORDER BY company_name,facility_id LIMIT $2",[q,pageLimit(request.url,30)]));return output({items:rows.map(r=>({facilityId:r.facility_id,companyName:r.company_name,siteAddress:r.site_address}))});
    }
    if(path==="/api/contracts"&&method==="GET"){
      demand(actor,"contract.view");const q=request.url.searchParams.get("q")?.trim()??"";const rows=rowsToObjects(await db.exec("SELECT c.contract_id,COALESCE(to_jsonb(c)->>'contract_title',to_jsonb(c)->>'title',f.company_name,c.contract_id) AS title,f.site_address FROM contracts c LEFT JOIN facilities f ON f.facility_id=c.facility_id WHERE c.deleted_at IS NULL ORDER BY c.contract_id"));const permitted=rows.filter(r=>checkPermission(actor,"contract.view",{contractId:String(r.contract_id)})&&(!q||String(r.title).toLocaleLowerCase().includes(q.toLocaleLowerCase())));return output({items:permitted.slice(0,pageLimit(request.url,30)).map(r=>({contractId:r.contract_id,contractTitle:r.title,siteAddress:r.site_address}))});
    }
    if((ids=match(/^\/api\/local-demo\/sales\/([^/]+)$/))&&method==="GET"){
      demand(actor,"sales.view",{projectId:ids[0]});const project=await getSalesProject(ids[0]);if(!project)throw intelError("영업건을 찾을 수 없습니다.",404);const rows=rowsToObjects(await db.exec("SELECT * FROM sales_activities WHERE project_id=$1 ORDER BY scheduled_at,activity_id",[ids[0]]));return output({project,activities:rows.map(r=>({activityId:r.activity_id,projectId:r.project_id,activityType:r.activity_type,status:r.status,scheduledAt:r.scheduled_at,endedAt:r.ended_at,occurredAt:r.occurred_at,summary:r.summary,progressNote:r.progress_note,createdAt:r.created_at}))});
    }
    if((ids=match(/^\/api\/local-demo\/chat\/(\d+)$/))&&method==="GET"){
      const roomId=Number(ids[0]);const room=await getRoomDetail(roomId,ACTOR_ID);if(!room)throw intelError("대화방을 찾을 수 없습니다.",404);
      return output({roomId,name:room.name??room.members.filter(member=>member.userId!==ACTOR_ID).map(member=>member.name).join(", "),messages:await listMessages(roomId,ACTOR_ID,{limit:100})});
    }
    if(path==="/api/local-demo/inbox"&&method==="GET"){
      const messages=rowsToObjects(await db.exec("SELECT m.message_id,m.subject,m.body_text,m.received_at FROM mail_messages m JOIN mailboxes b ON b.mailbox_id=m.mailbox_id WHERE b.user_id=$1 ORDER BY m.received_at DESC,m.message_id LIMIT 100",[ACTOR_ID]));return output({messages:messages.map(m=>({messageId:m.message_id,subject:m.subject,bodyText:m.body_text,receivedAt:m.received_at}))});
    }
    return output({error:"로컬 실증 서버에서 지원하지 않는 경로 또는 작업입니다."},404);
  }catch(error){const code=Number((error as {status?:number}).status);return output({error:error instanceof Error?error.message:"로컬 요청을 처리하지 못했습니다."},Number.isInteger(code)&&code>=400&&code<=599?code:500);}
}
