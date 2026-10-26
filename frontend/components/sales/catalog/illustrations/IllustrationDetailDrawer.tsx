"use client";

// 일러스트 상세(오른쪽 드로어) — 그림 위 글자 자리 고치기(끌어 옮기기·모서리로 크기·방향키) · 정보(이름·유형·항목 수·품질) · 라이선스 · 쓰는 곳 · 빼기.
// 글자 자리 = 스튜디오가 내용(항목 제목·설명·숫자)을 얹는 상자. 역할과 항목 번호로 내용과 짝짓는다.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { CdDrawer } from "@/components/cdash/CdModal";
import { CdHelp } from "@/components/cdash/CdHelp";
import { INFO_TYPES, type InfoType } from "@/lib/catalog/render/infographic/types";
import { ILLUST_SLOT_BINDS, ILLUST_SLOT_ROLES, defaultBind, type IllustLicense, type IllustSlot, type IllustSlotBind, type IllustSlotRole, type IllustrationInfo } from "@/lib/catalog/illustration-types";
import { catalogFetch } from "../catalogFetch";
import { svgUrl } from "./CatalogIllustrationsBoard";
import { LICENSE_KINDS } from "./IllustrationImportModal";

const ROLE_COLOR: Record<IllustSlotRole, string> = { title: "#d33b3b", sub: "#c27a00", desc: "#2f6fd6", number: "#13893f", center: "#8f3fb8", heading: "#555" };
const roleLabel = (r: IllustSlotRole) => ILLUST_SLOT_ROLES.find((x) => x.id === r)?.label ?? r;
const bindLabel = (b: IllustSlotBind) => ILLUST_SLOT_BINDS.find((x) => x.id === b)?.label ?? b;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const r4 = (v: number) => Math.round(v * 10000) / 10000;

interface Usage {
  pages: string[];
  versions: number;
  editions: number;
}

