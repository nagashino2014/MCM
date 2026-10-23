"use client";

// 오른쪽 패널 · 서체 탭(블루프린트 §5-2·5-4) — 서체 세트를 실제 쪽으로 그려 보고, 두 세트를 나란히 비교한 뒤 적용한다.
// 적용하면 문서 전체를 다시 조판해 넘침을 검사하고(서체마다 글자 폭이 달라 넘칠 수 있음), 넘친 쪽과 [원래 서체로]를 보여 준다.

import { useMemo, useState } from "react";
import { Check, Columns2, Loader2, RotateCcw } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";
import { CdHelp } from "@/components/cdash/CdHelp";
import { FONT_SETS, fontSetById } from "@/lib/catalog/fonts";
import type { FullCheckResult } from "./checks";
import { StaticFrame } from "./Frames";
import { staticHtml } from "./StudioThumbs";
import type { PanelProps } from "./types";

const SAMPLE_KEYS = ["c01", "area-1", "c14", "a02-1", "c04"];

export function PanelFonts({
  studio,
  kit,
  onApply,
  previousSet,
  onRevert,
  fullCheck,
  checking,
  onRunCheck,
  onOpenPage,
}: PanelProps & {
  onApply: (setId: string) => void;
  previousSet: string | null;
  onRevert: () => void;
  fullCheck: FullCheckResult | null;
  checking: boolean;
  onRunCheck: () => void;
  onOpenPage: (key: string) => void;
}) {
  const env = studio.env;
  const current = studio.state?.theme.fontSet ?? "pretendard";
  const samples = useMemo(() => {
    const out: Array<{ key: string; label: string; html: string }> = [];
    if (!env) return out;
    for (const key of SAMPLE_KEYS) {
      const item = studio.plan.find((p) => p.key === key);
      if (item && out.length < 3) out.push({ key, label: item.label, html: staticHtml(studio.composedOf(item).tree, env) });
    }
    return out;
  }, [studio, env]);
  const withSet = (html: string, id: string) => html.replace(/kc-fontset--[a-z0-9-]+/g, `kc-fontset--${id}`);
  const [compare, setCompare] = useState<{ a: string; b: string; sample: number } | null>(null);
  const labelOf = (id: string) => fontSetById(id)?.label ?? id;

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs cd-text-muted flex items-center gap-1">
        지금 세트 <b className="cd-text">{labelOf(current)}</b> <CdHelp topic="catalog.studio-fonts" />
      </div>

      {checking || fullCheck || previousSet ? (
        <section className="rounded-lg border cd-border-c p-2 flex flex-col gap-1.5 text-xs" aria-live="polite">
          {checking ? (
            <span className="inline-flex items-center gap-1 cd-text-muted">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> 전체 쪽 넘침 검사 중…
            </span>
          ) : fullCheck?.error ? (
            <span className="cd-error-text">{fullCheck.error}</span>
          ) : fullCheck ? (
            fullCheck.total === 0 ? (
              <span className="cd-text inline-flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> 넘침 0건 · {fullCheck.pages}쪽
              </span>
            ) : (
              <>
                <span className="cd-error-text">넘침 {fullCheck.total}건</span>
                <ul className="flex flex-col gap-0.5">
                  {Object.entries(fullCheck.byKey).map(([key, list]) => (
                    <li key={key} className="flex items-center gap-1">
                      <span className="cd-text-muted truncate">{studio.plan.find((p) => p.key === key)?.label ?? key}</span>
                      <span className="tabular-nums">{list.length}</span>
                      <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm ml-auto" onClick={() => onOpenPage(key)}>
                        쪽 열기
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onRunCheck} disabled={checking}>
              다시 검사
            </button>
            {previousSet ? (
              <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onRevert}>
                <RotateCcw className="w-3.5 h-3.5" /> 원래 서체로({labelOf(previousSet)})
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      <ul className="flex flex-col gap-2">
        {FONT_SETS.map((f) => {
          const active = f.id === current;
          return (
            <li key={f.id} className="rounded-lg border p-2 flex flex-col gap-1.5" style={{ borderColor: active ? "var(--cd-primary)" : "var(--cd-border)", opacity: f.available ? 1 : 0.65 }}>
              <div className="flex items-center gap-1">
                <b className="text-sm cd-text">{f.label}</b>
                {active ? <span className="cd-pill cd-pill-info">적용 중</span> : null}
                {!f.available ? <span className="cd-pill cd-pill-idle">파일 없음</span> : null}
              </div>
              <p className="text-[11px] cd-text-muted">
                {f.desc} 제목 {f.roles.display} · 본문 {f.roles.body} · 숫자 {f.roles.figure}
              </p>
              {f.available ? (
                <>
                  <div className="flex gap-1">
                    {samples.slice(0, 2).map((s) => (
                      <span key={s.key} className="rounded border cd-border-c overflow-hidden">
                        <StaticFrame kit={kit} fontSet={f.id} html={withSet(s.html, f.id)} width={124} title={`${f.label} · ${s.label}`} />
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" disabled={active} onClick={() => onApply(f.id)}>
                      이 세트 적용
                    </button>
                    <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => setCompare({ a: current, b: f.id, sample: 0 })}>
                      <Columns2 className="w-3.5 h-3.5" /> 나란히 비교
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-[11px] cd-text-faint">{f.note}</p>
              )}
            </li>
          );
        })}
      </ul>

      <CdModal open={compare != null} onClose={() => setCompare(null)} title="서체 세트 나란히 비교" size="xl">
        {compare ? (
          <div className="p-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {(["a", "b"] as const).map((side) => (
                <label key={side} className="flex items-center gap-1">
                  {side === "a" ? "왼쪽" : "오른쪽"}
                  <select className="cd-select" style={{ width: 140 }} value={compare[side]} onChange={(e) => setCompare({ ...compare, [side]: e.target.value })}>
                    {FONT_SETS.filter((f) => f.available).map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <label className="flex items-center gap-1 ml-auto">
                쪽
                <select className="cd-select" style={{ width: 170 }} value={compare.sample} onChange={(e) => setCompare({ ...compare, sample: Number(e.target.value) })}>
                  {samples.map((s, i) => (
                    <option key={s.key} value={i}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {samples[compare.sample] ? (
              <div className="grid grid-cols-2 gap-3">
                {(["a", "b"] as const).map((side) => (
                  <figure key={side} className="flex flex-col gap-1">
                    <span className="rounded border cd-border-c overflow-hidden">
                      <StaticFrame kit={kit} fontSet={compare[side]} html={withSet(samples[compare.sample].html, compare[side])} width={410} title={`${labelOf(compare[side])} 비교`} />
                    </span>
                    <figcaption className="text-xs cd-text-muted flex items-center gap-2">
                      {labelOf(compare[side])}
                      <button type="button" className="cd-btn cd-btn-soft cd-btn-sm ml-auto" disabled={compare[side] === current} onClick={() => (onApply(compare[side]), setCompare(null))}>
                        이 세트 적용
                      </button>
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </CdModal>
    </div>
  );
}
