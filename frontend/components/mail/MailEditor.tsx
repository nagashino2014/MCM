"use client";

// 메일 리치 에디터(G2-7/8) — contentEditable 기반, 의존성 0. 네이버 메일급 서식 목표.
// 서식: 글꼴·크기·B/I/U/취소선·글자색·정렬(좌중우양)·들여/내어쓰기·줄간격(50~180%)·목록·링크·구분선·기호·표·이미지.
// 표 편집: 커서가 표 안이면 표 툴바(행/열 추가·삭제, 셀 배경색, 너비/높이 같게, 셀 경계 드래그 리사이즈).
// 자동 글머리: 줄 시작 "-"/"*"/"1." + Space/Enter → 목록 전환(IME 조합 중 제외).
// 목록 마커는 Tailwind 전역 리셋이 지우므로 .cd-mail-editor 스코프 CSS 로 복원(cdash.css).
// 표·구분선·이미지는 인라인 스타일(외부 메일 클라이언트 호환). MailComposer 에서 사용.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowDown, ArrowLeft, ArrowRight, ArrowUp,
  Baseline, Bold, Image as ImageIcon, Indent, Italic, Link2, List, ListOrdered, Minus as MinusIcon,
  Omega, Outdent, Paintbrush, Plus, SeparatorHorizontal, Strikethrough, Subscript, Superscript, Table2, Trash2,
  Underline as UnderlineIcon, UnfoldHorizontal, UnfoldVertical,
} from "lucide-react";
import { CdIconButton } from "@/components/cdash/CdButton";

// ── 표 스타일 상수(인라인 — 수신측 호환) ─────────────────────────────
const HEADER_TD_STYLE = "border:1px solid #c8c8cc;padding:6px 10px;font-size:13px;background:#f2f3f6;font-weight:bold;";
const BODY_TD_STYLE = "border:1px solid #c8c8cc;padding:6px 10px;font-size:13px;";
const TABLE_MAX_ROWS = 6;
const TABLE_MAX_COLS = 8;
const HR_HTML = `<hr style="border:none;border-top:1px solid #c8c8cc;margin:12px 0">`;

function buildTableHtml(rows: number, cols: number): string {
  const td = (header: boolean) => `<td style="${header ? HEADER_TD_STYLE : BODY_TD_STYLE}">&nbsp;</td>`;
  const tr = (header: boolean) => `<tr>${Array.from({ length: cols }, () => td(header)).join("")}</tr>`;
  const body = Array.from({ length: rows }, (_, i) => tr(i === 0)).join("");
  return `<table style="border-collapse:collapse;margin:8px 0;width:100%"><tbody>${body}</tbody></table><div><br></div>`;
}

// 글꼴(메일 안전 폰트 위주 — 수신측 미설치 시 유사 폰트 폴백).
const FONTS: { label: string; value: string }[] = [
  { label: "기본 글꼴", value: "" },
  { label: "맑은 고딕", value: "'Malgun Gothic', sans-serif" },
  { label: "나눔고딕", value: "'NanumGothic', 'Malgun Gothic', sans-serif" },
  { label: "굴림", value: "Gulim, sans-serif" },
  { label: "돋움", value: "Dotum, sans-serif" },
  { label: "바탕", value: "Batang, serif" },
  { label: "궁서", value: "Gungsuh, serif" },
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Verdana", value: "Verdana, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Times New Roman", value: "'Times New Roman', serif" },
  { label: "Courier New", value: "'Courier New', monospace" },
];

const FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28];
const LINE_HEIGHTS = [50, 80, 100, 120, 150, 180]; // % — 네이버 메일 옵션과 동일

// 글자색 팔레트.
const TEXT_COLORS = [
  "#000000", "#5f6368", "#9aa0a6", "#e02b20", "#f57c00", "#b8860b",
  "#2e7d32", "#00897b", "#1565c0", "#283593", "#6a1b9a", "#6d4c41",
];

// 셀 배경색 팔레트(soft 톤).
const CELL_COLORS: { label: string; color: string | null }[] = [
  { label: "없음", color: null },
  { label: "회색", color: "#f2f3f6" },
  { label: "노랑", color: "#fff3cd" },
  { label: "파랑", color: "#d7e6fd" },
  { label: "초록", color: "#ddf3e4" },
  { label: "빨강", color: "#fde2e0" },
  { label: "보라", color: "#ecdffb" },
  { label: "주황", color: "#ffe8d1" },
  { label: "청록", color: "#d3f0ef" },
];

