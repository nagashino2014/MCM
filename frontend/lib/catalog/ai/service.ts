import { AI_FEATURES, type AiFeatureKey } from "@/lib/ai/features";
import { hasClaudeApiKey } from "@/lib/ai/claude-client";
import { LlmError, anthropicChatJson } from "@/lib/ai/llm-json";
import { CATALOG_CATEGORIES, areaIndex } from "@/lib/catalog/areas";
import { buildDisplayTitle, isCompleted, projectPartyName, type CatalogProjectRow } from "@/lib/catalog/appendix";
import { sanitizeCustomAreaContent, sanitizeAreaName, CUSTOM_AREA_LIMITS, type CustomAreaContent } from "@/lib/catalog/custom-area-types";
import { pickAreaSlot } from "@/lib/catalog/custom-areas";
import { MASTER_DOC_ID, listCatalogProjects } from "@/lib/catalog/projects";
import { ICON_NAMES } from "@/lib/catalog/render/components/parts";
import { caseRow, loadCatalogRenderData } from "@/lib/catalog/render/data";
import { chooseCover } from "@/lib/catalog/render/html";
import { AREA_CONTENT, VISION_CONTENT } from "@/lib/catalog/render/master-content";
import { INFO_TYPE_META, isInfoType, type InfoBox, type InfoContent, type InfoType } from "@/lib/catalog/render/infographic/types";
import type { CatalogRenderData, EditionKind, RenderCtx } from "@/lib/catalog/render/types";
import { composePage, orderedPlan } from "@/lib/catalog/studio/compose";
import { pageState } from "@/lib/catalog/studio/doc";
import { loadStudioDoc } from "@/lib/catalog/studio/store";
import { awkwardReasons, checkLabel } from "./label-rules";
import {
  METRIC_TOKEN_RE,
  buildOutline,
  charLen,
  checkText,
  editableBlocks,
  metricBriefs,
  numbersIn,
  validatePatch,
  type CaseCandidate,
  type Flag,
  type MetricBrief,
  type PageOutline,
  type ProposedChange,
} from "./patch";
import {
  COPY_FIT_SYSTEM,
  INFO_SUGGEST_SYSTEM,
  PAGE_COMPOSE_SYSTEM,
  PROJECT_LABEL_SYSTEM,
  SECTION_WRITE_SYSTEM,
  infoTypeCatalog,
  userMessage,
} from "./prompts";
import { ruleEditOps, ruleShorten, templateArea } from "./template";

/*
 * 회사소개서 LLM 편집(P6) 서버 — 컨텍스트 묶음 → 게이트웨이 호출(예산·킬스위치·사용량 기록은 claudeMessages 가 적용) → 검증 → 검토할 제안.
 * LLM 이 없거나(키 없음·꺼짐·예산 초과) 실패하면 규칙 기반 초안(template.ts)으로 대체하고 그 사유를 함께 돌려준다.
 * 응답 원문은 저장·기록하지 않는다(사용량 로그는 형상 메타만). 쪽 내용은 저장된 편집본(스튜디오 자동 저장) 기준으로 서버가 다시 만든다.
 */

export type AiSource = "ai" | "rule";

export interface AiRunInfo {
  source: AiSource;
  /** 규칙으로 대체한 사유(사람이 읽는 말) */
  fallback?: string;
}

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

async function callJson<T>(feature: AiFeatureKey, system: string, user: string, opts: { maxTokens: number; timeoutMs: number; userId: string | null; subject: { type: string; id: string } | null }): Promise<T> {
  if (!hasClaudeApiKey()) throw new LlmError("llm_not_configured");
  return anthropicChatJson<T>({
    feature,
    // anthropicChatJson 의 기본 모델(Haiku)이 기능 기본값보다 앞서므로 기능 기본값을 명시한다(관리 화면 재지정은 게이트웨이가 우선 적용)
    model: AI_FEATURES[feature].defaultModel,
    system,
    user,
    maxTokens: opts.maxTokens,
    timeoutMs: opts.timeoutMs,
    userId: opts.userId,
    subject: opts.subject,
  });
}

