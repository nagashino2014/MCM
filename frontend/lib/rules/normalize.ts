// 조문 IR 인덱스 서열 검증·교정(내부 규정, 2026-09-22) — 클라이언트/서버 공용(DB·node import 금지).
// 임포트 직후와 편집 화면의 [번호 검증·교정] 버튼이 같은 규칙을 쓴다.
// 사규 임포트(lib/rules/import.ts)는 원문 결함을 "고치지 않고 경고"하지만, 내부 규정은 참고자료·LLM 생성본을
// 바로 반영하는 용도라 번호 서열은 자동으로 바로잡고(교정 내역을 남김), 내용 판단이 필요한 것만 경고한다.
//
// 서열: 장(제N장) > 조(제N조) > 항(①②…) > 호(1. 2. …) > 목(가. 나. …) > 세목(1) 2) …) > 세세목(가) 나) …)
// 조 번호는 장과 무관하게 규정 전체에서 1부터 연속, 부칙 조문은 별도로 1부터.

import type { RuleArticle, RuleBody, RuleChapter, RuleClause } from "./types";

export interface NormalizeResult {
  body: RuleBody;
  /** 자동으로 바로잡은 내역 */
  corrections: string[];
  /** 사람이 확인해야 할 내역(자동 교정하지 않음) */
  warnings: string[];
}

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
const HANGUL_SEQ = "가나다라마바사아자차카타파하";

/** 원문자 세트 혼용(①/❶/➀/➊)을 숫자로 환산 — 사규 임포트와 같은 범위 */
export function clauseNo(mark: string): number {
  const c = mark.codePointAt(0) ?? 0;
  if (c >= 0x2460 && c <= 0x2473) return c - 0x2460 + 1;
  if (c >= 0x2776 && c <= 0x277f) return c - 0x2776 + 1;
  if (c >= 0x2780 && c <= 0x2789) return c - 0x2780 + 1;
  if (c >= 0x278a && c <= 0x2793) return c - 0x278a + 1;
  return 0;
}

export function circled(n: number): string {
  return CIRCLED[n - 1] ?? `(${n})`;
}

type ItemLevel = 1 | 2 | 3 | 4;

interface ItemHead {
  level: ItemLevel;
  /** 기호 뒤 본문 */
  rest: string;
  /** 원래 기호(교정 내역 표시용) */
  mark: string;
}

/** 호·목 기호 판별 — 1. / 가. / 1) / 가) */
export function itemHead(text: string): ItemHead | null {
  const t = text.trimStart();
  let m = /^(\d{1,3})\.(?!\d)\s*([\s\S]*)$/.exec(t); // '1.5배' 같은 소수는 호가 아니다
  if (m) return { level: 1, rest: m[2], mark: `${m[1]}.` };
  m = /^([가-하])\.\s*([\s\S]*)$/.exec(t);
  if (m && HANGUL_SEQ.includes(m[1])) return { level: 2, rest: m[2], mark: `${m[1]}.` };
  m = /^\(?(\d{1,3})\)\s*([\s\S]*)$/.exec(t);
  if (m) return { level: 3, rest: m[2], mark: `${m[1]})` };
  m = /^\(?([가-하])\)\s*([\s\S]*)$/.exec(t);
  if (m && HANGUL_SEQ.includes(m[1])) return { level: 4, rest: m[2], mark: `${m[1]})` };
  return null;
}

function markFor(level: ItemLevel, n: number): string {
  const h = HANGUL_SEQ[n - 1] ?? `${n}`;
  if (level === 1) return `${n}.`;
  if (level === 2) return `${h}.`;
  if (level === 3) return `${n})`;
  return `${h})`;
}

