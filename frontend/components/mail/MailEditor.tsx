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
  Omega, Outdent, Paintbrush, Plus, SeparatorHorizontal, Strikethrough, Subscript, Superscript, Table2,
  TableCellsMerge, TableCellsSplit, Trash2,
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
  // table-layout:fixed(2026-08-24) — auto 레이아웃은 텍스트를 입력할 때마다 그 열이
  // 계속 넓어진다. 고정 레이아웃 + 열 균등 폭으로 만들고, 넘치는 텍스트는 줄바꿈한다.
  const w = `width:${(100 / cols).toFixed(3)}%;`;
  const td = (header: boolean) =>
    `<td style="${header ? HEADER_TD_STYLE : BODY_TD_STYLE}${w}word-break:break-all;">&nbsp;</td>`;
  const tr = (header: boolean) => `<tr>${Array.from({ length: cols }, () => td(header)).join("")}</tr>`;
  const body = Array.from({ length: rows }, (_, i) => tr(i === 0)).join("");
  // 표 폭 92% + 가운데 정렬(2026-08-24 사용자 확정) — 본문 양끝에 붙지 않게 좌우 여백을 둔다.
  return `<table style="border-collapse:collapse;margin:8px auto;width:92%;table-layout:fixed"><tbody>${body}</tbody></table><div><br></div>`;
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
    // 툴바 오른쪽 끝 버튼이라 left 기준으로 펼치면 편집창 밖으로 잘린다 → 오른쪽 끝 정렬.
    <div className="absolute top-full right-0 mt-1 z-50 rounded-xl border cd-border-c cd-card-bg p-2 w-[19rem]" style={{ boxShadow: "var(--cd-shadow)" }}>
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

// ── 셀 다중 선택·병합(2026-08-24) ────────────────────────────────
/** 표를 (행, 열) 그리드로 펼친다 — rowSpan/colSpan 셀은 걸치는 모든 위치에 참조가 들어간다. */
function buildGrid(table: HTMLTableElement): (HTMLTableCellElement | undefined)[][] {
  const grid: (HTMLTableCellElement | undefined)[][] = [];
  for (let r = 0; r < table.rows.length; r++) {
    grid[r] ??= [];
    let c = 0;
    for (const cell of Array.from(table.rows[r].cells)) {
      while (grid[r][c]) c++;
      for (let dr = 0; dr < cell.rowSpan; dr++) {
        for (let dc = 0; dc < cell.colSpan; dc++) {
          (grid[r + dr] ??= [])[c + dc] = cell;
        }
      }
      c += cell.colSpan;
    }
  }
  return grid;
}

/** 셀의 그리드 좌상단 좌표. */
function cellPos(grid: (HTMLTableCellElement | undefined)[][], cell: HTMLTableCellElement): { r: number; c: number } | null {
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < (grid[r]?.length ?? 0); c++) {
      if (grid[r][c] === cell) return { r, c };
    }
  }
  return null;
}

/**
 * anchor~focus 를 감싸는 사각형 범위 — 기병합(span) 셀이 걸치면 그 셀 전체가 들어오도록
 * 범위를 반복 확장한다(닫힘 보장 → 병합 시 항상 완전한 직사각형).
 */
