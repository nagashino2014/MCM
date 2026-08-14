import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { COMPANY_KO, COMPANY_CEO } from "@/lib/letter/types";

/*
 * 연봉 근로계약서 PDF 렌더러 (PL-P3, 블루프린트 §5-1)
 * - 2026 현행 양식 재현: 제목(자간) → 갑/을 인적사항 표 → 전문 → 13개 조문(다페이지 흐름,
 *   조 제목 고아 방지 — agreement/pdf.ts 관례) → §6 임금 구성표 → 작성일·서명부·부속 동의 4종.
 * - 서명(signatures)이 있으면 각 서명란에 전자서명 문자열을 각인(확정본).
 * - 폰트/직인 로드·캐시는 bonus/statement-pdf.ts 관례.
 */

export interface ContractPdfInput {
  title: string; // 예: "연 봉 근 로 계 약 서"
  employee: {
    name: string;
    birthDate: string | null;
    phone: string | null;
    address: string | null;
  };
  /** 치환 완료된 조문 — clauses 의 "@WAGE_TABLE@" 자리에 임금 구성표를 그린다 */
  articles: Array<{ article: string; clauses: string[] }>;
  /** 임금 구성표 [항목, 금액] — 값 있는 항목만 */
  wageRows: Array<[string, number]>;
  monthlySalary: number | null;
  contractDateKo: string; // 예: "2027년 1월 1일"
  /** 전자서명 문자열(확정본). null 이면 "(서명 또는 인)" 자리만 */
  signatures?: {
    main?: string;
    receipt?: string;
    overtime?: string;
    rules?: string;
    privacy?: string;
  } | null;
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN_X = 52;
const MARGIN_TOP = 54;
const MARGIN_BOTTOM = 56;
const BODY_W = PAGE_W - MARGIN_X * 2;
const INK = rgb(0.1, 0.1, 0.12);
const LINE = rgb(0.45, 0.45, 0.5);
const SHADE = rgb(0.93, 0.94, 0.96);
const SIGN_INK = rgb(0.05, 0.2, 0.55); // 전자서명 각인 색(원본과 구분)

let fontCache: { regular: Buffer; bold: Buffer } | null = null;
let stampCache: Buffer | null | undefined;

async function loadFonts(): Promise<{ regular: Buffer; bold: Buffer }> {
  if (fontCache) return fontCache;
  const dir = path.join(process.cwd(), "public", "fonts");
  fontCache = {
    regular: await readFile(path.join(dir, "malgun.ttf")),
    bold: await readFile(path.join(dir, "malgunbd.ttf")),
  };
  return fontCache;
}

async function loadStamp(): Promise<Buffer | null> {
  if (stampCache !== undefined) return stampCache;
  try {
    stampCache = await readFile(path.join(process.cwd(), "public", "letter", "stamp.png"));
  } catch {
    stampCache = null;
  }
  return stampCache;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const ch of text) {
    if (font.widthOfTextAtSize(cur + ch, size) > maxWidth) {
      lines.push(cur);
      cur = ch === " " ? "" : ch;
    } else {
      cur += ch;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

function fmt(v: number): string {
  return Math.round(v).toLocaleString("ko-KR");
}

export async function renderContractPdf(input: ContractPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fonts = await loadFonts();
  const regular = await doc.embedFont(fonts.regular, { subset: true });
  const bold = await doc.embedFont(fonts.bold, { subset: true });
  const stampBuf = await loadStamp();
  const stamp = stampBuf ? await doc.embedPng(stampBuf) : null;

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN_TOP;

  const newPageIfNeeded = (need: number) => {
    if (y - need < MARGIN_BOTTOM) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN_TOP;
    }
  };

  // ── 제목(자간 넓게 중앙) ──
  {
    const size = 20;
    const chars = input.title.replace(/\s+/g, "").split("");
    const spacing = 8;
    const widths = chars.map((c) => bold.widthOfTextAtSize(c, size));
    const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
    let x = (PAGE_W - total) / 2;
    for (let i = 0; i < chars.length; i++) {
      page.drawText(chars[i], { x, y: y - size, size, font: bold, color: INK });
      x += widths[i] + spacing;
    }
    y -= size + 26;
  }

  // ── 갑/을 인적사항 표 ──
  {
    const rows: Array<[string, string, string]> = [
      ["사업주(甲)", "사 업 체 명", COMPANY_KO],
      ["", "대   표   자", COMPANY_CEO],
      ["", "소   재   지", "서울 금천구 가산디지털1로 100, 에이스골드타워 12층"],
      ["근로자(乙)", "성        명", input.employee.name],
      ["", "생 년 월 일", input.employee.birthDate ?? ""],
      ["", "주        소", input.employee.address ?? ""],
    ];
    if (input.employee.phone) rows[4][2] += `    (전화 : ${input.employee.phone})`;
    const rowH = 22;
    const c1 = 78;
    const c2 = 96;
    const tableTop = y;
    for (let i = 0; i < rows.length; i++) {
      const top = tableTop - i * rowH;
      // 배경(라벨 열)
      page.drawRectangle({ x: MARGIN_X, y: top - rowH, width: c1 + c2, height: rowH, color: SHADE });
      page.drawRectangle({ x: MARGIN_X, y: top - rowH, width: BODY_W, height: rowH, borderColor: LINE, borderWidth: 0.7 });
      if (rows[i][0]) {
        page.drawText(rows[i][0], { x: MARGIN_X + 8, y: top - rowH / 2 - 3.4, size: 9.5, font: bold, color: INK });
      }
      page.drawText(rows[i][1], { x: MARGIN_X + c1 + 8, y: top - rowH / 2 - 3.4, size: 9.5, font: regular, color: INK });
      page.drawText(rows[i][2], { x: MARGIN_X + c1 + c2 + 10, y: top - rowH / 2 - 3.4, size: 9.5, font: regular, color: INK });
    }
    // 구간 세로선
    page.drawLine({ start: { x: MARGIN_X + c1, y: tableTop }, end: { x: MARGIN_X + c1, y: tableTop - rows.length * rowH }, color: LINE, thickness: 0.7 });
    page.drawLine({ start: { x: MARGIN_X + c1 + c2, y: tableTop }, end: { x: MARGIN_X + c1 + c2, y: tableTop - rows.length * rowH }, color: LINE, thickness: 0.7 });
    y = tableTop - rows.length * rowH - 16;
  }

  // ── 전문 ──
  {
    const pre = "양 당사자는 노동관계법령과 본 근로계약 사항을 성실하게 이행할 것을 서약하고 다음과 같이 근로계약을 체결한다.";
    for (const line of wrapText(pre, regular, 10, BODY_W)) {
      newPageIfNeeded(15);
      page.drawText(line, { x: MARGIN_X, y: y - 10, size: 10, font: regular, color: INK });
      y -= 15;
    }
    y -= 8;
  }

  // ── 임금 구성표 렌더 함수 (§6 내 @WAGE_TABLE@) ──
  const drawWageTable = () => {
    const rows = input.wageRows;
    const perRow = 4; // 4열 × N행 (항목/금액 세로쌍)
    const chunks: Array<Array<[string, number]>> = [];
    for (let i = 0; i < rows.length; i += perRow) chunks.push(rows.slice(i, i + perRow));
    if (!chunks.length) chunks.push([]);
    const colW = BODY_W / perRow;
    const rowH = 20;
    for (const chunk of chunks) {
      newPageIfNeeded(rowH * 2 + 6);
      const top = y;
      for (let c = 0; c < perRow; c++) {
        const x = MARGIN_X + c * colW;
        page.drawRectangle({ x, y: top - rowH, width: colW, height: rowH, color: SHADE, borderColor: LINE, borderWidth: 0.7 });
        page.drawRectangle({ x, y: top - rowH * 2, width: colW, height: rowH, borderColor: LINE, borderWidth: 0.7 });
        const item = chunk[c];
        if (item) {
          const label = item[0];
          const lw = bold.widthOfTextAtSize(label, 9);
          page.drawText(label, { x: x + (colW - lw) / 2, y: top - rowH / 2 - 3.2, size: 9, font: bold, color: INK });
          const val = fmt(item[1]);
          const vw = regular.widthOfTextAtSize(val, 9.5);
          page.drawText(val, { x: x + colW - 8 - vw, y: top - rowH * 1.5 - 3.2, size: 9.5, font: regular, color: INK });
        }
      }
      y = top - rowH * 2 - 4;
    }
    // 월급여 합계 행
    if (input.monthlySalary != null) {
      newPageIfNeeded(20 + 6);
      const top = y;
      page.drawRectangle({ x: MARGIN_X, y: top - 20, width: BODY_W, height: 20, borderColor: LINE, borderWidth: 0.7 });
      page.drawText("월 급 여", { x: MARGIN_X + 8, y: top - 13.5, size: 9.5, font: bold, color: INK });
      const val = `${fmt(input.monthlySalary)} 원`;
      const vw = bold.widthOfTextAtSize(val, 10);
      page.drawText(val, { x: MARGIN_X + BODY_W - 10 - vw, y: top - 13.8, size: 10, font: bold, color: INK });
      y = top - 20 - 8;
    }
  };

  // ── 조문 흐름 ──
  for (const art of input.articles) {
    // 조 제목 + 첫 줄 고아 방지
    newPageIfNeeded(40);
    page.drawText(art.article, { x: MARGIN_X, y: y - 10.5, size: 10.5, font: bold, color: INK });
    y -= 18;
    for (const clause of art.clauses) {
      if (clause === "@WAGE_TABLE@") {
        drawWageTable();
        continue;
      }
      const indent = /^\s{2}\d/.test(clause) ? 16 : 0;
      for (const line of wrapText(clause.trim(), regular, 9.8, BODY_W - indent)) {
        newPageIfNeeded(14.5);
        page.drawText(line, { x: MARGIN_X + indent, y: y - 9.8, size: 9.8, font: regular, color: INK });
        y -= 14.5;
      }
      y -= 2;
    }
    y -= 8;
  }

  // ── 작성일 + 서명부 (한 덩어리로 페이지 넘김 판단) ──
  newPageIfNeeded(190);
  y -= 8;
  {
    const dw = regular.widthOfTextAtSize(input.contractDateKo, 11);
    page.drawText(input.contractDateKo, { x: (PAGE_W - dw) / 2, y: y - 11, size: 11, font: regular, color: INK });
    y -= 34;
  }

  const sigText = (v: string | undefined | null) => (v ? v : "(서명 또는 인)");
  const drawSigLine = (
    x: number,
    label: string,
    nameText: string,
    signed: string | undefined | null,
    withStamp: boolean
  ) => {
    page.drawText(label, { x, y: y - 10, size: 10, font: bold, color: INK });
    page.drawText(nameText, { x: x + 62, y: y - 10, size: 10.5, font: regular, color: INK });
    const sx = x + 62 + regular.widthOfTextAtSize(nameText, 10.5) + 14;
    if (signed) {
      page.drawText(signed, { x: sx, y: y - 9.5, size: 7.5, font: regular, color: SIGN_INK });
    } else {
      page.drawText("(서명 또는 인)", { x: sx, y: y - 10, size: 9, font: regular, color: LINE });
    }
    if (withStamp && stamp) {
      const w = 46;
      const h = (stamp.height / stamp.width) * w;
      page.drawImage(stamp, { x: x + 62 + 12, y: y - 10 - h * 0.55, width: w, height: h, opacity: 0.9 });
    }
  };

  // 갑 / 을
  page.drawText("(甲)", { x: MARGIN_X, y: y - 10, size: 10.5, font: bold, color: INK });
  page.drawText("(乙)", { x: PAGE_W / 2 + 10, y: y - 10, size: 10.5, font: bold, color: INK });
  y -= 22;
  drawSigLine(MARGIN_X, "대표자 :", COMPANY_CEO, null, true);
  drawSigLine(PAGE_W / 2 + 10, "근로자 :", input.employee.name, sigText(input.signatures?.main) === "(서명 또는 인)" ? null : input.signatures?.main, false);
  y -= 34;

  // 부속 동의 4종 (우측 정렬 박스)
  {
    const items: Array<[string, string | undefined | null]> = [
      ["근로계약서 교부 확인", input.signatures?.receipt],
      ["시간외근로 동의", input.signatures?.overtime],
      ["취업규칙 열람 확인", input.signatures?.rules],
      ["개인정보 수집·이용 동의", input.signatures?.privacy],
    ];
    const boxW = 150;
    const rowH = 20;
    const x0 = PAGE_W / 2 + 10;
    for (const [label, signed] of items) {
      newPageIfNeeded(rowH + 2);
      page.drawRectangle({ x: x0, y: y - rowH, width: boxW, height: rowH, color: SHADE, borderColor: LINE, borderWidth: 0.7 });
      const lw = regular.widthOfTextAtSize(label, 8.8);
      page.drawText(label, { x: x0 + (boxW - lw) / 2, y: y - rowH / 2 - 3, size: 8.8, font: bold, color: INK });
      if (signed) {
        page.drawText(signed, { x: x0 + boxW + 8, y: y - rowH / 2 - 2.8, size: 7, font: regular, color: SIGN_INK });
      } else {
        page.drawText("(서명 또는 인)", { x: x0 + boxW + 8, y: y - rowH / 2 - 3, size: 8.5, font: regular, color: LINE });
      }
      y -= rowH + 3;
    }
  }

  return doc.save();
}
