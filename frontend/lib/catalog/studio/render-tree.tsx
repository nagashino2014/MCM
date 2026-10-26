/*
 * 노드 트리 → React 요소(정적). 서버 PDF·미리보기와 스튜디오 썸네일이 같이 쓴다(훅·컨텍스트 없음).
 * 편집 표식이 필요한 스튜디오 캔버스는 hooks.decorate 로 속성을 덧붙이고, 문단 블록을 편집 요소로 바꿔 그린다.
 */
import { createElement, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { Icon, fmt } from "@/lib/catalog/render/components/parts";
import type { CatalogRenderData, ImageKey } from "@/lib/catalog/render/types";
import type { MetricId } from "@/lib/catalog/metrics";
import { illustrationRender } from "@/lib/catalog/render/infographic/illustration";
import type { CNode } from "./nodes";

export interface TreeEnv {
  url: (key: ImageKey) => string;
  data: CatalogRenderData;
}

export interface TreeHooks {
  /** 요소 속성 덧붙이기(스튜디오: data-cn, 선택 표식 등) */
  decorate?: (n: CNode, props: Record<string, unknown>) => Record<string, unknown>;
  /** 노드를 다르게 그리기(스튜디오: 문단 블록 → 편집 요소). undefined = 기본 */
  override?: (n: CNode, render: (child: CNode) => ReactNode) => ReactNode | undefined;
}

/** 바인딩 값 — 지표는 지표 사전 값, 데이터 경로는 허용한 경로만 */
export function resolveBind(bind: string, data: CatalogRenderData, digits?: number): string | null {
  if (bind.startsWith("metric:")) {
    const m = data.metrics[bind.slice(7) as MetricId];
    return m ? fmt(m.value ?? null, digits ?? 1) : null;
  }
  if (bind.startsWith("data:")) {
    const path = bind.slice(5);
    if (!DATA_BIND_PATHS.test(path)) return null;
    let cur: unknown = data;
    for (const k of path.split(".")) cur = cur != null && typeof cur === "object" ? (cur as Record<string, unknown>)[k] : undefined;
    return cur == null ? null : String(cur);
  }
  return null;
}

/** data: 바인딩으로 쓸 수 있는 경로 */
export const DATA_BIND_PATHS = /^(company\.(name|nameShort|nameEn|ceoName|website|email|phone|foundedYear)|asOfLabel|docLabel|areas\.[0-5]\.name)$/;

const NUMERIC_TEXT = /^[\s]*(-|[\d,]+(\.\d+)?)[\s]*$/;

/** 바인딩 칩의 숫자 글자를 최신 값으로 바꾼 자식 목록(첫 숫자 글자 하나, 없으면 첫 글자) */
function boundChildren(n: CNode, value: string): CNode[] {
  const kids = n.children ?? [];
  let done = false;
  const swap = (list: CNode[]): CNode[] =>
    list.map((c) => {
      if (done) return c;
      if (c.tag === "#text" && NUMERIC_TEXT.test(c.text ?? "")) {
        done = true;
        return { ...c, text: value };
      }
      return c.children ? { ...c, children: swap(c.children) } : c;
    });
  const out = swap(kids);
  if (done) return out;
  if (n.bind?.startsWith("data:")) {
    // 글 바인딩은 첫 글자 노드를 통째로 바꾼다
    const i = out.findIndex((c) => c.tag === "#text");
    if (i >= 0) return out.map((c, j) => (j === i ? { ...c, text: value } : c));
    return [{ id: n.id + "v", tag: "#text", text: value }, ...out];
  }
  return out;
}

/** 이미지 자산 → img 속성·모양(초점·확대·맞춤) */
function imageProps(n: CNode, env: TreeEnv, props: Record<string, unknown>): void {
  const a = n.asset;
  if (!a) return;
  props.src = env.url(a.key);
  const fx = a.fx ?? 50;
  const fy = a.fy ?? 50;
  const style: CSSProperties = { ...(props.style as CSSProperties | undefined) };
  style.objectFit = a.fit ?? "cover";
  style.objectPosition = `${fx}% ${fy}%`;
  if (a.zoom && a.zoom > 1) {
    style.transform = `scale(${a.zoom})`;
    style.transformOrigin = `${fx}% ${fy}%`;
  }
  props.style = style;
}

export function renderNode(n: CNode, env: TreeEnv, hooks?: TreeHooks): ReactNode {
  if (n.tag === "#text") return n.text ?? "";
  const render = (c: CNode) => renderNode(c, env, hooks);
  const over = hooks?.override?.(n, render);
  if (over !== undefined) return over;
  if (n.tag === "x-icon") {
    const p = (n.props ?? {}) as { name?: string; cls?: string };
    // 아이콘은 글 블록 안의 칩이라 편집 표식을 달지 않는다
    return <Icon key={n.id} name={p.name ?? "file-text"} cls={p.cls ?? "kc-icon"} style={n.style as CSSProperties | undefined} />;
  }
  let props = nodeProps(n, env);
  if (hooks?.decorate) props = hooks.decorate(n, props);
  const art = n.attrs?.["data-illust-art"];
  if (typeof art === "string") return createElement(n.tag, { ...props, dangerouslySetInnerHTML: { __html: illustrationRender(art)?.svg ?? "" } });
  const children = resolvedChildren(n, env).map(render);
  return createElement(n.tag, props, ...(children.length ? children : []));
}

/** 요소 속성(속성·클래스·스타일·이미지 자산) — 스튜디오 캔버스가 편집 요소를 만들 때도 쓴다 */
export function nodeProps(n: CNode, env: TreeEnv): Record<string, unknown> {
  const props: Record<string, unknown> = { key: n.id, ...(n.attrs ?? {}) };
  if (n.className != null) props.className = n.className;
  if (n.style) props.style = { ...n.style };
  if (n.tag === "img") imageProps(n, env, props);
  return props;
}

/** 바인딩을 푼 자식(지표·데이터 값을 최신으로) */
export function resolvedChildren(n: CNode, env: TreeEnv): CNode[] {
  const kids = n.children ?? [];
  if (!n.bind) return kids;
  const v = resolveBind(n.bind, env.data, n.bindDigits);
  return v != null ? boundChildren(n, v) : kids;
}

/** 쪽 루트들 → 정적 요소 */
export function renderTrees(roots: CNode[], env: TreeEnv): ReactElement {
  return <>{roots.map((r) => renderNode(r, env))}</>;
}
