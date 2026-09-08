/**
 * 사이트 화면 위에 띄우는 입력 보조 패널(브라우저 안에서 실행).
 *
 * - 대기열 항목의 양식 값을 사이트 화면 옆에 항목별로 보여 준다.
 * - [복사] 클립보드 / [채우기] 마지막으로 클릭(포커스)한 입력칸에 값 넣기 — 사이트 DOM 셀렉터를 몰라도 동작한다.
 * - config.fill 에 라벨→셀렉터 매핑이 있으면 [자동 채우기] 로 한 번에 넣는다(그리드 컴포넌트는 안 될 수 있음).
 * - [이전]/[다음] 으로 같은 종류의 대기 건을 순회, [제출 완료]/[제외] 는 노드 측(exposeFunction)이 MCM 에 기록.
 *
 * ⚠ 이 파일의 render 함수는 `context.addInitScript(render, data)` 로 **문자열화되어 브라우저에서** 실행된다.
 *    바깥 스코프의 변수·import 를 참조하면 안 된다.
 */

export interface OverlayField {
  label: string;
  value: string;
  hint?: string;
}

export interface OverlayData {
  filingId: string;
  kindLabel: string;
  title: string;
  subtitle: string | null;
  screen: string;
  dueOn: string | null;
  fields: OverlayField[];
  index: number;
  total: number;
  /** 라벨 → CSS 셀렉터, 또는 radio 처럼 값별 셀렉터 { 값: 셀렉터 } (자동 채우기) */
  fill: Record<string, string | Record<string, string>>;
  /** 사이트 alert 메시지(최근) — 패널 상단 배너 */
  notices?: string[];
  /** 사업장 검색 팝업 자동화를 지원하면 검색어(대행사업장 명칭) */
  siteSearchQuery?: string;
}

export type OverlayAction =
  | { type: "next" }
  | { type: "prev" }
  | { type: "submitted"; receiptNo: string }
  | { type: "skipped"; note: string }
  | { type: "probe" }
  | { type: "siteSearch" };

export const ACTION_FN = "__mcmFilingsAction";
export const RENDER_FN = "__mcmFilingsRender";

