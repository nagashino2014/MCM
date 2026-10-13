"use client";

// 지원 현황 수동 기록(마이그 273, 2026-10-13 사용자 결정) — 채용사이트 자동 수집 대신 담당자가 적는다.
// 왼쪽: 날짜별 누적 지원자 수(같은 날은 갱신, 지난 날짜는 보존 → 일자별 추이). 오른쪽: 면접 예정자(성명·연락처·이메일·
// 면접일시·이력서 보관처). 둘 다 입력자·입력 시각이 남는다. 면접 예정자는 개인정보라 채용이 끝나면 지우도록 안내한다.

import { useCallback, useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { CdBadge, CdButton, CdDateInput, CdHelp, CdInput, isValidDateString, useCdToast } from "@/components/cdash";
import { formatTimeDigits } from "@/components/calendar/CalendarEntryModal";
import { todayYmd } from "@/lib/recruit/meta";
import type { ApplicantCountRow, InterviewRow, InterviewStatus } from "@/lib/recruit/tracking";

const STATUS_LABEL: Record<InterviewStatus, string> = { scheduled: "예정", done: "완료", cancelled: "취소" };
const STATUS_TONE: Record<InterviewStatus, "info" | "success" | "error"> = { scheduled: "info", done: "success", cancelled: "error" };

/** 입력 시각 — 저장은 UTC ISO, 표시는 보는 사람의 시간대(한국) "MM-DD HH:MM" */
const fmtAt = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function PostingTrackingCard({
  postingId,
  canManage,
  onCountsChange,
}: {
  postingId: string;
  canManage: boolean;
  /** 최신 누적 지원자 수가 바뀌면 요약 카드에 알린다 */
  onCountsChange?: (latest: ApplicantCountRow | null) => void;
}) {
  const { toast } = useCdToast();
  const [counts, setCounts] = useState<ApplicantCountRow[] | null>(null);
  const [interviews, setInterviews] = useState<InterviewRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // 지원자 수 입력
  const [countedOn, setCountedOn] = useState(todayYmd());
  const [count, setCount] = useState("");
  const [countMemo, setCountMemo] = useState("");
  // 면접 예정자 입력
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [ivDate, setIvDate] = useState("");
  const [ivTime, setIvTime] = useState("");
  const [resumeNote, setResumeNote] = useState("");

  const applyCounts = useCallback(
    (rows: ApplicantCountRow[]) => {
      setCounts(rows);
      onCountsChange?.(rows.length ? rows[rows.length - 1] : null);
    },
    [onCountsChange]
  );

  useEffect(() => {
    let cancelled = false;
    setCounts(null);
    setInterviews(null);
    (async () => {
      try {
        const [a, b] = await Promise.all([
          fetch(`/api/recruit/postings/${postingId}/applicants`, { cache: "no-store" }).then((r) => r.json()),
          fetch(`/api/recruit/postings/${postingId}/interviews`, { cache: "no-store" }).then((r) => r.json()),
        ]);
        if (cancelled) return;
        applyCounts((a.counts ?? []) as ApplicantCountRow[]);
        setInterviews((b.interviews ?? []) as InterviewRow[]);
      } catch {
        if (!cancelled) { setCounts([]); setInterviews([]); }
      }
    })();
    return () => { cancelled = true; };
  }, [postingId, applyCounts]);

  const call = async (url: string, init: RequestInit, key: string) => {
    setBusy(key);
    try {
      const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "저장하지 못했습니다.");
      return data;
    } catch (e) {
      toast((e as Error).message, "error");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const saveCount = async () => {
    if (!isValidDateString(countedOn)) { toast("기준일을 8자리(YYYYMMDD)로 입력하세요.", "error"); return; }
    if (count === "" || !/^\d+$/.test(count)) { toast("누적 지원자 수를 숫자로 입력하세요.", "error"); return; }
    const data = await call(`/api/recruit/postings/${postingId}/applicants`, {
      method: "POST",
      body: JSON.stringify({ countedOn, count: Number(count), memo: countMemo || null }),
    }, "count");
    if (data) { applyCounts(data.counts); setCount(""); setCountMemo(""); toast(`${countedOn} 기준 ${count}명으로 기록했습니다.`, "success"); }
  };

  const removeCount = async (day: string) => {
    const data = await call(`/api/recruit/postings/${postingId}/applicants?countedOn=${day}`, { method: "DELETE" }, `del-${day}`);
    if (data) applyCounts(data.counts);
  };

  const addInterview = async () => {
    if (!name.trim()) { toast("성명을 입력하세요.", "error"); return; }
    if (ivDate && !isValidDateString(ivDate)) { toast("면접일을 8자리(YYYYMMDD)로 입력하세요.", "error"); return; }
    if ((ivDate && !/^\d{2}:\d{2}$/.test(ivTime)) || (!ivDate && ivTime)) { toast("면접 일시는 날짜와 시각(HH:MM)을 함께 입력하세요.", "error"); return; }
    const data = await call(`/api/recruit/postings/${postingId}/interviews`, {
      method: "POST",
      body: JSON.stringify({ name, phone: phone || null, email: email || null, resumeNote: resumeNote || null, interviewAt: ivDate ? `${ivDate} ${ivTime}` : null }),
    }, "interview");
    if (data) {
      setInterviews(data.interviews);
      setName(""); setPhone(""); setEmail(""); setIvDate(""); setIvTime(""); setResumeNote("");
      toast("면접 예정자를 추가했습니다.", "success");
    }
  };

  const setStatus = async (iv: InterviewRow, status: InterviewStatus) => {
    const data = await call(`/api/recruit/postings/${postingId}/interviews`, {
      method: "PATCH",
      body: JSON.stringify({ interviewId: iv.interviewId, status }),
    }, `st-${iv.interviewId}`);
    if (data) setInterviews(data.interviews);
  };

  const removeInterview = async (iv: InterviewRow) => {
    const data = await call(`/api/recruit/postings/${postingId}/interviews?interviewId=${encodeURIComponent(iv.interviewId)}`, { method: "DELETE" }, `rm-${iv.interviewId}`);
    if (data) setInterviews(data.interviews);
  };

  const loading = counts === null || interviews === null;

  return (
    <div className="rounded-lg border cd-border-c cd-card-bg p-4 mb-4" aria-label="지원 현황">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-bold cd-text">지원 현황</h3>
        <CdHelp label="지원 현황 기록 방법">
          <p>채용사이트의 지원자 수와 면접 예정자는 자동으로 가져오지 않습니다(사이트가 지원자 API를 제공하지 않고 자동 수집은 약관·개인정보 위험이 있어 2026-10-13 수동 입력으로 정함).</p>
          <p className="mt-1">지원자 수는 그날까지의 <b>누적 인원</b>을 적습니다. 같은 날 다시 적으면 그날 값만 바뀌고 지난 날짜는 남아 일자별 추이를 볼 수 있습니다.</p>
          <p className="mt-1">면접 예정자의 이력서는 파일로 저장하지 않고 보관 위치만 적습니다. 채용이 끝나면 개인정보를 지워 주세요.</p>
        </CdHelp>
        {loading && <Loader2 className="w-4 h-4 animate-spin cd-text-muted" />}
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        {/* ── 지원자 수 ── */}
        <section aria-label="지원자 수">
          <div className="text-xs font-bold cd-text-muted mb-2">지원자 수 (날짜별 누적)</div>
          {canManage && (
            <div className="flex flex-wrap items-end gap-2 mb-3">
              <CdDateInput label="기준일" value={countedOn} onChange={setCountedOn} style={{ width: 130 }} />
              <CdInput label="누적 인원" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))} placeholder="명" style={{ width: 90 }} />
              <CdInput label="메모" value={countMemo} onChange={(e) => setCountMemo(e.target.value)} placeholder="선택" className="flex-1 min-w-[140px]" />
              <CdButton variant="primary" size="sm" disabled={busy !== null} onClick={() => void saveCount()}>
                {busy === "count" ? "기록 중…" : "기록"}
              </CdButton>
            </div>
          )}
          {counts && counts.length === 0 ? (
            <p className="text-xs cd-text-muted">아직 기록이 없습니다.</p>
          ) : counts ? (
            <table className="w-full text-xs">
              <thead className="cd-table-head">
                <tr className="text-left cd-text-muted">
                  <th className="px-2 py-1.5 font-semibold">기준일</th>
                  <th className="px-2 py-1.5 font-semibold text-right">누적</th>
                  <th className="px-2 py-1.5 font-semibold text-right">증감</th>
                  <th className="px-2 py-1.5 font-semibold">메모</th>
                  <th className="px-2 py-1.5 font-semibold">입력</th>
                  {canManage && <th className="w-8"></th>}
                </tr>
              </thead>
              <tbody>
                {[...counts].reverse().map((c, i) => (
                  <tr key={c.countedOn} style={{ borderTop: i > 0 ? "1px solid var(--cd-border)" : undefined }}>
                    <td className="px-2 py-1.5 cd-text whitespace-nowrap">{c.countedOn}</td>
                    <td className="px-2 py-1.5 cd-text text-right tabular-nums font-semibold">{c.count}명</td>
                    <td className="px-2 py-1.5 text-right tabular-nums" style={{ color: c.delta == null ? "var(--cd-faint)" : c.delta > 0 ? "var(--cd-success)" : c.delta < 0 ? "var(--cd-error)" : "var(--cd-muted)" }}>
                      {c.delta == null ? "-" : c.delta > 0 ? `+${c.delta}` : String(c.delta)}
                    </td>
                    <td className="px-2 py-1.5 cd-text-muted break-words">{c.memo ?? ""}</td>
                    <td className="px-2 py-1.5 cd-text-faint whitespace-nowrap">{fmtAt(c.updatedAt)}{c.updatedByName ? ` ${c.updatedByName}` : ""}</td>
                    {canManage && (
                      <td className="px-1 py-1">
                        <button type="button" title="이 날짜 기록 삭제" className="p-1 rounded-lg cd-text-faint hover:text-[color:var(--cd-error)]" disabled={busy !== null} onClick={() => void removeCount(c.countedOn)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>

        {/* ── 면접 예정자 ── */}
        <section aria-label="면접 예정자">
          <div className="text-xs font-bold cd-text-muted mb-2">면접 예정자</div>
          {canManage && (
            <div className="grid gap-2 mb-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
              <CdInput label="성명" required value={name} onChange={(e) => setName(e.target.value)} />
              <CdInput label="연락처" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010-" />
              <CdInput label="이메일" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <CdDateInput label="면접일" value={ivDate} onChange={setIvDate} />
              <CdInput label="시각" inputMode="numeric" value={ivTime} onChange={(e) => setIvTime(formatTimeDigits(e.target.value))} placeholder="HH:MM" />
              <CdInput label="이력서 보관처·메모" value={resumeNote} onChange={(e) => setResumeNote(e.target.value)} placeholder="예: 사람인 지원자함" className="col-span-2" />
              <div className="flex items-end">
                <CdButton variant="primary" size="sm" disabled={busy !== null} onClick={() => void addInterview()}>
                  {busy === "interview" ? "추가 중…" : "추가"}
                </CdButton>
              </div>
            </div>
          )}
          {interviews && interviews.length === 0 ? (
            <p className="text-xs cd-text-muted">등록된 면접 예정자가 없습니다.</p>
          ) : interviews ? (
            <ul className="text-xs">
              {interviews.map((iv, i) => (
                <li key={iv.interviewId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" style={{ borderTop: i > 0 ? "1px solid var(--cd-border)" : undefined }}>
                  <CdBadge tone={STATUS_TONE[iv.status]}>{STATUS_LABEL[iv.status]}</CdBadge>
                  <span className="font-semibold cd-text">{iv.name}</span>
                  <span className="cd-text-muted">{iv.interviewAt ?? "일시 미정"}</span>
                  {iv.phone && <span className="cd-text-muted">{iv.phone}</span>}
                  {iv.email && <span className="cd-text-muted break-all">{iv.email}</span>}
                  {iv.resumeNote && <span className="cd-text-faint">이력서: {iv.resumeNote}</span>}
                  <span className="cd-text-faint ml-auto whitespace-nowrap">입력 {fmtAt(iv.createdAt)}{iv.createdByName ? ` ${iv.createdByName}` : ""}</span>
                  {canManage && (
                    <span className="flex items-center gap-1">
                      <select
                        className="cd-select"
                        style={{ minHeight: 28, padding: "2px 24px 2px 8px", fontSize: 12 }}
                        value={iv.status}
                        aria-label={`${iv.name} 면접 상태`}
                        disabled={busy !== null}
                        onChange={(e) => void setStatus(iv, e.target.value as InterviewStatus)}
                      >
                        {(Object.keys(STATUS_LABEL) as InterviewStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                      </select>
                      <button type="button" title="삭제(개인정보 파기)" className="p-1 rounded-lg cd-text-faint hover:text-[color:var(--cd-error)]" disabled={busy !== null} onClick={() => void removeInterview(iv)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          {interviews && interviews.length > 0 && (
            <p className="text-[11px] cd-text-faint mt-2">면접 예정자 정보는 개인정보입니다 — 채용이 끝나면 삭제해 주세요.</p>
          )}
        </section>
      </div>
    </div>
  );
}
