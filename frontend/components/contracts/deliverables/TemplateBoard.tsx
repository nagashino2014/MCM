"use client";

// 발주처 자체양식 관리(/contracts/deliverables/templates) — 자기네 양식을 고집하는 발주처용(D4).
// 업로드한 HWPX 는 원본 그대로 보관하고, 어느 자리에 어떤 값이 들어가는지만 분석해 둔다.
// 작성 화면에서 그 양식을 고르면 원본에 값만 주입되므로 발주처 서식이 그대로 유지된다.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileUp, RefreshCw, Search, Trash2 } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { BINDING_LABEL, DELIVERABLE_KIND_LABEL, type DeliverableKind } from "@/lib/deliverable/types";
import "@/components/cdash/cdash.css";

interface TemplateDocSummary {
  docType: string;
  title: string;
  slotCount: number;
}

interface TemplateSummary {
  templateId: string;
  name: string;
  kind: DeliverableKind;
  ownerFacilityId: string | null;
  ownerFacilityName: string | null;
  sourceKind: string | null;
  renderMode: "overlay" | "spec";
  analyzedAt: string | null;
  analyzeNote: string | null;
  docs: TemplateDocSummary[];
  updatedAt: string;
}

interface SlotDetail {
  target: "para" | "cell";
  para?: number;
  table?: number;
  row?: number;
  col?: number;
  binding: string;
  label: string;
  suffix?: string;
}

interface FacilityHit {
  facility_id: string;
  company_name: string;
}

/** 재구축(spec) 양식의 블록 — 좌표 대신 이 목록이 구조를 보여준다. */
interface BlockDetail {
  kind: string;
  text?: string;
  binding?: string;
  rows?: { label?: string; binding?: string }[];
  columns?: unknown[];
}

/** 화면에 한 줄로 보여줄 항목(overlay 는 좌표+라벨, spec 은 블록 종류+요약). */
interface RowDetail {
  where: string;
  label: string;
  binding: string;
}

const BLOCK_LABEL: Record<string, string> = {
  note: "머리 표기",
  title: "표제",
  fields: "항목 목록",
  table: "표",
  para: "본문",
  dateLine: "작성일",
  signature: "서명란",
  receiver: "수신처",
  stampBox: "확인란",
  spacer: "여백",
};

const fmtDate = (v: string | null): string => (v ? v.slice(0, 10).replace(/-/g, ".") : "—");

/** 매핑 한 줄의 위치 표기 — 사용자가 원본과 대조할 수 있게 좌표를 그대로 보여준다. */
const slotWhere = (s: SlotDetail): string =>
  s.target === "cell" ? `표 ${s.table} · ${s.row}행 ${s.col}열` : `문단 ${s.para}`;

function blockSummary(b: BlockDetail): string {
  if (b.rows?.length) return b.rows.map((r) => r.label || r.binding || "").filter(Boolean).join(" · ") || `${b.rows.length}행`;
  if (b.kind === "table") return `${b.rows?.length ?? 0}행 × ${b.columns?.length ?? 0}열`;
  return (b.text ?? "").slice(0, 40) || "—";
}

