/**
 * 외부에서 복사해 붙여넣은 HTML 정리(브라우저 전용 — DOM 필요).
 *
 * 웹 페이지(예: Claude 대화창)에서 복사한 HTML 은 원본 사이트의 class·배치 스타일을 그대로 달고 온다.
 * 이 앱도 Tailwind 를 쓰므로 같은 이름의 유틸리티 class(-mx-*, overflow-*, min-w-* 등)가 우리 CSS 로
 * 다시 적용돼 표가 본문 밖 왼쪽으로 밀리고 앞부분이 잘렸다(2026-10-19 공지 오픈 테스트 사례).
 * 붙여넣을 때·저장된 본문을 보여줄 때·수정 화면에 다시 불러올 때 같은 규칙으로 정리한다.
 * 에디터가 직접 만든 본문은 class·배치 스타일을 쓰지 않으므로 여러 번 적용해도 결과가 같다.
 */

// ── 표 셀 스타일(인라인 — 수신측 호환). MailEditor 표 삽입과 같은 값 ──
export const HEADER_TD_STYLE = "border:1px solid #c8c8cc;padding:6px 10px;font-size:13px;background:#f2f3f6;font-weight:bold;";
export const BODY_TD_STYLE = "border:1px solid #c8c8cc;padding:6px 10px;font-size:13px;";

const DROP_SELECTOR = "script,style,link,meta,title,noscript,button";
// 본문 흐름을 벗어나게 하는 배치 속성 — 붙여넣은 글에서는 의미가 없다.
const LAYOUT_PROPS = ["position", "top", "right", "bottom", "left", "inset", "transform", "z-index", "overflow", "overflow-x", "overflow-y", "min-width"];
const MARGIN_PROPS = ["margin", "margin-left", "margin-right", "margin-top", "margin-bottom"];
const WRAPPER_TAGS = new Set(["DIV", "SECTION", "ARTICLE", "P", "PRE", "BLOCKQUOTE"]);

/** 요소 하나 정리 — class 제거, 배치 속성·음수 여백 제거, 감싸는 블록의 고정 px 폭 제거. */
export function cleanForeignElement(el: HTMLElement, opts?: { keepClass?: boolean }): void {
  if (!opts?.keepClass) el.removeAttribute("class");
  const s = el.style;
  if (!s) return;
  for (const p of LAYOUT_PROPS) s.removeProperty(p);
  for (const p of MARGIN_PROPS) if (s.getPropertyValue(p).includes("-")) s.removeProperty(p);
  if (WRAPPER_TAGS.has(el.tagName) && /px/i.test(s.getPropertyValue("width"))) s.removeProperty("width");
  if (!(el.getAttribute("style") ?? "").trim()) el.removeAttribute("style");
}

/** 테두리 없는 표(원본 사이트 class 로만 선을 그리던 표)에 에디터 표 스타일을 입힌다. */
export function normalizeForeignTable(table: HTMLTableElement): void {
  const cells = Array.from(table.querySelectorAll<HTMLTableCellElement>("th,td"));
  const bordered = !!table.getAttribute("border") || cells.some((c) => /border/i.test(c.getAttribute("style") ?? ""));
  if (!bordered) {
    for (const c of cells) {
      const header = c.tagName === "TH" || !!c.closest("thead");
      c.setAttribute("style", (header ? HEADER_TD_STYLE : BODY_TD_STYLE) + (c.getAttribute("style") ?? ""));
    }
  }
  table.style.borderCollapse = "collapse";
  if (!table.style.width || /px/i.test(table.style.width)) {
    table.style.width = "92%";
    table.style.margin = "8px auto";
  }
}

/** 루트 아래 전체(또는 only 에 든 요소만) 정리. */
export function cleanForeignTree(root: ParentNode, opts?: { keepClass?: boolean; only?: Set<Element> }): void {
  for (const el of Array.from(root.querySelectorAll(DROP_SELECTOR))) {
    if (!opts?.only || opts.only.has(el)) el.remove();
  }
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    if (!opts?.only || opts.only.has(el)) cleanForeignElement(el, opts);
  }
  for (const t of Array.from(root.querySelectorAll<HTMLTableElement>("table"))) {
    if (!opts?.only || opts.only.has(t)) normalizeForeignTable(t);
  }
}

/** HTML 문자열 정리 — 저장된 본문 표시·수정 화면 불러오기용. */
export function cleanForeignHtml(html: string): string {
  if (typeof document === "undefined" || !html) return html;
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  cleanForeignTree(tpl.content);
  return tpl.innerHTML;
}
