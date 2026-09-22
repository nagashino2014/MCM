// 내부 규정 임포트(2026-09-22) — HWPX · DOCX · TXT/MD → 조문 IR + 머리 정보 → 인덱스 서열 자동 교정.
// 기존 참고자료(한글·워드)나 LLM 이 만든 초안(마크다운·텍스트)을 바로 편집 화면에 올리는 용도다.
// 사규 임포트(import.ts)와 같은 결정론 파싱(LLM 미사용)이고, 끝에 normalizeRuleBody 로 번호 서열을 바로잡는다.
// DB 는 건드리지 않는다 — 결과를 편집 화면이 받아 사람이 확인한 뒤 저장한다.

import JSZip from "jszip";
import { childrenOf, findAll, findOne, parseHwpx, parseXml, type Para, type Table, type XNode } from "@/lib/deliverable/hwpx-doc";
import { normalizeText, normalizeTitle, splitClauses } from "./import";
import { clauseNo, itemHead, normalizeRuleBody } from "./normalize";
import type { RuleAppendix, RuleArticle, RuleBody, RuleChapter, RuleClause, RuleTable } from "./types";

/** 파서 입력 한 줄 — 문단 텍스트 또는 표 */
interface Entry {
  text: string;
  table?: RuleTable;
}

export interface InternalImportMeta {
  title: string | null;
  regNo: number | null;
  ownerDept: string | null;
  approver: string | null;
  enactedDate: string | null;
  effectiveDate: string | null;
}

export interface InternalImportResult {
  body: RuleBody;
  meta: InternalImportMeta;
  corrections: string[];
  warnings: string[];
  stats: { chapters: number; articles: number; addendum: number; appendices: number; tables: number };
}

// ── 파일 → Entry[] ──

function hwpxParaText(p: Para): string {
  return p.runs.map((r) => r.text).join("");
}

function hwpxTable(t: Table): RuleTable {
  const rows: RuleTable["rows"] = [];
  for (const c of t.cells) {
    const text = normalizeText(c.paragraphs.map(hwpxParaText).join("\n"));
    while (rows.length <= c.row) rows.push([]);
    rows[c.row].push({ text, colSpan: c.colSpan, rowSpan: c.rowSpan });
  }
  return { rows };
}

async function entriesFromHwpx(bytes: Uint8Array): Promise<Entry[]> {
  const doc = await parseHwpx(bytes);
  const out: Entry[] = [];
  for (const p of doc.pages.flat()) {
    for (const t of p.tables) out.push({ text: "", table: hwpxTable(t) });
    const text = normalizeText(hwpxParaText(p));
    if (text) out.push({ text });
  }
  return out;
}

// DOCX 자동 번호(목록) — 워드·LLM 산출물은 '1.' '가.' 를 글자가 아니라 번호 매기기로 넣는 경우가 많다.
// numbering.xml 의 수준별 형식(lvlText·numFmt)을 따라 번호 글자를 되살려야 호·목 구조가 보존된다.
interface NumLevel {
  fmt: string;
  text: string;
  start: number;
}

const GANADA = "가나다라마바사아자차카타파하";
const CHOSUNG = "ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ";
const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";

