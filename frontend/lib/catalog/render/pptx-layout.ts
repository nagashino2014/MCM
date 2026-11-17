/*
 * 갑지 편집형 PPT — 표지에서 잰 글자 줄(pptx-measure.ts) → PowerPoint 글상자. 순수 함수(시험 대상).
 * PowerPoint 는 글상자 위 끝에서 0.96em 아래에 기준선을 둔다(Pretendard·Noto Sans KR 실측, 2026-11-17) — 기준선을 맞춰 상자를 놓는다.
 * 여러 줄(정확한 줄 간격)은 줄 간격의 약 80% 지점에 첫 기준선을 둔다(같은 날 PowerPoint 렌더 대조).
 */
import type { PptxParagraph, PptxTextBox } from "@/lib/print-kit/pptx";
import type { MeasuredLine, MeasuredSheet } from "./pptx-measure";

/** PowerPoint 글상자 위 끝 → 기준선(em) */
export const PPT_BASELINE_EM = 0.96;

const WEIGHT_NAME: Record<number, string> = { 100: "Thin", 200: "ExtraLight", 300: "Light", 500: "Medium", 600: "SemiBold", 800: "ExtraBold", 900: "Black" };

/** CSS 서체·굵기 → PowerPoint 서체 이름·굵게. 400·700 은 기본 이름(700 은 굵게), 나머지는 "가족 굵기이름"(Windows 정적 서체 이름) */
export function pptFont(family: string, weight: number): { font: string; bold: boolean } {
  const w = Math.min(900, Math.max(100, Math.round(weight / 100) * 100));
  const name = family.trim() || "Pretendard";
  if (w === 400) return { font: name, bold: false };
  if (w === 700) return { font: name, bold: true };
  return { font: `${name} ${WEIGHT_NAME[w]}`, bold: false };
}

/** "rgb(r, g, b)" · "rgba(r, g, b, a)" → RRGGBB·불투명도 */
export function cssColor(v: string): { hex: string; alpha: number } {
  const m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)/.exec(v);
  if (!m) return { hex: "000000", alpha: 1 };
  const h = (x: string) => Math.max(0, Math.min(255, Math.round(Number(x)))).toString(16).padStart(2, "0").toUpperCase();
  const a = m[4] == null ? 1 : m[4].endsWith("%") ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
  return { hex: h(m[1]) + h(m[2]) + h(m[3]), alpha: Number.isFinite(a) ? a : 1 };
}

/** 잰 줄(쪽 px) → 슬라이드 글상자(pt). 같은 글 노드의 줄은 한 글상자의 문단들로 묶는다 */
export function measuredToTextBoxes(sheet: MeasuredSheet, slideW: number, slideH: number): PptxTextBox[] {
  const kx = slideW / (sheet.width || 842);
  const ky = slideH / (sheet.height || 595);
  const k = (kx + ky) / 2;
  const byNode = new Map<number, MeasuredLine[]>();
  for (const l of sheet.lines) {
    if (!l.text.trim()) continue;
    const list = byNode.get(l.node) ?? [];
    list.push(l);
    byNode.set(l.node, list);
  }
  const boxes: PptxTextBox[] = [];
  for (const lines of byNode.values()) {
    lines.sort((a, b) => a.baseline - b.baseline);
    const first = lines[0];
    const size = first.size * k;
    const { font, bold } = pptFont(first.family, first.weight);
    const { hex, alpha } = cssColor(first.color);
    const pitch = lines.length > 1 ? ((lines[lines.length - 1].baseline - first.baseline) / (lines.length - 1)) * ky : 0;
    const paragraphs: PptxParagraph[] = lines.map((l) => ({
      align: l.align === "center" ? "ctr" : l.align === "right" ? "r" : "l",
      lineSpacingPt: pitch ? Math.round(pitch * 100) / 100 : undefined,
      runs: [{ text: l.text, font, size: Math.round(size * 100) / 100, bold, italic: l.italic, color: hex, alpha, spacing: l.spacing ? Math.round(l.spacing * k * 100) / 100 : undefined }],
    }));
    const left = Math.min(...lines.map((l) => l.left)) * kx;
    const right = Math.max(...lines.map((l) => l.right)) * kx;
    // PowerPoint 서체 폭이 조금 달라도 줄이 바뀌지 않게(줄 바꿈 없음) 폭에 여유를 둔다 — 정렬 기준 쪽은 그대로
    const w = right - left + Math.max(4, size * 0.6);
    const align = paragraphs[0].align;
    const x = align === "r" ? right - w : align === "ctr" ? (left + right) / 2 - w / 2 : left;
    // 여러 줄(정확한 줄 간격)은 PowerPoint 가 줄 간격의 약 80% 지점에 첫 기준선을 둔다 — 한 줄은 0.96em
    const firstBaseline = first.baseline * ky;
    const y = firstBaseline - (pitch ? pitch * 0.8 : size * PPT_BASELINE_EM);
    const h = (pitch ? pitch * lines.length : size * 1.2) + 2;
    boxes.push({ x, y, w, h, paragraphs, name: lines.map((l) => l.text).join(" ").slice(0, 40) });
  }
  return boxes;
}