function selectionRect(
  grid: (HTMLTableCellElement | undefined)[][],
  anchor: HTMLTableCellElement,
  focus: HTMLTableCellElement
): { r1: number; c1: number; r2: number; c2: number; cells: HTMLTableCellElement[] } | null {
  const a = cellPos(grid, anchor);
  const f = cellPos(grid, focus);
  if (!a || !f) return null;
  let r1 = Math.min(a.r, f.r);
  let r2 = Math.max(a.r, f.r);
  let c1 = Math.min(a.c, f.c);
  let c2 = Math.max(a.c, f.c);
  for (let pass = 0; pass < 20; pass++) {
    let changed = false;
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        const cell = grid[r]?.[c];
        if (!cell) continue;
        const p = cellPos(grid, cell)!;
        const er2 = p.r + cell.rowSpan - 1;
        const ec2 = p.c + cell.colSpan - 1;
        if (p.r < r1) { r1 = p.r; changed = true; }
        if (p.c < c1) { c1 = p.c; changed = true; }
        if (er2 > r2) { r2 = er2; changed = true; }
        if (ec2 > c2) { c2 = ec2; changed = true; }
      }
    }
    if (!changed) break;
  }
  const cells: HTMLTableCellElement[] = [];
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const cell = grid[r]?.[c];
      if (cell && !cells.includes(cell)) cells.push(cell);
    }
  }
  return { r1, c1, r2, c2, cells };
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
  // 셀 다중 선택(병합용, 2026-08-24) — 드래그 중 상태와 확정된 선택 사각형.
  const cellDragRef = useRef<{ anchor: HTMLTableCellElement; table: HTMLTableElement; multi: boolean } | null>(null);
  const cellSelRef = useRef<{ table: HTMLTableElement; rect: { r1: number; c1: number; r2: number; c2: number }; cells: HTMLTableCellElement[] } | null>(null);
  const [selCellCount, setSelCellCount] = useState(0);
  /** 직전 붙여넣기의 클립보드 이미지 파일 — 외부 URL 수집 실패 시 대체 소스로 쓴다. */
  const pastedImageFiles = useRef<File[]>([]);
  /** 크기 조절 중인 이미지(선택 상태) + 핸들 위치. */
  const [selectedImg, setSelectedImg] = useState<HTMLImageElement | null>(null);
  const [imgBox, setImgBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const imgDragRef = useRef<{ startX: number; startW: number; ratio: number } | null>(null);

  /** 정렬 명령 ↔ text-align 값 — 셀 다중 선택 상태의 일괄 정렬에 쓴다(2026-08-24). */
  const JUSTIFY_ALIGN: Record<string, string> = {
    justifyLeft: "left",
    justifyCenter: "center",
    justifyRight: "right",
    justifyFull: "justify",
  };

  const exec = (cmd: string, value?: string) => {
    // 셀 다중 선택 중 정렬 — 브라우저 selection 이 없어 execCommand 가 무시되므로
    // 선택된 셀들에 text-align 을 직접 건다(셀 내부 블록의 개별 정렬은 초기화해 상속시킨다).
    const align = JUSTIFY_ALIGN[cmd];
    if (align && cellSelRef.current && cellSelRef.current.cells.length > 0) {
      for (const cell of cellSelRef.current.cells) {
        cell.style.textAlign = align;
        for (const b of Array.from(cell.querySelectorAll<HTMLElement>("div,p"))) b.style.textAlign = "";
      }
      onInput();
      return;
    }
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
      // 셀 다중 선택 중에는 브라우저 selection 이 비어 있다 — 활성 셀(anchor)을 유지한다.
      if (cellSelRef.current || cellDragRef.current?.multi) return;
      const sel = window.getSelection();
      const node = sel?.anchorNode;
      const el = node instanceof HTMLElement ? node : (node?.parentElement ?? null);
      const cell = (el?.closest?.("td,th") ?? null) as HTMLTableCellElement | null;
      setActiveCell(cell && innerRef.current?.contains(cell) ? cell : null);
      // 기존 문서의 표(auto 레이아웃)는 편집 진입 시 현재 폭으로 고정한다(2026-08-24) —
      // 입력할 때마다 열이 넓어지는 문제의 소급 해소. 신규 표는 삽입부터 fixed.
      if (cell) {
        const table = cell.closest("table") as HTMLTableElement | null;
        if (table && table.style.tableLayout !== "fixed") freezeTableWidths(table);
      }
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

  // ── 셀 다중 선택·병합(2026-08-24) ────────────────────────────
  /** 선택 하이라이트 제거 — data 속성은 저장 HTML 에 남으면 안 되므로 항상 여기로 정리한다. */
  const clearCellSelection = useCallback(() => {
    const editor = innerRef.current;
    if (editor) {
      for (const el of Array.from(editor.querySelectorAll("[data-cell-sel]"))) el.removeAttribute("data-cell-sel");
    }
    cellSelRef.current = null;
    setSelCellCount(0);
  }, []);

  /** anchor~focus 사각형 범위를 계산해 하이라이트한다(드래그 중 반복 호출). */
  const applyCellSelection = useCallback((anchor: HTMLTableCellElement, focus: HTMLTableCellElement) => {
    const table = anchor.closest("table") as HTMLTableElement | null;
    if (!table || focus.closest("table") !== table) return;
    const grid = buildGrid(table);
    const rect = selectionRect(grid, anchor, focus);
    if (!rect) return;
    const editor = innerRef.current;
    if (editor) {
      for (const el of Array.from(editor.querySelectorAll("[data-cell-sel]"))) el.removeAttribute("data-cell-sel");
    }
    for (const cell of rect.cells) cell.setAttribute("data-cell-sel", "1");
    cellSelRef.current = { table, rect: { r1: rect.r1, c1: rect.c1, r2: rect.r2, c2: rect.c2 }, cells: rect.cells };
    setSelCellCount(rect.cells.length);
  }, []);

  /** 선택 사각형을 한 셀로 병합 — 내용은 위→아래·왼→오른 순서로 <br> 이어붙인다. */
  const mergeSelectedCells = useCallback(() => {
    const sel = cellSelRef.current;
    if (!sel || sel.cells.length < 2) return;
    const grid = buildGrid(sel.table);
    const { r1, c1, r2, c2 } = sel.rect;
    const first = grid[r1]?.[c1];
    if (!first) return;
    const parts: string[] = [];
    const removed = new Set<HTMLTableCellElement>([first]);
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        const cell = grid[r]?.[c];
        if (!cell || removed.has(cell)) continue;
        removed.add(cell);
        const text = (cell.textContent ?? "").replace(/ /g, " ").trim();
        if (text) parts.push(cell.innerHTML);
        cell.remove();
      }
    }
    const firstText = (first.textContent ?? "").replace(/ /g, " ").trim();
    if (parts.length) first.innerHTML = [firstText ? first.innerHTML : null, ...parts].filter(Boolean).join("<br>");
    first.rowSpan = r2 - r1 + 1;
    first.colSpan = c2 - c1 + 1;
    // 고정 레이아웃에서 병합 셀의 px/% 폭이 남으면 열 폭 배분이 왜곡된다 — span 에 맡긴다.
    if (first.colSpan > 1) first.style.removeProperty("width");
    // 한 행의 셀이 전부 병합돼 빈 <tr> 이 남으면 제거하고 rowSpan 을 그만큼 줄인다.
    for (const tr of Array.from(sel.table.rows)) {
      if (tr.cells.length === 0) {
        tr.remove();
        first.rowSpan = Math.max(1, first.rowSpan - 1);
      }
    }
    clearCellSelection();
    setActiveCell(first);
    innerRef.current?.focus();
    onInput();
  }, [clearCellSelection, onInput]);

  /** 병합 해제 — span 을 1 로 되돌리고 비는 자리마다 새 셀을 만든다. */
  const unmergeActiveCell = useCallback(() => {
    const cell = activeCell;
    const table = cell?.closest("table") as HTMLTableElement | null;
    if (!cell || !table || (cell.rowSpan <= 1 && cell.colSpan <= 1)) return;
    const grid = buildGrid(table);
    const pos = cellPos(grid, cell);
    if (!pos) return;
    const rs = cell.rowSpan;
    const cs = cell.colSpan;
    // 행마다 삽입 기준(범위 오른쪽 첫 셀)을 병합 해제 전 그리드에서 미리 구한다.
    const anchors: (HTMLTableCellElement | null)[] = [];
    for (let r = pos.r; r < pos.r + rs; r++) {
      let next: HTMLTableCellElement | null = null;
      for (let c = pos.c + cs; c < (grid[r]?.length ?? 0); c++) {
        const cand = grid[r]?.[c];
        if (cand && cellPos(grid, cand)?.r === r) {
          next = cand;
          break;
        }
      }
      anchors[r - pos.r] = next;
    }
    cell.rowSpan = 1;
    cell.colSpan = 1;
    const style = `${BODY_TD_STYLE}word-break:break-all;`;
    for (let r = pos.r; r < pos.r + rs; r++) {
      const tr = table.rows[r];
      if (!tr) continue;
      const count = r === pos.r ? cs - 1 : cs;
      let ref: HTMLTableCellElement | Element | null = r === pos.r ? cell : null;
      for (let i = 0; i < count; i++) {
        const td = document.createElement("td");
        td.setAttribute("style", style);
        td.innerHTML = "&nbsp;";
        const next = anchors[r - pos.r];
        if (ref) ref.after(td);
        else if (next) next.before(td);
        else tr.appendChild(td);
        ref = td;
      }
    }
    clearCellSelection();
    innerRef.current?.focus();
    onInput();
  }, [activeCell, clearCellSelection, onInput]);

  // 드래그 종료(선택은 유지) — 에디터 밖에서 놓아도 잡히게 document 레벨.
  useEffect(() => {
    const onUp = () => {
      if (!cellDragRef.current) return;
      const wasMulti = cellDragRef.current.multi;
      const anchor = cellDragRef.current.anchor;
      cellDragRef.current = null;
      document.body.style.userSelect = "";
      // 다중 선택이면 브라우저 selection 이 없어 표 툴바가 닫히므로 anchor 를 활성 셀로 유지.
      if (wasMulti) setActiveCell(anchor.isConnected ? anchor : null);
    };
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, []);

  const onEditorMouseMove = (e: React.MouseEvent) => {
    if (dragRef.current) return;
    const editor = innerRef.current;
    if (!editor) return;
    const cell = (e.target as HTMLElement).closest?.("td,th") as HTMLTableCellElement | null;
    // 셀 드래그 선택 — anchor 와 다른 셀로 끌면 다중 선택 모드로 전환(텍스트 선택 대신).
    const cellDrag = cellDragRef.current;
    if (cellDrag && cell && editor.contains(cell) && cell.closest("table") === cellDrag.table) {
      if (!cellDrag.multi && cell !== cellDrag.anchor) {
        cellDrag.multi = true;
        document.body.style.userSelect = "none";
      }
      if (cellDrag.multi) {
        e.preventDefault();
        window.getSelection()?.removeAllRanges();
        applyCellSelection(cellDrag.anchor, cell);
        return;
      }
    }
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
    // 새 클릭이 시작되면 이전 셀 다중 선택은 해제한다(표 밖 클릭 포함).
    if (cellSelRef.current) clearCellSelection();
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
    } else if (e.button === 0) {
      // 셀 안 좌클릭 — 다른 셀로 드래그하면 다중 선택으로 전환한다(병합용, 2026-08-24).
      cellDragRef.current = { anchor: cell, table, multi: false };
    }
  };

  /** 자동 글머리 — "-"/"*"/"1." 뒤 Space 또는 Enter 로 목록 전환(IME 조합 중 제외). */
  const onEditorKeyDown = (e: React.KeyboardEvent) => {
    // Alt+방향키 = 셀 크기 조절(2026-08-24, 한글 워드프로세서 관례) — 커서 셀 또는
    // 드래그로 선택한 복수 셀이 걸친 열 너비(←→)·행 높이(↑↓)를 한 단계씩 조절한다.
    // 방향키 단독은 커서 이동이라 Alt 조합만 가로챈다. 선택 해제 로직보다 먼저 처리.
    if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const targets = cellSelRef.current?.cells.length ? cellSelRef.current.cells : activeCell ? [activeCell] : [];
      const table = targets[0]?.closest("table") as HTMLTableElement | null;
      if (targets.length && table && innerRef.current?.contains(table)) {
        e.preventDefault();
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          freezeTableWidths(table);
          const delta = e.key === "ArrowRight" ? 8 : -8;
          const grid = buildGrid(table);
          const cols = new Set<number>();
          for (const cell of targets) {
            const p = cellPos(grid, cell);
            if (p) for (let c = p.c; c < p.c + cell.colSpan; c++) cols.add(c);
          }
          for (const c of cols) {
            for (let r = 0; r < grid.length; r++) {
              const cell = grid[r]?.[c];
              if (!cell) continue;
              const p = cellPos(grid, cell)!;
              // 열 폭은 그 열에서 시작하는 단일 폭 셀에만 건다(병합 셀은 span 이 배분).
              if (p.c !== c || cell.colSpan > 1) continue;
              cell.style.width = `${Math.max(36, cell.offsetWidth + delta)}px`;
            }
          }
        } else {
          const delta = e.key === "ArrowDown" ? 4 : -4;
          const rows = new Set<HTMLTableRowElement>();
          for (const cell of targets) {
            const tr = cell.closest("tr");
            if (tr) rows.add(tr);
          }
          for (const tr of rows) {
            for (const td of Array.from(tr.cells)) {
              td.style.height = `${Math.max(24, td.offsetHeight + delta)}px`;
            }
          }
        }
        onInput();
        return;
      }
    }
    // 셀 다중 선택 중 키 입력 — 하이라이트 속성이 저장 HTML 에 남지 않게 먼저 해제.
    if (cellSelRef.current && e.key !== "Shift" && e.key !== "Control" && e.key !== "Alt") clearCellSelection();
    if ((e.nativeEvent as KeyboardEvent).isComposing) return;
    // 목록 항목 맨 앞에서 Backspace = 글번호 제거(2026-08-24) — 기본 동작(이전 항목과 병합,
    // 번호는 그대로 남음) 대신 그 항목을 목록에서 빼 일반 문단으로 되돌린다.
    if (e.key === "Backspace") {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && sel.isCollapsed) {
        const node = sel.anchorNode;
        const el2 = node instanceof HTMLElement ? node : (node?.parentElement ?? null);
        const li = el2?.closest?.("li");
        if (li && innerRef.current?.contains(li)) {
          const probe = document.createRange();
          probe.selectNodeContents(li);
          probe.collapse(true);
          if (sel.getRangeAt(0).compareBoundaryPoints(Range.START_TO_START, probe) === 0) {
            e.preventDefault();
            document.execCommand("outdent");
            onInput();
            return;
          }
        }
      }
    }
    if (e.key !== " " && e.key !== "Enter") return;
    const sel = window.getSelection();
    const node = sel?.anchorNode;
    if (!node) return;
    const el = node instanceof HTMLElement ? node : (node.parentElement ?? null);
    const block = el?.closest?.("div,p,td,li");
    if (!block || !innerRef.current?.contains(block)) return;
    // "- 아 래 -" 표기(공문 관용구) 다음 줄에는 번호 목록을 이어가지 않는다(2026-08-24) —
    // 목록 항목이든 목록 사이 문단이든, Enter 시 목록 밖 새 문단으로 빠져나온다.
    if (e.key === "Enter") {
      const compact = (block.textContent ?? "").replace(/[\s ]/g, "");
      if (block !== innerRef.current && /^[-–—―]?아래[-–—―]?$/.test(compact)) {
        e.preventDefault();
        const li = block.closest("li");
        const host = (li?.closest("ol,ul") ?? block) as HTMLElement;
        const next = document.createElement("div");
        next.innerHTML = "<br>";
        host.after(next);
        const range = document.createRange();
        range.selectNodeContents(next);
        range.collapse(true);
        sel!.removeAllRanges();
        sel!.addRange(range);
        onInput();
        return;
      }
    }
    if (block.tagName === "LI") return;
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
    // 행/열/표 삭제로 선택 셀이 문서에서 떨어질 수 있다 — 다중 선택은 먼저 해제.
    if (cellSelRef.current) clearCellSelection();
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
            // 기호 팔레트와 같은 이유로 오른쪽 끝 정렬(툴바 마지막 버튼 — left 기준이면 잘린다).
            <div className="absolute top-full right-0 mt-1 z-50 rounded-xl border cd-border-c cd-card-bg p-2.5" style={{ boxShadow: "var(--cd-shadow)" }}>
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
          {/* 셀 병합(2026-08-24) — 셀에서 드래그해 여러 셀을 선택한 뒤 누른다. */}
          <TableBtn
            label={selCellCount > 1 ? `셀 병합(${selCellCount})` : "셀 병합"}
            icon={<TableCellsMerge className="w-3 h-3" />}
            onClick={mergeSelectedCells}
            disabled={selCellCount < 2}
          />
          {(activeCell.rowSpan > 1 || activeCell.colSpan > 1) && (
            <TableBtn label="병합 해제" icon={<TableCellsSplit className="w-3 h-3" />} onClick={unmergeActiveCell} />
          )}
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
                        // 다중 선택 중이면 선택 셀 전체, 아니면 커서 셀 하나(2026-08-24)
                        const targets = cellSelRef.current?.cells.length ? cellSelRef.current.cells : activeCell ? [activeCell] : [];
                        for (const cell of targets) cell.style.backgroundColor = c.color ?? "";
                        if (targets.length) onInput();
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
          <span className="ml-auto cd-text-faint hidden md:inline">
            {selCellCount > 1
              ? `${selCellCount}개 셀 선택됨 — 셀 병합 또는 Alt+방향키로 크기 조절`
              : "셀 경계 드래그 = 크기 조절 · 셀에서 드래그 = 다중 선택 · Alt+방향키 = 셀 크기"}
          </span>
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

function TableBtn({ label, icon, onClick, danger, disabled }: { label: string; icon: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={
        "flex items-center gap-0.5 px-1.5 py-1 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed " +
        (danger ? "cd-error-text hover:cd-error-bg" : "cd-text-muted hover:text-[color:var(--cd-text)] hover:bg-white/60")
      }
    >
      {icon}
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}
