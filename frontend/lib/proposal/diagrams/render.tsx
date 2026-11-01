/*
 * 제안서 도식 8종 — 순수 SVG(훅 없음). 미리보기와 발행 PNG 캡처가 같은 마크업을 쓴다.
 * 좌표 단위는 pt(1pt = 1px), 상자 크기는 블록의 mm 를 pt 로 바꿔 받는다. 색은 문서 팔레트에서만 가져온다.
 */
import type { ReactNode } from "react";
import {
  Award, BarChart3, BookOpen, Building2, CalendarCheck, ClipboardCheck, Compass, Database, Droplets, Factory, FileCheck, FileText,
  FlaskConical, Gauge, Globe, GraduationCap, Handshake, HardHat, Landmark, Leaf, Lightbulb, Map as MapIcon, Megaphone, MessageSquare,
  Network, Recycle, Scale, SearchCheck, Settings, ShieldCheck, Sprout, Target, Trash2, TrendingUp, Users, Volume2, Wind, Workflow, Zap,
  type LucideIcon,
} from "lucide-react";
import { FONT, NEUTRAL, mixWhite, contrast, type ThemePalette } from "../design";
import type { DiagramItem, DiagramSpec } from "./types";
import { textWidth, wrap } from "../text";

export { textWidth, wrap };

const ICONS: Record<string, LucideIcon> = {
  factory: Factory, wind: Wind, droplets: Droplets, "volume-2": Volume2, "trash-2": Trash2, "flask-conical": FlaskConical, leaf: Leaf,
  sprout: Sprout, recycle: Recycle, "shield-check": ShieldCheck, "file-check": FileCheck, "search-check": SearchCheck,
  "clipboard-check": ClipboardCheck, users: Users, gauge: Gauge, scale: Scale, "bar-chart-3": BarChart3, target: Target,
  "building-2": Building2, landmark: Landmark, lightbulb: Lightbulb, handshake: Handshake, "graduation-cap": GraduationCap,
  settings: Settings, workflow: Workflow, "calendar-check": CalendarCheck, compass: Compass, "trending-up": TrendingUp, award: Award,
  "book-open": BookOpen, megaphone: Megaphone, database: Database, network: Network, "hard-hat": HardHat, map: MapIcon,
  "file-text": FileText, "message-square": MessageSquare, zap: Zap, globe: Globe,
};
const DEFAULT_ICONS = ["search-check", "file-check", "shield-check", "users", "target", "trending-up", "leaf"];

export interface DiagramBox { w: number; h: number }

function T({ x, y, lines, fs, fill, weight = 400, anchor = "middle", lh = 1.3, valign = "middle" }: {
  x: number; y: number; lines: string[]; fs: number; fill: string; weight?: number; anchor?: "start" | "middle" | "end"; lh?: number; valign?: "top" | "middle";
}) {
  const total = lines.length * fs * lh;
  const y0 = valign === "middle" ? y - total / 2 + fs * lh * 0.5 + fs * 0.35 : y + fs * 0.9;
  return (
    <text x={x} y={y0} fontSize={fs} fill={fill} fontWeight={weight} textAnchor={anchor}>
      {lines.map((l, i) => <tspan key={i} x={x} dy={i === 0 ? 0 : fs * lh}>{l}</tspan>)}
    </text>
  );
}

function Ico({ name, x, y, s, color, fallback = 0 }: { name?: string; x: number; y: number; s: number; color: string; fallback?: number }) {
  const C = ICONS[name || ""] ?? ICONS[DEFAULT_ICONS[fallback % DEFAULT_ICONS.length]];
  return <C x={x} y={y} width={s} height={s} stroke={color} strokeWidth={2} fill="none" />;
}

/**
 * 항목 색 — 항목에 직접 지정한 색 > 다색(기본)이면 팔레트 6색을 순서대로 > 테마 단색이면 fallback.
 * 글자는 색을 입히지 않고 표식(면·선·아이콘)만 칠한다. 중심·상위 노드는 그래파이트(2.1).
 */
