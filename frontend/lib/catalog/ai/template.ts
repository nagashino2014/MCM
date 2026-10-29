/*
 * 회사소개서 LLM 편집(P6)의 규칙 기반 대체안(template_draft 패턴, 블루프린트 §7-3) — LLM 이 없거나(키 없음·킬스위치·예산) 실패해도 동작한다.
 * 클라이언트 안전(순수 함수). 숫자를 지어내지 않는다: 수치는 지표 id, 대표 실적은 실제 계약 후보에서만.
 *   ruleEditOps      지시문에서 인포그래픽 유형·단계 수·줄이기·분야 색 통일·일러스트(규칙 1위 후보)만 알아듣고 패치를 만든다(그 밖은 '해석하지 못함')
 *   ruleShorten      문구 줄이기(괄호 설명 빼기 → 접속 표현 줄이기 → 뒤 문장·구절 빼기)
 *   templateArea     새 사업 분야 쪽 초안(분야명·메모·관련 분류 → 리드·서비스·절차·KPI·대표 실적)
 */
import { AREA_CONTENT } from "@/lib/catalog/render/master-content";
import { INFO_TYPE_META, contentFamily, type InfoType } from "@/lib/catalog/render/infographic/types";
import { areaIndex } from "@/lib/catalog/areas";
import { CUSTOM_AREA_LIMITS, type CustomAreaContent } from "@/lib/catalog/custom-area-types";
import { METRIC_TOKEN_RE, charLen, findSuperlatives, type CaseCandidate, type InfoBlock, type MetricBrief, type OutlineBlock, type PageOutline, type PatchOp, type ShapeChoice } from "./patch";

// ───────────────────────── 줄이기 ─────────────────────────

const SOFTEN: Array<[RegExp, string]> = [
  [/\s+및\s+/g, "·"],
  [/\s*등의\s+/g, " "],
  [/\s*등을\s+/g, "을 "],
  [/을\s+통해\s+/g, "로 "],
  [/를\s+통해\s+/g, "로 "],
  [/에\s+대한\s+/g, " "],
  [/하고\s+있습니다/g, "합니다"],
  [/할\s+수\s+있도록\s+/g, "하도록 "],
  [/\s{2,}/g, " "],
];