// ───────────────────────── 컨텍스트 ─────────────────────────

export interface PageAiContext {
  docId: string;
  pageKey: string;
  data: CatalogRenderData;
  outline: PageOutline;
  tree: ReturnType<typeof composePage>["tree"];
  metrics: Record<string, MetricBrief>;
  candidates: CaseCandidate[];
  /** 분야 쪽이면 그 분야(계약 분류) */
  areaCategory: string | null;
}

/** 대표 실적 후보 — 그 분류의 공개 계약(지정한 대표 실적 먼저, 그다음 준공·금액 순) */
function caseCandidates(projects: CatalogProjectRow[], categories: string[], limit = 14): CaseCandidate[] {
  return projects
    .filter((p) => categories.includes(p.category) && (p.meta?.isPublic ?? true))
    .sort((a, b) => Number(Boolean(b.meta?.isFeatured)) - Number(Boolean(a.meta?.isFeatured)) || Number(isCompleted(b)) - Number(isCompleted(a)) || (b.amount ?? 0) - (a.amount ?? 0))
    .slice(0, limit)
    .map((p) => {
      const r = caseRow(p);
      return { id: p.contractId, year: r.year, title: r.title, meta: r.meta, featured: Boolean(p.meta?.isFeatured) };
    });
}

function companyBrief(data: CatalogRenderData) {
  const c = data.company;
  return {
    name: c.name,
    nameShort: c.nameShort,
    foundedYear: c.foundedYear,
    vision: c.vision,
    slogan: c.slogan,
    research: VISION_CONTENT.research,
    registrations: c.registrations.slice(0, 8),
    areas: data.areas.map((a) => a.name),
  };
}

function metricList(metrics: Record<string, MetricBrief>, relevant: string[]) {
  return Object.values(metrics).map((m) => ({
    id: m.id,
    label: m.label,
    value: m.value,
    unit: m.unit,
    definition: m.footnote.slice(0, 120),
    ...(relevant.includes(m.id) ? { relevant: true } : {}),
  }));
}

export async function loadPageContext(o: { docId: string; pageKey: string; focusId?: string | null; edition?: EditionKind }): Promise<PageAiContext> {
  const doc = await loadStudioDoc(o.docId);
  if (!doc) throw Object.assign(new Error("회사소개서 문서를 찾지 못했습니다."), { status: 404 });
  // LLM 에 보내는 자료는 늘 마스킹판(사람 이름 가운데 글자 ○) — 노드 id 는 이름 방식과 무관하다
  const opts = { edition: o.edition ?? "print", naming: "masked" as const };
  const [data, projects] = await Promise.all([loadCatalogRenderData({ ...opts, docId: o.docId }), listCatalogProjects()]);
  const cover = await chooseCover(data, []);
  const ctx: RenderCtx = { url: (k) => k, opts, docLabel: data.docLabel, fontSet: "pretendard", concept: data.theme.concept };
  const item = orderedPlan(ctx, data, cover, doc.pages).find((p) => p.key === o.pageKey);
  if (!item) throw Object.assign(new Error("그 쪽을 찾지 못했습니다(쪽 목록이 바뀌었을 수 있습니다)."), { status: 404 });
  if (item.flow || item.maxLevel < 2) throw Object.assign(new Error("자동으로 나뉘는 명단·부록 쪽은 AI 로 고치지 않습니다. 데이터 화면에서 고칩니다."), { status: 400 });
  const composed = composePage(item, pageState(doc.pages, item.key), { metrics: data.metrics });
  const m = item.key.match(/^area-([1-5])$/);
  const areaCategory = m ? CATALOG_CATEGORIES[Number(m[1]) - 1] : null;
  const outline = buildOutline(composed.tree, item, { focusId: o.focusId ?? null, casesEditable: areaCategory != null });
  return {
    docId: o.docId,
    pageKey: item.key,
    data,
    outline,
    tree: composed.tree,
    metrics: metricBriefs(data.metrics),
    candidates: areaCategory ? caseCandidates(projects, [areaCategory]) : [],
    areaCategory,
  };
}