const isMulti = (spec: DiagramSpec, pal: ThemePalette, it?: DiagramItem) => !!it?.color || (spec.tone !== "theme" && !!pal.series?.length);
const itemColor = (spec: DiagramSpec, pal: ThemePalette, i: number, fallback: string, it: DiagramItem | undefined = spec.items[i]) =>
  it?.color ?? (isMulti(spec, pal) ? pal.series![i % pal.series!.length] : fallback);
const HUB = NEUTRAL.graphite;
const soft = (c: string) => mixWhite(c, 0.86);
const softer = (c: string) => mixWhite(c, 0.93);

const onColor = (bg: string) => (contrast(bg, "#FFFFFF") >= 3 ? "#FFFFFF" : NEUTRAL.ink);
const descLines = (d?: string) => (d || "").split("\n").map((s) => s.trim()).filter(Boolean);

// ── 허브·방사 ────────────────────────────────────────────────────────────────
function Hub({ spec, box, pal }: Props) {
  const { w, h } = box;
  const items = spec.items;
  const cx = w / 2, cy = h / 2;
  const hasDesc = items.some((it) => it.desc?.trim());
  const center = spec.center?.label || "";
  if (hasDesc) {
    // 좌우 두 줄 — 원본 '제안사 특징 및 장점'(중앙 고리 + 좌우 설명) 구조
    const rc = Math.min(h * 0.3, 62);
    const left = items.slice(0, Math.ceil(items.length / 2)), right = items.slice(Math.ceil(items.length / 2));
    const colW = (w - rc * 2 - 56) / 2;
    const side = (list: DiagramItem[], isLeft: boolean, offset: number) => list.map((it, i) => {
      const rowH = h / list.length;
      const y = rowH * i + rowH / 2;
      const x0 = isLeft ? 0 : w - colW;
      const iconS = 16;
      const tx = x0 + iconS + 12;
      const lines = wrap(it.desc || "", colW - iconS - 14, 8);
      const label = wrap(it.label, colW - iconS - 14, 9.5);
      const blockH = label.length * 12.5 + lines.length * 10.5;
      const ty = y - blockH / 2;
      const edgeX = isLeft ? x0 + colW + 4 : x0 - 4;
      const circleX = cx + (isLeft ? -1 : 1) * rc * Math.sqrt(Math.max(0, 1 - ((y - cy) / (rc + 4)) ** 2));
      return (
        <g key={it.id}>
          <line x1={edgeX} y1={y} x2={Math.abs(y - cy) < rc ? circleX : cx + (isLeft ? -rc : rc) * 0.6} y2={Math.abs(y - cy) < rc ? y : cy + Math.sign(y - cy) * rc * 0.8} stroke={isMulti(spec, pal, spec.items[offset + i]) ? mixWhite(itemColor(spec, pal, offset + i, pal.line), 0.35) : pal.line} strokeWidth={1} strokeDasharray="2 2" />
          <circle cx={x0 + iconS / 2 + 2} cy={ty + 8} r={iconS / 2 + 3} fill={isMulti(spec, pal, spec.items[offset + i]) ? soft(itemColor(spec, pal, offset + i, pal.primary)) : pal.tint} />
          <Ico name={it.icon} x={x0 + 2 + 1} y={ty + 1} s={iconS - 2} color={itemColor(spec, pal, offset + i, pal.primary)} fallback={offset + i} />
          <T x={tx} y={ty} lines={label} fs={9.5} fill={NEUTRAL.ink} weight={700} anchor="start" valign="top" lh={1.3} />
          <T x={tx} y={ty + label.length * 12.5 + 1} lines={lines} fs={8} fill={NEUTRAL.ink2} anchor="start" valign="top" lh={1.3} />
        </g>
      );
    });
    return (
      <>
        <circle cx={cx} cy={cy} r={rc + 6} fill="none" stroke={NEUTRAL.rule} strokeWidth={6} />
        <circle cx={cx} cy={cy} r={rc} fill={HUB} />
        <T x={cx} y={cy - (spec.center?.desc ? 6 : 0)} lines={wrap(center, rc * 1.55, 10.5)} fs={10.5} fill="#FFFFFF" weight={700} />
        {spec.center?.desc ? <T x={cx} y={cy + 18} lines={wrap(spec.center.desc, rc * 1.5, 7.5)} fs={7.5} fill={mixWhite(HUB, 0.72)} /> : null}
        {side(left, true, 0)}
        {side(right, false, left.length)}
      </>
    );
  }
  // 고리형 — 원본 '7개 개별법 → 통합법' 구조
  const fs = 9;
  const pills = items.map((it) => { const lines = wrap(it.label, 96, fs); return { it, lines, pw: Math.max(...lines.map((l) => textWidth(l, fs))) + 20, ph: lines.length * fs * 1.3 + 12 }; });
  const maxW = Math.max(...pills.map((p) => p.pw)), maxH = Math.max(...pills.map((p) => p.ph));
  const rx = w / 2 - maxW / 2 - 4, ry = h / 2 - maxH / 2 - 4;
  const rc = Math.min(ry - maxH / 2 - 6, rx * 0.42, 70);
  return (
    <>
      {pills.map((p, i) => {
        const a = -Math.PI / 2 + (2 * Math.PI * i) / items.length;
        return <line key={`s${i}`} x1={cx} y1={cy} x2={cx + rx * Math.cos(a)} y2={cy + ry * Math.sin(a)} stroke={isMulti(spec, pal, spec.items[i]) ? mixWhite(itemColor(spec, pal, i, pal.line), 0.45) : pal.line} strokeWidth={1.2} />;
      })}
      <circle cx={cx} cy={cy} r={rc + 5} fill={NEUTRAL.panel} />
      <circle cx={cx} cy={cy} r={rc} fill={HUB} />
      <T x={cx} y={cy} lines={wrap(center, rc * 1.6, 10.5)} fs={10.5} fill="#FFFFFF" weight={700} />
      {pills.map((p, i) => {
        const a = -Math.PI / 2 + (2 * Math.PI * i) / items.length;
        const x = cx + rx * Math.cos(a), y = cy + ry * Math.sin(a);
        return (
          <g key={p.it.id}>
            <rect x={x - p.pw / 2} y={y - p.ph / 2} width={p.pw} height={p.ph} rx={p.ph / 2} fill={isMulti(spec, pal, spec.items[i]) ? softer(itemColor(spec, pal, i, pal.primary2)) : "#FFFFFF"} stroke={itemColor(spec, pal, i, pal.primary2)} strokeWidth={1.4} />
            <T x={x} y={y} lines={p.lines} fs={fs} fill={NEUTRAL.ink} weight={700} />
          </g>
        );
      })}
    </>
  );
}

