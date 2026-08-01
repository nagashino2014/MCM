import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { anthropicChatJson, LlmError } from "@/lib/ai/llm-json";
import { parseMetricDefinition, validateDefinition } from "@/lib/analytics/metric-types";
import { listSemanticConcepts } from "@/lib/approval/semantic-concepts-store";
import { listMetrics } from "@/lib/analytics/metric-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * 자연어 → 지표 정의 초안(SW-P3, 수동 버튼 — 비용 통제 §8-4 정책과 동일 기조).
 * 원칙(§3-1): LLM 은 선언 JSON "선택"만 하고 실행은 화이트리스트 엔진 — 자유 SQL 생성 없음.
 * 생성된 초안은 validateDefinition 을 통과해야만 반환한다(실패 시 오류).
 */

const SYSTEM_SOURCES_DOC = `system.contracts: 계약 마스터. measures={amount(계약금액),count}, dims=[ref.contract,dim.category(대분류),dim.subcategory(세분류),dim.amount_band(계약금액대 구간)], times={contract_date}
system.participants: 수행인력(계약별 참여 인원·수행 기간 — 수행 기간 분석의 표준 원천). measures={contract_id(count_distinct 로 참여 계약 수),duration_days(수행일수),amount_percentile(참여 계약금액 백분위 0~1 — sum 하면 규모 가중 수행 점수),amount_sum(참여 계약금액 원)}, dims=[ref.employee,ref.contract,dim.category,dim.subcategory,dim.amount_band], times={participated_from}
system.attendance: ADT 근태(주별). measures={overtime_hours(인정 연장),excess_hours(12h 초과),worked_hours}, dims=[ref.employee], times={week_start}
system.leave: 연차 대장. measures={grant_days,use_days}, dims=[ref.employee], times={year}`;

export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const body = (await req.json().catch(() => ({}))) as { prompt?: string };
    const prompt = String(body.prompt ?? "").trim();
    if (!prompt) return NextResponse.json({ error: "요청 문장이 비어 있습니다." }, { status: 400 });

    const concepts = await listSemanticConcepts(true);
    const metrics = await listMetrics(true);
    const conceptDoc = concepts
      .filter((c) => !c.auto)
      .map((c) => `${c.key}(${c.label})`)
      .join(", ");
    const metricDoc = metrics.map((m) => `${m.metricKey}(${m.label}, groupBy=${JSON.stringify((m.definition as { groupBy?: string[] }).groupBy ?? (m.definition as { dimensions?: string[] }).dimensions ?? [])})`).join("\n");

    const out = await anthropicChatJson<{ label?: string; description?: string; definition?: unknown }>({
      system: `너는 그룹웨어 분석 지표 정의 생성기다. 사용자의 한국어 요청을 아래 스키마의 지표 정의 JSON 하나로 변환한다. JSON 외 다른 텍스트 금지.

출력 형식: {"label": "지표 이름", "description": "한 줄 설명", "definition": <아래 스키마>}

definition 스키마 (둘 중 하나):
1) 집계: {"kind":"aggregate","source":{"type":"approval_docs","forms":"auto","status":["approved"]} 또는 {"type":"system.*"},"measure":{"agg":"sum|avg|count|min|max|count_distinct","concept":"<태그>"(approval_docs) 또는 "field":"<필드>"(system)},"groupBy":[차원 최대 3개 조합 — 예: ["dim.subcategory","dim.amount_band"] = 세분류×금액대],"timeBy":{"concept":"when.occurred"(approval_docs) 또는 "field":"<시간필드>"(system),"bucket":"month"|"year"}(생략 가능)}
   groupBy 규칙: approval_docs 는 ref.* 1개 + dim.category 1개까지. system 소스는 해당 소스 dims 목록 안에서 조합.
2) 복합(기존 지표들의 사칙연산): {"kind":"composite","dimensions":["ref.contract"],"formula":["(","지표키","-","지표키",")","/","지표키"],"format":"percent"|"currency"|"number"} — formula 토큰은 기존 지표 키·숫자·+ - * / ( ) 만.

결재 문서(approval_docs)에서 쓸 수 있는 값 태그: ${conceptDoc}
시스템 소스:
${SYSTEM_SOURCES_DOC}
기존 지표(복합 수식에서 참조 가능):
${metricDoc}

규칙: 비용·금액 요청은 대개 approval_docs 태그 집계. 마진율·비율은 composite. "수행 기간" 분석은 system.participants 의 duration_days 를 쓴다(계약 시작·종료일보다 정확). "규모/금액대로 묶어" 요청은 dim.amount_band. 인원별 지표(ref.employee)는 민감 정보다. 존재하지 않는 태그·필드·지표 키를 만들어내지 말 것. **요청이 위 스키마로 정확히 표현되지 않으면 그럴듯한 조합을 지어내지 말고, 가장 가까운 유효한 정의를 고른 뒤 description 에 "요청 중 ~는 현재 지원되지 않아 ~로 근사했습니다"라고 반드시 명시하라.**`,
      user: prompt,
      maxTokens: 800,
    });

    const definition = parseMetricDefinition(out?.definition);
    if (!definition) return NextResponse.json({ error: "LLM 이 유효한 정의를 만들지 못했습니다. 문장을 더 구체적으로 써 보세요." }, { status: 422 });
    const err = validateDefinition(definition);
    if (err) return NextResponse.json({ error: `생성된 정의가 검증에 실패했습니다: ${err}` }, { status: 422 });

    await recordAuditLog({
      actorUserId: actor.userId,
      action: "approval_metric_update",
      targetTable: "metric_definitions",
      targetId: "__suggest__",
      after: { prompt: prompt.slice(0, 200) },
    });
    return NextResponse.json({
      label: String(out?.label ?? "새 지표"),
      description: out?.description != null ? String(out.description) : "",
      definition,
    });
  } catch (err) {
    if (err instanceof LlmError) {
      const msg = err.message === "llm_not_configured" ? "LLM 이 설정되지 않았습니다(ANTHROPIC_API_KEY)." : `LLM 호출 실패: ${err.message}`;
      return NextResponse.json({ error: msg }, { status: 503 });
    }
    if (err instanceof Error && !("status" in err)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return authErrorToResponse(err);
  }
}