/** 브라우저에서 실행되는 렌더러 — self-contained. */
export function renderOverlay(data: OverlayData): void {
  const W = window as unknown as Record<string, unknown>;
  const ID = "mcm-filings-panel";
  const COLLAPSE_KEY = "mcm-filings-collapsed";

  // 마지막으로 포커스된 입력 요소(패널 밖) 추적 — 한 번만 등록
  if (!W.__mcmFocusHooked) {
    W.__mcmFocusHooked = true;
    document.addEventListener(
      "focusin",
      (ev) => {
        const t = ev.target as HTMLElement | null;
        if (!t || (t.closest && t.closest(`#${ID}`))) return;
        const tag = t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable) W.__mcmLastFocus = t;
      },
      true
    );
  }

  function setValue(el: HTMLElement, value: string): boolean {
    const tag = el.tagName;
    if (tag === "SELECT") {
      const sel = el as HTMLSelectElement;
      const opt = Array.from(sel.options).find((o) => o.text.trim() === value || o.value === value);
      if (!opt) return false;
      sel.value = opt.value;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    if (tag === "INPUT" || tag === "TEXTAREA") {
      const input = el as HTMLInputElement;
      if (input.type === "radio" || input.type === "checkbox") {
        input.checked = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
      const proto = tag === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(input, value);
      else input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
      return true;
    }
    if (el.isContentEditable) {
      el.textContent = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
    return false;
  }

  function copy(text: string): void {
    try {
      void navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
  }

  function flash(el: HTMLElement, text: string): void {
    const orig = el.textContent;
    el.textContent = text;
    setTimeout(() => (el.textContent = orig), 900);
  }

  // sessionStorage 는 data: URL·일부 보안 정책에서 접근 자체가 예외를 던진다 — 패널이 죽지 않게 감싼다.
  function storeGet(key: string): string | null {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }
  function storeSet(key: string, value: string): void {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // 저장 못 해도 동작에는 지장 없다
    }
  }

  function esc(s: string): string {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
  }

  function build(): void {
    document.getElementById(ID)?.remove();
    const root = document.createElement("div");
    root.id = ID;
    const collapsed = storeGet(COLLAPSE_KEY) === "1";
    root.setAttribute(
      "style",
      [
        "position:fixed", "right:16px", "bottom:16px", "z-index:2147483647", "width:420px", "max-height:82vh",
        "display:flex", "flex-direction:column", "background:#fff", "color:#2a3547", "border:1px solid #e5eaef",
        "border-radius:14px", "box-shadow:0 8px 30px rgba(0,0,0,.18)", "font:13px/1.45 'Pretendard','Malgun Gothic',sans-serif",
        "overflow:hidden",
      ].join(";")
    );
    const style = document.createElement("style");
    style.textContent = `
      #${ID} * { box-sizing: border-box; }
      #${ID} .hd { display:flex; align-items:center; gap:8px; padding:10px 12px; background:#5D87FF; color:#fff; cursor:pointer; }
      #${ID} .hd b { font-size:13px; flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      #${ID} .hd small { opacity:.85; }
      #${ID} .meta { padding:8px 12px; border-bottom:1px solid #e5eaef; color:#5a6a85; font-size:12px; }
      #${ID} .meta b { color:#2a3547; }
      #${ID} .list { overflow:auto; flex:1; }
      #${ID} .row { display:grid; grid-template-columns: 110px 1fr auto auto; gap:6px; align-items:center; padding:6px 12px; border-bottom:1px solid #f1f4f8; }
      #${ID} .row .lb { color:#5a6a85; font-size:12px; }
      #${ID} .row .vl { word-break:break-all; cursor:pointer; }
      #${ID} .row .vl.empty { color:#9aa8bf; font-style:italic; }
      #${ID} .row .ht { grid-column: 2 / span 3; color:#9aa8bf; font-size:11px; margin-top:-2px; }
      #${ID} button { border:1px solid #d9e0ea; background:#f2f6fa; color:#2a3547; border-radius:8px; padding:3px 8px; font-size:12px; cursor:pointer; }
      #${ID} button:hover { background:#ecf2ff; border-color:#5D87FF; color:#4570ea; }
      #${ID} button.pri { background:#5D87FF; border-color:#5D87FF; color:#fff; }
      #${ID} button.pri:hover { background:#4570ea; }
      #${ID} button.warn { border-color:#fa896b; color:#fa896b; background:#fff; }
      #${ID} .ft { display:flex; gap:6px; padding:10px 12px; border-top:1px solid #e5eaef; background:#f8fafc; flex-wrap:wrap; }
      #${ID} .ft .sp { flex:1; }
      #${ID}.collapsed .meta, #${ID}.collapsed .list, #${ID}.collapsed .ft { display:none; }
      #${ID} .nt { display:flex; align-items:flex-start; gap:8px; padding:8px 12px; background:#fff8e1; color:#7a5a00; border-bottom:1px solid #f5e6b8; font-size:12px; }
      #${ID} .nt span { flex:1; white-space:pre-wrap; word-break:break-all; }
      #${ID} .nt button { padding:0 6px; }
    `;
    root.appendChild(style);

    const hd = document.createElement("div");
    hd.className = "hd";
    hd.innerHTML = `<b title="${esc(data.title)}">MCM 신고 보조 · ${esc(data.title)}</b><small>${data.index + 1}/${data.total}</small><small>${collapsed ? "▲" : "▼"}</small>`;
    hd.onclick = () => {
      root.classList.toggle("collapsed");
      storeSet(COLLAPSE_KEY, root.classList.contains("collapsed") ? "1" : "0");
      (hd.lastElementChild as HTMLElement).textContent = root.classList.contains("collapsed") ? "▲" : "▼";
    };
    root.appendChild(hd);
    if (collapsed) root.classList.add("collapsed");

    for (const text of data.notices ?? []) {
      const nt = document.createElement("div");
      nt.className = "nt";
      const span = document.createElement("span");
      span.textContent = `🔔 사이트 알림: ${text}`;
      const close = document.createElement("button");
      close.textContent = "×";
      close.title = "닫기";
      close.onclick = () => nt.remove();
      nt.append(span, close);
      root.appendChild(nt);
    }

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML =
      `<div><b>${esc(data.kindLabel)}</b> · 기한 ${esc(data.dueOn ?? "-")}</div>` +
      `<div>화면: ${esc(data.screen)}</div>` +
      (data.subtitle ? `<div>${esc(data.subtitle)}</div>` : "") +
      `<div style="margin-top:4px;color:#9aa8bf">값 클릭=복사 · [채우기]=마지막에 클릭한 입력칸에 넣기</div>`;
    root.appendChild(meta);

    const list = document.createElement("div");
    list.className = "list";
    for (const f of data.fields) {
      const row = document.createElement("div");
      row.className = "row";
      const lb = document.createElement("div");
      lb.className = "lb";
      lb.textContent = f.label;
      const vl = document.createElement("div");
      vl.className = "vl" + (f.value ? "" : " empty");
      vl.textContent = f.value || "(비어 있음)";
      vl.title = "클릭하면 복사";
      vl.onclick = () => {
        if (!f.value) return;
        copy(f.value);
        flash(vl, "복사됨 ✓");
      };
      const bc = document.createElement("button");
      bc.textContent = "복사";
      bc.onclick = () => {
        copy(f.value);
        flash(bc, "✓");
      };
      const bf = document.createElement("button");
      bf.textContent = "채우기";
      bf.title = "사이트의 입력칸을 먼저 클릭한 뒤 누르세요";
      bf.onclick = () => {
        const target = W.__mcmLastFocus as HTMLElement | undefined;
        if (!target || !document.contains(target)) {
          flash(bf, "칸 먼저 클릭");
          return;
        }
        flash(bf, setValue(target, f.value) ? "✓" : "실패");
      };
      row.append(lb, vl, bc, bf);
      if (f.hint) {
        const ht = document.createElement("div");
        ht.className = "ht";
        ht.textContent = f.hint;
        row.appendChild(ht);
      }
      list.appendChild(row);
    }
    root.appendChild(list);

    const ft = document.createElement("div");
    ft.className = "ft";
    const act = (a: unknown) => {
      const fn = W.__mcmFilingsAction as ((a: unknown) => Promise<void>) | undefined;
      if (fn) void fn(a);
    };
    const mk = (label: string, cls: string, onClick: () => void) => {
      const b = document.createElement("button");
      b.textContent = label;
      if (cls) b.className = cls;
      b.onclick = onClick;
      return b;
    };
    const fillKeys = Object.keys(data.fill || {});
    if (fillKeys.length > 0) {
      ft.appendChild(
        mk("자동 채우기", "pri", () => {
          let ok = 0;
          let miss = 0;
          for (const f of data.fields) {
            const target = data.fill[f.label];
            if (!target || !f.value) continue;
            // 값별 셀렉터(radio): 값과 같은 키의 셀렉터를 고른다
            const sel = typeof target === "string" ? target : target[f.value.trim()];
            if (!sel) {
              miss += 1;
              continue;
            }
            const el = document.querySelector(sel) as HTMLElement | null;
            if (el && setValue(el, f.value)) ok += 1;
            else miss += 1;
          }
          alert(`자동 채우기: ${ok}개 입력, ${miss}개 실패(셀렉터 불일치). 화면에서 값을 확인한 뒤 직접 저장·제출하세요.`);
        })
      );
    }
    if (data.siteSearchQuery) {
      const sb = mk("사업장 검색", "pri", () => {
        act({ type: "siteSearch" });
        flash(sb, "팝업 여는 중…");
      });
      sb.title = `사업장 검색 팝업을 열어 "${data.siteSearchQuery}" 로 검색하고 일치하는 행을 고릅니다`;
      ft.appendChild(sb);
    }
    const probeBtn = mk("폼 덤프", "", () => {
      act({ type: "probe" });
      flash(probeBtn, "저장 중…");
    });
    probeBtn.title = "이 화면의 입력 요소를 파일로 저장합니다(자동 채우기 셀렉터 확보용)";
    ft.appendChild(probeBtn);
    ft.appendChild(mk("◀ 이전", "", () => act({ type: "prev" })));
    ft.appendChild(mk("다음 ▶", "", () => act({ type: "next" })));
    const sp = document.createElement("div");
    sp.className = "sp";
    ft.appendChild(sp);
    ft.appendChild(
      mk("제외", "warn", () => {
        const note = prompt("제외 사유(선택)") ?? null;
        if (note === null) return;
        act({ type: "skipped", note });
      })
    );
    ft.appendChild(
      mk("제출 완료", "pri", () => {
        const receiptNo = prompt("사이트에서 제출을 마쳤나요? 접수번호가 있으면 입력(없으면 비워 두고 확인)");
        if (receiptNo === null) return;
        act({ type: "submitted", receiptNo });
      })
    );
    root.appendChild(ft);
    document.documentElement.appendChild(root);
  }

  W.__mcmFilingsRender = (next: OverlayData) => {
    data = next;
    build();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build, { once: true });
  else build();
}