function outlineForLlm(o: PageOutline) {
  return {
    key: o.key,
    type: o.type,
    label: o.label,
    blocks: o.blocks.map((b) => {
      if (b.kind === "text") return { id: b.id, kind: "text", role: b.role, text: b.text, maxChars: b.maxChars, ...(b.focus ? { focus: true } : {}), ...(b.readonly ? { readonly: true } : {}) };
      if (b.kind === "list") return { id: b.id, kind: "list", items: b.items, maxItems: b.maxItems, maxCharsPerItem: b.maxChars, context: b.label, ...(b.focus ? { focus: true } : {}) };
      if (b.kind === "info")
        return {
          id: b.id,
          kind: "info",
          type: b.type,
          context: b.label,
          box: b.box,
          title: b.content.title,
          center: b.content.center,
          items: b.content.items.map((it) => ({ label: it.label, ...(it.desc ? { desc: it.desc } : {}), ...(it.when ? { when: it.when } : {}), ...(it.icon ? { icon: it.icon } : {}), ...(it.metric ? { metric: it.metric } : {}), ...(it.value != null && !it.metric ? { value: it.value } : {}) })),
          ...(b.focus ? { focus: true } : {}),
        };
      return { id: b.id, kind: "cases", items: b.items, ...(b.focus ? { focus: true } : {}) };
    }),
  };
}

// ───────────────────────── 쪽 고치기(section_write) ─────────────────────────

export interface PageEditProposal extends AiRunInfo {
  pageKey: string;
  summary: string;
  notes: string[];
  changes: ProposedChange[];
  dropped: string[];
  /** 규칙 대체 때 알아들은 것·못 한 것 */
  understood?: string[];
  missed?: string[];
  /** 대표 실적 후보(미리보기용 표기) */
  candidates: CaseCandidate[];
  /** 검토 표시를 셀 때 쓰는 지표 목록(값) */
  metrics: Record<string, MetricBrief>;
}

export async function proposePageEdit(o: {
  docId?: string;
  pageKey: string;
  focusId?: string | null;
  instruction: string;
  edition?: EditionKind;
  userId: string | null;
}): Promise<PageEditProposal> {
  const docId = o.docId ?? MASTER_DOC_ID;
  const instruction = o.instruction.trim().slice(0, 1000);
  if (!instruction) throw Object.assign(new Error("무엇을 고칠지 적어 주세요."), { status: 400 });
  const pc = await loadPageContext({ docId, pageKey: o.pageKey, focusId: o.focusId, edition: o.edition });
  if (editableBlocks(pc.outline).length === 0) throw Object.assign(new Error("이 쪽에는 AI 로 고칠 수 있는 글·목록·인포그래픽이 없습니다."), { status: 400 });
  const base = { pageKey: pc.pageKey, candidates: pc.candidates, metrics: pc.metrics };
  const relevant = pc.areaCategory ? [`projects.area.${areaIndex(pc.areaCategory)}`] : [];
  try {
    const payload = {
      page: outlineForLlm(pc.outline),
      ...(pc.areaCategory ? { area: { category: pc.areaCategory, name: pc.data.areas.find((a) => a.category === pc.areaCategory)?.name } } : {}),
      metrics: metricList(pc.metrics, relevant),
      ...(pc.candidates.length ? { caseCandidates: pc.candidates.map((c) => ({ id: c.id, year: c.year, title: c.title, featured: c.featured })) } : {}),
      company: companyBrief(pc.data),
      infographicTypes: infoTypeCatalog(),
      icons: ICON_NAMES,
    };
    const r = await callJson<{ summary?: unknown; ops?: unknown; notes?: unknown }>("catalog.section_write", SECTION_WRITE_SYSTEM, userMessage(instruction, payload), {
      // Opus 5 는 기본으로 생각(adaptive)하므로 출력 여유를 둔다
      maxTokens: 12000,
      timeoutMs: 150_000,
      userId: o.userId,
      subject: { type: "catalog_page", id: `${docId}:${pc.pageKey}` },
    });
    const { changes, dropped } = validatePatch({ outline: pc.outline, tree: pc.tree, ops: r.ops, metrics: pc.metrics, candidates: pc.candidates, source: "ai" });
    return {
      ...base,
      source: "ai",
      summary: typeof r.summary === "string" ? r.summary.slice(0, 300) : "",
      notes: Array.isArray(r.notes) ? r.notes.filter((n): n is string => typeof n === "string").map((n) => n.slice(0, 200)).slice(0, 6) : [],
      changes,
      dropped,
    };
  } catch (e) {
    if (!(e instanceof LlmError)) throw e;
    const rule = ruleEditOps(pc.outline, instruction, pc.metrics);
    const { changes, dropped } = validatePatch({ outline: pc.outline, tree: pc.tree, ops: rule.ops, metrics: pc.metrics, candidates: pc.candidates, source: "rule" });
    return { ...base, source: "rule", fallback: fallbackReason(e), summary: rule.understood.join(" · "), notes: [], changes, dropped, understood: rule.understood, missed: rule.missed };
  }
}

