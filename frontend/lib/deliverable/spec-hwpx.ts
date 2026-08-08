// DeliverableSpec → HWPX. 스캔 PDF 로 재구축한 양식(spec 모드)도 한글에서 손볼 수 있게 한다.
//
// HWPX 로 받은 양식은 원본에 값만 주입하면 되지만(template-fill.ts), 스캔본은 원본 구조가 없어
// 블록에서 문단·표 XML 을 **새로 만든다**. 재구축물이라 서식이 원본과 똑같지는 않지만,
// 한글에서 열어 고칠 수 있다는 점이 요점이다(사용자 요청).
//
// 골격(스타일 정의·용지 설정·인감 이미지)은 기본양식 템플릿에서 그대로 빌려 쓴다 —
// header.xml 을 새로 쓰는 것보다 안전하고, 글꼴·표 선 정의가 이미 실물과 맞춰져 있다.

import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { numberPrefix, renderBinding, renderSlot, renderTemplate, spreadName } from "./format";
import type { Align, CellSpec, DeliverableSpec, DeliverableValues, DocBlock, FieldRow } from "./types";

// 기본양식 템플릿(completion.hwpx) 의 스타일 id — 실물에서 확인한 값
const CHAR = {
  title: "7", //  24pt bold underline
  body: "8", //   12pt
  receiver: "11", // 24pt bold
  thBold: "15", // 11pt bold(표 머리)
  td: "16", //    11pt(표 본문)
} as const;
const PARA = { left: "0", center: "3" } as const;
const BORDER_SOLID = "2";

/** 본문 폭·표 폭(HWPUNIT) — 템플릿 secPr 기준(A4, 좌우 여백 5669) */
const BODY_WIDTH = 48188;
const TABLE_WIDTH = 47341;
const ROW_HEIGHT = 2800;
const LINE_HEIGHT_PT = 20;

function escapeXml(v: string): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const alignPara = (align?: Align): string => (align === "center" ? PARA.center : PARA.left);

function para(text: string, opts: { charPr?: string; align?: Align; paraPr?: string } = {}): string {
  const cp = opts.charPr ?? CHAR.body;
  const pp = opts.paraPr ?? alignPara(opts.align);
  return (
    `<hp:p id="0" paraPrIDRef="${pp}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
    `<hp:run charPrIDRef="${cp}"><hp:t>${escapeXml(text)}</hp:t></hp:run></hp:p>`
  );
}

const blankPara = (n = 1): string => Array.from({ length: Math.max(0, n) }, () => para("")).join("");

/** 라벨을 폭에 맞춰 벌려 쓴다 — 양식의 "계   약   명" 표기를 흉내낸다. */
function padLabel(label: string, width: number): string {
  const w = [...label].reduce((a, ch) => a + (/[\x00-\x7F]/.test(ch) ? 1 : 2), 0);
  return label + " ".repeat(Math.max(0, width - w));
}

function fieldsXml(block: Extract<DocBlock, { kind: "fields" }>, values: DeliverableValues): string {
  const labelWidth = Math.max(
    ...block.rows.map((r) => [...r.label].reduce((a, ch) => a + (/[\x00-\x7F]/.test(ch) ? 1 : 2), 0)),
    0
  );
  return block.rows
    .map((row, i) => {
      const value = renderSlot(row, values);
      // 값이 없는 줄(소제목 등)은 구분자를 붙이지 않는다 — "준 공 금 액(단위 : 원) :" 처럼 어색해진다
      const line = value
        ? `${numberPrefix(block.numbering, i)}${padLabel(row.label, labelWidth)} : ${value}`
        : `${numberPrefix(block.numbering, i)}${row.label}`;
      const second = row.secondLine ? renderSlot(row.secondLine, values) : "";
      // 값 둘째 줄(착수계 금액 등)은 값 시작 위치에 맞춰 들여쓴다
      return para(line) + (second ? para(" ".repeat(labelWidth + 5) + second) : "");
    })
    .join("");
}

function cellXml(cell: CellSpec, addr: { col: number; row: number }, size: { w: number; h: number }, values: DeliverableValues): string {
  const text = renderSlot(cell, values);
  const charPr = cell.bold ? CHAR.thBold : CHAR.td;
  const paraPr = cell.align === "left" ? PARA.left : PARA.center;
  return (
    `<hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="${BORDER_SOLID}">` +
    `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">` +
    para(text, { charPr, paraPr }) +
    `</hp:subList>` +
    `<hp:cellAddr colAddr="${addr.col}" rowAddr="${addr.row}"/>` +
    `<hp:cellSpan colSpan="${cell.colSpan ?? 1}" rowSpan="${cell.rowSpan ?? 1}"/>` +
    `<hp:cellSz width="${Math.round(size.w)}" height="${Math.round(size.h)}"/>` +
    `<hp:cellMargin left="510" right="510" top="141" bottom="141"/></hp:tc>`
  );
}