// 업무 문서 상용 기호 팔레트 — 카테고리 탭.
const SYMBOL_GROUPS: { key: string; label: string; symbols: string[] }[] = [
  {
    key: "shape",
    label: "도형·별",
    symbols: [
      "※", "★", "☆", "●", "○", "◎", "⊙", "■", "□", "▣", "◆", "◇",
      "▲", "△", "▼", "▽", "▶", "◀", "▷", "◁", "♠", "♤", "♣", "♧",
      "♥", "♡", "◈", "▒", "◐", "◑", "♨", "☏", "☎", "✉", "♩", "♪",
    ],
  },
  {
    key: "arrow",
    label: "화살표",
    symbols: [
      "→", "←", "↑", "↓", "↔", "↕", "↗", "↘", "↙", "↖", "⇒", "⇐",
      "⇑", "⇓", "⇔", "⇕", "➔", "➜", "➤", "▸", "▹", "▻", "◃", "↳",
    ],
  },
  {
    key: "circled",
    label: "원문자",
    symbols: [
      "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫",
      "⑬", "⑭", "⑮", "ⓐ", "ⓑ", "ⓒ", "ⓓ", "ⓔ", "⒜", "⒝", "⒞", "⒟",
      "⑴", "⑵", "⑶", "⑷", "⑸", "⑹", "⑺", "⑻", "⑼", "⑽", "⓵", "⓶",
    ],
  },
  {
    key: "hangul",
    label: "한글·로마자",
    symbols: [
      "㉠", "㉡", "㉢", "㉣", "㉤", "㉥", "㉦", "㉧", "㉨", "㉩", "㉪", "㉫",
      "㈀", "㈁", "㈂", "㈃", "㈄", "㈅", "㈆", "㈇", "㈈", "㈉", "㈊", "㈋",
      "Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ", "Ⅶ", "Ⅷ", "Ⅸ", "Ⅹ", "ⅰ", "ⅱ",
      "ⅲ", "ⅳ", "ⅴ", "ⅵ", "ⅶ", "ⅷ", "ⅸ", "ⅹ", "가", "나", "다", "라",
    ],
  },
  {
    key: "math",
    label: "수학·논리",
    symbols: [
      "±", "×", "÷", "≠", "≒", "≤", "≥", "≦", "≧", "∼", "∞", "∴",
      "∵", "∝", "√", "∫", "∑", "∏", "∈", "∋", "⊂", "⊃", "∪", "∩",
      "∧", "∨", "¬", "∀", "∃", "°", "′", "″", "⊥", "∥", "∠", "≡",
    ],
  },
  {
    key: "unit",
    label: "단위",
    symbols: [
      "℃", "℉", "㎜", "㎝", "ｍ", "㎞", "㎟", "㎠", "㎡", "㎢", "㎣", "㎤",
      "㎥", "㎦", "㎕", "㎖", "㎗", "ℓ", "㎘", "㎎", "ｇ", "㎏", "ｔ", "㎧",
      "㎨", "㎰", "㎲", "㎳", "㎐", "㎑", "㎒", "㎓", "㎾", "㎿", "㏄", "ppm",
    ],
  },
  {
    key: "punct",
    label: "문장부호·괄호",
    symbols: [
      "·", "‥", "…", "「", "」", "『", "』", "【", "】", "〔", "〕", "《",
      "》", "〈", "〉", "“", "”", "‘", "’", "™", "©", "®", "§", "¶",
      "†", "‡", "‰", "＿", "￣", "〃", "℡", "№", "㏇", "㈜", "㉿", "㍿",
    ],
  },
  {
    key: "check",
    label: "체크·통화",
    symbols: [
      "✓", "✔", "✕", "✗", "✘", "☑", "☒", "☐", "◉", "⊚", "𝐎", "Ｘ",
      "￦", "＄", "￡", "￥", "€", "￠", "₩", "¢", "£", "¥", "＃", "＆",
      "＠", "＊", "☞", "☜", "☝", "☟", "♂", "♀", "☀", "☁", "☂", "☃",
    ],
  },
];

