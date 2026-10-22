"use client";

// 문서 설정 — 표지 디자인 4안(2×2 썸네일)·사진 없는 변형·서체 세트. 고르는 즉시 문서(마스터본)에 저장한다.
// 선택지는 lib/catalog/document-theme.ts COVER_DESIGNS 하나로 관리(B·C 확정 대기). 렌더러는 표지 루트에 kc-front--{cover}.

import { useEffect, useState } from "react";
import { CdHelp } from "@/components/cdash/CdHelp";
import {
  COVER_DESIGNS,
  DEFAULT_DOCUMENT_THEME,
  FONT_SET_LABEL,
  type CoverDesign,
  type DocumentTheme,
} from "@/lib/catalog/document-theme";
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
    </div>
  );
}

export function CatalogCoverPicker() {
  const [theme, setTheme] = useState<DocumentTheme>(DEFAULT_DOCUMENT_THEME);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    catalogFetch<{ theme: DocumentTheme }>("/api/catalog/document-theme")
      .then((d) => setTheme(d.theme))
      .catch((e) => setMessage((e as Error).message))
      .finally(() => setLoaded(true));
  }, []);

  const save = async (patch: Partial<DocumentTheme>) => {
    const prev = theme;
    setTheme({ ...theme, ...patch });
    setSaving(true);
    setMessage(null);
    try {
      const d = await catalogFetch<{ theme: DocumentTheme }>("/api/catalog/document-theme", { method: "PUT", body: JSON.stringify({ theme: patch }) });
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
        <span className="text-xs cd-text-faint">마스터본 · 기본 서체 {FONT_SET_LABEL[theme.fontSet] ?? theme.fontSet}</span>
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