// ───────────────────────── 넘침 줄이기(copy_fit) ─────────────────────────

export interface FitItem {
  key: string;
  text: string;
  maxChars: number;
}

export interface FitResult extends AiRunInfo {
  items: Array<{ key: string; text: string; flags: Flag[]; source: AiSource }>;
}

/** 줄인 글 검사 — 지표 표식은 원래 것만, 새 숫자 없음, 원래보다 짧음 */
function checkFit(orig: FitItem, text: string, metrics: Record<string, MetricBrief>): { ok: boolean; text: string; flags: Flag[] } {
  const { text: t, flags } = checkText(text, orig.maxChars, { metrics, carried: numbersIn([orig.text]) });
  const tokens = (s: string) => [...s.matchAll(METRIC_TOKEN_RE)].map((m) => m[1]).sort().join(",");
  const lost = tokens(orig.text) !== tokens(t);
  const longer = charLen(t, metrics) >= charLen(orig.text, metrics);
  const bad = flags.some((f) => f.severity === "review") || lost || longer || !t;
  return { ok: !bad, text: t, flags: lost ? [...flags, { kind: "metric", severity: "review", message: "지표 칩이 바뀌어 규칙으로 줄였습니다." }] : flags };
}

export async function fitTexts(o: { items: FitItem[]; userId: string | null; subject?: { type: string; id: string } | null; metrics?: Record<string, MetricBrief> }): Promise<FitResult> {
  const items = o.items.slice(0, 30).map((it) => ({ key: String(it.key).slice(0, 60), text: String(it.text ?? "").slice(0, 600), maxChars: Math.max(4, Math.min(400, Math.round(Number(it.maxChars) || 0))) }));
  const metrics = o.metrics ?? {};
  const rule = (it: FitItem) => ({ key: it.key, text: ruleShorten(it.text, it.maxChars, metrics), flags: [] as Flag[], source: "rule" as const });
  try {
    const r = await callJson<{ items?: Array<{ key?: unknown; text?: unknown }> }>("catalog.copy_fit", COPY_FIT_SYSTEM, userMessage(null, { items }), {
      maxTokens: 3000,
      timeoutMs: 45_000,
      userId: o.userId,
      subject: o.subject ?? null,
    });
    const got = new Map((Array.isArray(r.items) ? r.items : []).map((x) => [String(x.key), typeof x.text === "string" ? x.text : ""]));
    return {
      source: "ai",
      items: items.map((it) => {
        const t = got.get(it.key);
        if (!t) return rule(it);
        const c = checkFit(it, t, metrics);
        return c.ok ? { key: it.key, text: c.text, flags: c.flags, source: "ai" as const } : { ...rule(it), flags: c.flags.filter((f) => f.kind === "metric") };
      }),
    };
  } catch (e) {
    if (!(e instanceof LlmError)) throw e;
    return { source: "rule", fallback: fallbackReason(e), items: items.map(rule) };
  }
}

// ───────────────────────── 인포그래픽 순위(infographic_suggest) ─────────────────────────

export interface RankCandidate {
  type: InfoType;
  label: string;
  score: number;
  reason: string;
}

