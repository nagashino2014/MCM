"use client";

// 문서 설정 — 표지 디자인 7안(2열 썸네일)·사진 없는 변형·서체 세트. 고르는 즉시 문서(docId, 기본 마스터본)에 저장한다.
// 템플릿은 문서별 고정이라 여기서 바꾸지 않는다(이름만 표시) — 다른 템플릿은 첫 화면 [새 문서]로.
// 선택지는 lib/catalog/document-theme.ts COVER_DESIGNS 하나로 관리(7안, B·C 는 2026-10-29 확정·E 전면 사진·F 그래픽·G 연구소형 추가). 렌더러는 표지 루트에 kc-front--{cover}.

import { useEffect, useState } from "react";
import { CdHelp } from "@/components/cdash/CdHelp";
import {
  COVER_DESIGNS,
  DEFAULT_DOCUMENT_THEME,
  FONT_SET_LABEL,
  type CoverDesign,
  type DocumentTheme,
} from "@/lib/catalog/document-theme";
import { templateOf } from "@/lib/catalog/templates";
import { catalogFetch } from "./catalogFetch";

/** 표지 모양 축소 그림(문서 미리보기 — 실제 지면은 디자인 시스템 CoverPage) */
function CoverThumb({ cover, photo }: { cover: CoverDesign; photo: boolean }) {
  const photoStyle = photo
    ? { background: "var(--cd-primary-soft)", border: "1px solid var(--cd-primary)" }
    : { background: "transparent", border: "1px dashed var(--cd-border)" };
  const lines = (
    <div className="flex flex-col gap-1">
      <span className="block h-1.5 w-12 rounded-sm" style={{ background: "var(--cd-text)" }} />
      <span className="block h-1 w-8 rounded-sm" style={{ background: "var(--cd-muted)" }} />
    </div>
  );
  return (
    <div className="relative w-full overflow-hidden rounded border cd-border-c" style={{ aspectRatio: "842 / 595", background: "var(--cd-card)" }} aria-hidden>
      {cover === "leaf" && (
        <>
          <div className="absolute left-[8%] top-[38%]">{lines}</div>
          <div className="absolute right-[6%] top-[12%] w-[44%] h-[76%]" style={{ ...photoStyle, borderRadius: "60% 0 60% 0" }} />
        </>
      )}
      {cover === "strips" && (
        <>
          <div className="absolute left-[8%] top-[38%]">{lines}</div>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="absolute bottom-[10%]"
              style={{ ...photoStyle, left: `${50 + i * 15}%`, width: "12%", height: `${[62, 74, 54][i]}%`, borderRadius: "999px 999px 2px 2px" }}
            />
          ))}
        </>
      )}
      {cover === "research" && (
        <>
          <div className="absolute inset-y-0 left-0 w-[53%]" style={{ background: "var(--cd-primary-soft)" }} />
          <div className="absolute left-[8%] top-[36%] flex flex-col gap-1">
            <span className="block h-2 w-16 rounded-sm" style={{ background: "var(--cd-text)" }} />
            <span className="block h-0.5 w-20" style={{ background: "var(--cd-primary)" }} />
            <span className="block h-1 w-10 rounded-sm" style={{ background: "var(--cd-muted)" }} />
          </div>
          <div className="absolute right-0 inset-y-0 w-[47%]" style={photoStyle} />
        </>
      )}
      {cover === "center" && (
        <>
          <div className="absolute inset-x-0 bottom-0 h-1/2" style={{ background: "var(--cd-primary-soft)" }} />
          <div className="absolute inset-[7%] rounded-sm" style={{ border: "1px solid var(--cd-border)" }} />
          <div className="absolute left-1/2 top-[14%] bottom-[14%] w-px" style={{ background: "var(--cd-border)" }} />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-1 px-2 py-1" style={{ background: "var(--cd-card)" }}>
              <span className="block h-1.5 w-12 rounded-sm" style={{ background: "var(--cd-text)" }} />
              <span className="block h-1 w-8 rounded-sm" style={{ background: "var(--cd-muted)" }} />
            </div>
          </div>
        </>
      )}
      {cover === "band" && (
        <>
          <div className="absolute inset-x-0 top-[16%] h-[38%]" style={photoStyle} />
          <div className="absolute left-[8%] top-[64%]">{lines}</div>
        </>
      )}
      {cover === "photo" && (
        <>
          <div className="absolute inset-0" style={photoStyle} />
          <div className="absolute inset-x-0 bottom-0 h-[42%]" style={{ background: "var(--cd-text)", opacity: 0.55 }} />
          <div className="absolute left-[8%] top-[66%] flex flex-col gap-1">
            <span className="block h-1.5 w-12 rounded-sm" style={{ background: "var(--cd-card)" }} />
            <span className="block h-1 w-8 rounded-sm" style={{ background: "var(--cd-card)", opacity: 0.7 }} />
          </div>
        </>
      )}
      {cover === "graphic" && (
        <>
          <div className="absolute left-[8%] top-[38%]">{lines}</div>
          <div className="absolute right-[4%] top-[10%] w-[40%] aspect-square rounded-full" style={{ border: "6px solid var(--cd-primary-soft)", borderTopColor: "var(--cd-primary)" }} />
          <div className="absolute inset-x-0 bottom-0 h-[3%]" style={{ background: "var(--cd-primary)" }} />
        </>
      )}
    </div>
  );
}

