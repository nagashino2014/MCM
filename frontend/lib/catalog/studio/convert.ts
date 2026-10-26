/*
 * 쪽 React 요소 → 노드 트리(기본 트리). 쪽 컴포넌트는 훅·컨텍스트 없는 순수 함수라 직접 불러 펼친다.
 * 노드 id 는 React 의 재조정 규칙과 같은 '자리'(부모 경로 + key 또는 순번 + 태그)에서 해시로 만든다 → 같은 데이터 모양이면 같은 id,
 * 목록 항목이 늘어도 그 뒤 형제의 id 는 그대로다(map 결과 배열이 한 자리를 차지).
 * 특별히 다루는 것: Icon → x-icon 노드, InfoSlot → 인포그래픽 위젯(spec 을 props 로), data-metric/data-bind → bind, data-widget → widget.
 */
import { Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { Icon } from "@/lib/catalog/render/components/parts";
import { InfoSlot, InfoSource, type InfoSlotProps } from "@/lib/catalog/render/infographic/slot";
import { hashId, type CNode } from "./nodes";

const FORWARD_REF = Symbol.for("react.forward_ref");
const MEMO = Symbol.for("react.memo");
const SKIP_PROPS = new Set(["children", "className", "style", "key", "ref", "dangerouslySetInnerHTML"]);

type AnyProps = Record<string, unknown> & { children?: ReactNode };

function hostNode(type: string, props: AnyProps, path: string): CNode {
  const node: CNode = { id: hashId(path), tag: type };
  if (typeof props.className === "string") node.className = props.className;
  if (props.style && typeof props.style === "object") node.style = { ...(props.style as Record<string, string | number>) };
  const attrs: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(props)) {
    if (SKIP_PROPS.has(k) || v == null || typeof v === "function" || typeof v === "object") continue;
    attrs[k] = v as string | number | boolean;
  }
  if (Object.keys(attrs).length) node.attrs = attrs;
  const metric = props["data-metric"];
  if (typeof metric === "string" && metric) node.bind = `metric:${metric}`;
  const bind = props["data-bind"];
  if (typeof bind === "string" && bind) node.bind = `data:${bind}`;
  const widget = props["data-widget"];
  if (typeof widget === "string" && widget) node.widget = widget;
  return node;
}

function convertList(children: ReactNode, path: string, out: CNode[]): void {
  if (Array.isArray(children)) children.forEach((c, i) => convertAt(c, `${path}/${segment(c, i)}`, out));
  else convertAt(children, `${path}/0`, out);
}

function segment(c: unknown, i: number): string {
  return isValidElement(c) && c.key != null ? `k${String(c.key)}` : String(i);
}

function convertAt(c: ReactNode, path: string, out: CNode[]): void {
  if (c == null || typeof c === "boolean") return;
  if (typeof c === "string" || typeof c === "number") {
    out.push({ id: hashId(path + "#t"), tag: "#text", text: String(c) });
    return;
  }
  if (Array.isArray(c)) {
    convertList(c, path + "[", out);
    return;
  }
  if (!isValidElement(c)) return;
  const el = c as ReactElement<AnyProps>;
  const props = (el.props ?? {}) as AnyProps;
  const type = el.type as unknown;
  if (typeof type === "string") {
    const here = `${path}:${type}`;
    const node = hostNode(type, props, here);
    const kids: CNode[] = [];
    convertList(props.children, here, kids);
    if (kids.length) node.children = kids;
    out.push(node);
    return;
  }
  if (type === Fragment) {
    convertList(props.children, path + "~f", out);
    return;
  }
  if (type === Icon) {
    const p = props as { name?: string; cls?: string; style?: Record<string, string | number> };
    const node: CNode = { id: hashId(path + ":x-icon"), tag: "x-icon", props: { name: p.name ?? "file-text", cls: p.cls ?? "kc-icon" } };
    if (p.style) node.style = { ...p.style };
    out.push(node);
    return;
  }
  if (type === InfoSource) {
    const sp = props as unknown as InfoSlotProps & { children: ReactElement<Record<string, unknown>> };
    const made: CNode[] = [];
    convertAt(InfoSource(sp), path, made);
    const root = made.find((n) => n.tag !== "#text");
    if (root) {
      root.widget = "infographic";
      root.props = { slot: sp.slot, spec: sp.spec, box: sp.box, ...(sp.area != null ? { area: sp.area } : {}) };
    }
    out.push(...made);
    return;
  }
  if (type === InfoSlot) {
    const sp = props as unknown as InfoSlotProps;
    const made: CNode[] = [];
    convertAt(InfoSlot(sp), path + "~i", made);
    const root = made.find((n) => n.tag !== "#text");
    if (root) {
      root.widget = "infographic";
      root.props = { slot: sp.slot, spec: sp.spec, box: sp.box, ...(sp.area != null ? { area: sp.area } : {}) };
    }
    out.push(...made);
    return;
  }
  if (typeof type === "function") {
    convertAt((type as (p: AnyProps) => ReactNode)(props), path + "~", out);
    return;
  }
  if (type && typeof type === "object") {
    const t = type as { $$typeof?: symbol; render?: (p: AnyProps, ref: null) => ReactNode; type?: unknown };
    if (t.$$typeof === FORWARD_REF && t.render) convertAt(t.render(props, null), path + "~", out);
    else if (t.$$typeof === MEMO && t.type) convertAt({ ...el, type: t.type } as ReactElement, path, out);
  }
}

/** 쪽 요소 → 쪽 루트 노드(첫 호스트 요소). 쪽 키를 경로 첫머리에 넣어 쪽마다 id 가 겹치지 않게 한다. */
export function elementToTree(element: ReactNode, pageKey: string): CNode {
  const out: CNode[] = [];
  convertAt(element, `p:${pageKey}`, out);
  const root = out.find((n) => n.tag !== "#text");
  if (!root) throw new Error(`쪽 '${pageKey}'을 노드로 바꾸지 못했습니다.`);
  return root;
}

/** 인포그래픽 자리를 새 spec 으로 다시 만든다(유형 바꾸기). id 는 원래 자리 id 에서 이어 만든다. */
export function infographicToTree(props: InfoSlotProps, slotNodeId: string): CNode | null {
  const made: CNode[] = [];
  convertAt(InfoSlot(props), `w:${slotNodeId}`, made);
  const root = made.find((n) => n.tag !== "#text");
  if (!root) return null;
  root.id = slotNodeId;
  root.widget = "infographic";
  root.props = { slot: props.slot, spec: props.spec, box: props.box, ...(props.area != null ? { area: props.area } : {}) };
  return root;
}