function fmtNum(n: number, fmt: string): string {
  switch (fmt) {
    case "ganada":
      return GANADA[n - 1] ?? String(n);
    case "chosung":
      return CHOSUNG[n - 1] ?? String(n);
    case "decimalEnclosedCircle":
    case "decimalEnclosedCircleChinese":
      return CIRCLED[n - 1] ?? String(n);
    case "lowerLetter":
      return String.fromCharCode(96 + n);
    case "upperLetter":
      return String.fromCharCode(64 + n);
    case "lowerRoman":
    case "upperRoman": {
      const r = ["", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"][n] ?? String(n);
      return fmt === "upperRoman" ? r.toUpperCase() : r;
    }
    default:
      return String(n);
  }
}

function wAttr(n: XNode | null, name = "w:val"): string | null {
  return n?.attrs[name] ?? null;
}

async function loadNumbering(zip: JSZip): Promise<Map<string, NumLevel[]>> {
  const out = new Map<string, NumLevel[]>();
  const file = zip.file("word/numbering.xml");
  if (!file) return out;
  const root = parseXml(await file.async("string"));
  const abstract = new Map<string, NumLevel[]>();
  for (const an of findAll(root, "w:abstractNum")) {
    const levels: NumLevel[] = [];
    for (const lvl of childrenOf(an, "w:lvl")) {
      const ilvl = Number(lvl.attrs["w:ilvl"] ?? 0);
      levels[ilvl] = {
        fmt: wAttr(findOne(lvl, "w:numFmt")) ?? "decimal",
        text: wAttr(findOne(lvl, "w:lvlText")) ?? "",
        start: Number(wAttr(findOne(lvl, "w:start")) ?? 1),
      };
    }
    abstract.set(an.attrs["w:abstractNumId"] ?? "", levels);
  }
  for (const num of findAll(root, "w:num")) {
    const aid = wAttr(findOne(num, "w:abstractNumId"));
    if (aid != null && abstract.has(aid)) out.set(num.attrs["w:numId"] ?? "", abstract.get(aid)!);
  }
  return out;
}

/** 문단 스타일에 걸린 번호 매기기(스타일 'List Number' 등) — styles.xml 의 basedOn 체인까지 따라간다. */
async function loadStyleNumbering(zip: JSZip): Promise<Map<string, { numId: string; ilvl: number }>> {
  const out = new Map<string, { numId: string; ilvl: number }>();
  const file = zip.file("word/styles.xml");
  if (!file) return out;
  const root = parseXml(await file.async("string"));
  const own = new Map<string, { numId: string | null; ilvl: number; basedOn: string | null }>();
  for (const st of findAll(root, "w:style")) {
    const pPr = childrenOf(st, "w:pPr")[0];
    const numPr = pPr ? findOne(pPr, "w:numPr") : null;
    own.set(st.attrs["w:styleId"] ?? "", {
      numId: numPr ? wAttr(findOne(numPr, "w:numId")) : null,
      ilvl: Number((numPr && wAttr(findOne(numPr, "w:ilvl"))) ?? 0),
      basedOn: wAttr(childrenOf(st, "w:basedOn")[0] ?? null),
    });
  }
  for (const id of own.keys()) {
    let cur: string | null = id;
    for (let guard = 0; cur && guard < 10; guard += 1) {
      const st = own.get(cur);
      if (!st) break;
      if (st.numId) {
        out.set(id, { numId: st.numId, ilvl: st.ilvl });
        break;
      }
      cur = st.basedOn;
    }
  }
  return out;
}

function docxRunText(p: XNode): string {
  let s = "";
  const walk = (n: XNode) => {
    for (const k of n.kids) {
      if (k.tag === "w:t") s += k.kids.filter((x) => x.tag === "#text").map((x) => x.attrs.v).join("");
      else if (k.tag === "w:tab") s += " ";
      else if (k.tag === "w:br" || k.tag === "w:cr") s += "\n";
      else if (k.tag !== "w:pPr" && k.tag !== "w:rPr") walk(k);
    }
  };
  walk(p);
  return s;
}

async function entriesFromDocx(bytes: Uint8Array): Promise<Entry[]> {
  const zip = await JSZip.loadAsync(bytes);
  const main = zip.file("word/document.xml");
  if (!main) throw new Error("DOCX 본문(word/document.xml)을 찾지 못했습니다.");
  const numbering = await loadNumbering(zip);
  const styleNumbering = await loadStyleNumbering(zip);
  const counters = new Map<string, number[]>();
  const root = parseXml(await main.async("string"));
  const body = findOne(root, "w:body");
  if (!body) return [];

  const paraText = (p: XNode): string => {
    let prefix = "";
    const pPr = childrenOf(p, "w:pPr")[0] ?? null;
    const numPr = pPr ? findOne(pPr, "w:numPr") : null;
    const styleNum = styleNumbering.get(wAttr(pPr ? findOne(pPr, "w:pStyle") : null) ?? "");
    const numId = (numPr && wAttr(findOne(numPr, "w:numId"))) ?? styleNum?.numId ?? null;
    if (numId && numId !== "0" && numbering.has(numId)) {
      const levels = numbering.get(numId)!;
      const ilvlRaw = numPr ? wAttr(findOne(numPr, "w:ilvl")) : null;
      const ilvl = ilvlRaw != null ? Number(ilvlRaw) : styleNum?.ilvl ?? 0;
      const c = counters.get(numId) ?? [];
      c[ilvl] = (c[ilvl] ?? (levels[ilvl]?.start ?? 1) - 1) + 1;
      c.length = ilvl + 1; // 하위 수준 카운터 초기화
      counters.set(numId, c);
      const lv = levels[ilvl];
      if (lv && lv.fmt !== "bullet" && lv.fmt !== "none") {
        prefix = lv.text.replace(/%(\d)/g, (_, d: string) => {
          const i = Number(d) - 1;
          return fmtNum(c[i] ?? levels[i]?.start ?? 1, levels[i]?.fmt ?? "decimal");
        });
        if (prefix) prefix += " ";
      }
    }
    return normalizeText(prefix + docxRunText(p));
  };

  const tableOf = (tbl: XNode): RuleTable => {
    const rows: RuleTable["rows"] = [];
    const merges: (RuleTable["rows"][number][number] | null)[] = []; // 열 위치별 세로 병합 시작 셀
    childrenOf(tbl, "w:tr").forEach((tr) => {
      const row: RuleTable["rows"][number] = [];
      let col = 0;
      for (const tc of childrenOf(tr, "w:tc")) {
        const pr = findOne(tc, "w:tcPr");
        const span = Number(wAttr(pr ? findOne(pr, "w:gridSpan") : null) ?? 1) || 1;
        const vm = pr ? findOne(pr, "w:vMerge") : null;
        const text = normalizeText(childrenOf(tc, "w:p").map((p) => paraText(p)).join("\n"));
        if (vm && (vm.attrs["w:val"] ?? "continue") === "continue" && merges[col]) {
          merges[col]!.rowSpan += 1;
        } else {
          const cell = { text, colSpan: span, rowSpan: 1 };
          row.push(cell);
          merges[col] = vm ? cell : null;
        }
        col += span;
      }
      rows.push(row);
    });
    return { rows };
  };

  const out: Entry[] = [];
  const walkBody = (node: XNode) => {
    for (const k of node.kids) {
      if (k.tag === "w:p") {
        for (const line of paraText(k).split("\n")) {
          const t = normalizeText(line);
          if (t) out.push({ text: t });
        }
      } else if (k.tag === "w:tbl") {
        out.push({ text: "", table: tableOf(k) });
      } else if (k.tag === "w:sdt" || k.tag === "w:sdtContent") {
        walkBody(k); // 콘텐츠 컨트롤 안의 문단
      }
    }
  };
  walkBody(body);
  return out;
}

/** 마크다운·텍스트 — LLM 초안의 머리표(#)·굵게(**)·글머리(-, *)를 걷어내고 표(|…|)는 표로 받는다. */
function entriesFromText(raw: string): Entry[] {
  const out: Entry[] = [];
  const lines = raw.replace(/^﻿/, "").split(/\r?\n/);
  let tableRows: string[][] = [];
  const flushTable = () => {
    if (tableRows.length) {
      out.push({ text: "", table: { rows: tableRows.map((r) => r.map((text) => ({ text, colSpan: 1, rowSpan: 1 }))) } });
      tableRows = [];
    }
  };
  for (const line of lines) {
    const t = line.trim();
    if (/^\|.*\|$/.test(t)) {
      const cells = t.slice(1, -1).split("|").map((c) => normalizeText(c.replace(/\*\*|__|`/g, "")));
      if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) tableRows.push(cells); // 구분 행(|---|) 제외
      continue;
    }
    flushTable();
    const cleaned = t
      .replace(/^#{1,6}\s+/, "")
      .replace(/^>\s?/, "")
      .replace(/^[-*+•]\s+/, "")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/__(.+?)__/g, "$1")
      .replace(/`([^`]*)`/g, "$1");
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(cleaned)) continue; // 수평선
    const text = normalizeText(cleaned);
    if (text) out.push({ text });
  }
  flushTable();
  return out;
}

// ── 머리 정보 ──

function toIsoDate(raw: string): string | null {
  const m = /(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/.exec(raw);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

function toRegNo(raw: string): number | null {
  const m = /제\s*(\d{1,6})\s*호/.exec(raw) ?? /(\d{1,6})/.exec(raw);
  return m ? Number(m[1]) || null : null;
}

const META_LABELS: Record<string, keyof InternalImportMeta> = {
  규정번호: "regNo",
  제정일: "enactedDate",
  제정일자: "enactedDate",
  주관부서: "ownerDept",
  소관부서: "ownerDept",
  담당부서: "ownerDept",
  승인: "approver",
  승인자: "approver",
  승인권자: "approver",
  시행일: "effectiveDate",
  시행일자: "effectiveDate",
};

function setMeta(meta: InternalImportMeta, key: keyof InternalImportMeta, value: string): void {
  const v = value.trim();
  if (!v || meta[key] != null) return;
  if (key === "regNo") meta.regNo = toRegNo(v);
  else if (key === "enactedDate" || key === "effectiveDate") meta[key] = toIsoDate(v);
  else if (key !== "title") meta[key] = v;
}

/** 머리 표(규정번호 | … | 제정일 | …) — 라벨 셀 다음 셀이 값이다. */
function metaFromTable(t: RuleTable, meta: InternalImportMeta): boolean {
  let hit = false;
  for (const row of t.rows) {
    for (let i = 0; i < row.length - 1; i += 1) {
      const key = META_LABELS[row[i].text.replace(/\s+/g, "")];
      if (key) {
        setMeta(meta, key, row[i + 1].text);
        hit = true;
      }
    }
  }
  return hit;
}

// ── Entry[] → 조문 IR ──

const RE_CHAPTER = /^제\s*(\d+)\s*장\s*(.*)$/;
const RE_ARTICLE_BRACKET = /^제\s*(\d+)\s*조(?:\s*의\s*\d+)?\s*[【[(（]\s*([^】\])）]*?)\s*[】\])）]\s*(.*)$/;
const RE_ARTICLE_PLAIN = /^제\s*(\d+)\s*조(?:\s*의\s*\d+)?\s*(.*)$/;
const RE_ADDENDUM = /^부\s*칙(?:\s*[<〈(（[].*[>〉)）\]])?\s*(.*)$/;
const RE_APPENDIX = /^\[\s*(별표|별지)\s*(?:제\s*)?(\d+)\s*(?:호)?\s*(?:서식)?\s*\]?\s*[.]?\s*(.*)$/;
const RE_APPENDIX_PLAIN = /^(별표|별지)\s*(?:제\s*)?(\d+)\s*(?:호)?\s*(?:서식)?\s*[.]?\s*(.*)$/;
const RE_META_LINE = /^(규정번호|제정일자?|주관부서|소관부서|담당부서|승인(?:자|권자)?|시행일자?)\s*[:：]\s*(.+)$/;

/** '제1조 목적' 처럼 괄호 없는 제목 — 짧고 문장 끝이 아니면 제목으로 본다. */
function splitPlainArticle(rest: string): { title: string; rest: string } {
  const t = rest.trim();
  if (!t) return { title: "", rest: "" };
  const m = /^(\S{1,15}(?:\s\S{1,10}){0,2})\s{2,}(.*)$/.exec(t); // 제목 뒤 공백 둘 이상
  if (m) return { title: m[1], rest: m[2] };
  if (t.length <= 20 && !/[다.。]$/.test(t)) return { title: t, rest: "" };
  return { title: "", rest: t };
}

function parseEntries(entries: Entry[]): { body: RuleBody; meta: InternalImportMeta; warnings: string[]; tables: number } {
  const meta: InternalImportMeta = { title: null, regNo: null, ownerDept: null, approver: null, enactedDate: null, effectiveDate: null };
  const warnings: string[] = [];
  const chapters: RuleChapter[] = [];
  const addendum: RuleArticle[] = [];
  const appendices: RuleAppendix[] = [];
  let section: "pre" | "body" | "addendum" | "appendix" = "pre";
  let chapter: RuleChapter | null = null;
  let article: RuleArticle | null = null;
  let clause: RuleClause | null = null;
  let appendix: RuleAppendix | null = null;
  let tables = 0;
  const preamble: string[] = [];

  const ensureClause = (): RuleClause => {
    if (clause) return clause;
    const c: RuleClause = { label: "", text: "", items: [] };
    article!.clauses.push(c);
    clause = c;
    return c;
  };

  const appendText = (text: string) => {
    if (!article) return;
    // 문단 머리의 항 기호는 번호가 어긋나도(②를 건너뛴 ③ 등) 새 항으로 받는다 — 번호는 교정 단계가 바로잡는다.
    const lead = /^[①-⑳❶-➓]/u.exec(text);
    const prevNo = lead ? clauseNo(lead[0]) - 1 : clause?.label ? clauseNo(clause.label) : 0;
    for (const seg of splitClauses(text, prevNo)) {
      if (seg.label) {
        clause = { label: seg.label, text: "", items: [] };
        article.clauses.push(clause);
        if (seg.text) appendText(seg.text); // 항 머리 뒤에 바로 호가 오는 경우까지 같은 규칙으로
        continue;
      }
      if (!seg.text) continue;
      const cur = ensureClause();
      if (itemHead(seg.text)) cur.items.push(seg.text);
      else if (cur.items.length) cur.items[cur.items.length - 1] += ` ${seg.text}`;
      else cur.text = cur.text ? `${cur.text} ${seg.text}` : seg.text;
    }
  };

  const startArticle = (no: number, title: string, rest: string) => {
    clause = null;
    const inAddendum = section === "addendum";
    article = { key: inAddendum ? `addendum-${no}` : `art-${no}`, no, title: normalizeTitle(title), clauses: [], refs: [] };
    if (inAddendum) {
      addendum.push(article);
    } else {
      section = "body";
      if (!chapter) {
        chapter = { no: 0, title: "(장 미지정)", articles: [] };
        chapters.push(chapter);
      }
      chapter.articles.push(article);
    }
    if (rest.trim()) appendText(normalizeText(rest));
  };

  for (const e of entries) {
    if (e.table) {
      tables += 1;
      if (section === "pre") {
        if (!metaFromTable(e.table, meta)) warnings.push("본문 앞의 표 1개를 건너뛰었습니다(머리 정보 표가 아님).");
      } else if (section === "appendix" && appendix) {
        appendix.tables.push(e.table);
      } else if (article) {
        (article.tables ??= []).push(e.table);
      }
      continue;
    }
    const text = e.text;

    // 머리 정보 한 줄('주관부서: 품질관리팀')
    const mMeta = RE_META_LINE.exec(text);
    if (mMeta && section === "pre") {
      const key = META_LABELS[mMeta[1]];
      if (key) setMeta(meta, key, mMeta[2]);
      continue;
    }

    // 별표·별지 — 부칙 뒤이거나 대괄호 표기일 때만(본문의 '별표 1에 따른다'는 인용)
    const mAppB = RE_APPENDIX.exec(text);
    const mAppP = section === "addendum" || section === "appendix" ? RE_APPENDIX_PLAIN.exec(text) : null;
    const mApp = mAppB ?? mAppP;
    if (mApp && section !== "pre") {
      article = null;
      clause = null;
      section = "appendix";
      const title = normalizeTitle(`${mApp[1] === "별지" ? `별지 제${mApp[2]}호 ` : ""}${mApp[3].replace(/^[\].\s]+/, "").replace(/[\])】]\s*$/, "")}`);
      appendix = { key: `appendix-${appendices.length + 1}`, no: appendices.length + 1, title, paras: [], tables: [] };
      appendices.push(appendix);
      continue;
    }
    if (section === "appendix") {
      appendix?.paras.push(text);
      continue;
    }

    // 부칙
    const mAdd = RE_ADDENDUM.exec(text);
    if (mAdd && (mAdd[1] === "" || !/^[을를이가은는의에]/.test(mAdd[1]))) {
      section = "addendum";
      chapter = null;
      article = null;
      clause = null;
      if (mAdd[1].trim()) {
        article = { key: "addendum-0", no: 0, title: "", clauses: [], refs: [] };
        addendum.push(article);
        appendText(normalizeText(mAdd[1]));
      }
      continue;
    }

    // 장
    const mCh = RE_CHAPTER.exec(text);
    if (mCh && section !== "addendum") {
      section = "body";
      chapter = { no: Number(mCh[1]), title: normalizeTitle(mCh[2]), articles: [] };
      chapters.push(chapter);
      article = null;
      clause = null;
      continue;
    }

    // 조
    const mArtB = RE_ARTICLE_BRACKET.exec(text);
    if (mArtB) {
      startArticle(Number(mArtB[1]), mArtB[2], mArtB[3]);
      continue;
    }
    const mArtP = RE_ARTICLE_PLAIN.exec(text);
    if (mArtP) {
      const { title, rest } = splitPlainArticle(mArtP[2]);
      startArticle(Number(mArtP[1]), title, rest);
      continue;
    }

    if (section === "pre") {
      preamble.push(text);
      continue;
    }
    if (section === "addendum" && !article) {
      // 조 없이 문장만 있는 부칙 — '이 규정은 … 시행한다.'
      article = { key: "addendum-0", no: 0, title: "", clauses: [], refs: [] };
      addendum.push(article);
    }
    if (!article) {
      // 장 표제 뒤, 첫 조 앞의 문장 — 버리지 않고 경고로 남긴다
      warnings.push(`조문 밖의 문장을 건너뛰었습니다: "${text.slice(0, 40)}${text.length > 40 ? "…" : ""}"`);
      continue;
    }
    appendText(text);
  }

  // 제목 — 본문 앞 첫 줄 중 규정 이름다운 것('…규정'·'…지침'·'…세칙' 등으로 끝나는 줄 우선)
  const cand = preamble.find((l) => /(규정|규칙|지침|세칙|기준|요령|정책|방침)$/.test(l) && l.length <= 60) ?? preamble[0] ?? null;
  meta.title = cand ? normalizeText(cand) : null;

  for (const ch of chapters) for (const a of ch.articles) for (const c of a.clauses) c.text = normalizeText(c.text);
  return { body: { chapters, addendum, appendices, history: [] }, meta, warnings, tables };
}

/** 파일 종류별 진입점 — 확장자로 판별한다. */
export async function importInternalRule(fileName: string, bytes: Uint8Array): Promise<InternalImportResult> {
  const ext = (/\.([a-z0-9]+)$/i.exec(fileName)?.[1] ?? "").toLowerCase();
  let entries: Entry[];
  if (ext === "hwpx") entries = await entriesFromHwpx(bytes);
  else if (ext === "docx") entries = await entriesFromDocx(bytes);
  else if (ext === "txt" || ext === "md" || ext === "markdown") entries = entriesFromText(new TextDecoder("utf-8").decode(bytes));
  else if (ext === "hwp") throw new Error("HWP(구형) 파일은 읽을 수 없습니다. 한글에서 '다른 이름으로 저장 → HWPX'로 바꿔 올려 주세요.");
  else if (ext === "doc") throw new Error("DOC(구형) 파일은 읽을 수 없습니다. 워드에서 DOCX 로 저장해 올려 주세요.");
  else throw new Error("HWPX · DOCX · TXT · MD 파일만 가져올 수 있습니다.");

  const parsed = parseEntries(entries);
  const normalized = normalizeRuleBody(parsed.body);
  const body = normalized.body;
  return {
    body,
    meta: parsed.meta,
    corrections: normalized.corrections,
    warnings: [...parsed.warnings, ...normalized.warnings],
    stats: {
      chapters: body.chapters.filter((c) => c.no > 0).length,
      articles: body.chapters.reduce((n, c) => n + c.articles.length, 0),
      addendum: body.addendum.length,
      appendices: body.appendices.length,
      tables: parsed.tables,
    },
  };
}
