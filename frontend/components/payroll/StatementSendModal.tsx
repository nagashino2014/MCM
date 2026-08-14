"use client";

import { useCallback, useEffect, useState } from "react";
import { Send, X } from "lucide-react";

/**
 * 급여명세서 발송 모달 (블루프린트 §4-1 후속)
 * - 확정 대장만 발송 가능. 직원별 발송 이력·미매칭(퇴사자)·메일 미등록을 함께 보여준다.
 * - 교부는 앱 수신함(내 급여명세서 카드), 메일은 도착 알림만(임금 기밀).
 */

interface Target {
  entryId: string;
  employeeId: string | null;
  name: string;
  deptName: string | null;
  email: string | null;
  netPay: number;
  sentAt: string | null;
}

interface Data {
  ledger: { ledgerId: string; payYear: number; payMonth: number; status: string } | null;
  targets: Target[];
}

const won = (v: number) => Math.round(v).toLocaleString();

export default function StatementSendModal({
  ledgerId,
  onClose,
}: {
  ledgerId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [testEmail, setTestEmail] = useState("");

  const load = useCallback(() => {
    fetch(`/api/payroll/statements?ledgerId=${encodeURIComponent(ledgerId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, [ledgerId]);

  useEffect(() => {
    load();
  }, [load]);

  const send = async (resend: boolean, testEmail?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/payroll/statements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", ledgerId, resend, testEmail }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "발송 실패");
      const skipped = (d.skipped ?? []) as Array<{ name: string; reason: string }>;
      setMsg(
        `${d.sent}건 ${testEmail ? "테스트 발송" : "발행"} 완료` +
          (skipped.length ? ` · 주의 ${skipped.length}건: ${skipped.map((s) => `${s.name}(${s.reason})`).join(", ")}` : "")
      );
      load();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirmed = data?.ledger?.status === "confirmed";
  const pending = (data?.targets ?? []).filter((t) => t.employeeId && !t.sentAt).length;
  const sentCount = (data?.targets ?? []).filter((t) => t.sentAt).length;

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center p-6 pt-12" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.35)" }} />
      <div
        className="cd-solid-bg relative z-10 w-full max-w-2xl max-h-[84vh] rounded-3xl p-5 flex flex-col gap-3"
        style={{ boxShadow: "var(--cd-shadow)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h3 className="text-base font-extrabold cd-text">
            급여명세서 발송
            {data?.ledger && (
              <span className="ml-2 text-xs cd-text-faint font-normal">
                {data.ledger.payYear}년 {data.ledger.payMonth}월분 · 발행 {sentCount}/{data.targets.length}
              </span>
            )}
          </h3>
          <button type="button" className="cd-btn rounded-xl p-1.5" onClick={onClose} aria-label="닫기">
            <X className="w-4 h-4" />
          </button>
        </div>

        {!confirmed ? (
          <p className="text-xs rounded-xl px-3 py-2" style={{ color: "var(--cd-warning)", background: "var(--cd-warning-soft)" }}>
            확정된 대장만 명세서를 발행할 수 있습니다. 대장 화면에서 [확정]을 먼저 진행하세요.
          </p>
        ) : (
          <p className="text-xs cd-text-faint">
            명세서는 앱 홈 <b>내 급여명세서</b> 카드로 교부되며, 메일은 도착 알림만 발송됩니다(임금 기밀).
          </p>
        )}
        {msg && <p className="text-xs" style={{ color: "var(--cd-primary)" }}>{msg}</p>}

        <div className="flex-1 min-h-0 overflow-auto border cd-border-c rounded-2xl">
          <table className="w-full text-xs">
            <thead>
              <tr className="cd-text-faint border-b cd-border-c sticky top-0" style={{ background: "var(--cd-card-solid)" }}>
                <th className="text-left font-semibold p-2">성명</th>
                <th className="text-left font-semibold p-2">부서</th>
                <th className="text-right font-semibold p-2">실지급액</th>
                <th className="text-left font-semibold p-2">메일</th>
                <th className="text-left font-semibold p-2">발행</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {(data?.targets ?? []).map((t) => (
                <tr key={t.entryId} className="border-b cd-border-c last:border-0">
                  <td className="p-2 cd-text font-semibold whitespace-nowrap">{t.name}</td>
                  <td className="p-2 cd-text whitespace-nowrap">{t.deptName ?? "-"}</td>
                  <td className="p-2 text-right cd-text tabular-nums">{won(t.netPay)}</td>
                  <td className="p-2 cd-text-faint">
                    {!t.employeeId ? "-" : t.email ? "등록" : <span style={{ color: "var(--cd-warning)" }}>미등록</span>}
                  </td>
                  <td className="p-2">
                    {!t.employeeId ? (
                      <span className="cd-text-faint">미매칭</span>
                    ) : t.sentAt ? (
                      <span style={{ color: "var(--cd-success)" }}>{t.sentAt.slice(0, 10)}</span>
                    ) : (
                      <span className="cd-text-faint">대기</span>
                    )}
                  </td>
                  <td className="p-2 text-right">
                    <a
                      className="text-[11px] font-bold"
                      style={{ color: "var(--cd-primary)" }}
                      href={`/api/payroll/statements/${t.entryId}/file`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      미리보기
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy || !confirmed || pending === 0}
            className="cd-fill-primary text-white rounded-xl px-3.5 py-2 text-sm font-bold flex items-center gap-1.5 disabled:opacity-40"
            onClick={() => send(false)}
          >
            <Send className="w-4 h-4" /> 미발행 {pending}건 발송
          </button>
          {sentCount > 0 && (
            <button
              type="button"
              disabled={busy || !confirmed}
              className="cd-btn rounded-xl px-3.5 py-2 text-sm font-semibold disabled:opacity-40"
              onClick={() => send(true)}
              title="이미 발행된 인원까지 포함해 다시 알립니다."
            >
              전체 재발송
            </button>
          )}
          {/* 테스트 발송 — 전 인원 명세서를 지정 주소로만(PDF 첨부), 교부 이력 미기록 */}
          <div className="ml-auto flex items-end gap-1.5">
            <label className="text-[11px] cd-text-faint">
              테스트 수신 메일
              <input
                className="cd-input text-xs block mt-0.5"
                style={{ width: 190 }}
                placeholder="me@example.com"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={busy || !confirmed || !testEmail.trim()}
              className="cd-btn rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-40"
              onClick={() => send(false, testEmail.trim())}
              title="전 인원 명세서를 이 주소로만 보냅니다(PDF 첨부). 직원에게는 전달되지 않고 교부 이력도 남지 않습니다."
            >
              테스트 발송
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