/** 괄호 설명 빼기(지표 표식·자리표가 든 괄호는 남김) */
function dropParens(t: string): string {
  return t.replace(/\s*\(([^()]*)\)/g, (all, inner: string) => (/\{\{metric:|⟦/.test(inner) ? all : ""));
}

/** 문구를 maxChars(공백 제외, 지표는 값 길이) 안으로 — 문장이면 뒤 문장부터, 라벨이면 구분점(·, 쉼표) 앞에서 자른다 */
export function ruleShorten(text: string, maxChars: number, metrics?: Record<string, MetricBrief>): string {
  if (charLen(text.trim(), metrics) <= maxChars) return text.trim();
  // 지표 표식(지표 id 의 마침표)이 문장 나누기에 걸리지 않게 잠시 자리표 ⟦n⟧ 로 바꾼다
  const toks: string[] = [];
  const t = text.trim().replace(METRIC_TOKEN_RE, (m) => (toks.push(m), `⟦${toks.length - 1}⟧`));
  const restore = (s: string) => s.replace(/⟦(\d+)⟧/g, (_, i: string) => toks[Number(i)]);
  const fits = (s: string) => charLen(restore(s), metrics) <= maxChars;
  // 끝에 붙은 지표 표식(일러스트 제목 뒤 칩)은 떼어 두고 앞 글만 줄인 뒤 다시 붙인다
  const tail = /(\s*⟦\d+⟧)+\s*$/.exec(t)?.[0] ?? "";
  if (tail && tail.length < t.length) return restore(`${shortenProtected(t.slice(0, t.length - tail.length), (s) => fits(s + tail)).trimEnd()}${tail}`.trim());
  return restore(shortenProtected(t, fits));
}

function shortenProtected(input: string, fits: (s: string) => boolean): string {
  let t = input;
  t = dropParens(t).trim();
  if (fits(t)) return t;
  for (const [re, to] of SOFTEN) t = t.replace(re, to);
  t = t.trim();
  if (fits(t)) return t;
  const sentences = t.match(/[^.!?。]+[.!?。]?/g)?.map((x) => x.trim()).filter(Boolean) ?? [t];
  if (sentences.length > 1) {
    const kept: string[] = [];
    for (const sn of sentences) {
      if (kept.length && !fits([...kept, sn].join(" "))) break;
      kept.push(sn);
    }
    t = kept.join(" ");
    if (fits(t)) return t;
  }
  // 한 문장·라벨 — 구분점 앞에서 자르고, 그래도 길면 낱말 경계에서
  const parts = t.split(/(?<=[·,，])\s*/);
  while (parts.length > 1 && !fits(parts.join(" ").replace(/[·,，]\s*$/, ""))) parts.pop();
  t = parts.join(" ").replace(/[·,，]\s*$/, "").trim();
  if (fits(t)) return t;
  // 지표 자리표(⟦n⟧ — 일러스트 제목 뒤 칩 포함)가 든 낱말은 남기고 그 앞 낱말부터 뺀다
  const words = t.split(/\s+/);
  const isTok = (w: string) => /⟦\d+⟧/.test(w);
  while (words.filter((w) => !isTok(w)).length > 1 && !fits(words.join(" "))) {
    let i = words.length - 1;
    while (i > 0 && isTok(words[i])) i -= 1;
    words.splice(i, 1);
  }
  return words.join(" ");
}

// ───────────────────────── 지시 해석(규칙) ─────────────────────────

const TYPE_WORDS: Array<[RegExp, InfoType]> = [
  [/순환|사이클|반복/, "cycle"],
  [/기둥/, "pillars"],
  [/카드/, "cards"],
  [/아이콘/, "iconGrid"],
  [/허브|방사/, "hub"],
  [/층위|계층|동심/, "layers"],
  [/로드맵/, "roadmap"],
  [/시간축|연대표/, "timeline"],
  [/흐름|절차|프로세스|단계/, "process"],
];

const KO_NUM: Record<string, number> = { 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 셋: 3, 넷: 4 };

export interface RuleEditResult {
  ops: PatchOp[];
  /** 알아들은 것(검토 화면 안내) */
  understood: string[];
  /** 규칙으로는 못 하는 것 */
  missed: string[];
}

/** 톤 맞추기 — 쪽 안 인포그래픽·일러스트 색을 이 쪽 분야 색(규칙 기본값)으로 */
const TONE_WORDS = /분야\s*색|톤|색(을|깔)?\s*(통일|맞춰|맞추)|같은\s*색/;
const ILLUST_WORDS = /일러스트|그림으로|그림을/;

/** 지시문 → 패치(규칙). 인포그래픽 유형·단계 수·줄이기·분야 색 통일·일러스트(첫 후보)만 다룬다 */
export function ruleEditOps(outline: PageOutline, instruction: string, metrics: Record<string, MetricBrief>, opts: { illusts?: Record<string, ShapeChoice[]> } = {}): RuleEditResult {
  const ops: PatchOp[] = [];
  const understood: string[] = [];
  const missed: string[] = [];
  const focus = outline.blocks.filter((b) => b.focus);
  const pool = focus.length ? focus : outline.blocks;
  const infos = pool.filter((b): b is InfoBlock => b.kind === "info");
  if (ILLUST_WORDS.test(instruction)) {
    // 일러스트로 — 규칙 점수 1위 후보(지금 그림이 아닌 것)
    const target = infos.find((b) => (opts.illusts?.[b.id] ?? []).some((c) => !c.current));
    const pick = target ? opts.illusts![target.id].find((c) => !c.current) : undefined;
    if (target && pick) {
      ops.push({ op: "shape", id: target.id, illust: { asset: pick.id } });
      understood.push(`${target.label} → 일러스트 '${pick.title}'(규칙 점수 1위)`);
    } else missed.push("이 쪽 인포그래픽과 항목 수가 같은 일러스트가 라이브러리에 없습니다.");
  }
  if (TONE_WORDS.test(instruction)) {
    let n = 0;
    for (const b of infos) {
      if (ops.some((o) => o.id === b.id && o.op === "shape")) continue;
      if (b.illust && (b.illust.colors?.mode ?? "area") !== "area") ops.push({ op: "shape", id: b.id, illust: { asset: b.illust.asset, colors: { mode: "area" } } });
      else if (!b.illust && (b.colorMode ?? "area") !== "area") ops.push({ op: "shape", id: b.id, colorMode: "area" });
      else continue;
      n += 1;
    }
    if (n) understood.push(`인포그래픽·일러스트 ${n}곳의 색을 이 쪽 분야 색으로`);
    else understood.push("인포그래픽·일러스트가 이미 이 쪽 분야 색입니다");
  }
  const wantType = TYPE_WORDS.find(([re]) => re.test(instruction))?.[1];
  // 바꿀 유형과 같은 형태(목록·수치)의 인포그래픽을 고른다(분야 쪽에는 전후 비교·막대가 함께 있음)
  const fam = wantType ? INFO_TYPE_META[wantType].family : "list";
  const fits = (b: OutlineBlock): b is InfoBlock => b.kind === "info" && contentFamily(b.content) === fam;
  const info = pool.find(fits) ?? outline.blocks.find(fits);
  const nm = instruction.match(/(\d+)\s*단계/) ?? instruction.match(/(두|세|네|다섯|여섯|일곱)\s*단계/);
  const count = nm ? (Number(nm[1]) || KO_NUM[nm[1]] || 0) : 0;
  if (info && (wantType || count)) {
    const type = wantType ?? info.type;
    const meta = INFO_TYPE_META[type];
    let items = info.content.items;
    if (count && items.length > count) {
      items = items.slice(0, count);
      understood.push(`${info.label}: 앞 ${count}단계만 남김`);
    } else if (count && items.length < count) {
      missed.push(`${count}단계로 늘리기 — 새 단계 문안은 AI 없이 만들 수 없습니다(지금 ${items.length}단계).`);
    }
    if (type !== info.type) understood.push(`${info.label} → ${meta.label}`);
    if (type !== info.type || items !== info.content.items)
      ops.push({ op: "info", id: info.id, type, items: items.map((it) => ({ label: it.label, ...(it.desc ? { desc: it.desc } : {}), ...(it.when ? { when: it.when } : {}), ...(it.icon ? { icon: it.icon } : {}), ...(it.metric ? { metric: it.metric } : {}) })) });
  }
  if (/줄여|짧게|간결|축약|줄이/.test(instruction)) {
    for (const b of pool) {
      if (b.kind === "text" && !b.readonly && (b.role === "lead" || b.role === "body" || b.role === "caption")) {
        const target = Math.max(20, Math.floor(charLen(b.text, metrics) * 0.8));
        const t = ruleShorten(b.text, target, metrics);
        if (t !== b.text) ops.push({ op: "text", id: b.id, text: t });
      } else if (b.kind === "list") {
        const items = b.items.map((t) => ruleShorten(t, Math.max(10, Math.floor(charLen(t, metrics) * 0.8)), metrics));
        if (items.join("|") !== b.items.join("|")) ops.push({ op: "list", id: b.id, items });
      }
    }
    if (ops.length) understood.push("문구 줄이기(괄호 설명·접속 표현·뒤 문장 빼기)");
  }
  const leftover = instruction.replace(/[^가-힣A-Za-z]/g, "");
  if (ops.length === 0 || /추가|넣어|사례|바꿔.*문|작성|써/.test(instruction)) {
    if (leftover) missed.push("문안을 새로 쓰거나 내용을 더하는 지시는 AI 가 있어야 합니다. 직접 고치거나 AI 를 쓸 수 있을 때 다시 시도하세요.");
  }
  return { ops, understood, missed };
}

// ───────────────────────── 새 사업 분야 초안 ─────────────────────────

export interface AreaDraftInput {
  name: string;
  memo: string;
  categories: string[];
  metrics: Record<string, MetricBrief>;
  candidates: CaseCandidate[];
}

/** 메모 속 지시·참고 글(데이터 안 지시문) — 초안에 옮기지 않는다 */
const NOTE_LIKE = /무시|쓰세요|쓰시오|하라|하세요|해 ?주세요|참고|지시|프롬프트|ignore|instruction/i;

/** 메모 → 문장·항목(괄호 안 메모·지시 같은 글·최상급은 뺀다) */
function memoParts(memo: string): { sentences: string[]; items: string[] } {
  const clean = memo.replace(/\r/g, "").replace(/\([^()]*\)/g, " ").trim();
  const ok = (x: string) => !NOTE_LIKE.test(x) && findSuperlatives(x).length === 0;
  const sentences = (clean.match(/[^.!?\n]+(니다|요)\.?/g)?.map((x) => x.trim().replace(/([^.])$/, "$1.")) ?? []).filter(ok);
  const items = clean
    .split(/\n|,|，|·|;|\/|•|- |\.\s/)
    .map((x) => x.replace(/^[\s\-*•\d.)]+/, "").replace(/[.。]\s*$/, "").trim())
    .filter((x) => x.length >= 3 && x.length <= CUSTOM_AREA_LIMITS.service && !/니다\.?$/.test(x) && ok(x));
  return { sentences, items };
}

/** 분야 이름·메모의 낱말(2자 이상)이 계약 표기에 들어간 후보만 — 관련 없는 실적을 대표로 걸지 않는다 */
function relatedCandidates(candidates: CaseCandidate[], name: string, memo: string): CaseCandidate[] {
  const words = [
    ...new Set(
      `${name} ${memo}`
        .split(/[^가-힣A-Za-z0-9]+/)
        .map((w) => w.replace(/(조사|계획|수립|평가|관리|대응|지원|업무|분야)$/, ""))
        .filter((w) => w.length >= 2)
    ),
  ];
  return candidates.filter((c) => words.some((w) => c.title.includes(w)));
}

export function templateArea(input: AreaDraftInput): CustomAreaContent {
  const related = input.categories.filter((c) => AREA_CONTENT[c]);
  const base = related[0] ? AREA_CONTENT[related[0]] : AREA_CONTENT["기타 용역"];
  const { sentences, items } = memoParts(input.memo);
  const services = [...items];
  for (const sv of base.services) {
    if (services.length >= 3) break;
    if (!services.includes(sv)) services.push(sv);
  }
  const lead =
    sentences[0] && charLen(sentences[0]) <= CUSTOM_AREA_LIMITS.lead
      ? sentences[0]
      : `${input.name} 분야에서 ${services.slice(0, 2).join(", ")} 업무를 수행합니다.`;
  const kpis = [
    ...related.map((c) => `projects.area.${areaIndex(c)}`),
    "projects.total",
  ].filter((id, i, arr) => input.metrics[id] && arr.indexOf(id) === i);
  const featured = relatedCandidates(input.candidates, input.name, input.memo)
    .sort((a, b) => Number(b.featured) - Number(a.featured) || b.year.localeCompare(a.year))
    .slice(0, CUSTOM_AREA_LIMITS.featured)
    .map((c) => c.id);
  return {
    icon: base.icon,
    lead,
    services: services.slice(0, 6),
    processTitle: "수행 절차",
    process: base.process.slice(0, 5).map((p) => ({ label: p.label, desc: p.desc })),
    infoType: "process",
    kpis: kpis.slice(0, CUSTOM_AREA_LIMITS.kpis),
    featured,
    heroCaption: kpis[0] ? `${input.metrics[kpis[0]].label}(관련 분류 기준)` : `${input.name} 누적 수행`,
    casesAside: base.casesAside,
    relatedCategories: input.categories,
    source: "rule",
    draft: true,
  };
}
