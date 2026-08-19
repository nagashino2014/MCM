// 사규 HWPX → 조문 IR 임포트 (RB-P0). 설계: docs/company-rules-blueprint.md §4.
// 계약서 분석(lib/agreement/analyze.ts)과 달리 LLM 을 쓰지 않는다 — 사규 원문은
// `제N조 【제목】` · 항(①…) · 호(1. …) 표기가 규칙적이라 결정론적 파싱으로 전량 복원된다
// (2026.04.08. 개정판 실측: 조문 헤더 91 = 본문 86 + 부칙 5 로 정확히 일치).
// 결정론이라 재현·검증이 되고 비용도 없다. 애매한 지점은 warnings 로 올려 검수 화면에서 사람이 고친다.

import { parseHwpx, type HwpxDoc, type Para, type Table } from "@/lib/deliverable/hwpx-doc";
import type {
  RuleArticle,
  RuleAppendix,
  RuleBody,
  RuleChapter,
  RuleClause,
  RuleHistoryEntry,
  RuleImportResult,
  RuleTable,
} from "./types";

// ── 텍스트 정규화 ──

/**
 * hwpx 원문에는 필드·컨트롤 자리를 메우는 제어문자(특히 NUL)가 섞여 있다.
 * PostgreSQL jsonb 는 U+0000 을 저장하지 못하고(22P05) 화면에도 의미가 없으므로 털어낸다.
 * 실측: 2026.04.08. 개정판 제27조 본문에 NUL 이 들어 있어 적재가 실패했다.
 */
function stripControl(raw: string): string {
  let out = "";
  for (const ch of raw) {
    const c = ch.codePointAt(0) ?? 0;
    if (c === 0x09 || c === 0x0a || c === 0x0d) {
      out += ch;
      continue;
    }
    if (c < 0x20 || c === 0x7f) continue;
    out += ch;
  }
  return out;
}

/**
 * 한글 자간 벌리기 복원 — 공백으로 끊은 토큰이 모두 1글자면 붙인다.
 * '목      적' → '목적', '총   칙' → '총칙'. 반면 '휴일 및 휴가'는 그대로 둔다.
 */
function normalizeTitle(raw: string): string {
  const t = stripControl(raw).replace(/\s+/g, " ").trim();
  if (!t) return "";
  const tokens = t.split(" ");
  if (tokens.length > 1 && tokens.every((x) => [...x].length === 1)) return tokens.join("");
  return t;
}

/** 본문 줄 — 연속 공백만 압축한다(문장 내 어절은 보존). */
function normalizeText(raw: string): string {
  return stripControl(raw).replace(/\s+/g, " ").trim();
}

function paraText(p: Para): string {
  return p.runs.map((r) => r.text).join("");
}

// ── 줄 분류 ──

const RE_CHAPTER = /^제\s*(\d+)\s*장\s*(.*)$/;
const RE_ARTICLE = /^제\s*(\d+)\s*조\s*[【[(]?\s*([^】\])]*)\s*[】)\]]?\s*(.*)$/;
const RE_ADDENDUM = /^부\s*칙\s*$/;
const RE_HISTORY = /^개\s*정\s*$/;
const RE_APPENDIX = /^\[?\s*별표\s*(\d+)\s*[.\]]?\s*(.*)$/;
const RE_ITEM = /^(\d+\.)\s*(.*)$/;
const RE_DETAIL = /^[-–—]\s*(.*)$/;
const RE_DATE = /(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})/;

/** 조문 본문에 인용된 별표 — '별표 3' 형태를 모두 걷는다. */
function collectRefs(text: string, into: Set<string>): void {
  for (const m of text.matchAll(/별표\s*(\d+)/g)) into.add(`appendix-${m[1]}`);
}

// ── 항 기호 ──
// 원문이 원문자 세트를 섞어 쓴다(2026.04.08. 개정판 제33조: ⑤ 다음이 ➅ = U+2785).
// 네 세트를 모두 항 기호로 인정하고 숫자로 환산해 순번을 검사한다.
const RE_CLAUSE_MARK = /[①-⑳❶-➓]/gu;

function clauseNo(mark: string): number {
  const c = mark.codePointAt(0) ?? 0;
  if (c >= 0x2460 && c <= 0x2473) return c - 0x2460 + 1; // ①–⑳
  if (c >= 0x2776 && c <= 0x277f) return c - 0x2776 + 1; // ❶–❿
  if (c >= 0x2780 && c <= 0x2789) return c - 0x2780 + 1; // ➀–➉
  if (c >= 0x278a && c <= 0x2793) return c - 0x278a + 1; // ➊–➓
  return 0;
}

interface ClauseSeg {
  /** 새 항이면 원문 기호, 앞 항의 이어짐이면 빈 문자열 */
  label: string;
  text: string;
}

