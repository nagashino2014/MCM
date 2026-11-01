import assert from "node:assert/strict";
import { test } from "node:test";
import { activityDate, assessPublicServices, normalizeProjectInput, recommendProjectActions, scorePublicProject, FACILITY_SERVICE_MAP, CONTRACT_SERVICE_MAP } from "../lib/intel/project-intelligence-rules";
import { computeStage } from "../lib/sales/queries";

test("공개 평가는 내부 고객관계를 포함하지 않으며 재현 가능한 근거와 누락 범위를 제공한다", () => {
  const project={title:"반도체 공장 증설",publicSummary:"공장 증설 계획 발표",industry:"semiconductor",stage:"announced" as const,amount:null,currency:"KRW",expectedStartAt:null};
  const services=assessPublicServices(project,["s1"]);
  const score=scorePublicProject(project,services,"confirmed","2026-10-30");
  assert.deepEqual(score,scorePublicProject(project,services,"confirmed","2026-10-30"));
  assert.equal(score.maximum,85);assert.equal(score.score,40);assert.equal(score.possibleScore,70);
  assert.equal(score.components.some(c=>c.key==="relationship"),false);
  assert.equal(services.find(s=>s.serviceCode==="integrated_permit")?.status,"possible");
  assert.equal(services.find(s=>s.serviceCode==="haps")?.status,"insufficient");
  assert.equal(assessPublicServices(project,[]).every(s=>s.status==="insufficient"),true);
});
test("HAPs는 사업장·영업·계약 사이에서 별도 분류를 유지한다",()=>{
  assert.equal(FACILITY_SERVICE_MAP.haps,"haps");assert.equal(CONTRACT_SERVICE_MAP.haps,"HAPs");
  const items=assessPublicServices({title:"VOC 배출저감",publicSummary:null,industry:null,stage:"unknown"},["s2"]);
  assert.equal(items.find(s=>s.serviceCode==="haps")?.status,"possible");
});
test("후속 행동 추천은 근거 있는 질문으로만 생성하며 같은 입력·기준일에 재현된다",()=>{
  const services=assessPublicServices({title:"공장 VOC 증설",publicSummary:null,industry:null,stage:"announced"},["s1"]);
  const actions=recommendProjectActions("p1",services,null,"2026-12-31");assert.ok(actions.length>0);assert.equal(actions[0].suggestedDate,"2027-01-01");assert.equal(actions[0].defaultAssignee,null);
  assert.deepEqual(actions,recommendProjectActions("p1",services,null,"2026-12-31"));assert.deepEqual(actions[0].evidenceSignalIds,["s1"]);
  assert.deepEqual(recommendProjectActions("p1",services.map(s=>({...s,evidenceSignalIds:[]})),null,"2026-12-31"),[]);
});
test("금액·일정 오류를 거부하며 외화·미상 금액을 근거 없는 규모 점수로 바꾸지 않는다",()=>{
  assert.throws(()=>normalizeProjectInput({title:"증설",amount:-1}));
  assert.throws(()=>normalizeProjectInput({title:"증설",expectedStartAt:"2026-02-30"}));
  assert.throws(()=>activityDate("2026-10-30T25:00"));
  assert.equal(activityDate("2026-10-30T09:00"),"2026-10-30T09:00:00");
  const score=scorePublicProject({stage:"unknown",amount:100000000000,currency:"USD",expectedStartAt:null},[],"unknown","2026-10-30");
  assert.equal(score.components.find(c=>c.key==="size")?.points,null);assert.equal(score.needsReview,true);
});
test("취소한 활동은 일정 날짜가 지나도 영업단계를 올리거나 수주로 바꾸지 않는다",()=>{
  assert.equal(computeStage([{activity_type:"visit",status:"canceled",scheduled_at:"2020-01-01T09:00:00",ended_at:"2020-01-01T10:00:00"}]),"lead");
  assert.equal(computeStage([{activity_type:"result",status:"canceled",bid_result:"won_bid"}]),"lead");
  assert.equal(computeStage([{activity_type:"telemarketing",status:"done",scheduled_at:"2020-01-01T09:00:00"}]),"contact");
});
