"use client";

// 파일함(/files) — 그룹웨어 전반(전자결재·메신저·사업장 자료·게시판·업무 이슈)의
// 업로드 파일 통합 목록. 행 클릭 = 열기, 상단 선택/일괄 삭제, 하단 파일 저장 정책.
// 필터: 소스 · 형식 · 기간(프리셋 태그 + YYYYMM~YYYYMM) · 키워드.

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Loader2, RefreshCw, Search, Trash2 } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { formatBytes } from "@/lib/approval/attachments";
import "@/components/cdash/cdash.css";

interface FileRow {
  id: string;
  source: string;
  sourceLabel: string;
  fileName: string;
  ext: string;
  byteSize: number | null;
  contentType: string | null;
  uploadedAt: string | null;
  context: string | null;
}

type RetentionPolicies = { le5mb: string; le50mb: string; gt50mb: string };

const SOURCE_OPTIONS = [
  ["", "전체 소스"],
  ["approval", "전자결재"],
  ["chat", "메신저"],
  ["facility", "사업장 자료"],
  ["board", "공지·게시판"],
  ["issue", "업무추진 이슈"],
] as const;

const FORMAT_OPTIONS = [
  ["", "전체 형식"],
  ["pdf", "PDF"],
  ["image", "이미지"],
  ["doc", "문서"],
  ["sheet", "스프레드시트"],
  ["ppt", "프레젠테이션"],
  ["zip", "압축"],
  ["etc", "기타"],
] as const;

const PERIOD_PRESETS = [
  [1, "1개월"],
  [3, "3개월"],
  [6, "6개월"],
  [12, "1년"],
] as const;

const RETENTION_OPTIONS = [
  ["6m", "6개월"],
  ["1y", "1년"],
  ["5y", "5년"],
  ["permanent", "영구"],
] as const;

const TIER_LABEL: Record<keyof RetentionPolicies, string> = {
  le5mb: "5MB 이하 파일",
  le50mb: "50MB 이하 파일",
  gt50mb: "50MB 이상 파일",
};

const PAGE_SIZE = 30;

/** 오늘 기준 n개월 전의 YYYYMM. */
function ymAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function ymNow(): string {
  return ymAgo(0);
}

/** 저장 정책 기준 보존기간 경과 여부 — 목록의 '경과' 배지용(1차는 표시까지, 자동 삭제는 후속). */
function isExpired(row: FileRow, policies: RetentionPolicies | null): boolean {
  if (!policies || !row.uploadedAt) return false;
  const size = row.byteSize ?? 0;
  const tier: keyof RetentionPolicies = size <= 5 * 1024 * 1024 ? "le5mb" : size <= 50 * 1024 * 1024 ? "le50mb" : "gt50mb";
  const retention = policies[tier];
  const months = retention === "6m" ? 6 : retention === "1y" ? 12 : retention === "5y" ? 60 : 0;
  if (!months) return false;
  const limit = new Date(row.uploadedAt);
  if (Number.isNaN(limit.getTime())) return false;
  limit.setMonth(limit.getMonth() + months);
  return limit.getTime() < Date.now();
}