// ── 수행 조직도 ──────────────────────────────────────────────────────────────
function Org({ spec, box, pal }: Props) {
  const { w, h } = box;
  const top = spec.items.find((it) => it.group === "top");
  const left = spec.items.filter((it) => it.group === "left");
  const right = spec.items.filter((it) => it.group === "right");
  const units = spec.items.filter((it) => !["top", "left", "right"].includes(it.group || "unit"));
  const cx = w / 2;
  const topW = 168, topH = top?.desc ? 38 : 26;
  const n = Math.max(1, units.length);
  const gap = 10;
  const unitW = Math.min(132, (w - gap * (n - 1)) / n);
  const unitLines = units.map((u) => descLines(u.desc).flatMap((l) => wrap(l, unitW - 12, 8)));
  const unitBodyH = Math.max(18, ...unitLines.map((l) => l.length * 10.5 + 8));
  const unitH = 22 + unitBodyH;
  const busY = h - unitH - 12;
  const midTop = topH + 12, midBot = busY - 8;
  const stack = (list: DiagramItem[], isLeft: boolean) => {
    if (!list.length) return null;
    const bw = 96, bh = 19, g = 5;
    const total = list.length * bh + (list.length - 1) * g;
    const y0 = (midTop + midBot) / 2 - total / 2;
    const x0 = isLeft ? cx - 34 - bw : cx + 34;
    const joinX = isLeft ? x0 + bw + 10 : x0 - 10;
    return (
      <g>
        <line x1={joinX} y1={y0 + bh / 2} x2={joinX} y2={y0 + total - bh / 2} stroke={NEUTRAL.steel} strokeWidth={1} />
        <line x1={joinX} y1={(y0 + y0 + total) / 2} x2={cx} y2={(y0 + y0 + total) / 2} stroke={NEUTRAL.steel} strokeWidth={1} />
        {list.map((it, i) => {
          const y = y0 + i * (bh + g);
          return (
            <g key={it.id}>
              <line x1={isLeft ? x0 + bw : x0} y1={y + bh / 2} x2={joinX} y2={y + bh / 2} stroke={NEUTRAL.steel} strokeWidth={1} />
              <rect x={x0} y={y} width={bw} height={bh} rx={3} fill={isLeft ? "#FFFFFF" : NEUTRAL.panel} stroke={NEUTRAL.line} strokeWidth={1} />
              <T x={x0 + bw / 2} y={y + bh / 2} lines={[[it.label, it.desc].filter(Boolean).join(" ")]} fs={8.5} fill={NEUTRAL.ink} weight={isLeft ? 600 : 700} />
            </g>
          );
        })}
      </g>
    );
  };
  const ux = (i: number) => (w - (n * unitW + (n - 1) * gap)) / 2 + i * (unitW + gap);
  return (
    <>
      <line x1={cx} y1={topH + 2} x2={cx} y2={busY} stroke={NEUTRAL.steel} strokeWidth={1.2} />
      {units.length > 1 ? <line x1={ux(0) + unitW / 2} y1={busY} x2={ux(n - 1) + unitW / 2} y2={busY} stroke={NEUTRAL.steel} strokeWidth={1.2} /> : null}
      {stack(left, true)}
      {stack(right, false)}
      {top ? (
        <g>
          <rect x={cx - topW / 2} y={2} width={topW} height={topH} rx={4} fill={HUB} />
          <T x={cx} y={2 + (top.desc ? 13 : topH / 2)} lines={[top.label]} fs={10} fill="#FFFFFF" weight={700} />
          {top.desc ? <T x={cx} y={2 + 27} lines={[top.desc]} fs={8} fill={mixWhite(HUB, 0.75)} /> : null}
        </g>
      ) : null}
      {units.map((u, i) => (
        <g key={u.id}>
          <line x1={ux(i) + unitW / 2} y1={busY} x2={ux(i) + unitW / 2} y2={busY + 12} stroke={NEUTRAL.steel} strokeWidth={1.2} />
          <rect x={ux(i)} y={busY + 12} width={unitW} height={22} rx={3} fill={itemColor(spec, pal, i, pal.primary2, u)} />
          <T x={ux(i) + unitW / 2} y={busY + 23} lines={wrap(u.label, unitW - 8, 9).slice(0, 1)} fs={9} fill="#FFFFFF" weight={700} />
          <rect x={ux(i)} y={busY + 34} width={unitW} height={unitBodyH} fill={isMulti(spec, pal, u) ? softer(itemColor(spec, pal, i, pal.primary2, u)) : pal.tint2} stroke={isMulti(spec, pal, u) ? mixWhite(itemColor(spec, pal, i, pal.primary2, u), 0.6) : pal.line} strokeWidth={0.8} />
          <T x={ux(i) + unitW / 2} y={busY + 38} lines={unitLines[i]} fs={8} fill={NEUTRAL.ink2} valign="top" lh={1.3} />
        </g>
      ))}
    </>
  );
}