/**
 * 한 문단에 여러 항이 눌러붙은 경우를 쪼갠다.
 * 오탐(본문 중 인용)을 막기 위해 **직전 항 번호 + 1** 로 이어지고 기호 앞이 문단 머리이거나
 * 공백일 때만 분할점으로 본다. 원문 제33조 "① … ② …" / "⑤ … ➅ …" 가 이 경로로 복원된다.
 */
function splitClauses(text: string, prevNo: number): ClauseSeg[] {
  const cuts: { at: number; label: string }[] = [];
  let expect = prevNo + 1;
  for (const m of text.matchAll(RE_CLAUSE_MARK)) {
    const at = m.index ?? 0;
    if (clauseNo(m[0]) !== expect) continue;
    if (at !== 0 && !/\s/.test(text[at - 1])) continue;
    cuts.push({ at, label: m[0] });
    expect += 1;
  }
  if (!cuts.length) return [{ label: "", text }];

  const segs: ClauseSeg[] = [];
  const head = text.slice(0, cuts[0].at).trim();
  if (head) segs.push({ label: "", text: head });
  for (let i = 0; i < cuts.length; i += 1) {
    const from = cuts[i].at + cuts[i].label.length;
    const to = i + 1 < cuts.length ? cuts[i + 1].at : text.length;
    segs.push({ label: cuts[i].label, text: text.slice(from, to).trim() });
  }
  return segs;
}

// ── 표 ──

function toRuleTable(t: Table): RuleTable {
  const rows: RuleTable["rows"] = [];
  for (const c of t.cells) {
    const text = normalizeText(c.paragraphs.map(paraText).join("\n"));
    while (rows.length <= c.row) rows.push([]);
    rows[c.row].push({ text, colSpan: c.colSpan, rowSpan: c.rowSpan });
  }
  return { rows };
}

// ── 파서 본체 ──

type Section = "body" | "addendum" | "history" | "appendix";

interface Ctx {
  chapters: RuleChapter[];
  addendum: RuleArticle[];
  appendices: RuleAppendix[];
  history: RuleHistoryEntry[];
  warnings: string[];
  section: Section;
  chapter: RuleChapter | null;
  article: RuleArticle | null;
  clause: RuleClause | null;
  appendix: RuleAppendix | null;
  historyEntry: RuleHistoryEntry | null;
  refs: Set<string>;
  tableCount: number;
}

/** 조문에 항 기호가 없을 때 쓰는 단항 컨테이너. */
function ensureClause(ctx: Ctx): RuleClause {
  if (ctx.clause) return ctx.clause;
  const c: RuleClause = { label: "", text: "", items: [] };
  ctx.article?.clauses.push(c);
  ctx.clause = c;
  return c;
}

function closeArticle(ctx: Ctx): void {
  if (ctx.article) ctx.article.refs = [...ctx.refs].sort();
  ctx.refs = new Set();
  ctx.clause = null;
}

/** 현재 항의 번호 — 항 기호가 없는 단항이면 0. */
function currentClauseNo(ctx: Ctx): number {
  return ctx.clause?.label ? clauseNo(ctx.clause.label) : 0;
}

/** 본문 한 문단을 현재 조문에 흘려 넣는다 — 항 분할 → 호 → 이어짐 순. */
function appendParagraph(ctx: Ctx, text: string): void {
  if (!ctx.article) return;
  for (const seg of splitClauses(text, currentClauseNo(ctx))) {
    if (seg.label) {
      const c: RuleClause = { label: seg.label, text: normalizeText(seg.text), items: [] };
      ctx.article.clauses.push(c);
      ctx.clause = c;
      continue;
    }
    if (!seg.text) continue;
    const cur = ensureClause(ctx);
    if (RE_ITEM.test(seg.text)) {
      cur.items.push(seg.text);
      continue;
    }
    // 이어지는 본문 — 직전이 호였으면 그 호에, 아니면 항 본문에 잇는다.
    if (cur.items.length) cur.items[cur.items.length - 1] += ` ${seg.text}`;
    else cur.text = cur.text ? `${cur.text} ${seg.text}` : seg.text;
  }
}

function startArticle(ctx: Ctx, no: number, title: string, rest: string): void {
  closeArticle(ctx);
  const key = ctx.section === "addendum" ? `addendum-${no}` : `art-${no}`;
  const article: RuleArticle = { key, no, title: normalizeTitle(title), clauses: [], refs: [] };
  ctx.article = article;
  if (ctx.section === "addendum") {
    ctx.addendum.push(article);
  } else {
    if (!ctx.chapter) {
      // 장 표제 없이 조문이 먼저 나오는 경우 — 무장(無章) 컨테이너로 받아 검수에서 정리한다.
      ctx.chapter = { no: 0, title: "(장 미지정)", articles: [] };
      ctx.chapters.push(ctx.chapter);
      ctx.warnings.push(`제${no}조가 장 표제 없이 나타나 '(장 미지정)'으로 담았습니다.`);
    }
    ctx.chapter.articles.push(article);
  }
  if (rest.trim()) {
    collectRefs(rest, ctx.refs);
    appendParagraph(ctx, normalizeText(rest));
  }
}

