"use client";

// 접속기록 조회(/admin/access-log) — 개인정보보호 블루프린트 PR-P1.
// access_log(로그인·열람·다운로드·민감 설정 변경) + 파일함 감사로그 통합 뷰.
// 이 화면의 조회도 접속기록에 남는다(서버가 기록).

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import "@/components/cdash/cdash.css";

interface LogRow {
  id: string;
  actorUserId: string | null;
  actorName: string | null;
  action: string;
  targetKind: string;
  targetId: string | null;
  detail: unknown;
  createdAt: string;
}

const ACTION_LABEL: Record<string, string> = {
  login: "로그인",
  view: "열람",
  download: "다운로드",
  delete: "삭제",
  export: "내보내기",
  admin_change: "설정 변경",
};

const KIND_LABEL: Record<string, string> = {
  session: "로그인 세션",
  employee_doc: "인사서류",
  payroll: "급여대장",
  yearend: "연말정산",
  mail_alias: "메일 별칭",
  rbac_bypass: "RBAC 비상모드",
  access_log: "접속기록 조회",
  file_library: "파일함",
};

const PAGE_SIZE = 30;

function detailSummary(row: LogRow): string {
  if (row.detail == null) return "";
  try {
    const d = row.detail as Record<string, unknown>;
    if (row.targetKind === "session") return String(d.ip ?? "");
    if (row.targetKind === "file_library" && d.fileName) return String(d.fileName);
    if (row.targetKind === "file_library" && d.deleted != null) return `${d.deleted}건 삭제`;
    if (row.targetKind === "employee_doc" && d.fileName) return String(d.fileName);
    if (row.targetKind === "mail_alias" && d.op) return String(d.op);
    return "";
  } catch {
    return "";
  }
}

export function AccessLogBoard() {
  const { theme } = useCdashTheme();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromYm, setFromYm] = useState("");
  const [toYm, setToYm] = useState("");
  const [kind, setKind] = useState("");
  const [action, setAction] = useState("");
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (/^\d{6}$/.test(fromYm)) params.set("from", fromYm);
      if (/^\d{6}$/.test(toYm)) params.set("to", toYm);
      if (kind) params.set("kind", kind);
      if (action) params.set("action", action);
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/admin/access-log?${params.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "접속기록을 불러오지 못했습니다.");
      setRows(data.logs ?? []);
      setTotal(Number(data.total ?? 0));
    } catch (err) {
      setRows([]);
      setTotal(0);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page, fromYm, toYm, kind, action, q]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [fromYm, toYm, kind, action, q]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        title="접속기록 조회"
        meta={`${total.toLocaleString()}건 — 로그인·열람·다운로드·민감 설정 변경 이력 (변조 방지 보관)`}
        actions={
          <button type="button" className="cd-btn rounded-lg border cd-border-c px-2.5 py-2" title="새로고침" onClick={load}>
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        }
      />

      <div className="cd-card rounded-3xl p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            className="cd-input font-mono"
            style={{ width: 92 }}
            placeholder="YYYYMM"
            maxLength={6}
            value={fromYm}
            onChange={(e) => setFromYm(e.target.value.replace(/\D/g, ""))}
          />
          <span className="cd-text-faint text-xs">~</span>
          <input
            className="cd-input font-mono"
            style={{ width: 92 }}
            placeholder="YYYYMM"
            maxLength={6}
            value={toYm}
            onChange={(e) => setToYm(e.target.value.replace(/\D/g, ""))}
          />
          <select className="cd-select" style={{ width: 150 }} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">전체 대상</option>
            {Object.entries(KIND_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <select className="cd-select" style={{ width: 130 }} value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">전체 동작</option>
            {Object.entries(ACTION_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <div className="flex items-center gap-1.5">
            <input
              className="cd-input"
              style={{ width: 180 }}
              placeholder="사용자·대상 검색"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setQ(qInput)}
            />
            <button type="button" className="cd-btn rounded-lg border cd-border-c px-2.5 py-2" title="검색" onClick={() => setQ(qInput)}>
              <Search className="w-3.5 h-3.5" />
            </button>
          </div>
          <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] cd-text-faint">
            <ShieldCheck className="w-3.5 h-3.5" />
            이 화면의 조회도 접속기록에 남습니다
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="cd-text-faint text-xs border-b cd-border-c">
                <th className="py-2 px-2 text-left w-40">일시</th>
                <th className="py-2 px-2 text-left w-36">사용자</th>
                <th className="py-2 px-2 text-left w-24">동작</th>
                <th className="py-2 px-2 text-left w-32">대상 종류</th>
                <th className="py-2 px-2 text-left">대상 / 상세</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center cd-text-faint">
                    <Loader2 className="w-4 h-4 animate-spin inline-block mr-2 align-[-2px]" />
                    불러오는 중…
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center cd-text-faint">{error}</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center cd-text-faint">조건에 맞는 기록이 없습니다.</td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-b cd-border-c">
                    <td className="py-2 px-2 font-mono text-[11px] cd-text-faint">
                      {row.createdAt.slice(0, 19).replace("T", " ")}
                    </td>
                    <td className="py-2 px-2 font-medium">{row.actorName ?? row.actorUserId ?? "시스템"}</td>
                    <td className="py-2 px-2">
                      <span className="cd-chip cd-chip-sm">{ACTION_LABEL[row.action] ?? row.action}</span>
                    </td>
                    <td className="py-2 px-2 cd-text-faint text-xs">{KIND_LABEL[row.targetKind] ?? row.targetKind}</td>
                    <td className="py-2 px-2 text-xs">
                      <span className="cd-text-faint">{row.targetId ?? "-"}</span>
                      {detailSummary(row) && <span className="ml-2 cd-text-faint opacity-70">{detailSummary(row)}</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 text-sm">
            <button type="button" className="cd-chip cd-chip-sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              이전
            </button>
            <span className="cd-text-faint tabular-nums">{page} / {totalPages}</span>
            <button
              type="button"
              className="cd-chip cd-chip-sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              다음
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
