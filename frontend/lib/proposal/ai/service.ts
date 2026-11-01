/*
 * 용역 제안서 AI 수정(P1) 서버 — 범위(블록·쪽) 컨텍스트 묶음 → 게이트웨이 호출(예산·킬스위치·사용량 기록은 claudeMessages) → op 검증 → 검토할 제안.
 * AI 를 쓸 수 없으면(키 없음·꺼짐·예산·시간 초과·응답 오류) 규칙 대체안(줄이기·개조식으로)을 만들고 사유를 함께 돌려준다.
 * LLM·원장은 주입받는다(시험은 가짜로). 응답 원문은 저장하지 않는다.
 */
import type { AiFeatureKey } from "@/lib/ai/features";
import { charLen } from "@/lib/catalog/ai/patch";
import { userMessage } from "@/lib/catalog/ai/prompts";
import { ruleShorten } from "@/lib/catalog/ai/template";
import { conversions, convertBlock } from "../edit";
import { textFields } from "../find";
import { PROPOSAL_TEMPLATES } from "../templates";
import type { ProposalBlock, ProposalDocument, ProposalSection } from "../types";
import { ProposalError } from "../validate";
import { AI_ACTIONS, AI_CREATABLE, carriedNumbers, editablePaths, isExamplePage, isReadonlyBlock, validateOps, type AiAction, type AiScope, type CheckContext, type CheckedOp } from "./ops";
import { PROPOSAL_FIT_SYSTEM, PROPOSAL_REWRITE_SYSTEM } from "./prompts";

export interface LedgerItem { id: string; label: string; value: number | null; unit: string; asOf: string }
export type CallJson = <T>(feature: AiFeatureKey, system: string, user: string, opts: { maxTokens: number; timeoutMs: number; userId: string | null; subject: { type: string; id: string } | null }) => Promise<T>;
export interface ProposalAiDeps { callJson: CallJson; loadLedger: () => Promise<LedgerItem[]> }

export interface ProposeInput {
  /** 검증된 문서(요청한 쪽 하나만 담긴 것도 된다) */
  doc: ProposalDocument;
  sectionId: string;
  scope: AiScope;
  blockId?: string;
  action: AiAction;
  instruction: string;
  neighbors?: { prev?: string; next?: string };
  userId: string | null;
}
export interface ProposalAiResult {
  source: "ai" | "rule";
  /** 규칙으로 대체한 사유 */
  fallback?: string;
  summary: string;
  notes: string[];
  ops: CheckedOp[];
  dropped: string[];
}

// 회사소개서 P6 와 같은 사유 표(그 모듈은 렌더·DB 를 함께 불러와 여기서는 옮겨 쓴다).
const FALLBACK_LABEL: Array<[RegExp, string]> = [
  [/llm_not_configured/, "AI 키가 설정되지 않았습니다"],
  [/llm_feature_disabled/, "관리 화면에서 이 AI 기능을 껐습니다"],
  [/llm_budget_exceeded/, "AI 사용 예산 한도에 걸렸습니다"],
  [/llm_timeout|AbortError/, "AI 응답 시간이 초과됐습니다"],
  [/llm_parse_failed|llm_truncated/, "AI 응답을 읽지 못했습니다"],
  [/llm_refusal/, "AI 가 요청을 거절했습니다"],
  [/llm_http_/, "AI 호출이 실패했습니다"],
];
export function fallbackReason(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return FALLBACK_LABEL.find(([re]) => re.test(msg))?.[1] ?? "AI 호출이 실패했습니다";
}

const fmtNumber = (v: number) => [String(v), v.toLocaleString("en-US")];

/** 범위 확인 — 고칠 것이 없거나 읽기 전용이면 LLM 을 부르지 않고 알린다. */
function targetOf(doc: ProposalDocument, input: Pick<ProposeInput, "sectionId" | "scope" | "blockId">): { section: ProposalSection; block?: ProposalBlock } {
  const section = doc.sections.find((s) => s.id === input.sectionId);
  if (!section) throw new ProposalError("고칠 쪽을 찾지 못했습니다.", 400);
  if (isExamplePage(section)) throw new ProposalError("'제안 적용 예시' 쪽은 실제 실적처럼 보이지 않도록 AI 로 고치지 않습니다. 직접 고쳐 주세요.", 400);
  if (input.scope === "block") {
    const block = section.blocks.find((b) => b.id === input.blockId);
    if (!block) throw new ProposalError("고칠 블록을 찾지 못했습니다.", 400);
    if (isReadonlyBlock(section, block)) throw new ProposalError("성명이 들어가는 표는 AI 로 고치지 않습니다. 직접 채워 주세요.", 400);
    if (!editablePaths(section, block).length) throw new ProposalError("이 블록에는 AI 가 고칠 수 있는 글이 없습니다([작성 필요] 칸과 수치 칸은 직접 채웁니다).", 400);
    return { section, block };
  }
  if (!section.blocks.some((b) => editablePaths(section, b).length) && !section.title) throw new ProposalError("이 쪽에는 AI 가 고칠 수 있는 글이 없습니다.", 400);
  return { section };
}

