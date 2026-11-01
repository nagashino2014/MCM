/*
 * 표지·간지 배경 그림 — 글자는 HWPX 문단으로 따로 얹고(한글에서 고칠 수 있게), 면·선만 그림으로 깐다.
 * 원본 포스코 제안서의 '옅은 사선 띠' 장식을 주색 면 2가지(짙은 면·옅은 면)와 가는 선으로 정리했다.
 * 좌표는 A4 pt(595×842). 발행 시 300dpi PNG 로 캡처해 글 뒤(BEHIND_TEXT)로 놓는다.
 */
import { mixWhite, type ThemePalette } from "./design";

export const A4 = { w: 595.28, h: 841.89 } as const;
export const COVER_ART_ID = "__cover";
export const DIVIDER_ART_ID = "__divider";

export function CoverArt({ pal, variant }: { pal: ThemePalette; variant: "modern" | "classic" }) {
  const { w, h } = A4;
  if (variant === "classic") {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={{ display: "block" }}>
        <rect width={w} height={h} fill="#FFFFFF" />
        <rect x={0} y={0} width={w} height={12} fill={pal.primary} />
        <rect x={0} y={12} width={w} height={3} fill={pal.accent} />
        <rect x={34} y={48} width={w - 68} height={h - 96} fill="none" stroke={pal.line} strokeWidth={0.8} />
        <rect x={40} y={54} width={w - 80} height={h - 108} fill="none" stroke={pal.primary} strokeWidth={1.6} />
        <rect x={0} y={h - 15} width={w} height={3} fill={pal.accent} />
        <rect x={0} y={h - 12} width={w} height={12} fill={pal.primary} />
      </svg>
    );
  }
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={{ display: "block" }}>
      <rect width={w} height={h} fill="#FFFFFF" />
      <rect x={0} y={0} width={18} height={h} fill={pal.primary} />
      <rect x={18} y={0} width={3} height={h} fill={pal.accent} />
      <rect x={21} y={h - 214} width={w - 21} height={214} fill={pal.tint2} />
      <circle cx={w + 40} cy={h - 250} r={250} fill={pal.tint} />
      <circle cx={w + 10} cy={h - 160} r={190} fill={mixWhite(pal.primary2, 0.55)} />
      <circle cx={w - 30} cy={h - 40} r={130} fill={pal.primary2} />
      <circle cx={w + 30} cy={h + 30} r={140} fill={pal.primary} />
      <circle cx={w - 140} cy={h - 330} r={58} fill="none" stroke={pal.line} strokeWidth={1} />
      <circle cx={w - 140} cy={h - 330} r={4} fill={pal.accent} />
      <line x1={51} y1={404} x2={330} y2={404} stroke={pal.primary} strokeWidth={2.4} />
      <line x1={330} y1={404} x2={w} y2={404} stroke={pal.line} strokeWidth={0.8} />
    </svg>
  );
}

export function DividerArt({ pal }: { pal: ThemePalette }) {
  const { w, h } = A4;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={{ display: "block" }}>
      <rect width={w} height={h} fill="#FFFFFF" />
      <rect x={0} y={0} width={w} height={470} fill={pal.primary} />
      <circle cx={w - 60} cy={110} r={190} fill={mixWhite(pal.primary, 0.1)} />
      <circle cx={w - 60} cy={110} r={120} fill="none" stroke={mixWhite(pal.primary, 0.28)} strokeWidth={1} />
      <rect x={51} y={470} width={120} height={4} fill={pal.accent} />
      <rect x={0} y={h - 12} width={w} height={12} fill={pal.tint} />
    </svg>
  );
}
