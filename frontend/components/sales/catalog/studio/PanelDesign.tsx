"use client";

// 오른쪽 패널 · 디자인 탭 — L2 구조(쪽 변형·인포그래픽 유형·열 수·사진 배치·색 컨셉)와 L3 자유 배치(크기·글자 크기·토큰 색·요소 추가).
// 자유도는 디자인 시스템 안: 색 = 토큰 팔레트, 글자 크기 = 타입 스케일 단계, 폭 = 12열 묶음, 위치 = 그리드·4pt 맞춤.

import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ImagePlus, Loader2, RotateCcw, Shapes, Sparkles, Square, Trash2, Type } from "lucide-react";
import { CdHelp } from "@/components/cdash/CdHelp";
import { COLOR_CONCEPTS, COVER_DESIGNS } from "@/lib/catalog/document-theme";
import { renderInfographic } from "@/lib/catalog/render/infographic/render";
import { matchInfographic } from "@/lib/catalog/render/infographic/match";
import { INFO_TYPE_META, type InfoColorMode, type InfoSpec, type InfoType } from "@/lib/catalog/render/infographic/types";
import type { InfoSlotProps } from "@/lib/catalog/render/infographic/slot";
import { resolveColor, type DesignTokens } from "@/lib/print-kit/tokens";
import tokensJson from "@/lib/catalog/render/tokens.json";
import { FILL_COLORS, PHOTO_RATIOS, PICKABLE_TYPE_STEPS, TEXT_COLORS, spanWidth } from "@/lib/catalog/studio/design-system";
import { pageState } from "@/lib/catalog/studio/doc";
import { gridColumnsOf, type Selection } from "@/lib/catalog/studio/select";
import type { CNode } from "@/lib/catalog/studio/nodes";
import { fetchRank, type RankResponse } from "./aiClient";
import { StaticFrame } from "./Frames";
import { GRID_NOTE } from "./StudioCanvas";
import type { PanelProps } from "./types";

const TOKENS = tokensJson as unknown as DesignTokens;
const swatch = (name: string, concept: string) => {
  try {
    return resolveColor(TOKENS.color.tokens, name, concept, "navy");
  } catch {
    return "#ccc";
  }
};

function Chip({ active, onClick, children, label }: { active: boolean; onClick: () => void; children: ReactNode; label?: string }) {
  return (
    <button type="button" className="cd-chip cd-chip-sm" data-active={active ? "true" : undefined} aria-pressed={active} aria-label={label} onClick={onClick}>
      {children}
    </button>
  );
}

