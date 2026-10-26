/*
 * 인포그래픽 유형별 그리기 — 같은 내용(InfoContent)을 유형(모양)마다 디자인 시스템 마크업(kc-*)으로 그린다.
 * 훅·컨텍스트 없음(서버 정적 렌더·스튜디오 공용). 글자는 HTML 로 얹어 PDF 에서 검색·복사된다(README §인포그래픽).
 * 마스터본 기본 유형(단계 흐름·전후 비교·막대·도넛)은 P4 부품(components/infographics.tsx)을 그대로 써서 모양이 같다.
 */
import type { CSSProperties, ReactNode } from "react";
import { REGION_GROUPS } from "@/lib/catalog/regions";
import { Icon, cx, fmt } from "../components/parts";
import { Bars, Compare, Donut, HBars, KoreaMap, Process, type RootAttrs } from "../components/infographics";
import { MAP_H, MAP_W } from "../korea-map";
import { defaultVariant, type InfoBox, type InfoColorMode, type InfoItem, type InfoSpec } from "./types";

const SHARE_CLS = ["kc-s1", "kc-s2", "kc-s3", "kc-s4", "kc-s5"];
/** 아이콘이 없는 항목의 기본 아이콘(순서대로) */
const DEFAULT_ICONS = ["file-check", "search-check", "shield-check", "list-checks", "refresh-cw", "scale", "file-text", "network", "database", "workflow", "award", "check"];

/** 색 모드 — 분야 색(기본, 쪽의 kc-area-n 을 따른다) / 브랜드 색 / 무채색 */
export function colorModeVars(mode: InfoColorMode | undefined): CSSProperties | undefined {
  if (mode === "brand") return { "--area": "var(--brand)", "--area-mid": "var(--accent-2)", "--area-tint": "var(--brand-tint)" } as CSSProperties;
  if (mode === "mono") return { "--area": "var(--ink)", "--area-mid": "var(--ink-muted)", "--area-tint": "var(--canvas)" } as CSSProperties;
  return undefined;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** 구성비 색 단계 kc-s1..5 — 항목에 tone 이 있으면 그 단계 */
const toneCls = (it: InfoItem, i: number) => (it.tone ? `kc-s${it.tone}` : SHARE_CLS[i % SHARE_CLS.length]);
const valueText = (it: InfoItem, unit?: string) => it.valueText ?? `${fmt(it.value ?? null)}${it.unit ?? unit ?? ""}`;

/** 원형 배치(순환·허브·협력 관계) — 위에서 시작해 시계 방향 */
function orbitLayout(n: number, box: InfoBox) {
  const w = clamp(Math.round(box.w), 300, 460);
  const h = clamp(Math.round(box.h), 210, 260);
  const cx0 = w / 2;
  const cy0 = h / 2 + 2;
  const rx = Math.min(w / 2 - 56, h / 2 + 30);
  const ry = h / 2 - 26;
  const nodes = Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return { x: Math.round(cx0 + rx * Math.cos(a)), y: Math.round(cy0 + ry * Math.sin(a)) };
  });
  return { w, h, cx: cx0, cy: cy0, r: Math.min(rx, ry) - 4, nodes };
}

