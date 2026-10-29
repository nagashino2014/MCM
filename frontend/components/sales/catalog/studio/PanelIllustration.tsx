"use client";

// 오른쪽 패널 · 디자인 탭 — 보유 일러스트(313). docs/company-catalog-blueprint.md §4-5
//   인포그래픽 자리: [일러스트로 그리기] — 내용은 그대로 두고 모양만 일러스트로. 일러스트는 그림에 항목 수가 고정이라 항목 수가 같은 것만 후보.
//   요소 추가: [일러스트] — 라이브러리에서 쪽 유형·항목 수·유형으로 걸러 추천순으로 고르면 쪽 위에 놓는다(12열 격자로 옮기고 크기 조절).
//   글은 캔버스의 글자 자리를 눌러 바로 고치고, 숫자 자리는 지표에 묶으면 데이터가 바뀌어도 최신 값이다.

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Link from "next/link";
import { Loader2, Plus, RotateCcw, Shapes } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";
import { CdHelp } from "@/components/cdash/CdHelp";
import {
  ILLUST_COLOR_MODES,
  fitsPage,
  groupCount,
  illustCandidates,
  sanitizeIllustColors,
  type IllustColors,
  type IllustrationInfo,
} from "@/lib/catalog/illustration-types";
import { illustrationRender, tintsOf } from "@/lib/catalog/render/infographic/illustration";
import { renderInfographic } from "@/lib/catalog/render/infographic/render";
import type { InfoSlotProps } from "@/lib/catalog/render/infographic/slot";
import { INFO_TYPES, INFO_TYPE_META, type InfoSpec, type InfoType } from "@/lib/catalog/render/infographic/types";
import type { Selection } from "@/lib/catalog/studio/select";
import { catalogFetch } from "../catalogFetch";
import { StaticFrame } from "./Frames";
import type { PanelProps } from "./types";
import { ensureIllustrations } from "./useStudio";

/** 무리마다 고를 수 있는 색(면 색 토큰) */
const GROUP_TOKENS = ["brand", "accent", "accent-2", "area-1-mid", "area-2-mid", "area-3-mid", "area-4-mid", "area-5-mid", "area-6-mid", "ci-gray", "ink"];
/** 항목마다 고를 수 있는 색 — 분야 키 색(표지 하단 분야 원과 같은 색)이 먼저 */
const ITEM_TOKENS = ["area-1", "area-2", "area-3", "area-4", "area-5", "area-6", ...GROUP_TOKENS];

let libraryCache: IllustrationInfo[] | null = null;

/** 라이브러리 목록(쓸 수 있는 것) — 패널을 다시 열어도 한 번만 받는다. reload 로 새로 */
export function useIllustrationLibrary() {
  const [items, setItems] = useState<IllustrationInfo[] | null>(libraryCache);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    try {
      const r = await catalogFetch<{ items: IllustrationInfo[] }>("/api/catalog/illustrations");
      libraryCache = r.items;
      setItems(r.items);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    if (!libraryCache) void load();
  }, []);
  return { items, error, reload: load };
}

