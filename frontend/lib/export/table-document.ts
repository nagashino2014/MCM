/**
 * 표 형태 데이터를 XLSX / PDF 로 내보내는 범용 헬퍼.
 * 산출 양식(테두리/총계 블록)은 사업장 목록 내보내기(/api/facilities/export)와 동일하다.
 */
import { promises as fs } from "fs";
import path from "path";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

export interface TableDocumentSpec {
  /** 열 레이블 */
  headers: string[];
  /** 열 정렬 */
  aligns: ("center" | "left" | "right")[];
  /**
   * PDF 열 최소 너비 (pt). 실제 너비는 열 데이터 중 가장 긴 텍스트에 맞춰
   * 자동 확장되며, 페이지 폭을 넘으면 초과분만 비례 축소된다.
   */
  pdfColWidths: number[];
  /** XLSX 열 최소 너비 (문자 수 기준). 가장 긴 텍스트에 맞춰 자동 확장된다 */
  xlsxColChars: number[];
  /** 시트명 */
  sheetName: string;
  /** PDF 페이지: landscape | portrait */
  orientation?: "landscape" | "portrait";
  rows: string[][];
  totalLabel: string;
  totalValue: string;
  /**
   * 표 상단에 넣을 제목 텍스트.
   * 설정하면 헤더 위에 제목 행(볼드) + 빈 행이 삽입되고,
   * 빈 행의 마지막 열에 printDate(YYYY-MM-DD)가 우측 정렬로 표기된다.
   */
  docTitle?: string;
  /** 우측 날짜 표기용 (ISO date, 예: 2026-06-12). 없으면 오늘 날짜 사용. */
  printDate?: string;
}

/** 셀 텍스트의 표시 폭 (문자 수 기준). CJK 전각 문자는 2칸으로 계산한다. */
function displayWidth(text: string): number {
  let w = 0;
  for (const ch of String(text ?? "")) {
    const code = ch.codePointAt(0) ?? 0;
    w += code >= 0x1100 && code <= 0xffdc ? 2 : 1;
  }
  return w;
}

/* ============================== PDF ============================== */

const MARGIN = 40;
const FONT_SIZE = 9;
const LINE_H = 12;
const PAD_X = 4;
const PAD_Y = 5;
const THIN = 0.5;
const THICK = 1.4;

/**
 * 열 데이터 중 가장 긴 텍스트에 맞춰 PDF 열 너비를 자동 산출한다.
 * 합계가 페이지 가용 폭을 넘으면 최소 너비(spec.pdfColWidths)는 보존하면서
 * 초과분만 비례 축소한다 (이 경우에만 줄바꿈이 발생할 수 있다).
 */
function fitPdfColumnWidths(
  spec: TableDocumentSpec,
  regular: PDFFont,
  bold: PDFFont,
  available: number
): number[] {
  const desired = spec.headers.map((label, colIdx) => {
    let max = bold.widthOfTextAtSize(label, FONT_SIZE);
    for (const row of spec.rows) {
      for (const line of String(row[colIdx] ?? "").split(/\r?\n/)) {
        const w = regular.widthOfTextAtSize(line, FONT_SIZE);
        if (w > max) max = w;
      }
    }
    return Math.max(spec.pdfColWidths[colIdx] ?? 30, max + 2 * PAD_X + 2);
  });
  const total = desired.reduce((a, b) => a + b, 0);
  if (total <= available) return desired;

  const mins = desired.map((w, i) => Math.min(spec.pdfColWidths[i] ?? 30, w));
  const flex = desired.map((w, i) => w - mins[i]);
  const flexTotal = flex.reduce((a, b) => a + b, 0);
  const room = Math.max(0, available - mins.reduce((a, b) => a + b, 0));
  const scale = flexTotal > 0 ? Math.min(1, room / flexTotal) : 0;
  return desired.map((w, i) => mins[i] + flex[i] * scale);
}

