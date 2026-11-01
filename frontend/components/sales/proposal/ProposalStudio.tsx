"use client";

// 용역 제안서 스튜디오 2.0 — 왼쪽 장·쪽 목록 / 가운데 A4 미리보기(블록 선택·더블클릭 글 고치기) / 오른쪽 속성.
// 지면 디자인은 ProposalPages(미리보기)와 lib/proposal/hwpx.ts(한글)가 같은 토큰으로 그린다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSession } from "next-auth/react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Copy, Download, FilePlus2, FileText, ImagePlus, ListPlus, Plus, Redo2, Save, Search, Send, Sparkles, Trash2, Undo2, X } from "lucide-react";
import { getFontEmbedCSS, toPng } from "html-to-image";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdHelp } from "@/components/cdash/CdHelp";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { hasPerm, permsOf } from "@/lib/auth/perms";
import { INFO_TYPE_META, defaultVariant, type InfoSpec, type InfoType } from "@/lib/catalog/render/infographic/types";
import { matchInfographic } from "@/lib/catalog/render/infographic/match";
import { ProposalPages, proposalFrameCss } from "./ProposalPages";
import { materializeDocument, PROPOSAL_VARIABLE_LABELS } from "@/lib/proposal/materialize";
import { createProposalTemplate, PROPOSAL_TEMPLATES } from "@/lib/proposal/templates";
import { optionsOf, type BulletItem, type CardItem, type ProposalBlock, type ProposalBlockKind, type ProposalDocument, type ProposalSection } from "@/lib/proposal/types";
import { NEUTRAL, PROPOSAL_THEMES, SERIES_LABEL, chaptersOf, contrast, isHexColor, paletteOf, seriesOf, type SeriesPalette, type ThemePalette } from "@/lib/proposal/design";
import { physicalPages } from "@/lib/proposal/layout";
import { validateProposalForPublication } from "@/lib/proposal/validate";
import { COVER_ART_ID, DIVIDER_ART_ID } from "@/lib/proposal/art";
import { DIAGRAM_ICON_NAMES, DIAGRAM_META, DIAGRAM_TYPES, ORG_GROUPS, type DiagramKind, type DiagramSpec } from "@/lib/proposal/diagrams/types";
import {
  BLOCK_LABEL, BLOCK_PALETTE, History, bulletAction, cloneBlock, convertBlock, conversions, defaultDiagram, findBlock, getAtPath, insertSectionAfter, insertTableRow, makeBlock,
  moveItem, moveTableColumn, newId, pushLastBlockToNextPage, setAtPath, updateBlock, updateSection, type BulletAction,
} from "@/lib/proposal/edit";
import { fieldLabel, findMatches, pendingItems, replaceMatches, type FindMatch, type PendingItem, type TextField } from "@/lib/proposal/find";
import { pageOverflows } from "@/lib/proposal/measure";
import { outlineLabel } from "@/lib/proposal/text";
import { ProposalAiPanel, type AiTarget } from "./ProposalAiPanel";
import { frameDocument, loadStudioKit, type StudioKit } from "../catalog/studio/kit";
import "@/components/cdash/cdash.css";
import "./proposal.css";

type DocumentRow = { id: string; title: string; client?: string; templateId?: string; updatedAt?: string; rev?: number };
type Edition = { id: string; revision: number; fileName: string; createdAt: string; sizeBytes: number };
type Saved = { document: ProposalDocument; rev: number };
const json = (value: unknown) => JSON.stringify(value);
const PT = 72 / 25.4;
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : typeof data.detail === "string" ? data.detail : `요청 실패 (${response.status})`);
  return data as T;
}
const blockSummary = (b: ProposalBlock): string => {
  switch (b.kind) {
    case "heading": case "text": case "lead": return b.text;
    case "bullets": return b.items[0]?.text ?? "";
    case "callout": return b.title + " " + b.text;
    case "stage": return `${b.label} ${b.text}`;
    case "cards": case "steps": return b.items.map((x) => x.title).join(" · ");
    case "kpis": return b.items.map((x) => x.value + (x.unit ?? "")).join(" · ");
    default: return "title" in b ? b.title : "";
  }
};

// ── 미리보기 ─────────────────────────────────────────────────────────────────
interface EditTarget { sid: string; bid: string; path: string; rect: { x: number; y: number; w: number; h: number }; fontSize: number; value: string; multiline: boolean; bullet: number | null }
type FieldRef = Pick<TextField, "sid" | "bid" | "path">;
const editKey = (f: FieldRef) => `${f.sid}|${f.bid}|${f.path}`;
/** 미리보기 틀 안에서만 굴린다 — scrollIntoView 는 바깥 화면까지 굴려 상단 바를 가린다. */
function scrollFrame(el: HTMLElement, at: "start" | "center") {
  const win = el.ownerDocument.defaultView;
  if (!win) return;
  const r = el.getBoundingClientRect();
  win.scrollBy({ top: at === "start" ? r.top : r.top + r.height / 2 - win.innerHeight / 2 });
}
function Canvas({ doc, kit, frameRef, zoom, selSection, selBlock, scrollKey, hit, onSelect, onEdit, onBullet, onOverflow }: {
  doc: ProposalDocument; kit: StudioKit; frameRef: React.RefObject<HTMLIFrameElement | null>; zoom: number; selSection: string; selBlock: string; scrollKey: number; hit: FieldRef | null;
  onSelect: (sid: string, bid: string) => void; onEdit: (sid: string, bid: string, path: string, value: string) => void; onOverflow: (ids: string[]) => void;
  /** 개조식 줄 단축키 — 다음에 열 줄 번호를 돌려준다 */
  onBullet: (sid: string, bid: string, index: number, value: string, action: BulletAction) => number | null;
}) {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const docRef = useRef(doc); docRef.current = doc;
  const reopen = useRef<FieldRef | null>(null);
  const closing = useRef(false);
  const pal = paletteOf(doc);
  const srcDoc = useMemo(() => frameDocument(kit, "pretendard", { extraCss: proposalFrameCss(pal) }), [kit, pal.primary, pal.primary2, pal.accent, pal.tint, pal.tint2, pal.line]); // eslint-disable-line react-hooks/exhaustive-deps
  // 쪽 넘침 검사
  useEffect(() => {
    if (!mount) return;
    const check = () => {
      const ids: string[] = [];
      mount.querySelectorAll<HTMLElement>("article[data-section]").forEach((page) => {
        const over = pageOverflows(page);
        page.dataset.overflow = String(over);
        if (over) ids.push(page.dataset.section || "");
      });
      onOverflow(ids);
    };
    const t = setTimeout(check, 30);
    const ro = new ResizeObserver(check);
    mount.querySelectorAll(".pp-flow").forEach((el) => ro.observe(el));
    void frameRef.current?.contentDocument?.fonts.ready.then(check);
    return () => { clearTimeout(t); ro.disconnect(); };
  }, [mount, doc, onOverflow, frameRef]);
  // 선택한 쪽으로 이동(목록에서 고를 때)
  useEffect(() => {
    if (!mount) return;
    const target = mount.querySelector<HTMLElement>(`article[data-page="${selSection || "cover"}"]`);
    if (target) scrollFrame(target, "start");
  }, [mount, scrollKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // 겹친 입력창 열기 — 더블클릭과 개조식 단축키(다음 줄 열기)가 같이 쓴다.
  const openEditor = (el: HTMLElement) => {
    const fd = frameRef.current?.contentDocument;
    if (!fd || !wrapRef.current || !frameRef.current) return;
    const [sid, bid, path] = (el.dataset.edit || "").split("|");
    const r = el.getBoundingClientRect();
    const fr = frameRef.current.getBoundingClientRect(), wr = wrapRef.current.getBoundingClientRect();
    const fs = parseFloat(fd.defaultView?.getComputedStyle(el).fontSize || "12");
    const multiline = /^(text|summary|items\.\d+\.(text|body)|rows\.\d+\.\d+|note)$/.test(path) || path === "text";
    const bm = /^items\.(\d+)\.text$/.exec(path);
    const bullet = bm && findBlock(docRef.current, bid)?.block.kind === "bullets" ? Number(bm[1]) : null;
    closing.current = false;
    setEdit({ sid, bid, path, value: getAtPath(docRef.current, sid, bid, path), multiline, bullet, fontSize: Math.max(12, fs * zoom),
      rect: { x: fr.left - wr.left + r.left, y: fr.top - wr.top + r.top, w: Math.max(160, r.width + 8), h: Math.max(28, r.height + 8) } });
  };
  const fieldEl = (f: FieldRef) => mount?.querySelector<HTMLElement>(`[data-edit="${CSS.escape(editKey(f))}"]`) ?? null;
  // 클릭 = 선택, 더블클릭 = 그 자리 글 고치기(겹친 입력창)
  useEffect(() => {
    const fd = frameRef.current?.contentDocument;
    if (!mount || !fd) return;
    const click = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      const page = t.closest<HTMLElement>("article[data-page]");
      const blk = t.closest<HTMLElement>("[data-block]");
      const sid = page?.dataset.section ?? (page?.dataset.page === "cover" || page?.dataset.page === "toc" ? "" : "");
      onSelect(sid, blk?.dataset.block ?? "");
    };
    const dbl = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-edit]");
      if (!el) return;
      openEditor(el);
      e.preventDefault();
    };
    fd.addEventListener("click", click);
    fd.addEventListener("dblclick", dbl);
    return () => { fd.removeEventListener("click", click); fd.removeEventListener("dblclick", dbl); };
  }, [mount, frameRef, onSelect, zoom]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { mount?.style.setProperty("--pp-zoom", String(zoom)); const root = mount?.querySelector<HTMLElement>(".pp-root"); root?.style.setProperty("--pp-zoom", String(zoom)); }, [mount, zoom, doc]);
  // 개조식 단축키 뒤 — 다시 그린 줄에 입력창을 연다
  useEffect(() => {
    const r = reopen.current;
    if (!r || !mount) return;
    reopen.current = null;
    const el = fieldEl(r);
    if (el) openEditor(el);
  }, [mount, doc]); // eslint-disable-line react-hooks/exhaustive-deps
  // 찾기·작성 필요 목록에서 고른 칸 — 강조하고 화면 가운데로
  useEffect(() => {
    if (!mount) return;
    mount.querySelectorAll("[data-hit]").forEach((el) => el.removeAttribute("data-hit"));
    if (!hit || hit.bid === "_doc") return;
    const el = fieldEl(hit);
    if (el) { el.setAttribute("data-hit", "true"); scrollFrame(el, "center"); }
  }, [mount, hit, doc]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (value: string | null) => { if (closing.current) return; closing.current = true; if (edit && value !== null && value !== edit.value) onEdit(edit.sid, edit.bid, edit.path, value.replace(/\r/g, "")); setEdit(null); };
  const bulletKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!edit || edit.bullet === null) return false;
    const value = e.currentTarget.value.replace(/\r/g, "");
    const action: BulletAction | null = e.key === "Enter" && e.altKey ? "insert" : e.key === "Tab" ? (e.shiftKey ? "outdent" : "indent") : e.key === "Backspace" && value === "" ? "remove" : null;
    if (!action) return false;
    e.preventDefault();
    closing.current = true;
    const focus = onBullet(edit.sid, edit.bid, edit.bullet, value, action);
    setEdit(null);
    if (focus !== null) reopen.current = { sid: edit.sid, bid: edit.bid, path: `items.${focus}.text` };
    return true;
  };
  return (
    <div className="proposal-canvas" ref={wrapRef}>
      <iframe ref={frameRef} title="제안서 A4 미리보기" srcDoc={srcDoc} onLoad={() => setMount(frameRef.current?.contentDocument?.getElementById("st-root") ?? null)} />
      {mount && createPortal(<ProposalPages document={doc} selectedBlock={selBlock} currentSection={selSection} />, mount)}
      {edit ? <>
        <textarea autoFocus className="proposal-inline-edit" defaultValue={edit.value} aria-label="선택한 글 고치기"
          style={{ left: edit.rect.x - 4, top: edit.rect.y - 4, width: edit.rect.w, height: edit.multiline ? Math.max(edit.rect.h, 64) : edit.rect.h, fontSize: edit.fontSize }}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => { if (bulletKey(e)) return; if (e.key === "Escape") { e.preventDefault(); commit(null); } if (e.key === "Enter" && (!edit.multiline || e.ctrlKey)) { e.preventDefault(); commit(e.currentTarget.value); } }} />
        <div className="proposal-inline-hint" style={{ left: edit.rect.x - 4, top: Math.max(0, edit.rect.y - 26) }}>{edit.bullet !== null ? "Ctrl+Enter 적용 · Alt+Enter 새 줄 · Tab 단계 · Esc 취소" : edit.multiline ? "Ctrl+Enter 적용 · Esc 취소 · **굵게**" : "Enter 적용 · Esc 취소"}</div>
      </> : null}
    </div>
  );
}