export function IllustrationDetailDrawer({
  info,
  onClose,
  onSaved,
  onRemoved,
}: {
  info: IllustrationInfo | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
  onRemoved: (msg: string) => void;
}) {
  const [slots, setSlots] = useState<IllustSlot[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<InfoType>("process");
  const [count, setCount] = useState(1);
  const [center, setCenter] = useState(false);
  const [quality, setQuality] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [license, setLicense] = useState<IllustLicense>({ provider: "" });
  const [usage, setUsage] = useState<Usage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; mode: "move" | "size"; x: number; y: number; start: IllustSlot } | null>(null);

  useEffect(() => {
    if (!info) return;
    setSlots(info.slots);
    setSel(null);
    setTitle(info.title);
    setType(info.type);
    setCount(info.count);
    setCenter(info.center);
    setQuality(info.quality);
    setNote(info.note);
    setLicense(info.license);
    setError(null);
    setUsage(null);
    catalogFetch<{ usage: Usage }>(`/api/catalog/illustrations/${encodeURIComponent(info.assetId)}`)
      .then((r) => setUsage(r.usage))
      .catch(() => setUsage(null));
  }, [info]);

  if (!info) return null;
  const selSlot = slots.find((s) => s.id === sel) ?? null;
  const patchSlot = (id: string, p: Partial<IllustSlot>) => setSlots((list) => list.map((s) => (s.id === id ? { ...s, ...p } : s)));

  const onPointerDown = (e: ReactPointerEvent, s: IllustSlot, mode: "move" | "size") => {
    e.preventDefault();
    e.stopPropagation();
    setSel(s.id);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { id: s.id, mode, x: e.clientX, y: e.clientY, start: s };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    const box = boxRef.current?.getBoundingClientRect();
    if (!d || !box) return;
    const dx = (e.clientX - d.x) / box.width;
    const dy = (e.clientY - d.y) / box.height;
    if (d.mode === "move") patchSlot(d.id, { x: r4(clamp(d.start.x + dx, -0.1, 1 - d.start.w * 0.2)), y: r4(clamp(d.start.y + dy, -0.1, 1)) });
    else patchSlot(d.id, { w: r4(clamp(d.start.w + dx, 0.01, 1.2)), h: r4(clamp(d.start.h + dy, 0.005, 1.2)) });
  };
  const onKey = (e: React.KeyboardEvent, s: IllustSlot) => {
    const step = e.shiftKey ? 0.02 : 0.005;
    const map: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = map[e.key];
    if (m) {
      e.preventDefault();
      if (e.altKey) patchSlot(s.id, { w: r4(clamp(s.w + m[0], 0.01, 1.2)), h: r4(clamp(s.h + m[1], 0.005, 1.2)) });
      else patchSlot(s.id, { x: r4(s.x + m[0]), y: r4(s.y + m[1]) });
    } else if (e.key === "Delete") {
      e.preventDefault();
      setSlots((list) => list.filter((x) => x.id !== s.id));
      setSel(null);
    }
  };
  const addSlot = () => {
    const id = `s${Math.max(0, ...slots.map((s) => Number(s.id.slice(1)) || 0)) + 1}`;
    const s: IllustSlot = { id, role: "title", item: 1, x: 0.4, y: 0.45, w: 0.2, h: 0.05, lines: 1, fs: 0.02, lh: 1.3, align: "left" };
    setSlots((list) => [...list, s]);
    setSel(id);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await catalogFetch(`/api/catalog/illustrations/${encodeURIComponent(info.assetId)}`, {
        method: "PATCH",
        body: JSON.stringify({ title, type, count, center, quality, note, slots, license }),
      });
      onSaved("일러스트 정보를 저장했습니다.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const restore = async () => {
    setBusy(true);
    try {
      await catalogFetch(`/api/catalog/illustrations/${encodeURIComponent(info.assetId)}`, { method: "PATCH", body: JSON.stringify({ status: "active" }) });
      onSaved("라이브러리에 다시 꺼냈습니다.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    const used = usage && (usage.pages.length || usage.versions || usage.editions);
    if (!window.confirm(used ? `이 일러스트는 쪽 ${usage!.pages.length}곳·버전 ${usage!.versions}개·발행본 ${usage!.editions}개가 씁니다. 라이브러리에서만 숨기고(보관) 그 쪽은 그대로 둘까요?` : `'${info.title}'를 지울까요? 파일도 함께 지웁니다.`)) return;
    setBusy(true);
    try {
      const out = await catalogFetch<{ action: string }>(`/api/catalog/illustrations/${encodeURIComponent(info.assetId)}`, { method: "DELETE" });
      onRemoved(out.action === "archived" ? "쓰는 쪽이 있어 보관했습니다(라이브러리에서만 숨김)." : "일러스트를 지웠습니다.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const itemMax = Math.max(count, ...slots.map((s) => s.item));
  return (
    <CdDrawer
      open
      onClose={onClose}
      title={info.title}
      widthClass="max-w-3xl"
      footer={
        <>
          {info.status === "archived" ? (
            <button type="button" className="cd-btn cd-btn-ghost mr-auto" onClick={() => void restore()} disabled={busy}>
              다시 꺼내기
            </button>
          ) : (
            <button type="button" className="cd-btn cd-btn-ghost mr-auto" onClick={() => void remove()} disabled={busy}>
              <Trash2 className="w-4 h-4" /> 빼기
            </button>
          )}
          <button type="button" className="cd-btn cd-btn-ghost" onClick={onClose} disabled={busy}>
            닫기
          </button>
          <button type="button" className="cd-btn cd-btn-primary" onClick={() => void save()} disabled={busy}>
            <Save className="w-4 h-4" /> 저장
          </button>
        </>
      }
    >
      <div className="p-4 flex flex-col gap-4 text-sm">
        {error ? <div className="cd-error-bg cd-error-text rounded-lg px-3 py-2">{error}</div> : null}
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold cd-text flex items-center gap-1">
            글자 자리 {slots.length}개 <CdHelp topic="catalog.illustrations-slots" />
            <button type="button" className="cd-btn cd-btn-soft cd-btn-sm ml-auto" onClick={addSlot}>
              <Plus className="w-3.5 h-3.5" /> 자리 더하기
            </button>
          </h3>
          <div
            ref={boxRef}
            className="relative rounded border cd-border-c select-none"
            style={{ background: "#fff", aspectRatio: `${info.view[0]} / ${info.view[1]}` }}
            onPointerMove={onPointerMove}
            onPointerUp={() => (drag.current = null)}
            onPointerDown={() => setSel(null)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={svgUrl(info.assetId)} alt="" className="absolute inset-0 w-full h-full" draggable={false} />
            {slots.map((s) => (
              <button
                key={s.id}
                type="button"
                className="absolute text-left"
                style={{
                  left: `${s.x * 100}%`,
                  top: `${s.y * 100}%`,
                  width: `${s.w * 100}%`,
                  height: `${Math.max(s.h * 100, 1.2)}%`,
                  outline: `${sel === s.id ? 2 : 1}px solid ${ROLE_COLOR[s.role]}`,
                  background: sel === s.id ? "rgba(255,255,255,.55)" : "rgba(255,255,255,.25)",
                  cursor: "move",
                  fontSize: 10,
                  lineHeight: "11px",
                  color: ROLE_COLOR[s.role],
                }}
                aria-label={`${roleLabel(s.role)}${s.item ? ` ${s.item}번 항목` : ""} 자리 — 방향키로 옮기고 Alt+방향키로 크기, Delete 로 지웁니다`}
                aria-pressed={sel === s.id}
                onPointerDown={(e) => onPointerDown(e, s, "move")}
                onFocus={() => setSel(s.id)}
                onKeyDown={(e) => onKey(e, s)}
              >
                <span style={{ background: "#fff", padding: "0 2px" }}>
                  {roleLabel(s.role)}
                  {s.item ? ` ${s.item}` : ""}
                  {s.src === "user" ? " ●" : ""}
                </span>
                <span
                  aria-hidden
                  onPointerDown={(e) => onPointerDown(e, s, "size")}
                  style={{ position: "absolute", right: -4, bottom: -4, width: 8, height: 8, background: ROLE_COLOR[s.role], cursor: "nwse-resize" }}
                />
              </button>
            ))}
          </div>
          {selSlot ? (
            <div className="flex flex-wrap items-end gap-2 text-xs">
              <label className="cd-text-muted flex flex-col gap-1">
                역할
                <select className="cd-select" style={{ width: 110 }} value={selSlot.role} onChange={(e) => patchSlot(selSlot.id, { role: e.target.value as IllustSlotRole, ...(["center", "heading"].includes(e.target.value) ? { item: 0 } : {}) })}>
                  {ILLUST_SLOT_ROLES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="cd-text-muted flex flex-col gap-1">
                항목 번호
                <select className="cd-select" style={{ width: 90 }} value={selSlot.item} onChange={(e) => patchSlot(selSlot.id, { item: Number(e.target.value) })} disabled={selSlot.role === "center" || selSlot.role === "heading"}>
                  <option value={0}>없음</option>
                  {Array.from({ length: itemMax }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="cd-text-muted flex flex-col gap-1">
                내용(얹을 칸)
                <select
                  className="cd-select"
                  style={{ width: 130 }}
                  value={selSlot.bind ?? ""}
                  onChange={(e) => {
                    const v = e.target.value as IllustSlotBind | "";
                    patchSlot(selSlot.id, v ? { bind: v } : ({ bind: undefined } as Partial<IllustSlot>));
                  }}
                >
                  <option value="">자동 · {bindLabel(defaultBind(selSlot.role))}</option>
                  {ILLUST_SLOT_BINDS.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="cd-text-muted flex flex-col gap-1">
                줄 수
                <input className="cd-input" style={{ width: 64 }} type="number" min={1} max={12} value={selSlot.lines} onChange={(e) => patchSlot(selSlot.id, { lines: clamp(Number(e.target.value) || 1, 1, 12) })} />
              </label>
              <label className="cd-text-muted flex flex-col gap-1">
                정렬
                <select className="cd-select" style={{ width: 90 }} value={selSlot.align} onChange={(e) => patchSlot(selSlot.id, { align: e.target.value as IllustSlot["align"] })}>
                  <option value="left">왼쪽</option>
                  <option value="center">가운데</option>
                  <option value="right">오른쪽</option>
                </select>
              </label>
              <label className="cd-text-muted flex flex-col gap-1">
                글자 크기(그림 폭 ‰)
                <input
                  className="cd-input"
                  style={{ width: 90 }}
                  type="number"
                  step={0.5}
                  min={1}
                  max={200}
                  value={Math.round(selSlot.fs * 10000) / 10}
                  onChange={(e) => patchSlot(selSlot.id, { fs: clamp((Number(e.target.value) || 10) / 1000, 0.001, 0.2) })}
                />
              </label>
              <button
                type="button"
                className="cd-btn cd-btn-ghost cd-btn-sm"
                onClick={() => {
                  setSlots((list) => list.filter((x) => x.id !== selSlot.id));
                  setSel(null);
                }}
              >
                <Trash2 className="w-3.5 h-3.5" /> 자리 지우기
              </button>
            </div>
          ) : (
            <p className="text-[11px] cd-text-faint">자리를 눌러 고릅니다. 끌어 옮기고 오른쪽 아래 모서리로 크기를 바꿉니다(방향키 0.5%, Shift 2%, Alt+방향키 크기).</p>
          )}
          <details className="text-xs">
            <summary className="cd-text-muted cursor-pointer">
              자리 ↔ 내용 매핑 표{slots.some((s) => s.src === "user") ? ` · 직접 고친 자리 ${slots.filter((s) => s.src === "user").length}개(●, 다시 가져와도 유지)` : ""}
            </summary>
            <table className="cd-table mt-1">
              <thead>
                <tr>
                  <th>자리</th>
                  <th>역할</th>
                  <th>항목</th>
                  <th>내용</th>
                  <th>줄</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {slots.map((s) => (
                  <tr key={s.id} style={sel === s.id ? { background: "var(--cd-soft-primary)" } : undefined}>
                    <td>
                      <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => setSel(s.id)}>
                        {s.id}
                      </button>
                    </td>
                    <td>{roleLabel(s.role)}</td>
                    <td className="tabular-nums">{s.item || "—"}</td>
                    <td>
                      {bindLabel(s.bind ?? defaultBind(s.role))}
                      {s.bind ? "" : <span className="cd-text-faint">(자동)</span>}
                    </td>
                    <td className="tabular-nums">{s.lines}</td>
                    <td>{s.src === "user" ? "●" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>

        <section className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
          <label className="text-xs cd-text-muted flex flex-col gap-1">
            이름
            <input className="cd-input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="text-xs cd-text-muted flex flex-col gap-1">
            유형(기본 인포그래픽 16종 중)
            <select className="cd-select" value={type} onChange={(e) => setType(e.target.value as InfoType)}>
              {INFO_TYPES.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs cd-text-muted flex flex-col gap-1">
            항목 수(그림에 고정)
            <input className="cd-input" type="number" min={1} max={30} value={count} onChange={(e) => setCount(clamp(Number(e.target.value) || 1, 1, 30))} />
          </label>
          <label className="text-xs cd-text-muted flex flex-col gap-1">
            품질(1~5)
            <select className="cd-select" value={quality ?? ""} onChange={(e) => setQuality(e.target.value ? Number(e.target.value) : null)}>
              <option value="">—</option>
              {[1, 2, 3, 4, 5].map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs cd-text-muted flex items-center gap-1.5 self-end pb-2">
            <input type="checkbox" checked={center} onChange={(e) => setCenter(e.target.checked)} /> 중심 요소 있음
          </label>
          <label className="text-xs cd-text-muted flex flex-col gap-1" style={{ gridColumn: "1 / -1" }}>
            메모
            <input className="cd-input" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold cd-text flex items-center gap-1">
            라이선스 <CdHelp topic="catalog.illustrations-license" />
          </h3>
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
            <label className="text-xs cd-text-muted flex flex-col gap-1">
              출처
              <input className="cd-input" value={license.provider} onChange={(e) => setLicense({ ...license, provider: e.target.value })} />
            </label>
            <label className="text-xs cd-text-muted flex flex-col gap-1">
              스톡 번호
              <input className="cd-input" value={license.stockId ?? ""} onChange={(e) => setLicense({ ...license, stockId: e.target.value })} />
            </label>
            <label className="text-xs cd-text-muted flex flex-col gap-1">
              라이선스 종류
              <select className="cd-select" value={license.license ?? ""} onChange={(e) => setLicense({ ...license, license: e.target.value })}>
                <option value="">—</option>
                {[...new Set([...LICENSE_KINDS, license.license ?? ""])].filter(Boolean).map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <label className="text-xs cd-text-muted flex flex-col gap-1">
              구입일
              <input className="cd-input" placeholder="YYYY-MM-DD" value={license.purchasedAt ?? ""} onChange={(e) => setLicense({ ...license, purchasedAt: e.target.value })} />
            </label>
            <label className="text-xs cd-text-muted flex flex-col gap-1" style={{ gridColumn: "1 / -1" }}>
              원본 주소
              <input className="cd-input" value={license.url ?? ""} onChange={(e) => setLicense({ ...license, url: e.target.value })} />
            </label>
          </div>
          {license.file ? <p className="text-[11px] cd-text-faint">원본 파일: {license.file}</p> : null}
        </section>

        <section className="text-xs cd-text-muted flex flex-col gap-1">
          <h3 className="text-sm font-semibold cd-text">쓰는 곳</h3>
          {usage ? (
            usage.pages.length || usage.versions || usage.editions ? (
              <p>
                쪽 {usage.pages.length}곳{usage.pages.length ? `(${usage.pages.map((p) => p.split(":").pop()).join(", ")})` : ""} · 버전 {usage.versions}개 · 발행본 {usage.editions}개 — 빼면 보관됩니다(그 쪽은 그대로).
              </p>
            ) : (
              <p>아직 쓰는 쪽이 없습니다 — 빼면 파일까지 지웁니다.</p>
            )
          ) : (
            <p>확인하는 중…</p>
          )}
          {info.fits.length ? <p>매처 추천 자리: {info.fits.map((f) => `${f.page} ${f.title ?? ""} ${f.fit ?? ""}`.trim()).join(" · ")}</p> : null}
        </section>
      </div>
    </CdDrawer>
  );
}