export async function createTablePdf(spec: TableDocumentSpec): Promise<Uint8Array> {
  const { headers, aligns, rows, totalLabel, totalValue } = spec;
  const landscape = (spec.orientation ?? "landscape") === "landscape";
  const PAGE_W = landscape ? 841.89 : 595.28;
  const PAGE_H = landscape ? 595.28 : 841.89;

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fontsDir = path.join(process.cwd(), "public", "fonts");
  const regular = await doc.embedFont(await fs.readFile(path.join(fontsDir, "malgun.ttf")), {
    subset: true,
  });
  const bold = await doc.embedFont(await fs.readFile(path.join(fontsDir, "malgunbd.ttf")), {
    subset: true,
  });
  const black = rgb(0, 0, 0);

  // 가장 긴 텍스트에 맞춰 열 너비 자동 조절
  const colWidths = fitPdfColumnWidths(spec, regular, bold, PAGE_W - 2 * MARGIN);

  const colX: number[] = [];
  let acc = MARGIN;
  for (const w of colWidths) {
    colX.push(acc);
    acc += w;
  }
  const tableRight = acc;

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  // 제목 + 날짜 행 (spec.docTitle 가 있을 때만)
  if (spec.docTitle) {
    const TITLE_SIZE = 20;
    const DATE_SIZE = 9;
    const titleWidth = bold.widthOfTextAtSize(spec.docTitle, TITLE_SIZE);
    page.drawText(spec.docTitle, {
      x: MARGIN + (tableRight - MARGIN - titleWidth) / 2,
      y: y - TITLE_SIZE,
      size: TITLE_SIZE,
      font: bold,
      color: black,
    });
    y -= TITLE_SIZE + 14;
    const dateStr = spec.printDate ?? new Date().toISOString().slice(0, 10);
    const dateWidth = regular.widthOfTextAtSize(dateStr, DATE_SIZE);
    page.drawText(dateStr, {
      x: tableRight - dateWidth,
      y: y - DATE_SIZE,
      size: DATE_SIZE,
      font: regular,
      color: black,
    });
    y -= DATE_SIZE + 8;
  }

  const drawHLine = (lineY: number, width: number) => {
    page.drawLine({
      start: { x: MARGIN, y: lineY },
      end: { x: tableRight, y: lineY },
      thickness: width,
      color: black,
    });
  };

  const drawCellText = (
    p: PDFPage,
    lines: string[],
    colIdx: number,
    topY: number,
    font: PDFFont,
    align: "center" | "left" | "right"
  ) => {
    lines.forEach((line, i) => {
      const textWidth = font.widthOfTextAtSize(line, FONT_SIZE);
      let x = colX[colIdx] + PAD_X;
      if (align === "center") x = colX[colIdx] + (colWidths[colIdx] - textWidth) / 2;
      if (align === "right") x = colX[colIdx] + colWidths[colIdx] - PAD_X - textWidth;
      p.drawText(line, {
        x,
        y: topY - PAD_Y - FONT_SIZE - i * LINE_H,
        size: FONT_SIZE,
        font,
        color: black,
      });
    });
  };

  const drawHeader = () => {
    const headerHeight = LINE_H + 2 * PAD_Y;
    drawHLine(y, THICK);
    headers.forEach((label, colIdx) => {
      drawCellText(page, [label], colIdx, y, bold, "center");
    });
    y -= headerHeight;
    drawHLine(y, THIN);
  };

  drawHeader();

  rows.forEach((row, rowIdx) => {
    const wrapped = row.map((cell, colIdx) =>
      wrapText(cell, regular, FONT_SIZE, colWidths[colIdx] - 2 * PAD_X)
    );
    const lineCount = Math.max(...wrapped.map((w) => w.length));
    const rowHeight = lineCount * LINE_H + 2 * PAD_Y;

    if (y - rowHeight < MARGIN) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
      drawHeader();
    }

    wrapped.forEach((lines, colIdx) => {
      drawCellText(page, lines, colIdx, y, regular, aligns[colIdx]);
    });
    y -= rowHeight;
    drawHLine(y, rowIdx === rows.length - 1 ? THICK : THIN);
  });

  // 표 우측 하단, 3행 간격을 두고 전체 총계 (볼드, 상단/하단 굵은 선)
  const gap = 3 * (LINE_H + 2 * PAD_Y);
  const totalHeight = LINE_H + 2 * PAD_Y;
  if (y - gap - totalHeight < MARGIN) {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  }
  const totalTop = y - gap;
  const blockLeft = tableRight - 200;
  const drawTotalLine = (lineY: number) => {
    page.drawLine({
      start: { x: blockLeft, y: lineY },
      end: { x: tableRight, y: lineY },
      thickness: THICK,
      color: black,
    });
  };
  drawTotalLine(totalTop);
  page.drawText(totalLabel, {
    x: blockLeft + PAD_X,
    y: totalTop - PAD_Y - FONT_SIZE,
    size: FONT_SIZE,
    font: bold,
    color: black,
  });
  const valueWidth = bold.widthOfTextAtSize(totalValue, FONT_SIZE);
  page.drawText(totalValue, {
    x: tableRight - PAD_X - valueWidth,
    y: totalTop - PAD_Y - FONT_SIZE,
    size: FONT_SIZE,
    font: bold,
    color: black,
  });
  drawTotalLine(totalTop - totalHeight);

  return doc.save();
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    let current = "";
    for (const ch of raw) {
      const candidate = current + ch;
      if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(current);
        current = ch;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
  }
  const filtered = lines.filter((l, i) => l !== "" || i === 0);
  return filtered.length ? filtered : [""];
}

