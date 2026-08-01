import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { anthropicChatJson, LlmError } from "@/lib/ai/llm-json";
import { formatMetricValue, parseMetricDefinition, validateDefinition, type MetricResult } from "@/lib/analytics/metric-types";
import { getMetric, listMetrics } from "@/lib/analytics/metric-store";
import { runMetric } from "@/lib/analytics/metric-engine";
import { listSemanticConcepts } from "@/lib/approval/semantic-concepts-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * 자연어 리포팅(NLQ) — AX-P5 를 지표 엔진 위의 어댑터로 통합(§8-1 확정: 별도 구현 없음).
 * 흐름: 질문 → LLM 이 "기존 지표 선택 또는 임시 정의 생성"(선언 JSON 선택만, 자유 SQL 금지)
 *       → 엔진 즉석 실행(저장 안 함) → 결과 + 코드 생성 해설(LLM 재호출 없음 — 비용 통제).
 * 권한: reports.nlq(120, 기본 미부여 — RBAC 화면에서 선별 부여). 결재 운영자(approval.manage,
 * 시스템 관리자 포함)는 별도 부여 없이 사용 가능 — 보드의 질문창 노출 판정(analytics GET)과 동일 기준.
 */

async function requireNlq() {
  try {
    return await requirePermission("reports.nlq");
  } catch {
    return await requirePermission("approval.manage");
  }
}

function buildAnswer(r: MetricResult): string {
  if (!r.rows.length) {
    const why = Object.entries(r.diagnostics.excluded)
      .map(([k, v]) => `${k} ${v}건`)
      .join(", ");
    return `조건에 맞는 데이터가 아직 없습니다.${why ? ` (제외: ${why})` : ""}`;
  }
  const valid = r.rows.filter((x) => x.value != null);
  if (!valid.length) return "값이 계산된 그룹이 없습니다.";
  if (r.hasTime) {
    const times = [...new Set(valid.map((x) => x.time).filter(Boolean))].sort();
    const last = times[times.length - 1];
    const lastSum = valid.filter((x) => x.time === last).reduce((a, x) => a + (x.value ?? 0), 0);
    return `${times.length}개 기간 중 최근(${last}) 합계는 ${formatMetricValue(lastSum, r.format)}입니다.`;
  }
  const top = [...valid].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];
  const sum = valid.reduce((a, x) => a + (x.value ?? 0), 0);
  return `${valid.length}개 그룹 중 가장 큰 값은 ${top.groupLabel}(${formatMetricValue(top.value, r.format)})입니다.${
    r.format !== "percent" ? ` 전체 합계는 ${formatMetricValue(sum, r.format)}입니다.` : ""
  }`;
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireNlq();
    const body = (await req.json().catch(() => ({}))) as { question?: string };
    const question = String(body.question ?? "").trim();
    if (!question) return NextResponse.json({ error: "질문이 비어 있습니다." }, { status: 400 });

    const metrics = await listMetrics(true);
    const concepts = await listSemanticConcepts(true);
    const metricDoc = metrics.map((m) => `${m.metricKey}: ${m.label}${m.description ? ` — ${m.description}` : ""}`).join("\n");
    const conceptDoc = concepts.filter((c) => !c.auto).map((c) => `${c.key}(${c.label})`).join(", ");

    const out = await anthropicChatJson<{ metricKey?: string; label?: string; definition?: unknown }>({
      system: `너는 그룹웨어 데이터 질문 응답기다. 사용자의 한국어 질문에 답하기 위해, 아래 중 하나를 JSON 으로 출력한다. JSON 외 텍스트 금지.
1) 기존 지표가 질문에 맞으면: {"metricKey": "<기존 지표 키>"}
2) 맞는 게 없으면 임시 지표 정의 생성: {"label": "지표 이름", "definition": {...}} — definition 스키마는 집계 지표만:
{"kind":"aggregate","source":{"type":"approval_docs","forms":"auto","status":["approved"]} 또는 {"type":"system.contracts|system.participants|system.attendance|system.leave"},"measure":{"agg":"sum|avg|count|min|max|count_distinct","concept":"<태그>"(approval_docs) 또는 "field":"<필드>"(system)},"groupBy":[차원 최대 3],"timeBy":{...}(선택)}

결재 문서 값 태그: ${conceptDoc}
시스템 소스 필드: system.contracts={amount,count; dims ref.contract,dim.category,dim.subcategory,dim.amount_band}, system.participants={contract_id,duration_days,amount_percentile,amount_sum; dims ref.employee,ref.contract,dim.category,dim.subcategory,dim.amount_band}, system.attendance={overtime_hours,excess_hours,worked_hours; dims ref.employee; time week_start}, system.leave={grant_days,use_days; dims ref.employee; time year}
기존 지표:
${metricDoc}

규칙: 가능하면 기존 지표를 재사용(1번). 존재하지 않는 키·태그·필드를 지어내지 말 것.`,
      user: question,
      maxTokens: 600,
    });

    let result: MetricResult;
    let source: "existing" | "generated";
    if (out?.metricKey) {
      const item = metrics.find((m) => m.metricKey === out.metricKey);
      if (!item) return NextResponse.json({ error: `선택된 지표가 없습니다: ${out.metricKey}` }, { status: 422 });
      result = await runMetric(item, getMetric);
      source = "existing";
    } else {
      const definition = parseMetricDefinition(out?.definition);
      if (!definition) return NextResponse.json({ error: "질문을 지표로 변환하지 못했습니다. 더 구체적으로 물어보세요." }, { status: 422 });
      const verr = validateDefinition(definition);
      if (verr) return NextResponse.json({ error: `생성된 정의가 검증에 실패했습니다: ${verr}` }, { status: 422 });
      result = await runMetric({ metricKey: "__nlq__", label: String(out?.label ?? "질문 결과"), definition }, getMetric);
      source = "generated";
    }

    await recordAuditLog({
      actorUserId: actor.userId,
      action: "approval_metric_update",
      targetTable: "metric_definitions",
      targetId: "__nlq__",
      after: { question: question.slice(0, 200), source },
    });
    return NextResponse.json({ result, answer: buildAnswer(result), source });
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