// ── 전후 비교 ────────────────────────────────────────────────────────────────
function BeforeAfter({ spec, box, pal }: Props) {
  const { w, h } = box;
  const [la, lb] = spec.legend ?? ["이전", "이후"];
  const labelW = 74, arrowW = 22, gap = 6;
  const colW = (w - labelW - arrowW - gap * 2) / 2;
  const fs = 8.5, lh = fs * 1.35;
  const rows = spec.items.map((it) => {
    const a = wrap(it.a || "", colW - 16, fs), b = wrap(it.b || "", colW - 16, fs), l = wrap(it.label, labelW - 10, 9);
    return { it, a, b, l, rh: Math.max(a.length, b.length, l.length) * lh + 12 };
  });
  const headH = 20;
  const avail = h - headH - 6;
  const sum = rows.reduce((s, r) => s + r.rh, 0);
  const extra = Math.max(0, (avail - sum - (rows.length - 1) * 5) / rows.length);
  let y = headH + 6;
  const xa = labelW + gap, xb = xa + colW + arrowW;
  return (
    <>
      <rect x={xa} y={0} width={colW} height={headH} rx={headH / 2} fill={NEUTRAL.muted} />
      <T x={xa + colW / 2} y={headH / 2} lines={[la]} fs={9.5} fill="#FFFFFF" weight={700} />
      <rect x={xb} y={0} width={colW} height={headH} rx={headH / 2} fill={pal.primary} />
      <T x={xb + colW / 2} y={headH / 2} lines={[lb]} fs={9.5} fill="#FFFFFF" weight={700} />
      {rows.map((r, ri) => {
        const rh = r.rh + extra; const y0 = y; y += rh + 5;
        const c = itemColor(spec, pal, ri, pal.primary2);
        const multi = isMulti(spec, pal, r.it);
        return (
          <g key={r.it.id}>
            <rect x={0} y={y0} width={labelW} height={rh} rx={3} fill={multi ? soft(c) : NEUTRAL.panel} />
            {multi ? <rect x={0} y={y0} width={3} height={rh} fill={c} /> : null}
            <T x={labelW / 2} y={y0 + rh / 2} lines={r.l} fs={9} fill={NEUTRAL.ink} weight={700} />
            <rect x={xa} y={y0} width={colW} height={rh} rx={3} fill={NEUTRAL.panel} />
            <T x={xa + 8} y={y0 + rh / 2} lines={r.a} fs={fs} fill={NEUTRAL.ink2} anchor="start" lh={1.35} />
            <path d={`M${xa + colW + 5} ${y0 + rh / 2 - 6} L${xa + colW + arrowW - 5} ${y0 + rh / 2} L${xa + colW + 5} ${y0 + rh / 2 + 6} Z`} fill={multi ? c : NEUTRAL.steel} />
            <rect x={xb} y={y0} width={colW} height={rh} rx={3} fill="#FFFFFF" stroke={c} strokeWidth={1.2} />
            <T x={xb + 8} y={y0 + rh / 2} lines={r.b} fs={fs} fill={NEUTRAL.ink} weight={600} anchor="start" lh={1.35} />
          </g>
        );
      })}
    </>
  );
}