export interface RankResult extends AiRunInfo {
  ranking: Array<{ type: InfoType; reason: string; source: AiSource }>;
}

export async function rankInfographic(o: { content: InfoContent; box: InfoBox; current: InfoType; candidates: RankCandidate[]; userId: string | null; slot?: string }): Promise<RankResult> {
  const cands = o.candidates.filter((c) => isInfoType(c.type)).slice(0, 6);
  const rule = (): RankResult["ranking"] => cands.map((c) => ({ type: c.type, reason: c.reason, source: "rule" as const }));
  if (cands.length < 2) return { source: "rule", ranking: rule() };
  try {
    const payload = {
      content: { title: o.content.title, center: o.content.center?.label, items: o.content.items.slice(0, 12).map((it) => ({ label: it.label, ...(it.desc ? { desc: it.desc } : {}), ...(it.when ? { when: it.when } : {}), ...(it.value != null || it.metric ? { numeric: true } : {}) })) },
      slot: { widthPt: Math.round(o.box.w), heightPt: Math.round(o.box.h) },
      current: o.current,
      candidates: cands.map((c) => ({ type: c.type, label: c.label, ruleScore: c.score, ruleReason: c.reason, use: INFO_TYPE_META[c.type].use })),
    };
    const r = await callJson<{ ranking?: Array<{ type?: unknown; reason?: unknown }> }>("catalog.infographic_suggest", INFO_SUGGEST_SYSTEM, userMessage(null, payload), {
      maxTokens: 600,
      timeoutMs: 20_000,
      userId: o.userId,
      subject: o.slot ? { type: "catalog_slot", id: o.slot } : null,
    });
    const allowed = new Set(cands.map((c) => c.type));
    const seen = new Set<InfoType>();
    const ranking: RankResult["ranking"] = [];
    for (const x of Array.isArray(r.ranking) ? r.ranking : []) {
      const t = String(x.type) as InfoType;
      if (!allowed.has(t) || seen.has(t)) continue;
      seen.add(t);
      let reason = typeof x.reason === "string" ? x.reason.replace(/\s+/g, " ").trim().slice(0, 40) : "";
      // 이유에도 숫자·최상급을 들이지 않는다 — 걸리면 규칙 이유로
      if (!reason || /\d/.test(reason) || checkText(reason, 40, { metrics: {}, carried: new Set() }).flags.some((f) => f.kind === "superlative")) reason = cands.find((c) => c.type === t)!.reason;
      ranking.push({ type: t, reason, source: "ai" });
    }
    if (ranking.length === 0) return { source: "rule", fallback: "AI 응답에 쓸 수 있는 순위가 없었습니다", ranking: rule() };
    for (const c of cands) if (!seen.has(c.type)) ranking.push({ type: c.type, reason: c.reason, source: "rule" });
    return { source: "ai", ranking };
  } catch (e) {
    if (!(e instanceof LlmError)) throw e;
    return { source: "rule", fallback: fallbackReason(e), ranking: rule() };
  }
}

// ───────────────────────── 새 사업 분야(page_compose) ─────────────────────────

export type AreaPartKey = "lead" | "services" | "process" | "kpis" | "featured" | "hero";

export interface AreaPart {
  key: AreaPartKey;
  label: string;
  /** AI 제안(없으면 규칙 초안과 같음) */
  ai: string[];
  rule: string[];
  flags: Flag[];
}

export interface AreaProposal extends AiRunInfo {
  name: string;
  /** AI 제안(규칙 초안 위에 얹은 것) */
  content: CustomAreaContent;
  /** 규칙 초안(부분 채택에서 AI 제안을 빼면 이 값) */
  rule: CustomAreaContent;
  parts: AreaPart[];
  notes: string[];
  slot: number;
  /** 빈 분야 색이 없어 관련 분류의 색을 같이 씀 */
  sharedSlot: boolean;
  candidates: CaseCandidate[];
  metrics: Record<string, MetricBrief>;
}

