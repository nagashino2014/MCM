/**
 * 결재자 AI 요약(AX-P2) — 상신 시 1회 생성해 approval_docs.ai_summary 에 저장(파생·재생성 가능).
 * 결재자가 긴 품의서를 열지 않고 3줄 요약 + 핵심 수치 + 전례 대비 비고로 30초 내 판단하게 한다.
 * ★필드가 구조화(field_values)되어 있어 전례 통계(같은 양식·같은 업체 평균)를 근거로 넣을 수 있다(다우 대비 우위).
 * 휴먼 인 더 루프: 요약은 참고용, 원문은 항상 제공. LLM 실패 시 null(무손상). 설계: §9-3.
 */
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { parseFields, type ApprovalFieldDef } from "@/lib/approval/fields";
import { anthropicChatJson, LlmError } from "@/lib/ai/llm-json";
import { recordAuditLogInline } from "@/lib/auth/audit";

export interface DocAiSummary {
  lines: string[];
  figures: { label: string; value: string }[];
  precedent?: string | null;
  model: string;
  generatedAt: string;
}

const SUMMARY_MODEL = "claude-haiku-4-5-20251001";

/** 값 하나를 사람이 읽는 짧은 문자열로. 구조화 값(기간·업체·조직도·표)을 평탄화. */
function valueToText(type: string, v: unknown): string {
  if (v == null) return "";
  if (type === "period" && typeof v === "object") {
    const p = v as { from?: string; to?: string };
    if (p.from || p.to) return `${p.from ?? "?"} ~ ${p.to ?? "?"}`;
    return "";
  }
  if ((type === "company_select" || type === "contract_select") && typeof v === "object") {
    const o = v as { name?: string; manual?: boolean };
    return o.name ? `${o.name}${o.manual ? "(직접입력)" : ""}` : "";
  }
  if (type === "user_select") {
    const arr = Array.isArray(v) ? v : [v];
    return arr.map((x) => (x && typeof x === "object" ? String((x as { name?: string }).name ?? "") : String(x))).filter(Boolean).join(", ");
  }
  if (type === "checkbox" && Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  if (type === "table" && Array.isArray(v)) {
    return `${v.length}개 항목`;
  }
  if (typeof v === "object") {
    const o = v as { name?: string };
    return o.name ? String(o.name) : JSON.stringify(v).slice(0, 80);
  }
  return String(v);
}

/** 숫자 필드 값 파싱(콤마·통화기호 제거). */
function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** 같은 양식의 과거 승인 문서에서 숫자/통화 필드 평균을 계산해 전례 힌트 문장을 만든다. */
async function buildPrecedent(
  formId: string,
  docId: string,
  fields: ApprovalFieldDef[],
  values: Record<string, unknown>
): Promise<string | null> {
  const numFields = fields.filter((f) => f.type === "currency" || f.type === "number");
  if (!numFields.length) return null;
  // 이번 문서에서 값이 가장 큰 숫자 필드를 대표 비교 대상으로.
  let target: { key: string; label: string; value: number } | null = null;
  for (const f of numFields) {
    const n = toNumber(values[f.key]);
    if (n != null && (!target || Math.abs(n) > Math.abs(target.value))) target = { key: f.key, label: f.label, value: n };
  }
  if (!target) return null;

  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT field_values FROM approval_docs
        WHERE form_id = $1 AND status = 'approved' AND doc_id <> $2
        ORDER BY completed_at DESC NULLS LAST LIMIT 100`,
      [formId, docId]
    )
  );
  const past: number[] = [];
  for (const r of rows) {
    let fv: Record<string, unknown> = {};
    try {
      const v = typeof r.field_values === "string" ? JSON.parse(r.field_values) : r.field_values;
      if (v && typeof v === "object") fv = v as Record<string, unknown>;
    } catch {
      continue;
    }
    const n = toNumber(fv[target.key]);
    if (n != null) past.push(n);
  }
  if (past.length < 2) return null;
  const avg = past.reduce((a, b) => a + b, 0) / past.length;
  if (avg === 0) return null;
  const diffPct = Math.round(((target.value - avg) / Math.abs(avg)) * 100);
  const dir = diffPct > 0 ? `+${diffPct}%` : `${diffPct}%`;
  return `${target.label}: 이번 ${target.value.toLocaleString("ko-KR")} · 과거 승인 ${past.length}건 평균 ${Math.round(avg).toLocaleString("ko-KR")} 대비 ${dir}`;
}

/** 문서 요약을 생성해 저장한다. 실패 시 null(원문 폴백). 상신 이후 fire-and-forget 로 호출. */
export async function generateDocSummary(docId: string): Promise<DocAiSummary | null> {
  try {
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(
        `SELECT d.title, d.field_values, d.form_id, d.form_version, d.drafter_name, f.name AS form_name,
                COALESCE(v.fields, f.fields) AS render_fields
           FROM approval_docs d
           JOIN approval_forms f ON f.form_id = d.form_id
           LEFT JOIN approval_form_versions v ON v.form_id = d.form_id AND v.version = d.form_version
          WHERE d.doc_id = $1`,
        [docId]
      )
    );
    if (!rows.length) return null;
    const r = rows[0];
    const fields = parseFields(r.render_fields);
    let values: Record<string, unknown> = {};
    try {
      const v = typeof r.field_values === "string" ? JSON.parse(r.field_values) : r.field_values;
      if (v && typeof v === "object") values = v as Record<string, unknown>;
    } catch {
      // 무시
    }

    // 필드 → "라벨: 값" 텍스트(정적·빈 값 제외)
    const lines: string[] = [];
    for (const f of fields) {
      if (f.type === "static") continue;
      const t = valueToText(f.type, values[f.key]);
      if (t) lines.push(`${f.label}: ${t}`);
    }
    if (!lines.length) return null;

    const precedent = await buildPrecedent(String(r.form_id), docId, fields, values);

    const system =
      "당신은 한국 기업의 전자결재 검토 보조자입니다. 결재자가 30초 안에 판단하도록 간결한 한국어 요약을 만듭니다. " +
      "과장·추측 없이 문서에 있는 사실만 사용하세요. 반드시 지정한 JSON 형식만 출력합니다.";
    const user =
      `[양식] ${r.form_name}\n[제목] ${r.title}\n[기안자] ${r.drafter_name ?? "-"}\n[내용]\n${lines.join("\n")}\n` +
      (precedent ? `\n[전례 통계]\n${precedent}\n` : "") +
      `\n다음 JSON 으로만 답하세요:\n` +
      `{"lines":["핵심 요약 1","2","3(최대 3줄, 각 40자 내외)"],` +
      `"figures":[{"label":"금액/기간/대상 등","value":"값"}],` +
      `"precedent":"전례 대비 한 줄 비고(없으면 빈 문자열)"}`;

    const out = await anthropicChatJson<{ lines?: unknown; figures?: unknown; precedent?: unknown }>({
      system,
      user,
      model: SUMMARY_MODEL,
      maxTokens: 700,
      timeoutMs: 15000,
    });

    const summary: DocAiSummary = {
      lines: Array.isArray(out.lines) ? out.lines.map((x) => String(x)).filter(Boolean).slice(0, 3) : [],
      figures: Array.isArray(out.figures)
        ? (out.figures as Record<string, unknown>[])
            .map((x) => ({ label: String(x?.label ?? ""), value: String(x?.value ?? "") }))
            .filter((x) => x.label && x.value)
            .slice(0, 6)
        : [],
      precedent: out.precedent != null && String(out.precedent).trim() ? String(out.precedent).trim() : precedent,
      model: SUMMARY_MODEL,
      generatedAt: new Date().toISOString(),
    };
    if (!summary.lines.length && !summary.figures.length) return null;

    await withDbWrite(async (w) => {
      await w.run(`UPDATE approval_docs SET ai_summary = $2::jsonb WHERE doc_id = $1`, [docId, JSON.stringify(summary)]);
      await recordAuditLogInline(w, {
        actorUserId: null,
        action: "approval_ai_summary",
        targetTable: "approval_docs",
        targetId: docId,
        after: { model: SUMMARY_MODEL, lines: summary.lines.length, figures: summary.figures.length, precedent: !!summary.precedent },
      });
    });
    return summary;
  } catch (err) {
    if (err instanceof LlmError) {
      console.warn("[approval-summary] LLM 미가용/실패", docId, err.message);
    } else {
      console.error("[approval-summary] 생성 실패", docId, err);
    }
    return null;
  }
}
