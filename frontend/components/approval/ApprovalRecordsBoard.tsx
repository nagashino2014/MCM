"use client";

// ★양식별 문서 조회(/approval/records, admin) — 양식의 모든 필드가 컬럼으로 펼쳐지는
// 데이터 테이블. 다우오피스에서 불가능했던 "문서 속 데이터의 분류·정렬·발췌"가 목적.
// CSV 내보내기(BOM — 엑셀 호환). 행 클릭 = 문서 상세 모달.
// '전자결재'/'발송공문' 탭(135) — 발송공문은 official_letters 대장(과거 이관 포함) 조회.
// 날짜 필터는 YYYYMM 입력 2개 + 연도 선택(선택 시 1~12월 자동 세팅) — 사용자 요구.
// 설계: docs/e-approval-blueprint.md §5-6, docs/official-letter-blueprint.md.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Search, Table2 } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { ApprovalDocModal, DOC_STATUS_LABEL } from "@/components/approval/ApprovalDocModal";
import { LetterRecordsTable } from "@/components/approval/LetterRecordsTable";
import { QuoteRecordsTable } from "@/components/approval/QuoteRecordsTable";
import type { ApprovalFieldDef } from "@/lib/approval/fields";
import { findInCatalog, type LeaveTypeItem } from "@/lib/approval/leave-types";
import type { OfficialLetterRow } from "@/lib/letter/types";
import type { QuotationRow } from "@/lib/quote/types";
import "@/components/cdash/cdash.css";

type RecordsTab = "approval" | "letters" | "quotes";