function partLines(c: CustomAreaContent, key: AreaPartKey, metrics: Record<string, MetricBrief>, candidates: CaseCandidate[]): string[] {
  const rd = (t: string) => t.replace(METRIC_TOKEN_RE, (_, id: string) => (metrics[id] ? `${metrics[id].value ?? "-"}` : "-"));
  switch (key) {
    case "lead":
      return [rd(c.lead)];
    case "services":
      return c.services.map(rd);
    case "process":
      return [`${c.processTitle} · ${INFO_TYPE_META[c.infoType]?.label ?? c.infoType}`, ...c.process.map((p, i) => `${i + 1}. ${p.label}${p.desc ? ` — ${p.desc}` : ""}`)];
    case "kpis":
      return c.kpis.map((id) => `${metrics[id]?.label ?? id} ${metrics[id]?.value ?? "-"}${metrics[id]?.unit ?? ""}`);
    case "featured":
      return c.featured.map((id) => candidates.find((x) => x.id === id)).filter(Boolean).map((x) => `${x!.year} ${x!.title}`);
    case "hero":
      return [`${c.icon} · ${rd(c.heroCaption)}`];
  }
}

const PART_LABEL: Record<AreaPartKey, string> = { lead: "리드 문장", services: "주요 서비스", process: "수행 절차(인포그래픽)", kpis: "KPI 지표", featured: "대표 실적", hero: "아이콘·큰 숫자 설명" };

/** 부분 채택 — 고른 부분만 AI 제안, 나머지는 규칙 초안 */
export function mergeAreaParts(ai: CustomAreaContent, rule: CustomAreaContent, accepted: AreaPartKey[]): CustomAreaContent {
  const pick = new Set(accepted);
  const out: CustomAreaContent = { ...rule };
  if (pick.has("lead")) out.lead = ai.lead;
  if (pick.has("services")) out.services = ai.services;
  if (pick.has("process")) {
    out.process = ai.process;
    out.processTitle = ai.processTitle;
    out.infoType = ai.infoType;
  }
  if (pick.has("kpis")) out.kpis = ai.kpis;
  if (pick.has("featured")) out.featured = ai.featured;
  if (pick.has("hero")) {
    out.icon = ai.icon;
    out.heroCaption = ai.heroCaption;
  }
  out.source = pick.size === 0 ? "rule" : pick.size === 6 ? "ai" : "mixed";
  return out;
}

