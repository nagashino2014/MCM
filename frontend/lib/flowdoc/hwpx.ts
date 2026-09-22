// 흐름형 문서 HWPX 작성기(2026-09-22) — 내부고시·내부 규정의 한글 편집용 사본.
// 공문 템플릿(public/hwpx/letter.hwpx)의 용지 설정(secPr)·서식 목록(header.xml)·로고 머리 표를 빌리고,
// 본문은 블록(문단·표·구분선·서명줄)을 받아 문단 XML 로 흘려 넣는다(쪽 나눔은 한글이 계산).
// 공문 렌더러(lib/letter/hwpx.ts)는 1장 고정 양식을 토큰 치환하지만, 이 작성기는 템플릿 본문을
// 통째로 버리고 새로 쓴다 — 여러 쪽 문서(규정 전문)를 만들 수 있게 하기 위해서다.
// 공식 산출물은 PDF 이고 HWPX 는 편집용 사본이다(한글이 줄 배치를 다시 계산하므로 픽셀 동일은 아님).

import JSZip from "jszip";
import {
  LINESEG_RE,
  appendToList,
  approxTextWidthPt,
  attrOf,
  buildTableXml,
  escapeXml,
  extractTableTemplate,
  findParagraphWith,
  loadTemplate,
  registerBorderFill,
  registerCharPr,
  type TableTemplate,
} from "@/lib/letter/hwpx";
import type { TextRun } from "@/lib/letter/types";
import type { FlowBlock } from "./types";

export interface FlowHwpxOptions {
  /** 공문 머리(로고 + 사명) 표를 첫 문단에 둔다 — 내부고시 */
  letterHead?: boolean;
  /** 쪽 번호(아래 가운데) */
  pageNumbers?: boolean;
}

const HWP_PER_PT = 100;
/** A4 용지 폭 59528 - 좌 5669 - 우 5102(템플릿 secPr) */
const COLUMN_W_HWP = 48757;
const DEFAULT_PT = 11;

/** 여는 태그 위치에서 같은 태그의 짝 닫는 태그 끝까지(중첩 고려) */
function blockEnd(xml: string, start: number, tag: string): number {
  const re = new RegExp(`<${tag}\\b[^>]*?(/?)>|</${tag}>`, "g");
  re.lastIndex = start;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    if (m[0].startsWith(`</`)) {
      depth -= 1;
      if (depth === 0) return m.index + m[0].length;
    } else if (m[1] !== "/") {
      depth += 1;
    } else if (depth === 0) {
      return m.index + m[0].length;
    }
  }
  return xml.length;
}

/** 문단 안의 최상위 run 목록 */
function topRuns(pXml: string): string[] {
  const out: string[] = [];
  const open = pXml.indexOf(">") + 1;
  let i = open;
  while (true) {
    const s = pXml.indexOf("<hp:run", i);
    if (s < 0) break;
    const e = blockEnd(pXml, s, "hp:run");
    out.push(pXml.slice(s, e));
    i = e;
  }
  return out;
}

