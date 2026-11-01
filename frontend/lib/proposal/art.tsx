/*
 * 표지·간지 배경 그림 — 글자는 HWPX 문단으로 따로 얹고(한글에서 고칠 수 있게), 면·선만 그림으로 깐다.
 * 원본 포스코 제안서의 '옅은 사선 띠' 장식을 회색 면과 가는 선으로 정리하고, 테마 주색은 선 하나·원 하나에만 쓴다(2.1).
 * 좌표는 A4 pt(595×842). 발행 시 300dpi PNG 로 캡처해 글 뒤(BEHIND_TEXT)로 놓는다.
 */
import { NEUTRAL, mixWhite, type ThemePalette } from "./design";

const G = NEUTRAL.graphite;

export const A4 = { w: 595.28, h: 841.89 } as const;
export const COVER_ART_ID = "__cover";
export const DIVIDER_ART_ID = "__divider";

export function CoverArt({ pal, variant }: { pal: ThemePalette; variant: "modern" | "classic" }) {
  const { w, h } = A4;
  if (variant === "classic") {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={{ display: "block" }}>
        <rect width={w} height={h} fill="#FFFFFF" />
        <rect x={0} y={0} width={w} height={12} fill={G} />
        <rect x={0} y={12} width={w} height={2.4} fill={pal.primary} />
        <rect x={34} y={48} width={w - 68} height={h - 96} fill="none" stroke={NEUTRAL.line} strokeWidth={0.8} />
        <rect x={40} y={54} width={w - 80} height={h - 108} fill="none" stroke={G} strokeWidth={1.4} />
        <rect x={0} y={h - 14.4} width={w} height={2.4} fill={pal.primary} />
        <rect x={0} y={h - 12} width={w} height={12} fill={G} />
      </svg>
    );
  }
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={{ display: "block" }}>
      <rect width={w} height={h} fill="#FFFFFF" />
      <rect x={0} y={0} width={18} height={h} fill={G} />
      <rect x={18} y={0} width={2.4} height={h} fill={pal.primary} />
      <rect x={20.4} y={h - 214} width={w - 20.4} height={214} fill={NEUTRAL.panel2} />
      <circle cx={w + 40} cy={h - 250} r={250} fill={NEUTRAL.panel} />
      <circle cx={w + 10} cy={h - 160} r={190} fill={mixWhite(G, 0.84)} />
      <circle cx={w - 30} cy={h - 40} r={130} fill={mixWhite(G, 0.42)} />
      <circle cx={w + 30} cy={h + 30} r={140} fill={pal.primary} />
      <circle cx={w - 140} cy={h - 330} r={58} fill="none" stroke={NEUTRAL.line} strokeWidth={1} />
      <circle cx={w - 140} cy={h - 330} r={4} fill={pal.primary} />
      <line x1={51} y1={404} x2={330} y2={404} stroke={pal.primary} strokeWidth={2.4} />
      <line x1={330} y1={404} x2={w} y2={404} stroke={NEUTRAL.line} strokeWidth={0.8} />
    </svg>
  );
}

export function DividerArt({ pal }: { pal: ThemePalette }) {
  const { w, h } = A4;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={{ display: "block" }}>
      <rect width={w} height={h} fill="#FFFFFF" />
      <rect x={0} y={0} width={w} height={470} fill={G} />
      <circle cx={w - 60} cy={110} r={190} fill={mixWhite(G, 0.08)} />
      <circle cx={w - 60} cy={110} r={120} fill="none" stroke={mixWhite(G, 0.3)} strokeWidth={1} />
      <rect x={51} y={470} width={120} height={4} fill={pal.primary} />
      <rect x={0} y={h - 12} width={w} height={12} fill={NEUTRAL.panel} />
    </svg>
  );
}