function contextFor(doc: ProposalDocument, input: ProposeInput, ledger: LedgerItem[]): CheckContext {
  const v = doc.variables;
  const texts = [
    ...textFields(doc).map((f) => f.value),
    input.instruction, v?.clientNotes ?? "",
    ...ledger.flatMap((m) => (m.value == null ? [] : fmtNumber(m.value))),
  ];
  return { carried: carriedNumbers(texts), linkNames: new Set(["client", "projectName", "siteName", "duration", "companyName"]), client: doc.client, action: input.action };
}

/** LLM 에게 주는 블록 — 그림 데이터는 빼고, 고칠 수 있는 칸과 통째 바꾸기 가능 여부를 붙인다 */
function blockForLlm(s: ProposalSection, b: ProposalBlock, focus: boolean) {
  const { id, ...content } = b;
  if (content.kind === "image") (content as { dataUrl?: string }).dataUrl = "(그림)";
  const paths = editablePaths(s, b);
  const whole = AI_CREATABLE.includes(b.kind) && paths.length > 0 && !JSON.stringify(b).includes("[작성 필요]") && !isReadonlyBlock(s, b);
  return { id, kind: b.kind, ...(focus ? { focus: true } : {}), ...(isReadonlyBlock(s, b) ? { readonly: true } : {}), editablePaths: paths, wholeReplace: whole, content };
}

/** 규칙 대체안 — 줄이기(뒤 문장·괄호부터), 개조식으로(내용 유지 모양 바꾸기). 나머지 지시는 규칙이 없다. */
export function ruleOps(doc: ProposalDocument, input: Pick<ProposeInput, "sectionId" | "scope" | "blockId" | "action">): unknown[] {
  const s = doc.sections.find((x) => x.id === input.sectionId);
  if (!s) return [];
  const blocks = s.blocks.filter((b) => (input.scope === "block" ? b.id === input.blockId : true));
  if (input.action === "shorten") {
    return blocks.flatMap((b) => editablePaths(s, b).flatMap((path) => {
      const text = path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], b);
      if (typeof text !== "string" || charLen(text) < 24) return [];
      const next = ruleShorten(text, Math.floor(charLen(text) * 0.8));
      return next && next !== text ? [{ op: "set", block: b.id, path, value: next }] : [];
    }));
  }
  if (input.action === "bullets") {
    return blocks.filter((b) => (input.scope === "block" ? conversions(b).includes("bullets") : b.kind === "text") && !JSON.stringify(b).includes("[작성 필요]"))
      .map((b) => { const { id: _id, ...w } = convertBlock(b, "bullets"); return { op: "replace", block: b.id, with: w }; });
  }
  return [];
}