/* ============================== XLSX ============================== */

export function createTableWorkbook(spec: TableDocumentSpec): Buffer {
  const files: ZipFile[] = [
    {
      name: "[Content_Types].xml",
      data: xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`),
    },
    {
      name: "_rels/.rels",
      data: xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    },
    {
      name: "xl/workbook.xml",
      data: xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${escapeXml(spec.sheetName)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`),
    },
    { name: "xl/styles.xml", data: xml(stylesXml()) },
    { name: "xl/worksheets/sheet1.xml", data: xml(sheetXml(spec)) },
    {
      name: "docProps/core.xml",
      data: xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>MCM</dc:creator>
  <cp:lastModifiedBy>MCM</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified>
</cp:coreProperties>`),
    },
    {
      name: "docProps/app.xml",
      data: xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>MCM</Application>
</Properties>`),
    },
  ];
  return zip(files);
}

/**
 * 스타일 인덱스:
 *  0 기본
 *  1 헤더(볼드, 상단 굵은 선 + 하단 기본 선, 가운데 정렬)
 *  2 본문 좌측 / 3 가운데 / 4 우측 (하단 기본 선)
 *  5 마지막 행 좌측 / 6 가운데 / 7 우측 (하단 굵은 선)
 *  8 총계(볼드, 상단/하단 굵은 선)
 *  9 제목(20pt 볼드, 중앙 정렬, 테두리 없음)
 * 10 날짜(우측 정렬, 테두리 없음)
 */
function stylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="9"/><name val="맑은 고딕"/></font>
    <font><b/><sz val="9"/><name val="맑은 고딕"/></font>
    <font><b/><sz val="20"/><name val="맑은 고딕"/></font>
  </fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders count="5">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left/><right/><top style="medium"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border>
    <border><left/><right/><top/><bottom style="medium"><color rgb="FF000000"/></bottom><diagonal/></border>
    <border><left/><right/><top style="medium"><color rgb="FF000000"/></top><bottom style="medium"><color rgb="FF000000"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="11">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="3" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="3" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="3" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="4" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <!-- 9: 제목 행 – 20pt 볼드, 테두리 없음, 가운데 정렬 -->
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <!-- 10: 날짜 행 – 일반, 테두리 없음, 오른쪽 정렬 -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function bodyStyleIdx(align: "center" | "left" | "right", isLast: boolean): number {
  const base = align === "left" ? 2 : align === "center" ? 3 : 4;
  return isLast ? base + 3 : base;
}