export function PanelDesign(props: PanelProps) {
  const { studio, item, composed, sel, caps, ops } = props;
  const theme = studio.state?.theme;
  const variant = pageState(studio.state?.pages ?? [], item.key).edits.variant ?? {};
  if (!theme) return null;
  return (
    <div className="flex flex-col gap-4">
      {sel?.kind === "infographic" && caps?.infographic ? <InfoTypePicker {...props} sel={sel} /> : null}

      {sel && caps ? <ElementDesign {...props} sel={sel} /> : null}

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold cd-text">쪽 변형</h3>
        {item.key === "c01" ? (
          <>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="표지 디자인">
              {COVER_DESIGNS.map((c) => (
                <Chip key={c.id} active={theme.cover === c.id} onClick={() => studio.setTheme({ cover: c.id })}>
                  {c.label}
                  {c.confirmed ? "" : " (확정 전)"}
                </Chip>
              ))}
            </div>
            <label className="text-xs cd-text-muted flex items-center gap-1.5">
              <input type="checkbox" checked={theme.coverPhoto === "none"} onChange={(e) => studio.setTheme({ coverPhoto: e.target.checked ? "none" : "photo" })} />
              사진 없는 변형
            </label>
          </>
        ) : /^area-x[a-z0-9]{6}$/.test(item.key) ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs cd-text-muted">AI 편집으로 더한 새 사업 분야 쪽입니다. 내용은 [AI로 수정]이나 글 고치기로 바꿉니다.</p>
            {props.onRemoveCustomArea ? (
              <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm self-start" onClick={() => props.onRemoveCustomArea?.(item.key.slice(5))}>
                <Trash2 className="w-3.5 h-3.5" /> 이 분야 쪽 빼기
              </button>
            ) : null}
          </div>
        ) : item.key.startsWith("area-") ? (
          <PhotoVariant label="분야 히어로" field="hero" values={[["figure", "숫자(사진 없음)"], ["photo", "사진"]]} variant={variant} ops={ops} />
        ) : item.key === "c05" ? (
          <PhotoVariant label="오른쪽 그림" field="visual" values={[["logo", "로고 판"], ["photo", "사진"]]} variant={variant} ops={ops} />
        ) : (
          <p className="text-xs cd-text-faint">이 쪽 유형은 고를 변형이 없습니다. 요소를 골라 인포그래픽 유형·열 수·사진 배치를 바꿉니다.</p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold cd-text flex items-center gap-1">
          색 컨셉(문서 전체) <CdHelp topic="catalog.studio-design" />
        </h3>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="색 컨셉">
          {COLOR_CONCEPTS.map((c) => (
            <Chip key={c.id} active={theme.concept === c.id} onClick={() => studio.setTheme({ concept: c.id })}>
              <span aria-hidden className="inline-block w-3 h-3 rounded-sm" style={{ background: swatch("field", c.id) }} />
              {c.label}
            </Chip>
          ))}
        </div>
      </section>

      {item.maxLevel >= 3 ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold cd-text">요소 추가</h3>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => ops.addElement("text")}>
              <Type className="w-3.5 h-3.5" /> 글상자
            </button>
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => ops.addElement("shape")}>
              <Square className="w-3.5 h-3.5" /> 도형
            </button>
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => ops.pickImage((key) => ops.addElement("image", key))}>
              <ImagePlus className="w-3.5 h-3.5" /> 이미지
            </button>
          </div>
          <p className="text-[11px] cd-text-faint">{GRID_NOTE}</p>
        </section>
      ) : null}
    </div>
  );
}

