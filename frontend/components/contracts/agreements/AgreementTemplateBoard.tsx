"use client";

// 계약서 양식 기준 관리(/contracts/agreements/templates) — 견적 기준 관리(QuoteSettingsBoard)
// 스타일. 용역 대분류→세분류 목록에 각 세분류의 활성 표준 셋을 매핑해 열람/편집한다
// (2026-08-10 사용자 확정: 견적 '기준 세트'와 같은 목록화 관리).
// 시드(코드 상수)는 편집 시 DB 로 fork 되고, 미지정 세분류는 다른 셋 복제로 채운다.
// 발주처 자체양식(custom)은 별도 탭 — 업로드/분석(P3)은 후속.

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Building2, Copy, FileSignature, Plus, Save, Trash2, X } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { QUOTE_SERVICE_OPTIONS } from "@/lib/quote/types";
import type { AgreementClause, AgreementSpec, AgreementTemplateRow } from "@/lib/agreement/types";
import "@/components/cdash/cdash.css";

interface StandardCell {
  serviceSubtype: string;
  templateId: string | null;
  name: string | null;
  seeded: boolean;
  clauseCount: number;
}
interface StandardGroup {
  serviceType: string;
  subtypes: StandardCell[];
}
interface CustomRow {
  templateId: string;
  name: string;
  originFacilityId: string | null;
  originFacilityName: string | null;
  updatedAt: string;
}

let seq = 0;
const newClauseId = () => `c-${Date.now().toString(36)}-${seq++}`;