export async function renderFlowHwpx(blocks: FlowBlock[], opts: FlowHwpxOptions = {}): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(await loadTemplate("letter.hwpx"));
  const sectionPath = "Contents/section0.xml";
  const headerPath = "Contents/header.xml";
  let xml = ((await zip.file(sectionPath)?.async("string")) ?? "").replace(LINESEG_RE, "");
  let headerXml = (await zip.file(headerPath)?.async("string")) ?? "";
  if (!xml || !headerXml) throw new Error("letter.hwpx 템플릿을 읽지 못했습니다");

  // 서체 통일 — 맑은 고딕(공문 렌더러와 같은 규칙)
  const malgun = /<hh:font\b[^>]*\bid="(\d+)"[^>]*face="맑은 고딕"/.exec(headerXml);
  if (malgun) {
    const fid = malgun[1];
    headerXml = headerXml.replace(
      /<hh:fontRef\b[^>]*\/>/g,
      () => `<hh:fontRef hangul="${fid}" latin="${fid}" hanja="${fid}" japanese="${fid}" other="${fid}" symbol="${fid}" user="${fid}"/>`
    );
  }

  // ── 기준 서식 — 템플릿 {{BODY}} 문단 ──
  const bodyP = findParagraphWith(xml, "{{BODY}}");
  if (!bodyP) throw new Error("letter.hwpx 템플릿에 {{BODY}} 문단이 없습니다");
  const baseParaPr = attrOf(bodyP, "hp:p", "paraPrIDRef") ?? "0";
  const baseCharPr = attrOf(bodyP, "hp:run", "charPrIDRef") ?? "0";

  // 인감 그림(정사각에 가까운 hp:pic) — 서명줄에 다시 쓴다
  let stampPic: string | null = null;
  for (const m of xml.matchAll(/<hp:pic\b[\s\S]*?<\/hp:pic>/g)) {
    const w = Number(attrOf(m[0], "hp:orgSz", "width") ?? 0);
    const h = Number(attrOf(m[0], "hp:orgSz", "height") ?? 0);
    if (w > 0 && h > 0 && w / h < 1.4) stampPic = m[0];
  }

  // ── 표 골격 — 공문 렌더러와 같은 경로({{S_TABLE}} 카탈로그 → 없으면 기존 표를 빌려 4변 실선) ──
  let tableTpl: TableTemplate | null;
  {
    const ex = extractTableTemplate(xml);
    xml = ex.xml;
    tableTpl = ex.tpl;
  }
  if (!tableTpl) {
    const anyTblM = /<hp:tbl\b[\s\S]*?<\/hp:tbl>/.exec(xml);
    const tcM = anyTblM ? /<hp:tc\b[\s\S]*?<\/hp:tc>/.exec(anyTblM[0]) : null;
    const solid = registerBorderFill(headerXml, true);
    if (anyTblM && tcM && solid) {
      headerXml = solid.xml;
      const firstTr = anyTblM[0].indexOf("<hp:tr");
      const preamble = (firstTr >= 0 ? anyTblM[0].slice(0, firstTr) : anyTblM[0]).replace(
        /(<hp:tbl\b[^>]*\bborderFillIDRef=")\d+(")/,
        `$1${solid.id}$2`
      );
      tableTpl = {
        preamble,
        tcTpl: tcM[0].replace(/(\bborderFillIDRef=")\d+(")/, `$1${solid.id}$2`),
        wrapP: `<hp:p id="0" paraPrIDRef="${baseParaPr}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="${baseCharPr}">__TBL__</hp:run></hp:p>`,
      };
    }
  }

  // ── 서식 등록 헬퍼(목록 끝 append — 한글은 id 가 아니라 목록 순서로 참조한다) ──
  const nextId = (tag: string): string => {
    let max = 0;
    for (const m of headerXml.matchAll(new RegExp(`<${tag}\\b[^>]*\\bid="(\\d+)"`, "g"))) max = Math.max(max, Number(m[1]));
    return String(max + 1);
  };

  const paraCache = new Map<string, string>();
  const paraPr = (p: { align?: "left" | "center" | "right"; leftPt?: number; indentPt?: number; spaceBeforePt?: number; borderFill?: string }): string => {
    const key = JSON.stringify(p);
    const hit = paraCache.get(key);
    if (hit) return hit;
    const base = new RegExp(`<hh:paraPr\\b[^>]*\\bid="${baseParaPr}"[\\s\\S]*?</hh:paraPr>`).exec(headerXml);
    if (!base) return baseParaPr;
    const id = nextId("hh:paraPr");
    const horizontal = p.align === "center" ? "CENTER" : p.align === "right" ? "RIGHT" : "JUSTIFY";
    let clone = base[0]
      .replace(/(<hh:paraPr\b[^>]*\bid=")\d+(")/, `$1${id}$2`)
      .replace(/(<hh:align\b[^>]*horizontal=")[^"]*(")/, `$1${horizontal}$2`)
      .replace(/(<hc:intent\b[^>]*value=")[^"]*(")/, `$1${Math.round((p.indentPt ?? 0) * HWP_PER_PT)}$2`)
      .replace(/(<hc:left\b[^>]*value=")[^"]*(")/, `$1${Math.round((p.leftPt ?? 0) * HWP_PER_PT)}$2`)
      .replace(/(<hc:prev\b[^>]*value=")[^"]*(")/, `$1${Math.round((p.spaceBeforePt ?? 0) * HWP_PER_PT)}$2`)
      .replace(/(<hh:lineSpacing\b[^>]*value=")\d+(")/, `$1160$2`);
    if (p.borderFill) clone = clone.replace(/(<hh:border\b[^>]*borderFillIDRef=")\d+(")/, `$1${p.borderFill}$2`);
    const next = appendToList(headerXml, "</hh:paraProperties>", "hh:paraProperties", clone);
    if (!next) return baseParaPr;
    headerXml = next;
    paraCache.set(key, id);
    return id;
  };

  const charCache = new Map<string, string>();
  const charPr = (sizePt: number, bold: boolean): string => {
    const key = `${sizePt}|${bold}`;
    const hit = charCache.get(key);
    if (hit) return hit;
    const reg = registerCharPr(headerXml, baseCharPr, { heightPt: sizePt, bold });
    if (!reg) return baseCharPr;
    headerXml = reg.xml;
    charCache.set(key, reg.id);
    return reg.id;
  };

  const registerFill = (xmlFill: (id: string) => string): string | null => {
    const id = nextId("hh:borderFill");
    const next = appendToList(headerXml, "</hh:borderFills>", "hh:borderFills", xmlFill(id));
    if (!next) return null;
    headerXml = next;
    return id;
  };
  const NONE_EDGE = 'type="NONE" width="0.1 mm" color="#000000"';
  const SOLID_EDGE = 'type="SOLID" width="0.12 mm" color="#000000"';
  const fillHead = (id: string) =>
    `<hh:borderFill id="${id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">` +
    '<hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>';

  let ruleFill: string | null = null;
  let shadeFill: string | null = null;

  const runsXml = (runs: TextRun[], sizePt: number, bold: boolean): string => {
    const list = runs.length ? runs : [{ text: "" }];
    return list
      .map((r) => `<hp:run charPrIDRef="${charPr(sizePt, bold || !!r.bold)}"><hp:t>${escapeXml(r.text)}</hp:t></hp:run>`)
      .join("");
  };
  const pXml = (pp: string, inner: string) =>
    `<hp:p id="0" paraPrIDRef="${pp}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${inner}</hp:p>`;

  // ── 본문 생성 ──
  const out: string[] = [];
  /** 직전 문단의 한 줄 높이(pt) — 서명줄 직인을 윗 문단 기준으로 내려 찍을 때 쓴다 */
  let lastLineHPt = 0;
  for (const b of blocks) {
    if (b.kind === "p") {
      // 한글 내어쓰기(음수 intent)는 첫 줄이 왼쪽 여백에 서고 둘째 줄부터 |intent| 만큼 들어간다 →
      // 블록 규약(모든 줄 = leftPt, 첫 줄 = leftPt + indentPt)에 맞추려면 여백을 첫 줄 위치로 옮긴다.
      const ind = b.indentPt ?? 0;
      const pp = paraPr({
        align: b.align,
        leftPt: ind < 0 ? Math.max(0, (b.leftPt ?? 0) + ind) : b.leftPt,
        indentPt: ind,
        spaceBeforePt: b.spaceBeforePt,
      });
      out.push(pXml(pp, runsXml(b.runs, b.sizePt ?? DEFAULT_PT, !!b.bold)));
      lastLineHPt = (b.sizePt ?? DEFAULT_PT) * 1.6;
    } else if (b.kind === "rule") {
      // 굵은 구분선 = 아래 테두리만 있는 빈 문단(공문 템플릿의 선 문단과 같은 기법)
      ruleFill ??= registerFill(
        (id) =>
          fillHead(id) +
          `<hh:leftBorder ${NONE_EDGE}/><hh:rightBorder ${NONE_EDGE}/><hh:topBorder ${NONE_EDGE}/>` +
          '<hh:bottomBorder type="SOLID" width="0.7 mm" color="#000000"/><hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/></hh:borderFill>'
      );
      const pp = paraPr({ spaceBeforePt: b.spaceBeforePt, borderFill: ruleFill ?? undefined });
      out.push(pXml(pp, `<hp:run charPrIDRef="${charPr(4, false)}"><hp:t></hp:t></hp:run>`));
      out.push(pXml(paraPr({}), `<hp:run charPrIDRef="${charPr(6, false)}"><hp:t></hp:t></hp:run>`));
    } else if (b.kind === "table") {
      if (!tableTpl) continue;
      const size = b.sizePt ?? DEFAULT_PT;
      const alignOf = (a: "CENTER" | "RIGHT") => paraPr({ align: a === "CENTER" ? "center" : "right" });
      let tbl = buildTableXml(b.table, tableTpl, size, charPr(size, false), charPr(size, true), alignOf);
      if (b.shadeCols?.length) {
        shadeFill ??= registerFill(
          (id) =>
            fillHead(id) +
            `<hh:leftBorder ${SOLID_EDGE}/><hh:rightBorder ${SOLID_EDGE}/><hh:topBorder ${SOLID_EDGE}/><hh:bottomBorder ${SOLID_EDGE}/>` +
            '<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>' +
            '<hc:fillBrush><hc:winBrush faceColor="#EDEDED" hatchColor="#000000" alpha="0"/></hc:fillBrush></hh:borderFill>'
        );
        if (shadeFill) {
          const cols = new Set(b.shadeCols);
          tbl = tbl.replace(/<hp:tc\b[\s\S]*?<\/hp:tc>/g, (tc) => {
            const col = Number(/<hp:cellAddr\b[^>]*colAddr="(\d+)"/.exec(tc)?.[1] ?? -1);
            return cols.has(col) ? tc.replace(/(<hp:tc\b[^>]*\bborderFillIDRef=")\d+(")/, `$1${shadeFill}$2`) : tc;
          });
        }
      }
      out.push(tbl);
    } else if (b.kind === "seal") {
      // '대표이사   이 유 억      (직인)' — 가운데 정렬. 직인 그림은 '(직인)' 위에 겹쳐 띄운다.
      const gap = "      ";
      const pp = paraPr({ align: "center", spaceBeforePt: b.spaceBeforePt });
      const inner = runsXml([{ text: `${b.text}${gap}${b.sealText}` }], b.sizePt, true);
      // 한글은 문단 기준(PARA) 그림의 음수 세로 오프셋을 0으로 붙인다(09-22 실측) → 직인은 윗 문단(사명 줄)에
      // 기준을 두고 '윗 줄 높이 + 서명 글자 중심 - 직인 높이/2' 만큼 내려 찍는다.
      if (b.stamp && stampPic && out.length && lastLineHPt > 0) {
        const stampW = Number(attrOf(stampPic, "hp:sz", "width") ?? 4903);
        const stampH = Number(attrOf(stampPic, "hp:sz", "height") ?? 4784);
        const full = approxTextWidthPt(`${b.text}${gap}${b.sealText}`, b.sizePt) * HWP_PER_PT;
        const before = approxTextWidthPt(`${b.text}${gap}`, b.sizePt) * HWP_PER_PT;
        const sealW = approxTextWidthPt(b.sealText, b.sizePt) * HWP_PER_PT;
        const horz = Math.max(0, Math.round((COLUMN_W_HWP - full) / 2 + before + sealW / 2 - stampW / 2));
        const vert = Math.max(0, Math.round((lastLineHPt + (b.spaceBeforePt ?? 0) + b.sizePt * 1.25) * HWP_PER_PT - stampH / 2)); // 1.25 = 한글 실측 보정(09-22)
        const pic = stampPic.replace(
          /<hp:pos\b[^>]*\/>/,
          `<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="0" allowOverlap="1" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="${vert}" horzOffset="${horz}"/>`
        );
        const prev = out[out.length - 1];
        out[out.length - 1] = prev.replace(/<\/hp:p>$/, `<hp:run charPrIDRef="${charPr(b.sizePt, true)}">${pic}</hp:run></hp:p>`);
      }
      out.push(pXml(pp, inner));
      lastLineHPt = b.sizePt * 1.6;
    }
  }

  // ── 첫 문단 — 용지 설정(secPr)·쪽 번호 컨트롤(+ 공문 머리 표) ──
  const firstStart = xml.indexOf("<hp:p ");
  const firstEnd = blockEnd(xml, firstStart, "hp:p");
  const firstP = xml.slice(firstStart, firstEnd);
  const runs = topRuns(firstP);
  const secRun = runs.find((r) => r.includes("<hp:secPr")) ?? "";
  let pageRun = runs.find((r) => r.includes("<hp:pageNum")) ?? "";
  if (pageRun && opts.pageNumbers) pageRun = pageRun.replace(/(<hp:pageNum\b[^>]*\bpos=")[^"]*(")/, `$1BOTTOM_CENTER$2`);
  const headRun = opts.letterHead ? runs.find((r) => r.includes("<hp:tbl")) ?? "" : "";
  const firstParaPr = opts.letterHead ? attrOf(firstP, "hp:p", "paraPrIDRef") ?? baseParaPr : paraPr({});
  const first = pXml(firstParaPr, `${secRun}${pageRun}${headRun}`);

  const prefix = xml.slice(0, firstStart);
  const section = `${prefix}${first}${out.join("")}</hs:sec>`;

  zip.file(sectionPath, section);
  zip.file(headerPath, headerXml);
  const mimetype = zip.file("mimetype");
  if (mimetype) zip.file("mimetype", await mimetype.async("uint8array"), { compression: "STORE" });
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