function sheetXml(spec: TableDocumentSpec): string {
  const { headers, aligns, xlsxColChars, rows, totalLabel, totalValue } = spec;

  // docTitle 이 있으면 제목(1행) + 날짜(2행) 2행을 표 위에 삽입한다
  const titleOffset = spec.docTitle ? 2 : 0;

  // 가장 긴 텍스트에 맞춰 열 너비 자동 조절 (지정값은 최소 너비로 사용)
  const autoChars = headers.map((label, colIdx) => {
    let max = displayWidth(label);
    for (const row of rows) {
      for (const line of String(row[colIdx] ?? "").split(/\r?\n/)) {
        const w = displayWidth(line);
        if (w > max) max = w;
      }
    }
    return Math.min(120, Math.max(xlsxColChars[colIdx] ?? 6, max + 2));
  });
  const cols = autoChars
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("");

  const xmlRows: string[] = [];

  // 제목 행 (볼드, 테두리 없음)
  if (spec.docTitle) {
    const titleRef = `${columnName(1)}1`;
    xmlRows.push(
      `<row r="1" ht="32" customHeight="1">` +
        `<c r="${titleRef}" t="inlineStr" s="9"><is><t xml:space="preserve">${escapeXml(spec.docTitle)}</t></is></c>` +
        `</row>`
    );
    // 날짜 행 (우측 마지막 열, 우측 정렬 테두리없음 스타일=10)
    const dateStr = spec.printDate ?? new Date().toISOString().slice(0, 10);
    const dateRef = `${columnName(headers.length)}2`;
    xmlRows.push(
      `<row r="2" ht="16" customHeight="1">` +
        `<c r="${dateRef}" t="inlineStr" s="10"><is><t xml:space="preserve">${escapeXml(dateStr)}</t></is></c>` +
        `</row>`
    );
  }

  // 헤더 행
  const headerRow = 1 + titleOffset;
  const headerCells = headers
    .map((label, colIdx) => {
      const ref = `${columnName(colIdx + 1)}${headerRow}`;
      return `<c r="${ref}" t="inlineStr" s="1"><is><t xml:space="preserve">${escapeXml(label)}</t></is></c>`;
    })
    .join("");
  xmlRows.push(`<row r="${headerRow}" ht="20" customHeight="1">${headerCells}</row>`);

  // 데이터 행
  rows.forEach((row, rowIdx) => {
    const r = rowIdx + headerRow + 1;
    const isLast = rowIdx === rows.length - 1;
    const cells = row
      .map((cell, colIdx) => {
        const ref = `${columnName(colIdx + 1)}${r}`;
        const style = bodyStyleIdx(aligns[colIdx], isLast);
        return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escapeXml(cell)}</t></is></c>`;
      })
      .join("");
    xmlRows.push(`<row r="${r}" ht="18" customHeight="1">${cells}</row>`);
  });

  // 총계 행 (표 아래 4행 간격)
  const totalRow = headerRow + rows.length + 4;
  const labelRef = `${columnName(headers.length - 1)}${totalRow}`;
  const valueRef = `${columnName(headers.length)}${totalRow}`;
  xmlRows.push(
    `<row r="${totalRow}" ht="20" customHeight="1">` +
      `<c r="${labelRef}" t="inlineStr" s="8"><is><t xml:space="preserve">${escapeXml(totalLabel)}</t></is></c>` +
      `<c r="${valueRef}" t="inlineStr" s="8"><is><t xml:space="preserve">${escapeXml(totalValue)}</t></is></c>` +
      `</row>`
  );

  const mergeCells =
    spec.docTitle && headers.length > 1
      ? `<mergeCells count="1"><mergeCell ref="A1:${columnName(headers.length)}1"/></mergeCells>`
      : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>
  <cols>${cols}</cols>
  <sheetData>${xmlRows.join("")}</sheetData>
  ${mergeCells}
  <pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;
}

function columnName(n: number): string {
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function xml(value: string): Buffer {
  return Buffer.from(value, "utf8");
}

interface ZipFile {
  name: string;
  data: Buffer;
}

function zip(files: ZipFile[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, file.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(file.data.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + file.data.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const localData = Buffer.concat(localParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(localData.length, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([localData, centralDir, end]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