// ── 피라미드 ─────────────────────────────────────────────────────────────────
function Pyramid({ spec, box, pal }: Props) {
  const { w, h } = box;
  const items = spec.items;
  const n = items.length;
  const hasDesc = items.some((it) => it.desc?.trim());
  const pw = hasDesc ? Math.min(w * 0.44, h * 1.5) : Math.min(w * 0.7, h * 1.7);
  const x0 = hasDesc ? 0 : (w - pw) / 2;
  const gap = 3;
  const lh = (h - gap * (n - 1)) / n;
  const tones = [pal.primary, pal.primary2, mixWhite(pal.primary2, 0.3), mixWhite(pal.primary2, 0.5), mixWhite(pal.primary2, 0.65)];
  return (
    <>
      {items.map((it, i) => {
        const yt = i * (lh + gap), yb = yt + lh;
        const wt = pw * (i / n), wb = pw * ((i + 1) / n);
        const mid = x0 + pw / 2;
        const fill = isMulti(spec, pal, it) ? itemColor(spec, pal, i, pal.primary) : tones[i] ?? tones[tones.length - 1];
        const pts = `${mid - wt / 2},${yt} ${mid + wt / 2},${yt} ${mid + wb / 2},${yb} ${mid - wb / 2},${yb}`;
        const label = wrap(it.label, Math.max(40, (wt + wb) / 2 - 16), 9.5);
        const dl = wrap(it.desc || "", w - pw - 34, 8.5);
        return (
          <g key={it.id}>
            <polygon points={pts} fill={fill} />
            <T x={mid} y={yt + lh * (i === 0 ? 0.62 : 0.5)} lines={label} fs={9.5} fill={onColor(fill)} weight={700} />
            {hasDesc ? (
              <g>
                <line x1={mid + (wt + wb) / 4 + 4} y1={yt + lh / 2} x2={pw + 16} y2={yt + lh / 2} stroke={pal.line} strokeWidth={1} strokeDasharray="2 2" />
                <circle cx={pw + 18} cy={yt + lh / 2} r={2.5} fill={fill} />
                <T x={pw + 26} y={yt + lh / 2} lines={dl} fs={8.5} fill={NEUTRAL.ink2} anchor="start" lh={1.35} />
              </g>
            ) : null}
          </g>
        );
      })}
    </>
  );
}