// ── 속성 편집 부품 ───────────────────────────────────────────────────────────
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="f">{label}{children}</label>;
const TA = ({ value, onChange, rows = 3, placeholder }: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) =>
  <textarea className="cd-input" rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
const IN = ({ value, onChange, placeholder, type = "text" }: { value: string | number; onChange: (v: string) => void; placeholder?: string; type?: string }) =>
  <input className="cd-input" type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
function Chips<T extends string | number>({ value, options, onChange }: { value: T; options: Array<{ v: T; label: string }>; onChange: (v: T) => void }) {
  return <div className="chips">{options.map((o) => <button key={String(o.v)} type="button" className={o.v === value ? "on" : ""} onClick={() => onChange(o.v)}>{o.label}</button>)}</div>;
}
/** 항목 색 — 자동(팔레트 순서) · 현재 팔레트 6색 · 그래파이트 · 직접 고르기 */
function ColorPick({ value, pal, onChange }: { value?: string; pal: ThemePalette; onChange: (c: string | undefined) => void }) {
  const preset = [...(pal.series ?? []), NEUTRAL.graphite, pal.primary].filter((c, i, a) => a.indexOf(c) === i);
  return <div className="color-pick" role="group" aria-label="항목 색">
    <button type="button" className={!value ? "auto on" : "auto"} onClick={() => onChange(undefined)}>자동</button>
    {preset.map((c) => <button key={c} type="button" className={value === c ? "on" : ""} style={{ background: c }} title={c} aria-label={`색 ${c}`} onClick={() => onChange(c)} />)}
    <label className="custom" title="직접 고르기"><input type="color" value={isHexColor(value) ? value : pal.series?.[0] ?? pal.primary} onChange={(e) => onChange(e.target.value.toUpperCase())} aria-label="색 직접 고르기" /></label>
  </div>;
}
function ItemHead({ label, i, n, onMove, onDel }: { label: string; i: number; n: number; onMove: (d: number) => void; onDel: () => void }) {
  return <div className="ih"><span>{label}</span>
    <button type="button" className="icon-btn" aria-label="위로" disabled={i === 0} onClick={() => onMove(-1)}><ArrowUp size={13} /></button>
    <button type="button" className="icon-btn" aria-label="아래로" disabled={i === n - 1} onClick={() => onMove(1)}><ArrowDown size={13} /></button>
    <button type="button" className="icon-btn" aria-label="삭제" onClick={onDel}><Trash2 size={13} /></button></div>;
}

function CardsEditor({ items, onChange, withKey, pal }: { items: CardItem[]; onChange: (items: CardItem[]) => void; withKey?: boolean; pal?: ThemePalette }) {
  return <>{items.map((it, i) => <div className="item-card" key={i}>
    <ItemHead label={`${i + 1}`} i={i} n={items.length} onMove={(d) => onChange(moveItem(items, i, d))} onDel={() => onChange(items.filter((_, k) => k !== i))} />
    <IN value={it.title} onChange={(v) => onChange(items.map((x, k) => (k === i ? { ...x, title: v } : x)))} placeholder="제목" />
    <TA value={it.body} rows={3} onChange={(v) => onChange(items.map((x, k) => (k === i ? { ...x, body: v } : x)))} placeholder="내용(줄바꿈 가능, - 로 시작하면 목록)" />
    {withKey ? <label className="proposal-muted"><input type="checkbox" checked={!!it.key} onChange={(e) => onChange(items.map((x, k) => (k === i ? { ...x, key: e.target.checked || undefined } : x)))} /> 포인트 색으로 강조</label> : null}
    {pal ? <ColorPick value={it.color} pal={pal} onChange={(c) => onChange(items.map((x, k) => (k === i ? { ...x, color: c } : x)))} /> : null}
  </div>)}
  <button type="button" className="cd-btn cd-btn-ghost" onClick={() => onChange([...items, { title: "새 항목", body: "" }])}><Plus size={14} />항목 추가</button></>;
}

function TableEditor({ b, onChange }: { b: Extract<ProposalBlock, { kind: "table" }>; onChange: (b: ProposalBlock) => void }) {
  const set = (patch: Partial<typeof b>) => onChange({ ...b, ...patch });
  return <>
    <Field label="표 제목"><IN value={b.title} onChange={(v) => set({ title: v })} /></Field>
    <Field label="양식"><Chips value={b.style} options={[{ v: "grid", label: "격자형" }, { v: "clean", label: "간결형(세로선 없음)" }, { v: "form", label: "양식형(왼쪽 머리칸)" }]} onChange={(v) => set({ style: v })} /></Field>
    {b.style !== "form" ? <label className="proposal-muted"><input type="checkbox" checked={!!b.firstCol} onChange={(e) => set({ firstCol: e.target.checked || undefined })} /> 첫 열을 구분 칸으로 강조</label> : null}
    <div className="mini-table"><table><thead><tr>{b.columns.map((c, ci) => <th key={ci}><input value={c} aria-label={`${ci + 1}열 머리글`} onChange={(e) => set({ columns: b.columns.map((x, k) => (k === ci ? e.target.value : x)) })} /></th>)}
      <th className="ctl"><button type="button" className="icon-btn" aria-label="열 추가" disabled={b.columns.length >= 12} onClick={() => set({ columns: [...b.columns, "새 열"], rows: b.rows.map((r) => [...r, ""]), widths: undefined })}><Plus size={13} /></button></th></tr></thead>
      <tbody>{b.rows.map((r, ri) => <tr key={ri}>{b.columns.map((_, ci) => <td key={ci}><textarea rows={2} value={r[ci] ?? ""} aria-label={`${ri + 1}행 ${ci + 1}열`} onChange={(e) => set({ rows: b.rows.map((row, k) => (k === ri ? row.map((x, m) => (m === ci ? e.target.value : x)) : row)) })} /></td>)}
        <td className="ctl"><span className="ctl-stack">
          <button type="button" className="icon-btn" aria-label={`${ri + 1}행 위로`} disabled={ri === 0} onClick={() => set({ rows: moveItem(b.rows, ri, -1) })}><ArrowUp size={12} /></button>
          <button type="button" className="icon-btn" aria-label={`${ri + 1}행 아래로`} disabled={ri === b.rows.length - 1} onClick={() => set({ rows: moveItem(b.rows, ri, 1) })}><ArrowDown size={12} /></button>
          <button type="button" className="icon-btn" aria-label={`${ri + 1}행 아래에 행 넣기`} onClick={() => onChange(insertTableRow(b, ri + 1))}><ListPlus size={12} /></button>
          <button type="button" className="icon-btn" aria-label={`${ri + 1}행 삭제`} onClick={() => set({ rows: b.rows.filter((_, k) => k !== ri) })}><Trash2 size={12} /></button>
        </span></td></tr>)}
        <tr><td colSpan={b.columns.length + 1}><button type="button" className="cd-btn cd-btn-ghost" style={{ width: "100%" }} onClick={() => set({ rows: [...b.rows, b.columns.map(() => "")] })}><Plus size={13} />행 추가</button></td></tr></tbody></table></div>
    {b.columns.length > 1 ? <div className="chips">{b.columns.map((c, ci) => <span key={ci} className="col-ctl">
      <button type="button" className="icon-btn" aria-label={`${ci + 1}열 왼쪽으로`} disabled={ci === 0} onClick={() => onChange(moveTableColumn(b, ci, -1))}><ArrowLeft size={12} /></button>
      <button type="button" onClick={() => set({ columns: b.columns.filter((_, k) => k !== ci), rows: b.rows.map((r) => r.filter((_, k) => k !== ci)), widths: undefined })}>‘{c || ci + 1}’ 열 삭제</button>
      <button type="button" className="icon-btn" aria-label={`${ci + 1}열 오른쪽으로`} disabled={ci === b.columns.length - 1} onClick={() => onChange(moveTableColumn(b, ci, 1))}><ArrowRight size={12} /></button>
    </span>)}</div> : null}
    <Field label="열 너비 비율(쉼표, 비우면 자동)"><IN value={b.widths?.join(", ") ?? ""} placeholder="예: 20, 50, 30" onChange={(v) => { const w = v.split(",").map((x) => Number(x.trim())).filter((x) => x > 0); set({ widths: w.length === b.columns.length ? w : undefined }); }} /></Field>
    <Field label="표 아래 주석"><IN value={b.note ?? ""} placeholder="※ 출처·기준일" onChange={(v) => set({ note: v || undefined })} /></Field>
  </>;
}