export function FileLibraryBoard() {
  const { theme } = useCdashTheme();
  const [rows, setRows] = useState<FileRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 필터
  const [source, setSource] = useState("");
  const [format, setFormat] = useState("");
  const [fromYm, setFromYm] = useState("");
  const [toYm, setToYm] = useState("");
  const [periodPreset, setPeriodPreset] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");
  // 선택·삭제
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  // 저장 정책
  const [policies, setPolicies] = useState<RetentionPolicies | null>(null);
  const [policyDraft, setPolicyDraft] = useState<RetentionPolicies | null>(null);
  const [policySaving, setPolicySaving] = useState(false);
  const [policyMsg, setPolicyMsg] = useState<string | null>(null);

  const filterParams = useCallback(() => {
    const params = new URLSearchParams();
    if (source) params.set("source", source);
    if (format) params.set("format", format);
    if (/^\d{6}$/.test(fromYm)) params.set("from", fromYm);
    if (/^\d{6}$/.test(toYm)) params.set("to", toYm);
    if (q.trim()) params.set("q", q.trim());
    return params;
  }, [source, format, fromYm, toYm, q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = filterParams();
      params.set("page", String(page));
      params.set("pageSize", String(PAGE_SIZE));
      const res = await fetch(`/api/files?${params.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "파일 목록을 불러오지 못했습니다.");
      setRows(data.files ?? []);
      setTotal(Number(data.total ?? 0));
      setSelected(new Set());
    } catch (err) {
      setRows([]);
      setTotal(0);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filterParams, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch("/api/files/policy", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data?.policies) {
          setPolicies(data.policies);
          setPolicyDraft(data.policies);
        }
      })
      .catch(() => {});
  }, []);

  // 필터 변경 시 1페이지로.
  useEffect(() => {
    setPage(1);
  }, [source, format, fromYm, toYm, q]);

  const applyPreset = (months: number) => {
    setPeriodPreset(months);
    setFromYm(ymAgo(months));
    setToYm(ymNow());
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const toggleAll = () => {
    setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)));
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openRow = (row: FileRow) => {
    window.open(`/api/files/open?id=${encodeURIComponent(row.id)}`, "_blank", "noopener");
  };

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    if (!window.confirm(`선택한 ${selected.size}개 파일을 삭제할까요?\n삭제된 파일은 복구할 수 없습니다.`)) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/files", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "삭제에 실패했습니다.");
      await load();
    } catch (err) {
      window.alert((err as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const deleteFiltered = async () => {
    if (total === 0) return;
    if (!window.confirm(`현재 필터 조건의 파일 ${total.toLocaleString()}건을 모두 삭제할까요?\n삭제된 파일은 복구할 수 없습니다.`)) return;
    setDeleting(true);
    try {
      const params = filterParams();
      const res = await fetch("/api/files", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "filtered",
          filter: {
            source: params.get("source") ?? "",
            format: params.get("format") ?? "",
            from: params.get("from") ?? "",
            to: params.get("to") ?? "",
            q: params.get("q") ?? "",
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "삭제에 실패했습니다.");
      await load();
    } catch (err) {
      window.alert((err as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const savePolicies = async () => {
    if (!policyDraft) return;
    setPolicySaving(true);
    setPolicyMsg(null);
    try {
      const res = await fetch("/api/files/policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policies: policyDraft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "정책 저장에 실패했습니다.");
      setPolicies(data.policies);
      setPolicyMsg("저장되었습니다.");
    } catch (err) {
      setPolicyMsg((err as Error).message);
    } finally {
      setPolicySaving(false);
    }
  };

  const policyDirty = useMemo(
    () => JSON.stringify(policies) !== JSON.stringify(policyDraft),
    [policies, policyDraft]
  );

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        title="파일함"
        meta={`전자결재 · 메신저 · 사업장 자료 · 게시판 · 업무 이슈 첨부 ${total.toLocaleString()}건`}
        actions={
          <button type="button" className="cd-btn rounded-lg border cd-border-c px-2.5 py-2" title="새로고침" onClick={load}>
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        }
      />

      <div className="cd-card rounded-3xl p-5 flex flex-col gap-4">
        {/* 필터 — 소스 · 형식 · 기간(프리셋 + YYYYMM~YYYYMM) · 키워드 */}
        <div className="flex items-center gap-2 flex-wrap">
          <select className="cd-select" style={{ width: 130 }} value={source} onChange={(e) => setSource(e.target.value)}>
            {SOURCE_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <select className="cd-select" style={{ width: 140 }} value={format} onChange={(e) => setFormat(e.target.value)}>
            {FORMAT_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            {PERIOD_PRESETS.map(([months, label]) => (
              <button
                key={months}
                type="button"
                className="cd-chip cd-chip-sm"
                data-active={periodPreset === months}
                onClick={() => applyPreset(months)}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            className="cd-input font-mono"
            style={{ width: 92 }}
            placeholder="YYYYMM"
            maxLength={6}
            value={fromYm}
            onChange={(e) => {
              setFromYm(e.target.value.replace(/\D/g, ""));
              setPeriodPreset(null);
            }}
          />
          <span className="cd-text-faint text-xs">~</span>
          <input
            className="cd-input font-mono"
            style={{ width: 92 }}
            placeholder="YYYYMM"
            maxLength={6}
            value={toYm}
            onChange={(e) => {
              setToYm(e.target.value.replace(/\D/g, ""));
              setPeriodPreset(null);
            }}
          />
          <div className="flex items-center gap-1.5">
            <input
              className="cd-input"
              style={{ width: 200 }}
              placeholder="파일명·출처 검색"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setQ(qInput)}
            />
            <button type="button" className="cd-btn rounded-lg border cd-border-c px-2.5 py-2" title="검색" onClick={() => setQ(qInput)}>
              <Search className="w-3.5 h-3.5" />
            </button>
          </div>
          {(source || format || fromYm || toYm || q) && (
            <button
              type="button"
              className="cd-chip cd-chip-sm"
              onClick={() => {
                setSource("");
                setFormat("");
                setFromYm("");
                setToYm("");
                setPeriodPreset(null);
                setQ("");
                setQInput("");
              }}
            >
              필터 초기화
            </button>
          )}
          {/* 삭제 액션 — 목록 상단 우측 */}
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-sm inline-flex items-center gap-1.5 disabled:opacity-40"
              disabled={selected.size === 0 || deleting}
              onClick={deleteSelected}
            >
              <Trash2 className="w-3.5 h-3.5" />
              선택 삭제{selected.size > 0 ? ` (${selected.size})` : ""}
            </button>
            <button
              type="button"
              className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-sm inline-flex items-center gap-1.5 disabled:opacity-40"
              disabled={total === 0 || deleting}
              onClick={deleteFiltered}
              title="현재 필터 조건에 해당하는 파일 전체 삭제"
            >
              <Trash2 className="w-3.5 h-3.5" />
              일괄 삭제
            </button>
          </div>
        </div>

        {/* 목록 */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="cd-text-faint text-xs border-b cd-border-c">
                <th className="py-2 px-2 w-8 text-left">
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="전체 선택" />
                </th>
                <th className="py-2 px-2 text-left">파일명</th>
                <th className="py-2 px-2 text-left">입력 소스</th>
                <th className="py-2 px-2 text-left w-24">형식</th>
                <th className="py-2 px-2 text-right w-24">크기</th>
                <th className="py-2 px-2 text-left w-28">입력일</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center cd-text-faint">
                    <Loader2 className="w-4 h-4 animate-spin inline-block mr-2 align-[-2px]" />
                    불러오는 중…
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center cd-text-faint">{error}</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center cd-text-faint">조건에 맞는 파일이 없습니다.</td>
                </tr>
              ) : (
                rows.map((row) => {
                  const expired = isExpired(row, policies);
                  return (
                    <tr
                      key={row.id}
                      className="border-b cd-border-c cd-row-hover cursor-pointer"
                      onClick={() => openRow(row)}
                      title="클릭하면 파일을 엽니다"
                    >
                      <td className="py-2 px-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(row.id)}
                          onChange={() => toggleOne(row.id)}
                          aria-label={`${row.fileName} 선택`}
                        />
                      </td>
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="w-3.5 h-3.5 cd-text-faint shrink-0" />
                          <span className="truncate font-medium" style={{ maxWidth: 360 }}>{row.fileName}</span>
                          {expired && (
                            <span className="cd-chip cd-chip-sm shrink-0" title="파일 저장 정책의 보존기간이 지났습니다">
                              보존기간 경과
                            </span>
                          )}
                        </div>
                        {row.context && <div className="cd-text-faint text-xs truncate mt-0.5" style={{ maxWidth: 420 }}>{row.context}</div>}
                      </td>
                      <td className="py-2 px-2">
                        <span className="cd-chip cd-chip-sm">{row.sourceLabel}</span>
                      </td>
                      <td className="py-2 px-2 uppercase text-xs cd-text-faint">{row.ext || "-"}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{formatBytes(row.byteSize ?? 0)}</td>
                      <td className="py-2 px-2 tabular-nums">{row.uploadedAt ? row.uploadedAt.slice(0, 10) : "-"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* 페이지네이션 */}
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

      {/* 파일 저장 정책 — 크기 구간별 보존기간(설정 저장 + 목록 '경과' 표시. 자동 삭제 배치는 후속) */}
      <div className="cd-card rounded-3xl p-5 flex flex-col gap-4">
        <div>
          <div className="font-semibold">파일 저장 정책</div>
          <div className="cd-text-faint text-xs mt-0.5">
            크기 구간별 보존기간을 설정합니다. 보존기간이 지난 파일은 목록에 &lsquo;보존기간 경과&rsquo;로 표시됩니다.
          </div>
        </div>
        <div className="flex flex-col gap-3">
          {(Object.keys(TIER_LABEL) as Array<keyof RetentionPolicies>).map((tier) => (
            <div key={tier} className="flex items-center gap-3 flex-wrap">
              <div className="w-32 text-sm font-medium">{TIER_LABEL[tier]}</div>
              <div className="flex items-center gap-1">
                {RETENTION_OPTIONS.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className="cd-chip cd-chip-sm"
                    data-active={policyDraft?.[tier] === value}
                    onClick={() => setPolicyDraft((prev) => (prev ? { ...prev, [tier]: value } : prev))}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="cd-btn cd-fill-primary rounded-lg px-4 py-2 text-sm disabled:opacity-40"
            disabled={!policyDraft || !policyDirty || policySaving}
            onClick={savePolicies}
          >
            {policySaving ? "저장 중…" : "정책 저장"}
          </button>
          {policyMsg && <span className="cd-text-faint text-xs">{policyMsg}</span>}
        </div>
      </div>
    </div>
  );
}