// ── 반원 방사 ────────────────────────────────────────────────────────────────
function Arc({ spec, box, pal }: Props) {
  const { w, h } = box;
  const items = spec.items;
  const n = items.length;
  const cx = w / 2, cy = h - 4;
  const r0 = Math.min(h - 100, w * 0.18, 76);
  const r1 = r0 + 16;
  const r2 = r1 + 30;
  const base = isMulti(spec, pal) ? pal.series! : [pal.primary2, pal.accent, mixWhite(pal.primary2, 0.35), mixWhite(pal.accent, 0.25)];
  const tones = items.map((it, i) => it.color ?? base[i % base.length]);
  const arcPath = (a0: number, a1: number, ra: number, rb: number) => {
    const p = (r: number, a: number) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
    return `M${p(ra, a0)} A${ra} ${ra} 0 0 1 ${p(ra, a1)} L${p(rb, a1)} A${rb} ${rb} 0 0 0 ${p(rb, a0)} Z`;
  };
  return (
    <>
      {items.map((it, i) => {
        const a0 = Math.PI + (Math.PI * i) / n + 0.012, a1 = Math.PI + (Math.PI * (i + 1)) / n - 0.012;
        return <path key={`seg${i}`} d={arcPath(a0, a1, r1, r0 + 2)} fill={tones[i]} />;
      })}
      <path d={`M${cx - r0} ${cy} A${r0} ${r0} 0 0 1 ${cx + r0} ${cy} Z`} fill={HUB} />
      <T x={cx} y={cy - r0 * 0.42} lines={wrap(spec.center?.label || "", r0 * 1.5, 10)} fs={10} fill="#FFFFFF" weight={700} />
      {spec.center?.desc ? <T x={cx} y={cy - r0 * 0.12} lines={wrap(spec.center.desc, r0 * 1.5, 7.5)} fs={7.5} fill={mixWhite(HUB, 0.72)} /> : null}
      {items.map((it, i) => {
        const a = Math.PI + (Math.PI * (i + 0.5)) / n;
        const tone = tones[i];
        const ix = cx + r2 * Math.cos(a), iy = cy + r2 * Math.sin(a);
        const lx = cx + (r2 + 26) * Math.cos(a), ly = cy + (r2 + 26) * Math.sin(a);
        const anchor = Math.cos(a) < -0.25 ? "end" : Math.cos(a) > 0.25 ? "start" : "middle";
        const lines = wrap(it.label, 86, 9);
        return (
          <g key={it.id}>
            <line x1={cx + r1 * Math.cos(a)} y1={cy + r1 * Math.sin(a)} x2={ix} y2={iy} stroke={tone} strokeWidth={1} />
            <circle cx={ix} cy={iy} r={15} fill="#FFFFFF" stroke={tone} strokeWidth={1.8} />
            <Ico name={it.icon} x={ix - 8} y={iy - 8} s={16} color={isMulti(spec, pal, it) ? tone : tone === pal.accent ? pal.accent : pal.primary} fallback={i} />
            <T x={lx} y={anchor === "middle" ? ly - 10 : ly} lines={lines} fs={9} fill={NEUTRAL.ink} weight={700} anchor={anchor} />
          </g>
        );
      })}
    </>
  );
}