export function createProposalAi(deps: ProposalAiDeps) {
  async function ledger(): Promise<LedgerItem[]> {
    try { return await deps.loadLedger(); } catch { return []; }
  }

  async function propose(input: ProposeInput): Promise<ProposalAiResult> {
    const instruction = (input.instruction || AI_ACTIONS.find((a) => a.id === input.action)?.instruction || "").trim().slice(0, 1000);
    if (!instruction) throw new ProposalError("무엇을 고칠지 적어 주세요.", 400);
    const { doc } = input;
    const { section, block } = targetOf(doc, input);
    const led = await ledger();
    const ctx = contextFor(doc, { ...input, instruction }, led);
    const scopeInfo = { scope: input.scope, section, blockId: block?.id };
    try {
      const template = PROPOSAL_TEMPLATES.find((t) => t.id === doc.templateId);
      const payload = {
        template: template?.label ?? doc.templateId,
        document: { title: doc.title, client: doc.client, projectName: doc.projectName, siteName: doc.variables?.siteName, duration: doc.variables?.duration, companyName: doc.variables?.companyName },
        ...(doc.variables?.clientNotes ? { clientNotes: doc.variables.clientNotes } : {}),
        scope: input.scope,
        page: {
          id: section.id, pageId: section.pageId, chapter: section.chapter, crumb: section.crumb, title: section.title, summary: section.summary,
          prevTitle: input.neighbors?.prev, nextTitle: input.neighbors?.next,
          blocks: section.blocks.map((b) => blockForLlm(section, b, b.id === block?.id)),
        },
        ledger: led.filter((m) => m.value != null).map((m) => ({ label: m.label, value: m.value, unit: m.unit, asOf: m.asOf })),
      };
      const r = await deps.callJson<{ summary?: unknown; ops?: unknown; notes?: unknown }>("proposal.rewrite", PROPOSAL_REWRITE_SYSTEM, userMessage(instruction, payload), {
        maxTokens: input.scope === "page" ? 16000 : 8000, timeoutMs: 150_000, userId: input.userId,
        subject: { type: "proposal_document", id: `${doc.id}:${section.pageId ?? section.id}` },
      });
      const { ops, dropped } = validateOps({ doc, scope: scopeInfo, ops: r.ops, ctx });
      return {
        source: "ai", summary: typeof r.summary === "string" ? r.summary.slice(0, 300) : ops.length ? "고칠 곳을 제안했습니다." : "바꿀 곳이 없다고 판단했습니다.",
        notes: Array.isArray(r.notes) ? r.notes.map(String).slice(0, 8).map((n) => n.slice(0, 300)) : [], ops, dropped,
      };
    } catch (e) {
      if (e instanceof ProposalError) throw e;
      const fallback = fallbackReason(e);
      const { ops, dropped } = validateOps({ doc, scope: scopeInfo, ops: ruleOps(doc, input), ctx });
      const hasRule = input.action === "shorten" || input.action === "bullets";
      return {
        source: "rule", fallback,
        summary: hasRule ? (ops.length ? "규칙으로 만든 제안입니다." : "규칙으로 바꿀 곳을 찾지 못했습니다.") : "이 지시는 AI 없이 만들 수 없습니다. 잠시 뒤 다시 시도하거나 직접 고쳐 주세요.",
        notes: [], ops, dropped,
      };
    }
  }

  /** 넘친 문구 줄이기 — AI 실패·초과 길이·새 숫자는 규칙 축약으로 대체 */
  async function fit(items: Array<{ key: string; text: string; maxChars: number }>, o: { userId: string | null; subject: string }): Promise<{ source: "ai" | "rule"; fallback?: string; items: Array<{ key: string; text: string }> }> {
    const list = items.slice(0, 80).map((x) => ({ key: String(x.key).slice(0, 120), text: String(x.text ?? "").slice(0, 4000), maxChars: Math.max(4, Math.min(2000, Math.floor(Number(x.maxChars) || 0))) }));
    // 줄인 글이 표식을 깨면(굵게 ** 짝, 연결 표기, [작성 필요]) 받지 않는다 — 규칙 축약도 같은 검사, 둘 다 깨면 원래 글.
    const intact = (orig: string, t: string) => ((t.match(/\*\*/g)?.length ?? 0) % 2 === 0)
      && (orig.match(/\{\{[^{}]*\}\}/g) ?? []).every((tok) => t.includes(tok)) && t.split("[작성 필요]").length === orig.split("[작성 필요]").length;
    const rule = (x: (typeof list)[number]) => { const t = ruleShorten(x.text, x.maxChars); return intact(x.text, t) ? t : x.text; };
    try {
      const r = await deps.callJson<{ items?: Array<{ key?: unknown; text?: unknown }> }>("proposal.copy_fit", PROPOSAL_FIT_SYSTEM, userMessage(null, { items: list }), { maxTokens: 4000, timeoutMs: 60_000, userId: o.userId, subject: { type: "proposal_document", id: o.subject.slice(0, 120) } });
      const got = new Map((r.items ?? []).map((x) => [String(x.key), String(x.text ?? "")]));
      return {
        source: "ai",
        items: list.map((x) => {
          const t = (got.get(x.key) ?? "").trim();
          const fresh = carriedNumbers([t]);
          const before = carriedNumbers([x.text]);
          const ok = t && charLen(t) <= Math.ceil(x.maxChars * 1.15) && [...fresh].every((n) => before.has(n)) && intact(x.text, t);
          return { key: x.key, text: ok ? t : rule(x) };
        }),
      };
    } catch (e) {
      return { source: "rule", fallback: fallbackReason(e), items: list.map((x) => ({ key: x.key, text: rule(x) })) };
    }
  }

  return { propose, fit };
}