export async function proposeNewArea(o: { name: string; memo: string; categories: string[]; userId: string | null }): Promise<AreaProposal> {
  const name = sanitizeAreaName(o.name);
  if (!name) throw Object.assign(new Error("분야 이름을 입력해 주세요."), { status: 400 });
  const memo = String(o.memo ?? "").slice(0, 1500);
  const categories = o.categories.filter((c) => (CATALOG_CATEGORIES as readonly string[]).includes(c)).slice(0, 3);
  const [data, projects] = await Promise.all([loadCatalogRenderData({ edition: "print", naming: "masked" }), listCatalogProjects()]);
  if (data.areas.some((a) => a.name === name) || data.customAreas.some((a) => a.name === name)) throw Object.assign(new Error(`'${name}' 분야가 이미 있습니다.`), { status: 409 });
  const metrics = metricBriefs(data.metrics);
  const candidates = caseCandidates(projects, categories.length ? categories : [CATALOG_CATEGORIES[4]], 16);
  const rule = templateArea({ name, memo, categories, metrics, candidates });
  const { slot, shared } = await pickAreaSlot(categories);
  const base = { name, rule, slot, sharedSlot: shared, candidates, metrics };
  const carried = numbersIn([memo]);
  const ctx = { metrics, carried };
  const parts = (content: CustomAreaContent, flags: Partial<Record<AreaPartKey, Flag[]>>): AreaPart[] =>
    (Object.keys(PART_LABEL) as AreaPartKey[]).map((key) => ({
      key,
      label: PART_LABEL[key],
      ai: partLines(content, key, metrics, candidates),
      rule: partLines(rule, key, metrics, candidates),
      flags: flags[key] ?? [],
    }));
  try {
    const example = categories[0] && AREA_CONTENT[categories[0]] ? categories[0] : "ESG·탄소중립";
    const ex = AREA_CONTENT[example];
    const payload = {
      newArea: { name, memo, relatedCategories: categories },
      metrics: metricList(metrics, categories.map((c) => `projects.area.${areaIndex(c)}`)),
      caseCandidates: candidates.map((c) => ({ id: c.id, year: c.year, title: c.title })),
      company: companyBrief(data),
      exampleArea: { name: example, lead: ex.lead, services: ex.services, processTitle: ex.processTitle, process: ex.process },
      infographicTypes: infoTypeCatalog().filter((t) => ["process", "cycle", "pillars", "cards", "iconGrid"].includes(String(t.type))),
      icons: ICON_NAMES,
    };
    const r = await callJson<Record<string, unknown>>("catalog.page_compose", PAGE_COMPOSE_SYSTEM, userMessage(`새 사업 분야 '${name}' 쪽을 구성하세요.`, payload), {
      maxTokens: 10000,
      timeoutMs: 150_000,
      userId: o.userId,
      subject: { type: "catalog_area", id: name },
    });
    const flags: Partial<Record<AreaPartKey, Flag[]>> = {};
    const add = (k: AreaPartKey, list: Flag[], prefix = "") => (flags[k] = [...(flags[k] ?? []), ...list.map((f) => ({ ...f, message: prefix + f.message }))]);
    const lead = checkText(String(r.lead ?? ""), 150, ctx);
    add("lead", lead.flags);
    const services = (Array.isArray(r.services) ? r.services : []).slice(0, 6).map((sv, i) => {
      const c = checkText(String(sv ?? ""), 28, ctx);
      add("services", c.flags, `${i + 1}번: `);
      return c.text;
    });
    const process = (Array.isArray(r.process) ? r.process : []).slice(0, 6).map((raw, i) => {
      const st = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      const l = checkText(String(st.label ?? ""), 10, ctx);
      const d = checkText(String(st.desc ?? ""), 24, ctx);
      add("process", [...l.flags, ...d.flags], `${i + 1}단계: `);
      return { label: l.text, desc: d.text };
    });
    const kpis = (Array.isArray(r.kpis) ? r.kpis : []).map(String).filter((id) => metrics[id]);
    const pool = new Set(candidates.map((c) => c.id));
    const featured = (Array.isArray(r.featured) ? r.featured : []).map(String).filter((id) => pool.has(id));
    const hero = checkText(String(r.heroCaption ?? ""), 28, ctx);
    add("hero", hero.flags);
    if (Array.isArray(r.kpis) && kpis.length < r.kpis.length) add("kpis", [{ kind: "metric", severity: "note", message: "목록에 없는 지표는 뺐습니다." }]);
    if (Array.isArray(r.featured) && featured.length < r.featured.length) add("featured", [{ kind: "case", severity: "note", message: "후보에 없는 실적은 뺐습니다." }]);
    const icon = typeof r.icon === "string" && ICON_NAMES.includes(r.icon) ? r.icon : rule.icon;
    const content = sanitizeCustomAreaContent({
      ...rule,
      lead: lead.text || rule.lead,
      services: services.filter(Boolean).length >= 3 ? services.filter(Boolean) : rule.services,
      processTitle: typeof r.processTitle === "string" && r.processTitle.trim() ? r.processTitle.trim().slice(0, 12) : rule.processTitle,
      process: process.filter((p) => p.label).length >= 3 ? process.filter((p) => p.label) : rule.process,
      infoType: r.infoType,
      kpis: kpis.length ? kpis.slice(0, CUSTOM_AREA_LIMITS.kpis) : rule.kpis,
      // 비운 것도 판단이다(관련 실적 없음) — 후보 밖 id 를 걸러 낸 결과가 비면 그대로 둔다
      featured: Array.isArray(r.featured) ? featured.slice(0, CUSTOM_AREA_LIMITS.featured) : rule.featured,
      heroCaption: hero.text || rule.heroCaption,
      icon,
      relatedCategories: categories,
      source: "ai",
      draft: true,
    });
    const notes = Array.isArray(r.notes) ? r.notes.filter((n): n is string => typeof n === "string").map((n) => n.slice(0, 200)).slice(0, 6) : [];
    return { ...base, source: "ai", content, parts: parts(content, flags), notes };
  } catch (e) {
    if (!(e instanceof LlmError)) throw e;
    return { ...base, source: "rule", fallback: fallbackReason(e), content: rule, parts: parts(rule, {}), notes: [] };
  }
}

