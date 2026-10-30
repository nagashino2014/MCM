"use client";

// 회사소개서 문서 목록·[새 문서] — 템플릿은 새 문서를 만들 때 고르고 문서마다 고정된다(계획서 docs/catalog-templates-plan.md §3-1, TP0).
// 마스터본은 스탠다드 템플릿, 맞춤판은 5종 중 하나. 고른 문서(?doc=)가 아래 발행본·PDF 만들기·표지 디자인·스튜디오의 대상이 된다.

import { useEffect, useState } from "react";
import { FilePlus2, Files } from "lucide-react";
import { CdHelp } from "@/components/cdash/CdHelp";
import { CdModal } from "@/components/cdash/CdModal";
import type { CatalogDocumentSummary } from "@/lib/catalog/projects";
import { TEMPLATE_LIST, templateOf, type TemplateId } from "@/lib/catalog/templates";
import { catalogFetch } from "./catalogFetch";

const fmtDay = (iso: string) => (iso ? new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }) : "—");

export function CatalogDocumentsPanel({
  documents,
  current,
  canManage,
  loading,
  onSelect,
  onCreated,
}: {
  documents: CatalogDocumentSummary[];
  /** 고른 문서 id(없으면 마스터) */
  current: string;
  canManage: boolean;
  loading: boolean;
  onSelect: (docId: string) => void;
  onCreated: (doc: CatalogDocumentSummary) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="cd-card p-4 mb-3">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <h3 className="cd-text font-semibold text-base flex items-center gap-1">
          <Files className="w-4 h-4 cd-text-primary" /> 문서 <CdHelp topic="catalog.documents" />
        </h3>
        <span className="text-xs cd-text-faint">고른 문서가 아래 발행본·PDF 만들기·표지 디자인·스튜디오의 대상입니다. 템플릿은 문서마다 고정됩니다.</span>
        {canManage && (
          <button type="button" className="cd-btn cd-btn-soft cd-btn-sm ml-auto" onClick={() => setOpen(true)}>
            <FilePlus2 className="w-3.5 h-3.5" /> 새 문서
          </button>
        )}
      </div>
      {loading && documents.length === 0 ? (
        <p className="text-sm cd-text-faint">불러오는 중…</p>
      ) : (
        <div role="radiogroup" aria-label="문서" className="flex flex-wrap gap-2">
          {documents.map((d) => {
            const active = d.docId === current;
            const tpl = templateOf(d.template);
            return (
              <button
                key={d.docId}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => !active && onSelect(d.docId)}
                className="cd-choice text-left rounded-lg border p-2.5 min-w-[220px] max-w-[320px]"
                data-active={active ? "true" : undefined}
                style={{ borderColor: active ? "var(--cd-primary)" : "var(--cd-border)" }}
              >
                <span className="flex items-center gap-1.5">
                  <span className={`text-sm truncate ${active ? "cd-text-primary font-semibold" : "cd-text font-semibold"}`}>{d.title}</span>
                  {d.kind === "master" && <span className="cd-pill cd-pill-idle">마스터</span>}
                  {active && <span className="cd-pill cd-pill-info ml-auto">선택 중</span>}
                </span>
                <span className="block text-[11px] cd-text-faint mt-1">
                  템플릿 {tpl.label} · 만든 날 {fmtDay(d.createdAt)}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {canManage && (
        <NewDocumentModal
          open={open}
          onClose={() => setOpen(false)}
          onCreated={(doc) => {
            setOpen(false);
            onCreated(doc);
          }}
        />
      )}
    </section>
  );
}

const monthLabel = () => {
  const d = new Date();
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}`;
};

function NewDocumentModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (doc: CatalogDocumentSummary) => void }) {
  const [template, setTemplate] = useState<TemplateId>("graphic");
  const [title, setTitle] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTemplate("graphic");
    setTitle("");
    setTouched(false);
    setError(null);
  }, [open]);

  // 제목을 손대기 전에는 템플릿 이름으로 채운다
  const effectiveTitle = touched ? title : `회사소개서 ${templateOf(template).label} ${monthLabel()}`;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await catalogFetch<{ document: CatalogDocumentSummary }>("/api/catalog/documents", {
        method: "POST",
        body: JSON.stringify({ template, title: effectiveTitle.trim() }),
      });
      onCreated(d.document);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <CdModal
      open={open}
      onClose={busy ? () => undefined : onClose}
      widthClass="max-w-xl"
      closeOnBackdrop={!busy}
      title={
        <span className="inline-flex items-center gap-1">
          새 문서 — 템플릿 고르기
          <CdHelp topic="catalog.documents" />
        </span>
      }
      footer={
        <div className="flex items-center gap-2 justify-end">
          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" onClick={create} disabled={busy || !effectiveTitle.trim()}>
            <FilePlus2 className="w-3.5 h-3.5" /> 만들기
          </button>
        </div>
      }
    >
      <div className="p-4 flex flex-col gap-3 text-sm">
        <p className="text-xs cd-text-muted">
          템플릿은 색·표지·서체의 기본값과 쪽 구성 묶음입니다. 문서를 만든 뒤에는 색·서체·표지만 바꿀 수 있고 템플릿은 바꿀 수
          없습니다(다른 템플릿은 새 문서로).
        </p>
        <div role="radiogroup" aria-label="템플릿" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {TEMPLATE_LIST.map((t) => {
            const active = t.id === template;
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={busy}
                onClick={() => setTemplate(t.id)}
                className="cd-choice text-left rounded-lg border p-2.5 disabled:opacity-60"
                data-active={active ? "true" : undefined}
                style={{ borderColor: active ? "var(--cd-primary)" : "var(--cd-border)", boxShadow: "var(--cd-shadow)" }}
              >
                <span className={`block text-sm ${active ? "cd-text-primary font-semibold" : "cd-text font-semibold"}`}>{t.label}</span>
                <span className="block text-[11px] cd-text-faint mt-0.5">{t.desc}</span>
              </button>
            );
          })}
        </div>
        <label className="flex flex-col gap-1 text-xs cd-text-muted">
          문서 제목
          <input
            className="cd-input"
            value={effectiveTitle}
            maxLength={80}
            disabled={busy}
            onChange={(e) => {
              setTouched(true);
              setTitle(e.target.value);
            }}
          />
        </label>
        {error && (
          <p className="cd-error-text text-xs" role="alert">
            {error}
          </p>
        )}
      </div>
    </CdModal>
  );
}