export function AgreementTemplateBoard() {
  const { theme } = useCdashTheme();
  const [tab, setTab] = useState<"standard" | "custom">("standard");
  const [typeTab, setTypeTab] = useState<string>("");
  const [standard, setStandard] = useState<StandardGroup[]>([]);
  const [custom, setCustom] = useState<CustomRow[]>([]);
  const [loading, setLoading] = useState(true);

  // 편집 패널
  const [editing, setEditing] = useState<{ serviceType: string; serviceSubtype: string } | null>(null);
  const [tpl, setTpl] = useState<AgreementTemplateRow | null>(null);
  const [name, setName] = useState("");
  const [clauses, setClauses] = useState<AgreementClause[]>([]);
  const [clauseTab, setClauseTab] = useState(0);
  const [spec, setSpec] = useState<AgreementSpec | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/contracts/agreements/templates", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.standard) {
          setStandard(d.standard);
          setTypeTab((cur) => cur || d.standard[0]?.serviceType || "");
        }
        if (d?.custom) setCustom(d.custom);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const openEditor = async (serviceType: string, cell: StandardCell) => {
    setEditing({ serviceType, serviceSubtype: cell.serviceSubtype });
    setClauseTab(0);
    setTpl(null);
    setName("");
    setClauses([]);
    setSpec(null);
    if (!cell.templateId) return; // 미지정 — 복제로 시작
    const res = await fetch(
      `/api/contracts/agreements/templates?serviceType=${encodeURIComponent(serviceType)}&serviceSubtype=${encodeURIComponent(cell.serviceSubtype)}`,
      { cache: "no-store" }
    );
    if (!res.ok) return;
    const d = await res.json();
    const t = d?.template as AgreementTemplateRow | null;
    if (!t) return;
    setTpl(t);
    setName(t.name);
    setSpec(t.spec);
    setClauses((t.spec.clausePage?.clauses ?? []).map((c) => ({ ...c })));
  };

  /** 다른 세분류의 활성 셋 복제 — 미지정 세분류 채우기 */
  const copyFrom = async (serviceType: string, serviceSubtype: string) => {
    const res = await fetch(
      `/api/contracts/agreements/templates?serviceType=${encodeURIComponent(serviceType)}&serviceSubtype=${encodeURIComponent(serviceSubtype)}`,
      { cache: "no-store" }
    );
    if (!res.ok) return alert("복제 원본을 불러오지 못했습니다.");
    const d = await res.json();
    const t = d?.template as AgreementTemplateRow | null;
    if (!t) return alert("해당 세분류에 활성 셋이 없습니다.");
    setSpec(t.spec);
    setClauses((t.spec.clausePage?.clauses ?? []).map((c) => ({ ...c })));
    if (!name) setName(t.name);
    alert(`"${t.name}" 셋을 복제했습니다. 저장하면 이 세분류의 표준 셋이 됩니다.`);
  };

  const save = async () => {
    if (!editing || !spec) return alert("저장할 양식 내용이 없습니다(복제 또는 기존 셋 편집으로 시작하세요).");
    if (!name.trim()) return alert("양식 이름을 입력하세요.");
    setBusy(true);
    try {
      const nextSpec: AgreementSpec = spec.clausePage
        ? { ...spec, clausePage: { ...spec.clausePage, clauses } }
        : spec;
      const res = await fetch("/api/contracts/agreements/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // 시드(agt-std-*)·타 세분류 복제는 신규 fork — DB 행 편집만 templateId 유지
          templateId: tpl && !tpl.seeded && tpl.serviceSubtype === editing.serviceSubtype ? tpl.templateId : null,
          name: name.trim(),
          kind: "standard",
          serviceType: editing.serviceType,
          serviceSubtype: editing.serviceSubtype,
          status: "active",
          spec: nextSpec,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "저장 실패");
      alert("저장되었습니다.");
      setEditing(null);
      load();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const updateClause = (i: number, patch: Partial<AgreementClause>) =>
    setClauses((prev) => prev.map((c, ci) => (ci === i ? { ...c, ...patch } : c)));
  const moveClause = (i: number, dir: -1 | 1) =>
    setClauses((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        title="계약서 양식 기준 관리"
        actions={
          <a href="/contracts/agreements" className="cd-btn cd-solid-bg rounded-lg border cd-border-c px-3 py-2 text-xs font-semibold cd-text">
            계약서 작성으로
          </a>
        }
      />
      {/* 탭 — 업무추진계획(ExecWorkspace) 세그먼트 패턴. 활성=그라데이션, 비활성=불투명 흰색 */}
      <div className="inline-flex self-start rounded-xl border cd-border-c overflow-hidden text-[12px] font-semibold">
        <button
          type="button"
          className={`px-3.5 py-2 flex items-center gap-1.5 ${tab === "standard" ? "cd-fill-primary text-white" : "cd-solid-bg cd-text-muted"}`}
          onClick={() => setTab("standard")}
        >
          <FileSignature className="w-3.5 h-3.5" /> 용역 분류별 표준 셋
        </button>
        <button
          type="button"
          className={`px-3.5 py-2 flex items-center gap-1.5 border-l cd-border-c ${tab === "custom" ? "cd-fill-primary text-white" : "cd-solid-bg cd-text-muted"}`}
          onClick={() => setTab("custom")}
        >
          <Building2 className="w-3.5 h-3.5" /> 발주처 자체양식
        </button>
      </div>

      {loading ? (
        <div className="cd-card rounded-3xl p-10 text-center text-sm cd-text-faint">불러오는 중...</div>
      ) : tab === "standard" ? (
        <div className="flex flex-col xl:flex-row gap-5 items-start">
          <div className={`flex-1 min-w-0 flex flex-col gap-3 w-full ${editing ? "xl:max-w-[420px]" : "max-w-[760px]"}`}>
            {/* 용역 대분류 탭 — 세로 스크롤 최소화(2026-08-11 사용자 요청) */}
            <div className="inline-flex self-start rounded-xl border cd-border-c overflow-hidden text-[12px] font-semibold flex-wrap">
              {standard.map((g, gi) => (
                <button
                  key={g.serviceType}
                  type="button"
                  className={`px-3.5 py-2 ${gi > 0 ? "border-l cd-border-c" : ""} ${
                    typeTab === g.serviceType ? "cd-fill-primary text-white" : "cd-solid-bg cd-text-muted"
                  }`}
                  onClick={() => setTypeTab(g.serviceType)}
                >
                  {g.serviceType}
                  <span className={`ml-1.5 text-[10.5px] ${typeTab === g.serviceType ? "opacity-80" : "cd-text-faint"}`}>
                    {g.subtypes.filter((s) => s.templateId).length}/{g.subtypes.length}
                  </span>
                </button>
              ))}
            </div>
            {standard
              .filter((g) => g.serviceType === (typeTab || standard[0]?.serviceType))
              .map((g) => (
              <div key={g.serviceType} className="cd-card rounded-3xl p-5 flex flex-col gap-2">
                <h3 className="font-bold cd-text text-sm">{g.serviceType}</h3>
                <div className="flex flex-col gap-1">
                  {g.subtypes.map((cell) => (
                    <button
                      key={cell.serviceSubtype}
                      type="button"
                      className={`rounded-xl border px-3 py-2 flex items-center gap-2 text-left ${
                        editing?.serviceType === g.serviceType && editing?.serviceSubtype === cell.serviceSubtype
                          ? "cd-tint-primary"
                          : "cd-solid-bg cd-border-c hover:cd-tint-primary"
                      }`}
                      onClick={() => openEditor(g.serviceType, cell)}
                    >
                      <span className="text-[12.5px] cd-text w-32 shrink-0 font-medium">{cell.serviceSubtype}</span>
                      {cell.templateId ? (
                        <>
                          <span className="text-[12px] cd-text truncate flex-1">{cell.name}</span>
                          {cell.seeded ? (
                            <span className="text-[10px] rounded-full border cd-border-c px-1.5 py-0.5 cd-text-faint shrink-0">기본 시드</span>
                          ) : (
                            <span className="text-[10px] rounded-full cd-fill-primary px-1.5 py-0.5 shrink-0">사용자 셋</span>
                          )}
                          {cell.clauseCount > 0 && <span className="text-[10.5px] cd-text-faint shrink-0">{cell.clauseCount}개조</span>}
                        </>
                      ) : (
                        <span className="text-[12px] text-[color:var(--cd-danger,#FA896B)] flex-1">미지정 — 클릭해 등록</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* 편집 패널 */}
          {editing && (
            <div className="cd-card rounded-3xl p-5 w-full xl:w-[1120px] shrink-0 flex flex-col gap-3 xl:sticky xl:top-4">
              <div className="flex items-center gap-2">
                <h3 className="font-bold cd-text text-sm">
                  {editing.serviceType} · {editing.serviceSubtype}
                </h3>
                <button type="button" className="ml-auto cd-text-faint hover:cd-text" onClick={() => setEditing(null)}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] cd-text-faint">양식 이름</span>
                <input className="cd-input text-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 통합환경 도급계약서(표준)" />
              </label>

              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] cd-text-faint">다른 세분류 셋 복제:</span>
                {QUOTE_SERVICE_OPTIONS.flatMap((o) =>
                  o.subtypes
                    .filter((s) => !(o.type === editing.serviceType && s === editing.serviceSubtype))
                    .slice(0, 0) // 드롭다운으로 대체 — 아래 select
                )}
                <CopySelect onCopy={(t, s) => copyFrom(t, s)} exclude={editing} />
              </div>

              {spec?.clausePage ? (
                /* 좌: 조 목록 / 우: 선택 조 편집 — 계약서 작성 화면 조문 UI 와 동일(사용자 확정) */
                <div className="flex flex-col md:flex-row gap-4 items-start">
                  <div className="w-full md:w-[240px] shrink-0 flex flex-col gap-1.5">
                    <div className="flex flex-col gap-1 max-h-[52vh] overflow-y-auto pr-1">
                      {clauses.map((c, i) => (
                        <button
                          key={c.id}
                          type="button"
                          className={`rounded-lg px-2.5 py-1.5 text-left text-[12px] border flex items-center gap-1.5 ${
                            clauseTab === i ? "cd-fill-primary text-white border-transparent font-semibold" : "cd-solid-bg cd-border-c cd-text-muted"
                          }`}
                          onClick={() => setClauseTab(i)}
                        >
                          <span className={`font-mono text-[10.5px] shrink-0 ${clauseTab === i ? "opacity-80" : "cd-text-faint"}`}>{i + 1}</span>
                          <span className="truncate">{c.title || "(제목 없음)"}</span>
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="cd-btn rounded-lg border border-dashed cd-border-c px-3 py-1.5 text-[11.5px] cd-text-faint"
                      onClick={() => {
                        setClauses((prev) => [...prev, { id: newClauseId(), title: "새 조항", body: "" }]);
                        setClauseTab(clauses.length);
                      }}
                    >
                      ＋ 조항 추가
                    </button>
                  </div>

                  <div className="flex-1 min-w-0 w-full rounded-2xl border cd-border-c p-3.5 flex flex-col gap-2">
                    {clauses[Math.min(clauseTab, clauses.length - 1)] && (() => {
                      const i = Math.min(clauseTab, clauses.length - 1);
                      const c = clauses[i];
                      return (
                        <>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10.5px] font-mono cd-text-faint w-12 shrink-0">제 {i + 1} 조</span>
                            <input className="cd-input text-[12.5px] flex-1 font-medium" value={c.title} onChange={(e) => updateClause(i, { title: e.target.value })} />
                            <button type="button" className="cd-text-faint hover:cd-text disabled:opacity-30" disabled={i === 0} title="위로" onClick={() => { moveClause(i, -1); setClauseTab(i - 1); }}>
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button type="button" className="cd-text-faint hover:cd-text disabled:opacity-30" disabled={i === clauses.length - 1} title="아래로" onClick={() => { moveClause(i, 1); setClauseTab(i + 1); }}>
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                            <button type="button" className="cd-text-faint hover:cd-text" title="아래에 삽입" onClick={() => { setClauses((prev) => { const next = [...prev]; next.splice(i + 1, 0, { id: newClauseId(), title: "새 조항", body: "" }); return next; }); setClauseTab(i + 1); }}>
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                            <button type="button" className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]" title="삭제" onClick={() => { setClauses((prev) => prev.filter((_, ci) => ci !== i)); setClauseTab(Math.max(0, i - 1)); }}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          {c.binding === "payment" ? (
                            <p className="text-[11px] cd-text-faint rounded-lg cd-tint-primary px-2 py-1">지급 단계 데이터에서 자동 생성되는 조 — 본문은 문서 작성 시 채워집니다.</p>
                          ) : (
                            <textarea className="cd-input text-[12px] min-h-[300px] leading-relaxed" value={c.body} onChange={(e) => updateClause(i, { body: e.target.value })} />
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              ) : spec ? (
                <p className="text-[12px] cd-text-faint rounded-xl border cd-border-c px-3 py-2.5">
                  이 양식은 1장 갑지형(별지 조문 없음)입니다 — 갑지 구성은 코드 정의를 따르고, 이름만 관리합니다.
                </p>
              ) : (
                <p className="text-[12px] cd-text-faint rounded-xl border border-dashed cd-border-c px-3 py-2.5">
                  아직 셋이 없습니다. 위 복제 드롭다운에서 기존 셋을 가져와 시작하세요.
                </p>
              )}

              <button type="button" className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold flex items-center gap-1.5 self-end disabled:opacity-50" disabled={busy || !spec} onClick={save}>
                <Save className="w-3.5 h-3.5" /> {busy ? "저장 중..." : "이 세분류의 표준 셋으로 저장"}
              </button>
            </div>
          )}
        </div>
      ) : (
        <CustomTemplateTab custom={custom} onSaved={load} />
      )}
    </div>
  );
}

/** 발주처 자체양식 탭 — 업로드/AI 분석/검수/저장(P3). 분석 결과는 저장 전까지 화면에만 있다. */
function CustomTemplateTab({ custom, onSaved }: { custom: CustomRow[]; onSaved: () => void }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [draft, setDraft] = useState<{ spec: AgreementSpec; note: string | null; fileName: string } | null>(null);
  const [name, setName] = useState("");
  const [clauses, setClauses] = useState<AgreementClause[]>([]);
  const [facilityQ, setFacilityQ] = useState("");
  const [facilityOptions, setFacilityOptions] = useState<{ facilityId: string; companyName: string }[]>([]);
  const [facility, setFacility] = useState<{ facilityId: string; companyName: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (facilityQ.trim().length < 2) {
      setFacilityOptions([]);
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/facilities?q=${encodeURIComponent(facilityQ.trim())}&limit=10&sort=name`, { cache: "no-store", signal: controller.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setFacilityOptions(Array.isArray(d?.items) ? d.items : []))
        .catch(() => {});
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [facilityQ]);

  const analyze = async (file: File) => {
    setAnalyzing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/contracts/agreements/templates/analyze", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "분석 실패");
      setDraft({ spec: data.spec, note: data.note ?? null, fileName: data.fileName ?? file.name });
      setClauses((data.spec?.clausePage?.clauses ?? []).map((c: AgreementClause) => ({ ...c })));
      setName(file.name.replace(/\.hwpx$/i, ""));
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setAnalyzing(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    if (!name.trim()) return alert("양식 이름을 입력하세요.");
    setBusy(true);
    try {
      const spec: AgreementSpec = draft.spec.clausePage
        ? { ...draft.spec, clausePage: { ...draft.spec.clausePage, clauses } }
        : draft.spec;
      const res = await fetch("/api/contracts/agreements/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: null,
          name: name.trim(),
          kind: "custom",
          originFacilityId: facility?.facilityId ?? null,
          spec,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "저장 실패");
      alert("자체양식이 등록되었습니다. 작성 화면에서 해당 발주처 선택 시 추천됩니다.");
      setDraft(null);
      setName("");
      setFacility(null);
      onSaved();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col xl:flex-row gap-5 items-start">
      <div className="cd-card rounded-3xl p-5 flex flex-col gap-3 w-full max-w-[560px]">
        <h3 className="font-bold cd-text text-sm">발주처 자체양식 업로드/분석</h3>
        <p className="text-[11.5px] cd-text-faint">
          발주처가 보내온 계약서 양식(HWPX)을 업로드하면 AI 가 조문·당사자 용어를 추출해 편집 가능한
          셋으로 변환합니다. 갑지는 표준 골격으로 정규화됩니다(원본 서식 그대로가 필요하면 관리자에게 문의).
        </p>
        <label className="cd-btn rounded-lg border border-dashed cd-border-c px-3 py-3 text-xs cd-text-faint text-center cursor-pointer">
          {analyzing ? "분석 중... (수십 초 소요)" : "HWPX 파일 선택 → AI 분석"}
          <input
            type="file"
            accept=".hwpx"
            className="hidden"
            disabled={analyzing}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) analyze(f);
              e.target.value = "";
            }}
          />
        </label>
        <div className="flex flex-col gap-1 border-t cd-border-c pt-3">
          <span className="text-[11px] cd-text-faint">등록된 자체양식</span>
          {custom.length === 0 ? (
            <p className="text-[12px] cd-text-faint py-2 text-center">등록된 자체양식이 없습니다.</p>
          ) : (
            custom.map((t) => (
              <div key={t.templateId} className="rounded-xl border cd-border-c px-3 py-2 flex items-center gap-2">
                <span className="text-[12.5px] cd-text font-medium flex-1">{t.name}</span>
                <span className="text-[11px] cd-text-faint">{t.originFacilityName ?? "발주처 미지정"}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {draft && (
        <div className="cd-card rounded-3xl p-5 w-full xl:w-[600px] shrink-0 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <h3 className="font-bold cd-text text-sm">분석 검수 — {draft.fileName}</h3>
            <button type="button" className="ml-auto cd-text-faint hover:cd-text" onClick={() => setDraft(null)}>
              <X className="w-4 h-4" />
            </button>
          </div>
          {draft.note && (
            <p className="text-[11.5px] rounded-lg cd-tint-primary px-3 py-2">AI 메모: {draft.note}</p>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] cd-text-faint">양식 이름</span>
            <input className="cd-input text-sm" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="flex flex-col gap-1 relative">
            <span className="text-[11px] cd-text-faint">출처 발주처 — 작성 화면 자동 추천 기준(선택)</span>
            {facility ? (
              <div className="flex items-center gap-2 rounded-xl border cd-border-c px-3 py-2">
                <span className="text-[12.5px] cd-text flex-1">{facility.companyName}</span>
                <button type="button" className="cd-text-faint" onClick={() => setFacility(null)}>
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <>
                <input className="cd-input text-sm" value={facilityQ} placeholder="사업장 검색 (2자 이상)" onChange={(e) => setFacilityQ(e.target.value)} />
                {facilityOptions.length > 0 && (
                  <div className="absolute z-30 top-full mt-1 w-full rounded-xl border cd-border-c cd-solid-bg shadow-xl p-1.5 max-h-52 overflow-y-auto">
                    {facilityOptions.map((o) => (
                      <button key={o.facilityId} type="button" className="w-full text-left rounded-lg px-2.5 py-1.5 hover:cd-tint-primary text-[12.5px] cd-text" onClick={() => { setFacility(o); setFacilityOptions([]); setFacilityQ(""); }}>
                        {o.companyName}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <p className="text-[11px] cd-text-faint">
            당사자 호칭: {draft.spec.terms.orderer} / {draft.spec.terms.contractor} · 조 표기: {draft.spec.clausePage?.noFormat === "bracket" ? "제N조 [제목]" : "제 N 조 (제목)"} · {clauses.length}개조
          </p>
          <div className="flex flex-col gap-2 min-h-0 overflow-y-auto max-h-[46vh] pr-1">
            {clauses.map((c, i) => (
              <div key={c.id} className="rounded-xl border cd-border-c p-2.5 flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10.5px] font-mono cd-text-faint w-12 shrink-0">제 {i + 1} 조</span>
                  <input className="cd-input text-[12.5px] flex-1 font-medium" value={c.title} onChange={(e) => setClauses((prev) => prev.map((x, xi) => (xi === i ? { ...x, title: e.target.value } : x)))} />
                  <button type="button" className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]" onClick={() => setClauses((prev) => prev.filter((_, ci) => ci !== i))}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {c.binding === "payment" ? (
                  <p className="text-[11px] cd-text-faint rounded-lg cd-tint-primary px-2 py-1">지급방법 조 — 문서 작성 시 지급 단계에서 자동 생성.</p>
                ) : (
                  <textarea className="cd-input text-[11.5px] min-h-[52px] leading-relaxed" value={c.body} onChange={(e) => setClauses((prev) => prev.map((x, xi) => (xi === i ? { ...x, body: e.target.value } : x)))} />
                )}
              </div>
            ))}
          </div>
          <button type="button" className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold flex items-center gap-1.5 self-end disabled:opacity-50" disabled={busy} onClick={save}>
            <Save className="w-3.5 h-3.5" /> {busy ? "저장 중..." : "자체양식으로 등록"}
          </button>
        </div>
      )}
    </div>
  );
}

/** 복제 원본 선택 드롭다운 — 대분류/세분류 2단 */
function CopySelect({ onCopy, exclude }: { onCopy: (serviceType: string, serviceSubtype: string) => void; exclude: { serviceType: string; serviceSubtype: string } }) {
  const [type, setType] = useState(QUOTE_SERVICE_OPTIONS[0].type);
  const subtypes = QUOTE_SERVICE_OPTIONS.find((o) => o.type === type)?.subtypes ?? [];
  const [sub, setSub] = useState(subtypes[0] ?? "");
  return (
    <span className="inline-flex items-center gap-1">
      <select className="cd-select" style={{ width: 110 }} value={type} onChange={(e) => { setType(e.target.value); setSub(QUOTE_SERVICE_OPTIONS.find((o) => o.type === e.target.value)?.subtypes[0] ?? ""); }}>
        {QUOTE_SERVICE_OPTIONS.map((o) => (
          <option key={o.type} value={o.type}>{o.type}</option>
        ))}
      </select>
      <select className="cd-select" style={{ width: 130 }} value={sub} onChange={(e) => setSub(e.target.value)}>
        {subtypes.map((s) => (
          <option key={s} value={s} disabled={type === exclude.serviceType && s === exclude.serviceSubtype}>{s}</option>
        ))}
      </select>
      <button type="button" className="cd-btn rounded-lg border cd-border-c px-2 py-1.5 text-[11px] cd-text-faint flex items-center gap-1" onClick={() => sub && onCopy(type, sub)}>
        <Copy className="w-3 h-3" /> 복제
      </button>
    </span>
  );
}