/** YYYYMM → 조회용 ISO 날짜 범위 변환(from=1일, to=월말일). 형식이 아니면 null. */
function ymToDate(ym: string, edge: "from" | "to"): string | null {
  const m = /^(\d{4})(\d{2})$/.exec(ym.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  if (edge === "from") return `${m[1]}-${m[2]}-01`;
  const last = new Date(y, mo, 0).getDate();
  return `${m[1]}-${m[2]}-${String(last).padStart(2, "0")}`;
}

interface FormRow {
  formId: string;
  name: string;
}

interface RecordRow {
  docId: string;
  docNo: string | null;
  title: string;
  status: string;
  drafterName: string | null;
  deptName: string | null;
  submittedAt: string | null;
  fieldValues: Record<string, unknown>;
}

const short = (s: string | null) => (s ? s.slice(0, 10) : "-");

/** 필드 값 평탄화 — 타입별 표시 문자열(테이블·CSV 공용) */
function flatten(field: ApprovalFieldDef, value: unknown, leaveCatalog: LeaveTypeItem[]): string {
  if (value == null) return "";
  switch (field.type) {
    case "multitext": {
      // G3: 리치 에디터 도입으로 HTML 저장 — 표·CSV 에는 태그를 벗겨 텍스트만
      const div = document.createElement("div");
      div.innerHTML = String(value);
      return (div.textContent ?? "").replace(/\s+/g, " ").trim();
    }
    case "period": {
      const v = value as { from?: string; to?: string };
      return [v.from, v.to].filter(Boolean).join("~");
    }
    case "checkbox":
      return Array.isArray(value) ? value.map(String).join(", ") : String(value);
    case "user_select": {
      const arr = Array.isArray(value) ? value : [value];
      return arr
        .map((p) => (p && typeof p === "object" ? String((p as { name?: string }).name ?? "") : String(p ?? "")))
        .filter(Boolean)
        .join(", ");
    }
    case "company_select": {
      const v = value as { name?: string; manual?: boolean };
      return v && typeof v === "object" ? `${v.name ?? ""}${v.manual ? " (직접입력)" : ""}` : String(value);
    }
    case "contract_select": {
      const v = value as { title?: string; manual?: boolean };
      return v && typeof v === "object" ? `${v.title ?? ""}${v.manual ? " (직접입력)" : ""}` : String(value);
    }
    case "leave_type": {
      const it = findInCatalog(leaveCatalog, value);
      return it ? `${it.label}${it.days != null ? ` (${it.days}일)` : ""}` : String(value);
    }
    case "currency": {
      const n = Number(String(value).replace(/[^\d.-]/g, ""));
      return isNaN(n) ? String(value) : n.toLocaleString("ko-KR");
    }
    case "table": {
      const rows = Array.isArray(value) ? (value as Record<string, string>[]) : [];
      if (!rows.length) return "";
      if (field.sumColumn) {
        const sum = rows.reduce((a, r) => a + (Number(String(r[field.sumColumn!] ?? "").replace(/[^\d.-]/g, "")) || 0), 0);
        return `${rows.length}행 · 합계 ${sum.toLocaleString("ko-KR")}`;
      }
      return `${rows.length}행`;
    }
    default:
      return String(value);
  }
}

export function ApprovalRecordsBoard() {
  const { theme } = useCdashTheme();
  const [tab, setTab] = useState<RecordsTab>("approval");
  const [forms, setForms] = useState<FormRow[]>([]);
  const [formId, setFormId] = useState("");
  const [status, setStatus] = useState("all");
  const [fromYm, setFromYm] = useState("");
  const [toYm, setToYm] = useState("");
  const [yearSel, setYearSel] = useState("");
  const [q, setQ] = useState("");
  const [fields, setFields] = useState<ApprovalFieldDef[]>([]);
  const [docs, setDocs] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailDocId, setDetailDocId] = useState<string | null>(null);
  const [leaveCatalog, setLeaveCatalog] = useState<LeaveTypeItem[]>([]);
  const [letters, setLetters] = useState<OfficialLetterRow[]>([]);
  const [lettersLoading, setLettersLoading] = useState(false);
  const [quotes, setQuotes] = useState<QuotationRow[]>([]);
  const [quotesLoading, setQuotesLoading] = useState(false);

  useEffect(() => {
    fetch("/api/approval/forms?all=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setForms(d.forms ?? []);
        if (!formId && d.forms?.length) setFormId(d.forms[0].formId);
      })
      .catch(() => {});
    fetch("/api/approval/leave-types", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.types && setLeaveCatalog(d.types))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    if (!formId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ formId, status });
      const fromDate = ymToDate(fromYm, "from");
      const toDate = ymToDate(toYm, "to");
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/approval/query?${params.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "조회 실패");
      setFields((data.fields ?? []).filter((f: ApprovalFieldDef) => f.type !== "static"));
      setDocs(data.docs ?? []);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [formId, status, fromYm, toYm, q]);
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId, status]);

  const loadLetters = useCallback(async () => {
    setLettersLoading(true);
    try {
      const params = new URLSearchParams();
      if (/^\d{6}$/.test(fromYm.trim())) params.set("from", fromYm.trim());
      if (/^\d{6}$/.test(toYm.trim())) params.set("to", toYm.trim());
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/letters?${params.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "조회 실패");
      setLetters(data.letters ?? []);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setLettersLoading(false);
    }
  }, [fromYm, toYm, q]);
  const loadQuotes = useCallback(async () => {
    setQuotesLoading(true);
    try {
      const params = new URLSearchParams();
      if (/^\d{6}$/.test(fromYm.trim())) params.set("from", fromYm.trim());
      if (/^\d{6}$/.test(toYm.trim())) params.set("to", toYm.trim());
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/quotes?${params.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "조회 실패");
      setQuotes(data.quotes ?? []);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setQuotesLoading(false);
    }
  }, [fromYm, toYm, q]);
  useEffect(() => {
    if (tab === "letters") void loadLetters();
    else if (tab === "quotes") void loadQuotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  /** 연도 선택 → YYYYMM 범위 자동 세팅 + 즉시 조회. */
  const applyYear = (year: string) => {
    setYearSel(year);
    if (!year) return;
    setFromYm(`${year}01`);
    setToYm(`${year}12`);
  };
  useEffect(() => {
    if (!yearSel) return;
    if (tab === "letters") void loadLetters();
    else if (tab === "quotes") void loadQuotes();
    else void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromYm, toYm]);

  const csv = useMemo(() => {
    const head = ["문서번호", "제목", "기안자", "부서", "상신일", "상태", ...fields.map((f) => f.label)];
    const lines = docs.map((d) => [
      d.docNo ?? "",
      d.title,
      d.drafterName ?? "",
      d.deptName ?? "",
      short(d.submittedAt),
      DOC_STATUS_LABEL[d.status] ?? d.status,
      ...fields.map((f) => flatten(f, d.fieldValues[f.key], leaveCatalog)),
    ]);
    return [head, ...lines].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  }, [docs, fields, leaveCatalog]);

  const download = () => {
    const formName = forms.find((f) => f.formId === formId)?.name ?? "양식";
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${formName}_문서조회_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<Table2 className="w-5 h-5" />}
        eyebrow="Approval · Records"
        title="양식별 문서 조회"
        subtitle="양식의 모든 입력 항목이 컬럼으로 펼쳐집니다 — 필터·정렬·엑셀 내보내기로 문서 속 데이터를 활용하세요."
      />

      <div className="cd-card rounded-3xl p-5 flex flex-col gap-4 min-h-0">
        {/* 전자결재 / 발송공문 / 발송견적 탭 — work-plan 용역/Task 탭 양식(ServiceListPanel.tsx:126) */}
        <div className="flex items-end gap-1 px-1 -mb-1">
          {(["approval", "letters", "quotes"] as RecordsTab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-t-xl px-4 py-2 text-sm font-semibold border-b-2 ${
                tab === t ? "cd-text-primary border-current cd-tint-primary" : "cd-text-faint border-transparent cd-row-hover"
              }`}
            >
              {t === "approval" ? "전자결재" : t === "letters" ? "발송공문" : "발송견적"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {tab === "approval" && (
            <>
              <select className="cd-select" style={{ width: 200 }} value={formId} onChange={(e) => setFormId(e.target.value)}>
                {forms.map((f) => (
                  <option key={f.formId} value={f.formId}>
                    {f.name}
                  </option>
                ))}
              </select>
              <select className="cd-select" style={{ width: 110 }} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="all">전체 상태</option>
                <option value="approved">승인</option>
                <option value="in_progress">결재중</option>
                <option value="rejected">반려</option>
              </select>
            </>
          )}
          {/* 기간: YYYYMM 직접 입력 2개 + 연도 선택(선택 시 1~12월 자동) */}
          <select className="cd-select" style={{ width: 110 }} value={yearSel} onChange={(e) => applyYear(e.target.value)} title="연도 선택 — 해당 연도 전체 기간을 자동 설정">
            <option value="">연도 선택</option>
            {Array.from({ length: 8 }, (_, i) => String(new Date().getFullYear() - i)).map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
          <input
            className="cd-input font-mono"
            style={{ width: 92 }}
            placeholder="YYYYMM"
            maxLength={6}
            value={fromYm}
            onChange={(e) => {
              setFromYm(e.target.value.replace(/\D/g, ""));
              setYearSel("");
            }}
            onKeyDown={(e) => e.key === "Enter" && (tab === "letters" ? loadLetters() : tab === "quotes" ? loadQuotes() : load())}
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
              setYearSel("");
            }}
            onKeyDown={(e) => e.key === "Enter" && (tab === "letters" ? loadLetters() : tab === "quotes" ? loadQuotes() : load())}
          />
          <div className="flex items-center gap-1.5">
            <input
              className="cd-input"
              style={{ width: 180 }}
              placeholder={tab === "letters" ? "제목·공문번호·기안자 검색" : tab === "quotes" ? "건명·견적번호·기안자 검색" : "제목·기안자 검색"}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (tab === "letters" ? loadLetters() : tab === "quotes" ? loadQuotes() : load())}
            />
            <button type="button" className="cd-btn rounded-lg border cd-border-c px-2.5 py-2" title="조회" onClick={() => (tab === "letters" ? loadLetters() : tab === "quotes" ? loadQuotes() : load())}>
              <Search className="w-3.5 h-3.5" />
            </button>
          </div>
          {tab === "approval" && (
            <button
              type="button"
              className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs flex items-center gap-1.5 ml-auto disabled:opacity-50"
              disabled={!docs.length}
              onClick={download}
            >
              <Download className="w-3.5 h-3.5" /> CSV 내보내기
            </button>
          )}
        </div>

        {tab === "letters" ? (
          <>
            <LetterRecordsTable letters={letters} loading={lettersLoading} theme={theme} onChanged={loadLetters} />
            <p className="text-[10.5px] cd-text-faint">공문을 클릭하면 PDF 원문 확인·PDF/한글 다운로드·재발송·수신처 편집이 가능합니다.</p>
          </>
        ) : tab === "quotes" ? (
          <>
            <QuoteRecordsTable quotes={quotes} loading={quotesLoading} theme={theme} onChanged={loadQuotes} />
            <p className="text-[10.5px] cd-text-faint">견적을 클릭하면 PDF 확인·PDF/xlsx 다운로드·재발송(직접 제출 건은 수동 발송)·수주 결과 기입이 가능합니다.</p>
          </>
        ) : loading ? (
          <p className="text-sm cd-text-faint">조회 중입니다.</p>
        ) : (
          <div className="overflow-x-auto min-h-0">
            <table className="w-full text-[12px] whitespace-nowrap">
              <thead>
                <tr className="text-left cd-text-faint text-[11px]">
                  <th className="py-1.5 pr-3 font-semibold">문서번호</th>
                  <th className="py-1.5 pr-3 font-semibold">기안자</th>
                  <th className="py-1.5 pr-3 font-semibold">상신일</th>
                  <th className="py-1.5 pr-3 font-semibold">상태</th>
                  {fields.map((f) => (
                    <th key={f.key} className="py-1.5 pr-3 font-semibold">
                      {f.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.docId} className="border-t cd-border-c cursor-pointer hover:bg-[color:var(--cd-surface)]" onClick={() => setDetailDocId(d.docId)}>
                    <td className="py-2 pr-3 font-mono text-[11px] cd-text-faint">{d.docNo ?? "-"}</td>
                    <td className="py-2 pr-3 cd-text">{d.drafterName ?? "-"}</td>
                    <td className="py-2 pr-3 font-mono text-[11px] cd-text-faint">{short(d.submittedAt)}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={`text-[10.5px] rounded-full px-2 py-0.5 border ${
                          d.status === "approved"
                            ? "border-[color:var(--cd-success,#13DEB9)] text-[color:var(--cd-success,#13DEB9)]"
                            : d.status === "rejected"
                              ? "border-[color:var(--cd-danger,#FA896B)] text-[color:var(--cd-danger,#FA896B)]"
                              : "cd-border-c cd-text-faint"
                        }`}
                      >
                        {DOC_STATUS_LABEL[d.status] ?? d.status}
                      </span>
                    </td>
                    {fields.map((f) => (
                      <td key={f.key} className="py-2 pr-3 cd-text max-w-[260px] overflow-hidden text-ellipsis" title={flatten(f, d.fieldValues[f.key], leaveCatalog)}>
                        {flatten(f, d.fieldValues[f.key], leaveCatalog) || <span className="cd-text-faint">-</span>}
                      </td>
                    ))}
                  </tr>
                ))}
                {docs.length === 0 && (
                  <tr>
                    <td colSpan={4 + fields.length} className="py-6 text-center cd-text-faint text-sm">
                      조회 결과가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {tab === "approval" && (
          <p className="text-[10.5px] cd-text-faint">최근 200건까지 표시됩니다. 행을 클릭하면 문서 원본을 확인할 수 있습니다.</p>
        )}
      </div>

      {detailDocId && <ApprovalDocModal docId={detailDocId} theme={theme} onClose={() => setDetailDocId(null)} onChanged={load} />}
    </div>
  );
}