export function CatalogCoverPicker({ docId = "master", docTitle }: { docId?: string; docTitle?: string } = {}) {
  const [theme, setTheme] = useState<DocumentTheme>(DEFAULT_DOCUMENT_THEME);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [setLabel, setSetLabel] = useState<string | null>(null);
  const themeUrl = `/api/catalog/document-theme?doc=${encodeURIComponent(docId)}`;

  useEffect(() => {
    setLoaded(false);
    setMessage(null);
    catalogFetch<{ theme: DocumentTheme; fontSetLabel?: string }>(themeUrl)
      .then((d) => {
        setTheme(d.theme);
        setSetLabel(d.fontSetLabel ?? null);
      })
      .catch((e) => setMessage((e as Error).message))
      .finally(() => setLoaded(true));
  }, [themeUrl]);

  const save = async (patch: Partial<DocumentTheme>) => {
    const prev = theme;
    setTheme({ ...theme, ...patch });
    setSaving(true);
    setMessage(null);
    try {
      const d = await catalogFetch<{ theme: DocumentTheme }>(themeUrl, { method: "PUT", body: JSON.stringify({ theme: patch }) });
      setTheme(d.theme);
      setMessage("저장했습니다.");
    } catch (e) {
      setTheme(prev);
      setMessage(`저장하지 못했습니다: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const current = COVER_DESIGNS.find((c) => c.id === theme.cover);
  const coverHasPhoto = Boolean(current?.photo);

  return (
    <section className="cd-card p-4 mb-3">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <h3 className="cd-text font-semibold text-base flex items-center gap-1">
          문서 설정 — 표지 디자인 <CdHelp topic="catalog.cover" />
        </h3>
        <span className="text-xs cd-text-faint">
          {docId === "master" ? "마스터본" : docTitle || docId} · 템플릿 {templateOf(theme.template).label} · 기본 서체 {FONT_SET_LABEL[theme.fontSet] ?? setLabel ?? theme.fontSet}
        </span>
        {message && (
          <span className={`text-xs ml-auto ${message.startsWith("저장하지") ? "cd-error-text" : "cd-text-muted"}`} role="status">
            {message}
          </span>
        )}
      </div>
      <div role="radiogroup" aria-label="표지 디자인" className="grid grid-cols-2 gap-3 max-w-[520px]">
        {COVER_DESIGNS.map((c) => {
          const active = theme.cover === c.id;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`${c.label}${c.confirmed ? "" : " (확정 전)"}`}
              disabled={!loaded || saving}
              onClick={() => !active && save({ cover: c.id })}
              className="cd-choice text-left rounded-lg border p-2 disabled:opacity-60"
              data-active={active ? "true" : undefined}
              style={{ borderColor: active ? "var(--cd-primary)" : "var(--cd-border)" }}
            >
              <CoverThumb cover={c.id} photo={Boolean(c.photo) && theme.coverPhoto === "photo"} />
              <span className="flex items-center gap-1.5 mt-1.5">
                <span className={`text-sm ${active ? "cd-text-primary font-semibold" : "cd-text"}`}>{c.label}</span>
                {!c.confirmed && <span className="cd-pill cd-pill-idle">확정 전</span>}
                {active && <span className="cd-pill cd-pill-info ml-auto">사용 중</span>}
              </span>
              <span className="block text-[11px] cd-text-faint mt-0.5">{c.desc}</span>
            </button>
          );
        })}
      </div>
      <label className={`inline-flex items-center gap-2 text-sm mt-3 ${coverHasPhoto ? "" : "opacity-60"}`}>
        <input
          type="checkbox"
          checked={theme.coverPhoto === "none"}
          disabled={!loaded || saving || !coverHasPhoto}
          onChange={(e) => save({ coverPhoto: e.target.checked ? "none" : "photo" })}
        />
        사진 없는 변형으로 만들기
        {!coverHasPhoto && <span className="text-xs cd-text-faint">(이 안은 원래 사진이 없습니다)</span>}
      </label>
    </section>
  );
}
