"use client";

// 착수계·준공계 작성(/contracts/deliverables) — 계약을 고르면 자동 채움된 값으로 서식을 생성하고
// PDF 미리보기·다운로드, 이어서 공문 첨부로 발송(D3)한다. 결재는 태우지 않는다(공문 결재로 갈음).
// 설계: docs/contract-deliverables-blueprint.md §5.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Eye, FileSignature, Lock, Search, Send, Unlock } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { AutoDateInput } from "@/components/ui/AutoDateInput";
import { AmountInput } from "@/components/ui/AmountInput";
import { CATALOG_BY_TYPE, DEFAULT_DOC_TYPES, catalogByKind } from "@/lib/deliverable/catalog";
import { collectBindings } from "@/lib/deliverable/format";
import {
  BINDING_LABEL,
  DELIVERABLE_BINDINGS,
  DELIVERABLE_KIND_LABEL,
  type DeliverableKind,
  type DeliverableSpec,
  type DeliverableValues,
} from "@/lib/deliverable/types";
import "@/components/cdash/cdash.css";

interface ContractOption {
  contractId: string;
  title: string;
  ordererName: string;
  siteName: string;
  amount: number | null;
  contractDate: string;
  startedAt: string;
  endedAt: string;
  serviceType: string;
}

interface MilestoneOption {
  milestoneId: string;
  stageLabel: string;
  stageOrder: number;
  amount: number | null;
}

interface TemplateOption {
  templateId: string;
  name: string;
  ownerFacilityName: string | null;
  specs: DeliverableSpec[];
}

const BINDING_DEF = new Map(DELIVERABLE_BINDINGS.map((b) => [b.key, b]));

const fmtMoney = (n: number | null) => (n == null ? "—" : `${Math.round(n).toLocaleString("ko-KR")}원`);