// ───────────────────────── 실적 대외 표기(project_label) ─────────────────────────

export interface LabelSuggestion {
  id: string;
  category: string;
  contractTitle: string;
  ruleTitle: string;
  reasons: string[];
  suggestion: string;
  issues: string[];
  source: AiSource;
}

export interface LabelResult extends AiRunInfo {
  rows: LabelSuggestion[];
  /** 어색한 행 전체 수(이번에 보낸 것보다 많을 수 있음) */
  total: number;
}

export async function proposeLabels(o: { ids?: string[]; exclude?: string[]; limit?: number; userId: string | null }): Promise<LabelResult> {
  const projects = await listCatalogProjects();
  const want = o.ids?.length ? new Set(o.ids) : null;
  // 이미 본 묶음은 건너뛴다([다음 제안 받기])
  const skip = new Set(o.exclude ?? []);
  const awkward = projects
    .filter((p) => !p.contractId.startsWith("manual:"))
    .map((p) => ({ p, reasons: awkwardReasons(p) }))
    .filter((x) => x.reasons.length && (!want || want.has(x.p.contractId)));
  const fresh = awkward.filter((x) => !skip.has(x.p.contractId));
  const batch = (fresh.length ? fresh : awkward).slice(0, Math.max(1, Math.min(30, o.limit ?? 20)));
  const rows = batch.map(({ p, reasons }) => {
    const anonymized = p.meta ? !p.meta.isPublic : false;
    const party = anonymized ? "○○사" : projectPartyName(p.counterpartyName, p.siteName);
    // 비공개 고객은 계약명 속 이름도 지워 보낸다
    const contractTitle = anonymized && p.counterpartyName.trim() ? p.contractTitle.replace(p.counterpartyName.trim(), "○○사") : p.contractTitle;
    return { p, reasons, anonymized, party, contractTitle, ruleTitle: buildDisplayTitle(p) };
  });
  const rule = (x: (typeof rows)[number]): LabelSuggestion => ({
    id: x.p.contractId,
    category: x.p.category,
    contractTitle: x.contractTitle,
    ruleTitle: x.ruleTitle,
    reasons: x.reasons,
    suggestion: x.ruleTitle,
    issues: [],
    source: "rule",
  });
  if (rows.length === 0) return { source: "rule", rows: [], total: 0 };
  try {
    const payload = {
      rows: rows.map((x) => ({ id: x.p.contractId, category: x.p.category, contractTitle: x.contractTitle, party: x.party, site: x.anonymized ? "" : x.p.siteName, year: x.p.year, ruleTitle: x.ruleTitle, problems: x.reasons })),
    };
    const r = await callJson<{ items?: Array<{ id?: unknown; title?: unknown }> }>("catalog.project_label", PROJECT_LABEL_SYSTEM, userMessage(null, payload), {
      maxTokens: 3000,
      timeoutMs: 60_000,
      userId: o.userId,
      subject: { type: "catalog_projects", id: `${rows.length} rows` },
    });
    const got = new Map((Array.isArray(r.items) ? r.items : []).map((x) => [String(x.id), typeof x.title === "string" ? x.title : ""]));
    return {
      source: "ai",
      total: awkward.length,
      rows: rows.map((x) => {
        const t = got.get(x.p.contractId);
        if (!t) return rule(x);
        const c = checkLabel(t, { contractTitle: x.contractTitle, party: x.party, site: x.anonymized ? "" : x.p.siteName, anonymized: x.anonymized, partyName: x.p.counterpartyName.trim() });
        return { ...rule(x), suggestion: c.title, issues: c.issues, source: "ai" };
      }),
    };
  } catch (e) {
    if (!(e instanceof LlmError)) throw e;
    return { source: "rule", fallback: fallbackReason(e), total: awkward.length, rows: rows.map(rule) };
  }
}