function Orbit({ spec, box, root, kind }: { spec: InfoSpec; box: InfoBox; root: RootAttrs; kind: "cycle" | "hub" | "network" }) {
  const items = spec.content.items;
  const L = orbitLayout(items.length, box);
  const centerLabel = spec.content.center?.label ?? spec.content.title ?? "";
  const cs = 84;
  return (
    <div {...root} className="kc-ig kc-orbit" style={{ position: "relative", width: L.w, height: L.h, margin: "0 auto", ...root.style }}>
      <svg className="kc-orbit__svg" viewBox={`0 0 ${L.w} ${L.h}`} aria-hidden="true">
        {kind === "hub"
          ? L.nodes.map((p, i) => <line key={i} className="kc-orbit__spoke" x1={L.cx} y1={L.cy} x2={p.x} y2={p.y}></line>)
          : null}
        {kind !== "hub" ? <circle className={cx("kc-orbit__track", kind === "network" && "kc-orbit__track--dash")} cx={L.cx} cy={L.cy} r={L.r}></circle> : null}
      </svg>
      {centerLabel ? (
        <div
          className={cx("kc-orbit__center", kind === "cycle" && "kc-orbit__center--soft")}
          style={{
            left: L.cx - cs / 2,
            top: L.cy - cs / 2,
            width: cs,
            height: cs,
            fontSize: 10.5,
            lineHeight: "14px",
            padding: 6,
            ...(kind === "hub" ? { background: "var(--field)", color: "var(--on-field)" } : null),
          }}
        >
          <span>
            {centerLabel}
            {spec.content.center?.desc ? (
              <>
                <br />
                <span style={{ fontSize: 9 }}>{spec.content.center.desc}</span>
              </>
            ) : null}
          </span>
        </div>
      ) : null}
      {items.map((it, i) => (
        <div key={it.id} className="kc-orbit__node" style={{ left: L.nodes[i].x, top: L.nodes[i].y, maxWidth: 110 }}>
          <span className="kc-orbit__dot">{kind === "hub" ? "" : kind === "network" && it.value != null ? fmt(it.value) : i + 1}</span>
          <span className={kind === "network" ? "kc-ig__desc" : "kc-ig__label"} style={kind === "network" ? { color: "var(--ink)" } : undefined}>
            {it.label}
          </span>
          {kind === "hub" && it.value != null ? (
            <span className="kc-ig__fig" style={{ fontSize: 10 }}>
              {valueText(it, spec.content.unit)}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** 유형별 그리기. root = 바깥 요소 속성(자리 표식·색 모드). */
export function renderInfographic(spec: InfoSpec, box: InfoBox, rootIn: RootAttrs = {}, area = 1): ReactNode {
  const variant = spec.variant ?? defaultVariant(spec.type);
  const vars = colorModeVars(spec.colorMode);
  const root: RootAttrs = vars ? { ...rootIn, style: { ...rootIn.style, ...vars } } : rootIn;
  const items = spec.content.items;
  const unit = spec.content.unit;
  switch (spec.type) {
    case "process":
      return <Process root={root} vertical={variant === "v"} steps={items.map((it) => ({ label: it.label, desc: it.desc }))} />;
    case "cycle":
    case "hub":
    case "network":
      return <Orbit spec={spec} box={box} root={root} kind={spec.type} />;
    case "pillars":
      return (
        <div {...root} className="kc-pillars kc-ig" style={root.style}>
          {items.map((it) => (
            <div key={it.id} className="kc-pillar">
              {it.sub ? <span className="kc-pillar__sub">{it.sub}</span> : null}
              <span className="kc-pillar__head">
                {it.icon ? <Icon name={it.icon} cls="kc-icon kc-icon--sm" /> : null}
                {it.label}
              </span>
              {it.desc ? <span className="kc-ig__desc">{it.desc}</span> : null}
            </div>
          ))}
        </div>
      );
    case "cards": {
      const cols = Number(variant) || 2;
      return (
        <div {...root} style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 10, ...root.style }}>
          {items.map((it) => (
            <div className="kc-card" key={it.id}>
              <span className="kc-card__title">
                {it.label}
                {it.sub ? (
                  <>
                    {" "}
                    <span className="kc-muted" style={{ fontSize: 9, fontWeight: 600 }}>
                      {it.sub}
                    </span>
                  </>
                ) : null}
              </span>
              {it.desc ? <p className="kc-card__desc">{it.desc}</p> : null}
            </div>
          ))}
        </div>
      );
    }
    case "iconGrid": {
      const cols = Number(variant) || 4;
      return (
        <ul {...root} className="kc-icongrid kc-ig" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, ...root.style }}>
          {items.map((it, i) => (
            <li key={it.id}>
              <span className="kc-iconbox" style={{ width: 30, height: 30 }}>
                <Icon name={it.icon ?? DEFAULT_ICONS[i % DEFAULT_ICONS.length]} cls="kc-icon kc-icon--sm" />
              </span>
              <span className="kc-ig__label">{it.label}</span>
              {it.desc ? <span className="kc-ig__desc">{it.desc}</span> : null}
            </li>
          ))}
        </ul>
      );
    }
    case "layers": {
      const nest = (i: number): ReactNode =>
        i >= items.length ? null : (
          <div className="kc-layer" key={items[i].id}>
            <span className="kc-ig__label">{items[i].label}</span>
            {items[i].desc ? <span className="kc-ig__desc">{items[i].desc}</span> : null}
            {nest(i + 1)}
          </div>
        );
      return (
        <div {...root} className="kc-layers kc-ig" style={root.style}>
          {nest(0)}
        </div>
      );
    }
    case "matrix": {
      const [a, b, c, d] = items;
      const ax = spec.content.axes ?? ["", "", "", ""];
      const cell = (it: InfoItem | undefined, hi?: boolean) =>
        it ? (
          <div className={cx("kc-matrix__cell", hi && "kc-matrix__cell--hi")} key={it.id}>
            <span className="kc-ig__label">{it.label}</span>
            {it.desc ? <span className="kc-ig__desc">{it.desc}</span> : null}
          </div>
        ) : (
          <span></span>
        );
      return (
        <div {...root} className="kc-matrix kc-ig" style={{ minHeight: clamp(box.h, 120, 200), ...root.style }}>
          <span className="kc-matrix__axis kc-matrix__axis--y">{ax[0]}</span>
          {cell(a, true)}
          {cell(b)}
          <span className="kc-matrix__axis kc-matrix__axis--y">{ax[1]}</span>
          {cell(c)}
          {cell(d)}
          <span></span>
          <span className="kc-matrix__axis">{ax[2]}</span>
          <span className="kc-matrix__axis">{ax[3]}</span>
        </div>
      );
    }
    case "timeline":
      return (
        <ol {...root} className="kc-timeline kc-ig" style={root.style}>
          {items.map((it) => (
            <li key={it.id} className={it.key ? "is-highlight" : undefined}>
              <span className="kc-timeline__year">{it.when ?? ""}</span>
              <span className="kc-timeline__tick"></span>
              <ul className="kc-timeline__items">
                <li className={it.key ? "is-key" : undefined}>{it.label}</li>
              </ul>
            </li>
          ))}
        </ol>
      );
    case "roadmap": {
      const n = items.length;
      return (
        <div {...root} className="kc-roadmap kc-ig" style={{ height: clamp(box.h, 110, 170), ...root.style }}>
          {items.map((it, i) => (
            <div key={it.id} className="kc-roadmap__step" style={{ height: `${Math.round(40 + (56 * (i + 1)) / n)}%` }}>
              <span className="kc-roadmap__when">{it.when ?? ""}</span>
              <span className="kc-ig__label" style={i === n - 1 ? { color: "var(--on-area)" } : undefined}>
                {it.label}
              </span>
              {it.desc ? <span className="kc-ig__desc">{it.desc}</span> : null}
            </div>
          ))}
        </div>
      );
    }
    case "bar": {
      if (variant === "v") {
        const keyIndex = Math.max(0, items.findIndex((it) => it.key));
        return <Bars root={root} height={clamp(box.h, 110, 205)} keyIndex={keyIndex} cols={items.map((it) => ({ label: it.label, value: it.value ?? 0 }))} />;
      }
      return <HBars root={root} gap={box.h < 140 ? 6 : 11} rows={items.map((it) => ({ name: it.label, count: it.value ?? 0 }))} />;
    }
    case "share": {
      const total = items.reduce((a, it) => a + (it.value ?? 0), 0);
      if (variant === "stack") {
        return (
          <div {...root} className="kc-ig" style={{ display: "flex", flexDirection: "column", gap: 10, ...root.style }}>
            <div className="kc-stack100">
              {items.map((it, i) => (
                <span key={it.id} className={toneCls(it, i)} style={{ width: `${total ? Math.round(((it.value ?? 0) / total) * 1000) / 10 : 0}%` }}></span>
              ))}
            </div>
            <ul className="kc-legend">
              {items.map((it, i) => (
                <li key={it.id}>
                  <i className={toneCls(it, i)}></i>
                  <span>{it.label}</span>
                  <b>{fmt(it.value ?? 0)}</b>
                </li>
              ))}
            </ul>
          </div>
        );
      }
      return (
        <Donut
          root={root}
          marginTop={box.h > 150 ? 30 : 0}
          parts={items.map((it, i) => ({ label: it.label, value: it.value ?? 0, cls: toneCls(it, i) }))}
          centerValue={spec.content.center?.label ?? fmt(total)}
          centerUnit={spec.content.center?.desc ?? unit ?? ""}
        />
      );
    }
    case "stats":
      return (
        <div {...root} className="kc-stats kc-ig" style={{ gap: 16, ...root.style }}>
          {items.map((it) => (
            <div className="kc-stat" key={it.id}>
              <span className="kc-stat__fig" style={items.length > 3 ? { fontSize: 24, lineHeight: "28px" } : undefined}>
                {it.metric && !it.valueText ? <span data-metric={it.metric}>{fmt(it.value ?? null)}</span> : (it.valueText ?? fmt(it.value ?? null))}
                {it.valueText ? null : <small>{it.unit ?? unit ?? ""}</small>}
              </span>
              <span className="kc-ig__desc">{it.label}</span>
            </div>
          ))}
        </div>
      );
    case "compare":
      return (
        <Compare
          root={root}
          rows={items.map((it) => {
            const prev = it.prev ?? 0;
            const cur = it.value ?? 0;
            const max = Math.max(prev, cur, 1e-9);
            // 막대 안 숫자가 들어가도록 최소 폭 30%
            const pct = (v: number) => Math.max(30, Math.round((v / max) * 100));
            return {
              label: it.label,
              before: it.prevText ?? fmt(prev),
              after: it.valueText ?? `${fmt(cur)}${it.unit ?? unit ?? ""}`,
              beforePct: pct(prev),
              afterPct: pct(cur),
            };
          })}
        />
      );
    case "map": {
      const values: Record<string, number> = {};
      for (const it of items) if (it.region) values[it.region] = (values[it.region] ?? 0) + (it.value ?? 0);
      const zoom = Math.round(clamp(box.h / MAP_H, 0.45, 1) * 100) / 100;
      return <KoreaMap root={root} mode="regions" area={area} values={values} zoom={zoom} frame={{ width: Math.round(MAP_W * zoom), height: Math.round(MAP_H * zoom) }} />;
    }
    default:
      return null;
  }
}

/** 권역 id → 표기(지도 ↔ 막대 전환 때 라벨) */
export function regionLabel(id: string): string {
  return REGION_GROUPS.find((g) => g.id === id)?.label.replace(/^영남권\((.*)\)$/, "$1") ?? id;
}
