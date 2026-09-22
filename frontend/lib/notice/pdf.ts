// 내부고시 PDF 렌더러 — 대외 공문 렌더러(lib/letter/pdf.ts)의 지면 양식(로고·사명 머리, '라벨 : 값'
// 머리 줄, 굵은 구분선, 본문 첫 줄 들여쓰기, 표 규칙)을 그대로 따르되 다음이 다르다(2026-09-22 사용자 요청).
//   · 머리 줄 = 문서번호 / 시행일자 / 수신 / 발신 / 제목 (공문의 수신처·참조 대신)
//   · 하단 고정부(담당·시행·주소·전화) 없음
//   · 문서 끝 = 시행일자(가운데) → 사명 → '대표이사  이 유 억  (직인)' 서명 블록
//   · A4 1장 강제 없음 — 규정 제정 알림처럼 길어지는 고시가 있어 여러 쪽으로 흘려 배치한다.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { parseLetterHtml } from "@/lib/letter/html-parse";
import {
  drawTable,
  layoutTable,
  loadImage,
  segsWidth,
  spread,
  tableWidthOf,
  wrapPlain,
  wrapRuns,
  type Fonts,
  type StyledSeg,
} from "@/lib/letter/pdf";
import {
  BODY_INDENT,
  COMPANY_CEO,
  COMPANY_EN,
  COMPANY_KO,
  CONTENT_W,
  MARGIN_L,
  MARGIN_R,
  PAGE_H,
  PAGE_W,
  type LetterBlock,
} from "@/lib/letter/types";
import { formatNoticeDate, type NoticeFieldValues } from "./types";

const INK = rgb(0.1, 0.1, 0.12);
const LINE_THICK = 2.2;
const BODY_PT = 11;
const LINE_FACTOR = 1.6;
/** 본문이 내려갈 수 있는 하한(pt, 하단 기준) — 쪽 번호 자리를 남긴다 */
const BOTTOM_Y = 64;
/** 둘째 쪽부터 본문 시작 y */
const CONT_TOP_Y = PAGE_H - 56;

export interface NoticeDocSnapshot {
  docNo: string | null; // 미채번(미리보기) 시 null → "(채번 예정)"
  issueDate: string; // YYYY-MM-DD
}

type TableBlock = Extract<LetterBlock, { kind: "table" }>;

/** 본문 말미 빈 문단 제거 — 표 삽입 시 에디터가 붙이는 커서용 빈 줄(공문 compose 와 같은 규칙). */
function stripTrailingBlanks(blocks: LetterBlock[]): LetterBlock[] {
  let end = blocks.length;
  while (end > 0) {
    const b = blocks[end - 1];
    if (b.kind === "p" && !b.runs.map((r) => r.text).join("").trim()) end -= 1;
    else break;
  }
  return blocks.slice(0, end);
}

/** 표를 쪽 경계에서 나눌 수 있는 행 묶음 — 세로 병합이 경계를 넘지 않게 끊는다. */
function rowGroups(t: TableBlock): number[][] {
  const groups: number[][] = [];
  let cur: number[] = [];
  let maxEnd = -1;
  t.rows.forEach((row, ri) => {
    cur.push(ri);
    row.forEach((cell) => {
      if (!cell.covered) maxEnd = Math.max(maxEnd, ri + (cell.rowSpan ?? 1) - 1);
    });
    if (maxEnd <= ri) {
      groups.push(cur);
      cur = [];
    }
  });
  if (cur.length) groups.push(cur);
  return groups;
}

