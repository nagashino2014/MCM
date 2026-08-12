"use client";

// 계약서 양식 기준 관리(/contracts/agreements/templates) — 견적 기준 관리(QuoteSettingsBoard)
// 스타일. 용역 대분류→세분류 목록에 각 세분류의 활성 표준 셋을 매핑해 열람/편집한다
// (2026-08-10 사용자 확정: 견적 '기준 세트'와 같은 목록화 관리).
// 시드(코드 상수)는 편집 시 DB 로 fork 되고, 미지정 세분류는 다른 셋 복제로 채운다.
// 발주처 자체양식(custom)은 별도 탭 — 업로드/분석(P3)은 후속.

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, BookOpen, Building2, Copy, Download, FileSignature, Plus, Save, Trash2, X } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { QUOTE_SERVICE_OPTIONS } from "@/lib/quote/types";
import type { TemplateProfile } from "@/lib/deliverable/types";
import type { AgreementClause, AgreementRenderMode, AgreementSpec, AgreementTemplateRow } from "@/lib/agreement/types";
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
  renderMode?: "spec" | "overlay";
  slotCount?: number;
  clauseCount?: number;
  updatedAt: string;
}

let seq = 0;
const newClauseId = () => `c-${Date.now().toString(36)}-${seq++}`;

export function AgreementTemplateBoard() {
  const { theme } = useCdashTheme();
  const [tab, setTab] = useState<"standard" | "custom" | "library">("standard");
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
        <button
          type="button"
          className={`px-3.5 py-2 flex items-center gap-1.5 border-l cd-border-c ${tab === "library" ? "cd-fill-primary text-white" : "cd-solid-bg cd-text-muted"}`}
          onClick={() => setTab("library")}
        >
          <BookOpen className="w-3.5 h-3.5" /> 조항 라이브러리
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
      ) : tab === "custom" ? (
        <CustomTemplateTab custom={custom} onSaved={load} />
      ) : (
        <ClauseLibraryTab />
      )}
    </div>
  );
}

