/*
 * 지표 넣기 — 글 속 칩(bind 노드)으로 넣을 수 있는 지표·데이터 항목과 칩 만들기·값 풀기. 클라이언트 안전.
 * 숫자는 지표 사전(metric:)으로만 넣는다(블루프린트 §6-5). data: 는 회사 정보·기준월 같은 글 항목만 — 지원 목록은 DATA_BINDS 한 곳에서 관리한다.
 * 칩 모양은 쪽 컴포넌트의 <M>(data-metric)과 같다: 값 글자 + (단위) — 그릴 때 첫 숫자 글자를 최신 값으로 바꾼다(render-tree boundChildren).
 */
import { fmt } from "@/lib/catalog/render/components/parts";
import type { CatalogRenderData } from "@/lib/catalog/render/types";
import type { MetricId } from "@/lib/catalog/metrics";
import { newUserId, type CNode } from "./nodes";

export interface DataBindDef {
  key: string;
  label: string;
  group: string;
  get: (d: CatalogRenderData) => string | null | undefined;
}

const hq = (d: CatalogRenderData) => d.offices.find((o) => o.key === "hq") ?? d.offices[0];

/** data: 칩으로 넣을 수 있는 항목(이 목록에 없는 경로는 그리지도 저장하지도 않는다) */
export const DATA_BINDS: DataBindDef[] = [
  { key: "company.name", label: "회사명", group: "회사 정보", get: (d) => d.company.name },
  { key: "company.nameShort", label: "회사 약칭", group: "회사 정보", get: (d) => d.company.nameShort },
  { key: "company.nameEn", label: "영문 회사명", group: "회사 정보", get: (d) => d.company.nameEn },
  { key: "company.ceoName", label: "대표자", group: "회사 정보", get: (d) => d.company.ceoName },
  { key: "company.ceoTitle", label: "대표 직함", group: "회사 정보", get: (d) => d.company.ceoTitle },
  {
    key: "company.founded",
    label: "설립 연월",
    group: "회사 정보",
    get: (d) => (d.company.foundedYear ? `${d.company.foundedYear}년${d.company.foundedMonth ? ` ${d.company.foundedMonth}월` : ""}` : null),
  },
  { key: "company.foundedYear", label: "설립 연도", group: "회사 정보", get: (d) => d.company.foundedYear },
  { key: "office.address", label: "본사 주소", group: "회사 정보", get: (d) => hq(d)?.address },
  { key: "company.website", label: "홈페이지", group: "회사 정보", get: (d) => d.company.website },
  { key: "company.email", label: "대표 이메일", group: "회사 정보", get: (d) => d.company.email },
  { key: "company.phone", label: "대표 전화", group: "회사 정보", get: (d) => d.company.phone },
  { key: "asOfLabel", label: "기준월", group: "문서", get: (d) => d.asOfLabel },
  { key: "docLabel", label: "문서 이름", group: "문서", get: (d) => d.docLabel },
  ...[0, 1, 2, 3, 4, 5].map((i) => ({ key: `areas.${i}.name`, label: `사업 분야 ${i + 1} 이름`, group: "분야 이름", get: (d: CatalogRenderData) => d.areas[i]?.name })),
];

const DATA_BIND_MAP = new Map(DATA_BINDS.map((b) => [b.key, b]));

export function isDataBindKey(key: string): boolean {
  return DATA_BIND_MAP.has(key);
}

/** 바인딩 값 — 지표는 지표 사전 값, 데이터 항목은 DATA_BINDS 에 있는 것만 */
export function resolveBind(bind: string, data: CatalogRenderData, digits?: number): string | null {
  if (bind.startsWith("metric:")) {
    const m = data.metrics[bind.slice(7) as MetricId];
    return m ? fmt(m.value ?? null, digits ?? 1) : null;
  }
  if (bind.startsWith("data:")) {
    const def = DATA_BIND_MAP.get(bind.slice(5));
    if (!def) return null;
    const v = def.get(data);
    return v == null ? null : String(v);
  }
  return null;
}

