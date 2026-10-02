import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

/*
 * 수행인력 개별 이력사항 PDF — 공공입찰 '입찰 서류 생성'의 "투입인력 개별 경력사항 및 수행실적"
 * (lib/bid/package-catalog.ts staff_career)과 같은 항목 구성을 자사 고정 양식으로 그린다.
 * 입찰 쪽은 발주처가 준 hwpx 를 채우는 방식이라 고정 서식 파일이 없어, 항목·열 구성만 따른다.
 * A4 세로, 격자 테두리, 인적사항 표 + 수행실적 표(행 높이 가변·쪽 넘김 시 머리행 반복).
 */

export interface RecordHistoryProject {
  client: string; // 발주기관
  projectName: string; // 참여 사업명
  task: string; // 담당업무
  amountEok: string; // 사업비(억원)
  period: string; // 참여기간 'YYYY.MM.DD ~ YYYY.MM.DD|진행중'
  thenCompany: string; // 참여당시 소속회사
  thenPosition: string; // 참여당시 직위
}

export interface RecordHistoryData {
  name: string;
  company: string; // 소속
  position: string;
  engGrade: string;
  birthDate: string;
  tenure: string; // 소속사 근무기간
  education: string[]; // 최종학력(줄 단위)
  licenses: string[]; // 자격증(취득일)(줄 단위)
  projects: RecordHistoryProject[];
}

const PAGE_W = 595.28; // A4 portrait
const PAGE_H = 841.89;
const MARGIN_X = 42.5; // 15mm
const TABLE_W = PAGE_W - MARGIN_X * 2;
const TOP_Y = PAGE_H - 56;
const BOTTOM_Y = 50;

const FONT_SIZE = 9;
const LINE_H = FONT_SIZE * 1.35;
const CELL_PAD = 4;
const BLACK = rgb(0, 0, 0);
const HEAD_BG = rgb(0.93, 0.94, 0.96);

const PROJECT_HEADERS = ["연번", "발주기관", "참여 사업명", "담당업무", "사업비\n(억원)", "참여기간", "참여당시\n소속회사", "참여당시\n직위"];
const PROJECT_WEIGHTS = [5, 14, 26, 12, 7, 14, 13, 9];

let fontCache: { regular: Buffer; bold: Buffer } | null = null;

async function loadFonts(): Promise<{ regular: Buffer; bold: Buffer }> {
  if (fontCache) return fontCache;
  const dir = path.join(process.cwd(), "public", "fonts");
  const [regular, bold] = await Promise.all([readFile(path.join(dir, "malgun.ttf")), readFile(path.join(dir, "malgunbd.ttf"))]);
  fontCache = { regular, bold };
  return fontCache;
}