export function DeliverableBoard() {
  const { theme } = useCdashTheme();
  const router = useRouter();

  const [kind, setKind] = useState<DeliverableKind>("start");
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<ContractOption[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [contract, setContract] = useState<ContractOption | null>(null);
  const [milestones, setMilestones] = useState<MilestoneOption[]>([]);
  const [milestoneId, setMilestoneId] = useState<string>("");
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [docTypes, setDocTypes] = useState<string[]>(DEFAULT_DOC_TYPES.start);
  const [values, setValues] = useState<DeliverableValues>({});
  const [unlocked, setUnlocked] = useState<Record<string, boolean>>({});
  const [deliverableId, setDeliverableId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // ── 계약 검색(디바운스) ──
  useEffect(() => {
    const controller = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/contracts/deliverables/sources?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setOptions(Array.isArray(d?.contracts) ? d.contracts : []))
        .catch(() => {});
    }, 180);
    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [q]);

  /** 계약·종류·기성회차가 바뀌면 자동 채움값을 다시 산출한다(잠금 해제한 항목은 보존). */
  const loadAutoValues = useCallback(
    async (contractId: string, nextKind: DeliverableKind, nextMilestoneId?: string) => {
      const params = new URLSearchParams({ contractId, kind: nextKind });
      if (nextMilestoneId) params.set("milestoneId", nextMilestoneId);
      const res = await fetch(`/api/contracts/deliverables/sources?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      setValues((prev) => {
        const auto = (data?.values ?? {}) as DeliverableValues;
        const merged: DeliverableValues = { ...auto };
        for (const [key, on] of Object.entries(unlocked)) if (on && prev[key] !== undefined) merged[key] = prev[key];
        return merged;
      });
      setMilestones(Array.isArray(data?.contract?.milestones) ? data.contract.milestones : []);
      setTemplates(Array.isArray(data?.templates) ? data.templates : []);
    },
    [unlocked]
  );

  const pickContract = async (c: ContractOption) => {
    setContract(c);
    setOptions([]);
    setSearchOpen(false);
    setQ("");
    setDeliverableId(null);
    setPreviewUrl(null);
    setUnlocked({});
    await loadAutoValues(c.contractId, kind);
  };

  const changeKind = async (next: DeliverableKind) => {
    setKind(next);
    setDocTypes(DEFAULT_DOC_TYPES[next]);
    setDeliverableId(null);
    setPreviewUrl(null);
    setTemplateId("");
    if (contract) await loadAutoValues(contract.contractId, next, milestoneId || undefined);
  };

  const changeMilestone = async (id: string) => {
    setMilestoneId(id);
    if (contract) await loadAutoValues(contract.contractId, kind, id || undefined);
  };

  // ── 선택된 서식 → 편집할 필드 목록 ──
  const specs = useMemo<DeliverableSpec[]>(() => {
    if (templateId) {
      const tpl = templates.find((t) => t.templateId === templateId);
      if (tpl) {
        const byType = new Map(tpl.specs.map((s) => [s.docType, s]));
        const picked = docTypes.map((t) => byType.get(t)).filter((s): s is DeliverableSpec => !!s);
        return picked.length ? picked : tpl.specs;
      }
    }
    return docTypes.map((t) => CATALOG_BY_TYPE[t]).filter((s): s is DeliverableSpec => !!s);
  }, [docTypes, templateId, templates]);

  const catalogOptions = useMemo(() => {
    if (templateId) {
      const tpl = templates.find((t) => t.templateId === templateId);
      return (tpl?.specs ?? []).map((s) => ({ docType: s.docType, title: s.title }));
    }
    return catalogByKind(kind).map((s) => ({ docType: s.docType, title: s.title }));
  }, [kind, templateId, templates]);

  const editableBindings = useMemo(() => collectBindings(specs), [specs]);

  const toggleDocType = (docType: string) => {
    setDocTypes((prev) => (prev.includes(docType) ? prev.filter((t) => t !== docType) : [...prev, docType]));
    setPreviewUrl(null);
  };

  const setValue = (key: string, v: string) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    setPreviewUrl(null);
  };

  const toggleLock = (key: string) => setUnlocked((prev) => ({ ...prev, [key]: !prev[key] }));

  /** 저장(생성 또는 갱신) 후 문서 id 반환. 미리보기·다운로드가 이 id 를 쓴다. */
  const save = async (): Promise<string | null> => {
    if (!contract) {
      setMsg("계약을 먼저 선택하세요.");
      return null;
    }
    if (!docTypes.length) {
      setMsg("생성할 서식을 하나 이상 선택하세요.");
      return null;
    }
    setBusy(true);
    setMsg(null);
    try {
      if (!deliverableId) {
        const res = await fetch("/api/contracts/deliverables", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contractId: contract.contractId,
            kind,
            templateId: templateId || null,
            docTypes,
            milestoneId: milestoneId || null,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "저장 실패");
        const id = String(data.deliverableId);
        // 화면에서 수정한 값으로 즉시 갱신
        await fetch(`/api/contracts/deliverables/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ values, unlocked, docTypes, templateId: templateId || null }),
        });
        setDeliverableId(id);
        return id;
      }
      const res = await fetch(`/api/contracts/deliverables/${deliverableId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values, unlocked, docTypes, templateId: templateId || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string })?.error ?? "저장 실패");
      }
      return deliverableId;
    } catch (err) {
      setMsg((err as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const preview = async () => {
    const id = await save();
    if (id) setPreviewUrl(`/api/contracts/deliverables/${id}/pdf?t=${Date.now()}`);
  };

  const download = async () => {
    const id = await save();
    if (id) window.open(`/api/contracts/deliverables/${id}/pdf?download=1&persist=1`, "_blank");
  };

  /** HWPX — 실물 hwp 템플릿 기반(기본양식 전용). 발주처가 편집 가능한 원본을 요구할 때 */
  const downloadHwpx = async () => {
    const id = await save();
    if (id) window.open(`/api/contracts/deliverables/${id}/hwpx`, "_blank");
  };

  const goLetter = async () => {
    const id = await save();
    if (id) router.push(`/approval/letter?deliverable=${id}`);
  };

  const inputFor = (key: string) => {
    const def = BINDING_DEF.get(key);
    const raw = values[key];
    const value = raw == null ? "" : String(raw);
    const locked = !unlocked[key];
    const common = "cd-input w-full disabled:opacity-60";
    if (def?.format === "multiline") {
      return (
        <textarea className={common} rows={3} value={value} disabled={locked} onChange={(e) => setValue(key, e.target.value)} />
      );
    }
    const isDate = def?.format?.startsWith("date");
    const isMoney = def?.format?.startsWith("amount");
    if (isDate) {
      // 8자리(YYYYMMDD) 연속 입력 → YYYY-MM-DD 자동 완성 (전사 공용 컴포넌트)
      return (
        <AutoDateInput className={common} value={value.slice(0, 10)} disabled={locked} onChange={(next) => setValue(key, next)} />
      );
    }
    if (isMoney) {
      // 금액은 타이핑 중에도 천단위 구분 표시(사용자 요청 2026-08-07)
      return <AmountInput className={common} value={value} disabled={locked} onChange={(next) => setValue(key, next)} />;
    }
    return (
      <input className={common} type="text" value={value} disabled={locked} onChange={(e) => setValue(key, e.target.value)} />
    );
  };

  return (
    <div className="cdash cd-fields-white min-h-screen p-6" data-theme={theme}>
      <CdPageHeader
        breadcrumbs={[{ label: "계약", href: "/contracts" }, { label: "착수계·준공계" }]}
        title="착수계·준공계 작성"
        meta={contract ? `${contract.ordererName || "발주처 미상"} · ${DELIVERABLE_KIND_LABEL[kind]}` : "계약을 선택하세요"}
        actions={
          <>
            <button type="button" className="cd-btn rounded-xl border cd-border-c px-3 py-2 text-[13px] flex items-center gap-1.5" onClick={preview} disabled={busy}>
              <Eye className="w-4 h-4" /> 미리보기
            </button>
            <button type="button" className="cd-btn rounded-xl border cd-border-c px-3 py-2 text-[13px] flex items-center gap-1.5" onClick={download} disabled={busy}>
              <Download className="w-4 h-4" /> PDF
            </button>
            <button
              type="button"
              className="cd-btn rounded-xl border cd-border-c px-3 py-2 text-[13px] flex items-center gap-1.5"
              onClick={downloadHwpx}
              disabled={busy || !!templateId}
              title={templateId ? "발주처 자체양식은 PDF 만 제공합니다" : "한글에서 편집 가능한 원본"}
            >
              <Download className="w-4 h-4" /> HWPX
            </button>
            <button
              type="button"
              className="cd-btn cd-fill-primary rounded-xl px-3 py-2 text-[13px] flex items-center gap-1.5"
              onClick={goLetter}
              disabled={busy}
              title="공문 작성 화면으로 이동해 이 문서를 첨부합니다"
            >
              <Send className="w-4 h-4" /> 공문으로 발송
            </button>
          </>
        }
      />

      {msg && (
        <div className="mb-4 rounded-xl px-4 py-2.5 text-[13px]" style={{ background: "var(--cd-error-soft)", color: "var(--cd-error)" }}>
          {msg}
        </div>
      )}

      <div className="flex flex-col xl:flex-row gap-5 items-start">
        {/* 좌: 작성 폼 — 미리보기와 6:4 */}
        <div className="w-full xl:flex-[6] min-w-0 flex flex-col gap-5">
          {/* 1) 계약 선택 — 검색 결과가 아래 카드들 위에 뜨도록 스택 순서를 올린다 */}
          <section className="cd-card rounded-3xl p-5 flex flex-col gap-3 relative z-30">
            <h3 className="font-bold cd-text text-sm flex items-center gap-2">
              <FileSignature className="w-4 h-4 cd-text-primary" /> 계약 선택
            </h3>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 cd-text-faint" />
              {/* .cd-input 의 padding 이 Tailwind pl-* 를 덮어써서 아이콘과 겹친다 → 인라인으로 고정 */}
              <input
                className="cd-input w-full"
                style={{ paddingLeft: "2.25rem" }}
                placeholder="계약명·발주처·사업장으로 검색"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onFocus={() => setSearchOpen(true)}
                onBlur={() => setTimeout(() => setSearchOpen(false), 140)} // 결과 클릭이 먼저 처리되도록
              />
              {/* 결과 목록: --cd-card 는 반투명(글라스)이라 뒤 카드가 비친다 → 불투명 토큰 사용 */}
              {searchOpen && options.length > 0 && (
                <div className="absolute z-50 mt-1 w-full max-h-[280px] overflow-auto rounded-xl border cd-border-c bg-[color:var(--cd-card-solid)] shadow-xl">
                  {options.map((c) => (
                    <button
                      key={c.contractId}
                      type="button"
                      className="w-full text-left px-3 py-2 hover:cd-tint-primary border-b cd-border-c last:border-0"
                      onClick={() => void pickContract(c)}
                    >
                      <div className="text-[13px] cd-text font-semibold truncate">{c.title}</div>
                      <div className="text-[11px] cd-text-faint truncate">
                        {c.ordererName || "발주처 미상"} · {fmtMoney(c.amount)} · {c.contractDate || "계약일 미상"}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {contract && (
              <div className="rounded-xl border cd-border-c p-3 grid grid-cols-2 md:grid-cols-4 gap-2.5">
                {[
                  ["계약명", contract.title],
                  ["발주처", contract.ordererName || "—"],
                  ["계약금액", fmtMoney(contract.amount)],
                  ["계약기간", `${contract.startedAt || "—"} ~ ${contract.endedAt || "—"}`],
                ].map(([label, v]) => (
                  <div key={label} className="min-w-0">
                    <div className="text-[10.5px] cd-text-faint">{label}</div>
                    <div className="text-[12.5px] cd-text truncate" title={String(v)}>{v}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 2) 종류·양식·서식 */}
          <section className="cd-card rounded-3xl p-5 flex flex-col gap-3.5">
            <h3 className="font-bold cd-text text-sm">종류 · 양식 · 서식</h3>
            <div className="flex flex-wrap items-center gap-2">
              {(["start", "completion"] as DeliverableKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`rounded-xl px-3.5 py-1.5 text-[13px] font-semibold border ${
                    kind === k ? "cd-fill-primary border-transparent" : "cd-border-c cd-text"
                  }`}
                  onClick={() => void changeKind(k)}
                >
                  {DELIVERABLE_KIND_LABEL[k]}
                </button>
              ))}
              <span className="mx-1 h-5 w-px" style={{ background: "var(--cd-border)" }} />
              <select
                className="cd-input max-w-[240px]"
                value={templateId}
                onChange={(e) => {
                  setTemplateId(e.target.value);
                  setDocTypes([]);
                  setPreviewUrl(null);
                }}
              >
                <option value="">기본양식(5대 발전사 계열)</option>
                {templates.map((t) => (
                  <option key={t.templateId} value={t.templateId}>
                    {t.ownerFacilityName ? `${t.ownerFacilityName} — ${t.name}` : t.name}
                  </option>
                ))}
              </select>
              {kind === "completion" && milestones.length > 0 && (
                <select className="cd-input max-w-[220px]" value={milestoneId} onChange={(e) => void changeMilestone(e.target.value)}>
                  <option value="">금회 회차 — 마지막 회차</option>
                  {milestones.map((m) => (
                    <option key={m.milestoneId} value={m.milestoneId}>
                      {m.stageLabel} ({fmtMoney(m.amount)})
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {catalogOptions.map((o) => {
                const on = docTypes.includes(o.docType);
                return (
                  <button
                    key={o.docType}
                    type="button"
                    className={`rounded-xl px-3 py-1.5 text-[12.5px] border ${on ? "cd-tint-primary border-[color:var(--cd-primary)]" : "cd-border-c cd-text"}`}
                    onClick={() => toggleDocType(o.docType)}
                  >
                    {o.title}
                  </button>
                );
              })}
              {catalogOptions.length === 0 && <span className="text-[12px] cd-text-faint">선택할 서식이 없습니다.</span>}
            </div>
          </section>

          {/* 3) 필드 — 자동 채움값은 잠금, 해제 시 수정 */}
          <section className="cd-card rounded-3xl p-5 flex flex-col gap-3">
            <h3 className="font-bold cd-text text-sm">기재 사항</h3>
            <p className="text-[11px] cd-text-faint">
              계약 데이터에서 자동으로 채워집니다. 자물쇠를 풀면 이 문서에서만 값을 고칠 수 있습니다.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {editableBindings.map((key) => (
                <label key={key} className="flex flex-col gap-1">
                  <span className="text-[11px] cd-text-faint flex items-center gap-1.5">
                    {BINDING_LABEL[key] ?? key}
                    <button type="button" className="cd-text-faint hover:text-[color:var(--cd-primary)]" onClick={() => toggleLock(key)}>
                      {unlocked[key] ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                    </button>
                  </span>
                  {inputFor(key)}
                </label>
              ))}
              {editableBindings.length === 0 && <span className="text-[12px] cd-text-faint">서식을 선택하면 기재 사항이 표시됩니다.</span>}
            </div>
          </section>
        </div>

        {/* 우: 미리보기 */}
        <aside className="cd-card rounded-3xl p-4 w-full xl:flex-[4] min-w-0 flex flex-col gap-3">
          <h3 className="font-bold cd-text text-sm">미리보기</h3>
          {previewUrl ? (
            // A4 비율(1:1.414) — 폭이 넓어진 만큼 세로도 따라가 문서가 잘리지 않는다
            <iframe src={previewUrl} className="w-full aspect-[1/1.414] min-h-[720px] rounded-xl border cd-border-c" title="미리보기" />
          ) : (
            <div className="h-[320px] rounded-xl border border-dashed cd-border-c flex items-center justify-center text-center px-6">
              <span className="text-[12px] cd-text-faint">
                계약과 서식을 고른 뒤 <b>미리보기</b>를 누르면 실제 출력 결과가 표시됩니다.
              </span>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