function tableXml(block: Extract<DocBlock, { kind: "table" }>, values: DeliverableValues): string {
  const colCnt = block.columns.length;
  const rowCnt = block.rows.length;
  if (!colCnt || !rowCnt) return "";
  const colW = block.columns.map((c) => (c.widthRatio > 0 ? c.widthRatio : 1 / colCnt) * TABLE_WIDTH);

  const trs = block.rows
    .map((row, r) => {
      // 병합에 가려지는 자리까지 배열에 들어 있으면(merged 표시) 한 칸씩 전진해야 한다.
      // colSpan 만큼 건너뛰면 그 자리를 두 번 세어 뒤 칸이 밀린다.
      const perCell = row.length === colCnt;
      let col = 0;
      const tcs: string[] = [];
      for (const cell of row) {
        const span = Math.max(1, cell.colSpan ?? 1);
        if (cell.merged) {
          col += 1;
          continue; // 병합에 가려지는 자리는 XML 에 넣지 않는다(cellSpan 이 대신 표현한다)
        }
        const w = colW.slice(col, col + span).reduce((a, b) => a + b, 0) || colW[col] || TABLE_WIDTH / colCnt;
        const h = ROW_HEIGHT * Math.max(1, cell.rowSpan ?? 1);
        tcs.push(cellXml(cell, { col, row: r }, { w, h }, values));
        col += perCell ? 1 : span;
      }
      return `<hp:tr>${tcs.join("")}</hp:tr>`;
    })
    .join("");

  const tbl =
    `<hp:tbl id="0" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" ` +
    `dropcapstyle="None" pageBreak="CELL" repeatHeader="1" rowCnt="${rowCnt}" colCnt="${colCnt}" cellSpacing="0" ` +
    `borderFillIDRef="${BORDER_SOLID}" noAdjust="0">` +
    `<hp:sz width="${TABLE_WIDTH}" widthRelTo="ABSOLUTE" height="${ROW_HEIGHT * rowCnt}" heightRelTo="ABSOLUTE" protect="0"/>` +
    `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" ` +
    `vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
    `<hp:outMargin left="283" right="283" top="283" bottom="283"/>${trs}</hp:tbl>`;

  // 표는 문단 안의 한 글자처럼 들어간다
  return (
    `<hp:p id="0" paraPrIDRef="${PARA.left}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
    `<hp:run charPrIDRef="${CHAR.body}">${tbl}<hp:t/></hp:run></hp:p>`
  );
}