// ── 단계 화살표 ──────────────────────────────────────────────────────────────
function Chevrons({ spec, box, pal }: Props) {
  const { w, h } = box;
  const items = spec.items;
  const n = items.length;
  const tip = 11, gap = 3, headH = 30;
  const cw = (w - (n - 1) * (gap - tip)) / n;
  const tones = items.map((it, i) => (isMulti(spec, pal, it) ? itemColor(spec, pal, i, pal.primary) : n === 1 ? pal.primary : mixWhite(pal.primary, (0.42 * (n - 1 - i)) / (n - 1))));
  return (
    <>
      {items.map((it, i) => {
        const x0 = i * (cw - tip + gap);
        const x1 = x0 + cw;
        const notch = i === 0 ? 0 : tip;
        const pts = `${x0},0 ${x1 - tip},0 ${x1},${headH / 2} ${x1 - tip},${headH} ${x0},${headH} ${x0 + notch},${headH / 2}`;
        const fill = tones[i];
        const lines = descLines(it.desc).flatMap((l) => wrap(l, cw - tip - 16, 8.5).map((t, k) => (k === 0 ? "· " + t : "  " + t)));
        return (
          <g key={it.id}>
            <polygon points={pts} fill={fill} />
            <T x={x0 + (cw - tip) / 2 + notch / 2} y={headH / 2} lines={wrap(it.label, cw - tip - 14, 9.5).slice(0, 2)} fs={9.5} fill={onColor(fill)} weight={700} />
            <rect x={x0} y={headH + 6} width={cw - tip} height={h - headH - 7} fill={isMulti(spec, pal, it) ? softer(fill) : pal.tint2} />
            <rect x={x0} y={headH + 6} width={cw - tip} height={2} fill={fill} />
            <T x={x0 + 7} y={headH + 14} lines={lines} fs={8.5} fill={NEUTRAL.ink2} anchor="start" valign="top" lh={1.4} />
          </g>
        );
      })}
    </>
  );
}

// ── 중대성 매트릭스(산점도) ──────────────────────────────────────────────────
function Scatter({ spec, box, pal }: Props) {
  const { w, h } = box;
  const [ax, ay] = spec.axes ?? ["사업 영향도", "이해관계자 관심도"];
  const padL = 22, padB = 20, padT = spec.legend ? 16 : 4, padR = 6;
  const pw = w - padL - padR, ph = h - padB - padT;
  const X = (v: number) => padL + (Math.max(0, Math.min(100, v)) / 100) * pw;
  const Y = (v: number) => padT + ph - (Math.max(0, Math.min(100, v)) / 100) * ph;
  const colorOf = (g?: string) => (isMulti(spec, pal) ? pal.series![g === "b" ? 1 : 0] : g === "b" ? pal.accent : pal.primary);
  return (
    <>
      <rect x={padL} y={padT} width={pw} height={ph} fill="#FFFFFF" stroke={pal.line} strokeWidth={0.8} />
      <rect x={padL + pw / 2} y={padT} width={pw / 2} height={ph / 2} fill={pal.tint} />
      <line x1={padL + pw / 2} y1={padT} x2={padL + pw / 2} y2={padT + ph} stroke={pal.line} strokeDasharray="3 2" />
      <line x1={padL} y1={padT + ph / 2} x2={padL + pw} y2={padT + ph / 2} stroke={pal.line} strokeDasharray="3 2" />
      <line x1={padL} y1={padT + ph} x2={padL + pw} y2={padT + ph} stroke={NEUTRAL.ink2} strokeWidth={1} />
      <line x1={padL} y1={padT} x2={padL} y2={padT + ph} stroke={NEUTRAL.ink2} strokeWidth={1} />
      <T x={padL + pw / 2} y={h - 7} lines={[`${ax} →`]} fs={8.5} fill={NEUTRAL.ink2} weight={600} />
      <text x={9} y={padT + ph / 2} fontSize={8.5} fill={NEUTRAL.ink2} fontWeight={600} textAnchor="middle" transform={`rotate(-90 9 ${padT + ph / 2})`}>{`${ay} →`}</text>
      <T x={padL + pw - 4} y={padT + 9} lines={["중대 이슈 영역"]} fs={7.5} fill={pal.primary} anchor="end" weight={700} />
      {spec.legend ? (
        <g>
          <circle cx={padL + 4} cy={7} r={3.5} fill={colorOf("a")} />
          <T x={padL + 11} y={7} lines={[spec.legend[0]]} fs={8} fill={NEUTRAL.ink2} anchor="start" />
          <circle cx={padL + 18 + textWidth(spec.legend[0], 8)} cy={7} r={3.5} fill={colorOf("b")} />
          <T x={padL + 25 + textWidth(spec.legend[0], 8)} y={7} lines={[spec.legend[1]]} fs={8} fill={NEUTRAL.ink2} anchor="start" />
        </g>
      ) : null}
      {spec.items.map((it) => {
        const x = X(it.x ?? 50), y = Y(it.y ?? 50);
        const right = x < padL + pw * 0.75;
        return (
          <g key={it.id}>
            <circle cx={x} cy={y} r={4.5} fill={it.color ?? colorOf(it.group)} stroke="#FFFFFF" strokeWidth={1} />
            <T x={x + (right ? 7 : -7)} y={y} lines={[it.label]} fs={8} fill={NEUTRAL.ink} anchor={right ? "start" : "end"} />
          </g>
        );
      })}
    </>
  );
}

