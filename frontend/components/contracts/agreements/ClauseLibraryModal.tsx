"use client";

// 조항 라이브러리 검색·삽입 모달(149) — 계약서 작성 화면에서 과거 계약서·표준 셋의 조문을
// 골라 현재 조 뒤에 삽입한다. 복수 선택 가능(발주처 특약이 여러 조인 경우가 흔하다).

import { useCallback, useEffect, useState } from "react";
import { BookOpen, Check, Search, X } from "lucide-react";
import "@/components/cdash/cdash.css";

export interface LibraryClause {
  clauseId: string;
  title: string;
  body: string;
  category: string;
  serviceType: string | null;
  usageCount: number;
}

export function ClauseLibraryModal({
  theme,
  serviceType,
  onClose,
  onInsert,
}: {
  theme: string;
  /** 현재 계약의 용역 대분류 — 공통 조항 + 이 분류 전용 조항만 보여준다 */
  serviceType?: string;
  onClose: () => void;
  onInsert: (picked: LibraryClause[]) => void;
}) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [items, setItems] = useState<LibraryClause[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<Record<string, LibraryClause>>({});
  const [preview, setPreview] = useState<LibraryClause | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const sp = new URLSearchParams();
    if (q.trim()) sp.set("q", q.trim());
    if (category) sp.set("category", category);
    if (serviceType) sp.set("serviceType", serviceType);
    fetch(`/api/contracts/agreements/clauses?${sp.toString()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setItems(Array.isArray(d?.clauses) ? d.clauses : []);
        if (Array.isArray(d?.categories)) setCategories(d.categories);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [q, category, serviceType]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const toggle = (c: LibraryClause) =>
    setPicked((prev) => {
      const next = { ...prev };
      if (next[c.clauseId]) delete next[c.clauseId];
      else next[c.clauseId] = c;
      return next;
    });

  const pickedList = Object.values(picked);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" style={{ background: "rgba(15,20,34,0.5)" }} onClick={onClose}>
      <div
        className="cdash cd-fields-white rounded-2xl cd-solid-bg shadow-2xl w-full max-w-[1000px] h-[86vh] flex flex-col overflow-hidden"
        data-theme={theme}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-5 py-3 border-b cd-border-c">
          <BookOpen className="w-4 h-4 cd-text-primary" />
          <span className="text-sm font-bold cd-text">조항 라이브러리</span>
          <span className="text-[11px] cd-text-faint">과거 계약서·표준 셋의 조문을 골라 삽입합니다</span>
          <button type="button" className="ml-auto cd-text-faint hover:cd-text" onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-3 flex items-center gap-2 flex-wrap border-b cd-border-c">
          <div className="relative">
            <Search className="w-3.5 h-3.5 cd-text-faint absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              className="cd-input text-sm w-72"
              style={{ paddingLeft: 32 }}
              placeholder="제목·본문 검색"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <select className="cd-select" style={{ width: 150 }} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">전체 분류</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <span className="ml-auto text-[11px] cd-text-faint">{items.length}건 · 선택 {pickedList.length}건</span>
        </div>

        <div className="flex-1 min-h-0 flex">
          {/* 좌: 목록 */}
          <div className="w-[46%] border-r cd-border-c overflow-y-auto p-3 flex flex-col gap-1.5">
            {loading ? (
              <p className="text-[12px] cd-text-faint p-6 text-center">불러오는 중...</p>
            ) : items.length === 0 ? (
              <p className="text-[12px] cd-text-faint p-6 text-center">
                조항이 없습니다. 양식 기준 관리 → 조항 라이브러리에서 [기존 양식 조문 수확]을 실행해 채우세요.
              </p>
            ) : (
              items.map((c) => (
                <button
                  key={c.clauseId}
                  type="button"
                  className={`rounded-xl border px-3 py-2 text-left flex items-start gap-2 ${
                    preview?.clauseId === c.clauseId ? "cd-tint-primary border-transparent" : "cd-solid-bg cd-border-c"
                  }`}
                  onClick={() => setPreview(c)}
                >
                  <span
                    className={`mt-0.5 w-4 h-4 rounded border shrink-0 flex items-center justify-center ${
                      picked[c.clauseId] ? "cd-fill-primary border-transparent" : "cd-border-c"
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(c);
                    }}
                  >
                    {picked[c.clauseId] && <Check className="w-3 h-3 text-white" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-semibold cd-text truncate">{c.title}</span>
                    <span className="block text-[11px] cd-text-faint truncate">{c.body.replace(/\s+/g, " ").slice(0, 60)}</span>
                  </span>
                  <span className="text-[10px] cd-text-faint shrink-0">{c.category}</span>
                </button>
              ))
            )}
          </div>

          {/* 우: 미리보기 */}
          <div className="flex-1 min-w-0 overflow-y-auto p-4">
            {preview ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold cd-text">{preview.title}</h4>
                  <span className="text-[10.5px] rounded-full border cd-border-c px-1.5 py-0.5 cd-text-faint">{preview.category}</span>
                  {preview.usageCount > 0 && <span className="text-[10.5px] cd-text-faint">{preview.usageCount}회 사용</span>}
                  <button
                    type="button"
                    className={`ml-auto cd-btn rounded-lg px-3 py-1.5 text-[11.5px] font-semibold ${picked[preview.clauseId] ? "cd-btn-primary" : "border cd-border-c"}`}
                    onClick={() => toggle(preview)}
                  >
                    {picked[preview.clauseId] ? "선택됨" : "선택"}
                  </button>
                </div>
                <pre className="text-[12px] cd-text whitespace-pre-wrap leading-relaxed font-sans rounded-xl border cd-border-c p-3">
                  {preview.body}
                </pre>
                <p className="text-[10.5px] cd-text-faint">
                  {"{{contract.title}}"} 같은 토큰은 삽입 후 문서 값으로 자동 치환됩니다.
                </p>
              </div>
            ) : (
              <p className="text-[12px] cd-text-faint p-8 text-center">왼쪽에서 조항을 선택하면 전문이 표시됩니다.</p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t cd-border-c">
          <button type="button" className="cd-btn rounded-lg border cd-border-c px-3.5 py-2 text-xs font-semibold" onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold disabled:opacity-50"
            disabled={!pickedList.length}
            onClick={() => onInsert(pickedList)}
          >
            선택한 {pickedList.length}개 조항 삽입
          </button>
        </div>
      </div>
    </div>
  );
}
