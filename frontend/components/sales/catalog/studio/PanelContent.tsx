"use client";

// 오른쪽 패널 · 내용 탭(L1) — 고른 요소의 글·사진·목록·인포그래픽 내용, 숨긴 요소, 쪽 요소 목록(키보드로 고르기).
//   여러 개 고르면(Shift·Ctrl+클릭) 고른 목록과 함께 하는 일(복제·숨기기·지우기)만 보인다.

import { useMemo } from "react";
import { ArrowDown, ArrowUp, Copy, CornerLeftUp, EyeOff, ImagePlus, RotateCcw, Trash2, X } from "lucide-react";
import { CdHelp } from "@/components/cdash/CdHelp";
import { INFO_TYPE_META, type InfoContent, type InfoItem, type InfoSpec } from "@/lib/catalog/render/infographic/types";
import type { InfoSlotProps } from "@/lib/catalog/render/infographic/slot";
import { findNode, newUserId, textOf, type CNode } from "@/lib/catalog/studio/nodes";
import { capabilities, describe, isTextBlock, parentSelection, type Selection } from "@/lib/catalog/studio/select";
import { selectionLabel, type PanelProps } from "./types";

const snippet = (n: CNode) => textOf(n).replace(/\s+/g, " ").trim().slice(0, 28) || "(글 없음)";

/** 쪽 요소 목록 — 글 블록·사진·위젯·추가한 요소(키보드로 고르는 길) */
function pageElements(tree: CNode): Selection[] {
  const out: Selection[] = [];
  const walk = (path: CNode[]) => {
    const n = path[path.length - 1];
    const parent = path.length > 1 ? path[path.length - 2] : null;
    if (path.length > 1 && (n.widget || n.origin === "add" || n.tag === "img" || isTextBlock(n, parent))) {
      out.push(describe(path));
      return;
    }
    n.children?.forEach((c) => walk([...path, c]));
  };
  walk([tree]);
  return out.filter((s) => s.node.tag !== "#text");
}

