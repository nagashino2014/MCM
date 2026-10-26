/*
 * 인포그래픽 모양 '일러스트' — 보유 스톡 일러스트(313)를 그림으로, 내용(InfoContent)을 글자 자리마다 HTML 로 얹어 그린다(블루프린트 §4-5).
 * 훅·컨텍스트 없음(서버 정적 렌더·스튜디오 공용). SVG 본문은 등록표(registerIllustrations)에서 꺼낸다 —
 *   서버 PDF·HTML 은 html.ts 가 문서에 쓰인 일러스트를, 스튜디오는 /api/catalog/illustrations/render 로 받은 것을 등록한다.
 * 노드 트리(스튜디오 편집층)로 바꿀 때 SVG 본문은 노드에 넣지 않고 data-illust-art 표식만 남긴다 → render-tree 가 그릴 때 다시 채운다.
 *
 * 글자 자리: 원래 그림의 글자 상자(비율)에 놓고, 글자 크기 = 그림 폭 비율(cqw)이되 역할별 최소 크기(가독성) 이상.
 *   자리는 줄 수만큼 높이를 갖고 넘치면 잘린다 → paginate checkSheet 가 '글자가 상자에 잘렸습니다'로 잡는다(넘침 0 검사).
 * 색: SVG 의 var(--il-cN, #원래색) 을 KESI 토큰·분야 색으로 바꿔 칠하고, 글자 색은 같은 무리의 글자용 색을 쓴다.
 */
import type { CSSProperties, ReactNode } from "react";
import {
  ILLUST_MIN_CHARS,
  ILLUST_MIN_PT,
  illustColorVars,
  illustTints,
  illustSlotTexts,
  sanitizeIllustColors,
  slotBgHex,
  slotTextColor,
  type IllustSlot,
  type IllustTint,
  type IllustSlotRole,
  type IllustrationRender,
} from "@/lib/catalog/illustration-types";
import type { RootAttrs } from "../components/infographics";
import type { InfoBox, InfoSpec } from "./types";

const REG = new Map<string, IllustrationRender>();
const TINTS = new WeakMap<IllustrationRender, IllustTint[]>();

/** 항목별 색(SVG 의 --il-i 변수) — 등록한 그림마다 한 번 읽는다 */
export function tintsOf(r: IllustrationRender): IllustTint[] {
  let t = TINTS.get(r);
  if (!t) {
    t = illustTints(r.svg);
    TINTS.set(r, t);
  }
  return t;
}

/** 그릴 일러스트를 등록한다(같은 자산 id 는 새 정보로 덮어쓴다) */
export function registerIllustrations(list: IllustrationRender[]): void {
  for (const r of list) REG.set(r.info.assetId, r);
}

export function illustrationRender(assetId: string): IllustrationRender | undefined {
  return REG.get(assetId);
}

const WEIGHT: Record<IllustSlotRole, number> = { title: 700, sub: 600, desc: 400, number: 700, center: 700, heading: 700 };


/** 그림 폭(pt) — 기본은 자리 높이에 맞춰(자리가 낮으면 폭을 줄인다), fit=width 면 자리 폭 전체(높이는 그림 비율대로 늘어난다) */
export function illustWidth(view: [number, number], box: InfoBox, fit?: string): number {
  const aspect = view[0] / view[1];
  return box.h > 0 && fit !== "width" ? Math.min(box.w, box.h * aspect) : box.w;
}

/** 글자 자리 상자(최소 글자 크기·줄 수 적용)가 그림 위·아래로 나가는 길이(pt) — 그린 폭 width 기준 근사 */
/** 글이 원래 자리보다 길 때 위로 늘리는지 — 아래 빈 공간으로 모자라고 위 공간이 더 넉넉할 때(화살·띠 위에 놓인 설명 등) */
export function growsUp(s: IllustSlot, needH: number, H: number): boolean {
  if (!s.room) return false;
  const extra = needH - s.h * H;
  const [, , gu, gd] = s.room;
  return extra > gd * H + 0.5 && gu > gd;
}

export function slotOverhang(slots: IllustSlot[], view: [number, number], width: number, fit: Record<string, { font: number; lines: number }> = {}): { top: number; bottom: number } {
  const H = (width * view[1]) / view[0];
  let top = 0;
  let bottom = 0;
  for (const s of slots) {
    const font = fit[s.id]?.font ?? Math.max(ILLUST_MIN_PT[s.role], s.fs * width);
    const lead = Math.max(0, s.lh - 0.72);
    const h = Math.max(s.h * H + font * lead, font * s.lh * (fit[s.id]?.lines ?? s.lines + (s.role === "desc" ? 1 : 0)));
    const y0 = growsUp(s, h, H) ? (s.y + s.h) * H + (font * lead) / 2 - h : s.y * H - (font * lead) / 2;
    top = Math.max(top, -y0);
    bottom = Math.max(bottom, y0 + h - H);
  }
  return { top: Math.ceil(top), bottom: Math.ceil(bottom) };
}

