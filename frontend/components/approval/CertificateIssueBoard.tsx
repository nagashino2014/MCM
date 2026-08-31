"use client";

// 증명서 발급 관리(FRM-P2, 204 — /approval/certificates) — 증명신청서 승인 건의 발급 파이프라인.
// 재직·경력증명서=[증명서 생성](인사 데이터 자동 기입+직인) / 세무 서류=[스캔 PDF 업로드]→직인본,
// 원천징수영수증은 앱 보유 연말정산 PDF 자동 경로 우선. 발급 후 [개인문서함으로 전송]으로 전달.

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Download, FileUp, Send, Stamp } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import "@/components/cdash/cdash.css";

interface IssueRow {
  issueId: string;
  docId: string;
  docNo: string | null;
  certKind: string;
  certLabel: string;
  auto: boolean;
  employeeName: string | null;
  purpose: string | null;
  targetYear: string | null;
  copies: number;
  status: string;
  fileKey: string | null;
  hwpxKey: string | null;
  issuedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

const STATUS_LABEL: Record<string, string> = { pending: "발급 대기", issued: "발급됨", delivered: "전달 완료" };
type Filter = "pending" | "issued" | "delivered" | "all";

export function CertificateIssueBoard() {
  const { theme } = useCdashTheme();
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [filter, setFilter] = useState<Filter>("pending");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/approval/certificates", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "조회 실패");
      setIssues(Array.isArray(data.issues) ? data.issues : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (issueId: string, action: string) => {
    setBusy(`${action}-${issueId}`);
    setError(null);
    try {
      const res = await fetch("/api/approval/certificates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, issueId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "처리 실패");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  };

  const uploadStamp = async (issueId: string, file: File) => {
    setBusy(`stamp-${issueId}`);
    setError(null);
    try {
      const form = new FormData();
      form.set("issueId", issueId);
      form.set("file", file);
      const res = await fetch("/api/approval/certificates", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "업로드 실패");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  };

  const shown = issues.filter((i) => filter === "all" || i.status === filter);
  const pendingCount = issues.filter((i) => i.status === "pending").length;

  return (
    <div className="cdash cd-fields-white min-h-full p-4 rounded-3xl" data-theme={theme}>
      <div>
        <CdPageHeader title="증명서 발급 관리" />
        <div className="flex items-center gap-1.5 mb-4 flex-wrap">
          {([
            ["pending", `발급 대기${pendingCount ? ` (${pendingCount})` : ""}`],
            ["issued", "발급됨"],
            ["delivered", "전달 완료"],
            ["all", "전체"],
          ] as [Filter, string][]).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setFilter(k)} className={`cd-chip ${filter === k ? "" : "cd-text-muted"}`} data-active={filter === k || undefined}>
              {label}
            </button>
          ))}
        </div>

        {error && (
          <p className="mb-3 text-[12px]" style={{ color: "var(--cd-error,#FA896B)" }}>{error}</p>
        )}

        <div className="cd-card border cd-border-c p-0 overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr>
                {["신청자", "문서번호", "증명서", "용도", "귀속연도", "매수", "상태", "발급/전달"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left cd-surface-bg cd-text font-bold whitespace-nowrap border-b cd-border-c">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-3 py-8 text-center cd-text-faint">불러오는 중…</td></tr>
              ) : shown.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-8 text-center cd-text-faint">해당 상태의 발급 항목이 없습니다.</td></tr>
              ) : (
                shown.map((i) => (
                  <tr key={i.issueId} className="border-b cd-border-c last:border-b-0 align-middle">
                    <td className="px-3 py-2 cd-text whitespace-nowrap">{i.employeeName ?? "-"}</td>
                    <td className="px-3 py-2 cd-text-muted whitespace-nowrap">{i.docNo ?? "-"}</td>
                    <td className="px-3 py-2 cd-text font-bold whitespace-nowrap">{i.certLabel}</td>
                    <td className="px-3 py-2 cd-text-muted">{i.purpose ?? "-"}</td>
                    <td className="px-3 py-2 cd-text-muted whitespace-nowrap">{i.targetYear ?? "-"}</td>
                    <td className="px-3 py-2 cd-text-muted whitespace-nowrap">{i.copies}부</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="cd-chip" style={i.status === "pending" ? { color: "var(--cd-warning,#FFAE1F)" } : undefined}>
                        {STATUS_LABEL[i.status] ?? i.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {i.auto ? (
                          <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" disabled={busy === `issue-auto-${i.issueId}`} onClick={() => void act(i.issueId, "issue-auto")}>
                            <BadgeCheck className="w-3.5 h-3.5" /> {i.fileKey ? "재생성" : "증명서 생성"}
                          </button>
                        ) : (
                          <>
                            {i.certKind === "withholding" && (
                              <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" disabled={busy === `issue-yearend-${i.issueId}`} onClick={() => void act(i.issueId, "issue-yearend")} title="앱이 보유한 연말정산 PDF에 직인을 얹어 생성">
                                <Stamp className="w-3.5 h-3.5" /> 연말정산 PDF로 생성
                              </button>
                            )}
                            <label className="cd-btn cd-btn-soft cd-btn-sm cursor-pointer" title="스캔본 PDF를 올리면 직인본을 생성합니다">
                              <FileUp className="w-3.5 h-3.5" /> 스캔 PDF 업로드
                              <input
                                type="file"
                                accept="application/pdf"
                                className="hidden"
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) void uploadStamp(i.issueId, f);
                                  e.currentTarget.value = "";
                                }}
                              />
                            </label>
                          </>
                        )}
                        {i.fileKey && (
                          <a className="cd-btn cd-btn-soft cd-btn-sm" href={`/api/approval/certificates/download?issueId=${i.issueId}&disposition=inline`} target="_blank" rel="noreferrer">
                            <Download className="w-3.5 h-3.5" /> 보기
                          </a>
                        )}
                        {i.hwpxKey && (
                          <a className="cd-btn cd-btn-soft cd-btn-sm" href={`/api/approval/certificates/download?issueId=${i.issueId}&format=hwpx`} title="회사 서식 한글 파일(직인 전 원본)">
                            <Download className="w-3.5 h-3.5" /> HWPX
                          </a>
                        )}
                        {i.fileKey && i.status !== "delivered" && (
                          <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" disabled={busy === `deliver-${i.issueId}`} onClick={() => void act(i.issueId, "deliver")} title="기안자 개인문서함으로 발급본을 전송합니다">
                            <Send className="w-3.5 h-3.5" /> 개인문서함으로 전송
                          </button>
                        )}
                        {i.status === "delivered" && i.deliveredAt && (
                          <span className="text-[10.5px] cd-text-faint">전달 {i.deliveredAt.slice(0, 10)}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-[11px] cd-text-faint">
          재직·경력증명서는 인사 정보(부서·직급·재직기간)가 자동 기입되고 회사 직인이 날인됩니다. 갑종근로소득세 납세증명·원천징수영수증은
          스캔본 PDF에 직인을 얹어 직인본을 만듭니다(원천징수영수증은 앱이 보유한 연말정산 PDF 자동 경로 우선). 발급 내역은 모두 이 화면에 기록됩니다.
        </p>
      </div>
    </div>
  );
}