function GanttEditor({ b, onChange }: { b: Extract<ProposalBlock, { kind: "gantt" }>; onChange: (b: ProposalBlock) => void }) {
  const set = (patch: Partial<typeof b>) => onChange({ ...b, ...patch });
  const n = b.periods.length;
  const opts = b.periods.map((p, i) => <option key={i} value={i}>{p}</option>);
  return <>
    <Field label="일정 제목"><IN value={b.title} onChange={(v) => set({ title: v })} /></Field>
    <div className="two">
      <Field label="기간 수"><IN type="number" value={n} onChange={(v) => { const k = Math.max(1, Math.min(40, Number(v) || 1)); set({ periods: Array.from({ length: k }, (_, i) => b.periods[i] ?? `M${i + 1}`), tasks: b.tasks.map((t) => ({ ...t, start: Math.min(t.start, k - 1), end: Math.min(t.end, k - 1), marks: t.marks?.filter((m) => m < k) })) }); }} /></Field>
      <Field label="기간 이름"><Chips value="" options={[{ v: "M", label: "M1…" }, { v: "월", label: "1월…" }, { v: "주", label: "1주…" }]} onChange={(v) => set({ periods: b.periods.map((_, i) => (v === "M" ? `M${i + 1}` : `${i + 1}${v}`)) })} /></Field>
    </div>
    <div className="proposal-muted">구분 · 과업 · 시작 · 종료 · 색 — 같은 구분이 이어지면 한 칸처럼 보입니다.</div>
    {b.tasks.map((t, i) => <div className="gantt-row" key={i}>
      <input className="cd-input" value={t.group ?? ""} placeholder="구분" onChange={(e) => set({ tasks: b.tasks.map((x, k) => (k === i ? { ...x, group: e.target.value || undefined } : x)) })} />
      <input className="cd-input" value={t.label} placeholder="과업" onChange={(e) => set({ tasks: b.tasks.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} />
      <select className="cd-input" value={t.start} onChange={(e) => set({ tasks: b.tasks.map((x, k) => (k === i ? { ...x, start: Number(e.target.value), end: Math.max(x.end, Number(e.target.value)) } : x)) })}>{opts}</select>
      <select className="cd-input" value={t.end} onChange={(e) => set({ tasks: b.tasks.map((x, k) => (k === i ? { ...x, end: Number(e.target.value), start: Math.min(x.start, Number(e.target.value)) } : x)) })}>{opts}</select>
      <select className="cd-input" value={t.tone ?? "work"} onChange={(e) => set({ tasks: b.tasks.map((x, k) => (k === i ? { ...x, tone: e.target.value as "work" } : x)) })}><option value="work">수행</option><option value="key">핵심</option><option value="report">보고</option></select>
      <span style={{ display: "flex" }}><button type="button" className="icon-btn" aria-label="위로" disabled={!i} onClick={() => set({ tasks: moveItem(b.tasks, i, -1) })}><ArrowUp size={13} /></button><button type="button" className="icon-btn" aria-label="아래로" disabled={i === b.tasks.length - 1} onClick={() => set({ tasks: moveItem(b.tasks, i, 1) })}><ArrowDown size={13} /></button><button type="button" className="icon-btn" aria-label="삭제" onClick={() => set({ tasks: b.tasks.filter((_, k) => k !== i) })}><Trash2 size={13} /></button></span>
    </div>)}
    <button type="button" className="cd-btn cd-btn-ghost" onClick={() => set({ tasks: [...b.tasks, { group: b.tasks[b.tasks.length - 1]?.group, label: "새 과업", start: 0, end: Math.min(1, n - 1) }] })}><Plus size={14} />과업 추가</button>
    <Field label="범례 옆 주석"><IN value={b.note ?? ""} onChange={(v) => set({ note: v || undefined })} placeholder="※ 착수일 기준, 협의에 따라 조정" /></Field>
  </>;
}

function DiagramEditor({ b, onChange, pal }: { b: Extract<ProposalBlock, { kind: "diagram" }>; onChange: (b: ProposalBlock) => void; pal: ThemePalette }) {
  const spec = b.spec; const meta = DIAGRAM_META[spec.kind];
  const setSpec = (patch: Partial<DiagramSpec>) => onChange({ ...b, spec: { ...spec, ...patch } });
  const setItem = (i: number, patch: Partial<DiagramSpec["items"][number]>) => setSpec({ items: spec.items.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
  return <>
    <Field label="캡션"><IN value={b.title} onChange={(v) => onChange({ ...b, title: v })} /></Field>
    <Field label="도식 모양"><div className="chips">{DIAGRAM_TYPES.map((t) => <button key={t.kind} type="button" className={t.kind === spec.kind ? "on" : ""} title={t.use}
      onClick={() => { if (t.kind === spec.kind) return; const keep = spec.items.length >= t.min && spec.items.length <= t.max; const next: DiagramSpec = keep ? { ...spec, kind: t.kind } : defaultDiagram(t.kind as DiagramKind); if (t.center && !next.center) next.center = { label: "가운데 제목" }; onChange({ ...b, spec: next, widthMm: t.size[0], heightMm: t.size[1] }); }}>{t.label}</button>)}</div></Field>
    <p className="proposal-muted">{meta.use} · 항목 {meta.min}~{meta.max}개. 항목 수가 맞으면 모양만 바뀌고 내용은 그대로 둡니다.</p>
    <Field label="색"><Chips value={spec.tone ?? "multi"} options={[{ v: "multi", label: "항목마다 다른 색" }, { v: "theme", label: "테마 단색" }]} onChange={(v) => setSpec({ tone: v === "multi" ? undefined : v })} /></Field>
    <p className="proposal-muted">항목 색은 아래 항목마다 바꿀 수 있습니다. 문서 전체의 다색 팔레트는 표지·문서 설정의 도식 팔레트에서 고릅니다.</p>
    {spec.items.some((it) => it.color) ? <button type="button" className="cd-btn cd-btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => setSpec({ items: spec.items.map(({ color: _c, ...x }) => x) })}>항목 색 모두 자동으로</button> : null}
    <div className="two"><Field label="가로(mm)"><IN type="number" value={b.widthMm} onChange={(v) => onChange({ ...b, widthMm: Math.max(40, Math.min(174, Number(v) || 40)) })} /></Field><Field label="세로(mm)"><IN type="number" value={b.heightMm} onChange={(v) => onChange({ ...b, heightMm: Math.max(20, Math.min(240, Number(v) || 20)) })} /></Field></div>
    {meta.center ? <div className="two"><Field label="가운데 제목"><IN value={spec.center?.label ?? ""} onChange={(v) => setSpec({ center: { ...spec.center, label: v } })} /></Field><Field label="가운데 설명"><IN value={spec.center?.desc ?? ""} onChange={(v) => setSpec({ center: { label: spec.center?.label ?? "", desc: v || undefined } })} /></Field></div> : null}
    {spec.kind === "beforeAfter" || spec.kind === "scatter" ? <div className="two"><Field label={spec.kind === "scatter" ? "계열 a 이름" : "왼쪽 머리"}><IN value={spec.legend?.[0] ?? ""} onChange={(v) => setSpec({ legend: [v, spec.legend?.[1] ?? ""] })} /></Field><Field label={spec.kind === "scatter" ? "계열 b 이름" : "오른쪽 머리"}><IN value={spec.legend?.[1] ?? ""} onChange={(v) => setSpec({ legend: [spec.legend?.[0] ?? "", v] })} /></Field></div> : null}
    {spec.kind === "scatter" ? <div className="two"><Field label="가로축"><IN value={spec.axes?.[0] ?? ""} onChange={(v) => setSpec({ axes: [v, spec.axes?.[1] ?? ""] })} /></Field><Field label="세로축"><IN value={spec.axes?.[1] ?? ""} onChange={(v) => setSpec({ axes: [spec.axes?.[0] ?? "", v] })} /></Field></div> : null}
    {spec.items.map((it, i) => <div className="item-card" key={it.id}>
      <ItemHead label={`${i + 1}`} i={i} n={spec.items.length} onMove={(d) => setSpec({ items: moveItem(spec.items, i, d) })} onDel={() => setSpec({ items: spec.items.filter((_, k) => k !== i) })} />
      <IN value={it.label} onChange={(v) => setItem(i, { label: v })} placeholder="이름" />
      {meta.fields.includes("desc") ? <TA value={it.desc ?? ""} rows={2} onChange={(v) => setItem(i, { desc: v || undefined })} placeholder="설명(줄바꿈 = 목록 줄)" /> : null}
      {meta.fields.includes("ab") ? <div className="two"><TA value={it.a ?? ""} rows={2} onChange={(v) => setItem(i, { a: v })} placeholder={spec.legend?.[0] ?? "이전"} /><TA value={it.b ?? ""} rows={2} onChange={(v) => setItem(i, { b: v })} placeholder={spec.legend?.[1] ?? "이후"} /></div> : null}
      {meta.fields.includes("xy") ? <div className="two"><IN type="number" value={it.x ?? 50} onChange={(v) => setItem(i, { x: Math.max(0, Math.min(100, Number(v) || 0)) })} placeholder="가로 0~100" /><IN type="number" value={it.y ?? 50} onChange={(v) => setItem(i, { y: Math.max(0, Math.min(100, Number(v) || 0)) })} placeholder="세로 0~100" /></div> : null}
      {meta.fields.includes("group") ? <select className="cd-input" value={it.group ?? (spec.kind === "org" ? "unit" : "a")} onChange={(e) => setItem(i, { group: e.target.value })}>
        {spec.kind === "org" ? ORG_GROUPS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>) : <><option value="a">{spec.legend?.[0] || "계열 a"}</option><option value="b">{spec.legend?.[1] || "계열 b"}</option></>}</select> : null}
      {meta.fields.includes("icon") ? <select className="cd-input" value={it.icon ?? ""} onChange={(e) => setItem(i, { icon: e.target.value || undefined })}><option value="">아이콘 자동</option>{DIAGRAM_ICON_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}</select> : null}
      {spec.kind !== "org" || !["top", "left", "right"].includes(it.group || "unit") ? <ColorPick value={it.color} pal={pal} onChange={(c) => setItem(i, { color: c })} /> : null}
    </div>)}
    <button type="button" className="cd-btn cd-btn-ghost" disabled={spec.items.length >= meta.max} onClick={() => setSpec({ items: [...spec.items, { id: newId("i").slice(0, 20), label: "새 항목" }] })}><Plus size={14} />항목 추가</button>
  </>;
}

function FigureEditor({ b, onChange }: { b: Extract<ProposalBlock, { kind: "figure" }>; onChange: (b: ProposalBlock) => void }) {
  const spec = b.spec; const meta = INFO_TYPE_META[spec.type];
  const matching = matchInfographic(spec.content, { box: { w: b.widthMm * PT, h: b.heightMm * PT }, current: spec.type });
  const setSpec = (patch: Partial<InfoSpec>) => onChange({ ...b, spec: { ...spec, ...patch } });
  const items = spec.content.items;
  const setItems = (next: typeof items) => setSpec({ content: { ...spec.content, items: next } });
  return <>
    <Field label="캡션"><IN value={b.title} onChange={(v) => onChange({ ...b, title: v })} /></Field>
    <div className="two"><Field label="유형"><select className="cd-input" value={spec.type} onChange={(e) => { const type = e.target.value as InfoType; setSpec({ type, variant: defaultVariant(type) }); }}>
      {Object.values(INFO_TYPE_META).map((t) => <option key={t.type} value={t.type} disabled={t.type !== spec.type && !matching.candidates.some((c) => c.type === t.type)}>{t.label}</option>)}</select></Field>
      <Field label="배치"><select className="cd-input" value={spec.variant || defaultVariant(spec.type)} onChange={(e) => setSpec({ variant: e.target.value })}>{meta.variants.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select></Field></div>
    <div className="two"><Field label="가로(mm)"><IN type="number" value={b.widthMm} onChange={(v) => onChange({ ...b, widthMm: Math.max(40, Math.min(174, Number(v) || 40)) })} /></Field><Field label="세로(mm)"><IN type="number" value={b.heightMm} onChange={(v) => onChange({ ...b, heightMm: Math.max(20, Math.min(240, Number(v) || 20)) })} /></Field></div>
    <Field label="가운데 제목"><IN value={spec.content.center?.label ?? ""} onChange={(v) => setSpec({ content: { ...spec.content, center: { ...spec.content.center, label: v } } })} /></Field>
    {items.map((it, i) => <div className="item-card" key={it.id}>
      <ItemHead label={`${i + 1}`} i={i} n={items.length} onMove={(d) => setItems(moveItem(items, i, d))} onDel={() => setItems(items.filter((_, k) => k !== i))} />
      <IN value={it.label} onChange={(v) => setItems(items.map((x, k) => (k === i ? { ...x, label: v } : x)))} placeholder="이름" />
      <TA value={it.desc ?? ""} rows={2} onChange={(v) => setItems(items.map((x, k) => (k === i ? { ...x, desc: v || undefined } : x)))} placeholder="설명" />
      {meta.family === "number" ? <div className="two"><IN type="number" value={it.value ?? ""} onChange={(v) => setItems(items.map((x, k) => (k === i ? { ...x, value: v === "" ? undefined : Number(v) } : x)))} placeholder="수치" /><IN value={it.unit ?? ""} onChange={(v) => setItems(items.map((x, k) => (k === i ? { ...x, unit: v || undefined } : x)))} placeholder="단위" /></div> : null}
      {meta.needs === "when" ? <IN value={it.when ?? ""} onChange={(v) => setItems(items.map((x, k) => (k === i ? { ...x, when: v } : x)))} placeholder="시점" /> : null}
    </div>)}
    <button type="button" className="cd-btn cd-btn-ghost" disabled={items.length >= meta.max} onClick={() => setItems([...items, { id: newId("i").slice(0, 20), label: "새 항목", ...(meta.family === "number" ? { value: 0 } : {}), ...(meta.needs === "when" ? { when: "1단계" } : {}) }])}><Plus size={14} />항목 추가</button>
    {matching.blocked.find((c) => c.type === spec.type) ? <p className="proposal-alert">{matching.blocked.find((c) => c.type === spec.type)?.reason}</p> : null}
  </>;
}

function BulletsEditor({ items, onChange }: { items: BulletItem[]; onChange: (items: BulletItem[]) => void }) {
  return <>
    <p className="proposal-muted">수준 1 ○ · 2 - · 3 · 과 참고(※)·결과(⇒)·확인(✓) 기호. **굵게** 로 감싸면 주색 굵은 글자가 됩니다.</p>
    {items.map((it, i) => <div className="bullet-row" key={i}>
      <select className="cd-input" value={it.mark ?? `l${it.level}`} onChange={(e) => { const v = e.target.value; onChange(items.map((x, k) => (k !== i ? x : v.startsWith("l") ? { level: Number(v.slice(1)) as 1, text: x.text } : { level: x.level, text: x.text, mark: v as "note" }))); }}>
        <option value="l1">○ 1단</option><option value="l2">- 2단</option><option value="l3">· 3단</option><option value="note">※ 참고</option><option value="result">⇒ 결과</option><option value="check">✓ 확인</option>
      </select>
      <textarea className="cd-input" rows={Math.min(5, Math.max(1, Math.ceil(it.text.length / 34)))} value={it.text} onChange={(e) => onChange(items.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); const next = [...items]; next.splice(i + 1, 0, { level: it.level, text: "" }); onChange(next); }
          if (e.key === "Tab") { e.preventDefault(); const level = Math.max(1, Math.min(3, it.level + (e.shiftKey ? -1 : 1))) as 1 | 2 | 3; onChange(items.map((x, k) => (k === i ? { ...x, level } : x))); } }} />
      <span style={{ display: "flex", flexDirection: "column" }}><button type="button" className="icon-btn" aria-label="위로" disabled={!i} onClick={() => onChange(moveItem(items, i, -1))}><ArrowUp size={12} /></button><button type="button" className="icon-btn" aria-label="아래로" disabled={i === items.length - 1} onClick={() => onChange(moveItem(items, i, 1))}><ArrowDown size={12} /></button><button type="button" className="icon-btn" aria-label="삭제" onClick={() => onChange(items.filter((_, k) => k !== i))}><Trash2 size={12} /></button></span>
    </div>)}
    <p className="proposal-muted">Enter 새 줄 · Tab/Shift+Tab 단계 · Shift+Enter 줄바꿈</p>
    <button type="button" className="cd-btn cd-btn-ghost" onClick={() => onChange([...items, { level: 1, text: "" }])}><Plus size={14} />줄 추가</button>
  </>;
}

function BlockFields({ b, onChange, pal }: { b: ProposalBlock; onChange: (b: ProposalBlock) => void; pal: ThemePalette }) {
  switch (b.kind) {
    case "heading": return <><Field label="단계"><Chips value={b.level} options={[{ v: 1, label: "1. 절 제목" }, { v: 2, label: "1.1 항 제목" }, { v: 3, label: "□ 소제목" }]} onChange={(v) => onChange({ ...b, level: v as 1 | 2 | 3 })} /></Field><Field label="제목"><IN value={b.text} onChange={(v) => onChange({ ...b, text: v })} /></Field></>;
    case "text": return <Field label="본문 — **굵게** 는 주색 굵은 글자"><TA value={b.text} rows={8} onChange={(v) => onChange({ ...b, text: v })} /></Field>;
    case "bullets": return <BulletsEditor items={b.items} onChange={(items) => onChange({ ...b, items })} />;
    case "lead": return <><Field label="라벨(선택)"><IN value={b.label ?? ""} placeholder="예: 핵심" onChange={(v) => onChange({ ...b, label: v || undefined })} /></Field><Field label="핵심 메시지"><TA value={b.text} rows={3} onChange={(v) => onChange({ ...b, text: v })} /></Field></>;
    case "callout": return <><Field label="종류"><Chips value={b.variant} options={[{ v: "note", label: "참고 상자" }, { v: "point", label: "포인트 상자" }]} onChange={(v) => onChange({ ...b, variant: v, title: b.title || (v === "point" ? "POINT" : "참고") })} /></Field><Field label="머리"><IN value={b.title} onChange={(v) => onChange({ ...b, title: v })} /></Field><Field label="내용"><TA value={b.text} rows={5} onChange={(v) => onChange({ ...b, text: v })} /></Field></>;
    case "stage": return <div className="two"><Field label="라벨"><IN value={b.label} onChange={(v) => onChange({ ...b, label: v })} /></Field><Field label="이름"><IN value={b.text} onChange={(v) => onChange({ ...b, text: v })} /></Field></div>;
    case "cards": return <><Field label="열 수"><Chips value={b.columns} options={[{ v: 2, label: "2열" }, { v: 3, label: "3열" }, { v: 4, label: "4열" }]} onChange={(v) => onChange({ ...b, columns: v as 2 })} /></Field><label className="proposal-muted"><input type="checkbox" checked={b.numbered} onChange={(e) => onChange({ ...b, numbered: e.target.checked })} /> 01·02 번호</label><label className="proposal-muted"><input type="checkbox" checked={!!b.multi} onChange={(e) => onChange({ ...b, multi: e.target.checked || undefined })} /> 항목마다 다른 색</label><CardsEditor items={b.items} withKey pal={pal} onChange={(items) => onChange({ ...b, items })} /></>;
    case "steps": return <><p className="proposal-muted">2~6단계를 한 줄 흐름으로 그립니다. 더 많으면 표나 도식(단계 화살표)을 쓰세요.</p><label className="proposal-muted"><input type="checkbox" checked={!!b.multi} onChange={(e) => onChange({ ...b, multi: e.target.checked || undefined })} /> 항목마다 다른 색</label><CardsEditor items={b.items} pal={pal} onChange={(items) => onChange({ ...b, items: items.slice(0, 6) })} /></>;
    case "kpis": return <>{b.items.map((it, i) => <div className="item-card" key={i}><ItemHead label={`${i + 1}`} i={i} n={b.items.length} onMove={(d) => onChange({ ...b, items: moveItem(b.items, i, d) })} onDel={() => onChange({ ...b, items: b.items.filter((_, k) => k !== i) })} />
      <div className="two"><IN value={it.value} placeholder="수치" onChange={(v) => onChange({ ...b, items: b.items.map((x, k) => (k === i ? { ...x, value: v } : x)) })} /><IN value={it.unit ?? ""} placeholder="단위" onChange={(v) => onChange({ ...b, items: b.items.map((x, k) => (k === i ? { ...x, unit: v || undefined } : x)) })} /></div>
      <IN value={it.label} placeholder="이름" onChange={(v) => onChange({ ...b, items: b.items.map((x, k) => (k === i ? { ...x, label: v } : x)) })} /></div>)}
      <button type="button" className="cd-btn cd-btn-ghost" disabled={b.items.length >= 6} onClick={() => onChange({ ...b, items: [...b.items, { value: "0", label: "새 수치" }] })}><Plus size={14} />수치 추가</button>
      <p className="proposal-muted">실적·인력 수치는 기준일이 있는 확인된 값만 씁니다.</p></>;
    case "table": return <TableEditor b={b} onChange={onChange} />;
    case "gantt": return <GanttEditor b={b} onChange={onChange} />;
    case "diagram": return <DiagramEditor b={b} pal={pal} onChange={onChange} />;
    case "figure": return <FigureEditor b={b} onChange={onChange} />;
    case "image": return <><Field label="캡션"><IN value={b.title} onChange={(v) => onChange({ ...b, title: v })} /></Field>{b.dataUrl ? <img className="proposal-thumb" src={b.dataUrl} alt={b.title} /> : <p className="proposal-alert">그림 파일을 고르세요.</p>}
      <div className="two"><Field label="가로(mm)"><IN type="number" value={b.widthMm} onChange={(v) => { const w = Math.max(20, Math.min(174, Number(v) || 20)); onChange({ ...b, widthMm: w, heightMm: Math.round(b.heightMm * w / b.widthMm * 10) / 10 }); }} /></Field><Field label="세로(mm)"><IN type="number" value={b.heightMm} onChange={(v) => onChange({ ...b, heightMm: Math.max(10, Math.min(240, Number(v) || 10)) })} /></Field></div></>;
  }
}

// ── 작성 필요 목록 · 찾기·바꾸기 ─────────────────────────────────────────────
/** 일치 앞뒤 글 — 목록 한 줄에 맞게 자른다 */
function Snippet({ text, start, end }: { text: string; start: number; end: number }) {
  const a = Math.max(0, start - 18), z = Math.min(text.length, end + 30);
  return <>{a > 0 ? "…" : ""}{text.slice(a, start)}<mark>{text.slice(start, end)}</mark>{text.slice(end, z)}{z < text.length ? "…" : ""}</>;
}

function PendingPanel({ doc, items, current, onGo, onClose }: { doc: ProposalDocument; items: PendingItem[]; current: string; onGo: (f: PendingItem) => void; onClose: () => void }) {
  const total = items.reduce((a, x) => a + x.count, 0);
  return <section className="proposal-tool cd-card" aria-label="작성 필요 목록" onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
    <div className="row"><strong>{total ? `발행 전에 채울 곳 ${total}곳` : "채울 곳이 없습니다"}</strong>
      <span className="proposal-muted">누르면 그 자리로 이동합니다.</span>
      <button type="button" className="icon-btn" aria-label="작성 필요 목록 닫기" onClick={onClose}><X size={15} /></button></div>
    {items.length ? <div className="list">{items.map((it) => {
      const key = `${editKey(it)}|${it.kind}`;
      const at = it.kind === "todo" ? it.value.indexOf("[작성 필요]") : -1;
      return <button key={key} type="button" className={current === key ? "on" : ""} onClick={() => onGo(it)}>
        <span className="lb">{fieldLabel(doc, it)}</span>
        <span className="tx">{it.kind === "todo" ? <Snippet text={it.value} start={at} end={at + 7} /> : <>연결 값 없음: {it.names?.join(", ")}</>}{it.count > 1 ? <small> 외 {it.count - 1}곳</small> : null}</span>
      </button>;
    })}</div> : null}
  </section>;
}

function FindPanel({ doc, onGo, onReplace, onClose }: { doc: ProposalDocument; onGo: (f: FieldRef) => void; onReplace: (next: ProposalDocument, note: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCase] = useState(false);
  const [sel, setSel] = useState(0);
  const moved = useRef(false);
  const matches = useMemo(() => findMatches(doc, query, { caseSensitive }), [doc, query, caseSensitive]);
  const usable = matches.filter((m) => !m.skip).length;
  const cur: FindMatch | undefined = matches[Math.min(sel, matches.length - 1)];
  const go = (i: number) => { if (!matches.length) return; const k = (i + matches.length) % matches.length; moved.current = true; setSel(k); onGo(matches[k]); };
  /** Enter = 다음(처음엔 지금 곳), Shift+Enter = 이전 */
  const step = (back: boolean) => go(!moved.current ? sel : back ? sel - 1 : sel + 1);
  const replaceOne = () => {
    if (!cur || cur.skip) return;
    const r = replaceMatches(doc, query, replacement, { caseSensitive, only: new Set([cur.key]) });
    if (r.replaced) onReplace(r.doc, "1곳을 바꿨습니다.");
  };
  const replaceAll = () => {
    const r = replaceMatches(doc, query, replacement, { caseSensitive });
    if (r.replaced) onReplace(r.doc, `${r.replaced}곳을 바꿨습니다.${r.skipped ? ` 표식을 가로지르는 ${r.skipped}곳은 건너뛰었습니다.` : ""} Ctrl+Z 로 한 번에 되돌릴 수 있습니다.`);
  };
  return <section className="proposal-tool cd-card" aria-label="찾기·바꾸기" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
    <div className="row">
      <input className="cd-input" autoFocus value={query} placeholder="찾을 말" aria-label="찾을 말" onChange={(e) => { setQuery(e.target.value); setSel(0); moved.current = false; }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey); } }} />
      <input className="cd-input" value={replacement} placeholder="바꿀 말" aria-label="바꿀 말" onChange={(e) => setReplacement(e.target.value)} />
      <label className="proposal-muted"><input type="checkbox" checked={caseSensitive} onChange={(e) => setCase(e.target.checked)} /> 대소문자 구분</label>
      <span className="proposal-muted" role="status">{query ? `${matches.length}곳${matches.length !== usable ? ` (바꿀 수 있는 곳 ${usable})` : ""}` : ""}</span>
      <button type="button" className="cd-btn" disabled={!cur || !!cur.skip} onClick={replaceOne}>바꾸기</button>
      <button type="button" className="cd-btn" disabled={!usable} onClick={replaceAll}>모두 바꾸기</button>
      <button type="button" className="icon-btn" aria-label="찾기·바꾸기 닫기" onClick={onClose}><X size={15} /></button>
    </div>
    {matches.length ? <div className="list">{matches.slice(0, 200).map((m, i) => <button key={m.key} type="button" className={cur?.key === m.key ? "on" : ""} onClick={() => go(i)}>
      <span className="lb">{fieldLabel(doc, m)}</span>
      <span className="tx"><Snippet text={m.value} start={m.start} end={m.end} />{m.skip ? <small> — {m.skip}</small> : null}</span>
    </button>)}{matches.length > 200 ? <p className="proposal-muted">앞의 200곳만 보입니다. 찾을 말을 더 길게 적어 주세요.</p> : null}</div> : null}
  </section>;
}

// ── 본 화면 ──────────────────────────────────────────────────────────────────
export function ProposalStudio() {
  const { theme } = useCdashTheme();
  const { data: session } = useSession();
  const permissions = permsOf(session?.user);
  const canEdit = hasPerm(permissions, "catalog.manage");
  const canPublish = canEdit && hasPerm(permissions, "catalog.publish");
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [doc, setDocState] = useState<ProposalDocument | null>(null);
  const [revision, setRevision] = useState(0);
  const [saved, setSaved] = useState("");
  const [selSection, setSelSection] = useState("");
  const [selBlock, setSelBlock] = useState("");
  const [scrollKey, setScrollKey] = useState(0);
  const [editions, setEditions] = useState<Edition[]>([]);
  const [kit, setKit] = useState<StudioKit | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [overflow, setOverflowState] = useState<string[]>([]);
  /** 바 아래 도구 — 작성 필요 목록 · 찾기·바꾸기 */
  const [tool, setTool] = useState<"" | "pending" | "find">("");
  const [hit, setHit] = useState<FieldRef | null>(null);
  const [pendingKey, setPendingKey] = useState("");
  /** AI 수정 대상과, 제안을 얹어 보는 동안의 문서(그동안 편집을 멈춘다) */
  const [aiTarget, setAiTarget] = useState<AiTarget | null>(null);
  const [reviewDoc, setReviewDocState] = useState<ProposalDocument | null>(null);
  const reviewing = useRef(false);
  const setReviewDoc = (d: ProposalDocument | null) => { reviewing.current = !!d; setReviewDocState(d); };
  const [, force] = useState(0);
  const history = useRef(new History<ProposalDocument>());
  const frameRef = useRef<HTMLIFrameElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const imageTarget = useRef<string>("");
  const findBtn = useRef<HTMLButtonElement>(null);
  const todoBtn = useRef<HTMLButtonElement>(null);
  /** 도구 창 닫기 — 초점을 연 단추로 돌려준다 */
  const closeTool = (back: React.RefObject<HTMLButtonElement | null>) => { back.current?.focus(); setTool(""); setHit(null); };
  const operation = useRef(false);
  const docRef = useRef<ProposalDocument | null>(null); docRef.current = doc;
  const dirty = !!doc && json(doc) !== saved;
  const section = doc?.sections.find((s) => s.id === selSection) ?? null;
  const found = doc && selBlock ? findBlock(doc, selBlock) : null;
  const onOverflow = useCallback((ids: string[]) => setOverflowState((before) => (json(before) === json(ids) ? before : ids)), []);
  const pending = useMemo(() => (doc ? pendingItems(doc) : []), [doc]);
  const pendingTotal = pending.reduce((a, x) => a + x.count, 0);
  const refresh = useCallback(async () => { const data = await api<{ documents: DocumentRow[] }>("/api/sales/proposals"); setDocuments(data.documents); }, []);
  useEffect(() => {
    let live = true;
    Promise.all([refresh(), loadStudioKit().then((v) => { if (live) setKit(v); })]).catch((e) => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [refresh]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty || operation.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const run = async (label: string, action: () => Promise<void>) => {
    if (operation.current) return; operation.current = true; setBusy(label); setError(""); setNotice("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "작업을 완료하지 못했습니다."); } finally { operation.current = false; setBusy(""); }
  };
  /** 모든 편집은 여기로 — 실행 취소 기록(같은 key 의 연속 입력은 한 단계로 묶는다) */
  const change = useCallback((next: ProposalDocument, key = "") => {
    const cur = docRef.current;
    if (!cur || operation.current || reviewing.current || !canEdit) return;
    history.current.push(cur, key);
    setDocState(next);
  }, [canEdit]);
  const undo = useCallback(() => { const cur = docRef.current; if (!cur) return; const p = history.current.undo(cur); if (p) { setDocState(p); force((n) => n + 1); } }, []);
  const redo = useCallback(() => { const cur = docRef.current; if (!cur) return; const n = history.current.redo(cur); if (n) { setDocState(n); force((x) => x + 1); } }, []);
  const changeBlock = (b: ProposalBlock) => { if (doc) change(updateBlock(doc, b.id, () => b), `b:${b.id}`); };
  const select = useCallback((sid: string, bid: string) => { setSelSection(sid); setSelBlock(bid); }, []);
  const goPage = (sid: string) => { setSelSection(sid); setSelBlock(""); setScrollKey((k) => k + 1); };
  /** 글 칸으로 이동 — 그 쪽·블록을 고르고 미리보기에서 칸을 강조한다(표지 칸이면 문서 설정) */
  const goField = (f: FieldRef) => {
    // 쪽 머리로 먼저 옮기고, 미리보기에 글 요소가 있으면(도식 안 글은 그림이라 없음) 그 칸을 가운데로 다시 옮긴다.
    if (f.bid === "_doc") goPage(""); else { setSelSection(f.sid); setSelBlock(f.bid === "_page" ? "" : f.bid); setScrollKey((k) => k + 1); }
    setHit({ sid: f.sid, bid: f.bid, path: f.path });
  };
  const safeLeave = () => !dirty || window.confirm("저장하지 않은 변경이 있습니다. 변경을 버리고 이동할까요?");
  const open = (next: ProposalDocument, rev: number, savedJson: string, eds: Edition[]) => {
    history.current.reset(); setDocState(next); setRevision(rev); setSaved(savedJson); setEditions(eds); setSelSection(""); setSelBlock(""); setScrollKey((k) => k + 1); setOverflowState([]);
    setTool(""); setHit(null);
  };
  const load = (id: string) => {
    if (!safeLeave()) return;
    void run("불러오는 중", async () => {
      const [current, hist] = await Promise.all([api<Saved>(`/api/sales/proposals/${id}`), api<{ editions: Edition[] }>(`/api/sales/proposals/${id}/editions`)]);
      open(current.document, current.rev, json(current.document), hist.editions);
    });
  };
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("document");
    if (id && /^[A-Za-z0-9_-]{1,80}$/.test(id)) load(id);
    // 문서 링크는 처음 한 번만 연다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const create = (templateId: ProposalDocument["templateId"]) => { if (!safeLeave() || !canEdit) return; open(createProposalTemplate(templateId), 0, "", []); };
  const persist = async (snapshot: ProposalDocument): Promise<Saved> => {
    if (json(snapshot) === saved && revision > 0) return { document: snapshot, rev: revision };
    if (!canEdit) throw new Error("초안을 저장할 권한이 없습니다.");
    const result = await api<Saved>(revision ? `/api/sales/proposals/${snapshot.id}` : "/api/sales/proposals", { method: revision ? "PUT" : "POST", body: json({ document: snapshot, rev: revision }) });
    setDocState(result.document); setRevision(result.rev); setSaved(json(result.document)); await refresh(); return result;
  };
  const save = () => { if (doc) void run("저장 중", async () => { await persist(doc); setNotice("저장했습니다."); }); };
  // 키보드: 실행 취소·다시 실행·저장
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (!(e.ctrlKey || e.metaKey) || reviewing.current) return;
      if (e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
      else if (e.key.toLowerCase() === "h" && docRef.current) { e.preventDefault(); setTool((t) => (t === "find" ? "" : "find")); }
      else if (!typing && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (!typing && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", key);
    const fd = frameRef.current?.contentWindow;
    fd?.addEventListener("keydown", key);
    return () => { window.removeEventListener("keydown", key); fd?.removeEventListener("keydown", key); };
  });

  const publish = () => {
    if (!doc) return;
    const snapshot = structuredClone(doc);
    void run("그림 변환·발행 중", async () => {
      // 발행 검사는 위치를 알려 주지 않으므로 먼저 채울 곳 목록을 열고 첫 자리로 이동한다.
      const pending = pendingItems(snapshot);
      if (pending.length) {
        setTool("pending"); setPendingKey(`${editKey(pending[0])}|${pending[0].kind}`); goField(pending[0]);
        throw new Error(`발행 전에 채울 곳이 ${pending.reduce((a, x) => a + x.count, 0)}곳 남았습니다. 작성 필요 목록에서 차례로 채워 주세요.`);
      }
      validateProposalForPublication(snapshot);
      if (overflow.length) throw new Error(`쪽 범위를 넘는 내용이 있습니다(${overflow.length}쪽). 왼쪽 목록의 주황 점 쪽을 줄이거나 [다음 쪽으로 넘기기]를 쓰세요.`);
      const fd = frameRef.current?.contentDocument;
      if (!kit || !fd) throw new Error("미리보기가 준비된 뒤 다시 발행하세요.");
      const prevZoom = zoom; setZoom(1); await new Promise((r) => setTimeout(r, 80));
      try {
        await fd.fonts.ready;
        // 글꼴 임베드 CSS 는 한 번만 만든다(그림마다 다시 만들면 수십 초가 걸린다).
        const fontEmbedCSS = await getFontEmbedCSS(fd.body);
        const figures: Record<string, string> = {};
        const shot = async (el: HTMLElement | null, label: string) => {
          if (!el) throw new Error(`‘${label}’ 미리보기를 찾지 못했습니다.`);
          return toPng(el, { pixelRatio: 300 / 72, backgroundColor: "#ffffff", cacheBust: false, fontEmbedCSS, style: { margin: "0", zoom: "1" } });
        };
        figures[COVER_ART_ID] = await shot(fd.querySelector<HTMLElement>('article[data-page="cover"] .pp-art'), "표지 배경");
        if (optionsOf(snapshot).dividers) figures[DIVIDER_ART_ID] = await shot(fd.querySelector<HTMLElement>('article[data-page^="divider"] .pp-art'), "간지 배경");
        for (const s of materializeDocument(snapshot).sections) for (const block of s.blocks) if (block.kind === "figure" || block.kind === "diagram") {
          const el = fd.querySelector<HTMLElement>(`[data-proposal-figure="${block.id}"]`);
          if (el && (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2)) throw new Error(`‘${block.title}’ 그림이 범위를 넘습니다. 높이를 늘리거나 내용을 줄여 주세요.`);
          figures[block.id] = await shot(el, block.title || "도식");
        }
        const current = await persist(snapshot);
        const result = await api<{ edition: Edition }>(`/api/sales/proposals/${current.document.id}/editions`, { method: "POST", body: json({ rev: current.rev, figures }) });
        setEditions((previous) => [result.edition, ...previous]); setNotice("HWPX 발행본을 만들었습니다. 아래 발행 이력에서 받을 수 있습니다.");
      } finally { setZoom(prevZoom); }
    });
  };

  const addImage = async (file: File, sid: string) => {
    if (!doc || reviewing.current) return;
    if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 8 * 1024 * 1024) { setError("PNG·JPEG 파일을 8MB 이하로 선택하세요."); return; }
    void run("그림 읽는 중", async () => {
      const dataUrl = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error("그림 파일을 읽지 못했습니다.")); r.readAsDataURL(file); });
      const image = new Image(); image.src = dataUrl; await image.decode();
      if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 30_000_000) throw new Error("그림은 3천만 화소 이하로 선택하세요.");
      const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      canvas.getContext("2d")?.drawImage(image, 0, 0);
      const png = canvas.toDataURL("image/png");
      if (png.length > 11_000_000) throw new Error("변환한 그림이 너무 큽니다. 크기를 줄인 뒤 다시 선택하세요.");
      const widthMm = Math.min(174, image.naturalWidth * 25.4 / 150, 200 * image.naturalWidth / image.naturalHeight);
      const block: ProposalBlock = { id: newId(), kind: "image", title: file.name.replace(/\.[^.]+$/, ""), dataUrl: png, widthMm: Math.max(20, Math.round(widthMm)), heightMm: Math.max(10, Math.round(widthMm * image.naturalHeight / image.naturalWidth)) };
      const cur = docRef.current!;
      const existing = imageTarget.current && findBlock(cur, imageTarget.current);
      // run() 안이라 change() 대신 기록을 직접 남긴다.
      history.current.push(cur);
      if (existing && existing.block.kind === "image") setDocState(updateBlock(cur, existing.block.id, (b) => ({ ...block, id: b.id, title: (b as typeof block).title || block.title })));
      else { setDocState(updateSection(cur, sid, (s) => ({ ...s, blocks: [...s.blocks, block] }))); setSelBlock(block.id); }
    });
  };
  const exportSource = () => { if (!doc) return; const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = `${doc.title || "제안서"}_편집원본.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };

  // 쪽 연산
  const addPage = (after: ProposalSection | null) => {
    if (!doc) return;
    const base = after ?? doc.sections[doc.sections.length - 1];
    const s: ProposalSection = { id: newId("p"), title: "새 쪽 제목", chapter: base?.chapter, crumb: base?.crumb, blocks: [makeBlock("bullets")] };
    change(insertSectionAfter(doc, base?.id ?? null, s)); goPage(s.id);
  };
  const movePage = (i: number, d: number) => { if (doc) change({ ...doc, sections: moveItem(doc.sections, i, d) }); };
  const dupPage = (s: ProposalSection) => {
    if (!doc) return;
    // 복제한 쪽은 원고에서 온 쪽이 아니므로 원고 지문을 넘기지 않는다.
    const { sourceHash: _hash, ...rest } = structuredClone(s);
    const copy: ProposalSection = { ...rest, id: newId("p"), pageId: s.pageId ? `${s.pageId}c` : undefined, blocks: s.blocks.map(cloneBlock) };
    change(insertSectionAfter(doc, s.id, copy)); goPage(copy.id);
  };
  const delPage = (s: ProposalSection) => { if (!doc || !window.confirm(`‘${s.title || s.pageId || "이 쪽"}’ 쪽을 삭제할까요? 저장 전까지 기존 저장본에는 영향이 없습니다.`)) return; change({ ...doc, sections: doc.sections.filter((x) => x.id !== s.id) }); setSelSection(""); setSelBlock(""); };
  const addBlockTo = (kind: ProposalBlockKind) => {
    if (!doc || !section) return;
    if (kind === "image") { imageTarget.current = ""; imageInput.current?.click(); return; }
    const b = makeBlock(kind);
    const at = found && found.section.id === section.id ? found.index + 1 : section.blocks.length;
    change(updateSection(doc, section.id, (s) => { const blocks = [...s.blocks]; blocks.splice(at, 0, b); return { ...s, blocks }; }));
    setSelBlock(b.id);
  };
  const pushOverflow = (sid: string) => { if (!doc) return; const r = pushLastBlockToNextPage(doc, sid); if (r) { change(r.doc); goPage(r.target); } };
  const bulletOp = (sid: string, bid: string, index: number, value: string, action: BulletAction): number | null => {
    const cur = docRef.current;
    const b = cur ? findBlock(cur, bid)?.block : null;
    if (!cur || !b || b.kind !== "bullets" || operation.current || !canEdit) return null;
    const r = bulletAction(b.items, index, value, action);
    change(updateBlock(cur, bid, () => ({ ...b, items: r.items })));
    return r.focus;
  };

  const pages = doc ? physicalPages(doc) : [];
  const chapters = doc ? chaptersOf(doc) : [];
  const opts = doc ? optionsOf(doc) : null;
  const totalPages = pages.length;

  if (!doc) {
    return <div className="cdash cd-fields-white proposal-studio" data-theme={theme} data-testid="proposal-studio">
      <CdPageHeader title="용역 제안서" subtitle="완성된 공통 원고를 사업장에 맞춰 편집하고, 한글에서 고칠 수 있는 HWPX 로 발행합니다." breadcrumbs={[{ label: "영업·마케팅", href: "/sales" }, { label: "용역 제안서" }]} actions={<CdHelp topic="sales.proposals" />} />
      {error && <div className="proposal-alert" role="alert">{error}<button type="button" onClick={() => setError("")} aria-label="오류 안내 닫기">×</button></div>}
      {loading && <p role="status" className="proposal-muted">제안서 목록을 불러오는 중입니다.</p>}
      <section className="cd-card" style={{ padding: 18, marginTop: 12 }}><h2>새 제안서</h2><p className="proposal-muted">통합환경허가(일반·발전·정기검사)와 지속가능경영보고서 발간은 목차와 수행 방법이 달라 양식을 나눴습니다.</p>
        <div className="proposal-templates">{PROPOSAL_TEMPLATES.map((t) => {
          const pal = PROPOSAL_THEMES[t.theme];
          return <button key={t.id} type="button" disabled={!canEdit || !!busy} className="proposal-template" onClick={() => create(t.id)}>
            <span className="sw" style={{ background: `linear-gradient(90deg, ${pal.primary} 0 70%, ${pal.primary2} 70% 88%, ${pal.accent} 88%)` }}>{pal.label}</span>
            <span className="bd"><strong>{t.label}</strong><span>{t.description}</span><small>이 양식으로 시작 →</small></span></button>;
        })}</div>
        {!canEdit && <p className="proposal-muted">초안 작성은 회사소개서 관리 권한이 있는 담당자가 할 수 있습니다.</p>}
      </section>
      <section className="cd-card" style={{ padding: 18, marginTop: 12 }}><h2>저장된 제안서</h2>
        {!loading && documents.length === 0 ? <p className="proposal-muted">저장된 제안서가 없습니다. 위에서 양식을 골라 첫 제안서를 만드세요.</p>
          : <div className="proposal-doclist">{documents.map((row) => <button type="button" key={row.id} onClick={() => load(row.id)} disabled={!!busy}><FileText size={18} /><span style={{ flex: 1 }}><strong>{row.title}</strong><small>{row.client || "발주처 미입력"}{row.updatedAt ? ` · ${new Date(row.updatedAt).toLocaleString("ko-KR")}` : ""}</small></span><span className="proposal-muted">열기 →</span></button>)}</div>}
      </section>
    </div>;
  }

  const pal = paletteOf(doc);
  const setDoc = (patch: Partial<ProposalDocument>, key = "") => change({ ...doc, ...patch }, key);
  const setOpts = (patch: Partial<ReturnType<typeof optionsOf>>) => change({ ...doc, options: { ...optionsOf(doc), ...patch } });

  // 오른쪽 패널
  let inspector: React.ReactNode;
  if (found) {
    const { block: b, section: s, index } = found;
    const conv = conversions(b);
    inspector = <div className="inspector">
      <div className="hd"><span className="kind">{BLOCK_LABEL[b.kind]}</span><h2> </h2>
        <button type="button" className="cd-btn cd-btn-ghost ai-btn" disabled={!canEdit || !!busy} onClick={() => setAiTarget({ scope: "block", sectionId: s.id, blockId: b.id, label: `${s.pageId ?? ""} · ${BLOCK_LABEL[b.kind]}` })}><Sparkles size={14} />AI로 고치기</button>
        <button type="button" className="icon-btn" aria-label="위로" disabled={index === 0} onClick={() => change(updateSection(doc, s.id, (x) => ({ ...x, blocks: moveItem(x.blocks, index, -1) })))}><ArrowUp size={15} /></button>
        <button type="button" className="icon-btn" aria-label="아래로" disabled={index === s.blocks.length - 1} onClick={() => change(updateSection(doc, s.id, (x) => ({ ...x, blocks: moveItem(x.blocks, index, 1) })))}><ArrowDown size={15} /></button>
        <button type="button" className="icon-btn" aria-label="복제" onClick={() => { const c = cloneBlock(b); change(updateSection(doc, s.id, (x) => { const blocks = [...x.blocks]; blocks.splice(index + 1, 0, c); return { ...x, blocks }; })); setSelBlock(c.id); }}><Copy size={15} /></button>
        <button type="button" className="icon-btn" aria-label="삭제" onClick={() => { change(updateSection(doc, s.id, (x) => ({ ...x, blocks: x.blocks.filter((y) => y.id !== b.id) }))); setSelBlock(""); }}><Trash2 size={15} /></button>
      </div>
      <button type="button" className="cd-btn cd-btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => setSelBlock("")}>← {s.pageId ?? ""} 쪽 설정</button>
      {conv.length ? <div className="sec"><h3>모양 바꾸기 <small className="proposal-muted">내용 유지</small></h3><div className="chips">{conv.map((k) => <button key={k} type="button" onClick={() => change(updateBlock(doc, b.id, (x) => convertBlock(x, k)))}>{BLOCK_LABEL[k]}</button>)}</div></div> : null}
      <div className="sec"><BlockFields b={b} pal={pal} onChange={changeBlock} />
        {b.kind === "image" ? <button type="button" className="cd-btn" onClick={() => { imageTarget.current = b.id; imageInput.current?.click(); }}><ImagePlus size={14} />파일 바꾸기</button> : null}</div>
      <div className="sec"><h3>다른 쪽으로 옮기기</h3><select className="cd-input" value="" onChange={(e) => { const to = e.target.value; if (!to) return; const moved = { ...doc, sections: doc.sections.map((x) => (x.id === s.id ? { ...x, blocks: x.blocks.filter((y) => y.id !== b.id) } : x.id === to ? { ...x, blocks: [...x.blocks, b] } : x)) }; change(moved); goPage(to); setSelBlock(b.id); }}>
        <option value="">쪽 선택…</option>{doc.sections.filter((x) => x.id !== s.id).map((x) => <option key={x.id} value={x.id}>{x.pageId ? `${x.pageId} · ` : ""}{x.title || "(이어지는 쪽)"}</option>)}</select></div>
    </div>;
  } else if (section) {
    const s = section;
    const setS = (patch: Partial<ProposalSection>, key = "") => change(updateSection(doc, s.id, (x) => ({ ...x, ...patch })), key);
    inspector = <div className="inspector">
      <div className="hd"><span className="kind">쪽</span><h2>{s.pageId ?? ""}</h2>
        <button type="button" className="cd-btn cd-btn-ghost ai-btn" disabled={!canEdit || !!busy} onClick={() => setAiTarget({ scope: "page", sectionId: s.id, label: `${s.pageId ?? ""} 쪽 전체` })}><Sparkles size={14} />AI로 고치기</button></div>
      <div className="two">
        <Field label="장(머리띠)"><input className="cd-input" list="proposal-chapters" value={s.chapter ?? ""} onChange={(e) => setS({ chapter: e.target.value || undefined }, `s:${s.id}:ch`)} /></Field>
        <Field label="절(머리말 오른쪽·목차)"><IN value={s.crumb ?? ""} onChange={(v) => setS({ crumb: v || undefined }, `s:${s.id}:cr`)} /></Field>
      </div>
      <datalist id="proposal-chapters">{chapters.map((c) => <option key={c.name} value={c.name} />)}</datalist>
      <Field label="쪽 제목(핵심 문장형 제목, 비우면 이어지는 쪽)"><IN value={s.title} onChange={(v) => setS({ title: v }, `s:${s.id}:t`)} /></Field>
      <Field label="요약(핵심 메시지 상자)"><TA value={s.summary ?? ""} rows={2} onChange={(v) => setS({ summary: v || undefined }, `s:${s.id}:s`)} /></Field>
      {overflow.includes(s.id) ? <div className="proposal-alert" role="alert"><span>이 쪽의 내용이 지면을 넘습니다.</span><button type="button" className="cd-btn" onClick={() => pushOverflow(s.id)}>다음 쪽으로 넘기기</button></div> : null}
      <div className="sec"><h3>이 쪽의 블록</h3><div className="blocklist">{s.blocks.map((b) => <button key={b.id} type="button" onClick={() => setSelBlock(b.id)}><span className="k">{BLOCK_LABEL[b.kind]}</span><span className="t">{blockSummary(b) || "—"}</span></button>)}</div></div>
      <div className="sec"><h3>블록 추가</h3><div className="palette">{BLOCK_PALETTE.map((p) => <button key={p.kind} type="button" onClick={() => addBlockTo(p.kind)}><b>{p.label}</b><small>{p.hint}</small></button>)}</div></div>
    </div>;
  } else {
    const brand = opts?.brandColor ?? "";
    inspector = <div className="inspector">
      <div className="hd"><span className="kind">문서</span><h2>표지·문서 설정</h2></div>
      <Field label="제안서 제목"><IN value={doc.title} onChange={(v) => setDoc({ title: v }, "d:title")} /></Field>
      <Field label="용역명"><IN value={doc.projectName} onChange={(v) => setDoc({ projectName: v }, "d:proj")} /></Field>
      <div className="two"><Field label="발주처"><IN value={doc.client} onChange={(v) => setDoc({ client: v }, "d:client")} /></Field><Field label="제출일"><IN type="date" value={doc.submissionDate} onChange={(v) => setDoc({ submissionDate: v })} /></Field></div>
      {doc.variables ? (["siteName", "duration", "companyName"] as const).map((k) => <Field key={k} label={PROPOSAL_VARIABLE_LABELS[k]}><IN value={doc.variables![k]} onChange={(v) => setDoc({ variables: { ...doc.variables!, [k]: v } }, `d:${k}`)} /></Field>) : null}
      <p className="proposal-muted">본문의 {"{{siteName}}"}·{"{{client}}"}·{"{{duration}}"} 연결 표기에 위 값이 들어갑니다.</p>
      {doc.variables ? <Field label="발주처 메모(AI 참고 — 발행본에는 들어가지 않음)"><TA value={doc.variables.clientNotes ?? ""} rows={3} placeholder="업종·주요 설비·쟁점·요구 톤 등" onChange={(v) => setDoc({ variables: { ...doc.variables!, clientNotes: v || undefined } }, "d:notes")} /></Field> : null}
      <div className="sec"><h3>디자인</h3>
        <Field label="색 테마"><div className="swatches">{Object.entries(PROPOSAL_THEMES).map(([k, t]) => <button key={k} type="button" title={t.label} aria-label={t.label} className={doc.theme === k ? "on" : ""} style={{ background: `linear-gradient(135deg, ${t.primary} 60%, ${t.accent} 60%)` }} onClick={() => setDoc({ theme: k as ProposalDocument["theme"] })} />)}</div></Field>
        <Field label="발주처 주색(선택 — 테마 주색을 덮어씀)"><div className="two"><input className="cd-input" type="color" value={isHexColor(brand) ? brand : pal.primary} onChange={(e) => setOpts({ brandColor: e.target.value.toUpperCase() })} /><button type="button" className="cd-btn cd-btn-ghost" disabled={!brand} onClick={() => setOpts({ brandColor: undefined })}>테마 색으로</button></div></Field>
        {isHexColor(brand) && contrast(brand, "#FFFFFF") < 4.5 ? <p className="proposal-alert">흰 글자 대비가 4.5:1 미만이라 적용하지 않습니다. 더 짙은 색을 고르세요.</p> : null}
        <Field label="도식 팔레트(도식·다색 카드·단계 흐름)"><div className="palette-pick">{(Object.keys(SERIES_LABEL) as SeriesPalette[]).map((k) => <button key={k} type="button" className={(opts!.palette ?? "calm") === k ? "on" : ""} onClick={() => setOpts({ palette: k === "calm" ? undefined : k })}>
          <span className="strip">{seriesOf(doc.theme, k, pal.primary).map((c) => <i key={c} style={{ background: c }} />)}</span><span>{SERIES_LABEL[k]}</span></button>)}</div></Field>
        <Field label="표지"><Chips value={opts!.cover} options={[{ v: "modern", label: "모던(띠·원 장식)" }, { v: "classic", label: "클래식(가운데 정렬·테두리)" }]} onChange={(v) => setOpts({ cover: v })} /></Field>
        <label className="proposal-muted"><input type="checkbox" checked={opts!.toc} onChange={(e) => setOpts({ toc: e.target.checked })} /> 목차 쪽</label>
        <label className="proposal-muted"><input type="checkbox" checked={opts!.dividers} onChange={(e) => setOpts({ dividers: e.target.checked })} /> 장 간지(장마다 1쪽 추가 — 쪽수 제한이 있으면 끄세요)</label>
      </div>
    </div>;
  }

  return <div className="cdash cd-fields-white proposal-studio" data-theme={theme} data-testid="proposal-studio">
    <CdPageHeader title="용역 제안서" subtitle={doc.title} breadcrumbs={[{ label: "영업·마케팅", href: "/sales" }, { label: "용역 제안서" }]} actions={<CdHelp topic="sales.proposals" />} />
    {error && <div className="proposal-alert" role="alert">{error}<button type="button" onClick={() => setError("")} aria-label="오류 안내 닫기">×</button></div>}
    {notice && <div className="proposal-notice" role="status">{notice}</div>}
    <div className="proposal-bar">
      <button type="button" className="cd-btn" disabled={!!busy} onClick={() => { if (safeLeave()) setDocState(null); }}>목록</button>
      <button type="button" className="cd-btn cd-btn-ghost" aria-label="실행 취소" title="실행 취소 (Ctrl+Z)" disabled={!history.current.canUndo || !!reviewDoc} onClick={undo}><Undo2 size={15} /></button>
      <button type="button" className="cd-btn cd-btn-ghost" aria-label="다시 실행" title="다시 실행 (Ctrl+Y)" disabled={!history.current.canRedo || !!reviewDoc} onClick={redo}><Redo2 size={15} /></button>
      <span className="state"><span role="status" className="state-text"><b>{busy || (dirty ? "저장하지 않은 변경" : revision ? `저장됨 · ${revision}판` : "새 문서")}</b><span>전체 {totalPages}쪽(본문 {doc.sections.length})</span>{overflow.length ? <span className="warn">넘침 {overflow.length}쪽</span> : null}</span>
        {pendingTotal ? <button ref={todoBtn} type="button" className={`todo${tool === "pending" ? " on" : ""}`} aria-expanded={tool === "pending"} onClick={() => setTool((t) => (t === "pending" ? "" : "pending"))}>작성 필요 {pendingTotal}</button> : null}</span>
      <button ref={findBtn} type="button" className={`cd-btn cd-btn-ghost${tool === "find" ? " on" : ""}`} title="찾기·바꾸기 (Ctrl+H)" aria-expanded={tool === "find"} onClick={() => setTool((t) => (t === "find" ? "" : "find"))}><Search size={15} />찾기·바꾸기</button>
      <span className="proposal-zoom">배율 <select className="cd-input" value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>{[0.6, 0.75, 0.9, 1, 1.2, 1.4].map((z) => <option key={z} value={z}>{Math.round(z * 100)}%</option>)}</select></span>
      <button type="button" className="cd-btn" onClick={exportSource} disabled={!!busy}><Download size={15} />편집 원본</button>
      <button type="button" className="cd-btn" disabled={!canEdit || !!busy || !!reviewDoc || (!dirty && revision > 0)} onClick={save}><Save size={15} />저장</button>
      <button type="button" className="cd-btn cd-btn-primary" disabled={!canPublish || !!busy || !!reviewDoc} onClick={publish}><Send size={15} />HWPX 발행</button>
    </div>
    {tool === "pending" ? <PendingPanel doc={doc} items={pending} current={pendingKey} onClose={() => closeTool(todoBtn)}
      onGo={(it) => { setPendingKey(`${editKey(it)}|${it.kind}`); goField(it); }} /> : null}
    {aiTarget ? <ProposalAiPanel target={aiTarget} doc={doc} kit={kit} previewing={!!reviewDoc} onPreview={setReviewDoc} onClose={() => setAiTarget(null)}
      onAccept={(next, note) => { setReviewDoc(null); change(next); setNotice(note); setAiTarget(null); }} /> : null}
    {tool === "find" ? <FindPanel doc={doc} onClose={() => closeTool(findBtn)} onGo={goField}
      onReplace={(next, note) => { change(next); setNotice(note); }} /> : null}
    <div className="proposal-ws">
      <aside className="outline" aria-label="문서 구성">
        <button type="button" className={`doc${!selSection ? " on" : ""}`} onClick={() => goPage("")}>표지 · 문서 설정</button>
        {doc.sections.map((s, i) => {
          const ci = chapters.findIndex((c) => c.name === s.chapter?.trim());
          const head = s.chapter && s.chapter !== doc.sections[i - 1]?.chapter;
          return <div key={s.id}>
            {head ? <div className="ch"><i>{chapters[ci]?.roman}</i>{s.chapter}</div> : null}
            <div className="row">
              <button type="button" className={`pg${selSection === s.id ? " on" : ""}`} onClick={() => goPage(s.id)}><span className="id">{s.pageId ?? i + 1}</span><span className="tt" title={s.title || undefined}>{s.title ? outlineLabel(s.title) : <em>이어지는 쪽</em>}</span>{overflow.includes(s.id) ? <span className="of" title="내용 넘침" /> : null}</button>
              <span className="acts">
                <button type="button" className="icon-btn" aria-label="위로" disabled={!i} onClick={() => movePage(i, -1)}><ArrowUp size={13} /></button>
                <button type="button" className="icon-btn" aria-label="아래로" disabled={i === doc.sections.length - 1} onClick={() => movePage(i, 1)}><ArrowDown size={13} /></button>
                <button type="button" className="icon-btn" aria-label="쪽 복제" onClick={() => dupPage(s)}><Copy size={13} /></button>
                <button type="button" className="icon-btn" aria-label="쪽 삭제" onClick={() => delPage(s)}><Trash2 size={13} /></button>
              </span>
            </div>
          </div>;
        })}
        <button type="button" className="cd-btn add" onClick={() => addPage(section)}><FilePlus2 size={14} />쪽 추가</button>
      </aside>
      {kit ? <Canvas doc={reviewDoc ?? doc} kit={kit} frameRef={frameRef} zoom={zoom} selSection={selSection} selBlock={selBlock} scrollKey={scrollKey} hit={hit} onSelect={select}
        onEdit={(sid, bid, path, value) => { const cur = docRef.current; if (cur) change(setAtPath(cur, sid, bid, path, value)); }} onBullet={bulletOp} onOverflow={onOverflow} /> : <div className="proposal-canvas"><p className="proposal-muted" style={{ padding: 20 }}>미리보기를 준비하고 있습니다.</p></div>}
      <aside aria-label="속성"><fieldset className="proposal-lock" disabled={!!reviewDoc}>{inspector}</fieldset></aside>
    </div>
    <input type="file" ref={imageInput} accept="image/png,image/jpeg" hidden onChange={(e) => { const file = e.target.files?.[0]; e.currentTarget.value = ""; if (file && section) void addImage(file, section.id); }} />
    <section className="cd-card proposal-editions" style={{ padding: 16 }}><h2>발행 이력</h2><p className="proposal-muted">발행 시점의 원본과 그림이 함께 보관됩니다. 이후 수정은 이전 발행본을 바꾸지 않습니다.</p>
      {editions.length === 0 ? <p className="proposal-muted">발행본이 없습니다.</p> : editions.map((edition) => <div key={edition.id} className="proposal-edition"><span><strong>{edition.fileName}</strong><small>{edition.revision}판 · {new Date(edition.createdAt).toLocaleString("ko-KR")} · {(edition.sizeBytes / 1024).toFixed(0)} KB</small></span><a href={`/api/sales/proposals/${doc.id}/editions/${edition.id}/download`} className="cd-btn"><Download size={14} />받기</a></div>)}
    </section>
  </div>;
}
