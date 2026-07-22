"use client";

// ★양식별 문서 조회(/approval/records, admin) — 양식의 모든 필드가 컬럼으로 펼쳐지는
// 데이터 테이블. 다우오피스에서 불가능했던 "문서 속 데이터의 분류·정렬·발췌"가 목적.
// CSV 내보내기(BOM — 엑셀 호환). 행 클릭 = 문서 상세 모달.
// 설계: docs/e-approval-blueprint.md §5-6.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Search, Table2 } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { ApprovalDocModal, DOC_STATUS_LABEL } from "@/components/approval/ApprovalDocModal";
import type { ApprovalFieldDef } from "@/lib/approval/fields";
import { findInCatalog, type LeaveTypeItem } from "@/lib/approval/leave-types";
import "@/components/cdash/cdash.css";

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
  const [forms, setForms] = useState<FormRow[]>([]);
  const [formId, setFormId] = useState("");
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [fields, setFields] = useState<ApprovalFieldDef[]>([]);
  const [docs, setDocs] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailDocId, setDetailDocId] = useState<string | null>(null);
  const [leaveCatalog, setLeaveCatalog] = useState<LeaveTypeItem[]>([]);

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
      if (from) params.set("from", from);
      if (to) params.set("to", to);
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
  }, [formId, status, from, to, q]);
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId, status]);

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
        <div className="flex items-center gap-2 flex-wrap">
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
          <input type="date" className="cd-input" style={{ width: 140 }} value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="cd-text-faint text-xs">~</span>
          <input type="date" className="cd-input" style={{ width: 140 }} value={to} onChange={(e) => setTo(e.target.value)} />
          <div className="flex items-center gap-1.5">
            <input
              className="cd-input"
              style={{ width: 180 }}
              placeholder="제목·기안자 검색"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load()}
            />
            <button type="button" className="cd-btn rounded-lg border cd-border-c px-2.5 py-2" title="조회" onClick={load}>
              <Search className="w-3.5 h-3.5" />
            </button>
          </div>
          <button
            type="button"
            className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs flex items-center gap-1.5 ml-auto disabled:opacity-50"
            disabled={!docs.length}
            onClick={download}
          >
            <Download className="w-3.5 h-3.5" /> CSV 내보내기
          </button>
        </div>

        {loading ? (
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
        <p className="text-[10.5px] cd-text-faint">최근 200건까지 표시됩니다. 행을 클릭하면 문서 원본을 확인할 수 있습니다.</p>
      </div>

      {detailDocId && <ApprovalDocModal docId={detailDocId} theme={theme} onClose={() => setDetailDocId(null)} onChanged={load} />}
    </div>
  );
}
