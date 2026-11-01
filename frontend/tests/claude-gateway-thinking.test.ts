import assert from "node:assert/strict";
import test from "node:test";
import { claudeMessages, type ClaudeMessagesRequest } from "../lib/ai/claude-client";
import { invalidateAiSettingsCache } from "../lib/ai/settings";
import { invalidateModelPriceCache } from "../lib/ai/pricing";
import { gatewayFixture, resetGatewayFixture } from "./fixtures/claude-gateway-runtime";

test("실제 Claude 게이트웨이 요청 본문 — fetch·DB double, 외부 호출 없음",async t=>{
  const originalFetch=globalThis.fetch,originalKey=process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY="fixture-only-no-real-api-key";
  const bodies:Array<Record<string,unknown>>=[];
  globalThis.fetch=async(input,init)=>{
    assert.equal(String(input),"https://api.anthropic.com/v1/messages");assert.equal(init?.method,"POST");
    assert.equal(new Headers(init?.headers).get("x-api-key"),"fixture-only-no-real-api-key");
    const body=JSON.parse(String(init?.body)) as Record<string,unknown>;bodies.push(body);
    return new Response(JSON.stringify({model:body.model,content:[{type:"text",text:"fixture response"}],stop_reason:"end_turn",usage:{input_tokens:1,output_tokens:1}}),{status:200,headers:{"Content-Type":"application/json","request-id":"fixture-request"}});
  };
  t.after(()=>{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.ANTHROPIC_API_KEY;else process.env.ANTHROPIC_API_KEY=originalKey;});
  const request:ClaudeMessagesRequest={feature:"intel.scheduled_briefing",model:"claude-sonnet-5",max_tokens:4096,system:"시험 고정 프롬프트",messages:[{role:"user",content:"실제 업무 자료가 없는 요청 본문 시험"}]};
  async function invoke(patch:Partial<ClaudeMessagesRequest>={},settings:Record<string,unknown>={}){
    resetGatewayFixture(settings);invalidateAiSettingsCache();invalidateModelPriceCache();
    const before=bodies.length,result=await claudeMessages({...request,...patch});
    assert.equal(result.ok,true);assert.equal(result.text,"fixture response");assert.equal(bodies.length,before+1);
    assert.deepEqual(gatewayFixture.forbidden,[]);assert.ok(gatewayFixture.reads.includes("SELECT setting_key, setting_json FROM ai_settings"));
    const body=bodies.at(-1)!;assert.equal("thinkingDefaults" in body,false,"내부 기본값 객체 자체는 API로 보내지 않음");return body;
  }
  await t.test("기본값을 지정하지 않은 기존 호출의 본문 유지",async()=>{
    const body=await invoke();assert.deepEqual(body,{model:request.model,max_tokens:4096,system:request.system,messages:request.messages});
    assert.equal("thinking" in body,false);assert.equal("output_config" in body,false);
    const configured=await invoke({},{feature_thinking:{"intel.scheduled_briefing":{effort:"high"}}});assert.deepEqual(configured.output_config,{effort:"high"});
  });
  await t.test("작업 기본 medium과 24000 토큰이 실제 전송 본문에 적용",async()=>{
    const defaults={effort:"medium" as const};const body=await invoke({thinkingDefaults:defaults,max_tokens:24000});
    assert.deepEqual(body.output_config,{effort:"medium"});assert.equal(body.max_tokens,24000);assert.equal("thinking" in body,false);
    assert.deepEqual(defaults,{effort:"medium"});assert.deepEqual((gatewayFixture.usage.at(-1)?.meta as Record<string,unknown>).thinking,{effort:"medium"});
  });
  await t.test("DB 관리자 high·off 설정이 작업 medium·adaptive 기본값보다 우선",async()=>{
    const body=await invoke({thinkingDefaults:{effort:"medium",thinking:"adaptive"},max_tokens:24000},{feature_thinking:{"intel.scheduled_briefing":{effort:"high",thinking:"off"}}});
    assert.deepEqual(body.output_config,{effort:"high"});assert.deepEqual(body.thinking,{type:"disabled"});assert.equal(body.max_tokens,24000);
  });
  await t.test("관리자 모델 변경 후 미지원 Haiku에서는 effort·thinking을 제거",async()=>{
    const body=await invoke({thinkingDefaults:{effort:"medium",thinking:"adaptive"},max_tokens:24000},{feature_model_overrides:{"intel.scheduled_briefing":"claude-haiku-4-5-20251001"},feature_thinking:{"intel.scheduled_briefing":{effort:"high",thinking:"adaptive"}}});
    assert.equal(body.model,"claude-haiku-4-5-20251001");assert.equal("output_config" in body,false);assert.equal("thinking" in body,false);assert.equal(body.max_tokens,24000);
    const unknown=await invoke({model:"unknown-fixture-model",thinkingDefaults:{effort:"medium"}});assert.equal("output_config" in unknown,false);
  });
  await t.test("다른 기능의 관리자 설정은 현재 작업 기본값에 영향을 주지 않음",async()=>{
    const body=await invoke({thinkingDefaults:{effort:"medium"}},{feature_thinking:{"approval.doc_summary":{effort:"high"}}});assert.deepEqual(body.output_config,{effort:"medium"});
  });
});