/** 발주처 자체양식 탭 — 업로드/AI 분석/검수/저장(P3). 분석 결과는 저장 전까지 화면에만 있다. */
function CustomTemplateTab({ custom, onSaved }: { custom: CustomRow[]; onSaved: () => void }) {
  const [analyzing, setAnalyzing] = useState(false);
  // overlay = 발주처 원본 서식 그대로 + 값만 주입(148) / spec = 조문 편집 가능한 재구축
  const [mode, setMode] = useState<AgreementRenderMode>("overlay");
  const [draft, setDraft] = useState<{
    mode: AgreementRenderMode;
    spec?: AgreementSpec;
    profile?: TemplateProfile;
    unmapped?: string[];
    slotCount?: number;
    sourceKey?: string;
    note: string | null;
    fileName: string;
  } | null>(null);
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
      fd.append("mode", mode);
      const res = await fetch("/api/contracts/agreements/templates/analyze", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "분석 실패");
      setDraft({
        mode: data.mode === "overlay" ? "overlay" : "spec",
        spec: data.spec,
        profile: data.profile,
        unmapped: data.unmapped ?? [],
        slotCount: data.slotCount ?? 0,
        sourceKey: data.sourceKey,
        note: data.note ?? null,
        fileName: data.fileName ?? file.name,
      });
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
      const spec: AgreementSpec | undefined = draft.spec?.clausePage
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
          renderMode: draft.mode,
          profile: draft.profile ?? null,
          sourceKind: "hwpx",
          sourceKey: draft.sourceKey ?? null,
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
          발주처가 보내온 계약서 양식(HWPX)을 업로드하면 AI 가 값 자리·조문을 분석합니다.
          아래에서 원본 서식을 그대로 쓸지, 조문을 편집할 수 있게 재구축할지 고르세요.
        </p>
        {/* 렌더 모드 — overlay 는 원본 보존(발주처가 서식을 고집할 때), spec 은 재구축(편집 자유) */}
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            className={`rounded-xl border px-3 py-2.5 text-left ${mode === "overlay" ? "cd-tint-primary border-transparent" : "cd-solid-bg cd-border-c"}`}
            onClick={() => setMode("overlay")}
          >
            <span className="text-[12.5px] font-bold cd-text">원본 서식 보존 (권장)</span>
            <span className="block text-[11px] cd-text-faint mt-0.5">
              발주처 HWPX 를 그대로 두고 값(계약명·금액·지급조건·날인)만 채웁니다. 표 선·자간·여백이 100% 유지되며,
              조문은 원본 그대로라 앱에서 편집하지 않습니다.
            </span>
          </button>
          <button
            type="button"
            className={`rounded-xl border px-3 py-2.5 text-left ${mode === "spec" ? "cd-tint-primary border-transparent" : "cd-solid-bg cd-border-c"}`}
            onClick={() => setMode("spec")}
          >
            <span className="text-[12.5px] font-bold cd-text">조문 편집형 (재구축)</span>
            <span className="block text-[11px] cd-text-faint mt-0.5">
              조문을 추출해 앱에서 수정·삽입할 수 있게 만듭니다. 갑지는 당사 표준 골격으로 정규화되어
              원본과 서식이 달라질 수 있습니다.
            </span>
          </button>
        </div>
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
              <div key={t.templateId} className="rounded-xl cd-solid-bg border cd-border-c px-3 py-2 flex items-center gap-2">
                <span className="text-[12.5px] cd-text font-medium flex-1 truncate">{t.name}</span>
                <span className={`text-[10px] rounded-full px-1.5 py-0.5 shrink-0 ${t.renderMode === "overlay" ? "cd-fill-primary" : "border cd-border-c cd-text-faint"}`}>
                  {t.renderMode === "overlay" ? `원본 보존 · ${t.slotCount ?? 0}자리` : `조문 편집 · ${t.clauseCount ?? 0}개조`}
                </span>
                <span className="text-[11px] cd-text-faint shrink-0">{t.originFacilityName ?? "발주처 미지정"}</span>
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
          {draft.mode === "overlay" ? (
            /* overlay 검수 — 값 자리 매핑만 확인한다(조문·서식은 원본 그대로라 편집 대상이 아니다) */
            <>
              <p className="text-[11px] cd-text-faint">
                원본 서식 보존 · 값 자리 <b className="cd-text">{draft.slotCount ?? 0}곳</b> 매핑됨. 조문과 표 서식은 원본 그대로 유지됩니다.
              </p>
              {(draft.unmapped?.length ?? 0) > 0 && (
                <p className="text-[11.5px] rounded-lg px-3 py-2" style={{ background: "rgba(250,137,107,0.15)", color: "var(--cd-danger, #FA896B)" }}>
                  매핑되지 않은 항목: {draft.unmapped!.join(", ")} — 이 값은 계약서에 채워지지 않습니다.
                  양식에 해당 자리가 없으면 정상이고, 있는데 못 찾았다면 spec(조문 편집형)으로 다시 분석해 보세요.
                </p>
              )}
              <div className="flex flex-col gap-1 min-h-0 overflow-y-auto max-h-[46vh] pr-1">
                {(draft.profile?.docs?.[0]?.slots ?? []).map((sl, i) => (
                  <div key={i} className="rounded-lg cd-solid-bg border cd-border-c px-2.5 py-1.5 flex items-center gap-2 text-[11.5px]">
                    <span className="font-mono text-[10.5px] cd-text-faint shrink-0 w-24">
                      {sl.target === "cell" ? `표${sl.table} r${sl.row}c${sl.col}` : `문단 ${sl.para}`}
                    </span>
                    <span className="cd-text truncate flex-1">{sl.label || "(라벨 없음)"}</span>
                    <span className="cd-text-primary font-semibold shrink-0">{sl.binding}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
          <>
          <p className="text-[11px] cd-text-faint">
            당사자 호칭: {draft.spec?.terms.orderer} / {draft.spec?.terms.contractor} · 조 표기: {draft.spec?.clausePage?.noFormat === "bracket" ? "제N조 [제목]" : "제 N 조 (제목)"} · {clauses.length}개조
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
          </>
          )}
          <button type="button" className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold flex items-center gap-1.5 self-end disabled:opacity-50" disabled={busy} onClick={save}>
            <Save className="w-3.5 h-3.5" /> {busy ? "저장 중..." : "자체양식으로 등록"}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 조항 라이브러리 탭(149) — 목록·검색·편집·삭제 + 기존 양식 조문 일괄 수확.
 * 작성 화면(ClauseLibraryModal)이 여기 쌓인 조항을 검색해 삽입한다.
 */
function ClauseLibraryTab() {
  interface Row {
    clauseId: string;
    title: string;
    body: string;
    category: string;
    serviceType: string | null;
    source: string;
    usageCount: number;
  }
  const [items, setItems] = useState<Row[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<Row | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftCat, setDraftCat] = useState("기타");

  const load = useCallback(() => {
    setLoading(true);
    const sp = new URLSearchParams();
    if (q.trim()) sp.set("q", q.trim());
    if (category) sp.set("category", category);
    fetch(`/api/contracts/agreements/clauses?${sp.toString()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setItems(Array.isArray(d?.clauses) ? d.clauses : []);
        if (Array.isArray(d?.categories)) setCategories(d.categories);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [q, category]);
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const openRow = (r: Row) => {
    setSel(r);
    setDraftTitle(r.title);
    setDraftBody(r.body);
    setDraftCat(r.category);
  };
  const newRow = () => {
    setSel({ clauseId: "", title: "", body: "", category: "기타", serviceType: null, source: "manual", usageCount: 0 });
    setDraftTitle("");
    setDraftBody("");
    setDraftCat("기타");
  };

  const harvest = async () => {
    if (!window.confirm("표준 셋·자체양식의 조문을 라이브러리에 일괄 등록합니다. 이미 있는 조항은 건너뜁니다.")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/contracts/agreements/clauses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "harvest" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "수확 실패");
      alert(`${data.added}건 등록, ${data.skipped}건 건너뜀(중복·자동생성 조).`);
      load();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!draftTitle.trim() || !draftBody.trim()) return alert("제목과 본문을 입력하세요.");
    setBusy(true);
    try {
      const isNew = !sel?.clauseId;
      const res = await fetch("/api/contracts/agreements/clauses", {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isNew
            ? { title: draftTitle, body: draftBody, category: draftCat }
            : { clauseId: sel!.clauseId, title: draftTitle, body: draftBody, category: draftCat }
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "저장 실패");
      if (data?.duplicated) alert("같은 내용의 조항이 이미 있습니다.");
      setSel(null);
      load();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: Row) => {
    if (!window.confirm(`"${r.title}" 조항을 라이브러리에서 삭제할까요?`)) return;
    try {
      const res = await fetch(`/api/contracts/agreements/clauses?clauseId=${encodeURIComponent(r.clauseId)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string })?.error ?? "삭제 실패");
      if (sel?.clauseId === r.clauseId) setSel(null);
      load();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  return (
    <div className="flex flex-col xl:flex-row gap-5 items-start">
      <div className="cd-card rounded-3xl p-5 flex flex-col gap-3 w-full max-w-[560px]">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-bold cd-text text-sm">조항 라이브러리</h3>
          <span className="text-[11px] cd-text-faint">{items.length}건</span>
          <button type="button" className="ml-auto cd-btn rounded-lg border cd-border-c px-2.5 py-1.5 text-[11px] flex items-center gap-1 disabled:opacity-50" disabled={busy} onClick={harvest} title="표준 셋·자체양식의 조문을 일괄 등록">
            <Download className="w-3.5 h-3.5" /> 기존 양식 조문 수확
          </button>
          <button type="button" className="cd-btn cd-btn-primary rounded-lg px-2.5 py-1.5 text-[11px] flex items-center gap-1" onClick={newRow}>
            <Plus className="w-3.5 h-3.5" /> 새 조항
          </button>
        </div>
        <p className="text-[11.5px] cd-text-faint">
          발주처가 요구한 특약을 모아 두면 계약서 작성 화면의 [라이브러리에서 추가]로 바로 삽입할 수 있습니다.
        </p>
        <div className="flex items-center gap-2">
          <input className="cd-input text-sm flex-1" placeholder="제목·본문 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="cd-select" style={{ width: 140 }} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">전체 분류</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 max-h-[58vh] overflow-y-auto pr-1">
          {loading ? (
            <p className="text-[12px] cd-text-faint p-6 text-center">불러오는 중...</p>
          ) : items.length === 0 ? (
            <p className="text-[12px] cd-text-faint p-6 text-center">
              등록된 조항이 없습니다. [기존 양식 조문 수확]으로 표준 셋 조문부터 채워 보세요.
            </p>
          ) : (
            items.map((r) => (
              <div
                key={r.clauseId}
                className={`rounded-xl border px-3 py-2 flex items-center gap-2 ${sel?.clauseId === r.clauseId ? "cd-tint-primary border-transparent" : "cd-solid-bg cd-border-c"}`}
              >
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openRow(r)}>
                  <span className="block text-[12.5px] font-semibold cd-text truncate">{r.title}</span>
                  <span className="block text-[11px] cd-text-faint truncate">{r.body.replace(/\s+/g, " ").slice(0, 50)}</span>
                </button>
                <span className="text-[10px] cd-text-faint shrink-0">{r.category}</span>
                {r.usageCount > 0 && <span className="text-[10px] cd-text-faint shrink-0">{r.usageCount}회</span>}
                <button type="button" className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)] shrink-0" onClick={() => remove(r)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {sel && (
        <div className="cd-card rounded-3xl p-5 w-full xl:w-[640px] shrink-0 flex flex-col gap-3 xl:sticky xl:top-4">
          <div className="flex items-center gap-2">
            <h3 className="font-bold cd-text text-sm">{sel.clauseId ? "조항 편집" : "새 조항 등록"}</h3>
            {sel.clauseId && (
              <span className="text-[10px] rounded-full border cd-border-c px-1.5 py-0.5 cd-text-faint">
                {sel.source === "seed" ? "표준 시드" : sel.source === "harvested" ? "양식 수확" : "직접 등록"}
              </span>
            )}
            <button type="button" className="ml-auto cd-text-faint hover:cd-text" onClick={() => setSel(null)}>
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className="text-[11px] cd-text-faint">조항 제목 (괄호 안 제목만)</span>
              <input className="cd-input text-sm" value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} placeholder="예: 지체상금" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] cd-text-faint">분류</span>
              <select className="cd-select" value={draftCat} onChange={(e) => setDraftCat(e.target.value)}>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] cd-text-faint">본문 — 항·호 포함. {"{{contract.title}}"} 등 토큰 사용 가능</span>
            <textarea className="cd-input text-[12px] min-h-[300px] leading-relaxed" value={draftBody} onChange={(e) => setDraftBody(e.target.value)} />
          </label>
          <button type="button" className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold flex items-center gap-1.5 self-end disabled:opacity-50" disabled={busy} onClick={save}>
            <Save className="w-3.5 h-3.5" /> {busy ? "저장 중..." : "저장"}
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