/** 폭에 맞춰 줄바꿈 — 공백 우선, 넘치면 글자 단위(한글). 명시적 줄바꿈(\n)은 유지. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const ch of para) {
      if (font.widthOfTextAtSize(line + ch, size) <= maxWidth) {
        line += ch;
        continue;
      }
      const cut = line.lastIndexOf(" ");
      if (ch !== " " && cut > 0 && cut >= line.length - 8) {
        out.push(line.slice(0, cut));
        line = line.slice(cut + 1) + ch;
      } else {
        out.push(line.trimEnd());
        line = ch === " " ? "" : ch;
      }
    }
    out.push(line);
  }
  return out.length ? out : [""];
}

function drawCellText(
  page: PDFPage,
  lines: string[],
  font: PDFFont,
  x: number,
  width: number,
  top: number,
  height: number,
  align: "center" | "left"
) {
  const blockH = lines.length * LINE_H;
  let y = top - (height - blockH) / 2 - FONT_SIZE * 0.95;
  for (const line of lines) {
    const w = font.widthOfTextAtSize(line, FONT_SIZE);
    const tx = align === "center" ? x + (width - w) / 2 : x + CELL_PAD;
    page.drawText(line, { x: tx, y, size: FONT_SIZE, font, color: BLACK });
    y -= LINE_H;
  }
}

function drawBox(page: PDFPage, x: number, top: number, width: number, height: number, fill: boolean) {
  page.drawRectangle({
    x,
    y: top - height,
    width,
    height,
    borderColor: BLACK,
    borderWidth: 0.6,
    color: fill ? HEAD_BG : undefined,
  });
}

export async function renderRecordHistoryPdf(data: RecordHistoryData): Promise<Uint8Array> {
  const fonts = await loadFonts();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(fonts.regular, { subset: true });
  const bold = await doc.embedFont(fonts.bold, { subset: true });

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = TOP_Y;

  // 제목
  const title = "수행인력 개별 이력사항";
  page.drawText(title, {
    x: (PAGE_W - bold.widthOfTextAtSize(title, 16)) / 2,
    y: y - 16,
    size: 16,
    font: bold,
    color: BLACK,
  });
  y -= 40;

  // ── 인적사항: 라벨/값 4칸 2쌍, 긴 항목은 값 칸을 끝까지 병합 ──
  const labelW = TABLE_W * 0.16;
  const valueW = TABLE_W * 0.34;
  const pairRow = (l1: string, v1: string, l2: string, v2: string) => {
    const a = wrap(v1, regular, FONT_SIZE, valueW - CELL_PAD * 2);
    const b = wrap(v2, regular, FONT_SIZE, valueW - CELL_PAD * 2);
    const h = Math.max(24, Math.max(a.length, b.length) * LINE_H + 10);
    let x = MARGIN_X;
    for (const [text, width, isLabel] of [
      [[l1], labelW, true],
      [a, valueW, false],
      [[l2], labelW, true],
      [b, valueW, false],
    ] as [string[], number, boolean][]) {
      drawBox(page, x, y, width, h, isLabel);
      drawCellText(page, text, isLabel ? bold : regular, x, width, y, h, isLabel ? "center" : "left");
      x += width;
    }
    y -= h;
  };
  const wideRow = (label: string, lines: string[]) => {
    const wrapped = lines.flatMap((l) => wrap(l, regular, FONT_SIZE, TABLE_W - labelW - CELL_PAD * 2));
    const body = wrapped.length ? wrapped : [""];
    const h = Math.max(24, body.length * LINE_H + 10);
    drawBox(page, MARGIN_X, y, labelW, h, true);
    drawCellText(page, [label], bold, MARGIN_X, labelW, y, h, "center");
    drawBox(page, MARGIN_X + labelW, y, TABLE_W - labelW, h, false);
    drawCellText(page, body, regular, MARGIN_X + labelW, TABLE_W - labelW, y, h, "left");
    y -= h;
  };
  pairRow("성명", data.name, "소속", data.company);
  pairRow("직위(직책)", data.position, "기술등급", data.engGrade);
  pairRow("생년월일", data.birthDate, "소속사 근무기간", data.tenure);
  wideRow("최종학력", data.education);
  wideRow("자격증(취득일)", data.licenses);
  y -= 18;

  // ── 수행실적 ──
  page.drawText(`수행실적 (총 ${data.projects.length}건)`, { x: MARGIN_X, y: y - 10, size: 10.5, font: bold, color: BLACK });
  y -= 18;

  const sum = PROJECT_WEIGHTS.reduce((a, b) => a + b, 0);
  const widths = PROJECT_WEIGHTS.map((w) => (w / sum) * TABLE_W);
  const drawHeader = () => {
    const h = 30;
    let x = MARGIN_X;
    PROJECT_HEADERS.forEach((label, i) => {
      drawBox(page, x, y, widths[i], h, true);
      drawCellText(page, label.split("\n"), bold, x, widths[i], y, h, "center");
      x += widths[i];
    });
    y -= h;
  };
  drawHeader();

  const rows: string[][] = data.projects.map((p, i) => [
    String(i + 1),
    p.client,
    p.projectName,
    p.task,
    p.amountEok,
    p.period.replace(" ~ ", " ~\n"),
    p.thenCompany,
    p.thenPosition,
  ]);
  if (rows.length === 0) rows.push(["", "", "수행 실적 없음", "", "", "", "", ""]);

  for (const row of rows) {
    const cells = row.map((text, i) => wrap(text, regular, FONT_SIZE, widths[i] - CELL_PAD * 2));
    const h = Math.max(26, Math.max(...cells.map((c) => c.length)) * LINE_H + 10);
    if (y - h < BOTTOM_Y) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = TOP_Y;
      drawHeader();
    }
    let x = MARGIN_X;
    cells.forEach((lines, i) => {
      drawBox(page, x, y, widths[i], h, false);
      drawCellText(page, lines, regular, x, widths[i], y, h, i === 1 || i === 2 || i === 3 ? "left" : "center");
      x += widths[i];
    });
    y -= h;
  }

  // 쪽 번호
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const label = `${i + 1} / ${pages.length}`;
    p.drawText(label, { x: (PAGE_W - regular.widthOfTextAtSize(label, 8)) / 2, y: 28, size: 8, font: regular, color: BLACK });
  });

  return doc.save();
}