/**
 * 목차 구간을 건너뛴다 — 사규 앞머리는 장 표제만 나열되고 조문이 없다.
 * 첫 조문 헤더 직전의 장 표제부터가 본문이다.
 */
function bodyStartIndex(lines: string[]): number {
  const firstArticle = lines.findIndex((l) => RE_ARTICLE.test(l));
  if (firstArticle < 0) return 0;
  for (let i = firstArticle; i >= 0; i -= 1) {
    if (RE_CHAPTER.test(lines[i])) return i;
  }
  return firstArticle;
}

export function buildRuleBody(doc: HwpxDoc): RuleImportResult {
  const paras = doc.pages.flat();
  const entries = paras.map((p) => ({ text: normalizeText(paraText(p)), tables: p.tables }));
  const lines = entries.map((e) => e.text);
  const start = bodyStartIndex(lines);

  const ctx: Ctx = {
    chapters: [],
    addendum: [],
    appendices: [],
    history: [],
    warnings: [],
    section: "body",
    chapter: null,
    article: null,
    clause: null,
    appendix: null,
    historyEntry: null,
    refs: new Set(),
    tableCount: 0,
  };

  for (let i = start; i < entries.length; i += 1) {
    const { text, tables } = entries[i];

    // 표는 텍스트 유무와 무관하게 현재 컨텍스트에 붙인다(별표 본문은 표로만 이뤄진 경우가 많다).
    if (tables.length) {
      ctx.tableCount += tables.length;
      if (ctx.section === "appendix" && ctx.appendix) {
        for (const t of tables) ctx.appendix.tables.push(toRuleTable(t));
      } else if (ctx.article) {
        // 조문 본문에 직접 박힌 표(제27조 근무시간표) — 조문에 딸려 보존한다.
        const list = (ctx.article.tables ??= []);
        for (const t of tables) list.push(toRuleTable(t));
      } else {
        ctx.warnings.push(`본문 위치의 표 ${tables.length}개를 담을 조문을 찾지 못했습니다. 검수에서 확인하세요.`);
      }
    }

    if (!text) continue;

    // ── 섹션 전환 ──
    if (RE_ADDENDUM.test(text)) {
      closeArticle(ctx);
      ctx.section = "addendum";
      ctx.article = null;
      ctx.chapter = null;
      continue;
    }
    if (ctx.section === "addendum" && RE_HISTORY.test(text)) {
      closeArticle(ctx);
      ctx.section = "history";
      ctx.article = null;
      continue;
    }

    // 별표 표제 — 부칙/연혁 이후의 것만 실제 별표다(본문 안의 같은 표기는 조문의 인용).
    const mAppendix = RE_APPENDIX.exec(text);
    if (mAppendix && ctx.section !== "body") {
      closeArticle(ctx);
      ctx.section = "appendix";
      ctx.article = null;
      ctx.historyEntry = null;
      const no = Number(mAppendix[1]);
      // 표제 꾸밈 제거 — 앞의 '.'/']' 와 끝의 닫는 괄호·'- 신설' 꼬리를 털어낸다.
      const title = normalizeTitle(
        mAppendix[2]
          .replace(/^[.\]\s]+/, "")
          .replace(/\s*[-–—]\s*(신설|변경|개정)\s*$/, "")
          .replace(/[\])】]\s*$/, ""),
      );
      const key = `appendix-${no}`;
      if (ctx.appendices.some((a) => a.key === key)) {
        ctx.warnings.push(`별표 ${no}("${title}") 표제가 중복 등장합니다. 검수에서 번호를 확인하세요.`);
      }
      ctx.appendix = { key, no, title, paras: [], tables: [] };
      ctx.appendices.push(ctx.appendix);
      continue;
    }

    // ── 개정 연혁 ──
    if (ctx.section === "history") {
      const mItem = RE_ITEM.exec(text);
      const mDetail = RE_DETAIL.exec(text);
      if (mItem) {
        const md = RE_DATE.exec(text);
        ctx.historyEntry = {
          text,
          date: md ? `${md[1]}-${md[2].padStart(2, "0")}-${md[3].padStart(2, "0")}` : null,
          details: [],
        };
        ctx.history.push(ctx.historyEntry);
      } else if (mDetail && ctx.historyEntry) {
        ctx.historyEntry.details.push(mDetail[1]);
      } else if (ctx.historyEntry) {
        // 줄바꿈으로 끊긴 이어짐
        if (ctx.historyEntry.details.length) {
          ctx.historyEntry.details[ctx.historyEntry.details.length - 1] += ` ${text}`;
        } else {
          ctx.historyEntry.text += ` ${text}`;
        }
      }
      continue;
    }

    // ── 별표 본문(표 사이 설명 문단) ──
    if (ctx.section === "appendix") {
      if (ctx.appendix) ctx.appendix.paras.push(text);
      continue;
    }

    // ── 장 ──
    const mChapter = RE_CHAPTER.exec(text);
    if (mChapter) {
      closeArticle(ctx);
      ctx.article = null;
      ctx.chapter = { no: Number(mChapter[1]), title: normalizeTitle(mChapter[2]), articles: [] };
      ctx.chapters.push(ctx.chapter);
      continue;
    }

    // ── 조 ──
    const mArticle = RE_ARTICLE.exec(text);
    if (mArticle) {
      startArticle(ctx, Number(mArticle[1]), mArticle[2], mArticle[3]);
      continue;
    }

    if (!ctx.article) continue; // 본문 시작 전 잔여 줄(표지·목차 꼬리)

    collectRefs(text, ctx.refs);
    appendParagraph(ctx, text);
  }

  closeArticle(ctx);

  const body: RuleBody = {
    chapters: ctx.chapters,
    addendum: ctx.addendum,
    appendices: ctx.appendices,
    history: ctx.history,
  };
  validate(body, ctx.warnings);

  const articles = ctx.chapters.reduce((n, c) => n + c.articles.length, 0);
  return {
    body,
    warnings: ctx.warnings,
    stats: {
      chapters: ctx.chapters.length,
      articles,
      addendum: ctx.addendum.length,
      appendices: ctx.appendices.length,
      tables: ctx.tableCount,
    },
  };
}

