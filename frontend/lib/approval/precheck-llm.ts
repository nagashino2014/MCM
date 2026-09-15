/**
 * 상신 전 AI 검토(AX-P3, 서버) — 규칙 엔진이 못 잡는 정성 검토를 LLM 으로 보조.
 * ①필드/본문 일관성·사규 위반 소지 ②유사 과거 문서(같은 양식 승인/반려·반려 사유) 제시로 반려 예방.
 * 비용 통제: "AI 검토" 버튼 수동 실행(§8-4). 휴먼 인 더 루프 — 참고용, 상신 강제 아님.
 * 유사 문서는 pgvector 대신 같은 양식 최근 문서를 LLM 에 제시(임베딩 의존 회피). 설계: §9-4.
 */
import { getDb, rowsToObjects } from "@/lib/db";
import { parseFields } from "@/lib/approval/fields";
import { anthropicChatJson, LlmError } from "@/lib/ai/llm-json";
import type { PrecheckFinding } from "@/lib/approval/precheck";

const PRECHECK_MODEL = "claude-haiku-4-5-20251001";

export interface SimilarDoc {
  title: string;
  status: string; // approved | rejected
  reason: string | null;
  note: string; // LLM 이 붙인 관련성 코멘트
}
export interface LlmPrecheckResult {
  findings: PrecheckFinding[];
  similar: SimilarDoc[];
  llmAvailable: boolean;
  error?: string;
}

function valuesToText(fields: ReturnType<typeof parseFields>, values: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const f of fields) {
    if (f.type === "static") continue;
    const v = values[f.key];
    if (v == null || v === "") continue;
    let text: string;
    if (typeof v === "object") {
      if (Array.isArray(v)) text = `${v.length}개`;
      else {
        const o = v as { name?: string; from?: string; to?: string };
        text = o.name ?? (o.from || o.to ? `${o.from ?? "?"}~${o.to ?? "?"}` : JSON.stringify(v).slice(0, 60));
      }
    } else if (f.type === "multitext") {
      // G3: 리치 에디터 도입으로 HTML 저장 — 태그를 벗겨 텍스트만 LLM 에 제시
      text = String(v).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    } else text = String(v);
    lines.push(`${f.label}: ${text}`);
  }
  return lines.join("\n");
}

export async function runLlmCheck(docId: string): Promise<LlmPrecheckResult> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT d.title, d.field_values, d.form_id, d.form_version, f.name AS form_name,
              COALESCE(v.fields, f.fields) AS render_fields
         FROM approval_docs d
         JOIN approval_forms f ON f.form_id = d.form_id
         LEFT JOIN approval_form_versions v ON v.form_id = d.form_id AND v.version = d.form_version
        WHERE d.doc_id = $1`,
      [docId]
    )
  );
  if (!rows.length) return { findings: [], similar: [], llmAvailable: true, error: "문서를 찾을 수 없습니다." };
  const r = rows[0];
  const fields = parseFields(r.render_fields);
  let values: Record<string, unknown> = {};
  try {
    const v = typeof r.field_values === "string" ? JSON.parse(r.field_values) : r.field_values;
    if (v && typeof v === "object") values = v as Record<string, unknown>;
  } catch {
    // 무시
  }
  const currentText = valuesToText(fields, values);

  // 같은 양식 최근 문서(승인/반려) — 반려는 사유 포함. 유사 판단·전례 근거로 LLM 에 제시.
  const pastRows = rowsToObjects(
    await db.exec(
      `SELECT d.doc_id, d.title, d.status, d.field_values,
              (SELECT s.comment FROM approval_steps s WHERE s.doc_id = d.doc_id AND s.status = 'rejected' ORDER BY s.acted_at DESC LIMIT 1) AS reject_reason
         FROM approval_docs d
        WHERE d.form_id = $1 AND d.doc_id <> $2 AND d.status IN ('approved','rejected')
        ORDER BY d.completed_at DESC NULLS LAST LIMIT 12`,
      [String(r.form_id), docId]
    )
  );
  const pastList = pastRows.map((p, i) => {
    let fv: Record<string, unknown> = {};
    try {
      const v = typeof p.field_values === "string" ? JSON.parse(p.field_values) : p.field_values;
      if (v && typeof v === "object") fv = v as Record<string, unknown>;
    } catch {
      // 무시
    }
    const brief = valuesToText(fields, fv).split("\n").slice(0, 4).join(" / ");
    const status = String(p.status) === "rejected" ? "반려" : "승인";
    const reason = p.reject_reason != null ? String(p.reject_reason) : "";
    return `#${i + 1} [${status}] ${p.title} — ${brief}${reason ? ` (반려사유: ${reason})` : ""}`;
  });

  const system =
    "당신은 한국 기업의 전자결재 사전검토 보조자입니다. 상신 전 문서의 위험을 점검합니다. " +
    "확실한 근거가 있을 때만 지적하고, 추측성 지적은 하지 마세요. 반드시 지정한 JSON 만 출력합니다.";
  const user =
    `[양식] ${r.form_name}\n[제목] ${r.title}\n[이번 문서]\n${currentText}\n\n` +
    (pastList.length ? `[같은 양식 과거 문서]\n${pastList.join("\n")}\n\n` : "") +
    `점검 관점: 항목 간 불일치(기간 역전·금액 불일치), 사규/정책 위반 소지, 과거 반려 사유와 유사한 위험.\n` +
    `다음 JSON 으로만 답하세요:\n` +
    `{"findings":[{"level":"warn|info","message":"지적(한 줄)","source":"consistency|policy|precedent"}],` +
    `"similar":[{"index":과거문서번호,"note":"이번 문서와의 관련성/주의점"}]}`;

  try {
    const out = await anthropicChatJson<{ findings?: unknown; similar?: unknown }>({
      feature: "approval.precheck",
      subject: { type: "approval_doc", id: docId },
      system,
      user,
      model: PRECHECK_MODEL,
      maxTokens: 900,
      timeoutMs: 20000,
    });
    const findings: PrecheckFinding[] = Array.isArray(out.findings)
      ? (out.findings as Record<string, unknown>[])
          .map((x) => ({
            level: (String(x?.level) === "warn" ? "warn" : "info") as PrecheckFinding["level"],
            message: String(x?.message ?? "").trim(),
            source: `ai:${String(x?.source ?? "review")}`,
          }))
          .filter((x) => x.message)
      : [];
    const similar: SimilarDoc[] = Array.isArray(out.similar)
      ? (out.similar as Record<string, unknown>[])
          .map((x) => {
            const idx = Number(x?.index);
            const p = Number.isFinite(idx) && idx >= 1 && idx <= pastRows.length ? pastRows[idx - 1] : null;
            if (!p) return null;
            return {
              title: String(p.title ?? ""),
              status: String(p.status),
              reason: p.reject_reason != null ? String(p.reject_reason) : null,
              note: String(x?.note ?? "").trim(),
            };
          })
          .filter((x): x is SimilarDoc => x != null)
          .slice(0, 4)
      : [];
    return { findings, similar, llmAvailable: true };
  } catch (err) {
    if (err instanceof LlmError && err.message === "llm_not_configured") {
      return { findings: [], similar: [], llmAvailable: false, error: "AI 검토가 설정되지 않았습니다(ANTHROPIC_API_KEY)." };
    }
    return { findings: [], similar: [], llmAvailable: true, error: err instanceof Error ? err.message : String(err) };
  }
}