/** 호·목 번호를 수준별로 1부터 다시 매긴다 — 상위 수준이 나오면 하위 카운터를 초기화. */
function renumberItems(items: string[], where: string, corrections: string[]): string[] {
  const counters: Record<ItemLevel, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let fixed = 0;
  const out = items.map((raw) => {
    const head = itemHead(raw);
    if (!head) return raw.trim();
    counters[head.level] += 1;
    for (let lv = head.level + 1; lv <= 4; lv += 1) counters[lv as ItemLevel] = 0;
    const mark = markFor(head.level, counters[head.level]);
    if (mark !== head.mark) fixed += 1;
    return `${mark} ${head.rest.trim()}`;
  });
  if (fixed) corrections.push(`${where}: 호·목 번호 ${fixed}건을 순서대로 다시 매겼습니다.`);
  return out;
}

function articleLabel(a: RuleArticle, addendum: boolean): string {
  const head = addendum ? "부칙 " : "";
  return a.no ? `${head}제${a.no}조${a.title ? `(${a.title})` : ""}` : `${head}조문`;
}

function normalizeArticle(a: RuleArticle, addendum: boolean, corrections: string[], warnings: string[]): RuleArticle {
  const where = articleLabel(a, addendum);
  const title = a.title.replace(/^[\s【[(（]+|[\s】\])）]+$/g, "").trim();
  if (title !== a.title) corrections.push(`${where}: 제목의 괄호·공백을 정리했습니다.`);

  // 빈 항 제거
  let clauses: RuleClause[] = a.clauses.filter((c) => c.text.trim() || c.items.some((i) => i.trim()));
  if (clauses.length !== a.clauses.length) corrections.push(`${where}: 내용 없는 항 ${a.clauses.length - clauses.length}개를 뺐습니다.`);

  // 항 기호 — 붙은 항끼리 ①부터 연속으로
  const labeled = clauses.filter((c) => c.label);
  if (labeled.length) {
    let n = 0;
    let fixed = 0;
    clauses = clauses.map((c) => {
      if (!c.label) return c;
      n += 1;
      const next = circled(n);
      if (c.label !== next) fixed += 1; // 번호 어긋남 + 원문자 세트 혼용(❶·➀) 통일
      return { ...c, label: next };
    });
    if (fixed) corrections.push(`${where}: 항 번호 ${fixed}건을 ①부터 순서대로 다시 매겼습니다.`);
    if (labeled.length === 1 && clauses.length === 1) warnings.push(`${where}: 항이 하나뿐인데 ① 기호가 붙어 있습니다(단항 조문은 보통 기호를 쓰지 않습니다).`);
  } else if (clauses.length > 1) {
    // 항 기호 없이 문단이 여럿 — 둘째 문단부터는 기호 없는 항이 된다. 항으로 볼지 사람이 정한다.
    warnings.push(`${where}: 항 기호 없이 문단이 ${clauses.length}개입니다. 항으로 나눌지 확인하세요.`);
  }

  clauses = clauses.map((c, i) => ({
    ...c,
    text: c.text.trim(),
    items: renumberItems(c.items.filter((x) => x.trim()), clauses.length > 1 ? `${where} ${c.label || `${i + 1}번째 문단`}` : where, corrections),
  }));

  if (!title && a.no) warnings.push(`${where}: 조문 제목이 없습니다.`);
  if (!clauses.length) warnings.push(`${where}: 본문이 비어 있습니다.`);
  return { ...a, title, clauses };
}

/**
 * 조문 IR 을 검증·교정한다. 입력은 바꾸지 않고 새 body 를 돌려준다.
 * 조 번호가 바뀌면 본문 속 '제N조' 인용은 자동으로 고치지 않는다(다른 법령 인용과 구분할 수 없음) — 경고로 알린다.
 */
