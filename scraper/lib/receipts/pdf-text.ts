/**
 * PDF 에서 텍스트 뽑기
 *
 * 손으로 저장한 전표(쿠팡 묶음 등)를 대장에 넣기 위한 것이다. 자동 수집 경로는 화면 텍스트를
 * 그대로 받아 오지만(`--with-text`), 손으로 받은 파일에는 PDF 밖에 없다.
 *
 * 조각을 그냥 이어 붙이면 라벨과 값이 뒤엉켜 품목·금액 정규식이 빗나간다. 그래서 좌표를 보고
 * **같은 줄끼리 묶어** 화면에 보이던 배치를 최대한 살린다.
 */

import fs from "node:fs";

/** 같은 줄로 볼 y 좌표 오차(pt) — 글자 크기가 섞이면 소수점이 흔들린다 */
const LINE_TOLERANCE = 2;

function loadPdfjs(): any {
  // canvas 모듈이 없다는 경고가 뜨는데, 그건 그리기용이라 텍스트 추출에는 지장이 없다.
  const warn = console.warn;
  console.warn = () => {};
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("pdfjs-dist/legacy/build/pdf.js");
  } finally {
    console.warn = warn;
  }
}

/**
 * 한 줄을 이룰 조각들을 잇는다.
 *
 * 무조건 공백으로 이으면 글자마다 조각이 나뉘는 글꼴에서 "매 출 전 표" 가 되어 버려
 * 라벨을 찾는 정규식이 모두 빗나간다. 그래서 **앞 조각이 끝난 자리와의 간격**을 보고
 * 벌어져 있을 때만 공백을 넣는다.
 */
function joinRow(parts: { x: number; w: number; h: number; s: string }[]): string {
  const sorted = [...parts].sort((a, b) => a.x - b.x);
  let line = "";
  let end: number | null = null;

  for (const p of sorted) {
    if (end !== null) {
      const gap = p.x - end;
      if (gap > Math.max(1, (p.h || 10) * 0.25)) line += " ";
    }
    line += p.s;
    end = p.x + p.w;
  }

  return line.replace(/\s+/g, " ").trim();
}

export async function extractPdfText(file: string): Promise<string> {
  const pdfjs = loadPdfjs();
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;

  const pages: string[] = [];

  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();

      const rows: { y: number; parts: { x: number; w: number; h: number; s: string }[] }[] = [];

      for (const item of content.items as any[]) {
        if (typeof item.str !== "string" || !item.str.trim()) continue;
        const x = item.transform[4];
        const y = item.transform[5];

        const part = { x, w: item.width ?? 0, h: item.height ?? 0, s: item.str };
        const row = rows.find((r) => Math.abs(r.y - y) <= LINE_TOLERANCE);
        if (row) row.parts.push(part);
        else rows.push({ y, parts: [part] });
      }

      const lines = rows
        .sort((a, b) => b.y - a.y) // 위에서 아래로
        .map((r) => joinRow(r.parts))
        .filter(Boolean);

      pages.push(lines.join("\n"));
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }

  return pages.join("\n\n");
}