// ── 세 원 결합 ───────────────────────────────────────────────────────────────
function Venn({ spec, box, pal }: Props) {
  const { w, h } = box;
  const items = spec.items.slice(0, 3);
  const r = Math.min(h / 2 - 2, w / 5.3);
  const d = r * 1.62;
  const cx = w / 2, cy = h / 2;
  const fills = (isMulti(spec, pal) ? [0, 1, 2].map((i) => itemColor(spec, pal, i, pal.primary)) : [mixWhite(pal.primary2, 0.22), pal.primary2, pal.primary]).map((c, i) => items[i]?.color ?? c);
  return (
    <>
      {items.map((it, i) => {
        const x = cx + (i - 1) * d;
        return <circle key={`c${i}`} cx={x} cy={cy} r={r} fill={fills[i]} fillOpacity={isMulti(spec, pal) ? 0.9 : 0.94} stroke="#FFFFFF" strokeWidth={2} />;
      })}
      {items.map((it, i) => {
        const x = cx + (i - 1) * d + (i - 1) * r * 0.16;
        const tw = r * 1.08;
        const label = wrap(it.label, tw, 10.5);
        const desc = wrap(it.desc || "", tw, 8);
        const total = 14 + label.length * 13.5 + desc.length * 10.5;
        const y0 = cy - total / 2;
        const fg = onColor(fills[i]);
        return (
          <g key={it.id}>
            <T x={x} y={y0} lines={[String(i + 1).padStart(2, "0")]} fs={10} fill={fg} weight={700} valign="top" />
            <T x={x} y={y0 + 14} lines={label} fs={10.5} fill={fg} weight={700} valign="top" lh={1.25} />
            <T x={x} y={y0 + 16 + label.length * 13.5} lines={desc} fs={8} fill={fg} valign="top" lh={1.3} />
          </g>
        );
      })}
    </>
  );
}

interface Props { spec: DiagramSpec; box: DiagramBox; pal: ThemePalette }
const RENDER: Record<DiagramSpec["kind"], (p: Props) => ReactNode> = {
  hub: Hub, org: Org, beforeAfter: BeforeAfter, pyramid: Pyramid, arc: Arc, chevrons: Chevrons, scatter: Scatter, venn: Venn,
};

/** 도식 SVG — box 는 pt. 글꼴은 미리보기·한글과 같은 맑은 고딕 */
export function renderDiagram(spec: DiagramSpec, box: DiagramBox, pal: ThemePalette): ReactNode {
  const Draw = RENDER[spec.kind] ?? Hub;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${box.w} ${box.h}`} width={box.w} height={box.h} style={{ fontFamily: FONT.css, display: "block", overflow: "visible" }} role="img">
      <Draw spec={spec} box={box} pal={pal} />
    </svg>
  );
}
