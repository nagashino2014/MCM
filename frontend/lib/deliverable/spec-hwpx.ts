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
import type { Align, CellSpec, DeliverableSpec, DeliverableValues, DocBlock, FieldRow, PhotoAsset } from "./types";

// 기본양식 템플릿(completion.hwpx) 의 스타일 id — 실물에서 확인한 값
const CHAR = {
  title: "7", //  24pt bold underline
  body: "8", //   12pt
  receiver: "11", // 24pt bold
  thBold: "15", // 11pt bold(표 머리)
  td: "16", //    11pt(표 본문)
} as const;
const PARA = { left: "0", center: "3", right: "16" } as const;
const BORDER_SOLID = "2";

/** 본문 폭·표 폭(HWPUNIT) — 템플릿 secPr 기준(A4, 좌우 여백 5669) */
const BODY_WIDTH = 48188;
const TABLE_WIDTH = 47341;
const ROW_HEIGHT = 2800;
const LINE_HEIGHT_PT = 20;
/** 본문 글자 크기(pt) — CHAR.body 가 12pt 다. 인감 좌표 계산에 쓴다. */
const BODY_PT = 12;

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

const widthOf = (s: string): number => [...s].reduce((a, ch) => a + (/[\x00-\x7F]/.test(ch) ? 1 : 2), 0);

/**
 * 라벨을 목표 폭에 맞춘다 — **글자 사이를 벌려서**("계   약   명") 채우고, 남으면 뒤를 공백으로.
 * 뒤에만 공백을 붙이면 "용역위치        :" 처럼 라벨과 콜론이 멀어져 양식 표기와 달라진다.
 */
function padLabel(label: string, width: number): string {
  if (/[:：]/.test(label)) return label; // 라벨 자체가 문구인 경우는 건드리지 않는다
  const chars = [...label.replace(/\s+/g, "")];
  const base = chars.reduce((a, ch) => a + widthOf(ch), 0);
  const slots = chars.length - 1;
  const need = width - base;
  if (slots <= 0 || need <= 0) return label + " ".repeat(Math.max(0, width - widthOf(label)));
  const per = Math.floor(need / slots);
  let extra = need - per * slots;
  const spread = chars
    .map((ch, i) => (i === chars.length - 1 ? ch : ch + " ".repeat(per + (extra-- > 0 ? 1 : 0))))
    .join("");
  return spread + " ".repeat(Math.max(0, width - widthOf(spread)));
}

function fieldsXml(block: Extract<DocBlock, { kind: "fields" }>, values: DeliverableValues): string {
  // 목표 폭 = 가장 긴 라벨. 짧은 라벨은 글자 사이를 벌려 여기에 맞춘다(콜론이 세로로 정렬된다).
  const labelWidth = Math.max(...block.rows.map((r) => widthOf(r.label.replace(/\s+/g, ""))), 0);
  return block.rows
    .map((row, i) => {
      const value = renderSlot(row, values);
      // 값이 비어도 구분자는 남긴다 — 나중에 손으로 채우는 자리다(사용자 수정본 기준).
      // 다만 라벨에 이미 콜론이 있으면(예: "준 공 금 액(단위 : 원)") 덧붙이지 않는다.
      const prefix = numberPrefix(block.numbering, i);
      const line = value
        ? `${prefix}${padLabel(row.label, labelWidth)} : ${value}`
        : /[:：]/.test(row.label)
          ? `${prefix}${row.label}`
          : `${prefix}${padLabel(row.label, labelWidth)} :`;
      const second = row.secondLine ? renderSlot(row.secondLine, values) : "";
      // 값 둘째 줄(착수계 금액 등)은 값 시작 위치에 맞춰 들여쓴다
      return para(line) + (second ? para(" ".repeat(labelWidth + 5) + second) : "");
    })
    .join("");
}