export function normalizeRuleBody(input: RuleBody): NormalizeResult {
  const corrections: string[] = [];
  const warnings: string[] = [];

  // ── 장 ──
  // 첫 장이 '(장 미지정)'(no 0)이면 장 없이 조문만 있는 규정 — 장 번호를 매기지 않는다.
  const chaptersIn = input.chapters.filter((ch, i) => ch.articles.length || ch.title.trim() || i > 0 || ch.no !== 0);
  const noChapter = chaptersIn.length === 1 && chaptersIn[0].no === 0;
  let chapterNo = 0;
  const chapters: RuleChapter[] = chaptersIn.map((ch, idx) => {
    if (noChapter) return { ...ch, title: "" };
    if (idx === 0 && ch.no === 0) {
      warnings.push(`장 표제 없이 시작한 조문 ${ch.articles.length}개가 있습니다. 장을 지정하거나 첫 장으로 옮기세요.`);
      return ch;
    }
    chapterNo += 1;
    const title = ch.title.replace(/\s+/g, " ").trim();
    if (ch.no !== chapterNo) corrections.push(`제${ch.no}장 ${title} → 제${chapterNo}장 (장 번호 순서 교정)`);
    if (!title) warnings.push(`제${chapterNo}장에 표제가 없습니다.`);
    if (!ch.articles.length) warnings.push(`제${chapterNo}장 ${title}에 조문이 없습니다.`);
    return { ...ch, no: chapterNo, title };
  });

  // ── 조 — 규정 전체에서 1부터 연속 ──
  let articleNo = 0;
  let renumbered = 0;
  const seenTitles = new Map<string, number>();
  const outChapters = chapters.map((ch) => ({
    ...ch,
    articles: ch.articles.map((a) => {
      articleNo += 1;
      if (a.no !== articleNo) {
        corrections.push(`제${a.no}조${a.title ? `(${a.title})` : ""} → 제${articleNo}조 (조 번호 순서 교정)`);
        renumbered += 1;
      }
      const fixed = normalizeArticle({ ...a, no: articleNo, key: `art-${articleNo}` }, false, corrections, warnings);
      if (fixed.title) {
        const prev = seenTitles.get(fixed.title);
        if (prev) warnings.push(`제${prev}조와 제${articleNo}조의 제목이 같습니다(「${fixed.title}」). 중복 조문인지 확인하세요.`);
        else seenTitles.set(fixed.title, articleNo);
      }
      return fixed;
    }),
  }));
  if (renumbered) warnings.push(`조 번호 ${renumbered}건이 바뀌었습니다. 본문 속 '제N조' 인용이 있으면 바뀐 번호에 맞게 확인하세요.`);
  if (!articleNo) warnings.push("조문이 하나도 없습니다.");

  // ── 부칙 — 조가 하나 이상 번호를 가지면 1부터 연속, 조 없이 문장만 있는 부칙(no 0)은 그대로 ──
  const numbered = input.addendum.length > 1 || input.addendum.some((a) => a.no > 0);
  const addendum = input.addendum.map((a, i) => {
    const no = numbered ? i + 1 : 0;
    if (numbered && a.no !== no) corrections.push(`부칙 제${a.no}조 → 부칙 제${no}조 (번호 순서 교정)`);
    return normalizeArticle({ ...a, no, key: `addendum-${no || i + 1}` }, true, corrections, warnings);
  });

  // ── 별표 — 번호 1부터 연속 ──
  const appendices = input.appendices.map((ap, i) => {
    const no = i + 1;
    if (ap.no !== no) corrections.push(`별표 ${ap.no} → 별표 ${no} (번호 순서 교정)`);
    return { ...ap, no, key: `appendix-${no}` };
  });

  return {
    body: { chapters: outChapters, addendum, appendices, history: input.history ?? [] },
    corrections,
    warnings,
  };
}

/** 빈 규정 골격 — 신규 작성 시작점(제1장 총칙 / 제1조 목적 / 부칙 시행일). */
export function emptyInternalRuleBody(): RuleBody {
  return {
    chapters: [
      {
        no: 1,
        title: "총칙",
        articles: [{ key: "art-1", no: 1, title: "목적", clauses: [{ label: "", text: "", items: [] }], refs: [] }],
      },
    ],
    addendum: [
      { key: "addendum-1", no: 0, title: "", clauses: [{ label: "", text: "이 규정은 공포한 날부터 시행한다.", items: [] }], refs: [] },
    ],
    appendices: [],
    history: [],
  };
}
