/*
 * 회사소개서 쪽 공용 요소 — 디자인 시스템(P1) 요소 컴포넌트의 마크업 그대로(kc-*).
 * 훅·컨텍스트를 쓰지 않는다(서버 renderToStaticMarkup·스튜디오 미리보기 공용). 아이콘은 lucide 단색 선(README §아이콘).
 */
import type { CSSProperties, ReactNode } from "react";
import {
  Award,
  Calculator,
  Check,
  CloudDownload,
  Database,
  Factory,
  FileCheck,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  GraduationCap,
  LayoutGrid,
  Leaf,
  ListChecks,
  MapPin,
  Network,
  RefreshCw,
  Scale,
  ScanLine,
  SearchCheck,
  ShieldCheck,
  Users,
  Wind,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { MetricId } from "@/lib/catalog/metrics";
import type { CatalogRenderData, RenderCtx } from "../types";

const ICONS: Record<string, LucideIcon> = {
  factory: Factory,
  "flask-conical": FlaskConical,
  wind: Wind,
  leaf: Leaf,
  "graduation-cap": GraduationCap,
  users: Users,
  award: Award,
  "map-pin": MapPin,
  "file-check": FileCheck,
  "file-text": FileText,
  "file-spreadsheet": FileSpreadsheet,
  "shield-check": ShieldCheck,
  "refresh-cw": RefreshCw,
  scale: Scale,
  network: Network,
  check: Check,
  "layout-grid": LayoutGrid,
  "scan-line": ScanLine,
  database: Database,
  calculator: Calculator,
  "cloud-download": CloudDownload,
  workflow: Workflow,
  "list-checks": ListChecks,
  "search-check": SearchCheck,
};

/** 쓸 수 있는 아이콘 이름(LLM 편집이 고를 수 있는 목록) */
export const ICON_NAMES = Object.keys(ICONS);

/** 분야 번호 → 아이콘 */
export const AREA_ICON = ["", "factory", "flask-conical", "wind", "leaf", "graduation-cap", "layout-grid"];

export function Icon({ name, cls = "kc-icon", style }: { name: string; cls?: string; style?: CSSProperties }) {
  const C = ICONS[name] ?? FileText;
  return <C className={cls} aria-hidden="true" style={style} />;
}

export const fmt = (v: number | null | undefined, digits = 1): string =>
  v == null || !Number.isFinite(v) ? "-" : v.toLocaleString("ko-KR", { maximumFractionDigits: digits });

/** 지표 값 — data-metric 표식(작업본 점선 밑줄)과 함께 */
export function M({ data, id, digits }: { data: CatalogRenderData; id: MetricId; digits?: number }) {
  return <span data-metric={id}>{fmt(data.metrics[id]?.value ?? null, digits)}</span>;
}

export const mval = (data: CatalogRenderData, id: MetricId): number | null => data.metrics[id]?.value ?? null;

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

export interface SheetProps {
  ctx: RenderCtx;
  cls?: string;
  area?: number;
  /** 쪽 지도·목차 링크용 앵커 */
  anchors?: string[];
  /** 흐름 쪽(paginate 가 .pk-col 을 채우고 넘치면 쪽을 늘린다) */
  flow?: boolean;
  /** 섹션 첫 쪽 — PDF 1단 북마크(숨은 h1) */
  section?: string;
  /** 쪽 이름 — PDF 2단 북마크(숨은 h2). 보이는 제목은 문장이 길어 북마크로 쓰지 않는다 */
  outline?: string;
  style?: CSSProperties;
  children: ReactNode;
}

export function Sheet({ ctx, cls, area, anchors, flow, section, outline, style, children }: SheetProps) {
  return (
    <section
      className={cx(
        "kc-page",
        "pk-sheet",
        flow && "pk-sheet--flow",
        `kc-edition--${ctx.opts.edition}`,
        `kc-tpl--${ctx.template ?? "standard"}`,
        `kc-concept--${ctx.concept ?? "navy"}`,
        `kc-fontset--${ctx.fontSet}`,
        `kc-motif--${ctx.motif ?? "drop"}`,
        area ? `kc-area-${area}` : null,
        cls
      )}
      data-anchors={anchors?.length ? anchors.join(" ") : undefined}
      style={style}
    >
      {section ? <h1 className="pk-outline">{section}</h1> : null}
      {outline ? <h2 className="pk-outline">{outline}</h2> : null}
      {children}
    </section>
  );
}

/** 쪽 머리(SectionHeader) — 쪽 번호는 paginate 가 채운다 */
export function Head({ ctx, num, name, sub }: { ctx: RenderCtx; num?: string; name: string; sub?: string }) {
  return (
    <header className="kc-head">
      <div className="kc-head__section">
        <span className="kc-head__mark"></span>
        {num ? <span className="kc-head__num">{num}</span> : null}
        <span className="kc-head__name">{name}</span>
        {sub ? <span className="kc-head__sub">{sub}</span> : null}
      </div>
      <div className="kc-head__end">
        <span className="kc-head__doc">{ctx.docLabel}</span>
        <span className="kc-head__folio" data-folio="">
          00
        </span>
      </div>
    </header>
  );
}

/** 쪽 제목(+ 눈썹 글) — 이어지는 쪽에서는 paginate 가 흐린 글자(is-continued)로 바꾼다. 북마크는 Sheet outline 이 맡는다 */
export function TitleBlock({ eyebrow, title, style, titleStyle, lead }: { eyebrow?: string; title: ReactNode; style?: CSSProperties; titleStyle?: CSSProperties; lead?: string }) {
  return (
    <div className="kc-titleblock" style={style}>
      {eyebrow ? <p className="kc-eyebrow">{eyebrow}</p> : null}
      <p className="kc-page-title" data-continued-title="" style={titleStyle}>
        {title}
      </p>
      {lead ? <p className="kc-lead">{lead}</p> : null}
    </div>
  );
}

/** 독자용 각주(기준월·지표 정의) — 인쇄·배포본에도 남는다. */
export function Foot({ items }: { items: string[] }) {
  const list = items.filter(Boolean);
  if (!list.length) return null;
  return (
    <ol className="kc-footnote">
      {list.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ol>
  );
}

/** 검토용 안내문 — 작업본에서만 보인다(kc-edition--print 가 숨김). */
export function Notes({ items }: { items: string[] }) {
  const list = items.filter(Boolean);
  if (!list.length) return null;
  return (
    <ol className="kc-notes">
      {list.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ol>
  );
}

export function Drop({ mods = "", style }: { mods?: string; style?: CSSProperties }) {
  return <span className={cx("kc-drop", mods)} style={style} aria-hidden="true"></span>;
}

export function AreaTag({ name, style }: { name: string; style?: CSSProperties }) {
  return (
    <span className="kc-areatag" style={style}>
      {name}
    </span>
  );
}

export function Kpi({
  label,
  value,
  unit,
  note,
  size = "m",
  area,
  icon,
  metric,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  note?: ReactNode;
  size?: "xl" | "m" | "";
  area?: number;
  icon?: string;
  metric?: MetricId;
}) {
  return (
    <div className={cx("kc-kpi", size && `kc-kpi--${size}`, area ? `kc-area-${area}` : null)}>
      <span className="kc-kpi__label">
        {icon ? <Icon name={icon} /> : null}
        {label}
      </span>
      <span className="kc-kpi__value">
        <span className="kc-kpi__figure" data-metric={metric}>
          {value}
        </span>
        {unit ? <span className="kc-kpi__unit">{unit}</span> : null}
      </span>
      {note ? <span className="kc-kpi__note">{note}</span> : null}
    </div>
  );
}

/** 기준월 각주 머리 */
export const asOfNote = (data: CatalogRenderData) => `${data.asOf.slice(0, 4)}년 ${Number(data.asOf.slice(5, 7))}월 기준`;
