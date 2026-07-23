"use client";

// 연차사용촉진제도 관리(/approval/leave-promotion, admin) — 직원별 소진율·1/2차 고지 현황.
// 상단 KPI(고지 제출율·소진율·사용·잔여) + '연차 고지 양식 관리'·'연차 고지 발송' 버튼.
// 발송/양식 편집/수신함/회신은 LP-P2·P3. 여기서는 현황 조회·화면 골격.
// 설계: docs/leave-promotion-blueprint.md.

import { useCallback, useEffect, useMemo, useState } from "react";
import { BellRing, FileCog, FileUp, Gauge, MailCheck, Paperclip, Plus, Send, TrendingDown, Trash2, X } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { EmployeeAvatar } from "@/components/ui/EmployeeAvatar";
import { NOTICE_TOKENS, SAMPLE_TOKEN_VARS, fillNoticeBody } from "@/lib/approval/leave-promotion-tokens";
import { LeaveNoticePreview } from "@/components/approval/LeaveNoticePreview";
import { AutoDateInput } from "@/components/ui/AutoDateInput";
import OrganizationTree from "@/components/admin/users/OrganizationTree";
import type { OrganizationEmployeeRow, OrganizationSnapshot } from "@/components/admin/users/types";
import type { LucideIcon } from "lucide-react";
import "@/components/cdash/cdash.css";

interface CompanyInfo {
  companyName: string;
  ceoName: string;
}

interface NoticeTemplate {
  round: number;
  title: string;
  body: string[];
  updatedAt: string;
}

interface PromotionRow {
  employeeId: string;
  name: string;
  positionName: string | null;
  deptName: string | null;
  photoPath: string | null;
  granted: number;
  used: number;
  remaining: number;
  rate: number;
  round1: { noticeDate: string; status: string; paper: boolean } | null;
  round2: { noticeDate: string; status: string; paper: boolean } | null;
}