export function TemplateBoard() {
  const router = useRouter();
  const { theme } = useCdashTheme();
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [selected, setSelected] = useState<string>("");
  /** templateId → docType → 그 서식에서 보여줄 항목 */
  const [slots, setSlots] = useState<Record<string, Record<string, RowDetail[]>>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // 업로드 폼
  const [name, setName] = useState("");
  const [kind, setKind] = useState<DeliverableKind>("completion");
  const [facilityQuery, setFacilityQuery] = useState("");
  const [facilityHits, setFacilityHits] = useState<FacilityHit[]>([]);
  const [facility, setFacility] = useState<FacilityHit | null>(null);
  const [file, setFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/contracts/deliverables/templates");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "목록을 불러오지 못했습니다.");
      setTemplates(Array.isArray(data?.templates) ? data.templates : []);
    } catch (err) {
      setMsg((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 발주처 자동완성 — 계약 등록 모달과 같은 /api/facilities?q=
  useEffect(() => {
    const q = facilityQuery.trim();
    if (q.length < 2 || facility) {
      setFacilityHits([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/facilities?q=${encodeURIComponent(q)}&limit=8`);
        const data = await res.json();
        const rows = Array.isArray(data?.facilities) ? data.facilities : Array.isArray(data) ? data : [];
        setFacilityHits(rows.slice(0, 8));
      } catch {
        setFacilityHits([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [facilityQuery, facility]);

  const upload = async () => {
    if (!file) {
      setMsg("양식 파일(HWPX)을 선택하세요.");
      return;
    }
    if (!name.trim()) {
      setMsg("양식 이름을 입력하세요.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const body = new FormData();
      body.set("name", name.trim());
      body.set("kind", kind);
      if (facility) body.set("ownerFacilityId", facility.facility_id);
      body.set("file", file);
      const res = await fetch("/api/contracts/deliverables/templates", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "업로드에 실패했습니다.");
      setMsg(
        data?.analyzeError
          ? `업로드했지만 자동 분석에 실패했습니다: ${data.analyzeError}`
          : "업로드·분석을 마쳤습니다. 매핑을 확인해 주세요."
      );
      setName("");
      setFile(null);
      setFacility(null);
      setFacilityQuery("");
      await load();
      if (data?.templateId) void openTemplate(String(data.templateId));
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openTemplate = async (templateId: string) => {
    setSelected(templateId);
    if (slots[templateId]) return;
    try {
      const res = await fetch(`/api/contracts/deliverables/templates/${templateId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "양식을 불러오지 못했습니다.");
      const tpl = data?.template ?? {};
      const map: Record<string, RowDetail[]> = {};
      if (tpl.renderMode === "overlay") {
        for (const d of (tpl.profile?.docs ?? []) as { docType: string; slots: SlotDetail[] }[]) {
          map[d.docType] = (d.slots ?? []).map((s) => ({
            where: slotWhere(s),
            label: s.label || s.suffix || "—",
            binding: s.binding,
          }));
        }
      } else {
        // 재구축(spec) 양식은 좌표가 아니라 블록 목록이 곧 구조다
        for (const s of (tpl.specs ?? []) as { docType: string; blocks: BlockDetail[] }[]) {
          map[s.docType] = (s.blocks ?? []).map((b) => ({
            where: BLOCK_LABEL[b.kind] ?? b.kind,
            label: blockSummary(b),
            binding: b.binding ?? "",
          }));
        }
      }
      setSlots((prev) => ({ ...prev, [templateId]: map }));
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  const reanalyze = async (templateId: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/contracts/deliverables/templates/${templateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reanalyze: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "재분석에 실패했습니다.");
      setSlots((prev) => {
        const next = { ...prev };
        delete next[templateId];
        return next;
      });
      await load();
      await openTemplate(templateId);
      setMsg("재분석을 마쳤습니다.");
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (templateId: string) => {
    if (!window.confirm("이 양식을 삭제할까요? 이 양식으로 작성한 문서는 남습니다.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/contracts/deliverables/templates/${templateId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("삭제에 실패했습니다.");
      if (selected === templateId) setSelected("");
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const current = useMemo(() => templates.find((t) => t.templateId === selected) ?? null, [selected, templates]);
  const currentSlots = selected ? slots[selected] ?? {} : {};

  return (
    <div className="cdash cd-fields-white p-6" data-theme={theme}>
      <CdPageHeader
        breadcrumbs={[
          { label: "계약", href: "/contracts" },
          { label: "착수계·준공계", href: "/contracts/deliverables" },
          { label: "발주처 양식" },
        ]}
        title="발주처 자체양식 관리"
        meta={`${templates.length.toLocaleString()}건 등록`}
        actions={
          <button
            type="button"
            className="cd-btn rounded-xl border cd-border-c px-3 py-2 text-[13px] flex items-center gap-1.5"
            onClick={() => router.push("/contracts/deliverables")}
          >
            <ArrowLeft className="w-4 h-4" /> 작성 화면
          </button>
        }
      />

      {msg && (
        <div className="mb-4 rounded-xl px-4 py-2.5 text-[13px]" style={{ background: "var(--cd-tint)", color: "var(--cd-text)" }}>
          {msg}
        </div>
      )}

      <div className="flex flex-col xl:flex-row gap-5 items-start">
        {/* 좌: 업로드 + 목록 */}
        <section className="cd-card rounded-3xl overflow-hidden w-full xl:flex-[5] min-w-0">
          <div className="p-4 border-b cd-border-c">
            <h2 className="font-bold cd-text flex items-center gap-2 text-sm">
              <FileUp className="w-4 h-4 cd-text-primary" /> 양식 등록
            </h2>
            <p className="text-[11px] cd-text-faint mt-0.5">
              발주처가 자기네 양식을 요구할 때 등록합니다. <b>HWPX</b>는 원본 서식을 그대로 두고 값만 채우므로 가장 정확합니다.
              한글 파일(.hwp)은 한컴에서 HWPX로 저장해 올려주세요. PDF(스캔본)만 있으면 그것도 되지만 서식이 근사치가 됩니다.
            </p>
          </div>
          <div className="p-4 flex flex-col gap-3">
            <div className="flex gap-2">
              <input
                className="cd-input text-[13px] flex-1 min-w-0"
                placeholder="양식 이름 (예: 인천공항에너지 준공 서류)"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <select
                className="cd-input text-[13px] shrink-0"
                style={{ width: "7rem" }}
                value={kind}
                onChange={(e) => setKind(e.target.value as DeliverableKind)}
              >
                <option value="start">착수계</option>
                <option value="completion">준공계</option>
              </select>
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 cd-text-faint" />
              <input
                className="cd-input text-[13px]"
                style={{ paddingLeft: "2rem" }}
                placeholder="이 양식을 요구하는 발주처 (선택)"
                value={facility ? facility.company_name : facilityQuery}
                onChange={(e) => {
                  setFacility(null);
                  setFacilityQuery(e.target.value);
                }}
              />
              {facilityHits.length > 0 && (
                <div
                  className="absolute z-20 left-0 right-0 mt-1 rounded-xl border cd-border-c overflow-hidden"
                  style={{ background: "var(--cd-card-solid)" }}
                >
                  {facilityHits.map((f) => (
                    <button
                      key={f.facility_id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-[12.5px] cd-text hover:cd-tint-primary"
                      onClick={() => {
                        setFacility(f);
                        setFacilityHits([]);
                      }}
                    >
                      {f.company_name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2 items-center">
              <input
                type="file"
                accept=".hwpx,.pdf"
                className="cd-input text-[12.5px] flex-1 min-w-0"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                className="cd-btn cd-fill-primary rounded-xl px-4 py-2 text-[13px] shrink-0"
                onClick={upload}
                disabled={busy}
              >
                {busy ? "분석 중…" : "업로드·분석"}
              </button>
            </div>
          </div>

          <div className="px-4 pb-4">
            <div className="border-t cd-border-c pt-3 flex flex-col gap-2">
              {templates.length === 0 && <p className="text-[12.5px] cd-text-faint py-6 text-center">등록된 양식이 없습니다.</p>}
              {templates.map((t) => {
                const on = t.templateId === selected;
                return (
                  <button
                    key={t.templateId}
                    type="button"
                    className={`text-left rounded-xl border px-3.5 py-2.5 ${
                      on ? "cd-tint-primary border-[color:var(--cd-primary)]" : "cd-border-c"
                    }`}
                    onClick={() => void openTemplate(t.templateId)}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-semibold cd-text">{t.name}</span>
                      <span className="text-[11px] px-1.5 py-0.5 rounded-md border cd-border-c cd-text-faint">
                        {DELIVERABLE_KIND_LABEL[t.kind]}
                      </span>
                      <span className="text-[11px] px-1.5 py-0.5 rounded-md border cd-border-c cd-text-faint">
                        {t.renderMode === "overlay" ? "원본 서식 유지" : "서식 재구축"}
                      </span>
                    </div>
                    <div className="text-[11.5px] cd-text-faint mt-1">
                      {t.ownerFacilityName ?? "발주처 미지정"} · 서식 {t.docs.length}종 ·{" "}
                      {t.docs.reduce((a, d) => a + d.slotCount, 0)}개 자리 · 분석 {fmtDate(t.analyzedAt)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* 우: 매핑 확인 */}
        <section className="cd-card rounded-3xl overflow-hidden w-full xl:flex-[5] min-w-0">
          <div className="p-4 border-b cd-border-c flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="font-bold cd-text text-sm truncate">{current ? current.name : "매핑 확인"}</h2>
              <p className="text-[11px] cd-text-faint mt-0.5">
                {current ? "값이 들어갈 자리입니다. 원본과 대조해 확인하세요." : "왼쪽에서 양식을 선택하세요."}
              </p>
            </div>
            {current && (
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  className="cd-btn rounded-xl border cd-border-c px-3 py-1.5 text-[12.5px] flex items-center gap-1.5"
                  onClick={() => void reanalyze(current.templateId)}
                  disabled={busy}
                >
                  <RefreshCw className="w-3.5 h-3.5" /> 재분석
                </button>
                <button
                  type="button"
                  className="cd-btn rounded-xl border cd-border-c px-3 py-1.5 text-[12.5px] flex items-center gap-1.5"
                  onClick={() => void remove(current.templateId)}
                  disabled={busy}
                >
                  <Trash2 className="w-3.5 h-3.5" /> 삭제
                </button>
              </div>
            )}
          </div>

          {current && (
            <div className="p-4">
              {current.analyzeNote && (
                <p className="text-[12px] cd-text-faint mb-3 rounded-xl border cd-border-c px-3 py-2">{current.analyzeNote}</p>
              )}
              {current.docs.map((d) => (
                <div key={d.docType} className="mb-4">
                  <div className="text-[12.5px] font-semibold cd-text mb-1.5">
                    {d.title} <span className="cd-text-faint font-normal">· {d.slotCount}개 자리</span>
                  </div>
                  <div className="rounded-xl border cd-border-c overflow-hidden">
                    {(currentSlots[d.docType] ?? []).map((s, i) => (
                      <div
                        key={`${d.docType}-${i}`}
                        className="flex items-center gap-2 px-3 py-1.5 text-[12px] border-b cd-border-c last:border-b-0"
                      >
                        <span className="cd-text-faint shrink-0" style={{ width: "8rem" }}>
                          {s.where}
                        </span>
                        <span className="cd-text truncate flex-1 min-w-0">{s.label}</span>
                        <span className="cd-text-primary shrink-0 text-[11.5px]">
                          {s.binding ? BINDING_LABEL[s.binding] ?? s.binding : ""}
                        </span>
                      </div>
                    ))}
                    {(currentSlots[d.docType] ?? []).length === 0 && (
                      <p className="text-[12px] cd-text-faint px-3 py-4 text-center">매핑된 자리가 없습니다.</p>
                    )}
                  </div>
                </div>
              ))}
              {current.docs.length === 0 && (
                <p className="text-[12.5px] cd-text-faint py-8 text-center">
                  분석된 서식이 없습니다. 재분석을 눌러보세요.
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