function cellXml(
  cell: CellSpec,
  addr: { col: number; row: number },
  size: { w: number; h: number },
  values: DeliverableValues,
  stampSource = ""
): string {
  const text = renderSlot(cell, values);
  const charPr = cell.bold ? CHAR.thBold : CHAR.td;
  const paraPr = cell.align === "left" ? PARA.left : PARA.center;
  // 다중 줄 셀(대금청구서 금액·청구인) — 줄마다 문단을 만든다. 마지막 줄 "(인)" 위에는
  // 셀 인감(cell.stamp)을 signature 규칙(폭 기반 좌표)으로 띄운다.
  const lines = text.split(String.fromCharCode(10));
  const body = lines
    .map((ln, i) => {
      const isLast = i === lines.length - 1;
      if (!(cell.stamp && stampSource && isLast)) return para(ln, { charPr, paraPr });
      const half = BODY_PT * 50;
      const stamp = stampSize(stampSource);
      const beforeMark = ln.replace(/\s*\(인\)\s*$/, "");
      const horz = Math.max(0, widthOf(beforeMark) * half - stamp.w * 0.25);
      const vert = -(stamp.h - BODY_PT * 100) / 2;
      const pic = floatingStamp(stampSource, { horz, vert });
      return (
        `<hp:p id="0" paraPrIDRef="${paraPr}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
        `<hp:run charPrIDRef="${charPr}">${pic}<hp:t>${escapeXml(ln)}</hp:t></hp:run></hp:p>`
      );
    })
    .join("");
  return (
    `<hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="${BORDER_SOLID}">` +
    `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">` +
    body +
    `</hp:subList>` +
    `<hp:cellAddr colAddr="${addr.col}" rowAddr="${addr.row}"/>` +
    `<hp:cellSpan colSpan="${cell.colSpan ?? 1}" rowSpan="${cell.rowSpan ?? 1}"/>` +
    `<hp:cellSz width="${Math.round(size.w)}" height="${Math.round(size.h)}"/>` +
    `<hp:cellMargin left="510" right="510" top="141" bottom="141"/></hp:tc>`
  );
}

function tableXml(block: Extract<DocBlock, { kind: "table" }>, values: DeliverableValues, stampSource = ""): string {
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
        tcs.push(cellXml(cell, { col, row: r }, { w, h }, values, stampSource));
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

// ── 성과품 사진 별첨(2026-08-19 사용자 확정) ──
// 별첨 페이지: 좌상단 "첨부자료" + 성과품 명칭 + 1x1 표 박스 안에 사진 contain fit.
// HWPUNIT 환산: 1pt = 100, 1px(96dpi) = 75.

/** 별첨 박스 크기(HWPUNIT) — A4 본문에서 캡션 아래 남는 높이 근사(pdf.ts 와 비슷한 비율) */
const PHOTO_BOX_W = TABLE_WIDTH;
const PHOTO_BOX_H = 62000;

/**
 * hp:pic 합성 — 템플릿 인감 pic 의 좌표 체계를 따른다(실측: imgClip = px*75,
 * scaMatrix = 표시/원본 비율). 셀 안에 글자처럼(treatAsChar=1) 앉힌다.
 */
function photoPicXml(binId: string, asset: PhotoAsset, fit: { w: number; h: number }): string {
  const orgW = asset.w * 75;
  const orgH = asset.h * 75;
  const scaleX = fit.w / orgW;
  const scaleY = fit.h / orgH;
  return (
    `<hp:pic id="0" zOrder="0" numberingType="PICTURE" textWrap="SQUARE" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="0" reverse="0">` +
    `<hp:offset x="0" y="0"/><hp:orgSz width="${orgW}" height="${orgH}"/><hp:curSz width="${fit.w}" height="${fit.h}"/>` +
    `<hp:flip horizontal="0" vertical="0"/><hp:rotationInfo angle="0" centerX="${Math.round(fit.w / 2)}" centerY="${Math.round(fit.h / 2)}" rotateimage="1"/>` +
    `<hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>` +
    `<hc:scaMatrix e1="${scaleX.toFixed(6)}" e2="0" e3="0" e4="0" e5="${scaleY.toFixed(6)}" e6="0"/>` +
    `<hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>` +
    `<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="${orgW}" y="0"/><hc:pt2 x="${orgW}" y="${orgH}"/><hc:pt3 x="0" y="${orgH}"/></hp:imgRect>` +
    `<hp:imgClip left="0" right="${asset.w * 75}" top="0" bottom="${asset.h * 75}"/>` +
    `<hp:inMargin left="0" right="0" top="0" bottom="0"/>` +
    `<hc:img binaryItemIDRef="${binId}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/><hp:effects/>` +
    `<hp:sz width="${fit.w}" widthRelTo="ABSOLUTE" height="${fit.h}" heightRelTo="ABSOLUTE" protect="0"/>` +
    `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
    `<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:shapeComment/></hp:pic>`
  );
}

/** 별첨 표 셀 공통 — 명칭 셀(위)·사진 셀(아래). borderFill 은 표 선과 동일. */
function photoCellXml(inner: string, addr: { col: number; row: number }, size: { w: number; h: number }): string {
  return (
    `<hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="${BORDER_SOLID}">` +
    `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">` +
    inner +
    `</hp:subList><hp:cellAddr colAddr="${addr.col}" rowAddr="${addr.row}"/><hp:cellSpan colSpan="1" rowSpan="1"/>` +
    `<hp:cellSz width="${Math.round(size.w)}" height="${Math.round(size.h)}"/><hp:cellMargin left="141" right="141" top="141" bottom="141"/></hp:tc>`
  );
}

/**
 * 성과품 사진 별첨 표(2026-08-19 확정) — 세트마다 (명칭 셀 / 사진 셀) 2행.
 * 1장=2x1 · 가로 2장=4x1 · 세로 2장=2x2 · 세로 4장=4x2. 사진은 셀 안 contain fit.
 */
function photoGridXml(block: Extract<DocBlock, { kind: "photoGrid" }>, photos: PhotoAsset[], photoBinIds: string[]): string {
  const cols = block.cols;
  const setRows = Math.ceil(block.items.length / cols);
  const capH = 1400; // 명칭 셀 높이(HWPUNIT ≒ 14pt 줄)
  const cellW = TABLE_WIDTH / cols;
  const photoH = Math.max(8000, Math.floor((PHOTO_BOX_H - capH * setRows) / setRows));
  const pad = 600;

  const trs: string[] = [];
  for (let r = 0; r < setRows; r++) {
    const capCells: string[] = [];
    const picCells: string[] = [];
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const item = block.items[idx];
      if (!item) {
        // 홀수 개수로 빈 자리가 생기면 빈 셀(테두리 유지)
        capCells.push(photoCellXml(para("", { charPr: CHAR.td, paraPr: PARA.center }), { col: c, row: r * 2 }, { w: cellW, h: capH }));
        picCells.push(photoCellXml(para("", { charPr: CHAR.td, paraPr: PARA.center }), { col: c, row: r * 2 + 1 }, { w: cellW, h: photoH }));
        continue;
      }
      capCells.push(
        photoCellXml(para(item.caption ?? "", { charPr: CHAR.thBold, paraPr: PARA.center }), { col: c, row: r * 2 }, { w: cellW, h: capH })
      );
      const asset = photos[item.photoIndex];
      const binId = photoBinIds[item.photoIndex];
      let inner: string;
      if (asset && binId && asset.w > 0) {
        const scale = Math.min((cellW - pad * 2) / (asset.w * 75), (photoH - pad * 2) / (asset.h * 75));
        const fit = { w: Math.round(asset.w * 75 * scale), h: Math.round(asset.h * 75 * scale) };
        inner =
          `<hp:p id="0" paraPrIDRef="${PARA.center}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
          `<hp:run charPrIDRef="${CHAR.body}">${photoPicXml(binId, asset, fit)}<hp:t/></hp:run></hp:p>`;
      } else {
        inner = para("(사진 자리)", { align: "center" });
      }
      picCells.push(photoCellXml(inner, { col: c, row: r * 2 + 1 }, { w: cellW, h: photoH }));
    }
    trs.push(`<hp:tr>${capCells.join("")}</hp:tr>`, `<hp:tr>${picCells.join("")}</hp:tr>`);
  }

  const totalH = (capH + photoH) * setRows;
  const tbl =
    `<hp:tbl id="0" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" ` +
    `dropcapstyle="None" pageBreak="CELL" repeatHeader="0" rowCnt="${setRows * 2}" colCnt="${cols}" cellSpacing="0" ` +
    `borderFillIDRef="${BORDER_SOLID}" noAdjust="0">` +
    `<hp:sz width="${TABLE_WIDTH}" widthRelTo="ABSOLUTE" height="${totalH}" heightRelTo="ABSOLUTE" protect="0"/>` +
    `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" ` +
    `vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
    `<hp:outMargin left="283" right="283" top="283" bottom="283"/>${trs.join("")}</hp:tbl>`;
  return (
    `<hp:p id="0" paraPrIDRef="${PARA.left}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
    `<hp:run charPrIDRef="${CHAR.body}">${tbl}<hp:t/></hp:run></hp:p>`
  );
}

/** 사진 바이너리를 zip(BinData)·manifest(content.hpf)에 등록하고 bin id 목록을 돌려준다. */
async function addPhotoBinData(zip: JSZip, photos: PhotoAsset[]): Promise<string[]> {
  if (!photos.length) return [];
  const hpfEntry = zip.file("Contents/content.hpf");
  let hpf = hpfEntry ? await hpfEntry.async("string") : "";
  const ids: string[] = [];
  photos.forEach((p, i) => {
    const ext = p.mime === "image/png" ? "png" : "jpg";
    // 템플릿 기존 image1 과 충돌하지 않는 id
    const id = `photo${i + 1}`;
    zip.file(`BinData/${id}.${ext}`, p.bytes);
    if (hpf && !hpf.includes(`id="${id}"`)) {
      hpf = hpf.replace(
        /(<opf:item id="section0")/,
        `<opf:item id="${id}" href="BinData/${id}.${ext}" media-type="${p.mime}" isEmbeded="1"/>$1`
      );
    }
    ids.push(id);
  });
  if (hpf) zip.file("Contents/content.hpf", hpf);
  return ids;
}

/**
 * 발주처 확인란 — 원본 양식이 우상단에 두는 **1열 2행 표**(위: "감독자 서명", 아래: 서명 자리).
 * pdf.ts 도 같은 모양(라벨 행 + 빈 행)으로 그린다.
 */
function stampBoxXml(block: Extract<DocBlock, { kind: "stampBox" }>, values: DeliverableValues): string {
  const w = (block.widthPt ?? 72) * 100; // 기본 72pt ≒ 25mm — 서명 확인란이라 넓을 필요가 없다
  const h = (block.heightPt ?? 46) * 100;
  const headH = Math.round(h * 0.35);
  const rows = [
    cellXml({ text: block.label, align: "center" }, { col: 0, row: 0 }, { w, h: headH }, values),
    cellXml({ text: "" }, { col: 0, row: 1 }, { w, h: h - headH }, values),
  ];
  // 글자처럼(treatAsChar="1") 두면 문단 정렬을 따라가 어정쩡한 자리에 앉는다 →
  // 본문 폭 기준으로 띄워 오른쪽 끝에 붙인다.
  const tbl =
    `<hp:tbl id="0" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" ` +
    `dropcapstyle="None" pageBreak="CELL" repeatHeader="0" rowCnt="2" colCnt="1" cellSpacing="0" ` +
    `borderFillIDRef="${BORDER_SOLID}" noAdjust="0">` +
    `<hp:sz width="${w}" widthRelTo="ABSOLUTE" height="${h}" heightRelTo="ABSOLUTE" protect="0"/>` +
    `<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="1" allowOverlap="1" holdAnchorAndSO="0" ` +
    `vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="${BODY_WIDTH - w}"/>` +
    `<hp:outMargin left="0" right="0" top="0" bottom="283"/><hp:tr>${rows[0]}</hp:tr><hp:tr>${rows[1]}</hp:tr></hp:tbl>`;
  // 표가 떠 있으므로 그 높이만큼 자리를 비워 준다(본문이 겹쳐 올라오지 않게)
  return (
    `<hp:p id="0" paraPrIDRef="${PARA.left}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
    `<hp:run charPrIDRef="${CHAR.body}">${tbl}<hp:t/></hp:run></hp:p>` +
    blankPara(Math.max(1, Math.round(h / 100 / LINE_HEIGHT_PT)))
  );
}

/** 서명란 — 라벨을 맞춰 오른쪽에 몰아 쓴다(양식 관행). */
function signatureXml(block: Extract<DocBlock, { kind: "signature" }>, values: DeliverableValues, stampSource: string): string {
  const indent = " ".repeat(block.indentPt ? Math.round(block.indentPt / 5) : 30);
  // 목표 폭 = 가장 긴 라벨. 짧은 라벨은 글자 사이를 벌려 여기에 맞춘다(콜론이 세로로 정렬된다).
  const labelWidth = Math.max(...block.rows.map((r) => widthOf(r.label.replace(/\s+/g, ""))), 0);
  return block.rows
    .map((row: FieldRow, i) => {
      // 대표자 성명은 벌려 쓰고, 그 줄에 인감을 붙인다(원본 양식의 관행)
      const isCeo = row.binding === "company.ceo";
      const raw = renderSlot(row, values);
      const value = isCeo ? `${spreadName(raw)}   (인)` : raw;
      const text = `${indent}${padLabel(row.label, labelWidth)} : ${value}`;
      const last = i === block.rows.length - 1;
      const stamp = block.stamp !== false && stampSource && (isCeo || (last && !block.rows.some((r) => r.binding === "company.ceo")));
      if (!stamp) return para(text);

      // 인감은 "(인)" 위에 겹치도록 띄운다 — 글자처럼 넣으면 줄 높이가 밀려 위아래에 빈 공간이 생긴다.
      // 반각 한 칸 = 글자 크기의 절반이므로 "(인)" 앞까지의 폭으로 가로 위치를 잡는다.
      const half = BODY_PT * 50; // 본문 12pt → 반각 한 칸 600 HWPUNIT
      const size = stampSize(stampSource);
      const beforeMark = `${indent}${padLabel(row.label, labelWidth)} : ${isCeo ? spreadName(raw) : raw}  `;
      const horz = Math.max(0, widthOf(beforeMark) * half - size.w * 0.25);
      const vert = -(size.h - BODY_PT * 100) / 2; // 줄 높이 가운데에 오도록 위로 끌어올린다
      const pic = floatingStamp(stampSource, { horz, vert });
      return (
        `<hp:p id="0" paraPrIDRef="${PARA.left}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
        `<hp:run charPrIDRef="${CHAR.body}">${pic}<hp:t>${escapeXml(text)}</hp:t></hp:run></hp:p>`
      );
    })
    .join("");
}

/** 인감 그림 크기(HWPUNIT) — 좌표 계산에 쓴다. */
function stampSize(picXml: string): { w: number; h: number } {
  const m = /<hp:sz width="(\d+)"[^>]*height="(\d+)"/.exec(picXml);
  return { w: m ? Number(m[1]) : 5041, h: m ? Number(m[2]) : 4920 };
}

/**
 * 템플릿의 인감 그림을 **글자 위에 떠 있는** 형태로 바꿔 재사용한다.
 * 글자처럼(treatAsChar) 넣으면 "(인)" 과 겹칠 수 없고 그 줄의 높이를 밀어 올려
 * 위아래에 빈 공간이 생긴다(사용자 지적) → 문단 기준 좌표로 띄운다.
 */
function floatingStamp(sectionXml: string, offset: { horz: number; vert: number }): string {
  const m = /<hp:pic\b[\s\S]*?<\/hp:pic>/.exec(sectionXml);
  if (!m) return "";
  return m[0]
    .replace(/textWrap="[^"]*"/, 'textWrap="IN_FRONT_OF_TEXT"')
    .replace(/treatAsChar="[01]"/, 'treatAsChar="0"')
    .replace(/vertRelTo="[^"]*"/, 'vertRelTo="PARA"')
    .replace(/horzRelTo="[^"]*"/, 'horzRelTo="PARA"')
    .replace(/vertOffset="-?\d+"/, `vertOffset="${Math.round(offset.vert)}"`)
    .replace(/horzOffset="-?\d+"/, `horzOffset="${Math.round(offset.horz)}"`);
}

/**
 * 블록 사이 빈 줄 수 — 사용자가 손으로 다듬은 결과물을 기준으로 확정한 값(2026-08-08).
 * LLM 이 준 spacer 에 맡기면 문서마다 들쭉날쭉해서 여기서 못 박고,
 * PDF·HWPX 가 같은 여백을 갖도록 normalizeSpecSpacing 이 이 규칙으로 spacer 를 다시 심는다.
 */
function gapBetween(prev: DocBlock["kind"] | null, next: DocBlock["kind"]): number {
  if (!prev) return 0;
  if (prev === "note") return next === "stampBox" ? 0 : 1; // "[첨부 1]" 아래 한 줄
  if (prev === "stampBox") return 1;
  if (prev === "title") return 3;
  if (next === "receiver") return 4; // 서명란과 수신처는 넉넉히
  if (prev === "fields" && next === "para") return 2;
  if (prev === "para" && next === "para") return 2; // 대금청구서 별첨 ↔ 청구 문구
  if (prev === "para" && next === "dateLine") return 3;
  if (prev === "dateLine" && next === "signature") return 3;
  if (prev === "table") return 1;
  if (next === "table") return 0; // 표 바로 위는 보통 "9. 준공금액(단위:원)" 소제목
  return 0;
}

/**
 * 블록 사이 여백을 규칙대로 다시 심는다(LLM 이 준 spacer 는 버린다).
 * 이 결과를 PDF·HWPX 렌더러가 함께 쓰므로 두 산출물의 여백이 갈리지 않는다.
 */
export function normalizeSpecSpacing(spec: DeliverableSpec): DeliverableSpec {
  const blocks: DocBlock[] = [];
  let prev: DocBlock["kind"] | null = null;
  for (const b of spec.blocks) {
    if (b.kind === "spacer") continue;
    const gap = gapBetween(prev, b.kind);
    if (gap > 0) blocks.push({ kind: "spacer", heightPt: gap * LINE_HEIGHT_PT });
    blocks.push(b);
    prev = b.kind;
  }
  return { ...spec, blocks };
}

function blockXml(
  block: DocBlock,
  values: DeliverableValues,
  stampSource: string,
  photoCtx: { photos: PhotoAsset[]; binIds: string[] }
): string {
  switch (block.kind) {
    case "note":
      return para(renderTemplate(block.text, values), { align: block.align });
    case "title":
      return para(renderTemplate(block.text, values), { charPr: CHAR.title, align: "center" });
    case "fields":
      return fieldsXml(block, values);
    case "table":
      return tableXml(block, values, stampSource);
    case "para":
      return para(renderTemplate(block.text, values), { align: block.align });
    case "dateLine":
      return para(renderBinding(block.binding, values, block.format), { align: block.align ?? "center" });
    case "signature":
      return signatureXml(block, values, stampSource);
    case "receiver":
      return para(`${renderBinding(block.binding, values)} ${renderTemplate(block.suffix, values)}`, {
        charPr: CHAR.receiver,
        align: block.align,
      });
    case "stampBox":
      return stampBoxXml(block, values);
    case "photoGrid":
      return photoGridXml(block, photoCtx.photos, photoCtx.binIds);
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
export async function renderSpecHwpx(
  specs: DeliverableSpec[],
  values: DeliverableValues,
  opts: { photos?: PhotoAsset[] } = {}
): Promise<Uint8Array> {
  if (!specs.length) throw new Error("생성할 서식이 없습니다.");
  const zip = await loadSkeleton();
  const entry = zip.file("Contents/section0.xml");
  if (!entry) throw new Error("HWPX 골격을 읽지 못했습니다.");
  const source = await entry.async("string");

  const head = source.slice(0, source.indexOf("<hp:p "));
  const secPr = /<hp:secPr[\s\S]*?<\/hp:secPr>/.exec(source)?.[0] ?? "";
  const colPr = /<hp:ctrl><hp:colPr[\s\S]*?<\/hp:ctrl>/.exec(source)?.[0] ?? "";
  const photos = opts.photos ?? [];
  const binIds = await addPhotoBinData(zip, photos);
  const body = buildSpecBodyXml(specs, values, source, { photos, binIds, pageBreakFirst: false });

  // 용지 설정(secPr)은 **첫 문단 안**에 실어야 한다 — 별도 빈 문단으로 두면 그게 맨 위 여백이 된다
  const withSec = body.replace(/(<hp:run charPrIDRef="[^"]*">)/, `$1${secPr}${colPr}`);

  zip.file("Contents/section0.xml", `${head}${withSec}</hs:sec>`);
  const mimetype = zip.file("mimetype");
  if (mimetype) zip.file("mimetype", await mimetype.async("uint8array"), { compression: "STORE" });
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** spec 목록 → 문단 XML(장 사이 쪽 나눔). stampSource 는 섹션 원문에서 추출한다. */
function buildSpecBodyXml(
  specs: DeliverableSpec[],
  values: DeliverableValues,
  sectionSource: string,
  opts: { photos: PhotoAsset[]; binIds: string[]; pageBreakFirst: boolean }
): string {
  // 인감 원본 XML — 서명란에서 좌표를 계산해 띄운다
  const stampSource = /<hp:pic\b[\s\S]*?<\/hp:pic>/.exec(sectionSource)?.[0] ?? "";
  return specs
    .map((spec, si) => {
      // 여백은 normalizeSpecSpacing 이 이미 spacer 로 심어 뒀다(PDF 와 같은 값을 쓰기 위함)
      let out = "";
      for (const b of spec.blocks) out += blockXml(b, values, stampSource, { photos: opts.photos, binIds: opts.binIds });
      // 둘째 장부터는 첫 문단에 쪽 나눔을 준다(빈 문단으로 넘기면 그 줄이 여백으로 보인다)
      return si > 0 || opts.pageBreakFirst ? out.replace('pageBreak="0"', 'pageBreak="1"') : out;
    })
    .join("");
}

/**
 * 템플릿 치환 산출물(HWPX) 뒤에 spec 서식 장을 이어 붙인다 — 준공 3종(템플릿) +
 * 준공내역서·용역결과보고서(spec)를 한 파일로 배포하기 위함(2026-08-19).
 * base 는 completion.hwpx 계열이어야 한다(spec 빌더의 charPr/paraPr id 가 그 헤더 기준).
 */
export async function appendSpecsToHwpx(
  base: Uint8Array,
  specs: DeliverableSpec[],
  values: DeliverableValues,
  opts: { photos?: PhotoAsset[] } = {}
): Promise<Uint8Array> {
  if (!specs.length) return base;
  const zip = await JSZip.loadAsync(base);
  const entry = zip.file("Contents/section0.xml");
  if (!entry) throw new Error("HWPX 산출물에 section0.xml 이 없습니다.");
  const source = await entry.async("string");
  const photos = opts.photos ?? [];
  const binIds = await addPhotoBinData(zip, photos);
  const body = buildSpecBodyXml(specs, values, source, { photos, binIds, pageBreakFirst: true });
  // 구버전 산출물은 장 제거 때 닫힘 태그까지 잘려 있을 수 있다 — 그 경우 끝에 덧붙이고 닫는다
  const closeIdx = source.lastIndexOf("</hs:sec>");
  const next = closeIdx >= 0 ? source.slice(0, closeIdx) + body + source.slice(closeIdx) : source + body + "</hs:sec>";
  zip.file("Contents/section0.xml", next);
  const mimetype = zip.file("mimetype");
  if (mimetype) zip.file("mimetype", await mimetype.async("uint8array"), { compression: "STORE" });
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
