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
  /** 첨부 지원 — 직인 파일 유무, 이 건에 붙일 계약 첨부 요약(예: "계약서 1") */
  attach?: { seal: boolean; docs: string[] };
}

export type OverlayAction =
  | { type: "next" }
  | { type: "prev" }
  | { type: "submitted"; receiptNo: string }
  | { type: "skipped"; note: string }
  | { type: "probe" }
  | { type: "siteSearch" }
  /** 대행업무 기간 수정 — MCM 계약의 용역 기간에 저장하고 양식 값을 다시 만든다 */
  | { type: "editPeriod"; start: string; end: string }
  | { type: "attachSeal" }
  | { type: "attachDocs" };

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

  /**
   * 허가번호 드롭다운에서 고를 번호(2026-09-16 사용자 규칙).
   * - 번호는 "기준-차수"(0484-03). 차수가 클수록 나중에 취득한 허가다 → 가장 큰 차수를 고른다.
   * - 앞자리 0만 다른 같은 번호(484-03 / 0484-03)가 함께 있으면 0이 붙은 쪽(0484-03)을 고른다.
   * - MCM 에 허가번호가 적혀 있으면 그 번호를 우선한다(앞자리 0 은 무시하고 비교).
   */
  function pickPermitOption(sel: HTMLSelectElement, want: string): { option: HTMLOptionElement | null; note: string } {
    const parse = (t: string) => {
      const m = t.trim().match(/^(\d+)\s*-\s*(\d+)$/);
      return m ? { base: Number(m[1]), seq: Number(m[2]), width: m[1].length } : null;
    };
    const cands = Array.from(sel.options)
      .map((o) => ({ o, p: parse(o.text) }))
      .filter((x): x is { o: HTMLOptionElement; p: { base: number; seq: number; width: number } } => x.p !== null);
    if (!cands.length) return { option: null, note: "" };
    const w = parse(want || "");
    if (w) {
      const same = cands.filter((x) => x.p.base === w.base && x.p.seq === w.seq).sort((a, b) => b.p.width - a.p.width);
      if (same.length) return { option: same[0].o, note: "MCM 허가번호와 일치" };
    }
    cands.sort((a, b) => b.p.base - a.p.base || b.p.seq - a.p.seq || b.p.width - a.p.width);
    const bases = new Set(cands.map((x) => x.p.base));
    const note =
      bases.size > 1
        ? `기준번호가 ${bases.size}개라 가장 큰 번호를 골랐습니다 — 맞는지 확인하세요`
        : cands.length > 1
          ? `${cands.length}개 중 최신 차수`
          : "";
    return { option: cands[0].o, note };
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

  /**
   * 사업장 검색 같은 **팝업 창**인지. 팝업은 창이 작아 600px 패널이 검색란·결과 목록을 통째로 가린다
   * (2026-09-16 실측) — 팝업에서는 좁게, 기본 접힘으로 띄우고 검색어만 머리줄에 보여 준다.
   */
  function isPopupWindow(): boolean {
    try {
      if (window.opener) return true;
    } catch {
      // cross-origin opener 접근 차단 — URL 로 판정
    }
    return /popup/i.test(location.href);
  }

  function build(): void {
    document.getElementById(ID)?.remove();
    const root = document.createElement("div");
    root.id = ID;
    const popup = isPopupWindow();
    const collapseKey = popup ? COLLAPSE_KEY + ":popup" : COLLAPSE_KEY;
    // 팝업은 저장값이 없으면 접힌 채로 시작한다(본 화면은 펼친 채로).
    const stored = storeGet(collapseKey);
    const collapsed = stored === null ? popup : stored === "1";
    root.setAttribute(
      "style",
      [
        "position:fixed", "right:16px", "bottom:16px", "z-index:2147483647",
        popup ? "width:min(380px, calc(100vw - 32px))" : "width:min(760px, calc(100vw - 24px))",
        popup ? "max-height:60vh" : "max-height:82vh",
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
      #${ID} .meta { padding:8px 30px; border-bottom:1px solid #e5eaef; color:#5a6a85; font-size:12px; overflow-wrap:anywhere; }
      #${ID} .meta b { color:#2a3547; }
      #${ID} .list { overflow-y:auto; overflow-x:hidden; flex:1; }
      /* 라벨·값 칸은 minmax(0, …) 로 두어 긴 내용이 패널 밖으로 밀려나지(가로 스크롤) 않게 한다 */
      /* .row 는 사이트(Bootstrap)의 .row { margin: 0 -15px } 와 이름이 겹쳐 행이 양옆으로 끌려나갔다 — 여백을 명시로 되돌린다 */
      #${ID} .row { display:grid; grid-template-columns: minmax(0, 170px) minmax(0, 1fr) auto auto; gap:8px; align-items:center; margin:0 !important; padding:6px 30px; border-bottom:1px solid #f1f4f8; }
      #${ID} .row .lb { color:#5a6a85; font-size:12px; word-break:keep-all; overflow-wrap:anywhere; }
      #${ID} .row .vl { min-width:0; overflow-wrap:anywhere; word-break:break-all; cursor:pointer; }
      #${ID} .row button { white-space:nowrap; }
      #${ID} .row .vl.empty { color:#9aa8bf; font-style:italic; }
      #${ID} .row .ht { grid-column: 2 / span 3; color:#9aa8bf; font-size:11px; margin-top:-2px; }
      #${ID} button { border:1px solid #d9e0ea; background:#f2f6fa; color:#2a3547; border-radius:8px; padding:3px 8px; font-size:12px; cursor:pointer; }
      #${ID} button:hover { background:#ecf2ff; border-color:#5D87FF; color:#4570ea; }
      #${ID} button.pri { background:#5D87FF; border-color:#5D87FF; color:#fff; }
      #${ID} button.pri:hover { background:#4570ea; }
      #${ID} button.warn { border-color:#fa896b; color:#fa896b; background:#fff; }
      #${ID} .ft { display:flex; gap:6px; padding:10px 30px; border-top:1px solid #e5eaef; background:#f8fafc; flex-wrap:wrap; }
      #${ID} .rec { display:flex; align-items:center; gap:8px; padding:8px 30px; border-top:1px solid #e5eaef; background:#eef4ff; }
      #${ID} .rec span { color:#5a6a85; font-size:12px; white-space:nowrap; }
      #${ID} .rec input { flex:1; min-width:0; border:1px solid #d9e0ea; border-radius:8px; padding:4px 8px; font-size:12px; }
      #${ID} .ft .sp { flex:1; }
      #${ID}.collapsed .meta, #${ID}.collapsed .list, #${ID}.collapsed .ft, #${ID}.collapsed .rec { display:none; }
      #${ID} .nt { display:flex; align-items:flex-start; gap:8px; padding:8px 30px; background:#fff8e1; color:#7a5a00; border-bottom:1px solid #f5e6b8; font-size:12px; }
      #${ID} .nt span { flex:1; white-space:pre-wrap; word-break:break-all; }
      #${ID} .nt button { padding:0 6px; }
    `;
    root.appendChild(style);

    const hd = document.createElement("div");
    hd.className = "hd";
    // 팝업에서는 접힌 머리줄만 보이므로, 거기서 바로 쓸 검색어를 제목 대신 싣는다.
    const headText = popup && data.siteSearchQuery ? `검색어: ${data.siteSearchQuery}` : `MCM 신고 보조 · ${data.title}`;
    hd.innerHTML = `<b title="${esc(data.title)}">${esc(headText)}</b>${popup ? "" : `<small>${data.index + 1}/${data.total}</small>`}<small>${collapsed ? "▲" : "▼"}</small>`;
    hd.onclick = () => {
      root.classList.toggle("collapsed");
      storeSet(collapseKey, root.classList.contains("collapsed") ? "1" : "0");
      (hd.lastElementChild as HTMLElement).textContent = root.classList.contains("collapsed") ? "▲" : "▼";
    };
    if (popup && data.siteSearchQuery) {
      // 검색어를 접힌 상태에서 바로 복사·입력할 수 있게 — 머리줄 클릭(펼치기)과 겹치지 않도록 이벤트를 막는다.
      const q = data.siteSearchQuery;
      const mk2 = (text: string, onClick: () => void) => {
        const b = document.createElement("button");
        b.textContent = text;
        b.setAttribute("style", "background:#fff;border-color:#fff;color:#2a3547;padding:2px 8px;");
        b.onclick = (ev) => {
          ev.stopPropagation();
          onClick();
          flash(b, "됨");
        };
        return b;
      };
      hd.insertBefore(mk2("복사", () => copy(q)), hd.lastElementChild);
      hd.insertBefore(
        mk2("검색칸", () => {
          const input = document.querySelector("#file, input[type=text]") as HTMLElement | null;
          if (input) {
            setValue(input, q);
            (input as HTMLInputElement).focus();
          }
        }),
        hd.lastElementChild
      );
    }
    root.appendChild(hd);
    if (collapsed) root.classList.add("collapsed");

    // 알림은 최근 것 위주로 — 저장·첨부를 연달아 하면 배너가 쌓여 정작 볼 양식 값이 밀려난다(2026-09-16).
    const allNotices = data.notices ?? [];
    const recent = allNotices.slice(-2);
    const older = allNotices.slice(0, Math.max(0, allNotices.length - 2));
    if (older.length) {
      const nt = document.createElement("div");
      nt.className = "nt";
      const span = document.createElement("span");
      span.textContent = `🔔 이전 알림 ${older.length}건 — 펼치기`;
      span.style.cursor = "pointer";
      span.onclick = () => {
        span.textContent = older.map((t) => `🔔 ${t}`).join("\n");
        span.onclick = null;
        span.style.cursor = "default";
      };
      const close = document.createElement("button");
      close.textContent = "×";
      close.title = "닫기";
      close.onclick = () => nt.remove();
      nt.append(span, close);
      root.appendChild(nt);
    }
    for (const text of recent) {
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
      `<div style="margin-top:4px;color:#9aa8bf">값 클릭=복사 · [채우기]=마지막에 클릭한 입력칸에 넣기</div>` +
      // 직인·서류 첨부 칸은 신청서를 저장해야 화면에 생긴다(2026-09-16 실측) — 순서를 눈에 띄게 남긴다.
      (data.attach
        ? `<div style="margin-top:4px;color:#7a5a00">순서: 사업장 검색 → 자동 채우기 → <b>저장</b> → 직인·서류 첨부 → 제출</div>`
        : "");
    root.appendChild(meta);

    /**
     * 대행업무 기간 수정 — 계약서에 용역 종료일이 없으면 규칙으로 산정한 값이 들어간다. 사이트에서 다르게
     * 신고했는데 MCM 값이 그대로면 신고 내역이 어긋나므로(2026-09-16 부산사업소 사례), 여기서 고쳐
     * **MCM 계약의 용역 기간에 저장**하고 양식 값을 다시 만든 뒤 [자동 채우기] 로 화면에 넣는다.
     */
    const startField = data.fields.find((f) => f.label === "대행업무 시작일");
    const endField = data.fields.find((f) => f.label === "대행업무 종료일");
    // 사업장 검색 같은 팝업에서는 기간을 고칠 일이 없다 — 좁은 폭에 찌그러지므로 그리지 않는다
    if (startField && endField && !popup) {
      const bar = document.createElement("div");
      bar.className = "rec";
      const label = document.createElement("span");
      label.textContent = "대행업무 기간";
      const mkDate = (v: string) => {
        const i = document.createElement("input");
        i.type = "text";
        i.value = v;
        i.placeholder = "YYYY-MM-DD";
        i.style.maxWidth = "120px";
        i.style.textAlign = "center";
        return i;
      };
      const s = mkDate(startField.value);
      const tilde = document.createElement("span");
      tilde.textContent = "~";
      const e = mkDate(endField.value);
      const save = document.createElement("button");
      save.className = "pri";
      save.textContent = "계약에 반영";
      save.onclick = () => {
        const re = /^\d{4}-\d{2}-\d{2}$/;
        if (!re.test(s.value.trim()) || !re.test(e.value.trim())) {
          alert("기간은 YYYY-MM-DD 형식으로 입력하세요.");
          return;
        }
        flash(save, "저장 중…");
        act({ type: "editPeriod", start: s.value.trim(), end: e.value.trim() });
      };
      save.title = "MCM 계약의 용역 기간(착수일·종료일)에 저장하고 양식 값을 다시 만듭니다";
      const note = document.createElement("span");
      note.textContent = endField.hint?.includes("미기입") ? "종료일 산정값 — 실제 신고값으로 고치세요" : "";
      note.style.color = "#9aa8bf";
      bar.append(label, s, tilde, e, save, note);
      root.appendChild(bar);
    }

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
          let permitNote = "";
          for (const f of data.fields) {
            const target = data.fill[f.label];
            if (!target) continue;
            // 허가번호는 사업장을 고르면 채워지는 드롭다운이다 — MCM 값이 비어 있어도 목록에서 골라 넣는다.
            if (f.label === "허가번호" && typeof target === "string") {
              const el = document.querySelector(target) as HTMLSelectElement | null;
              if (el && el.tagName === "SELECT") {
                const picked = pickPermitOption(el, f.value);
                if (picked.option) {
                  el.value = picked.option.value;
                  el.dispatchEvent(new Event("change", { bubbles: true }));
                  ok += 1;
                  permitNote = `\n허가번호: ${picked.option.text.trim()} 선택${picked.note ? ` (${picked.note})` : ""}`;
                } else {
                  permitNote = "\n허가번호: 목록이 비어 있습니다 — 사업장을 먼저 선택한 뒤 다시 누르세요.";
                }
                continue;
              }
            }
            if (!f.value) continue;
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
          alert(`자동 채우기: ${ok}개 입력, ${miss}개 실패(셀렉터 불일치). 화면에서 값을 확인한 뒤 직접 저장·제출하세요.${permitNote}`);
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
    if (data.attach?.seal) {
      const b = mk("직인 첨부", "", () => {
        act({ type: "attachSeal" });
        flash(b, "첨부 중…");
      });
      b.title = "직인 이미지를 직인 칸에 첨부하고 저장합니다 — 신청서를 한 번 저장한 뒤에 눌러야 칸이 생깁니다";
      ft.appendChild(b);
    }
    if (data.attach?.docs?.length) {
      const b = mk(`서류 첨부(${data.attach.docs.length})`, "", () => {
        act({ type: "attachDocs" });
        flash(b, "첨부 중…");
      });
      b.title = `MCM 계약 첨부를 첨부서류 칸에 올리고 저장합니다 — 신청서를 한 번 저장한 뒤에 눌러야 칸이 생깁니다: ${data.attach.docs.join(", ")}`;
      ft.appendChild(b);
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
    /**
     * 접수번호·제외 사유는 패널 안에서 받는다. 브라우저 prompt() 를 쓰면 도구의 대화상자 처리기가 먼저
     * 가로채 닫아 버려 기록이 되지 않는다(2026-09-16 실측 — [제출 완료] 를 눌러도 아무 일이 없던 원인).
     */
    const askThen = (kind: "submitted" | "skipped") => {
      root.querySelector(".rec")?.remove();
      const bar = document.createElement("div");
      bar.className = "rec";
      const label = document.createElement("span");
      label.textContent = kind === "submitted" ? "접수번호" : "제외 사유";
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = kind === "submitted" ? "없으면 비워 두고 [기록]" : "선택";
      const done = mk(kind === "submitted" ? "제출 완료로 기록" : "제외로 기록", "pri", () => {
        const v = input.value.trim();
        act(kind === "submitted" ? { type: "submitted", receiptNo: v } : { type: "skipped", note: v });
        bar.remove();
      });
      input.onkeydown = (ev) => {
        if (ev.key === "Enter") done.click();
        if (ev.key === "Escape") bar.remove();
      };
      bar.append(label, input, done, mk("취소", "", () => bar.remove()));
      root.insertBefore(bar, ft);
      input.focus();
    };
    ft.appendChild(mk("제외", "warn", () => askThen("skipped")));
    ft.appendChild(mk("제출 완료", "pri", () => askThen("submitted")));
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