function SymbolPalette({ onInsert }: { onInsert: (symbol: string) => void }) {
  const [tab, setTab] = useState(SYMBOL_GROUPS[0].key);
  const group = SYMBOL_GROUPS.find((g) => g.key === tab) ?? SYMBOL_GROUPS[0];
  return (
    <div className="absolute top-full left-0 mt-1 z-50 rounded-xl border cd-border-c cd-card-bg p-2 w-[19rem]" style={{ boxShadow: "var(--cd-shadow)" }}>
      <div className="flex flex-wrap gap-0.5 mb-1.5 border-b cd-border-c pb-1.5">
        {SYMBOL_GROUPS.map((g) => (
          <button
            key={g.key}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setTab(g.key)}
            className={
              "px-2 py-1 rounded-md text-[11px] font-semibold transition-colors " +
              (g.key === tab ? "cd-soft-primary" : "cd-text-faint hover:text-[color:var(--cd-text)]")
            }
          >
            {g.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-9 gap-0.5 max-h-44 overflow-y-auto">
        {group.symbols.map((s) => (
          <button
            key={s}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onInsert(s)}
            className="h-7 rounded-md text-sm cd-text hover:cd-soft-primary flex items-center justify-center"
            title={s}
          >
            {s}
          </button>
        ))}
      </div>
      <p className="text-[10px] cd-text-faint mt-1.5">클릭하면 커서 위치에 삽입됩니다. 연속 삽입 가능 · ESC 닫기</p>
    </div>
  );
}

// ── 표 DOM 편집 유틸 ─────────────────────────────────────────────
function insertRow(cell: HTMLTableCellElement, where: "above" | "below"): void {
  const tr = cell.closest("tr");
  if (!tr) return;
  const cols = tr.cells.length;
  const newTr = document.createElement("tr");
  for (let i = 0; i < cols; i++) {
    const td = document.createElement("td");
    td.setAttribute("style", BODY_TD_STYLE);
    td.innerHTML = "&nbsp;";
    newTr.appendChild(td);
  }
  if (where === "above") tr.before(newTr);
  else tr.after(newTr);
}

function deleteRow(cell: HTMLTableCellElement): void {
  const tr = cell.closest("tr");
  const table = cell.closest("table");
  if (!tr || !table) return;
  if (table.rows.length <= 1) table.remove();
  else tr.remove();
}

function insertCol(cell: HTMLTableCellElement, where: "left" | "right"): void {
  const table = cell.closest("table");
  if (!table) return;
  const idx = cell.cellIndex;
  for (const row of Array.from(table.rows)) {
    const ref = row.cells[Math.min(idx, row.cells.length - 1)];
    const td = document.createElement("td");
    td.setAttribute("style", ref?.getAttribute("style") || BODY_TD_STYLE);
    td.innerHTML = "&nbsp;";
    if (where === "left") ref?.before(td);
    else ref?.after(td);
  }
}

function deleteCol(cell: HTMLTableCellElement): void {
  const table = cell.closest("table");
  if (!table) return;
  const idx = cell.cellIndex;
  if (table.rows[0] && table.rows[0].cells.length <= 1) {
    table.remove();
    return;
  }
  for (const row of Array.from(table.rows)) row.cells[idx]?.remove();
}

function freezeTableWidths(table: HTMLTableElement): void {
  if (table.style.tableLayout === "fixed") return;
  const firstRow = table.rows[0];
  if (!firstRow) return;
  for (const td of Array.from(firstRow.cells)) td.style.width = `${td.offsetWidth}px`;
  table.style.tableLayout = "fixed";
  table.style.width = "auto";
}

/** 열 너비 같게 — 현재 표 폭을 유지한 채 모든 열을 균등 분배. */
function equalizeCols(cell: HTMLTableCellElement): void {
  const table = cell.closest("table") as HTMLTableElement | null;
  const firstRow = table?.rows[0];
  if (!table || !firstRow) return;
  const total = table.offsetWidth;
  const w = Math.max(36, Math.floor(total / firstRow.cells.length));
  for (const row of Array.from(table.rows)) for (const td of Array.from(row.cells)) td.style.width = `${w}px`;
  table.style.tableLayout = "fixed";
  table.style.width = "auto";
}

/** 행 높이 같게 — 가장 큰 행 높이로 전체 통일. */
function equalizeRows(cell: HTMLTableCellElement): void {
  const table = cell.closest("table") as HTMLTableElement | null;
  if (!table) return;
  const max = Math.max(...Array.from(table.rows).map((r) => r.offsetHeight));
  for (const row of Array.from(table.rows)) for (const td of Array.from(row.cells)) td.style.height = `${max}px`;
}

const EDGE = 5;

export interface MailEditorProps {
  onInput: () => void;
  statusText?: string;
  /** 이미지 버튼 클릭 → 부모(MailComposer)가 파일 선택·인라인 등록을 수행. */
  onPickImage?: () => void;
  /** 본문 최소 높이 px — 메일 작성(기본 634) 외 임베드 용도(전자결재 여러 줄 필드 등)는 낮게. */
  minHeightPx?: number;
  /** 붙여넣은 외부 이미지를 가져오지 못했을 때(권한 필요 URL 등) 사유 목록 — 사용자 안내용. */
  onPasteImageFailed?: (reasons: string[]) => void;
}

export const MailEditor = forwardRef<HTMLDivElement, MailEditorProps>(function MailEditor(
  { onInput, statusText, onPickImage, minHeightPx, onPasteImageFailed },
  ref
) {
  const innerRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => innerRef.current as HTMLDivElement);

  const [toolPopover, setToolPopover] = useState<"symbol" | "table" | "cellcolor" | "textcolor" | "lineheight" | null>(null);
  const [tableHover, setTableHover] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const [activeCell, setActiveCell] = useState<HTMLTableCellElement | null>(null);
  const [supActive, setSupActive] = useState(false); // 위 첨자 토글 상태(G2-14)
  const [subActive, setSubActive] = useState(false); // 아래 첨자 토글 상태
  const dragRef = useRef<{ kind: "col" | "row"; cells: HTMLTableCellElement[]; startPos: number; startSize: number } | null>(null);
  /** 직전 붙여넣기의 클립보드 이미지 파일 — 외부 URL 수집 실패 시 대체 소스로 쓴다. */
  const pastedImageFiles = useRef<File[]>([]);
  /** 크기 조절 중인 이미지(선택 상태) + 핸들 위치. */
  const [selectedImg, setSelectedImg] = useState<HTMLImageElement | null>(null);
  const [imgBox, setImgBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const imgDragRef = useRef<{ startX: number; startW: number; ratio: number } | null>(null);

  const exec = (cmd: string, value?: string) => {
    innerRef.current?.focus();
    document.execCommand(cmd, false, value);
    onInput();
  };
  const insertHtml = (html: string) => {
    innerRef.current?.focus();
    document.execCommand("insertHTML", false, html);
    onInput();
  };

  /**
   * 붙여넣은 본문의 외부 이미지를 자체 data URL 로 수집한다(G6-A 후속).
   * 다른 웹메일(네이버 등)에서 서명을 복사하면 명함 이미지가 그쪽 서버 URL 로 들어오는데,
   * 그 URL 은 로그인 세션·Referer 검증이 걸려 있어 우리 화면·수신자 화면에서 깨진다.
   * 서버 프록시가 한 번 받아 data URL 로 바꿔 넣으면 본문·서명이 자기완결 상태가 된다.
   */
  /** File → data URL. */
  const readAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("파일을 읽지 못했습니다."));
      reader.readAsDataURL(file);
    });

  const absorbExternalImages = async (attempt = 0) => {
    const el = innerRef.current;
    if (!el) return;
    const targets = Array.from(el.querySelectorAll("img")).filter((img) => {
      const src = img.getAttribute("src") ?? "";
      if (!src) return false;
      // 이미 자체 보관 중인 형식(data/cid/blob)과 자체 오리진(첨부 미리보기)은 그대로 둔다.
      if (/^(data:|cid:|blob:)/i.test(src)) return false;
      if (src.startsWith(window.location.origin)) return false;
      // 절대 URL + 프로토콜 상대(//host/path) 모두 외부로 본다.
      return /^https?:\/\//i.test(src) || src.startsWith("//");
    });
    if (!targets.length) {
      // 붙여넣기 삽입이 아직 DOM 에 반영되지 않았을 수 있어 잠깐 뒤 다시 확인한다.
      if (attempt < 4) setTimeout(() => void absorbExternalImages(attempt + 1), 120 * (attempt + 1));
      return;
    }
    const failed: string[] = [];
    const unresolved: HTMLImageElement[] = [];
    for (const img of targets) {
      const src = img.getAttribute("src");
      if (!src) continue;
      const url = src.startsWith("//") ? `https:${src}` : src;
      try {
        const r = await fetch("/api/mail/proxy-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const d = (await r.json().catch(() => ({}))) as { dataUrl?: string; error?: string };
        if (!r.ok || !d.dataUrl) {
          failed.push(`${url} → ${d.error ?? `HTTP ${r.status}`}`);
          unresolved.push(img);
          continue;
        }
        img.setAttribute("src", d.dataUrl);
        img.removeAttribute("srcset"); // srcset 이 남으면 브라우저가 원본 외부 URL 을 다시 고른다
        if (!img.style.maxWidth) img.style.maxWidth = "100%";
      } catch (e) {
        failed.push(`${url} → ${e instanceof Error ? e.message : "fetch 실패"}`);
        unresolved.push(img);
      }
    }

    // 서버가 못 가져온 이미지(네이버 등 로그인 세션이 필요한 주소)는 클립보드에 함께 담겨 온
    // 원본 비트맵으로 메운다 — 브라우저가 복사 시점에 이미 이미지를 갖고 있는 경우가 많다.
    const spare = pastedImageFiles.current;
    pastedImageFiles.current = [];
    let repaired = 0;
    for (const img of unresolved) {
      const file = spare[repaired];
      if (!file) break;
      try {
        const dataUrl = await readAsDataUrl(file);
        if (!dataUrl.startsWith("data:image/")) continue;
        img.setAttribute("src", dataUrl);
        img.removeAttribute("srcset");
        if (!img.style.maxWidth) img.style.maxWidth = "100%";
        repaired += 1;
      } catch {
        // 무시 — 아래 안내로 넘어간다
      }
    }

    if (failed.length > repaired) {
      // 원인 파악용 — 어떤 주소가 왜 실패했는지 남긴다(권한 필요 URL·핫링크 차단 등).
      console.warn("[mail] 붙여넣은 이미지를 가져오지 못했습니다:", failed);
      onPasteImageFailed?.(failed.slice(repaired));
    }
    onInput();
  };

  /** 붙여넣기 — 클립보드 이미지 파일은 data URL 로 즉시 삽입, HTML 은 삽입 후 외부 이미지 수집. */
  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const cd = e.clipboardData;
    if (!cd) return;
    const hasHtml = cd.types.includes("text/html");
    const imageFiles = Array.from(cd.items)
      .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
      .map((it) => it.getAsFile())
      .filter((f): f is File => f != null);

    // 스크린샷·이미지 단독 복사(HTML 동반 없음) → 파일을 직접 읽어 삽입.
    if (imageFiles.length > 0 && !hasHtml) {
      e.preventDefault();
      for (const f of imageFiles) {
        const reader = new FileReader();
        reader.onload = () => {
          const url = String(reader.result ?? "");
          if (url.startsWith("data:image/")) insertHtml(`<img src="${url}" style="max-width:100%">`);
        };
        reader.readAsDataURL(f);
      }
      return;
    }
    // HTML(서명 등)은 기본 붙여넣기 후 외부 이미지를 수집한다.
    // 서버가 못 가져오는 주소(로그인 필요)를 대비해 클립보드의 원본 비트맵을 함께 보관한다.
    pastedImageFiles.current = imageFiles;
    console.info("[mail] paste types:", cd.types.join(", "), "| 이미지 파일:", imageFiles.length);
    setTimeout(() => {
      void absorbExternalImages();
    }, 0);
  };

  /** 글자 크기(px) — execCommand fontSize(1~7) 는 px 지정 불가 → size=7 마커를 span 으로 치환하는 고전 기법. */
  const applyFontSize = (px: number) => {
    const editor = innerRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand("fontSize", false, "7");
    for (const font of Array.from(editor.querySelectorAll('font[size="7"]'))) {
      const span = document.createElement("span");
      span.style.fontSize = `${px}px`;
      span.innerHTML = (font as HTMLElement).innerHTML;
      font.replaceWith(span);
    }
    onInput();
  };

  /** 줄 간격(%) — 선택 범위와 교차하는 블록들의 line-height 지정. */
  const applyLineHeight = (pct: number) => {
    const editor = innerRef.current;
    const sel = window.getSelection();
    if (!editor || !sel || sel.rangeCount === 0) return;
    const blocks = Array.from(editor.querySelectorAll<HTMLElement>("div,p,li,td"));
    let applied = 0;
    for (const b of blocks) {
      // 자식 블록을 또 가진 컨테이너(중복 적용)는 건너뛴다.
      if (b.querySelector("div,p,li")) continue;
      if (sel.containsNode(b, true)) {
        b.style.lineHeight = String(pct / 100);
        applied++;
      }
    }
    if (!applied) {
      // 선택 없는 커서 위치 — anchor 블록에 적용.
      const node = sel.anchorNode;
      const el = node instanceof HTMLElement ? node : node?.parentElement;
      const block = el?.closest?.("div,p,li,td") as HTMLElement | null;
      if (block && editor.contains(block)) block.style.lineHeight = String(pct / 100);
    }
    onInput();
  };

  // 커서 위치의 표 셀 추적 + 첨자 토글 상태(G2-14) 동기.
  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection();
      const node = sel?.anchorNode;
      const el = node instanceof HTMLElement ? node : (node?.parentElement ?? null);
      const cell = (el?.closest?.("td,th") ?? null) as HTMLTableCellElement | null;
      setActiveCell(cell && innerRef.current?.contains(cell) ? cell : null);
      // 위/아래 첨자 토글 활성 표시 — 커서가 에디터 안에 있을 때만 판독.
      if (node && innerRef.current?.contains(node instanceof HTMLElement ? node : node.parentElement)) {
        try {
          setSupActive(document.queryCommandState("superscript"));
          setSubActive(document.queryCommandState("subscript"));
        } catch {
          /* noop */
        }
      }
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  // 팝오버 외부 클릭/ESC — ESC 는 capture 로 가로채 CdModal 오닫힘 방지.
  useEffect(() => {
    if (!toolPopover) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest?.("[data-tool-popover]")) setToolPopover(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setToolPopover(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [toolPopover]);

  // 열/행 드래그 리사이즈.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      e.preventDefault();
      const delta = (drag.kind === "col" ? e.clientX : e.clientY) - drag.startPos;
      const size = Math.max(drag.kind === "col" ? 36 : 24, drag.startSize + delta);
      for (const c of drag.cells) {
        if (drag.kind === "col") c.style.width = `${size}px`;
        else c.style.height = `${size}px`;
      }
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      onInput();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 이미지 크기 조절 ────────────────────────────────
  /** 선택된 이미지의 핸들 위치를 에디터 기준 좌표로 갱신(스크롤·리플로우 반영). */
  const syncImgBox = useCallback(() => {
    const editor = innerRef.current;
    const img = selectedImg;
    if (!editor || !img || !img.isConnected) {
      setImgBox(null);
      return;
    }
    const er = editor.getBoundingClientRect();
    const ir = img.getBoundingClientRect();
    setImgBox({ top: ir.top - er.top + editor.scrollTop, left: ir.left - er.left, width: ir.width, height: ir.height });
  }, [selectedImg]);

  useEffect(() => {
    syncImgBox();
    if (!selectedImg) return;
    const editor = innerRef.current;
    editor?.addEventListener("scroll", syncImgBox);
    window.addEventListener("resize", syncImgBox);
    return () => {
      editor?.removeEventListener("scroll", syncImgBox);
      window.removeEventListener("resize", syncImgBox);
    };
  }, [selectedImg, syncImgBox]);

  // 이미지 드래그 리사이즈(비율 유지) — 수신측 호환 위해 style.width 와 width 속성을 함께 쓴다.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = imgDragRef.current;
      const img = selectedImg;
      if (!drag || !img) return;
      e.preventDefault();
      const maxW = innerRef.current?.clientWidth ?? 2000;
      const width = Math.round(Math.min(maxW, Math.max(40, drag.startW + (e.clientX - drag.startX))));
      img.style.width = `${width}px`;
      img.style.height = "auto";
      img.setAttribute("width", String(width));
      img.removeAttribute("height");
      syncImgBox();
    };
    const onUp = () => {
      if (!imgDragRef.current) return;
      imgDragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      onInput();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [selectedImg, syncImgBox, onInput]);

  const startImgResize = (e: React.MouseEvent) => {
    const img = selectedImg;
    if (!img) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = img.getBoundingClientRect();
    imgDragRef.current = { startX: e.clientX, startW: rect.width, ratio: rect.height / Math.max(1, rect.width) };
    document.body.style.cursor = "nwse-resize";
    document.body.style.userSelect = "none";
  };

  const onEditorMouseMove = (e: React.MouseEvent) => {
    if (dragRef.current) return;
    const editor = innerRef.current;
    if (!editor) return;
    const cell = (e.target as HTMLElement).closest?.("td,th") as HTMLTableCellElement | null;
    if (!cell || !editor.contains(cell)) {
      editor.style.cursor = "";
      return;
    }
    const rect = cell.getBoundingClientRect();
    if (rect.right - e.clientX < EDGE) editor.style.cursor = "col-resize";
    else if (rect.bottom - e.clientY < EDGE) editor.style.cursor = "row-resize";
    else editor.style.cursor = "";
  };

  const onEditorMouseDown = (e: React.MouseEvent) => {
    const editor = innerRef.current;
    if (!editor) return;
    // 이미지 클릭 = 선택(크기 조절 핸들 표시). 다른 곳을 누르면 선택 해제.
    const target = e.target as HTMLElement;
    if (target.tagName === "IMG" && editor.contains(target)) {
      setSelectedImg(target as HTMLImageElement);
    } else if (selectedImg) {
      setSelectedImg(null);
    }
    const cell = target.closest?.("td,th") as HTMLTableCellElement | null;
    if (!cell || !editor.contains(cell)) return;
    const rect = cell.getBoundingClientRect();
    const table = cell.closest("table") as HTMLTableElement | null;
    if (!table) return;
    if (rect.right - e.clientX < EDGE) {
      e.preventDefault();
      freezeTableWidths(table);
      const idx = cell.cellIndex;
      const cells = Array.from(table.rows)
        .map((r) => r.cells[idx])
        .filter(Boolean) as HTMLTableCellElement[];
      dragRef.current = { kind: "col", cells, startPos: e.clientX, startSize: cell.offsetWidth };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    } else if (rect.bottom - e.clientY < EDGE) {
      e.preventDefault();
      const tr = cell.closest("tr");
      if (!tr) return;
      dragRef.current = { kind: "row", cells: Array.from(tr.cells) as HTMLTableCellElement[], startPos: e.clientY, startSize: cell.offsetHeight };
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    }
  };

  /** 자동 글머리 — "-"/"*"/"1." 뒤 Space 또는 Enter 로 목록 전환(IME 조합 중 제외). */
  const onEditorKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== " " && e.key !== "Enter") return;
    if ((e.nativeEvent as KeyboardEvent).isComposing) return;
    const sel = window.getSelection();
    const node = sel?.anchorNode;
    if (!node) return;
    const el = node instanceof HTMLElement ? node : (node.parentElement ?? null);
    const block = el?.closest?.("div,p,td,li");
    if (!block || block.tagName === "LI" || !innerRef.current?.contains(block)) return;
    const text = (block.textContent ?? "").trim();
    if (text !== "-" && text !== "*" && text !== "1.") return;
    e.preventDefault();
    block.textContent = "";
    const range = document.createRange();
    range.selectNodeContents(block);
    range.collapse(true);
    sel!.removeAllRanges();
    sel!.addRange(range);
    document.execCommand(text === "1." ? "insertOrderedList" : "insertUnorderedList");
    onInput();
  };

  const tableAct = (fn: (cell: HTMLTableCellElement) => void) => {
    if (!activeCell) return;
    fn(activeCell);
    innerRef.current?.focus();
    onInput();
    // 표/행/열 삭제로 셀이 문서에서 떨어져 나갔으면 표 툴바를 닫는다(잔존 버그 수정, G2-14).
    if (!activeCell.isConnected) setActiveCell(null);
  };

  const divider = <span className="w-px h-4 mx-1 shrink-0" style={{ background: "var(--cd-border)" }} />;

  return (
    <div className="flex flex-col">
      {/* 툴바(1줄 통합 — 좁은 폭에서만 자동 줄바꿈. 흰 배경 + 윤곽선, G2-9/10) */}
      <div className="flex items-center gap-0.5 border cd-border-c rounded-t-lg px-1.5 py-1 flex-wrap bg-white">
        <select
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            if (e.target.value) exec("fontName", e.target.value);
            e.target.selectedIndex = 0;
          }}
          className="text-xs cd-text bg-transparent border cd-border-c rounded-md px-1 py-0.5 max-w-[7.5rem]"
          title="글꼴"
          defaultValue=""
        >
          {FONTS.map((f) => (
            <option key={f.label} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <select
          onChange={(e) => {
            const px = Number(e.target.value);
            if (px) applyFontSize(px);
            e.target.selectedIndex = 0;
          }}
          className="text-xs cd-text bg-transparent border cd-border-c rounded-md px-1 py-0.5"
          title="글자 크기"
          defaultValue=""
        >
          <option value="">크기</option>
          {FONT_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}px
            </option>
          ))}
        </select>
        {divider}
        <EBtn label="굵게" onClick={() => exec("bold")}><Bold className="w-3.5 h-3.5" /></EBtn>
        <EBtn label="기울임" onClick={() => exec("italic")}><Italic className="w-3.5 h-3.5" /></EBtn>
        <EBtn label="밑줄" onClick={() => exec("underline")}><UnderlineIcon className="w-3.5 h-3.5" /></EBtn>
        <EBtn label="취소선" onClick={() => exec("strikeThrough")}><Strikethrough className="w-3.5 h-3.5" /></EBtn>
        {/* 위/아래 첨자 — 토글(활성 상태 유지, 재클릭 해제. G2-14) */}
        <EBtn
          label="위 첨자"
          active={supActive}
          onClick={() => {
            exec("superscript");
            setSupActive((v) => !v);
            if (subActive) setSubActive(false);
          }}
        >
          <Superscript className="w-3.5 h-3.5" />
        </EBtn>
        <EBtn
          label="아래 첨자"
          active={subActive}
          onClick={() => {
            exec("subscript");
            setSubActive((v) => !v);
            if (supActive) setSupActive(false);
          }}
        >
          <Subscript className="w-3.5 h-3.5" />
        </EBtn>

        {/* 글자색 */}
        <span className="relative inline-flex" data-tool-popover>
          <EBtn label="글자색" active={toolPopover === "textcolor"} onClick={() => setToolPopover((v) => (v === "textcolor" ? null : "textcolor"))}>
            <Baseline className="w-3.5 h-3.5" />
          </EBtn>
          {toolPopover === "textcolor" && (
            <div className="absolute top-full left-0 mt-1 z-50 rounded-xl border cd-border-c cd-card-bg p-2" style={{ boxShadow: "var(--cd-shadow)" }}>
              <div className="grid grid-cols-6 gap-1">
                {TEXT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      exec("foreColor", c);
                      setToolPopover(null);
                    }}
                    className="w-5 h-5 rounded border cd-border-c"
                    style={{ background: c }}
                    title={c}
                  />
                ))}
              </div>
            </div>
          )}
        </span>
        {divider}
        <EBtn label="왼쪽 정렬" onClick={() => exec("justifyLeft")}><AlignLeft className="w-3.5 h-3.5" /></EBtn>
        <EBtn label="가운데 정렬" onClick={() => exec("justifyCenter")}><AlignCenter className="w-3.5 h-3.5" /></EBtn>
        <EBtn label="오른쪽 정렬" onClick={() => exec("justifyRight")}><AlignRight className="w-3.5 h-3.5" /></EBtn>
        <EBtn label="양쪽 정렬" onClick={() => exec("justifyFull")}><AlignJustify className="w-3.5 h-3.5" /></EBtn>
        {divider}
        <EBtn label="내어쓰기" onClick={() => exec("outdent")}><Outdent className="w-3.5 h-3.5" /></EBtn>
        <EBtn label="들여쓰기" onClick={() => exec("indent")}><Indent className="w-3.5 h-3.5" /></EBtn>

        {/* 줄 간격 */}
        <span className="relative inline-flex" data-tool-popover>
          <EBtn label="줄 간격" active={toolPopover === "lineheight"} onClick={() => setToolPopover((v) => (v === "lineheight" ? null : "lineheight"))}>
            <span className="text-[10px] font-bold leading-none">1.5</span>
          </EBtn>
          {toolPopover === "lineheight" && (
            <div className="absolute top-full left-0 mt-1 z-50 rounded-xl border cd-border-c cd-card-bg p-1.5 flex flex-col" style={{ boxShadow: "var(--cd-shadow)" }}>
              {LINE_HEIGHTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    applyLineHeight(p);
                    setToolPopover(null);
                  }}
                  className="px-3 py-1 rounded-md text-xs cd-text hover:cd-soft-primary text-left whitespace-nowrap"
                >
                  {p}%
                </button>
              ))}
            </div>
          )}
        </span>
        {divider}
        <EBtn label="글머리 목록" onClick={() => exec("insertUnorderedList")}><List className="w-3.5 h-3.5" /></EBtn>
        <EBtn label="번호 목록" onClick={() => exec("insertOrderedList")}><ListOrdered className="w-3.5 h-3.5" /></EBtn>
        {divider}
        <EBtn
          label="링크"
          onClick={() => {
            const url = window.prompt("링크 URL:");
            if (url) exec("createLink", url);
          }}
        >
          <Link2 className="w-3.5 h-3.5" />
        </EBtn>
        <EBtn label="구분선" onClick={() => insertHtml(HR_HTML)}><SeparatorHorizontal className="w-3.5 h-3.5" /></EBtn>
        {onPickImage && (
          <EBtn label="이미지 삽입" onClick={onPickImage}><ImageIcon className="w-3.5 h-3.5" /></EBtn>
        )}
        {divider}

        {/* 기호 삽입 */}
        <span className="relative inline-flex" data-tool-popover>
          <EBtn label="기호 삽입" active={toolPopover === "symbol"} onClick={() => setToolPopover((v) => (v === "symbol" ? null : "symbol"))}>
            <Omega className="w-3.5 h-3.5" />
          </EBtn>
          {toolPopover === "symbol" && <SymbolPalette onInsert={(s) => insertHtml(s)} />}
        </span>

        {/* 표 삽입 */}
        <span className="relative inline-flex" data-tool-popover>
          <EBtn label="표 삽입" active={toolPopover === "table"} onClick={() => setToolPopover((v) => (v === "table" ? null : "table"))}>
            <Table2 className="w-3.5 h-3.5" />
          </EBtn>
          {toolPopover === "table" && (
            <div className="absolute top-full left-0 mt-1 z-50 rounded-xl border cd-border-c cd-card-bg p-2.5" style={{ boxShadow: "var(--cd-shadow)" }}>
              <p className="text-[11px] cd-text-faint mb-1.5 whitespace-nowrap">
                {tableHover.r > 0 ? `${tableHover.r}행 × ${tableHover.c}열 (첫 행 = 머리글)` : "크기를 선택하세요"}
              </p>
              <div className="flex flex-col gap-0.5">
                {Array.from({ length: TABLE_MAX_ROWS }, (_, r) => (
                  <div key={r} className="flex gap-0.5">
                    {Array.from({ length: TABLE_MAX_COLS }, (_, c) => {
                      const on = r < tableHover.r && c < tableHover.c;
                      return (
                        <button
                          key={c}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onMouseEnter={() => setTableHover({ r: r + 1, c: c + 1 })}
                          onClick={() => {
                            insertHtml(buildTableHtml(r + 1, c + 1));
                            setToolPopover(null);
                            setTableHover({ r: 0, c: 0 });
                          }}
                          className="rounded-[3px] border"
                          style={{
                            width: 18,
                            height: 18,
                            borderColor: on ? "var(--cd-primary)" : "var(--cd-border)",
                            background: on ? "var(--cd-primary-soft)" : "transparent",
                          }}
                          aria-label={`${r + 1}x${c + 1} 표`}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </span>

        <div className="flex-1" />
        <span className="text-[11px] cd-text-faint pr-1">{statusText ?? ""}</span>
      </div>

      {/* 표 편집 툴바 — 커서가 표 안에 있을 때만 */}
      {activeCell && (
        <div className="flex items-center gap-0.5 border-x cd-border-c px-1.5 py-1 flex-wrap text-[11px] cd-tint-primary">
          <span className="font-bold mr-1 flex items-center gap-1" style={{ color: "var(--cd-primary)" }}>
            <Table2 className="w-3.5 h-3.5" /> 표
          </span>
          <TableBtn label="위에 행" icon={<><Plus className="w-3 h-3" /><ArrowUp className="w-3 h-3" /></>} onClick={() => tableAct((c) => insertRow(c, "above"))} />
          <TableBtn label="아래 행" icon={<><Plus className="w-3 h-3" /><ArrowDown className="w-3 h-3" /></>} onClick={() => tableAct((c) => insertRow(c, "below"))} />
          <TableBtn label="행 삭제" icon={<><MinusIcon className="w-3 h-3" /><ArrowDown className="w-3 h-3 rotate-90" /></>} onClick={() => tableAct(deleteRow)} danger />
          {divider}
          <TableBtn label="왼쪽 열" icon={<><Plus className="w-3 h-3" /><ArrowLeft className="w-3 h-3" /></>} onClick={() => tableAct((c) => insertCol(c, "left"))} />
          <TableBtn label="오른쪽 열" icon={<><Plus className="w-3 h-3" /><ArrowRight className="w-3 h-3" /></>} onClick={() => tableAct((c) => insertCol(c, "right"))} />
          <TableBtn label="열 삭제" icon={<><MinusIcon className="w-3 h-3" /><ArrowRight className="w-3 h-3 rotate-90" /></>} onClick={() => tableAct(deleteCol)} danger />
          {divider}
          <TableBtn label="너비 같게" icon={<UnfoldHorizontal className="w-3 h-3" />} onClick={() => tableAct(equalizeCols)} />
          <TableBtn label="높이 같게" icon={<UnfoldVertical className="w-3 h-3" />} onClick={() => tableAct(equalizeRows)} />
          {divider}

          {/* 셀 배경색 */}
          <span className="relative inline-flex" data-tool-popover>
            <TableBtn label="셀 배경색" icon={<Paintbrush className="w-3 h-3" />} onClick={() => setToolPopover((v) => (v === "cellcolor" ? null : "cellcolor"))} />
            {toolPopover === "cellcolor" && (
              <div className="absolute top-full left-0 mt-1 z-50 rounded-xl border cd-border-c cd-card-bg p-2" style={{ boxShadow: "var(--cd-shadow)" }}>
                <div className="grid grid-cols-3 gap-1">
                  {CELL_COLORS.map((c) => (
                    <button
                      key={c.label}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        if (activeCell) {
                          activeCell.style.backgroundColor = c.color ?? "";
                          onInput();
                        }
                        setToolPopover(null);
                      }}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] cd-text hover:cd-soft-primary whitespace-nowrap"
                    >
                      <span className="w-4 h-4 rounded border cd-border-c inline-block" style={{ background: c.color ?? "transparent" }} />
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </span>

          {divider}
          <TableBtn label="표 삭제" icon={<Trash2 className="w-3 h-3" />} onClick={() => tableAct((c) => c.closest("table")?.remove())} danger />
          <span className="ml-auto cd-text-faint hidden md:inline">셀 경계를 드래그하면 크기 조절</span>
        </div>
      )}

      {/* 본문 에디터 — 메일 본문은 흰 배경 고정. cd-mail-editor 로 목록 마커/HR 스타일 복원 */}
      <div className="relative">
        <div
          ref={innerRef}
          contentEditable
          onInput={onInput}
          onPaste={onPaste}
          onKeyDown={onEditorKeyDown}
          onMouseMove={onEditorMouseMove}
          onMouseDown={onEditorMouseDown}
          className="cd-mail-editor max-h-[75vh] overflow-y-auto border cd-border-c border-t-0 rounded-b-lg px-3 py-2 text-sm bg-white text-black outline-none focus:border-[color:var(--cd-primary)]"
          style={{ lineHeight: 1.6, minHeight: minHeightPx ?? 634 }}
        />
        {/* 이미지 선택 표시 + 우하단 크기 조절 핸들(드래그하면 비율 유지하며 확대·축소) */}
        {imgBox && (
          <div className="absolute pointer-events-none" style={{ top: imgBox.top, left: imgBox.left, width: imgBox.width, height: imgBox.height }}>
            <div className="absolute inset-0 border-2" style={{ borderColor: "var(--cd-primary)" }} />
            <div
              className="absolute pointer-events-auto rounded-sm border-2 border-white"
              style={{
                right: -6,
                bottom: -6,
                width: 12,
                height: 12,
                background: "var(--cd-primary)",
                cursor: "nwse-resize",
                boxShadow: "0 1px 3px rgba(0,0,0,.3)",
              }}
              onMouseDown={startImgResize}
              title="드래그해서 크기 조절"
            />
          </div>
        )}
      </div>
    </div>
  );
});

/** 툴바 아이콘 버튼(mousedown preventDefault 로 에디터 selection 유지). */
function EBtn({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <CdIconButton label={label} size="sm" active={active} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {children}
    </CdIconButton>
  );
}

function TableBtn({ label, icon, onClick, danger }: { label: string; icon: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={
        "flex items-center gap-0.5 px-1.5 py-1 rounded-md transition-colors " +
        (danger ? "cd-error-text hover:cd-error-bg" : "cd-text-muted hover:text-[color:var(--cd-text)] hover:bg-white/60")
      }
    >
      {icon}
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}
