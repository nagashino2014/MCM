"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { circledNumber, parseNote, MISC_SYMBOLS, INLINE_SYMBOLS, type NoteBullet, type NoteLine } from "@/lib/work-plan/structured-note";

/**
 * 추진 내역 "구조화 노트" 입력기.
 * 행 단위로 소제목(괄호+행간)·글머리(걸어쓰기 들여쓰기+행간 상속)·부연(들여쓰기, 비상속)만 정규화.
 * 저장은 마커가 들어간 평문(structured-note.ts 포맷) — value/onChange 가 그 평문.
 *
 * UX 규칙:
 *  - 버튼은 캐럿이 있는 행(없으면 첫 행)에 적용.
 *  - 소제목([]): 버튼=여는 괄호만, 닫는 괄호는 Enter 자동, 다음 줄 전파 X.
 *  - 글머리(①·•·-): Enter 시 같은 글머리 상속(①②③ 섹션별 리셋). none 으로 해제.
 *  - 부연(※→): 들여쓰기+걸어쓰기, 줄바꿈 행간 +30%, 다음 줄 전파 X.
 *  - 기타(₩℃㎡㎥·㈜): 문장 사이 단순 삽입(레이아웃/전파/행간 없음).
 */

const FIXED_MARKER: Partial<Record<NoteBullet, string>> = { none: "", num: "①", dot: "•", dash: "-" };
const INHERITS = (b: NoteBullet) => b === "num" || b === "dot" || b === "dash";
const OPEN_BRACKET = /^\s*[[<]/;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function ToolbarBtn({ label, title, onAct }: { label: string; title: string; onAct: () => void }) {
  return (
    <button type="button" className="sn-btn" title={title} onMouseDown={(e) => e.preventDefault()} onClick={onAct}>
      {label}
    </button>
  );
}

function linesToHtml(value: string): string {
  const lines = parseNote(value);
  if (lines.length === 0) return `<div class="sn-line" data-bullet="none" data-sub="0"><br></div>`;
  let n = 0;
  return lines
    .map((ln) => {
      if (ln.sub) n = 0;
      let marker = "";
      if (ln.bullet === "num") {
        n += 1;
        marker = circledNumber(n);
      } else if (ln.bullet === "misc") marker = ln.mark ?? "";
      else marker = FIXED_MARKER[ln.bullet] ?? "";
      const body = ln.text ? esc(ln.text) : "<br>";
      return `<div class="sn-line" data-bullet="${ln.bullet}" data-marker="${esc(marker)}" data-sub="${ln.sub ? "1" : "0"}">${body}</div>`;
    })
    .join("");
}

export default function StructuredNoteEditor({
  value,
  onChange,
  disabled = false,
  placeholder,
  fill = false,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** 부모 높이를 채우도록(에디터 영역 flex-1). */
  fill?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const focusedRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || focusedRef.current) return;
    el.innerHTML = linesToHtml(value);
  }, [value]);

  const lineEls = (): HTMLElement[] => {
    const el = ref.current;
    if (!el) return [];
    return Array.from(el.children).filter((c): c is HTMLElement => c instanceof HTMLElement);
  };

  const makeLineDiv = (ln: NoteLine): HTMLElement => {
    const div = document.createElement("div");
    div.className = "sn-line";
    div.setAttribute("data-bullet", ln.bullet);
    if (ln.bullet === "misc" && ln.mark) div.setAttribute("data-marker", ln.mark);
    div.setAttribute("data-sub", ln.sub ? "1" : "0");
    if (ln.text) div.textContent = ln.text;
    else div.innerHTML = "<br>";
    return div;
  };

  const normalize = () => {
    const els = lineEls();
    let n = 0;
    els.forEach((el, idx) => {
      el.classList.add("sn-line");
      if (!el.hasAttribute("data-bullet")) {
        let inh = els[idx - 1]?.getAttribute("data-bullet") ?? "none";
        if (!INHERITS(inh as NoteBullet)) inh = "none";
        el.setAttribute("data-bullet", inh);
      }
      const bullet = (el.getAttribute("data-bullet") as NoteBullet) || "none";
      const text = el.textContent ?? "";
      const sub = bullet === "none" && OPEN_BRACKET.test(text);
      el.setAttribute("data-sub", sub ? "1" : "0");
      if (sub) n = 0;
      if (bullet === "num") {
        n += 1;
        el.setAttribute("data-marker", circledNumber(n));
      } else if (bullet === "misc") {
        if (!el.getAttribute("data-marker")) el.setAttribute("data-marker", "");
      } else {
        el.setAttribute("data-marker", FIXED_MARKER[bullet] ?? "");
      }
    });
  };

  const serializeEls = (els: HTMLElement[]): string =>
    els
      .map((el) => {
        const bullet = (el.getAttribute("data-bullet") as NoteBullet) || "none";
        const marker = el.getAttribute("data-marker") || "";
        const text = (el.textContent ?? "").replace(/ /g, " ");
        return bullet === "none" ? text : `${marker} ${text}`;
      })
      .join("\n");

  const serialize = (): string => serializeEls(lineEls());

  const emit = () => {
    normalize();
    onChange(serialize());
  };

  const currentLine = (): HTMLElement | null => {
    const el = ref.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0) return null;
    let node: Node | null = sel.getRangeAt(0).startContainer;
    if (!el.contains(node)) return null;
    while (node && node.parentNode !== el) node = node.parentNode;
    return node instanceof HTMLElement ? node : null;
  };

  // 버튼 적용 대상: 캐럿이 있는 행, 없으면 첫 행(빈 에디터 포함).
  const actionLine = (): HTMLElement | null => currentLine() ?? lineEls()[0] ?? null;

  const setCaretEnd = (lineEl: HTMLElement) => {
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(lineEl);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  };

  // 소제목: 여는 괄호만 토글(이미 열려 있으면 해제). 닫기는 Enter 가 담당.
  const applySubheading = (kind: "sq" | "ang") => {
    if (disabled) return;
    const line = actionLine();
    if (!line) return;
    const open = kind === "sq" ? "[" : "<";
    let t = (line.textContent ?? "").replace(/ /g, " ");
    if (t.trimStart().startsWith(open)) {
      t = t.replace(/^(\s*)[[<]/, "$1").replace(/[\]>](\s*)$/, "$1");
    } else {
      t = t.replace(/^(\s*)[[<]/, "$1");
      t = `${open}${t}`;
    }
    line.setAttribute("data-bullet", "none");
    line.textContent = t;
    if (!t) line.innerHTML = "<br>";
    setCaretEnd(line);
    emit();
  };

  const applyBullet = (bullet: NoteBullet, mark?: string) => {
    if (disabled) return;
    const line = actionLine();
    if (!line) return;
    line.setAttribute("data-bullet", bullet);
    if (bullet === "misc" && mark) line.setAttribute("data-marker", mark);
    setCaretEnd(line);
    emit();
  };

  // 기타 인라인 기호: 캐럿 위치에 단순 삽입(레이아웃/마커 없음).
  const insertInline = (sym: string) => {
    if (disabled) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !el.contains(sel.getRangeAt(0).startContainer)) {
      const line = actionLine();
      if (line) setCaretEnd(line);
    }
    document.execCommand("insertText", false, sym);
    emit();
  };

  // Enter: 소제목이면 닫는 괄호 자동 + 다음 줄 일반. 글머리면 상속, 기타기호는 비상속.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const el = ref.current;
    const sel = window.getSelection();
    const line = currentLine();
    if (!el || !sel || sel.rangeCount === 0 || !line) return;

    const range = sel.getRangeAt(0);
    const pre = document.createRange();
    pre.selectNodeContents(line);
    pre.setEnd(range.endContainer, range.endOffset);
    let before = pre.toString().replace(/ /g, " ");
    const post = document.createRange();
    post.selectNodeContents(line);
    post.setStart(range.endContainer, range.endOffset);
    const after = post.toString().replace(/ /g, " ");

    const bullet = (line.getAttribute("data-bullet") as NoteBullet) || "none";
    const isSub = bullet === "none" && OPEN_BRACKET.test(before);
    if (isSub) {
      const openCh = before.trimStart().charAt(0);
      const closeCh = openCh === "[" ? "]" : openCh === "<" ? ">" : "";
      if (closeCh && !before.trimEnd().endsWith(closeCh)) before = `${before}${closeCh}`;
    }

    line.textContent = before;
    if (!before) line.innerHTML = "<br>";

    const nextBullet: NoteBullet = INHERITS(bullet) ? bullet : "none";
    const nl = document.createElement("div");
    nl.className = "sn-line";
    nl.setAttribute("data-bullet", nextBullet);
    nl.setAttribute("data-sub", "0");
    if (after) nl.textContent = after;
    else nl.innerHTML = "<br>";
    line.after(nl);

    const r = document.createRange();
    r.selectNodeContents(nl);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    emit();
  };

  // 복사/잘라내기: 여러 행 선택 시 마커 포함 평문으로 클립보드에 기록(글머리 레이아웃 복붙 보존).
  // (CSS ::before 로 그려지는 글머리 마커는 기본 복사 평문에 안 담기므로 직접 기록한다.)
  const onCopy = (e: React.ClipboardEvent) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const els = lineEls().filter((el) => sel.containsNode(el, true));
    if (els.length <= 1) return; // 단일 행/부분 선택은 기본 복사 유지
    e.preventDefault();
    e.clipboardData.setData("text/plain", serializeEls(els));
  };

  // 붙여넣기: 여러 줄 평문을 행별 sn-line 으로 삽입(마커 파싱 포함) — 레이아웃 보존.
  const onPaste = (e: React.ClipboardEvent) => {
    if (disabled) return;
    const raw = e.clipboardData.getData("text/plain").replace(/\r/g, "");
    if (!raw) return;
    e.preventDefault();
    const sel = window.getSelection();
    const line = currentLine();
    if (!sel || sel.rangeCount === 0 || !line) {
      document.execCommand("insertText", false, raw.replace(/\n/g, " "));
      emit();
      return;
    }
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const r2 = sel.getRangeAt(0);
    const pre = document.createRange();
    pre.selectNodeContents(line);
    pre.setEnd(r2.endContainer, r2.endOffset);
    const before = pre.toString().replace(/ /g, " ");
    const post = document.createRange();
    post.selectNodeContents(line);
    post.setStart(r2.endContainer, r2.endOffset);
    const after = post.toString().replace(/ /g, " ");

    const pasted = parseNote(raw);
    if (pasted.length === 0) return;
    pasted[0] = { ...pasted[0], text: before + pasted[0].text };
    const li = pasted.length - 1;
    pasted[li] = { ...pasted[li], text: pasted[li].text + after };

    const frag = document.createDocumentFragment();
    let lastDiv: HTMLElement | null = null;
    for (const ln of pasted) {
      const div = makeLineDiv(ln);
      frag.appendChild(div);
      lastDiv = div;
    }
    line.replaceWith(frag);
    if (lastDiv) setCaretEnd(lastDiv);
    emit();
  };

  return (
    <div className={cn("sn-wrap", fill && "h-full flex flex-col min-h-0")}>
      {!disabled && (
        <div className="sn-toolbar flex flex-wrap items-center gap-1.5 mb-2">
          <span className="text-[10px] cd-text-faint">소제목</span>
          <ToolbarBtn label="[ ]" title="소제목" onAct={() => applySubheading("sq")} />
          <span className="mx-0.5 cd-text-faint">|</span>
          <span className="text-[10px] cd-text-faint">글머리</span>
          <ToolbarBtn label="none" title="글머리 제거" onAct={() => applyBullet("none")} />
          <ToolbarBtn label="①" title="번호 ①②③" onAct={() => applyBullet("num")} />
          <ToolbarBtn label="•" title="원형 글머리" onAct={() => applyBullet("dot")} />
          <ToolbarBtn label="-" title="대시 글머리" onAct={() => applyBullet("dash")} />
          <span className="mx-0.5 cd-text-faint">|</span>
          <span className="text-[10px] cd-text-faint">부연</span>
          {MISC_SYMBOLS.map((sym) => (
            <ToolbarBtn key={sym} label={sym} title={`부연 기호 ${sym}`} onAct={() => applyBullet("misc", sym)} />
          ))}
          <span className="mx-0.5 cd-text-faint">|</span>
          <span className="text-[10px] cd-text-faint">기타</span>
          {INLINE_SYMBOLS.map((sym) => (
            <ToolbarBtn key={sym} label={sym} title={`기호 삽입 ${sym}`} onAct={() => insertInline(sym)} />
          ))}
        </div>
      )}
      <div
        ref={ref}
        className={cn("sn-editor cd-input", fill && "flex-1 min-h-0")}
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-placeholder={placeholder ?? "추진 내역을 입력하세요. 소제목/글머리 버튼으로 구조화할 수 있습니다."}
        onFocus={() => {
          focusedRef.current = true;
          try {
            document.execCommand("defaultParagraphSeparator", false, "div");
          } catch {
            /* noop */
          }
        }}
        onBlur={() => {
          focusedRef.current = false;
          emit();
        }}
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onPaste={onPaste}
        onInput={emit}
      />
    </div>
  );
}
