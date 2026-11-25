/*
 * 회사소개서 쪽별 PDF 받기(사용자 지시 2026-11-25) — 생성본·발행본 PDF 에서 고른 쪽만 잘라 준다.
 *   스튜디오 쪽 ↔ PDF 쪽 번호: 조판 때 각 쪽 시트에 'pg:<쪽 키>' anchor 를 달고(html.ts), converter 쪽 지도(page_map.anchors)에서 읽는다.
 *   흐름 쪽(명단·상세 이력)은 여러 PDF 쪽으로 나뉘므로 다음 쪽 키의 첫 쪽 앞까지를 그 쪽 범위로 본다.
 *   스튜디오(브라우저)도 쪽 번호 검사에 쓰므로 pdf-lib 는 자르기 때만 불러온다.
 */

/** 쪽 키 anchor 접두어 — 문서 안 다른 anchor(sec-04·c12 등)와 겹치지 않게 */
export const PAGE_KEY_ANCHOR = "pg:";

/** 쪽 지도 anchors → 쪽 키별 PDF 쪽 범위 [첫 쪽, 끝 쪽](1부터). 이 기능 전에 만든 PDF 는 빈 객체 */
export function pageRangesOf(anchors: unknown, total: number): Record<string, [number, number]> {
  if (!anchors || typeof anchors !== "object") return {};
  const starts = Object.entries(anchors as Record<string, unknown>)
    .filter(([k, v]) => k.startsWith(PAGE_KEY_ANCHOR) && Array.isArray(v) && Number.isInteger(v[0]))
    .map(([k, v]) => ({ key: k.slice(PAGE_KEY_ANCHOR.length), start: Number((v as number[])[0]) }))
    .sort((a, b) => a.start - b.start);
  const out: Record<string, [number, number]> = {};
  starts.forEach((s, i) => {
    const end = (i + 1 < starts.length ? starts[i + 1].start : total + 1) - 1;
    out[s.key] = [s.start, Math.max(s.start, Math.min(end, total))];
  });
  return out;
}

/** 쪽 지정 '3' · '3-5' · '1,3-4' → 쪽 번호 목록(1부터, 오름차순·중복 없음). 형식이 틀리거나 범위를 벗어나면 null */
export function parsePageSpec(spec: string, total: number): number[] | null {
  const parts = spec.replace(/\s+/g, "").split(",").filter(Boolean);
  if (!parts.length || parts.length > 50) return null;
  const set = new Set<number>();
  for (const part of parts) {
    const m = /^(\d{1,4})(?:-(\d{1,4}))?$/.exec(part);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b < a || b > total) return null;
    for (let n = a; n <= b; n++) set.add(n);
  }
  return [...set].sort((x, y) => x - y);
}

/** 파일 이름 꼬리 — [3] → '_03쪽', [3,4,5] → '_03-05쪽', 띄엄띄엄이면 '_03-08쪽_일부' */
export function pageSuffix(pages: number[]): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const first = pages[0];
  const last = pages[pages.length - 1];
  if (first === last) return `_${pad(first)}쪽`;
  return `_${pad(first)}-${pad(last)}쪽${last - first + 1 === pages.length ? "" : "_일부"}`;
}

/** PDF 에서 고른 쪽만 새 PDF 로(쪽 번호는 1부터) */
export async function extractPdfPages(pdf: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const src = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  out.setTitle(src.getTitle() ?? "", { showInWindowTitleBar: true });
  const copied = await out.copyPages(src, pages.map((n) => n - 1));
  copied.forEach((p) => out.addPage(p));
  return out.save();
}