/** 칩 이름(데이터 탭 목록) — 지표 이름 또는 데이터 항목 이름 */
export function bindLabel(bind: string, data: CatalogRenderData): string {
  if (bind.startsWith("metric:")) return data.metrics[bind.slice(7) as MetricId]?.label ?? bind.slice(7);
  return DATA_BIND_MAP.get(bind.slice(5))?.label ?? bind.replace(/^data:/, "데이터 · ");
}

/** 지표 묶음(지표 넣기 목록의 분야) */
export function metricGroup(id: string): string {
  if (id.startsWith("permit.") || id === "market.permit.share") return "통합환경허가";
  if (id.startsWith("projects.") || id === "software.products") return "사업 분야·실적";
  if (id.startsWith("staff.") || id === "advisors.total") return "인원";
  return "회사·고객";
}

export const BIND_GROUP_ORDER = ["통합환경허가", "사업 분야·실적", "회사·고객", "인원", "회사 정보", "문서", "분야 이름"];

export interface BindOption {
  bind: string;
  kind: "metric" | "data";
  group: string;
  label: string;
  unit: string;
  /** 지금 값(소수 1자리 기준) — 없으면 null */
  value: string | null;
  footnote: string;
  missing?: string;
}

/** 지표 넣기 목록 — 지표 사전 순서 + 데이터 항목, 묶음 순서대로 */
export function bindOptions(data: CatalogRenderData): BindOption[] {
  const out: BindOption[] = [];
  for (const m of Object.values(data.metrics)) {
    out.push({
      bind: `metric:${m.id}`,
      kind: "metric",
      group: metricGroup(m.id),
      label: m.label,
      unit: m.unit,
      value: m.value == null ? null : fmt(m.value, 1),
      footnote: m.footnote,
      ...(m.missing ? { missing: m.missing } : {}),
    });
  }
  for (const b of DATA_BINDS) {
    const v = b.get(data);
    out.push({ bind: `data:${b.key}`, kind: "data", group: b.group, label: b.label, unit: "", value: v ? String(v) : null, footnote: "" });
  }
  const rank = (g: string) => (BIND_GROUP_ORDER.indexOf(g) + 1 || 99);
  return out.map((o, i) => ({ o, i })).sort((a, b) => rank(a.o.group) - rank(b.o.group) || a.i - b.i).map((x) => x.o);
}

export interface ChipOptions {
  /** 지표 값 소수 자리(0~2, 기본 1) */
  digits?: number;
  /** 단위를 칩 안에 붙인다(지표만, 기본 붙임) */
  unit?: boolean;
}

/** 글 속에 넣을 칩 노드 — 지금 값을 글자로 담는다(그릴 때마다 최신 값으로 바뀜) */
export function makeBindChip(bind: string, data: CatalogRenderData, opts: ChipOptions = {}): CNode | null {
  const isMetric = bind.startsWith("metric:");
  const key = bind.slice(isMetric ? 7 : 5);
  if (isMetric ? !data.metrics[key as MetricId] : !isDataBindKey(key)) return null;
  const digits = isMetric && opts.digits != null ? Math.max(0, Math.min(2, Math.round(opts.digits))) : undefined;
  const value = resolveBind(bind, data, digits) ?? "-";
  const children: CNode[] = [{ id: newUserId(), tag: "#text", text: value || "-" }];
  const unit = isMetric ? data.metrics[key as MetricId].unit : "";
  if (unit && opts.unit !== false) children.push({ id: newUserId(), tag: "#text", text: unit });
  return {
    id: newUserId(),
    tag: "span",
    attrs: { [isMetric ? "data-metric" : "data-bind"]: key },
    bind,
    ...(digits != null ? { bindDigits: digits } : {}),
    children,
  };
}