/** 서명란 — 라벨을 맞춰 오른쪽에 몰아 쓴다(양식 관행). */
function signatureXml(block: Extract<DocBlock, { kind: "signature" }>, values: DeliverableValues, stampXml: string): string {
  const indent = " ".repeat(block.indentPt ? Math.round(block.indentPt / 5) : 30);
  const labelWidth = Math.max(
    ...block.rows.map((r) => [...r.label].reduce((a, ch) => a + (/[\x00-\x7F]/.test(ch) ? 1 : 2), 0)),
    0
  );
  return block.rows
    .map((row: FieldRow, i) => {
      // 대표자 성명은 벌려 쓰고, 그 줄에 인감을 붙인다(원본 양식의 관행)
      const isCeo = row.binding === "company.ceo";
      const raw = renderSlot(row, values);
      const value = isCeo ? `${spreadName(raw)}   (인)` : raw;
      const text = `${indent}${padLabel(row.label, labelWidth)} : ${value}`;
      const last = i === block.rows.length - 1;
      const stamp = block.stamp !== false && stampXml && (isCeo || (last && !block.rows.some((r) => r.binding === "company.ceo")));
      if (!stamp) return para(text);
      return (
        `<hp:p id="0" paraPrIDRef="${PARA.left}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
        `<hp:run charPrIDRef="${CHAR.body}"><hp:t>${escapeXml(text)}</hp:t>${stampXml}</hp:run></hp:p>`
      );
    })
    .join("");
}

/** 템플릿의 인감 그림을 글자처럼(treatAsChar) 흐르도록 바꿔 재사용한다. */
function inlineStamp(sectionXml: string): string {
  const m = /<hp:pic\b[\s\S]*?<\/hp:pic>/.exec(sectionXml);
  if (!m) return "";
  return m[0]
    .replace(/treatAsChar="0"/, 'treatAsChar="1"')
    .replace(/vertRelTo="PAPER"/, 'vertRelTo="PARA"')
    .replace(/horzRelTo="PAPER"/, 'horzRelTo="PARA"')
    .replace(/vertOffset="\d+"/, 'vertOffset="0"')
    .replace(/horzOffset="\d+"/, 'horzOffset="0"');
}

function blockXml(block: DocBlock, values: DeliverableValues, stampXml: string): string {
  switch (block.kind) {
    case "note":
      return para(renderTemplate(block.text, values), { align: block.align });
    case "title":
      return para(renderTemplate(block.text, values), { charPr: CHAR.title, align: "center" });
    case "fields":
      return fieldsXml(block, values);
    case "table":
      return tableXml(block, values);
    case "para":
      return para(renderTemplate(block.text, values), { align: block.align });
    case "dateLine":
      return para(renderBinding(block.binding, values, block.format), { align: block.align ?? "center" });
    case "signature":
      return signatureXml(block, values, stampXml);
    case "receiver":
      return para(`${renderBinding(block.binding, values)} ${renderTemplate(block.suffix, values)}`, {
        charPr: CHAR.receiver,
        align: block.align,
      });
    case "stampBox":
      return para(block.label, { align: "right" as Align });
    case "spacer":
      return blankPara(Math.max(1, Math.round(block.heightPt / LINE_HEIGHT_PT)));
    default:
      return "";
  }
}

async function loadSkeleton(): Promise<JSZip> {
  const file = path.join(process.cwd(), "public", "hwpx", "completion.hwpx");
  return JSZip.loadAsync(await readFile(file));
}

/**
 * 재구축 양식(spec) → HWPX. 서식이 원본과 똑같지는 않지만 한글에서 손볼 수 있다.
 * 서식이 여러 장이면 장 사이에 쪽 나눔을 넣는다.
 */
export async function renderSpecHwpx(specs: DeliverableSpec[], values: DeliverableValues): Promise<Uint8Array> {
  if (!specs.length) throw new Error("생성할 서식이 없습니다.");
  const zip = await loadSkeleton();
  const entry = zip.file("Contents/section0.xml");
  if (!entry) throw new Error("HWPX 골격을 읽지 못했습니다.");
  const source = await entry.async("string");

  const head = source.slice(0, source.indexOf("<hp:p "));
  const secPr = /<hp:secPr[\s\S]*?<\/hp:secPr>/.exec(source)?.[0] ?? "";
  const colPr = /<hp:ctrl><hp:colPr[\s\S]*?<\/hp:ctrl>/.exec(source)?.[0] ?? "";
  const stampXml = inlineStamp(source);

  const body = specs
    .map((spec, si) => {
      const blocks = spec.blocks.map((b) => blockXml(b, values, stampXml)).join("");
      // 첫 문단에는 용지 설정(secPr)이 실려야 한다 — 한글이 이걸로 페이지를 잡는다
      if (si > 0) return `<hp:p id="0" paraPrIDRef="${PARA.left}" styleIDRef="0" pageBreak="1" columnBreak="0" merged="0"><hp:run charPrIDRef="${CHAR.body}"><hp:t/></hp:run></hp:p>${blocks}`;
      return blocks;
    })
    .join("");

  const first =
    `<hp:p id="0" paraPrIDRef="${PARA.left}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
    `<hp:run charPrIDRef="${CHAR.body}">${secPr}${colPr}<hp:t/></hp:run></hp:p>`;

  zip.file("Contents/section0.xml", `${head}${first}${body}</hs:sec>`);
  const mimetype = zip.file("mimetype");
  if (mimetype) zip.file("mimetype", await mimetype.async("uint8array"), { compression: "STORE" });
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