function PhotoVariant({
  label,
  field,
  values,
  variant,
  ops,
}: {
  label: string;
  field: string;
  values: Array<[string, string]>;
  variant: Record<string, string>;
  ops: PanelProps["ops"];
}) {
  const cur = variant[field] ?? values[0][0];
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs cd-text-muted">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {values.map(([v, l]) => (
          <Chip
            key={v}
            active={cur === v}
            onClick={() => {
              if (v === "photo" && !variant.photo) ops.pickImage((key) => (ops.setVariant("photo", key), ops.setVariant(field, "photo")));
              else ops.setVariant(field, v === values[0][0] ? null : v);
            }}
          >
            {l}
          </Chip>
        ))}
        {cur === "photo" ? (
          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => ops.pickImage((key) => ops.setVariant("photo", key))}>
            <ImagePlus className="w-3.5 h-3.5" /> 사진 고르기
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** 고른 요소의 구조·배치 */
function ElementDesign({ studio, composed, sel, caps, ops }: PanelProps & { sel: Selection }) {
  const n = sel.node;
  const theme = studio.state!.theme;
  const edit = composed.state?.edits.nodes?.[sel.id];
  const cols = gridColumnsOf(n);
  const currentStep = n.origin === "add" ? n.typeStep : edit?.type;
  const frameOf = (): CNode | null => {
    const p = sel.parent;
    if (p && /\b(kc-photo|kc-ratio-|kc-front__window|kc-x-image)/.test(p.className ?? "")) return p;
    return null;
  };
  if (!caps) return null;
  const any = caps.columns || caps.photoLayout || caps.resize || caps.typeStep || caps.color;
  if (!any) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold cd-text">고른 요소</h3>
      {n.origin === "add" && n.className?.includes("kc-x-shape") ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs cd-text-muted">도형 모양</p>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["rect", "사각"],
                ["round", "둥근 사각"],
                ["circle", "원"],
                ["line", "선"],
              ] as const
            ).map(([shape, label]) => (
              <Chip key={shape} active={n.className?.includes(`kc-x-shape--${shape}`) ?? false} onClick={() => ops.setShape(sel.id, shape)}>
                {label}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}
      {caps.columns && cols != null ? (
        <label className="text-xs cd-text-muted flex items-center gap-2">
          열 수
          <select className="cd-select" style={{ width: 80 }} value={cols} onChange={(e) => ops.patchStyle(sel.id, { gridTemplateColumns: `repeat(${e.target.value}, minmax(0, 1fr))` })}>
            {[1, 2, 3, 4, 5, 6].map((c) => (
              <option key={c} value={c}>
                {c}열
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {caps.photoLayout ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs cd-text-muted">사진 비율</p>
          <div className="flex flex-wrap gap-1.5">
            {PHOTO_RATIOS.map((r) => {
              const target = frameOf() ?? n;
              return (
                <Chip key={r.id} active={String(target.style?.aspectRatio ?? "") === r.value} onClick={() => ops.patchStyle(target.id, { aspectRatio: r.value, height: "auto" })}>
                  {r.label}
                </Chip>
              );
            })}
          </div>
        </div>
      ) : null}
      {caps.resize ? (
        <label className="text-xs cd-text-muted flex items-center gap-2">
          폭(12열 기준)
          <select
            className="cd-select"
            style={{ width: 110 }}
            value=""
            onChange={(e) => e.target.value && ops.patchStyle(sel.id, { width: `${Math.round(spanWidth(Number(e.target.value)) * 100) / 100}px`, flex: "none" })}
          >
            <option value="">열 고르기</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((c) => (
              <option key={c} value={c}>
                {c}열 · {Math.round(spanWidth(c))}pt
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {caps.typeStep ? (
        <label className="text-xs cd-text-muted flex items-center gap-2">
          글자 크기
          <select className="cd-select flex-1" value={currentStep ?? ""} onChange={(e) => ops.setType(sel.id, e.target.value || null)}>
            <option value="">원래 크기</option>
            {PICKABLE_TYPE_STEPS.map((s) => (
              <option key={s.name} value={s.name}>
                {s.label} · {s.fontSize.replace("px", "pt")}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {caps.color ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs cd-text-muted">{sel.kind === "text" || n.className?.includes("kc-x-text") ? "글자 색" : "면 색"}(디자인 시스템 색만)</p>
          <div className="flex flex-wrap gap-1">
            {(sel.kind === "text" || n.className?.includes("kc-x-text") ? TEXT_COLORS : FILL_COLORS).map((c) => {
              const key = sel.kind === "text" || n.className?.includes("kc-x-text") ? "color" : "background";
              const active = String(n.style?.[key] ?? "") === `var(--${c})`;
              return (
                <button
                  key={c}
                  type="button"
                  className="cd-action w-6 h-6 rounded border"
                  style={{ background: swatch(c, theme.concept), borderColor: active ? "var(--cd-primary)" : "var(--cd-border)", boxShadow: active ? "0 0 0 2px var(--cd-primary)" : undefined }}
                  aria-label={`${key === "color" ? "글자 색" : "면 색"} ${c}`}
                  aria-pressed={active}
                  onClick={() => ops.patchStyle(sel.id, { [key]: `var(--${c})` })}
                />
              );
            })}
          </div>
        </div>
      ) : null}
      {caps.move && n.origin !== "add" && (edit?.style || edit?.type) ? (
        <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm self-start" onClick={() => ops.reset(sel.id, ["style", "type"])}>
          <RotateCcw className="w-3.5 h-3.5" /> 위치·크기·글자 원래대로
        </button>
      ) : null}
      {caps.move ? <p className="text-[11px] cd-text-faint">캔버스의 [옮기기] 손잡이를 끌거나 방향키로 옮깁니다(가로 1열, 세로 4pt, Shift 16pt).</p> : null}
    </section>
  );
}

/** 인포그래픽 유형 바꾸기 — 규칙 기반 후보를 실제 내용으로 그려 보여 준다(블루프린트 §4-3·4-4) */
function InfoTypePicker({ studio, kit, item, sel, ops, onAiShrink }: PanelProps & { sel: Selection }) {
  const slot = sel.node.props as unknown as InfoSlotProps;
  const spec: InfoSpec = slot.spec;
  const theme = studio.state!.theme;
  const [showBlocked, setShowBlocked] = useState(false);
  const [overflow, setOverflow] = useState<Record<string, boolean>>({});
  // 같은 섹션의 다른 자리에서 쓰는 유형(반복 회피)
  const sectionTypes = useMemo(() => {
    const out: InfoType[] = [];
    for (const p of studio.plan) {
      if (p.section !== item.section) continue;
      const t = studio.composedOf(p).tree;
      const walk = (n: CNode) => {
        if (n.widget === "infographic" && n.id !== sel.id) out.push(((n.props as unknown as InfoSlotProps).spec.type) as InfoType);
        n.children?.forEach(walk);
      };
      walk(t);
    }
    return out;
  }, [studio, sel.id, item.section]);
  const pref = studio.payload?.prefs[slot.slot]?.type as InfoType | undefined;
  const { candidates, blocked } = useMemo(
    () => matchInfographic(spec.content, { box: slot.box, current: spec.type, sectionTypes, pref }),
    [spec, slot.box, sectionTypes, pref]
  );
  // 3단계 LLM 순위·이유(catalog.infographic_suggest) — 같은 내용·자리는 한 번만 묻고, 실패하면 규칙 점수 순 그대로
  const [rank, setRank] = useState<RankResponse | null>(null);
  const [ranking, setRanking] = useState(false);
  // 스튜디오 상태는 렌더마다 새 객체라 요청 내용(JSON)으로만 다시 묻는다
  const rankBody = JSON.stringify({ content: spec.content, box: slot.box, current: spec.type, sectionTypes, pref, slot: slot.slot });
  const canRank = candidates.length >= 2;
  useEffect(() => {
    let alive = true;
    setRank(null);
    if (!canRank) return;
    setRanking(true);
    fetchRank(JSON.parse(rankBody))
      .then((r) => alive && setRank(r))
      .catch(() => alive && setRank({ source: "rule", fallback: "AI 순위를 받지 못했습니다", ranking: [] }))
      .finally(() => alive && setRanking(false));
    return () => {
      alive = false;
    };
  }, [rankBody, canRank]);
  const top = useMemo(() => {
    const base = candidates.slice(0, 6);
    if (!rank || rank.source !== "ai") return base.map((c) => ({ ...c, ai: false }));
    const order = new Map(rank.ranking.map((r, i) => [r.type, i]));
    return base
      .map((c) => {
        const r = rank.ranking.find((x) => x.type === c.type);
        return { ...c, reason: r?.reason ?? c.reason, ai: r?.source === "ai" };
      })
      .sort((a, b) => (order.get(a.type) ?? 99) - (order.get(b.type) ?? 99));
  }, [candidates, rank]);
  const previewHtml = (type: InfoType, variant: string) =>
    renderToStaticMarkup(
      (
        <div
          className={`kc-concept--${theme.concept} kc-fontset--${studio.fontSet} kc-motif--drop kc-area-${slot.area ?? 1}`}
          style={{ width: slot.box.w, fontFamily: "var(--kc-font-body)", fontSize: 10.5, lineHeight: "17px", color: "var(--ink)", wordBreak: "keep-all" }}
        >
          {renderInfographic({ ...spec, type, variant }, slot.box, {}, slot.area ?? 1)}
        </div>
      ) as ReactElement
    );
  const apply = (type: InfoType, variant: string) => ops.setInfo(sel.id, { type, variant }, slot.slot);
  const meta = INFO_TYPE_META[spec.type];
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold cd-text flex items-center gap-1">
        인포그래픽 유형 바꾸기 <CdHelp topic="catalog.studio-infographic" />
      </h3>
      <p className="text-xs cd-text-muted">
        지금 {meta.label} · 내용 {spec.content.items.length}항목 · 자리 {Math.round(slot.box.w)}×{Math.round(slot.box.h)}pt
      </p>
      <p className="text-[11px] cd-text-faint flex items-center gap-1" aria-live="polite">
        {ranking ? (
          <>
            <Loader2 className="w-3 h-3 animate-spin" /> AI 가 순위를 매기는 중…
          </>
        ) : rank?.source === "ai" ? (
          <>
            <Sparkles className="w-3 h-3" /> AI 순위 · 이유 한 줄(규칙 점수는 오른쪽 숫자)
          </>
        ) : (
          <>규칙 점수 순{rank?.fallback ? ` — ${rank.fallback}` : ""}</>
        )}
      </p>
      <ul className="flex flex-col gap-2">
        {top.map((c) => {
          const cur = c.type === spec.type;
          const w = Math.min(268, slot.box.w);
          const srcH = Math.max(slot.box.h, INFO_TYPE_META[c.type].minHeight) + 8;
          const key = `${c.type}:${c.variant}`;
          return (
            <li key={key}>
              <button
                type="button"
                className="cd-action w-full text-left rounded-lg border p-1.5 flex flex-col gap-1"
                style={{ borderColor: cur ? "var(--cd-primary)" : "var(--cd-border)" }}
                aria-pressed={cur}
                aria-label={`${c.label} 유형으로 바꾸기 — ${c.reason}`}
                onClick={() => apply(c.type, cur ? (spec.variant ?? c.variant) : c.variant)}
              >
                <span className="flex items-center gap-1 text-xs">
                  <b className="cd-text">{c.label}</b>
                  {cur ? <span className="cd-pill cd-pill-info">지금</span> : null}
                  {overflow[key] ? <span className="cd-pill cd-pill-warn">자리 넘침</span> : null}
                  {c.ai ? <Sparkles className="w-3 h-3 cd-text-faint" aria-label="AI 순위" /> : null}
                  <span className="ml-auto tabular-nums cd-text-faint">{c.score}</span>
                </span>
                <span className="rounded border cd-border-c overflow-hidden" style={{ background: "#fff" }}>
                  <StaticFrame
                    kit={kit}
                    fontSet={studio.fontSet}
                    html={previewHtml(c.type, cur ? (spec.variant ?? c.variant) : c.variant)}
                    width={w}
                    srcW={slot.box.w}
                    srcH={srcH}
                    title={`${c.label} 미리보기`}
                    onMeasure={(h) => setOverflow((o) => (o[key] === h > slot.box.h + 2 ? o : { ...o, [key]: h > slot.box.h + 2 }))}
                  />
                </span>
                <span className="text-[11px] cd-text-muted">{c.reason}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {onAiShrink && overflow[`${spec.type}:${top.find((c) => c.type === spec.type)?.variant}`] ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="cd-pill cd-pill-warn">지금 유형이 자리를 넘칩니다</span>
          <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" onClick={() => onAiShrink([sel.id])}>
            <Sparkles className="w-3.5 h-3.5" /> AI로 줄이기
          </button>
          <span className="cd-text-faint">또는 넘치지 않는 다른 유형을 고르세요.</span>
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <p className="text-xs cd-text-muted">변형</p>
        <div className="flex flex-wrap gap-1.5">
          {meta.variants.map((v) => (
            <Chip key={v.id} active={(spec.variant ?? meta.variants[0].id) === v.id} onClick={() => ops.setInfo(sel.id, { type: spec.type, variant: v.id }, slot.slot)}>
              {v.label}
            </Chip>
          ))}
        </div>
        <p className="text-xs cd-text-muted">색</p>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["area", "분야 색"],
              ["brand", "브랜드 색"],
              ["mono", "무채색"],
            ] as Array<[InfoColorMode, string]>
          ).map(([m, l]) => (
            <Chip key={m} active={(spec.colorMode ?? "area") === m} onClick={() => ops.setInfo(sel.id, { colorMode: m }, slot.slot)}>
              {l}
            </Chip>
          ))}
        </div>
      </div>
      {blocked.length ? (
        <div className="text-xs">
          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" aria-expanded={showBlocked} onClick={() => setShowBlocked((v) => !v)}>
            바꿀 수 없는 유형 {blocked.length}
          </button>
          {showBlocked ? (
            <ul className="mt-1 flex flex-col gap-0.5 cd-text-muted">
              {blocked.map((b) => (
                <li key={b.type}>
                  <b className="cd-text">{b.label}</b> — {b.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm self-start" onClick={() => ops.setInfo(sel.id, null, slot.slot)}>
        <RotateCcw className="w-3.5 h-3.5" /> 원래 유형·내용으로
      </button>
      <p className="text-[11px] cd-text-faint">
        <Shapes className="w-3 h-3 inline" aria-hidden /> 고른 유형은 이 자리의 선택 기록으로 남아 다음 추천에서 앞에 옵니다.
      </p>
    </section>
  );
}