export function IllustrationFigure({ spec, box, root, area }: { spec: InfoSpec; box: InfoBox; root: RootAttrs; area?: number }): ReactNode {
  const ref = spec.illust!;
  const r = REG.get(ref.asset);
  if (!r) {
    return (
      <div {...root} className="kc-ig kc-ill kc-ill--missing" data-illust={ref.asset} style={{ minHeight: Math.min(box.h, 120), ...root.style }}>
        <span className="kc-muted">일러스트를 불러오지 못했습니다</span>
      </div>
    );
  }
  const { info } = r;
  const colors = sanitizeIllustColors(ref.colors);
  const tints = tintsOf(r);
  const vars = illustColorVars(info.palette, colors, tints);
  const width = illustWidth(info.view, box, ref.fit);
  const texts = illustSlotTexts(info, spec.content, width).filter((t) => t.text);
  const reserve = slotOverhang(texts.map((t) => t.slot), info.view, width, Object.fromEntries(texts.map((t) => [t.slot.id, { font: t.font, lines: t.lines }])));
  const style = {
    position: "relative",
    width: `min(100%, ${Math.round(width)}px)`,
    aspectRatio: `${info.view[0]} / ${info.view[1]}`,
    // 그림 위·아래로 나가는 글자 자리만큼 자리를 잡아 다음 내용과 겹치지 않게
    margin: `${reserve.top}px auto ${reserve.bottom}px`,
    containerType: "inline-size",
    ...vars,
    ...root.style,
  } as CSSProperties;
  return (
    <div {...root} className="kc-ig kc-ill" data-illust={info.assetId} style={style}>
      <div className="kc-ill__art" data-illust-art={info.assetId} aria-hidden="true" dangerouslySetInnerHTML={{ __html: r.svg }} />
      {texts.map(({ slot, text, metric, suffix, font, shrunk, lines: nLines, width: wFrac }) => {
        const H = (width * info.view[1]) / info.view[0];
        // 글이 길면 자리에 맞게 줄인 크기(최소 크기까지), 아니면 그림 폭 비율
        const fs = shrunk ? `${font}px` : `max(${ILLUST_MIN_PT[slot.role]}px, ${(slot.fs * 100).toFixed(3)}cqw)`;
        const lead = Math.max(0, slot.lh - 0.72);
        // 정렬 기준점을 지킨다 — 가운데 정렬은 가운데, 오른쪽 정렬은 오른쪽 끝에서 넓힌다(글이 길면 바깥쪽으로 최대 1.5배)
        const anchor: CSSProperties =
          slot.align === "center"
            ? { left: `${((slot.x + slot.w / 2) * 100).toFixed(2)}%`, transform: "translateX(-50%)" }
            : slot.align === "right"
              ? { right: `${((1 - slot.x - slot.w) * 100).toFixed(2)}%` }
              : { left: `${(slot.x * 100).toFixed(2)}%` };
        const st = {
          "--fs": fs,
          ...anchor,
          ...(growsUp(slot, Math.max(slot.h * H + font * lead, font * slot.lh * nLines), H)
            ? { bottom: `calc(${((1 - slot.y - slot.h) * 100).toFixed(2)}% - var(--fs) * ${(lead / 2).toFixed(3)})` }
            : { top: `calc(${(slot.y * 100).toFixed(2)}% - var(--fs) * ${(lead / 2).toFixed(3)})` }),
          width: `max(${(Math.max(slot.w, wFrac) * 100).toFixed(2)}%, calc(var(--fs) * ${ILLUST_MIN_CHARS[slot.role]}))`,
          height: `max(calc(${(slot.h * 100).toFixed(2)}% + var(--fs) * ${lead.toFixed(3)}), calc(var(--fs) * ${(slot.lh * nLines).toFixed(3)}))`,
          fontSize: "var(--fs)",
          lineHeight: slot.lh,
          textAlign: slot.align,
          fontWeight: WEIGHT[slot.role],
          color: slotTextColor(slot, info.palette, colors, area, tints),
        } as unknown as CSSProperties;
        const lines = text.split("\n");
        const bg = slotBgHex(slot, info.palette, colors, area, tints);
        return (
          <div
            key={slot.id}
            className={`kc-ill__slot kc-ill__slot--${slot.role}`}
            data-ill-slot={slot.id}
            data-ill-role={slot.role}
            data-ill-item={String(slot.item)}
            {...(bg ? { "data-ill-bg": bg } : {})}
            style={st}
          >
            <span className="kc-ill__text">
              {metric ? (
                <>
                  <span data-metric={metric}>{/^-?[\d,.]+/.exec(text)?.[0] ?? text}</span>
                  {text.replace(/^-?[\d,.]+/, "")}
                </>
              ) : (
                lines.map((ln, i) => (
                  <span key={i}>
                    {i > 0 ? <br /> : null}
                    {ln}
                  </span>
                ))
              )}
              {suffix ? (
                <span className="kc-ill__fig">
                  {" "}
                  <span data-metric={suffix.metric}>{suffix.num}</span>
                  {suffix.unit}
                </span>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}