interface Gate {
  canFirst: boolean;
  canSecond: boolean;
  phase: string;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const SUBMITTED = new Set(["submitted", "assigned"]);

export function LeavePromotionBoard() {
  const { theme } = useCdashTheme();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(String(thisYear));
  const [rows, setRows] = useState<PromotionRow[]>([]);
  const [gate, setGate] = useState<Gate | null>(null);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/approval/leave-promotion?year=${year}`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setRows(data.rows ?? []);
        setGate(data.gate ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, [year]);
  useEffect(() => {
    load();
  }, [load]);

  const sendTargets = useMemo(() => rows.filter((r) => r.remaining > 0 && !r.round1).length, [rows]);

  const sendFirst = async () => {
    if (!gate?.canFirst) return;
    if (sendTargets === 0) {
      alert("발송 대상(잔여 연차>0·1차 미발송)이 없습니다.");
      return;
    }
    if (!confirm(`잔여 연차가 있는 미발송 직원 ${sendTargets}명에게 1차 연차 사용 촉구 고지를 발송합니다.\n계속할까요?`)) return;
    setSending(true);
    try {
      const res = await fetch(`/api/approval/leave-promotion/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ year, round: 1 }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        alert(`1차 고지 ${data.created ?? 0}건을 발송했습니다.`);
        load();
      } else {
        alert(data.error ?? "발송에 실패했습니다.");
      }
    } finally {
      setSending(false);
    }
  };

  const kpi = useMemo(() => {
    if (!rows.length) return null;
    const targets = rows.filter((r) => r.remaining > 0); // 고지 대상(잔여>0)
    const notices = rows.flatMap((r) => [r.round1, r.round2].filter(Boolean)) as { status: string }[];
    const submitted = notices.filter((n) => SUBMITTED.has(n.status)).length;
    const n = rows.length;
    const sum = rows.reduce((a, r) => ({ u: a.u + r.used, g: a.g + r.granted, rem: a.rem + r.remaining }), { u: 0, g: 0, rem: 0 });
    return {
      submitRate: notices.length > 0 ? (submitted / notices.length) * 100 : 0,
      rate: sum.g > 0 ? (sum.u / sum.g) * 100 : 0,
      used: sum.u / n,
      remaining: sum.rem / n,
      targetCount: targets.length,
    };
  }, [rows]);

  const KPIS: { label: string; value: string; hint: string; icon: LucideIcon; primary?: boolean }[] = kpi
    ? [
        { label: "평균 고지 제출율", value: `${kpi.submitRate.toFixed(0)}%`, hint: "1·2차 발송분 중 제출", icon: MailCheck, primary: true },
        { label: "평균 연차 소진율", value: `${kpi.rate.toFixed(0)}%`, hint: "사용 ÷ 부여", icon: Gauge },
        { label: "평균 연차 사용", value: `${kpi.used.toFixed(1)}`, hint: "1인 평균 · 일", icon: TrendingDown },
        { label: "평균 연차 잔여", value: `${kpi.remaining.toFixed(1)}`, hint: `고지 대상 ${kpi.targetCount}명 · 일`, icon: BellRing },
      ]
    : [];

  const gateHint = gate
    ? gate.phase === "before"
      ? "1차 고지 기간(7/1~7/20) 전입니다. 7월 1일부터 발송할 수 있습니다."
      : gate.phase === "first"
        ? "1차 고지 기간입니다(7/1~7/20)."
        : "1차 고지 기간이 종료되었습니다. 미제출자 대상 2차 고지를 발송할 수 있습니다."
    : "";

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<BellRing className="w-5 h-5" />}
        eyebrow="Approval · Leave Promotion"
        title="연차촉진제도 관리"
        subtitle="근로기준법 연차사용촉진 — 잔여 연차가 있는 직원에게 1·2차 사용 촉구 고지를 발송하고 회신을 관리합니다."
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs flex items-center gap-1.5"
              title="연차 고지 문구(1·2차) 편집"
              onClick={() => setEditorOpen(true)}
            >
              <FileCog className="w-3.5 h-3.5" /> 연차 고지 양식 관리
            </button>
            <button
              type="button"
              className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
              title={
                gate?.phase === "second"
                  ? "2차 고지는 다음 단계(LP-P3)에서 발송합니다."
                  : gate?.canFirst
                    ? `1차 고지 발송 (대상 ${sendTargets}명)`
                    : "1차 고지는 7/1~7/20에만 발송할 수 있습니다."
              }
              disabled={!gate?.canFirst || sending}
              onClick={sendFirst}
            >
              <Send className="w-3.5 h-3.5" /> {sending ? "발송 중…" : "연차 고지 발송"}
            </button>
          </div>
        }
      />

      {/* KPI */}
      {KPIS.length > 0 && (
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {KPIS.map((k) => {
            const Icon = k.icon;
            return (
              <div key={k.label} className={`rounded-2xl p-4 border cd-border-c ${k.primary ? "cd-tint-primary shadow-sm" : "cd-card-bg"}`}>
                <div className="flex items-center gap-2">
                  <Icon className={`w-4 h-4 shrink-0 ${k.primary ? "cd-text-primary" : "cd-text-faint"}`} />
                  <div className="text-[10px] font-bold uppercase tracking-wider cd-text-faint truncate">{k.label}</div>
                </div>
                <div className="mt-2 text-3xl font-extrabold leading-tight cd-text">{k.value}</div>
                <div className="text-[10px] cd-text-faint font-medium mt-1 truncate">{k.hint}</div>
              </div>
            );
          })}
        </section>
      )}

      <div className="cd-card rounded-3xl p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <select className="cd-select" style={{ width: 110 }} value={year} onChange={(e) => setYear(e.target.value)}>
            {Array.from({ length: 4 }, (_, i) => String(thisYear + 1 - i)).map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
          <button
            type="button"
            className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs font-semibold flex items-center gap-1.5"
            title="서면으로 진행한 1차 고지의 사용계획서 스캔본을 업로드하고 제출 처리"
            onClick={() => setBackfillOpen(true)}
          >
            <FileUp className="w-3.5 h-3.5" /> 서면 고지 사후 등록
          </button>
          <span className="ml-auto text-[11px] cd-text-faint">{gateHint}</span>
        </div>

        {loading ? (
          <p className="text-sm cd-text-faint">불러오는 중입니다.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <div className="hidden md:grid grid-cols-[1.6fr_0.7fr_1fr_repeat(3,0.7fr)_1.2fr_1.2fr] gap-2 px-3 text-[10.5px] font-bold uppercase tracking-wider cd-text-faint">
              <span>직원</span>
              <span className="text-right">소진율</span>
              <span className="pl-10">부서</span>
              <span className="text-right">부여</span>
              <span className="text-right">사용</span>
              <span className="text-right">잔여</span>
              <span className="pl-10">1차 고지</span>
              <span>2차 고지</span>
            </div>
            {rows.map((r) => (
              <div key={r.employeeId} className="grid grid-cols-[1.6fr_0.7fr_1fr_repeat(3,0.7fr)_1.2fr_1.2fr] gap-2 items-center px-3 py-2.5 rounded-2xl border cd-border-c">
                <div className="flex items-center gap-2.5 min-w-0">
                  <EmployeeAvatar employeeId={r.employeeId} photoPath={r.photoPath} size={34} />
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold cd-text truncate">
                      {r.name}
                      {r.positionName && <span className="cd-text-faint font-normal text-[11px]"> {r.positionName}</span>}
                    </div>
                    <div className="mt-1 h-1.5 rounded-full cd-surface-bg overflow-hidden w-28">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, r.rate)}%`, background: r.rate >= 90 ? "var(--cd-danger,#FA896B)" : "var(--cd-primary)" }} />
                    </div>
                  </div>
                </div>
                <span className="text-right font-mono text-[13px] cd-text-primary font-bold">{r.rate.toFixed(0)}%</span>
                <span className="pl-10 text-[12px] cd-text-faint truncate">{r.deptName ?? "-"}</span>
                <span className="text-right font-mono text-[13px] cd-text">{fmt(r.granted)}</span>
                <span className="text-right font-mono text-[13px] cd-text">{fmt(r.used)}</span>
                <span className={`text-right font-mono text-[13px] font-bold ${r.remaining > 0 ? "cd-text" : "cd-text-faint"}`}>{fmt(r.remaining)}</span>
                <div className="pl-10">
                  <NoticeCell notice={r.round1} empty={r.remaining <= 0 ? "대상 아님" : "미발송"} />
                </div>
                <NoticeCell notice={r.round2} empty={r.round1 && SUBMITTED.has(r.round1.status) ? "" : r.remaining <= 0 ? "" : "-"} />
              </div>
            ))}
          </div>
        )}
        <p className="text-[10.5px] cd-text-faint">
          잔여 연차가 있는 직원이 고지 대상입니다. 1차 발송분은 직원 홈의 수신 문서함에 도착하며, 사용예정일 회신 시 &lsquo;제출&rsquo;로 표시됩니다. 2차 고지 발송은 다음 단계에서 활성화됩니다.
        </p>
      </div>

      {editorOpen && <TemplateEditor onClose={() => setEditorOpen(false)} />}
      {backfillOpen && (
        <BackfillModal
          year={year}
          rows={rows}
          onClose={() => setBackfillOpen(false)}
          onDone={() => {
            setBackfillOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}

interface BackfillEntry {
  dates: string[];
  files: File[];
}

/** 파일명에서 성명을 찾아 직원 매칭(가장 긴 이름 우선, 중복 매칭은 미매칭 처리). */
function matchByFilename(filename: string, rows: PromotionRow[]): PromotionRow | null {
  const base = filename.replace(/\.[^.]+$/, "");
  const hits = rows.filter((r) => r.name && base.includes(r.name));
  if (!hits.length) return null;
  hits.sort((a, b) => b.name.length - a.name.length);
  // 최장 이름이 유일하게 최장인지 확인(동률이면 애매 → 미매칭)
  if (hits.length > 1 && hits[1].name.length === hits[0].name.length) return null;
  return hits[0];
}

/**
 * 서면 고지 사후 등록 — 조직도 트리에서 1명씩 선택해 인원별 사용예정일을 입력한다.
 * 서면 통지일·계획서 업로드는 공통(업로드 시 파일명→성명 자동 매칭). 준비된 인원은 칩으로 누적,
 * 제출 시 인원별로 backfill 을 호출한다. 트리뷰는 계약 상세(수행부서/인력)와 동일 컴포넌트.
 */
function BackfillModal({
  year,
  rows,
  onClose,
  onDone,
}: {
  year: string;
  rows: PromotionRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [snapshot, setSnapshot] = useState<OrganizationSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [noticeDate, setNoticeDate] = useState("");
  const [entries, setEntries] = useState<Record<string, BackfillEntry>>({});
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/organization", { cache: "no-store" })
      .then((r) => r.json())
      .then(setSnapshot)
      .catch(() => setSnapshot(null));
  }, []);

  const rowById = useMemo(() => new Map(rows.map((r) => [r.employeeId, r])), [rows]);
  const sel = selectedId ? rowById.get(selectedId) ?? null : null;
  const selEntry: BackfillEntry = (selectedId && entries[selectedId]) || { dates: [""], files: [] };

  const upsert = (id: string, patch: Partial<BackfillEntry>) =>
    setEntries((e) => ({ ...e, [id]: { dates: e[id]?.dates ?? [""], files: e[id]?.files ?? [], ...patch } }));

  const pick = (emp: OrganizationEmployeeRow) => {
    setSelectedId(emp.employeeId);
    setEntries((e) => (e[emp.employeeId] ? e : { ...e, [emp.employeeId]: { dates: [""], files: [] } }));
  };

  // 공통 업로드: 파일명→성명 매칭 후 각 인원 엔트리에 파일 첨부.
  const onUpload = (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (!files.length) return;
    const miss: string[] = [];
    setEntries((prev) => {
      const next = { ...prev };
      for (const f of files) {
        const m = matchByFilename(f.name, rows);
        if (!m) {
          miss.push(f.name);
          continue;
        }
        const cur = next[m.employeeId] ?? { dates: [""], files: [] };
        next[m.employeeId] = { ...cur, files: [...cur.files, f] };
      }
      return next;
    });
    setUnmatched(miss);
    const firstHit = files.map((f) => matchByFilename(f.name, rows)).find(Boolean);
    if (firstHit) setSelectedId(firstHit.employeeId);
  };

  const setDate = (id: string, i: number, v: string) =>
    upsert(id, { dates: (entries[id]?.dates ?? [""]).map((d, j) => (j === i ? v : d)) });
  const addDate = (id: string) => upsert(id, { dates: [...(entries[id]?.dates ?? [""]), ""] });
  const delDate = (id: string, i: number) => {
    const ds = entries[id]?.dates ?? [""];
    upsert(id, { dates: ds.length > 1 ? ds.filter((_, j) => j !== i) : ds });
  };
  const addFiles = (id: string, fl: FileList | null) => {
    const fs = Array.from(fl ?? []);
    if (fs.length) upsert(id, { files: [...(entries[id]?.files ?? []), ...fs] });
  };
  const delFile = (id: string, i: number) => upsert(id, { files: (entries[id]?.files ?? []).filter((_, j) => j !== i) });
  const removeEntry = (id: string) =>
    setEntries((e) => {
      const n = { ...e };
      delete n[id];
      return n;
    });

  const prepared = Object.keys(entries).filter(
    (id) => (entries[id].files.length > 0) || entries[id].dates.some((d) => d.trim())
  );

  const submit = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(noticeDate)) return alert("서면 통지일을 입력하세요(YYYYMMDD).");
    if (prepared.length === 0) return alert("등록할 인원이 없습니다. 스캔본을 업로드하거나 사용예정일을 입력하세요.");
    if (!confirm(`${prepared.length}명을 서면 고지 제출로 등록합니다. 계속할까요?`)) return;
    setBusy(true);
    let ok = 0;
    let fail = 0;
    try {
      for (const id of prepared) {
        const e = entries[id];
        const plan = e.dates.filter((d) => d.trim());
        const fd = new FormData();
        fd.set("employeeId", id);
        fd.set("year", year);
        fd.set("round", "1");
        fd.set("noticeDate", noticeDate);
        fd.set("plan", JSON.stringify(plan));
        for (const f of e.files) fd.append("files", f);
        const res = await fetch(`/api/approval/leave-promotion/backfill`, { method: "POST", body: fd });
        if (res.ok) ok += 1;
        else fail += 1;
      }
      alert(`서면 고지 사후 등록 완료 — 성공 ${ok}명${fail ? `, 실패 ${fail}명` : ""}.`);
      if (ok > 0) onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.45)" }}>
      <div className="cd-card rounded-3xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b cd-border-c">
          <FileUp className="w-4 h-4 cd-text-primary" />
          <h3 className="text-sm font-bold cd-text">서면 고지 사후 등록</h3>
          <span className="text-[11px] cd-text-faint">서면으로 진행한 1차 고지의 사용계획서를 인원별로 등록합니다.</span>
          <button type="button" className="cd-text-faint hover:cd-text ml-auto" onClick={onClose} title="닫기">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 grid lg:grid-cols-[5fr_7fr]">
          {/* 좌: 조직도 트리(1명 선택) */}
          <div className="p-4 border-b lg:border-b-0 lg:border-r cd-border-c overflow-y-auto">
            <div className="rounded-2xl border cd-border-c">
              <OrganizationTree snapshot={snapshot} onSelectEmployee={pick} selectedEmployeeId={selectedId} title="조직도" embedded />
            </div>
          </div>

          {/* 우: 공통 입력 + 선택 인원 카드 */}
          <div className="p-5 flex flex-col gap-4 overflow-y-auto">
            {/* 공통: 통지일 + 업로드 */}
            <div className="rounded-2xl border cd-border-c p-4 flex items-center gap-3 flex-wrap">
              <span className="text-[11px] font-bold cd-text-faint">서면 통지일</span>
              <AutoDateInput value={noticeDate} onChange={setNoticeDate} className="cd-input w-40" placeholder="YYYYMMDD" />
              <span className="text-[11px] font-bold cd-text-faint ml-2">연차 사용계획서 업로드</span>
              <label className="cd-btn cd-btn-soft rounded-lg px-3 py-2 text-xs font-semibold cursor-pointer flex items-center gap-1.5">
                <FileUp className="w-3.5 h-3.5" /> 업로드
                <input type="file" multiple accept="application/pdf,image/*" className="hidden" onChange={(e) => { onUpload(e.target.files); e.target.value = ""; }} />
              </label>
              <span className="text-[10.5px] cd-text-faint w-full">파일명에 포함된 성명으로 인원을 자동 매칭합니다(공통 통지일 적용).</span>
            </div>

            {/* 준비된 인원 칩 */}
            {prepared.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {prepared.map((id) => {
                  const r = rowById.get(id);
                  const e = entries[id];
                  const active = id === selectedId;
                  return (
                    <span
                      key={id}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11.5px] cursor-pointer ${active ? "cd-tint-primary border-[color:var(--cd-primary)]" : "cd-border-c"}`}
                      onClick={() => setSelectedId(id)}
                    >
                      <span className="cd-text font-semibold">{r?.name ?? id}</span>
                      {e.files.length > 0 && <Paperclip className="w-3 h-3 cd-text-primary" />}
                      {e.dates.some((d) => d.trim()) && <span className="cd-text-faint">{e.dates.filter((d) => d.trim()).length}일</span>}
                      <button type="button" className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]" onClick={(ev) => { ev.stopPropagation(); removeEntry(id); }} title="제외">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}

            {unmatched.length > 0 && (
              <div className="rounded-xl border border-[color:var(--cd-warning,#FFAE1F)] px-3 py-2 text-[11px] cd-text">
                자동 매칭 실패 {unmatched.length}건: <span className="cd-text-faint">{unmatched.join(", ")}</span> — 좌측 트리에서 직접 선택 후 첨부하세요.
              </div>
            )}

            {/* 선택 인원 카드 */}
            {!sel ? (
              <p className="rounded-2xl border cd-border-c p-8 text-center text-sm cd-text-faint">
                좌측 조직도에서 인원을 선택하거나 계획서를 업로드하면 여기에서 사용예정일을 입력합니다.
              </p>
            ) : (
              <div className="rounded-2xl border cd-border-c p-4 flex flex-col gap-4">
                <div className="grid grid-cols-3 gap-3">
                  <Field label="성명/직급" value={`${sel.name}${sel.positionName ? ` ${sel.positionName}` : ""}`} />
                  <Field label="부서" value={sel.deptName ?? "-"} />
                  <Field label="잔여일수" value={`잔여 ${fmt(sel.remaining)}일`} />
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-bold cd-text-faint">사용 예정일 <span className="font-normal">(계획서 기재분)</span></span>
                  <div className="flex flex-wrap items-center gap-2">
                    {selEntry.dates.map((d, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <AutoDateInput value={d} onChange={(v) => setDate(sel.employeeId, i, v)} className="cd-input w-36" placeholder="YYYYMMDD" />
                        <button type="button" className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)] disabled:opacity-30" onClick={() => delDate(sel.employeeId, i)} disabled={selEntry.dates.length <= 1} title="삭제">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    <button type="button" className="cd-text-primary hover:opacity-70" onClick={() => addDate(sel.employeeId)} title="날짜 추가">
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-bold cd-text-faint">사용계획서 스캔본</span>
                  {selEntry.files.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      {selEntry.files.map((f, i) => (
                        <div key={i} className="flex items-center gap-2 text-[12px] cd-text">
                          <Paperclip className="w-3.5 h-3.5 cd-text-primary shrink-0" />
                          <span className="truncate flex-1">{f.name}</span>
                          <button type="button" className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]" onClick={() => delFile(sel.employeeId, i)} title="첨부 삭제">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[11px] cd-text-faint">첨부된 스캔본이 없습니다. 상단 업로드로 자동 매칭하거나 아래에서 직접 첨부하세요.</span>
                  )}
                  <label className="cd-btn cd-btn-ghost rounded-lg px-3 py-1.5 text-xs font-semibold self-start border cd-border-c cursor-pointer flex items-center gap-1">
                    <Paperclip className="w-3.5 h-3.5" /> 직접 첨부
                    <input type="file" multiple accept="application/pdf,image/*" className="hidden" onChange={(e) => { addFiles(sel.employeeId, e.target.files); e.target.value = ""; }} />
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t cd-border-c">
          <span className="text-[11px] cd-text-faint">등록 대상 {prepared.length}명</span>
          <button type="button" className="cd-btn cd-btn-ghost text-xs px-3 py-2 ml-auto" onClick={onClose}>
            취소
          </button>
          <button type="button" className="cd-btn cd-btn-primary rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50" onClick={submit} disabled={busy}>
            {busy ? "등록 중…" : "제출 처리"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-bold cd-text-faint">{label}</span>
      <div className="rounded-lg border cd-border-c px-3 py-2 text-[13px] cd-text truncate">{value}</div>
    </div>
  );
}

/** 연차 고지 문구(1·2차) 웹 편집 — title + 문단 배열. 치환 토큰 팔레트 + 실시간 미리보기. */
function TemplateEditor({ onClose }: { onClose: () => void }) {
  const [templates, setTemplates] = useState<NoticeTemplate[]>([]);
  const [company, setCompany] = useState<CompanyInfo | null>(null);
  const [round, setRound] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/approval/leave-promotion/templates`, { cache: "no-store" });
        const data = await res.json();
        if (res.ok) {
          setTemplates(data.templates ?? []);
          setCompany(data.company ?? null);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const cur = templates.find((t) => t.round === round);
  const setCur = (patch: Partial<NoticeTemplate>) =>
    setTemplates((ts) => ts.map((t) => (t.round === round ? { ...t, ...patch } : t)));

  const setPara = (i: number, val: string) => cur && setCur({ body: cur.body.map((p, j) => (j === i ? val : p)) });
  const addPara = () => cur && setCur({ body: [...cur.body, ""] });
  const delPara = (i: number) => cur && setCur({ body: cur.body.filter((_, j) => j !== i) });

  const insertToken = (i: number, token: string) => {
    if (!cur) return;
    setPara(i, (cur.body[i] ?? "") + token);
  };

  const save = async () => {
    if (!cur) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/approval/leave-promotion/templates`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ round: cur.round, title: cur.title, body: cur.body }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        alert(`${round}차 고지 문구를 저장했습니다.`);
      } else {
        alert(data.error ?? "저장에 실패했습니다.");
      }
    } finally {
      setSaving(false);
    }
  };

  const preview = cur ? fillNoticeBody(cur.body, SAMPLE_TOKEN_VARS) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.45)" }}>
      <div className="cd-card rounded-3xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b cd-border-c">
          <FileCog className="w-4 h-4 cd-text-primary" />
          <h3 className="text-sm font-bold cd-text">연차 고지 양식 관리</h3>
          <div className="ml-auto flex items-center gap-1 rounded-lg border cd-border-c p-0.5">
            {[1, 2].map((r) => (
              <button
                key={r}
                type="button"
                className={`px-3 py-1 text-xs font-semibold rounded-md ${round === r ? "cd-fill-primary text-white" : "cd-text-faint"}`}
                onClick={() => setRound(r)}
              >
                {r}차
              </button>
            ))}
          </div>
          <button type="button" className="cd-text-faint hover:cd-text ml-1" onClick={onClose} title="닫기">
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading || !cur ? (
          <p className="p-6 text-sm cd-text-faint">불러오는 중입니다.</p>
        ) : (
          <div className="flex-1 min-h-0 grid lg:grid-cols-2">
            {/* 편집 패널 */}
            <div className="overflow-y-auto p-5 flex flex-col gap-4 border-b lg:border-b-0 lg:border-r cd-border-c">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-bold cd-text-faint">제목</span>
                <input className="cd-input" value={cur.title} onChange={(e) => setCur({ title: e.target.value })} />
              </label>

              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[12px] font-bold cd-text-faint mr-1">치환 토큰</span>
                {NOTICE_TOKENS.map((t) => (
                  <span key={t.token} className="inline-flex items-center gap-1 rounded-md border cd-border-c px-2 py-1 text-[12px] cd-text-faint">
                    <code className="text-[12px] cd-text-primary font-semibold">{t.token}</code>
                    {t.label}
                  </span>
                ))}
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-bold cd-text-faint">본문 문단</span>
                {cur.body.map((p, i) => (
                  <div key={i} className="rounded-xl border cd-border-c p-2.5 flex flex-col gap-1.5">
                    <textarea
                      className="cd-input w-full text-[13px] leading-relaxed resize-y"
                      rows={2}
                      value={p}
                      onChange={(e) => setPara(i, e.target.value)}
                    />
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {NOTICE_TOKENS.map((t) => (
                        <button
                          key={t.token}
                          type="button"
                          className="text-[12px] rounded border cd-border-c px-2 py-0.5 cd-text-primary font-semibold hover:cd-tint-primary"
                          onClick={() => insertToken(i, t.token)}
                          title={`${t.label} 삽입`}
                        >
                          {t.token}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="ml-auto cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]"
                        onClick={() => delPara(i)}
                        title="문단 삭제"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  className="cd-btn rounded-lg border cd-border-c px-3 py-1.5 text-xs font-semibold self-start flex items-center gap-1"
                  onClick={addPara}
                >
                  <Plus className="w-3.5 h-3.5" /> 문단 추가
                </button>
              </div>
            </div>

            {/* 문서 미리보기 패널 */}
            <div className="overflow-y-auto p-5 cd-surface-bg">
              <div className="text-[11px] font-bold cd-text-faint mb-3 flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: "var(--cd-primary)" }} />
                실제 고지서 미리보기 (샘플 값)
              </div>
              <LeaveNoticePreview
                round={round}
                title={cur.title}
                paragraphs={preview}
                info={{ name: SAMPLE_TOKEN_VARS.name, granted: SAMPLE_TOKEN_VARS.granted, used: SAMPLE_TOKEN_VARS.used, remaining: SAMPLE_TOKEN_VARS.remaining }}
                noticeDate={SAMPLE_TOKEN_VARS.noticeDate}
                deadline={SAMPLE_TOKEN_VARS.deadline}
                planTotal={SAMPLE_TOKEN_VARS.planTotal}
                companyName={company?.companyName}
                ceoName={company?.ceoName}
              />
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 px-5 py-3 border-t cd-border-c">
          <span className="text-[10.5px] cd-text-faint">표·구조는 고정이며 문구(제목·문단)만 편집됩니다.</span>
          <button type="button" className="cd-btn cd-btn-ghost text-xs px-3 py-2 ml-auto" onClick={onClose}>
            닫기
          </button>
          <button
            type="button"
            className="cd-btn cd-btn-primary rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50"
            onClick={save}
            disabled={saving || loading}
          >
            {saving ? "저장 중…" : `${round}차 문구 저장`}
          </button>
        </div>
      </div>
    </div>
  );
}

function NoticeCell({ notice, empty }: { notice: { noticeDate: string; status: string; paper: boolean } | null; empty: string }) {
  if (!notice) return <span className="text-[11px] cd-text-faint">{empty}</span>;
  const submitted = SUBMITTED.has(notice.status);
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[11.5px] cd-text flex items-center gap-1">
        {notice.noticeDate}
        {notice.paper && <span className="text-[9px] rounded px-1 py-0.5 border cd-border-c cd-text-faint">서면</span>}
      </span>
      <span className={`text-[9.5px] rounded-full px-1.5 py-0.5 w-fit ${submitted ? "cd-tint-primary" : "border border-[color:var(--cd-danger,#FA896B)] text-[color:var(--cd-danger,#FA896B)]"}`}>
        {submitted ? "제출" : "미제출"}
      </span>
    </div>
  );
}
