import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeBriefingProfile, nextBriefingSlot, latestDueBriefingSlot } from "../lib/intel/briefing-schedule";
import { nextImportantScanAt } from "../lib/intel/briefing-scheduler";
import { validateBriefingNarrative } from "../lib/intel/briefing-runner";
import { isImportantBriefingChange } from "../lib/intel/briefing-important";

const base = () => normalizeBriefingProfile({name:"검증",schedule:{cadence:"daily",startDate:"2026-10-30",time:"08:30"}},"u1");
test("KST 날짜경계와 3일 기준점·월말·놓친 슬롯 합산",()=>{
  const p=base();assert.equal(nextBriefingSlot(p.schedule,new Date("2026-10-29T23:29:00Z")),"2026-10-29T23:30:00.000Z");
  assert.equal(nextBriefingSlot(p.schedule,new Date("2026-10-29T23:30:00Z")),"2026-10-30T23:30:00.000Z");
  const three={...p.schedule,cadence:"every3days" as const};assert.equal(nextBriefingSlot(three,new Date("2026-10-30T00:00:00Z")),"2026-11-01T23:30:00.000Z");
  const monthly={...p.schedule,startDate:"2026-01-01",cadence:"monthly" as const,monthDay:31};assert.equal(nextBriefingSlot(monthly,new Date("2026-02-01T00:00:00Z")),"2026-02-27T23:30:00.000Z");
  assert.equal(latestDueBriefingSlot(three,"2026-10-29T23:30:00Z",new Date("2026-11-10T01:00:00Z")),"2026-11-07T23:30:00.000Z");
});
test("개인 프로필은 외부 수신자를 포함하지 않고 잘못된 시각·규모를 거부",()=>{
  const p=normalizeBriefingProfile({...base(),recipients:[{userId:"u2",channels:["email"]}]},"u1");assert.deepEqual(p.recipients,[{userId:"u1",channels:["inbox"]}]);
  assert.throws(()=>normalizeBriefingProfile({...base(),schedule:{...base().schedule,time:"25:61"}},"u1"));
  assert.throws(()=>normalizeBriefingProfile({...base(),filters:{amountMin:100,amountMax:10}},"u1"));
});
test("중요 변화 증분 스캔은 야간 DB 실행을 예약하지 않음",()=>{
  assert.equal(nextImportantScanAt(null,new Date("2026-10-30T14:00:00Z")),"2026-10-30T22:00:00.000Z");
  assert.equal(nextImportantScanAt("2026-10-30T01:00:00Z",new Date("2026-10-30T01:05:00Z")),"2026-10-30T01:15:00.000Z");
});
test("잘못된 출처·무근거 AI 응답은 발행하지 않음",()=>{
  assert.throws(()=>validateBriefingNarrative(JSON.stringify({trends:["근거 없음"],insights:[]}),2));
  assert.throws(()=>validateBriefingNarrative(JSON.stringify({trends:["투자 [3]"],insights:[]}),2));
  assert.equal(validateBriefingNarrative(JSON.stringify({trends:["투자 [2]"],insights:[]}),2).trends.length,1);
});
test("중요 변화는 같은 단계의 반복 편집을 제외하고 금액 증감·정정을 확인",()=>{
  assert.equal(isImportantBriefingChange({before:{stage:"construction",amount:1000},after:{stage:"construction",amount:1000}},100),false);
  assert.equal(isImportantBriefingChange({before:{stage:"planned"},after:{stage:"construction"}},100),true);
  assert.equal(isImportantBriefingChange({before:{amount:1000},after:{amount:1050}},100),false);
  assert.equal(isImportantBriefingChange({before:{amount:1000},after:{amount:800}},100),true);
  assert.equal(isImportantBriefingChange({before:{},after:{},correctsEventId:"e1"},null),true);
});
