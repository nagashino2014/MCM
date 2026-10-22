/*
 * 회사소개서 인포그래픽 — 디자인 시스템 인포그래픽 16종 중 마스터본이 쓰는 것(정적 SVG 도형 + HTML 글자, ApexCharts 미사용).
 * 글자는 SVG <text> 가 아니라 HTML 로 얹어 PDF 에서 검색·복사되게 한다(README §인포그래픽).
 */
import type { CSSProperties, ReactNode } from "react";
import type { OrgChartDoc, OrgNode } from "@/lib/catalog/content-types";
import { MAP_H, MAP_REGION_LABELS, MAP_W, SIDO_PATHS, project } from "../korea-map";
import type { HistoryYear } from "../types";
import { cx, fmt } from "./parts";

// ── Process 단계 흐름 ──
export function Process({ steps, vertical }: { steps: Array<{ label: string; desc: string }>; vertical?: boolean }) {
  return (
    <ol className={cx("kc-process", vertical && "kc-process--v", "kc-ig")}>
      {steps.map((st, i) => (
        <li key={i}>
          <span className="kc-process__num">{i + 1}</span>
          <span className="kc-ig__label">{st.label}</span>
          <span className="kc-ig__desc">{st.desc}</span>
        </li>
      ))}
    </ol>
  );
}

