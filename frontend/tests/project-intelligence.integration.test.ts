import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { createIntelProject, createActionSuggestion, getIntelProjectDetail, ingestSignalProjects, linkIntelProject, listFacilityCandidates, listProjectEvents, loadProjectIntelligenceActor, mergeIntelProjects, queryBriefingProjects, resolveActionSuggestion, resolveFacilityCandidate, setManualPriority, splitIntelProject, unlinkIntelProject, updateIntelProject } from "../lib/intel/project-intelligence";
import { convertSignalToProject, deleteSignalWithFeedback, deleteSignals, deleteSignalsByGrade, updateSignalStatus } from "../lib/intel/intel-queries";
import { deleteActivity, deleteSalesProject } from "../lib/sales/queries";
import { createNewsContentQuality } from "../lib/intel/news-content-quality";

test("독립 PostgreSQL에서 영업 발굴의 원자성·중복·권한·사업장 분리를 검증한다", async t => {
  const raw=process.env.INTEL_TEST_DATABASE_URL!;const url=new URL(raw);
  assert.ok(["127.0.0.1","localhost","[::1]"].includes(url.hostname),"테스트는 로컬 DB만 허용");
  assert.equal(url.pathname,"/intel_projects_test","전용 테스트 DB 이름만 허용");
  const adminUrl=new URL(raw);adminUrl.pathname="/postgres";const admin=new Client({connectionString:adminUrl.toString(),ssl:false});await admin.connect();
  if(!(await admin.query("SELECT 1 FROM pg_database WHERE datname='intel_projects_test'")).rowCount)await admin.query("CREATE DATABASE intel_projects_test");await admin.end();
  const db=new Client({connectionString:raw,ssl:false});await db.connect();
  await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await db.query(await readFile("tests/fixtures/project-intelligence-base.sql","utf8"));
  await db.query("ALTER TABLE intel_signals ADD COLUMN IF NOT EXISTS region text, ADD COLUMN IF NOT EXISTS raw_json jsonb");
  const migration=await readFile("../infra/aws/320_project_intelligence.sql","utf8");await db.query(migration);await db.query(migration);
  process.env.DATABASE_URL=raw;process.env.PGSSL="disable";Object.assign(process.env,{NODE_ENV:"test"});delete process.env.MCM_DB_EXPECTED_ROLE;delete process.env.MCM_DB_ROLE_REQUIRED;
  const actor=await loadProjectIntelligenceActor("u1");const restricted=await loadProjectIntelligenceActor("u2");
  const count=async(table:string)=>Number((await db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
  let projectId="";let salesProjectId="";let actionId="";
  await t.test("멱등 마이그레이션이 기존 전환을 새 영업건 없이 복원한다",async()=>{
    assert.equal(await count("sales_projects"),2);assert.equal(await count("intel_business_links"),1);
    assert.equal((await db.query("SELECT sales_project_id FROM intel_business_links")).rows[0].sales_project_id,"legacy_sales");
  });
  await t.test("기존 신호의 초기 적재는 후보·프로젝트를 만들지만 live 알림을 만들지 않는다",async()=>{
    await db.query("INSERT INTO intel_signals(signal_id,source,company_name,report_name,summary,amount,industry,created_at,updated_at) VALUES('s1','news','신규기업','반도체 공장 증설','반도체 공장 증설에 VOC 저감 시설 검토',20000000000,'semiconductor',now()::text,now()::text),('s2','news','신규기업','다른 공장 투자','공장 계획',null,'semiconductor',now()::text,now()::text)");
    const result=await ingestSignalProjects({signalIds:["s1","s2"],mode:"initial_backfill"});assert.equal(result.created,2);assert.equal((await listProjectEvents({mode:"live",confirmedOnly:true})).length,0);
    assert.equal((await listFacilityCandidates(actor)).candidates.length,2);
    assert.deepEqual(await listFacilityCandidates(actor,{status:""}),await listFacilityCandidates(actor));
    assert.deepEqual(await listFacilityCandidates(actor,{status:"  "}),await listFacilityCandidates(actor));
    assert.equal((await ingestSignalProjects({signalIds:["s1","s2"],mode:"initial_backfill"})).skipped,2);
  });
  await t.test("N:M 근거를 공유하는 프로젝트 중 하나만 전환해도 다른 후보가 남는다",async()=>{
    const p=await createIntelProject({requestKey:crypto.randomUUID(),title:"첫 공장",companyName:"반도체회사",facilityId:"f1",industry:"semiconductor",region:"경기도 용인시",stage:"announced",signalIds:["s1","s2"]},actor);projectId=p.projectId;
    const other=await createIntelProject({requestKey:crypto.randomUUID(),title:"두 번째 공장",facilityId:"f2",signalIds:["s1"]},actor);
    const request={requestKey:"concurrent-create",version:1,createSales:{serviceCode:"haps" as const,ownerEmployeeId:"e1",ownerDeptId:"d1",scopeKey:"1차"}};
    const [a,b]=await Promise.all([linkIntelProject(projectId,request,actor),linkIntelProject(projectId,request,actor)]);assert.equal(a.salesProjectId,b.salesProjectId);salesProjectId=a.salesProjectId!;
    assert.equal((await db.query("SELECT status,linked_project_id FROM intel_signals WHERE signal_id='s1'")).rows[0].status,"new");
    assert.ok((await queryBriefingProjects({limit:100})).projects.some(x=>x.projectId===other.projectId));
    assert.equal((await db.query("SELECT service_category,expected_amount FROM sales_projects WHERE project_id=$1",[salesProjectId])).rows[0].service_category,"haps");
    assert.equal((await db.query("SELECT expected_amount FROM sales_projects WHERE project_id=$1",[salesProjectId])).rows[0].expected_amount,null);
  });
  await t.test("프로젝트와 제안의 최초 생성도 요청 키로 중복을 방지한다",async()=>{
    const input={requestKey:"project-create-retry",title:"생성 재시도",signalIds:["s1"]};
    const [a,b]=await Promise.all([createIntelProject(input,actor),createIntelProject(input,actor)]);assert.equal(a.projectId,b.projectId);
    await assert.rejects(createIntelProject({...input,title:"다른 내용"},actor),e=>(e as any).status===409);
  });
  await t.test("동일 키의 다른 내용과 부분 실패는 거부하고 영업건을 롤백한다",async()=>{
    await assert.rejects(linkIntelProject(projectId,{requestKey:"concurrent-create",version:1,salesProjectId:"legacy_sales"},actor),e=>(e as any).status===409);
    const before=await count("sales_projects");await assert.rejects(linkIntelProject(projectId,{requestKey:"fail-action",version:1,createSales:{serviceCode:"chem",ownerEmployeeId:"e1",ownerDeptId:"d1",scopeKey:"실패 확인"},actionId:"missing-action"},actor));
    assert.equal(await count("sales_projects"),before);assert.equal(Number((await db.query("SELECT count(*) n FROM intel_operation_keys WHERE request_key='fail-action'")).rows[0].n),0);
  });
  await t.test("비공개 연결·내부관계 점수는 권한 없는 사용자에게 나타나지 않는다",async()=>{
    await linkIntelProject(projectId,{requestKey:"private-link",version:1,salesProjectId:"private_sales"},actor);
    const detail=await getIntelProjectDetail(projectId,restricted);assert.equal(detail.links.length,0);assert.equal(detail.internalContext.relationshipPoints,0);
    await assert.rejects(linkIntelProject(projectId,{requestKey:"deny-link",version:1,salesProjectId:"private_sales"},restricted),e=>(e as any).status===403);
    const publicDetail=await getIntelProjectDetail(projectId,actor);assert.deepEqual(detail.priority,publicDetail.priority);
  });
  await t.test("채택 전 일정 없음, 동시 채택은 planned 한 건, 취소는 기존 활동 상태를 읽는다",async()=>{
    const a=await createActionSuggestion({requestKey:"action-create-one",projectId,title:"환경 담당자 방문",activityType:"visit",assigneeEmployeeId:"e1",scheduledAt:"2026-11-02T09:00",endedAt:"2026-11-02T10:00",evidenceSignalIds:["s1"],salesProjectId},actor);actionId=a.actionId;
    const retry=await createActionSuggestion({requestKey:"action-create-one",projectId,title:"환경 담당자 방문",activityType:"visit",assigneeEmployeeId:"e1",scheduledAt:"2026-11-02T09:00",endedAt:"2026-11-02T10:00",evidenceSignalIds:["s1"],salesProjectId},actor);assert.equal(a.actionId,retry.actionId);
    assert.equal(await count("sales_activities"),0);const input={action:"accept" as const,requestKey:"accept-once",version:1,salesProjectId};
    const [a1,a2]=await Promise.all([resolveActionSuggestion(actionId,input,actor),resolveActionSuggestion(actionId,input,actor)]);assert.equal(a1.activityId,a2.activityId);assert.equal(await count("sales_activities"),1);
    const activity=(await db.query("SELECT status,occurred_at FROM sales_activities WHERE activity_id=$1",[a1.activityId])).rows[0];assert.equal(activity.status,"planned");assert.equal(activity.occurred_at,null);
    await db.query("UPDATE sales_activities SET status='canceled' WHERE activity_id=$1",[a1.activityId]);assert.equal((await getIntelProjectDetail(projectId,actor)).actions[0].activityStatus,"canceled");
  });
  await t.test("프로젝트 변경은 버전 충돌을 거부하고 확인된 새 사건만 live로 제공한다",async()=>{
    const p=await updateIntelProject(projectId,{title:"첫 공장",version:1,stage:"construction",eventType:"construction",confirmed:true,occurredAt:"2026-10-30"},actor);assert.equal(p.version,2);
    await assert.rejects(updateIntelProject(projectId,{title:"오래된 입력",version:1},actor),e=>(e as any).status===409);
    const events=await listProjectEvents({mode:"live",confirmedOnly:true,projectId});assert.equal(events.length,1);assert.equal(events[0].eventType,"construction");
  });
  await t.test("신규 사업장 동시 확정은 1개이고 같은 사업자번호의 다른 공장을 자동 병합하지 않는다",async()=>{
    const c=(await listFacilityCandidates(actor)).candidates[0];const input={action:"register" as const,version:c.version,requestKey:"register-one",companyName:"새 공장",siteAddress:"충청북도 청주시 신규공장",businessRegistrationNo:"555-66-77777"};
    const [c1,c2]=await Promise.all([resolveFacilityCandidate(c.candidateId,input,actor),resolveFacilityCandidate(c.candidateId,input,actor)]);assert.equal(c1.facilityId,c2.facilityId);assert.equal(await count("facilities"),3);
    const other=(await listFacilityCandidates(actor)).candidates.find(x=>x.status==="new")!;
    await assert.rejects(resolveFacilityCandidate(other.candidateId,{action:"register",version:other.version,requestKey:"dup-brn",companyName:"반도체회사 신규공장",siteAddress:"경기도 평택시 공장3",businessRegistrationNo:"123-45-67890"},actor),e=>(e as any).status===409);
  });
  await t.test("분리 후 근거와 후보는 보존되고 서로 다른 사업장 병합은 차단한다",async()=>{
    const split=await splitIntelProject(projectId,{version:2,requestKey:"split-one",title:"분리 사업",signalIds:["s2"],reason:"실제 사업 범위 다름"},actor);
    assert.equal((await getIntelProjectDetail(split.projectId,actor)).signals.length,1);assert.equal((await getIntelProjectDetail(projectId,actor)).signals.length,1);
    const a=await createIntelProject({requestKey:crypto.randomUUID(),title:"용인",facilityId:"f1"},actor);const b=await createIntelProject({requestKey:crypto.randomUUID(),title:"청주",facilityId:"f2"},actor);
    await assert.rejects(mergeIntelProjects(a.projectId,{sourceId:b.projectId,version:1,sourceVersion:1,requestKey:"wrong-merge",reason:"이름만 동일"},actor),e=>(e as any).status===409);
  });
  await t.test("기존 단일 신호 전환도 동시 요청에 영업건 하나만 만든다",async()=>{
    await db.query("INSERT INTO intel_signals(signal_id,company_name,report_name,facility_id,created_at,updated_at) VALUES('atomic-old','반도체회사','과거 방식 전환','f1',now()::text,now()::text)");
    const [a,b]=await Promise.all([convertSignalToProject("atomic-old","u1"),convertSignalToProject("atomic-old","u1")]);assert.equal(a,b);
  });
  await t.test("공식 자료 권리회수는 이미 파생된 프로젝트 요약·평가도 보고서 조회에서 제외한다",async()=>{
    const rights={aiAllowed:true,internalReportAllowed:true,storageAllowed:true};
    await db.query("INSERT INTO scraper_sources VALUES('official','samsung_sem',$1::jsonb)",[JSON.stringify({enabled:true,verifiedAt:new Date().toISOString(),permissions:rights})]);
    await db.query("INSERT INTO intel_source_documents(document_id,signal_id,source_id,current_revision_id) VALUES('doc','s1','official','rev')");
    await db.query("INSERT INTO intel_source_document_revisions VALUES('rev','doc',$1::jsonb)",[JSON.stringify(rights)]);
    assert.ok((await queryBriefingProjects({limit:100})).projects.some(p=>p.projectId===projectId));
    await db.query("UPDATE scraper_sources SET official_config=jsonb_set(official_config,'{permissions,aiAllowed}','false') WHERE source_id='official'");
    assert.equal((await queryBriefingProjects({limit:100})).projects.some(p=>p.projectId===projectId),false);
    await db.query("UPDATE scraper_sources SET official_config=jsonb_set(official_config,'{permissions,aiAllowed}','true') WHERE source_id='official'");
    await db.query("UPDATE scraper_sources SET official_config=jsonb_set(official_config,'{enabled}','false') WHERE source_id='official'");
    assert.equal((await queryBriefingProjects({limit:100})).projects.some(p=>p.projectId===projectId),false);
    await db.query("UPDATE scraper_sources SET official_config=jsonb_set(official_config,'{enabled}','true') WHERE source_id='official'");
  });
  await t.test("회사 부분검색과 정확한 프로필 조건은 독립 적용된다",async()=>{
    assert.ok((await queryBriefingProjects({q:"반도체",limit:100})).projects.some(p=>p.projectId===projectId));
    assert.equal((await queryBriefingProjects({companyNames:["반도체"],limit:100})).projects.some(p=>p.projectId===projectId),false);
    assert.equal((await queryBriefingProjects({q:"%",limit:100})).total,0);
  });
  await t.test("계약 연결과 표시도 실제 계약 부서의 열람 범위를 확인한다",async()=>{
    await db.query("INSERT INTO users VALUES('u3','member','d2','e2','active'); INSERT INTO permission_templates VALUES('contract-scoped',1); INSERT INTO permission_template_grants VALUES('cg1','contract-scoped','sales.view','all',NULL,'allow'),('cg2','contract-scoped','sales.edit','all',NULL,'allow'),('cg3','contract-scoped','contract.view','specific_dept','d2','allow'); INSERT INTO user_permission_assignments(assignment_id,user_id,template_id) VALUES('ca1','u3','contract-scoped'); INSERT INTO contracts VALUES('c3','f1','d2',NULL)");
    const scoped=await loadProjectIntelligenceActor("u3");const version=(await getIntelProjectDetail(projectId,actor)).project.version;
    await assert.rejects(linkIntelProject(projectId,{requestKey:"contract-denied",version,contractId:"c1"},scoped),e=>(e as any).status===403);
    await linkIntelProject(projectId,{requestKey:"contract-allowed",version,contractId:"c3"},scoped);
    await linkIntelProject(projectId,{requestKey:"contract-own",version,contractId:"c1"},actor);
    const links=(await getIntelProjectDetail(projectId,scoped)).links;assert.ok(links.some(x=>x.contractId==="c3"));assert.ok(!links.some(x=>x.contractId==="c1"));
    const privateLink=(await getIntelProjectDetail(projectId,actor)).links.find(x=>x.contractId==="c1")!;
    await assert.rejects(unlinkIntelProject(projectId,privateLink.linkId,{requestKey:"unlink-denied",reason:"권한 검증"},scoped),e=>(e as any).status===403);
  });
  await t.test("근거 및 확정 활동 삭제는 409로 보호하고 연결 해제는 영업건·활동을 보존한다",async()=>{
    const detail=await getIntelProjectDetail(projectId,actor);const link=detail.links.find(x=>x.salesProjectId===salesProjectId)!;const activityId=detail.actions.find(a=>a.actionId===actionId)!.salesActivityId!;
    const protected409=(e:unknown)=>(e as any).status===409;
    await assert.rejects(deleteSignalWithFeedback("s1","lacks_specifics",null,"u1"),protected409);
    await assert.rejects(deleteSignals(["s1"]),protected409);
    await assert.rejects(deleteActivity(activityId),protected409);await assert.rejects(deleteSalesProject(salesProjectId),protected409);
    await createActionSuggestion({requestKey:"unlink-pending",projectId,title:"다음 검토",activityType:"email",salesProjectId},actor);
    const input={requestKey:"unlink-once",reason:"다른 업무 범위로 재검토"};await unlinkIntelProject(projectId,link.linkId,input,actor);await unlinkIntelProject(projectId,link.linkId,input,actor);
    assert.equal((await db.query("SELECT 1 FROM sales_projects WHERE project_id=$1",[salesProjectId])).rowCount,1);assert.equal((await db.query("SELECT 1 FROM sales_activities WHERE activity_id=$1",[activityId])).rowCount,1);
    const pending=(await getIntelProjectDetail(projectId,actor)).actions.find(x=>x.title==="다음 검토")!;assert.equal(pending.status,"hold");assert.equal(pending.salesProjectId,null);
    assert.equal((await db.query("SELECT 1 FROM audit_log WHERE action='intel_business_unlink' AND target_id=$1",[link.linkId])).rowCount,1);
  });
  await t.test("제외 신호의 자동 후보는 숨기고 사용자 검토 내용은 수집 갱신이 덮어쓰지 않는다",async()=>{
    const auto=(await db.query("SELECT project_id FROM intel_projects WHERE ingestion_key='signal:s2'")).rows[0].project_id;
    let p=(await getIntelProjectDetail(auto,actor)).project;await updateIntelProject(auto,{version:p.version,title:"검토자가 확인한 명칭",publicSummary:"검토 내용 보존"},actor);
    await db.query("UPDATE intel_signals SET report_name='수집 제목 변경',summary='수집 내용 변경',updated_at=now()::text WHERE signal_id='s2'");await ingestSignalProjects({signalIds:["s2"],mode:"live"});
    p=(await getIntelProjectDetail(auto,actor)).project;assert.equal(p.title,"검토자가 확인한 명칭");assert.equal(p.publicSummary,"검토 내용 보존");
    await updateSignalStatus("s1","dismissed");const auto1=(await db.query("SELECT project_id FROM intel_projects WHERE ingestion_key='signal:s1'")).rows[0].project_id;
    assert.ok(!(await queryBriefingProjects({limit:100})).projects.some(x=>x.projectId===auto1));assert.ok((await queryBriefingProjects({limit:100})).projects.some(x=>x.projectId===projectId));
    assert.ok(!(await listFacilityCandidates(actor)).candidates.some(x=>(x.evidence.signalIds as string[]).includes("s1")));
    await db.query("UPDATE intel_signals SET signal_grade='monitoring' WHERE signal_id='s2'");await assert.rejects(deleteSignalsByGrade("monitoring"),e=>(e as any).status===409);
  });
  await t.test("개인 우선순위는 멱등·버전 검증 후 저장하며 타인 사유와 공개 점수에 섞이지 않는다",async()=>{
    const before=await getIntelProjectDetail(projectId,actor);const input={requestKey:"priority-once",version:before.project.version,priority:"high" as const,reason:"내부 담당자 확인 후 우선 검토"};
    const [a,b]=await Promise.all([setManualPriority(projectId,input,actor),setManualPriority(projectId,input,actor)]);assert.deepEqual(a,b);assert.equal(a.manualPriority.actorName,"담당1");assert.equal(a.manualPriority.projectVersion,before.project.version);
    await assert.rejects(setManualPriority(projectId,{...input,requestKey:"priority-stale",version:before.project.version-1},actor),e=>(e as any).status===409);
    await assert.rejects(setManualPriority(projectId,{...input,priority:"low"},actor),e=>(e as any).status===409);
    const own=await getIntelProjectDetail(projectId,actor);const other=await getIntelProjectDetail(projectId,restricted);assert.equal(own.manualPriority?.reason,input.reason);assert.equal(other.manualPriority,null);assert.deepEqual(own.priority,before.priority);assert.equal(own.project.version,before.project.version);
    assert.equal((await db.query("SELECT 1 FROM audit_log WHERE action='intel_manual_priority' AND target_id=$1",[`${projectId}:u1`])).rowCount,1);
    await setManualPriority(projectId,{requestKey:"priority-other",version:before.project.version,priority:"low",reason:"내 검토 대기"},restricted);assert.equal((await getIntelProjectDetail(projectId,actor)).manualPriority?.priority,"high");
    assert.equal(JSON.stringify((await queryBriefingProjects({limit:100})).projects).includes(input.reason),false);
  });
  await t.test("공개 점수 순서와 정보 보완 목록이 같은 조건·집계로 분리된다",async()=>{
    const high=await createIntelProject({requestKey:"rank-high",title:"순위 공장 증설",companyName:"순위검증",stage:"permitting",amount:200000000000,currency:"KRW",signalIds:["s2"]},actor);
    const low=await createIntelProject({requestKey:"rank-low",title:"순위 공장 증설",companyName:"순위검증",stage:"mou",amount:1000000,signalIds:["s2"]},actor);
    const unknown=await createIntelProject({requestKey:"rank-unknown",title:"순위 자료부족",companyName:"순위검증",stage:"unknown"},actor);
    const ranked=await queryBriefingProjects({companyNames:["순위검증"],sortByPriority:true,limit:100});assert.deepEqual(ranked.projects.map(x=>x.projectId),[high.projectId,low.projectId,unknown.projectId]);
    const ready=await queryBriefingProjects({companyNames:["순위검증"],reviewState:"confirmed",sortByPriority:true});assert.equal(ready.total,2);assert.ok(ready.projects.every(p=>!p.priority?.needsReview));
    const pending=await queryBriefingProjects({companyNames:["순위검증"],reviewState:"needs_review"});assert.equal(pending.total,1);assert.equal(pending.projects[0].projectId,unknown.projectId);
  });
  await t.test("후속 추천은 권한 있는 담당자만 제시하고 조회만으로 활동을 만들지 않는다",async()=>{
    const before=await count("sales_activities");const detail=await getIntelProjectDetail(projectId,actor);const restrictedDetail=await getIntelProjectDetail(projectId,restricted);
    assert.ok(detail.recommendedActions.length>0);assert.ok(detail.recommendedActions.some(a=>a.defaultAssignee!==null));assert.ok(restrictedDetail.recommendedActions.every(a=>a.defaultAssignee===null&&a.salesProjectId===null));assert.equal(await count("sales_activities"),before);
    const visit=await createActionSuggestion({requestKey:"visit-no-end",projectId,title:"종료 미확정 방문",activityType:"visit",assigneeEmployeeId:"e1",scheduledAt:"2026-11-04T10:00",salesProjectId:"private_sales"},actor);
    await assert.rejects(resolveActionSuggestion(visit.actionId,{requestKey:"visit-no-end-accept",action:"accept",version:1},actor),e=>(e as any).status===400);assert.equal(await count("sales_activities"),before);
    const accepted=await resolveActionSuggestion(visit.actionId,{requestKey:"visit-with-end",action:"accept",version:1,endedAt:"2026-11-04T11:00"},actor);assert.ok(accepted.activityId);
  });
  await t.test("수집 내용 수정의 금액 전후 값은 보존되어 같은 금액을 신규 투자로 오인하지 않는다",async()=>{
    await db.query("INSERT INTO intel_signals(signal_id,source,company_name,report_name,summary,amount,created_at,updated_at) VALUES('event-delta','news','변경검증','공장 투자','최초 발표',100000000000,now()::text,now()::text)");
    const created=await ingestSignalProjects({signalIds:["event-delta"],mode:"initial_backfill"});const id=created.projectIds[0];
    await db.query("UPDATE intel_signals SET summary='동일 금액의 설명 보강',updated_at=now()::text WHERE signal_id='event-delta'");await ingestSignalProjects({signalIds:["event-delta"],mode:"live"});
    let events=await listProjectEvents({projectId:id,mode:"live",confirmedOnly:true});assert.equal(events.length,1);assert.equal(events[0].before.amount,100000000000);assert.equal(events[0].after.amount,100000000000);assert.equal(events[0].before.stage,events[0].after.stage);
    await db.query("UPDATE intel_signals SET amount=130000000000,updated_at=now()::text WHERE signal_id='event-delta'");await ingestSignalProjects({signalIds:["event-delta"],mode:"live"});
    events=await listProjectEvents({projectId:id,mode:"live",confirmedOnly:true});assert.equal(events.length,2);assert.equal(events[1].before.amount,100000000000);assert.equal(events[1].after.amount,130000000000);assert.equal(Number(events[1].after.amount)-Number(events[1].before.amount),30000000000);
  });
  await t.test("제목과 금액이 같아도 근거 문서 개정은 별도 사건으로 보존하고 같은 개정 재시도는 생략한다",async()=>{
    await db.query("INSERT INTO intel_source_documents(document_id,signal_id,source_id,current_revision_id) VALUES('revision-doc','event-delta','official','body-rev1'); INSERT INTO intel_source_document_revisions VALUES('body-rev1','revision-doc','{}'::jsonb),('body-rev2','revision-doc','{}'::jsonb)");
    const first=await ingestSignalProjects({signalIds:["event-delta"],revisionIds:["body-rev1"],mode:"live"});assert.equal(first.updated,1);
    await db.query("UPDATE intel_source_documents SET current_revision_id='body-rev2' WHERE document_id='revision-doc'");
    const second=await ingestSignalProjects({signalIds:["event-delta"],revisionIds:["body-rev2"],mode:"live"});assert.equal(second.updated,1);
    const again=await ingestSignalProjects({signalIds:["event-delta"],revisionIds:["body-rev2"],mode:"live"});assert.equal(again.skipped,1);
    const events=await listProjectEvents({projectId:first.projectIds[0],mode:"live"});assert.ok(events.some(e=>e.revisionIds.includes("body-rev1")));assert.ok(events.some(e=>e.revisionIds.includes("body-rev2")));
    const latest=events.find(e=>e.revisionIds.includes("body-rev2"))!;assert.equal(latest.before.amount,latest.after.amount);assert.equal(latest.before.stage,latest.after.stage);
  });
  await t.test("공식 근거 권리회수는 직접 상세·사건·후보 노출 및 수정·등록·재시도 반환도 막는다",async()=>{
    const rights={aiAllowed:true,internalReportAllowed:true,storageAllowed:true};
    await db.query("INSERT INTO scraper_sources VALUES('rights-source','rights-provider',$1::jsonb)",[JSON.stringify({enabled:true,verifiedAt:new Date().toISOString(),permissions:rights})]);
    await db.query("INSERT INTO intel_signals(signal_id,source,company_name,report_name,summary,created_at,updated_at) VALUES('rights-signal','official:rights-provider','권리검증회사','공식 공장 발표','공식 요약',now()::text,now()::text)");
    await db.query("INSERT INTO intel_source_documents(document_id,signal_id,source_id,current_revision_id) VALUES('rights-doc','rights-signal','rights-source','rights-rev')");await db.query("INSERT INTO intel_source_document_revisions VALUES('rights-rev','rights-doc',$1::jsonb)",[JSON.stringify(rights)]);
    const ingested=await ingestSignalProjects({signalIds:["rights-signal"],revisionIds:["rights-rev"],mode:"initial_backfill"});const officialId=ingested.projectIds[0];const candidate=(await listFacilityCandidates(actor)).candidates.find(c=>(c.evidence.signalIds as string[]).includes("rights-signal"))!;assert.ok(candidate);
    const create={requestKey:"official-create-once",title:"공식 참고 검토",signalIds:["rights-signal"]};const manual=await createIntelProject(create,actor);assert.ok((await getIntelProjectDetail(officialId,actor)).signals.length>0);
    await db.query("UPDATE scraper_sources SET official_config=jsonb_set(official_config,'{permissions,aiAllowed}','false') WHERE source_id='rights-source'");
    const forbidden=(e:unknown)=>(e as any).status===403;assert.ok(!(await queryBriefingProjects({limit:200})).projects.some(p=>p.projectId===officialId));
    await assert.rejects(getIntelProjectDetail(officialId,actor),forbidden);await assert.rejects(listProjectEvents({projectId:officialId}),forbidden);assert.ok(!(await listProjectEvents()).some(e=>e.projectId===officialId));
    assert.ok(!(await listFacilityCandidates(actor)).candidates.some(c=>c.candidateId===candidate.candidateId));
    await assert.rejects(updateIntelProject(officialId,{title:"변경 시도",version:1},actor),forbidden);
    const facilitiesBefore=await count("facilities");await assert.rejects(resolveFacilityCandidate(candidate.candidateId,{action:"register",version:1,requestKey:"revoked-register",companyName:"권리검증회사",siteAddress:"경기도 용인시 테스트 공장"},actor),forbidden);assert.equal(await count("facilities"),facilitiesBefore);
    await assert.rejects(createIntelProject(create,actor),forbidden);await assert.rejects(getIntelProjectDetail(manual.projectId,actor),forbidden);
    await assert.rejects(createActionSuggestion({requestKey:"revoked-action",projectId:officialId,title:"후속 제안",activityType:"email"},actor),forbidden);
    await db.query("UPDATE scraper_sources SET official_config=jsonb_set(official_config,'{permissions,aiAllowed}','true') WHERE source_id='rights-source'; UPDATE intel_source_documents SET status='removed' WHERE document_id='rights-doc'");await assert.rejects(getIntelProjectDetail(officialId,actor),forbidden);
  });
  await t.test("투자 지역은 원신호만 따르고 연결 시설 주소를 대신 쓰지 않으며 과거 오분류를 보정",async()=>{
    await db.query("INSERT INTO intel_signals(signal_id,source,company_name,report_name,summary,facility_id,industry,region,created_at,updated_at) VALUES('region-check','news','지역검증기업','미국 공장 검토','투자 위치 세부 미확인','f1','semiconductor',NULL,now()::text,now()::text)");
    const inserted=await ingestSignalProjects({signalIds:['region-check'],mode:'initial_backfill'});const id=inserted.projectIds[0];
    assert.equal((await getIntelProjectDetail(id,actor)).project.region,null);
    await db.query("UPDATE intel_projects SET region='경기도 용인시' WHERE project_id=$1",[id]);
    assert.equal((await ingestSignalProjects({signalIds:['region-check'],mode:'initial_backfill'})).updated,1);
    let detail=await getIntelProjectDetail(id,actor);assert.equal(detail.project.region,null);
    const correction=detail.events.find(e=>e.before.region==='경기도 용인시'&&e.after.region===null);assert.ok(correction);
    await db.query("UPDATE intel_signals SET region='충청북도 청주시',updated_at=now()::text WHERE signal_id='region-check'");
    await ingestSignalProjects({signalIds:['region-check'],mode:'initial_backfill'});detail=await getIntelProjectDetail(id,actor);assert.equal(detail.project.region,'충청북도 청주시');
    assert.equal((await queryBriefingProjects({companyNames:['지역검증기업'],regions:['경기도']})).total,0);
    assert.equal((await queryBriefingProjects({companyNames:['지역검증기업'],regions:['충청북도']})).total,1);
    await db.query("UPDATE intel_signals SET region=NULL,updated_at=now()::text WHERE signal_id='region-check'");await ingestSignalProjects({signalIds:['region-check'],mode:'initial_backfill'});
    assert.equal((await getIntelProjectDetail(id,actor)).project.region,null);
    assert.equal((await ingestSignalProjects({signalIds:['region-check'],mode:'initial_backfill'})).skipped,1);
    detail=await getIntelProjectDetail(id,actor);await updateIntelProject(id,{title:detail.project.title,companyName:detail.project.companyName,facilityId:'f1',industry:'semiconductor',region:'미국 오하이오',version:detail.project.version},actor);
    await db.query("UPDATE intel_signals SET region='충청북도 청주시',summary='수집 자료 수정',updated_at=now()::text WHERE signal_id='region-check'");await ingestSignalProjects({signalIds:['region-check'],mode:'initial_backfill'});
    assert.equal((await getIntelProjectDetail(id,actor)).project.region,'미국 오하이오');
  });
  await t.test("중복·제외·삭제 보류로 바뀐 원신호만 가진 자동 프로젝트와 사업장 후보는 목록에서 제외",async()=>{
    await db.query("INSERT INTO intel_signals(signal_id,source,company_name,report_name,created_at,updated_at) VALUES('invalid-origin','news','원신호변경검증','공장 계획',now()::text,now()::text)");
    const result=await ingestSignalProjects({signalIds:['invalid-origin'],mode:'initial_backfill'});const id=result.projectIds[0];
    const candidate=(await getIntelProjectDetail(id,actor)).project.candidateId;assert.ok(candidate);
    for(const [status,grade,duplicate] of [['dismissed','confirmed',null],['new','excluded',null],['new','confirmed','s2']] as const) {
      await db.query("UPDATE intel_signals SET status=$1,signal_grade=$2,duplicate_of=$3 WHERE signal_id='invalid-origin'",[status,grade,duplicate]);
      assert.equal((await queryBriefingProjects({companyNames:['원신호변경검증']})).total,0);
      assert.ok(!(await listFacilityCandidates(actor,{limit:200})).candidates.some(c=>c.candidateId===candidate));
    }
    await db.query("UPDATE intel_signals SET status='new',signal_grade='confirmed',duplicate_of=NULL WHERE signal_id='invalid-origin'");
    assert.equal((await queryBriefingProjects({companyNames:['원신호변경검증']})).total,1);
    assert.ok((await listFacilityCandidates(actor,{limit:200})).candidates.some(c=>c.candidateId===candidate));
  });
  await t.test("뉴스 재검증 보류는 기존 자동·수동 파생근거를 제외하며 accepted 기업·업종 정정만 동기화",async()=>{
    await db.query("INSERT INTO intel_signals(signal_id,source,company_name,report_name,summary,industry,created_at,updated_at) VALUES('quality-hold','news','품질보류기업','공장 증설 보도','기존 요약','semiconductor',now()::text,now()::text),('quality-accept','news','이전 기업','다른 공장 증설','이전 요약','semiconductor',now()::text,now()::text)");
    const original=await ingestSignalProjects({signalIds:['quality-hold','quality-accept'],mode:'initial_backfill'});
    assert.equal(original.created,2);
    const held=(await db.query("SELECT project_id,candidate_id FROM intel_projects WHERE ingestion_key='signal:quality-hold'")).rows[0];
    const manual=await createIntelProject({requestKey:'quality-manual',title:'사용자 편집 검토',signalIds:['quality-hold']},actor);
    const q=(decision:'accepted'|'needs_review')=>createNewsContentQuality({title:'공장 증설 보도',description:'검증 기업이 공장 증설을 발표했다.',decision,titleRelation:decision==='accepted'?'main':'unclear',evidenceQuotes:decision==='accepted'?['검증 기업이 공장 증설을 발표했다.']:[],reason:'격리 fixture의 품질 판정'});
    await db.query("UPDATE intel_signals SET raw_json=$1::jsonb,signal_grade='monitoring',updated_at=now()::text WHERE signal_id='quality-hold'",[JSON.stringify({classification:{contentQuality:q('needs_review')}})]);
    await db.query("UPDATE intel_signals SET raw_json=$1::jsonb,company_name='검증 기업',industry='electronics',summary='검증한 원문 요약',updated_at=now()::text WHERE signal_id='quality-accept'",[JSON.stringify({classification:{contentQuality:q('accepted')}})]);
    const replay=await ingestSignalProjects({signalIds:['quality-hold','quality-accept'],mode:'replay'});
    assert.equal(replay.created,0);assert.equal(replay.updated,1);
    const listed=await queryBriefingProjects({limit:200});assert.ok(!listed.projects.some(p=>[held.project_id,manual.projectId].includes(p.projectId)));
    assert.ok(!(await listFacilityCandidates(actor,{limit:200})).candidates.some(c=>c.candidateId===held.candidate_id));
    assert.ok(!(await listProjectEvents({limit:5000})).some(e=>e.projectId===held.project_id));
    assert.equal((await db.query("SELECT public_summary FROM intel_projects WHERE project_id=$1",[held.project_id])).rows[0].public_summary,'기존 요약','보류 이력을 삭제하거나 덮지 않는다');
    const accepted=listed.projects.find(p=>p.projectId===replay.projectIds[0])!;assert.equal(accepted.companyName,'검증 기업');assert.equal(accepted.industry,'electronics');assert.equal(accepted.publicSummary,'검증한 원문 요약');
    assert.equal((await ingestSignalProjects({signalIds:['quality-accept'],mode:'replay'})).skipped,1);
    await db.query("UPDATE intel_signals SET raw_json=$1::jsonb WHERE signal_id='quality-hold'",[JSON.stringify({classification:{contentQuality:{decision:'accepted'}}})]);
    assert.ok(!(await queryBriefingProjects({limit:200})).projects.some(p=>[held.project_id,manual.projectId].includes(p.projectId)), '불완전한 accepted 판정도 NOT 조건에서 빠져나가지 않는다');
  });
  await db.end();
});