export function PanelContent({ studio, item, composed, sel, caps, multi, ops }: PanelProps) {
  const tree = composed.tree;
  const elements = useMemo(() => pageElements(tree), [tree]);
  const hiddenIds = Object.entries(composed.state?.edits.nodes ?? {})
    .filter(([, e]) => e.hidden)
    .map(([id]) => id);

  return (
    <div className="flex flex-col gap-3">
      {multi.length ? (
        <MultiControls multi={multi} item={item} ops={ops} />
      ) : sel ? (
        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-1">
            <h3 className="text-sm font-semibold cd-text">{selectionLabel(sel)}</h3>
            <span className="text-xs cd-text-faint truncate">{sel.kind === "text" || sel.kind === "item" ? `“${snippet(sel.node)}”` : ""}</span>
            <span className="ml-auto flex items-center gap-0.5">
              <button
                type="button"
                className="cd-icon-button cd-icon-button-sm"
                aria-label="상위 요소 고르기"
                title="상위 요소 고르기"
                onClick={() => ops.select(parentSelection(tree, sel)?.id ?? null)}
                disabled={!parentSelection(tree, sel)}
              >
                <CornerLeftUp className="w-3.5 h-3.5" />
              </button>
              <button type="button" className="cd-icon-button cd-icon-button-sm" aria-label="선택 해제" title="선택 해제" onClick={() => ops.select(null)}>
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          </div>
          {caps?.locked ? <p className="text-xs cd-text-muted">{caps.locked}</p> : null}

          {caps?.editText ? (
            <div className="text-xs cd-text-muted flex flex-col gap-1">
              <p>캔버스에서 글을 눌러 바로 고칩니다. Enter 는 줄바꿈, Esc 는 끝내기입니다. 파란 바탕 칩은 자동 값(지표)이라 고칠 수 없고 지울 수는 있습니다.</p>
              {sel.node.pinned && sel.node.origin !== "add" ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="cd-pill cd-pill-warn">고친 글 · 자동 갱신 제외</span>
                  <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => ops.reset(sel.id, ["content"])}>
                    <RotateCcw className="w-3.5 h-3.5" /> 자동 값으로 되돌리기
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {caps?.listItem ? <ListControls sel={sel} ops={ops} /> : null}

          {caps?.image ? <ImageControls sel={sel} ops={ops} /> : null}

          {sel.kind === "infographic" && item.maxLevel >= 2 ? <InfoContentEditor sel={sel} ops={ops} /> : null}

          {caps?.hide || caps?.duplicate ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {caps.duplicate ? (
                <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => ops.duplicate([sel.id])} title="Ctrl+D">
                  <Copy className="w-3.5 h-3.5" /> 복제
                </button>
              ) : null}
              {caps.hide ? (
              <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => ops.hide(sel.id)}>
                {sel.node.origin === "base" || !sel.node.origin ? <EyeOff className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
                {sel.node.origin === "base" || !sel.node.origin ? "이 요소 숨기기" : "이 요소 지우기"}
              </button>
              ) : null}
              {sel.node.edited && sel.node.origin === "base" ? (
                <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => ops.reset(sel.id)}>
                  <RotateCcw className="w-3.5 h-3.5" /> 이 요소 편집 모두 되돌리기
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : (
        <section className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold cd-text flex items-center gap-1">
            {item.label} <CdHelp topic="catalog.studio-levels" />
          </h3>
          <p className="text-xs cd-text-muted">
            {item.maxLevel === 3
              ? "글·사진·목록, 구조(숨김·인포그래픽 유형·열 수), 자유 배치(옮기기·크기·글자 크기)를 고칠 수 있습니다."
              : item.maxLevel === 2
                ? "자동으로 채우는 쪽입니다. 글·사진과 구조(숨김·유형)만 고칩니다."
                : "부록 쪽입니다. 글만 고칩니다. 행은 실적 노출 관리에서 고칩니다."}
          </p>
          <p className="text-xs cd-text-faint">캔버스에서 요소를 누르거나 아래 목록에서 고릅니다. Shift·Ctrl+클릭으로 여러 개 고릅니다.</p>
        </section>
      )}

      {hiddenIds.length ? (
        <section className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold cd-text-muted">숨긴 요소 {hiddenIds.length}</h3>
          <ul className="flex flex-col gap-1">
            {hiddenIds.map((id) => {
              const n = findNode(composed.base, id);
              return (
                <li key={id} className="flex items-center gap-1 text-xs">
                  <span className="cd-text-muted truncate">{n ? snippet(n) : "(데이터에서 사라진 요소)"}</span>
                  <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm ml-auto" onClick={() => ops.unhide(id)}>
                    보이기
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-1">
        <h3 className="text-xs font-semibold cd-text-muted">쪽 요소 {elements.length}</h3>
        <ul className="flex flex-col gap-0.5 max-h-72 overflow-y-auto pr-1">
          {elements.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                className="cd-action w-full text-left text-xs px-2 py-1.5 rounded-lg border"
                style={{ borderColor: e.id === sel?.id ? "var(--cd-primary)" : "transparent" }}
                aria-current={e.id === sel?.id ? "true" : undefined}
                onClick={(ev) => (ev.shiftKey || ev.ctrlKey || ev.metaKey ? ops.toggleSelect(e.id) : ops.select(e.id))}
              >
                <span className="cd-text-faint mr-1">{selectionLabel(e)}</span>
                <span className="cd-text">{e.kind === "image" ? (String(e.node.attrs?.alt ?? "") || "사진") : snippet(e.node)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** 여러 개 고른 경우 — 고른 목록(누르면 빼기)과 함께 하는 일 */
function MultiControls({ multi, item, ops }: { multi: Selection[]; item: PanelProps["item"]; ops: PanelProps["ops"] }) {
  const capsOf = (s: Selection) => capabilities(s, item.maxLevel);
  const canDup = multi.some((s) => capsOf(s).duplicate);
  const canHide = multi.some((s) => capsOf(s).hide);
  const canMove = multi.some((s) => capsOf(s).move);
  const ids = multi.map((s) => s.id);
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <h3 className="text-sm font-semibold cd-text">요소 {multi.length}개 선택</h3>
        <span className="ml-auto flex items-center gap-0.5">
          <button type="button" className="cd-icon-button cd-icon-button-sm" aria-label="선택 해제" title="선택 해제" onClick={() => ops.select(null)}>
            <X className="w-3.5 h-3.5" />
          </button>
        </span>
      </div>
      <p className="text-xs cd-text-muted">
        {canMove ? "캔버스의 묶음 손잡이를 끌거나 방향키로 함께 옮깁니다(서로의 자리는 그대로). " : ""}Shift·Ctrl+클릭으로 더하거나 뺍니다.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {canDup ? (
          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => ops.duplicate(ids)} title="Ctrl+D">
            <Copy className="w-3.5 h-3.5" /> 복제
          </button>
        ) : null}
        {canHide ? (
          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => ops.hideMany(ids)} title="Delete">
            <EyeOff className="w-3.5 h-3.5" /> 숨기기·지우기
          </button>
        ) : null}
      </div>
      <p className="text-[11px] cd-text-faint">원래 요소는 숨기고(숨긴 요소에서 되살림) 직접 넣은 요소는 지웁니다. 복제한 사본은 직접 넣은 요소가 되어 자동 갱신에서 빠집니다.</p>
      <ul className="flex flex-col gap-0.5">
        {multi.map((s) => (
          <li key={s.id} className="flex items-center gap-1 text-xs">
            <span className="cd-text-faint">{selectionLabel(s)}</span>
            <span className="cd-text truncate">{s.kind === "image" ? (String(s.node.attrs?.alt ?? "") || "사진") : snippet(s.node)}</span>
            <button type="button" className="cd-icon-button cd-icon-button-sm ml-auto" aria-label="선택에서 빼기" title="선택에서 빼기" onClick={() => ops.toggleSelect(s.id)}>
              <X className="w-3.5 h-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ListControls({ sel, ops }: { sel: Selection; ops: PanelProps["ops"] }) {
  const itemId = sel.kind === "item" ? sel.id : (sel.node.children ?? []).filter((c) => c.tag !== "#text").slice(-1)[0]?.id;
  if (!itemId) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs cd-text-muted">목록 항목 {sel.kind === "list" ? "(마지막 항목 기준)" : ""}</p>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => ops.listOp(itemId, "duplicate")}>
          <Copy className="w-3.5 h-3.5" /> 항목 추가
        </button>
        <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => ops.listOp(itemId, "up")}>
          <ArrowUp className="w-3.5 h-3.5" /> 위로
        </button>
        <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => ops.listOp(itemId, "down")}>
          <ArrowDown className="w-3.5 h-3.5" /> 아래로
        </button>
        <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => ops.listOp(itemId, "remove")}>
          <Trash2 className="w-3.5 h-3.5" /> 항목 삭제
        </button>
      </div>
      <p className="text-[11px] cd-text-faint">목록을 처음 고치면 그 목록은 지금 모습으로 고정되어 자동 갱신에서 빠집니다.</p>
    </div>
  );
}

function ImageControls({ sel, ops }: { sel: Selection; ops: PanelProps["ops"] }) {
  const a = sel.node.asset;
  const fx = a?.fx ?? 50;
  const fy = a?.fy ?? 50;
  const zoom = a?.zoom ?? 1;
  const set = (patch: Partial<NonNullable<typeof a>>) => a && ops.setImage(sel.id, { ...a, ...patch });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" onClick={() => ops.pickImage((key) => ops.setImage(sel.id, { key, fx: 50, fy: 50 }))}>
          <ImagePlus className="w-3.5 h-3.5" /> 사진 바꾸기
        </button>
        {a && sel.node.origin !== "add" ? (
          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => ops.setImage(sel.id, null)}>
            <RotateCcw className="w-3.5 h-3.5" /> 원래 사진으로
          </button>
        ) : null}
      </div>
      {a ? (
        <div className="grid grid-cols-[64px_1fr_36px] items-center gap-x-2 gap-y-1 text-xs">
          <label htmlFor="st-fx" className="cd-text-muted">
            가로 초점
          </label>
          <input id="st-fx" type="range" min={0} max={100} value={fx} onChange={(e) => set({ fx: Number(e.target.value) })} />
          <span className="tabular-nums cd-text-faint text-right">{fx}%</span>
          <label htmlFor="st-fy" className="cd-text-muted">
            세로 초점
          </label>
          <input id="st-fy" type="range" min={0} max={100} value={fy} onChange={(e) => set({ fy: Number(e.target.value) })} />
          <span className="tabular-nums cd-text-faint text-right">{fy}%</span>
          <label htmlFor="st-zoom" className="cd-text-muted">
            확대(자르기)
          </label>
          <input id="st-zoom" type="range" min={1} max={3} step={0.05} value={zoom} onChange={(e) => set({ zoom: Number(e.target.value) })} />
          <span className="tabular-nums cd-text-faint text-right">{zoom.toFixed(2)}</span>
          <label htmlFor="st-fit" className="cd-text-muted">
            맞춤
          </label>
          <select id="st-fit" className="cd-select col-span-2" value={a.fit ?? "cover"} onChange={(e) => set({ fit: e.target.value as "cover" | "contain" })}>
            <option value="cover">틀 채우기(잘림)</option>
            <option value="contain">전체 보기(여백)</option>
          </select>
        </div>
      ) : (
        <p className="text-xs cd-text-faint">원래 그림입니다. [사진 바꾸기]로 회사소개서 사진·로고 중에서 고르거나 새로 올립니다.</p>
      )}
    </div>
  );
}

/** 인포그래픽 내용(중립 구조) 편집 — 유형을 바꿔도 이 내용은 그대로 */
function InfoContentEditor({ sel, ops }: { sel: Selection; ops: PanelProps["ops"] }) {
  const p = sel.node.props as unknown as InfoSlotProps;
  const spec: InfoSpec = p.spec;
  const content = spec.content;
  const meta = INFO_TYPE_META[spec.type];
  const numeric = content.items.some((it) => it.value != null);
  const hasDesc = content.items.some((it) => it.desc) || meta.maxDesc > 0;
  const hasWhen = content.items.some((it) => it.when) || meta.needs === "when";
  const save = (c: InfoContent) => ops.setInfo(sel.id, { content: c }, p.slot);
  const setItem = (i: number, patch: Partial<InfoItem>) => save({ ...content, items: content.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  const moveItem = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= content.items.length) return;
    const items = [...content.items];
    [items[i], items[j]] = [items[j], items[i]];
    save({ ...content, items });
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs cd-text-muted flex items-center gap-1">
        내용 {content.items.length}항목 · 지금 유형 {meta.label} <CdHelp topic="catalog.studio-infographic" />
      </div>
      {content.title != null || content.center ? (
        <label className="text-xs cd-text-muted flex flex-col gap-0.5">
          가운데 글(허브·순환)
          <input className="cd-input" value={content.center?.label ?? content.title ?? ""} onChange={(e) => save({ ...content, center: { ...(content.center ?? {}), label: e.target.value } })} />
        </label>
      ) : null}
      <ol className="flex flex-col gap-1.5">
        {content.items.map((it, i) => (
          <li key={it.id} className="rounded-lg border cd-border-c p-1.5 flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <span className="text-[11px] cd-text-faint tabular-nums w-4">{i + 1}</span>
              <input className="cd-input flex-1" aria-label={`${i + 1}번 항목 이름`} value={it.label} onChange={(e) => setItem(i, { label: e.target.value })} />
              {numeric ? (
                <input
                  className="cd-input"
                  style={{ width: 64 }}
                  aria-label={`${i + 1}번 항목 값`}
                  inputMode="decimal"
                  value={it.value ?? ""}
                  onChange={(e) => setItem(i, { value: e.target.value === "" ? undefined : Number(e.target.value) || 0, valueText: undefined })}
                />
              ) : null}
            </div>
            {hasDesc ? <input className="cd-input" aria-label={`${i + 1}번 항목 설명`} placeholder="설명" value={it.desc ?? ""} onChange={(e) => setItem(i, { desc: e.target.value || undefined })} /> : null}
            {hasWhen ? <input className="cd-input" aria-label={`${i + 1}번 항목 시점`} placeholder="시점(예: 2030)" value={it.when ?? ""} onChange={(e) => setItem(i, { when: e.target.value || undefined })} /> : null}
            <div className="flex items-center gap-0.5">
              <button type="button" className="cd-icon-button cd-icon-button-sm" aria-label={`${i + 1}번 항목 위로`} onClick={() => moveItem(i, -1)} disabled={i === 0}>
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button type="button" className="cd-icon-button cd-icon-button-sm" aria-label={`${i + 1}번 항목 아래로`} onClick={() => moveItem(i, 1)} disabled={i === content.items.length - 1}>
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                className="cd-icon-button cd-icon-button-sm ml-auto"
                aria-label={`${i + 1}번 항목 삭제`}
                onClick={() => save({ ...content, items: content.items.filter((_, j) => j !== i) })}
                disabled={content.items.length <= 1}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          className="cd-btn cd-btn-ghost cd-btn-sm"
          onClick={() => save({ ...content, items: [...content.items, { id: newUserId(), label: "새 항목", ...(numeric ? { value: 0 } : {}) }] })}
          disabled={content.items.length >= 20}
        >
          <Copy className="w-3.5 h-3.5" /> 항목 추가
        </button>
        <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => ops.setInfo(sel.id, { content: undefined }, p.slot)}>
          <RotateCcw className="w-3.5 h-3.5" /> 내용 원래대로
        </button>
      </div>
    </div>
  );
}