// ── Compare 전후 비교 ──
export function Compare({ rows }: { rows: Array<{ label: string; before: string; after: string; beforePct: number; afterPct: number }> }) {
  return (
    <div className="kc-compare kc-ig">
      {rows.map((r, i) => (
        <div className="kc-compare__row" key={i}>
          <span className="kc-ig__label">{r.label}</span>
          <div className="kc-compare__bars">
            <span className="kc-compare__bar kc-compare__bar--before" style={{ width: `${r.beforePct}%` }}>
              {r.before}
            </span>
            <span className="kc-compare__bar kc-compare__bar--after" style={{ width: `${r.afterPct}%` }}>
              {r.after}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── BarChart 가로 막대(자격 보유) ──
export function HBars({ rows, gap = 11 }: { rows: Array<{ name: string; count: number }>; gap?: number }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="kc-hbars" style={{ gap }}>
      {rows.map((r, i) => (
        <div className="kc-hbars__row" key={i}>
          <span>{r.name}</span>
          <span className="kc-hbars__track">
            <span className="kc-hbars__bar" style={{ display: "block", width: `${Math.max(3, Math.round((r.count / max) * 100))}%` }}></span>
          </span>
          <span className="kc-hbars__val">{fmt(r.count)}</span>
        </div>
      ))}
    </div>
  );
}

// ── BarChart 세로 막대(경력 분포) ──
export function Bars({ cols, height = 205, keyIndex = 0 }: { cols: Array<{ label: string; value: number }>; height?: number; keyIndex?: number }) {
  const max = Math.max(1, ...cols.map((c) => c.value));
  return (
    <div className="kc-bars" style={{ height }}>
      <div className="kc-bars__plot">
        {cols.map((c, i) => (
          <div className={cx("kc-bars__col", i === keyIndex && "is-key")} key={i}>
            <span className="kc-bars__val">{fmt(c.value)}</span>
            <span className="kc-bars__bar" style={{ height: `${Math.round((c.value / max) * 100)}%` }}></span>
          </div>
        ))}
      </div>
      <div className="kc-bars__axis">
        {cols.map((c, i) => (
          <span key={i}>{c.label}</span>
        ))}
      </div>
    </div>
  );
}

// ── Share 구성비(도넛) ──
export function Donut({ parts, centerValue, centerUnit }: { parts: Array<{ label: string; value: number; cls: string }>; centerValue: string; centerUnit: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  let acc = 0;
  const segs = parts.map((p) => {
    const len = Math.round((p.value / total) * 10000) / 100;
    const seg = { ...p, len, offset: -acc };
    acc += len;
    return seg;
  });
  return (
    <div className="kc-share" style={{ gridTemplateColumns: "120px minmax(0, 1fr)", marginTop: 30 }}>
      <div className="kc-donut__wrap">
        <svg className="kc-donut" viewBox="0 0 42 42" aria-hidden="true">
          {[...segs].reverse().map((sg, i) =>
            sg.len > 0 ? (
              <circle key={i} cx="21" cy="21" r="15.9155" className={sg.cls} strokeDasharray={`${sg.len} ${Math.round((100 - sg.len) * 100) / 100}`} strokeDashoffset={sg.offset}></circle>
            ) : null
          )}
        </svg>
        <div className="kc-donut__center">
          <b>{centerValue}</b>
          <span className="kc-ig__desc">{centerUnit}</span>
        </div>
      </div>
      <ul className="kc-legend">
        {parts.map((p, i) => (
          <li key={i}>
            <i className={p.cls}></i>
            <span>{p.label}</span>
            <b>{fmt(p.value)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── RegionMap 지도(권역 단계 구분 / 위치 핀) ──
export interface MapPin {
  lon: number;
  lat: number;
  num?: string;
  label?: string;
  left?: boolean;
}

export function KoreaMap({
  mode,
  area = 1,
  values,
  pins = [],
  zoom = 1,
  frame,
}: {
  mode: "regions" | "pins";
  area?: number;
  values?: Record<string, number>;
  pins?: MapPin[];
  zoom?: number;
  /** 바깥 자리 크기(목업의 hint-size 래퍼) */
  frame?: { width: number; height: number };
}) {
  const vals = values ?? {};
  const max = Math.max(1, ...Object.values(vals));
  const op = (r: string) => (mode === "regions" ? (0.16 + (0.84 * (vals[r] || 0)) / max).toFixed(2) : "1");
  const map = (
    <div
      className={cx("kc-map", `kc-area-${area}`, "kc-motif--drop")}
      style={{ position: "relative", width: MAP_W, height: MAP_H, fontFamily: "var(--kc-font-body)", color: "var(--ink)" }}
    >
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} role="img" aria-label={mode === "regions" ? "권역별 수행 실적 지도" : "사업장 위치 지도"}>
        {SIDO_PATHS.map((p) => (
          <path key={p.c} d={p.d} className={mode === "regions" ? "kc-map__region" : "kc-map__base"} style={{ fillOpacity: op(p.r) as unknown as number }}></path>
        ))}
      </svg>
      {mode === "regions"
        ? MAP_REGION_LABELS.map((r) => (
            <span key={r.id} className="kc-map__label" style={{ left: r.x, top: r.y }}>
              {r.name}
              <b>{fmt(vals[r.id] ?? 0)}</b>
            </span>
          ))
        : null}
      {pins.map((p, i) => {
        const { x, y } = project(p.lon, p.lat);
        const pos = { left: Number(x.toFixed(1)), top: Number(y.toFixed(1)) };
        return (
          <span key={i}>
            <span className={p.num ? "kc-map__dot kc-map__dot--num" : "kc-map__dot"} style={pos}>
              {p.num ?? ""}
            </span>
            {p.label ? (
              <span className={p.left ? "kc-map__pinlabel kc-map__pinlabel--left" : "kc-map__pinlabel"} style={pos}>
                {p.label}
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
  const inner = zoom === 1 ? map : <div style={{ zoom }}>{map}</div>;
  return frame ? <div style={{ width: frame.width, height: frame.height, flex: "none" }}>{inner}</div> : inner;
}

// ── HistoryTimeline 연혁 ──
export function Timeline({ years, style }: { years: HistoryYear[]; style?: CSSProperties }) {
  return (
    <ol className="kc-timeline" style={style}>
      {years.map((y) => (
        <li key={y.year} className={y.highlight ? "is-highlight" : undefined}>
          <span className="kc-timeline__year">{y.year}</span>
          <span className="kc-timeline__tick"></span>
          <ul className="kc-timeline__items">
            {y.items.map((it, i) => (
              <li key={i} className={it.highlight ? "is-key" : undefined}>
                <b>{it.month}</b>
                {it.content}
                {it.category ? <span className="kc-timeline__cat">{it.category}</span> : null}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

// ── OrgChart 조직도(편집본 → 디자인 시스템 조직도 틀) ──
const SIDE_RE = /(연구소|지사|센터)/;

function areaOfLabel(label: string): number | null {
  if (/HAPs|비산/i.test(label)) return 3;
  if (/통합/.test(label)) return 1;
  if (/화학|화관|안전/.test(label)) return 2;
  if (/기후|탄소|ESG|온실|대기총량/.test(label)) return 4;
  if (/지사/.test(label)) return 1;
  return null;
}

function OrgBox({ node, cls, style, align }: { node: OrgNode; cls?: string; style?: CSSProperties; align?: "left" }) {
  const area = areaOfLabel(node.label);
  return (
    <div
      className={cx("kc-org__box", cls, area ? `kc-area-${area}` : null)}
      style={{ ...(align === "left" ? { alignItems: "flex-start", textAlign: "left" } : null), ...(cls?.includes("--soft") && area ? { borderTop: "3px solid var(--area)" } : null), ...style }}
    >
      {node.label}
      {node.badge || node.sub ? <small>{[node.badge, node.sub].filter(Boolean).join(" · ")}</small> : null}
    </div>
  );
}

export function OrgChart({ doc, advisorsLabel }: { doc: OrgChartDoc; advisorsLabel?: string }) {
  const root: OrgNode = doc.nodes.length === 1 ? doc.nodes[0] : { id: "root", label: "대표이사", sub: "", badge: "", children: doc.nodes };
  const asides0 = root.children.filter((c) => c.badge);
  const rest = root.children.filter((c) => !c.badge);
  const hub = rest.length === 1 && rest[0].children.length > 0 ? rest[0] : null;
  const kids = hub ? hub.children : rest;
  const sides = kids.filter((k) => k.children.length === 0 && SIDE_RE.test(k.label));
  const units = kids.filter((k) => !sides.includes(k));
  const left = sides.filter((_, i) => i % 2 === 0);
  const right = sides.filter((_, i) => i % 2 === 1);
  const showAdvisors = advisorsLabel && !root.children.some((c) => /자문/.test(c.label));
  const large = units.length <= 6;
  const aside = (nodes: ReactNode[], side: "left" | "right") =>
    nodes.length ? (
      <div className={cx("kc-org__aside", side === "left" && "kc-org__aside--left")}>
        {side === "right" ? <span className="kc-org__hline"></span> : null}
        {nodes}
        {side === "left" ? <span className="kc-org__hline"></span> : null}
      </div>
    ) : (
      <span></span>
    );
  const topAsides: ReactNode[] = [];
  asides0.forEach((n, i) => {
    if (i > 0) topAsides.push(<span key={`h${i}`} className="kc-org__hline kc-org__hline--s"></span>);
    topAsides.push(<OrgBox key={n.id} node={n} cls="kc-org__box--soft" />);
  });
  if (showAdvisors) {
    if (topAsides.length) topAsides.push(<span key="hadv" className="kc-org__hline kc-org__hline--s"></span>);
    topAsides.push(
      <span key="adv" className="kc-org__box kc-org__box--soft">
        자문위원<small>{advisorsLabel}</small>
      </span>
    );
  }
  return (
    <div className={cx("kc-org", large && "kc-org--lg", "kc-ig")} style={{ flex: 1, minHeight: 0, justifyContent: "center" }}>
      <div className="kc-org__tier">
        <span></span>
        <div className="kc-org__stem kc-org__stem--top">
          <span className="kc-org__box kc-org__box--top" style={{ fontSize: 12, padding: "9px 26px" }}>
            {root.label}
          </span>
        </div>
        {aside(topAsides, "right")}
      </div>
      <span className="kc-org__vline"></span>
      {hub || sides.length ? (
        <>
          <div className="kc-org__tier">
            {aside(left.map((n) => <OrgBox key={n.id} node={n} cls="kc-org__box--soft" align="left" />), "left")}
            <div className="kc-org__stem">
              {hub ? (
                <span className="kc-org__box" style={{ fontSize: 11.5, padding: "8px 20px" }}>
                  {hub.label}
                </span>
              ) : null}
            </div>
            {aside(right.map((n) => <OrgBox key={n.id} node={n} cls="kc-org__box--soft" align="left" />), "right")}
          </div>
          <span className="kc-org__vline"></span>
        </>
      ) : null}
      <div className="kc-org__row">
        {units.map((u) => {
          const area = areaOfLabel(u.label);
          return (
            <div className={cx("kc-org__unit", area ? `kc-area-${area}` : null)} key={u.id}>
              <span className="kc-org__box">
                {u.label}
                {u.sub ? <small>{u.sub}</small> : null}
              </span>
              {u.children.length ? (
                <ul className="kc-org__teams">
                  {u.children.map((t) => {
                    const ta = areaOfLabel(t.label);
                    return (
                      <li key={t.id} className={ta && ta !== area ? `kc-area-${ta}` : undefined}>
                        {t.label}
                        {t.sub ? <small>{t.sub}</small> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