/** 후보 SVG 를 받아 등록한 뒤 다시 그린다 */
function useEnsured(ids: string[]): boolean {
  const key = ids.join(",");
  const [ready, setReady] = useState(() => ids.every((id) => illustrationRender(id)));
  useEffect(() => {
    if (!key) return;
    let alive = true;
    setReady(key.split(",").every((id) => illustrationRender(id)));
    ensureIllustrations(key.split(","))
      .then(() => alive && setReady(true))
      .catch(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, [key]);
  return ready;
}

function previewHtml(spec: InfoSpec, box: { w: number; h: number }, studio: PanelProps["studio"], area: number): string {
  const theme = studio.state!.theme;
  return renderToStaticMarkup(
    (
      <div
        className={`kc-tpl--${theme.template} kc-concept--${theme.concept} kc-fontset--${studio.fontSet} kc-motif--${theme.motif} kc-area-${area}`}
        style={{ width: box.w, fontFamily: "var(--kc-font-body)", fontSize: 10.5, lineHeight: "17px", color: "var(--ink)", wordBreak: "keep-all" }}
      >
        {renderInfographic(spec, box, {}, area)}
      </div>
    ) as ReactElement
  );
}

/** 인포그래픽 자리 · 모양 = 보유 일러스트 */
export function IllustrationShapePicker({ studio, kit, item, sel, ops }: PanelProps & { sel: Selection }) {
  const slot = sel.node.props as unknown as InfoSlotProps;
  const spec = slot.spec;
  const added = sel.node.origin === "add";
  const { items, error } = useIllustrationLibrary();
  const all = useMemo(() => items ?? [], [items]);
  const candidates = useMemo(() => illustCandidates(all, spec.content, { type: spec.type, pageType: item.type, box: slot.box }).slice(0, 6), [all, spec.content, spec.type, item.type, slot.box]);
  const hiddenOther = all.filter((i) => i.count !== spec.content.items.length).length;
  const ready = useEnsured(candidates.map((c) => c.info.assetId).concat(spec.illust ? [spec.illust.asset] : []));
  const curRender = spec.illust ? illustrationRender(spec.illust.asset) : undefined;
  const cur = curRender?.info;
  const tints = curRender ? tintsOf(curRender) : [];
  // 라이브러리에 같은 일러스트의 새 판이 있으면(다시 가져오기로 이 판은 보관됨) 바꿀 수 있게
  const newer = cur && cur.status === "archived" ? all.find((i) => i.sourceKey === cur.sourceKey && i.status === "active" && i.assetId !== cur.assetId) : undefined;
  const setMap = (key: string, token: string) => {
    const map = { ...(colors.map ?? {}) };
    if (token) map[key] = token;
    else delete map[key];
    setIllust(cur!.assetId, { mode: colors.mode, ...(Object.keys(map).length ? { map } : {}) });
  };
  const colors: IllustColors = sanitizeIllustColors(spec.illust?.colors);
  const fit = spec.illust?.fit ?? "height";
  // nextFit 생략 = 지금 크기 유지. "height"(기본)는 fit 을 빼서 저장한다
  const setIllust = (asset: string, next?: IllustColors, nextFit: "width" | "height" = fit) =>
    ops.setInfo(sel.id, { illust: { asset, colors: next ?? colors, ...(nextFit === "width" ? { fit: nextFit } : {}) } }, slot.slot);
  const metrics = Object.values(studio.payload?.data.metrics ?? {}).filter((m): m is NonNullable<typeof m> => Boolean(m));
  const numberItems = cur ? [...new Set(cur.slots.filter((s) => s.role === "number" && s.item > 0).map((s) => s.item))].sort((a, b) => a - b) : [];
  const w = Math.min(268, slot.box.w);
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold cd-text flex items-center gap-1">
        <Shapes className="w-4 h-4" aria-hidden /> 일러스트로 그리기 <CdHelp topic="catalog.studio-illustration" />
      </h3>
      <p className="text-[11px] cd-text-muted">
        기본 인포그래픽 16종은 항목 수에 맞춰 늘고 줄어듭니다. 보유 일러스트는 그림에 항목 수가 고정돼 있어 <b>{spec.content.items.length}항목</b>짜리만 후보로 나옵니다. 내용(항목 글·숫자)은 그대로입니다.
      </p>
      {cur ? (
        <div className="rounded-lg border p-2 flex flex-col gap-2" style={{ borderColor: "var(--cd-primary)" }}>
          <p className="text-xs cd-text">
            지금 <b>{cur.title}</b> · {INFO_TYPE_META[cur.type].label} {cur.count}항목
            {newer ? (
              <button type="button" className="cd-btn cd-btn-soft cd-btn-sm ml-1" onClick={() => void ensureIllustrations([newer.assetId]).then(() => setIllust(newer.assetId))}>
                새 판으로 바꾸기
              </button>
            ) : null}
            <span className="block text-[11px] cd-text-faint">
              {[cur.license.provider, cur.license.stockId ? `#${cur.license.stockId}` : "", cur.license.license].filter(Boolean).join(" · ")}
            </span>
          </p>
          {!added ? (
            <div className="flex flex-col gap-1">
              <p className="text-xs cd-text-muted">크기</p>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="일러스트 크기">
                {(
                  [
                    ["height", "자리 높이에 맞춤"],
                    ["width", "자리 폭에 맞춤"],
                  ] as const
                ).map(([f, l]) => (
                  <button key={l} type="button" className="cd-chip cd-chip-sm" data-active={fit === f ? "true" : undefined} aria-pressed={fit === f} onClick={() => setIllust(cur.assetId, colors, f)}>
                    {l}
                  </button>
                ))}
              </div>
              {fit === "width" ? <p className="text-[11px] cd-text-faint">그림 높이가 늘어 아래 내용이 밀립니다. 쪽 아래 검사에서 넘침을 확인하세요.</p> : null}
            </div>
          ) : null}
          <div className="flex flex-col gap-1">
            <p className="text-xs cd-text-muted">색</p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="일러스트 색">
              {ILLUST_COLOR_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="cd-chip cd-chip-sm"
                  data-active={colors.mode === m.id ? "true" : undefined}
                  aria-pressed={colors.mode === m.id}
                  onClick={() => setIllust(cur.assetId, { mode: m.id, ...(colors.map ? { map: colors.map } : {}) })}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {tints.length ? (
              <div className="flex flex-col gap-1 text-[11px] cd-text-muted">
                <span>항목 색 — {colors.mode === "areas" ? "n번 항목 = n번 분야 색(표지 분야 원과 같은 색)" : "고른 항목만 그 색, 나머지는 위 색 모드"}</span>
                {tints.map((t) => {
                  const it = spec.content.items[t.n - 1];
                  return (
                    <label key={t.n} className="flex items-center gap-1.5">
                      <span className="w-28 truncate cd-text">
                        {t.n}. {it?.label ?? ""}
                      </span>
                      <select className="cd-select flex-1" aria-label={`${t.n}번 항목 색`} value={colors.map?.[`i${t.n}`] ?? ""} onChange={(e) => setMap(`i${t.n}`, e.target.value)}>
                        <option value="">{colors.mode === "areas" ? `자동(area-${((t.n - 1) % 6) + 1})` : "자동"}</option>
                        {ITEM_TOKENS.map((tk) => (
                          <option key={tk} value={tk}>
                            {tk}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </div>
            ) : null}
            {groupCount(cur.palette) > 0 ? (
              <div className="flex flex-wrap gap-1.5 items-center text-[11px] cd-text-muted">
                {Array.from({ length: Math.min(6, groupCount(cur.palette)) }, (_, g) => {
                  const hex = cur.palette.find((p) => p.group === g && Math.abs(p.shade ?? 0) < 0.05)?.hex ?? cur.palette.find((p) => p.group === g)?.hex;
                  return (
                    <label key={g} className="inline-flex items-center gap-1">
                      <span aria-hidden className="inline-block w-3 h-3 rounded-sm border cd-border-c" style={{ background: hex }} />
                      <select
                        className="cd-select"
                        style={{ width: 104 }}
                        aria-label={`색 무리 ${g + 1}`}
                        value={colors.map?.[String(g)] ?? ""}
                        onChange={(e) => setMap(String(g), e.target.value)}
                      >
                        <option value="">자동</option>
                        {GROUP_TOKENS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </div>
            ) : null}
          </div>
          {numberItems.length ? (
            <div className="flex flex-col gap-1">
              <p className="text-xs cd-text-muted">숫자 자리 — 지표에 묶으면 데이터가 바뀌어도 최신 값(지표 칩)</p>
              {numberItems.map((n) => {
                const it = spec.content.items[n - 1];
                if (!it) return null;
                return (
                  <label key={n} className="text-[11px] cd-text-muted flex items-center gap-1.5">
                    <span className="w-24 truncate cd-text">
                      {n}. {it.label}
                    </span>
                    <select
                      className="cd-select flex-1"
                      value={it.metric ?? ""}
                      onChange={(e) =>
                        ops.setInfo(
                          sel.id,
                          {
                            content: {
                              ...spec.content,
                              items: spec.content.items.map((x, j) => {
                                if (j !== n - 1) return x;
                                const { metric: _m, valueText: _v, ...rest } = x;
                                void _m;
                                void _v;
                                return e.target.value ? { ...rest, metric: e.target.value } : rest;
                              }),
                            },
                          },
                          slot.slot
                        )
                      }
                    >
                      <option value="">지표 없음(글로 쓰기)</option>
                      {metrics.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label} · {m.value ?? "—"}
                          {m.unit}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
          ) : null}
          {!added ? (
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm self-start" onClick={() => ops.setInfo(sel.id, { illust: null }, slot.slot)}>
              <RotateCcw className="w-3.5 h-3.5" /> 기본 도식으로
            </button>
          ) : (
            <p className="text-[11px] cd-text-faint">쪽 위에 넣은 일러스트입니다. 빼려면 Delete.</p>
          )}
        </div>
      ) : null}
      {error ? <p className="text-xs cd-error-text">{error}</p> : null}
      {items == null ? (
        <p className="text-xs cd-text-faint inline-flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" /> 라이브러리를 불러오는 중…
        </p>
      ) : candidates.length === 0 ? (
        <p className="text-xs cd-text-faint">
          {spec.content.items.length}항목에 맞는 보유 일러스트가 없습니다{hiddenOther ? `(다른 항목 수 ${hiddenOther}점은 숨김)` : ""}.{" "}
          <Link className="underline" href="/sales/catalog/illustrations">
            일러스트 라이브러리
          </Link>
          에서 더하세요.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {candidates.map((c) => {
            const on = spec.illust?.asset === c.info.assetId;
            const pspec: InfoSpec = { ...spec, illust: { asset: c.info.assetId, colors: on ? colors : { mode: "area" } } };
            const srcH = Math.max(80, Math.round(Math.min(slot.box.w, slot.box.h ? slot.box.h * (c.info.view[0] / c.info.view[1]) : slot.box.w) / (c.info.view[0] / c.info.view[1])) + 8);
            return (
              <li key={c.info.assetId}>
                <button
                  type="button"
                  className="cd-action w-full text-left rounded-lg border p-1.5 flex flex-col gap-1"
                  style={{ borderColor: on ? "var(--cd-primary)" : "var(--cd-border)" }}
                  aria-pressed={on}
                  aria-label={`${c.info.title} 일러스트로 그리기 — ${c.reasons.join(", ")}`}
                  onClick={() => setIllust(c.info.assetId, on ? colors : { mode: "area" })}
                >
                  <span className="flex items-center gap-1 text-xs">
                    <b className="cd-text line-clamp-1">{c.info.title}</b>
                    {on ? <span className="cd-pill cd-pill-info">지금</span> : null}
                    {c.overflow ? <span className="cd-pill cd-pill-warn">글자 넘침 {c.overflow}</span> : null}
                    <span className="ml-auto tabular-nums cd-text-faint">{c.score}</span>
                  </span>
                  <span className="rounded border cd-border-c overflow-hidden" style={{ background: "#fff" }}>
                    {ready ? (
                      <StaticFrame kit={kit} fontSet={studio.fontSet} html={previewHtml(pspec, slot.box, studio, slot.area ?? 1)} width={w} srcW={slot.box.w} srcH={srcH} title={`${c.info.title} 미리보기`} />
                    ) : (
                      <span className="block text-[11px] cd-text-faint p-2">그림을 불러오는 중…</span>
                    )}
                  </span>
                  <span className="text-[11px] cd-text-muted">{c.reasons.join(" · ")}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** [일러스트 넣기] — 라이브러리에서 고르기(쪽 유형·항목 수·유형, 추천순) */
export function IllustrationLibraryModal({ open, pageType, onClose, onPick }: { open: boolean; pageType: string; onClose: () => void; onPick: (info: IllustrationInfo) => Promise<void> | void }) {
  const { items, error, reload } = useIllustrationLibrary();
  const [onlyPage, setOnlyPage] = useState(true);
  const [type, setType] = useState<InfoType | "">("");
  const [count, setCount] = useState<number | "">("");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (open) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const all = useMemo(() => (items ?? []).filter((i) => i.slots.length > 0), [items]);
  const counts = useMemo(() => [...new Set(all.map((i) => i.count))].sort((a, b) => a - b), [all]);
  const pageHits = all.filter((i) => fitsPage(i, pageType)).length;
  const shown = useMemo(() => {
    const rank = (i: IllustrationInfo) => {
      const f = fitsPage(i, pageType);
      return (f ? (f.fit === "상" ? 30 : f.fit === "중" ? 20 : 10) : 0) + (i.quality ?? 0) * 2;
    };
    return all
      .filter((i) => (!onlyPage || !pageHits || fitsPage(i, pageType)) && (!type || i.type === type || i.altTypes.includes(type)) && (count === "" || i.count === count))
      .sort((a, b) => rank(b) - rank(a) || a.title.localeCompare(b.title, "ko"));
  }, [all, onlyPage, pageHits, pageType, type, count]);
  return (
    <CdModal open={open} onClose={onClose} title="일러스트 넣기" size="xl">
      <div className="p-4 flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="inline-flex items-center gap-1.5 cd-text-muted">
            <input type="checkbox" checked={onlyPage && pageHits > 0} disabled={!pageHits} onChange={(e) => setOnlyPage(e.target.checked)} /> 이 쪽({pageType}) 추천만 {pageHits ? `(${pageHits})` : "(없음)"}
          </label>
          <label className="cd-text-muted flex items-center gap-1.5">
            유형
            <select className="cd-select" style={{ width: 130 }} value={type} onChange={(e) => setType(e.target.value as InfoType | "")}>
              <option value="">전체</option>
              {INFO_TYPES.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="cd-text-muted flex items-center gap-1.5">
            항목 수
            <select className="cd-select" style={{ width: 90 }} value={count} onChange={(e) => setCount(e.target.value ? Number(e.target.value) : "")}>
              <option value="">전체</option>
              {counts.map((n) => (
                <option key={n} value={n}>
                  {n}항목
                </option>
              ))}
            </select>
          </label>
          <CdHelp topic="catalog.studio-illustration" />
          <Link className="cd-btn cd-btn-ghost cd-btn-sm cd-action ml-auto" href="/sales/catalog/illustrations">
            라이브러리 관리
          </Link>
        </div>
        {error ? <p className="cd-error-text text-xs">{error}</p> : null}
        {items == null ? (
          <p className="text-xs cd-text-faint">불러오는 중…</p>
        ) : shown.length === 0 ? (
          <p className="text-xs cd-text-faint">조건에 맞는 일러스트가 없습니다. 거르기를 풀거나 라이브러리에서 더하세요.</p>
        ) : (
          <ul className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
            {shown.map((i) => {
              const f = fitsPage(i, pageType);
              return (
                <li key={i.assetId}>
                  <button
                    type="button"
                    className="cd-action w-full text-left rounded-lg border cd-border-c p-2 flex flex-col gap-1.5"
                    disabled={busy != null}
                    aria-label={`${i.title} 넣기`}
                    onClick={async () => {
                      setBusy(i.assetId);
                      try {
                        await onPick(i);
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    <span className="block rounded border cd-border-c overflow-hidden" style={{ background: "#fff", aspectRatio: "4 / 3" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/catalog/illustrations/${i.assetId}/file?f=thumb&v=${encodeURIComponent(i.updatedAt)}`} alt="" className="w-full h-full" style={{ objectFit: "contain" }} loading="lazy" />
                    </span>
                    <span className="text-xs cd-text font-medium line-clamp-1">{i.title}</span>
                    <span className="flex flex-wrap gap-1 text-[11px]">
                      <span className="cd-pill cd-pill-info">{INFO_TYPE_META[i.type].label}</span>
                      <span className="cd-pill cd-pill-idle">{i.count}항목</span>
                      {f ? <span className="cd-pill cd-pill-success">{f.page} 추천 {f.fit}</span> : null}
                      {busy === i.assetId ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-[11px] cd-text-faint inline-flex items-center gap-1">
          <Plus className="w-3 h-3" aria-hidden /> 넣은 일러스트는 쪽 위에 놓입니다. 손잡이로 옮기고(12열 격자) 글자 자리를 눌러 글을 고칩니다. 인포그래픽 자리를 일러스트로 바꾸려면 그 인포그래픽을 고르세요.
        </p>
      </div>
    </CdModal>
  );
}