export async function renderNoticePdf(values: NoticeFieldValues, snap: NoticeDocSnapshot): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fontsDir = path.join(process.cwd(), "public", "fonts");
  const fonts: Fonts = {
    regular: await doc.embedFont(await readFile(path.join(fontsDir, "malgun.ttf")), { subset: true }),
    bold: await doc.embedFont(await readFile(path.join(fontsDir, "malgunbd.ttf")), { subset: true }),
  };
  const logo = await loadImage(doc, "letter/logo.png");
  const stamp = values.stamp === 1 ? await loadImage(doc, "letter/stamp.png") : null;
  const dateText = formatNoticeDate(snap.issueDate);

  const pages: PDFPage[] = [];
  let page = doc.addPage([PAGE_W, PAGE_H]);
  pages.push(page);
  let y = PAGE_H - 46;

  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    y = CONT_TOP_Y;
  };
  /** 남은 높이가 h 보다 작으면 다음 쪽으로 */
  const ensure = (h: number) => {
    if (y - h < BOTTOM_Y) newPage();
  };

  // ── 1) 상단 머리(로고 + 사명) — 공문과 동일 ──
  {
    const logoH = 48;
    const logoW = logo ? (logo.width / logo.height) * logoH : 0;
    const nameSize = 21;
    const enSize = 10;
    const gap = 7;
    const nameW = fonts.bold.widthOfTextAtSize(COMPANY_KO, nameSize);
    const enW = fonts.bold.widthOfTextAtSize(COMPANY_EN, enSize);
    const groupW = logoW + (logoW ? gap : 0) + Math.max(nameW, enW);
    const x0 = (PAGE_W - groupW) / 2;
    const centerY = y - logoH / 2;
    if (logo) page.drawImage(logo, { x: x0, y: y - logoH, width: logoW, height: logoH });
    const tx = x0 + logoW + (logoW ? gap : 0);
    page.drawText(COMPANY_KO, { x: tx, y: centerY + 2, size: nameSize, font: fonts.bold, color: INK });
    page.drawText(COMPANY_EN, { x: tx, y: centerY - enSize - 3, size: enSize, font: fonts.bold, color: INK });
    y -= logoH + 30;
  }

  // ── 2) 머리 줄 — 문서번호 / 시행일자 / 수신 / 발신 / 제목 ──
  {
    const headSize = 10.5;
    const headLineH = 19;
    const labelW = fonts.bold.widthOfTextAtSize("문서번호", headSize);
    const valueX = MARGIN_L + labelW + fonts.regular.widthOfTextAtSize(" : ", headSize) + 2;
    const headLine = (label: string, value: string, bold = false) => {
      // 라벨 폭을 '문서번호'(4자)에 맞춰 글자 사이를 벌린다 — 공문의 '수    신' 표기 관행
      const chars = [...label];
      if (chars.length <= 1 || chars.length >= 4) {
        page.drawText(label, { x: MARGIN_L, y: y - headSize, size: headSize, font: fonts.bold, color: INK });
      } else {
        const raw = chars.reduce((w, ch) => w + fonts.bold.widthOfTextAtSize(ch, headSize), 0);
        const step = (labelW - raw) / (chars.length - 1);
        let cx = MARGIN_L;
        for (const ch of chars) {
          page.drawText(ch, { x: cx, y: y - headSize, size: headSize, font: fonts.bold, color: INK });
          cx += fonts.bold.widthOfTextAtSize(ch, headSize) + step;
        }
      }
      page.drawText(":", { x: MARGIN_L + labelW + 4, y: y - headSize, size: headSize, font: fonts.regular, color: INK });
      const font = bold ? fonts.bold : fonts.regular;
      for (const ln of wrapPlain(value || "-", font, headSize, PAGE_W - valueX - MARGIN_R)) {
        page.drawText(ln, { x: valueX, y: y - headSize, size: headSize, font, color: INK });
        y -= headLineH;
      }
    };
    headLine("문서번호", snap.docNo ?? "(채번 예정)");
    headLine("시행일자", dateText);
    headLine("수신", values.recipient_text || "-");
    headLine("발신", values.sender_text || "-");
    headLine("제목", values.subject || "", true);
    y -= 2;
    page.drawLine({ start: { x: MARGIN_L, y }, end: { x: PAGE_W - MARGIN_R, y }, thickness: LINE_THICK, color: INK });
    y -= 18;
  }

  // ── 3) 본문 ──
  const size = BODY_PT;
  const lineH = size * LINE_FACTOR;
  const blocks = stripTrailingBlanks(parseLetterHtml(values.body_html ?? ""));

  const drawSegsLine = (segs: StyledSeg[], x: number) => {
    let cx = x;
    for (const s of segs) {
      const font = s.bold ? fonts.bold : fonts.regular;
      page.drawText(s.text, { x: cx, y: y - size, size, font, color: INK });
      const w = font.widthOfTextAtSize(s.text, size);
      if (s.underline) {
        page.drawLine({ start: { x: cx, y: y - size - 1.5 }, end: { x: cx + w, y: y - size - 1.5 }, thickness: 0.5, color: INK });
      }
      cx += w;
    }
  };

  const drawTableBlock = (t: TableBlock) => {
    const groups = rowGroups(t);
    for (const g of groups) {
      const sub: TableBlock = { ...t, rows: g.map((ri) => t.rows[ri]), rowRatios: undefined };
      const h = layoutTable(sub, fonts, size).rowHs.reduce((a, b) => a + b, 0);
      ensure(h);
      y = drawTable(page, sub, fonts, size, y);
    }
  };

  blocks.forEach((b, bi) => {
    if (b.kind === "p") {
      const extraIndent = b.indentPt ?? 0;
      if (b.align === "center" || b.align === "right") {
        const nextTable = blocks[bi + 1];
        const rightEdge =
          b.align === "right" && nextTable?.kind === "table"
            ? MARGIN_L + 1 + Math.max(0, (CONTENT_W - 2 - tableWidthOf(nextTable)) / 2) + tableWidthOf(nextTable)
            : PAGE_W - MARGIN_R;
        for (const segs of wrapRuns(b.runs, fonts, size, CONTENT_W, CONTENT_W)) {
          ensure(lineH);
          const w = segsWidth(segs, fonts, size);
          drawSegsLine(segs, b.align === "center" ? MARGIN_L + (CONTENT_W - w) / 2 : rightEdge - w);
          y -= lineH;
        }
      } else {
        // 첫 줄 들여쓰기(BODY_INDENT + 에디터 들여쓰기), 이후 줄은 좌여백부터 — 공문과 동일
        const firstX = MARGIN_L + BODY_INDENT + extraIndent;
        const restX = MARGIN_L + extraIndent;
        wrapRuns(b.runs, fonts, size, PAGE_W - MARGIN_R - firstX, PAGE_W - MARGIN_R - restX).forEach((segs, i) => {
          ensure(lineH);
          drawSegsLine(segs, i === 0 ? firstX : restX);
          y -= lineH;
        });
      }
      y -= 2;
    } else {
      drawTableBlock(b);
      y -= 6;
    }
  });

  // ── 4) 붙임 ──
  const attachItems = (values.attachments_list ?? []).map((a) => (a.text ?? "").trim()).filter(Boolean);
  if (attachItems.length) {
    y -= 18;
    const label = "붙  임 : ";
    const labelWidth = fonts.bold.widthOfTextAtSize(label, size);
    const itemX = MARGIN_L + BODY_INDENT * 0.35;
    attachItems.forEach((item, i) => {
      ensure(lineH);
      const text = attachItems.length > 1 ? `${i + 1}. ${item}` : item;
      if (i === 0) page.drawText(label, { x: itemX, y: y - size, size, font: fonts.bold, color: INK });
      page.drawText(text, { x: itemX + labelWidth, y: y - size, size, font: fonts.regular, color: INK });
      y -= lineH;
    });
  }

  // ── 5) 서명 블록 — 시행일자 / 사명 / 대표이사 (직인). 한 덩어리로 같은 쪽에 둔다 ──
  {
    const sigSize = 15;
    const blockH = 34 + size + 30 + sigSize * 2 + 16;
    ensure(blockH);
    y -= 34;
    const dw = fonts.regular.widthOfTextAtSize(dateText, size);
    page.drawText(dateText, { x: (PAGE_W - dw) / 2, y: y - size, size, font: fonts.regular, color: INK });
    y -= size + 30;

    const cw = fonts.bold.widthOfTextAtSize(COMPANY_KO, sigSize);
    page.drawText(COMPANY_KO, { x: (PAGE_W - cw) / 2, y: y - sigSize, size: sigSize, font: fonts.bold, color: INK });
    y -= sigSize + 12;

    const head = `대표이사   ${spread(COMPANY_CEO)}`;
    const seal = "(직인)";
    const sealGap = sigSize * 1.6;
    const headW = fonts.bold.widthOfTextAtSize(head, sigSize);
    const sealW = fonts.bold.widthOfTextAtSize(seal, sigSize);
    const x = (PAGE_W - (headW + sealGap + sealW)) / 2;
    page.drawText(head, { x, y: y - sigSize, size: sigSize, font: fonts.bold, color: INK });
    const sealX = x + headW + sealGap;
    page.drawText(seal, { x: sealX, y: y - sigSize, size: sigSize, font: fonts.bold, color: INK });
    if (stamp) {
      // 직인은 '(직인)' 표기 위에 겹쳐 찍는다(관행)
      const stampW = 52;
      const stampH = (stamp.height / stamp.width) * stampW;
      page.drawImage(stamp, {
        x: sealX + sealW / 2 - stampW / 2,
        y: y - sigSize / 2 - stampH / 2 - 2,
        width: stampW,
        height: stampH,
        opacity: 0.92,
      });
    }
    y -= sigSize;
  }

  // ── 6) 쪽 번호(2쪽 이상일 때만) ──
  if (pages.length > 1) {
    pages.forEach((p, i) => {
      const t = `- ${i + 1} -`;
      const w = fonts.regular.widthOfTextAtSize(t, 9);
      p.drawText(t, { x: (PAGE_W - w) / 2, y: 30, size: 9, font: fonts.regular, color: INK });
    });
  }

  return await doc.save();
}
