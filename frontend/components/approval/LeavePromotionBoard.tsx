"use client";

// 연차사용촉진제도 관리(/approval/leave-promotion, admin) — 직원별 소진율·1/2차 고지 현황.
// 상단 KPI(고지 제출율·소진율·사용·잔여) + '연차 고지 양식 관리'·'연차 고지 발송' 버튼.
// 발송/양식 편집/수신함/회신은 LP-P2·P3. 여기서는 현황 조회·화면 골격.
// 설계: docs/leave-promotion-blueprint.md.

import { useCallback, useEffect, useMemo, useState } from "react";
import { BellRing, FileCog, FileUp, Gauge, MailCheck, Plus, Send, TrendingDown, Trash2, X } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { EmployeeAvatar } from "@/components/ui/EmployeeAvatar";
import { NOTICE_TOKENS, SAMPLE_TOKEN_VARS, fillNoticeBody } from "@/lib/approval/leave-promotion-tokens";
import { LeaveNoticePreview } from "@/components/approval/LeaveNoticePreview";
import { AutoDateInput } from "@/components/ui/AutoDateInput";
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
              <span>부서</span>
              <span className="text-right">부여</span>
              <span className="text-right">사용</span>
              <span className="text-right">잔여</span>
              <span>1차 고지</span>
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
                <span className="text-[12px] cd-text-faint truncate">{r.deptName ?? "-"}</span>
                <span className="text-right font-mono text-[13px] cd-text">{fmt(r.granted)}</span>
                <span className="text-right font-mono text-[13px] cd-text">{fmt(r.used)}</span>
                <span className={`text-right font-mono text-[13px] font-bold ${r.remaining > 0 ? "cd-text" : "cd-text-faint"}`}>{fmt(r.remaining)}</span>
                <NoticeCell notice={r.round1} empty={r.remaining <= 0 ? "대상 아님" : "미발송"} />
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

/** 서면 고지 사후 등록 — 직원 선택 + 통지일 + 사용예정일 + 스캔본 업로드 → 제출 처리(paper). */
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
  const [employeeId, setEmployeeId] = useState("");
  const [noticeDate, setNoticeDate] = useState("");
  const [dates, setDates] = useState<string[]>([""]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  const setDate = (i: number, v: string) => setDates((ds) => ds.map((d, j) => (j === i ? v : d)));
  const addDate = () => setDates((ds) => [...ds, ""]);
  const delDate = (i: number) => setDates((ds) => (ds.length > 1 ? ds.filter((_, j) => j !== i) : ds));

  const submit = async () => {
    if (!employeeId) return alert("직원을 선택하세요.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(noticeDate)) return alert("서면 통지일을 입력하세요(YYYYMMDD).");
    const plan = dates.filter((d) => d.trim());
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("employeeId", employeeId);
      fd.set("year", year);
      fd.set("round", "1");
      fd.set("noticeDate", noticeDate);
      fd.set("plan", JSON.stringify(plan));
      for (const f of files) fd.append("files", f);
      const res = await fetch(`/api/approval/leave-promotion/backfill`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        alert("서면 고지를 사후 등록했습니다.");
        onDone();
      } else {
        alert(data.error ?? "사후 등록에 실패했습니다.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.45)" }}>
      <div className="cd-card rounded-3xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b cd-border-c">
          <FileUp className="w-4 h-4 cd-text-primary" />
          <h3 className="text-sm font-bold cd-text">서면 고지 사후 등록</h3>
          <button type="button" className="cd-text-faint hover:cd-text ml-auto" onClick={onClose} title="닫기">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          <p className="text-[11px] cd-text-faint leading-relaxed">
            이미 서면으로 1차 고지를 진행한 건을 등록합니다. 직원을 선택하고 받은 사용계획서 스캔본을 첨부하면 해당 인원이 <b>제출 완료(서면)</b>로 처리됩니다.
          </p>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold cd-text-faint">직원</span>
            <select className="cd-select" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">선택하세요</option>
              {rows.map((r) => (
                <option key={r.employeeId} value={r.employeeId}>
                  {r.name} {r.positionName ?? ""} · {r.deptName ?? "-"} (잔여 {fmt(r.remaining)}일)
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold cd-text-faint">서면 통지일</span>
            <AutoDateInput value={noticeDate} onChange={setNoticeDate} className="cd-input" placeholder="YYYYMMDD" />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold cd-text-faint">사용예정일 (계획서 기재분 · 선택)</span>
            {dates.map((d, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <AutoDateInput value={d} onChange={(v) => setDate(i, v)} className="cd-input w-40" placeholder="YYYYMMDD" />
                <button type="button" className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)] disabled:opacity-30" onClick={() => delDate(i)} disabled={dates.length <= 1} title="삭제">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                {i === dates.length - 1 && (
                  <button type="button" className="cd-text-primary hover:opacity-70" onClick={addDate} title="날짜 추가">
                    <Plus className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold cd-text-faint">사용계획서 스캔본 (PDF/이미지 · 다건)</span>
            <input
              type="file"
              multiple
              accept="application/pdf,image/*"
              className="text-[12px] cd-text file:cd-btn file:cd-btn-soft file:text-[11px] file:mr-2 file:px-2.5 file:py-1 file:rounded-lg"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            {files.length > 0 && (
              <span className="text-[11px] cd-text-faint mt-1">{files.length}개 파일 · {files.map((f) => f.name).join(", ")}</span>
            )}
          </label>
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t cd-border-c">
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
