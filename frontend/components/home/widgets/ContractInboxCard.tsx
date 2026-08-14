"use client";

import { useState } from "react";
import { FileSignature, X } from "lucide-react";
import { useHomeWidget } from "@/components/home/useHomeWidget";

/**
 * 내 근로계약 위젯 (PL-P3 §5-3·§5-4) — 발송된 근로계약서 열람·전자서명.
 * - PDF 는 앱 내 열람만(메일 미첨부 방침). 서명은 동의 5종 전체 체크 후 1회 클릭.
 * - 서명 문자열(성명·사번·시각)은 서버가 생성·기록한다.
 */

interface MyContractRow {
  contractId: string;
  contractDate: string | null;
  positionName: string | null;
  annualSalary: number | null;
  monthlySalary: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  status: string;
  signedAt: string | null;
  tag: string | null;
}

interface ConsentSection {
  key: string;
  label: string;
  text: string;
}

interface MyContractsData {
  rows: MyContractRow[];
  linked: boolean;
  consentSections: ConsentSection[];
}

export function ContractInboxCard() {
  const w = useHomeWidget<MyContractsData>("/api/payroll/my-contracts");
  const [signing, setSigning] = useState<MyContractRow | null>(null);
  const [consents, setConsents] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (w.status === "forbidden") return null;

  const allChecked =
    w.status === "ok" && w.data.consentSections.every((s) => consents[s.key]);

  const submit = async () => {
    if (!signing) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/payroll/my-contracts/${signing.contractId}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consents }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "서명에 실패했습니다.");
      setSigning(null);
      setConsents({});
      w.reload?.();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="cd-card rounded-3xl p-4 flex h-full min-h-0 flex-col gap-3 cd-reveal">
      <header className="flex items-center gap-2">
        <span className="cd-title-icon"><FileSignature className="w-4 h-4" /></span>
        <h3 className="text-sm font-extrabold cd-text">내 근로계약</h3>
      </header>
      {w.status === "loading" ? (
        <div className="flex-1 rounded-2xl border cd-border-c animate-pulse" />
      ) : w.status === "error" ? (
        <p className="text-xs cd-text-faint">불러오지 못했습니다.</p>
      ) : !w.data.linked ? (
        <p className="text-xs cd-text-faint leading-relaxed">계정과 직원 정보가 연결되어 있지 않습니다.</p>
      ) : w.data.rows.length === 0 ? (
        <p className="text-xs cd-text-faint leading-relaxed">수신된 근로계약서가 없습니다.</p>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide flex flex-col gap-2">
          {w.data.rows.map((row) => (
            <div key={row.contractId} className="flex items-center gap-2 rounded-2xl border cd-border-c px-3 py-2">
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap"
                style={
                  row.status === "signed"
                    ? { color: "var(--cd-success)", background: "var(--cd-success-soft)" }
                    : { color: "var(--cd-warning)", background: "var(--cd-warning-soft)" }
                }
              >
                {row.status === "signed" ? "서명 완료" : "서명 대기"}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold cd-text truncate">
                  {row.contractDate ?? "-"} · {row.positionName ?? "-"}
                  {row.tag === "승진" && <span className="ml-1 text-[10px]" style={{ color: "var(--cd-warning)" }}>승진</span>}
                </p>
                <p className="text-[10px] cd-text-faint">
                  연봉 {row.annualSalary != null ? Math.round(row.annualSalary).toLocaleString() : "-"}원
                </p>
              </div>
              <a
                className="ml-auto text-[11px] font-bold whitespace-nowrap"
                style={{ color: "var(--cd-primary)" }}
                href={`/api/payroll/my-contracts/${row.contractId}/file`}
                target="_blank"
                rel="noreferrer"
              >
                열람
              </a>
              {row.status === "sent" && (
                <button
                  type="button"
                  className="cd-fill-primary text-white rounded-lg px-2.5 py-1 text-[11px] font-bold whitespace-nowrap"
                  onClick={() => {
                    setSigning(row);
                    setConsents({});
                    setMsg(null);
                  }}
                >
                  서명
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 서명 모달 */}
      {signing && w.status === "ok" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setSigning(null)}>
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.35)" }} />
          <div
            className="cdash-vars cd-fields-white cd-solid-bg relative z-10 w-full max-w-md rounded-3xl p-5 flex flex-col gap-3"
            style={{ boxShadow: "var(--cd-shadow)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <h3 className="text-base font-extrabold cd-text">근로계약 전자서명</h3>
              <button type="button" className="cd-btn rounded-xl p-1.5" onClick={() => setSigning(null)} aria-label="닫기">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs cd-text-faint leading-relaxed">
              {signing.contractDate} 자 근로계약서 · 연봉{" "}
              {signing.annualSalary != null ? Math.round(signing.annualSalary).toLocaleString() : "-"}원 —{" "}
              <a
                className="font-bold"
                style={{ color: "var(--cd-primary)" }}
                href={`/api/payroll/my-contracts/${signing.contractId}/file`}
                target="_blank"
                rel="noreferrer"
              >
                전문 열람
              </a>
            </p>
            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
              {w.data.consentSections.map((s) => (
                <label key={s.key} className="flex items-start gap-2 rounded-xl border cd-border-c p-2.5 text-xs cd-text">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={Boolean(consents[s.key])}
                    onChange={(e) => setConsents((p) => ({ ...p, [s.key]: e.target.checked }))}
                  />
                  <span>
                    <b>{s.label}</b>
                    <span className="block cd-text-faint mt-0.5 leading-relaxed">{s.text}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="text-[11px] cd-text-faint leading-relaxed">
              서명 시 본인 성명·사번·서명 시각이 전자서명으로 기록되며, 전자서명법 제3조에 따라 서면 서명과
              동일한 효력을 가지는 것에 동의합니다.
            </p>
            {msg && <p className="text-xs" style={{ color: "var(--cd-error)" }}>{msg}</p>}
            <button
              type="button"
              disabled={!allChecked || busy}
              onClick={submit}
              className="cd-fill-primary text-white rounded-xl px-3.5 py-2.5 text-sm font-bold disabled:opacity-40"
            >
              전자서명하고 계약 체결
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