/** 검수 화면이 사람에게 보여줄 이상 신호 — 자동 수정하지 않는다. */
function validate(body: RuleBody, warnings: string[]): void {
  const nos: number[] = [];
  for (const ch of body.chapters) for (const a of ch.articles) nos.push(a.no);

  for (let i = 1; i < nos.length; i += 1) {
    if (nos[i] === nos[i - 1]) warnings.push(`제${nos[i]}조가 중복입니다.`);
    else if (nos[i] < nos[i - 1]) warnings.push(`조 번호가 역순입니다(제${nos[i - 1]}조 → 제${nos[i]}조).`);
    else if (nos[i] > nos[i - 1] + 1) warnings.push(`제${nos[i - 1] + 1}조부터 제${nos[i] - 1}조까지 빠졌습니다.`);
  }
  for (let i = 1; i < body.chapters.length; i += 1) {
    const prev = body.chapters[i - 1].no;
    const cur = body.chapters[i].no;
    if (cur !== prev + 1) warnings.push(`장 번호가 이어지지 않습니다(제${prev}장 → 제${cur}장).`);
  }

  // 조문이 인용한 별표가 실제로 있는지 — 원문의 번호 불일치를 잡는다
  // (2026.04.08. 개정판: 본문은 '별표 6. 징계 양정 기준'을 인용하나 말미 표제는 '별표 7'이다).
  const have = new Set(body.appendices.map((a) => a.key));
  const cited = new Set<string>();
  for (const ch of body.chapters) for (const a of ch.articles) for (const r of a.refs) cited.add(r);
  for (const r of [...cited].sort()) {
    if (!have.has(r)) warnings.push(`조문이 인용한 ${r.replace("appendix-", "별표 ")}이(가) 본문 뒤에 없습니다.`);
  }
  for (const a of body.appendices) {
    if (!cited.has(a.key)) warnings.push(`별표 ${a.no}("${a.title}")를 인용하는 조문이 없습니다.`);
    if (!a.tables.length && !a.paras.length) warnings.push(`별표 ${a.no}("${a.title}")의 내용이 비어 있습니다.`);
  }
  for (const ch of body.chapters) {
    for (const a of ch.articles) {
      if (!a.clauses.length) warnings.push(`제${a.no}조("${a.title}")의 본문이 비어 있습니다.`);
      if (!a.title) warnings.push(`제${a.no}조에 제목이 없습니다.`);
    }
  }
  if (!body.chapters.length) warnings.push("장·조문을 하나도 찾지 못했습니다. HWPX 원본인지 확인하세요.");
}

/** hwpx 바이트 → 조문 IR. */
export async function importRuleHwpx(bytes: Uint8Array): Promise<RuleImportResult> {
  const doc = await parseHwpx(bytes);
  return buildRuleBody(doc);
}
