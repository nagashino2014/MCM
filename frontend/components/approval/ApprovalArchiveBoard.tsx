"use client";

// 문서함(/approval/archive) — 내 기안 완료 / 내가 결재한 문서 / 부서 문서함 / 전사 문서함.
// 물리 폴더가 아닌 저장 뷰(쿼리). 보존연한(완료일+연한)과 만료 경과를 표시한다.
// '전자결재'/'발송공문' 최상위 탭(135) + 양식별 문서 조회와 동일한 검색 옵션(연도·YYYYMM·검색어).
// 설계: docs/e-approval-blueprint.md §5-4·§8-8, docs/official-letter-blueprint.md.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, FolderOpen, Search } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { ApprovalDocModal, DOC_STATUS_LABEL } from "@/components/approval/ApprovalDocModal";
import { LetterRecordsTable } from "@/components/approval/LetterRecordsTable";
import { QuoteRecordsTable } from "@/components/approval/QuoteRecordsTable";
import type { OfficialLetterRow } from "@/lib/letter/types";
import type { QuotationRow } from "@/lib/quote/types";
import "@/components/cdash/cdash.css";

type TopTab = "approval" | "letters" | "quotes";

/** YYYYMM → 비교용 YYYY-MM (형식 아니면 null). */
function ymKey(ym: string): string | null {
  const m = /^(\d{4})(\d{2})$/.exec(ym.trim());
  return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${m[1]}-${m[2]}` : null;
}

interface ArchiveRow {
  docId: string;
  docNo: string | null;
  formName: string;
  title: string;
  urgent: boolean;
  status: string;
  drafterName: string | null;
  deptName: string | null;
  completedAt: string | null;
  updatedAt: string;
  retentionYears?: number | null;
  watchKind?: string;
  unread?: boolean;
}

const TABS = [
  ["mine", "내 기안 완료"],
  ["acted", "내가 결재한 문서"],
  ["watched", "참조·열람"],
  ["dept", "부서 문서함"],
  ["org", "전사 문서함"],
] as const;

const short = (s: string | null) => (s ? s.slice(0, 10) : "-");

function expiryOf(row: ArchiveRow): { text: string; expired: boolean } | null {
  if (!row.retentionYears || !row.completedAt) return null;
  const d = new Date(row.completedAt);
  d.setFullYear(d.getFullYear() + row.retentionYears);
  const text = d.toISOString().slice(0, 10);
  return { text, expired: text < new Date().toISOString().slice(0, 10) };
}

export function ApprovalArchiveBoard() {
  const { theme } = useCdashTheme();
  const [topTab, setTopTab] = useState<TopTab>("approval");
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("mine");
  const [folders, setFolders] = useState<string[]>([]);
  const [folder, setFolder] = useState<string | null>(null);
  const [docs, setDocs] = useState<ArchiveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailDocId, setDetailDocId] = useState<string | null>(null);
  // 검색 옵션(양식별 문서 조회와 동일) — 연도 select + YYYYMM 2개 + 제목·기안자 검색
  const [fromYm, setFromYm] = useState("");
  const [toYm, setToYm] = useState("");
  const [yearSel, setYearSel] = useState("");
  const [q, setQ] = useState("");
  // 발송공문 탭
  const [letters, setLetters] = useState<OfficialLetterRow[]>([]);
  const [lettersLoading, setLettersLoading] = useState(false);
  // 발송견적 탭(136)
  const [quotes, setQuotes] = useState<QuotationRow[]>([]);
  const [quotesLoading, setQuotesLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ tab });
      if (tab === "org" && folder) params.set("folder", folder);
      const res = await fetch(`/api/approval/archive?${params.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "문서함을 불러오지 못했습니다.");
      setDocs(data.docs ?? []);
      if (tab === "org") {
        setFolders(data.folders ?? []);
        if (!folder && data.folder) setFolder(data.folder);
      }
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, [tab, folder]);
  useEffect(() => {
    load();
  }, [load]);

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
    } catch {
      setLetters([]);
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
    } catch {
      setQuotes([]);
    } finally {
      setQuotesLoading(false);
    }
  }, [fromYm, toYm, q]);
  useEffect(() => {
    if (topTab === "letters") void loadLetters();
    else if (topTab === "quotes") void loadQuotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topTab]);

  const applyYear = (year: string) => {
    setYearSel(year);
    if (!year) return;
    setFromYm(`${year}01`);
    setToYm(`${year}12`);
  };

  // 전자결재 탭 검색 — 로드된 목록에 클라이언트 필터(제목·기안자 + 완료/갱신일 YYYYMM 범위)
  const filteredDocs = useMemo(() => {
    const fromKey = ymKey(fromYm);
    const toKey = ymKey(toYm);
    const kw = q.trim();
    return docs.filter((d) => {
      const dateKey = (d.completedAt ?? d.updatedAt ?? "").slice(0, 7);
      if (fromKey && dateKey && dateKey < fromKey) return false;
      if (toKey && dateKey && dateKey > toKey) return false;
      if (kw && !`${d.title} ${d.drafterName ?? ""} ${d.docNo ?? ""}`.includes(kw)) return false;
      return true;
    });
  }, [docs, fromYm, toYm, q]);

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<Archive className="w-5 h-5" />}
        eyebrow="Approval · Archive"
        title="문서함"
        subtitle="완료된 결재 문서를 개인·부서·전사 범위로 조회합니다. 보존연한이 지난 문서는 만료로 표시됩니다."
      />

      <div className="cd-card rounded-3xl p-5 flex flex-col gap-4">
        {/* 전자결재 / 발송공문 탭 — 양식별 문서 조회와 동일한 work-plan 탭 양식 */}
        <div className="flex items-end gap-1 px-1 -mb-1">
          {(["approval", "letters", "quotes"] as TopTab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTopTab(t)}
              className={`rounded-t-xl px-4 py-2 text-sm font-semibold border-b-2 ${
                topTab === t ? "cd-text-primary border-current cd-tint-primary" : "cd-text-faint border-transparent cd-row-hover"
              }`}
            >
              {t === "approval" ? "전자결재" : t === "letters" ? "발송공문" : "발송견적"}
            </button>
          ))}
        </div>

        {/* 검색 옵션(공용) — 연도 선택 + YYYYMM 2개 + 제목·기안자 검색 */}
        <div className="flex items-center gap-2 flex-wrap">
          {topTab === "approval" && (
            <div className="flex items-center gap-1 flex-wrap mr-1">
              {TABS.map(([k, l]) => (
                <button key={k} type="button" className="cd-chip cd-chip-sm" data-active={tab === k} onClick={() => setTab(k)}>
                  {l}
                </button>
              ))}
            </div>
          )}
          <select className="cd-select" style={{ width: 110 }} value={yearSel} onChange={(e) => applyYear(e.target.value)} title="연도 선택 — 해당 연도 전체 기간을 자동 설정">
            <option value="">연도 선택</option>
            {Array.from({ length: 8 }, (_, i) => String(new Date().getFullYear() - i)).map((y) => (
              <option key={y} value={y}>{y}년</option>
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
            onKeyDown={(e) => e.key === "Enter" && (topTab === "letters" ? loadLetters() : topTab === "quotes" ? loadQuotes() : undefined)}
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
            onKeyDown={(e) => e.key === "Enter" && (topTab === "letters" ? loadLetters() : topTab === "quotes" ? loadQuotes() : undefined)}
          />
          <div className="flex items-center gap-1.5">
            <input
              className="cd-input"
              style={{ width: 180 }}
              placeholder={topTab === "letters" ? "제목·공문번호·기안자 검색" : "제목·기안자·문서번호 검색"}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (topTab === "letters" ? loadLetters() : topTab === "quotes" ? loadQuotes() : undefined)}
            />
            {topTab !== "approval" && (
              <button type="button" className="cd-btn rounded-lg border cd-border-c px-2.5 py-2" title="조회" onClick={topTab === "letters" ? loadLetters : loadQuotes}>
                <Search className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {topTab === "approval" && tab === "org" && (
            <div className="ml-auto flex items-center gap-1.5">
              <FolderOpen className="w-3.5 h-3.5 cd-text-faint" />
              {folders.map((f) => (
                <button key={f} type="button" className="cd-chip cd-chip-sm" data-active={folder === f} onClick={() => setFolder(f)}>
                  {f}
                </button>
              ))}
            </div>
          )}
        </div>

        {topTab === "letters" ? (
          <>
            <LetterRecordsTable letters={letters} loading={lettersLoading} theme={theme} onChanged={loadLetters} />
            <p className="text-[10.5px] cd-text-faint">공문을 클릭하면 PDF 원문 확인·PDF/한글 다운로드·재발송·수신처 편집이 가능합니다.</p>
          </>
        ) : topTab === "quotes" ? (
          <>
            <QuoteRecordsTable quotes={quotes} loading={quotesLoading} theme={theme} onChanged={loadQuotes} />
            <p className="text-[10.5px] cd-text-faint">견적을 클릭하면 PDF 확인·PDF/xlsx 다운로드·재발송·수주 결과 기입이 가능합니다.</p>
          </>
        ) : loading ? (
          <p className="text-sm cd-text-faint">불러오는 중입니다.</p>
        ) : filteredDocs.length === 0 ? (
          <p className="text-sm cd-text-faint">문서가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left cd-text-faint text-[11px]">
                  <th className="py-1.5 pr-3 font-semibold">문서번호</th>
                  <th className="py-1.5 pr-3 font-semibold">양식</th>
                  <th className="py-1.5 pr-3 font-semibold">제목</th>
                  <th className="py-1.5 pr-3 font-semibold">기안자</th>
                  <th className="py-1.5 pr-3 font-semibold">상태</th>
                  <th className="py-1.5 pr-3 font-semibold">완료일</th>
                  <th className="py-1.5 font-semibold">보존만료</th>
                </tr>
              </thead>
              <tbody>
                {filteredDocs.map((d) => {
                  const exp = expiryOf(d);
                  return (
                    <tr key={d.docId} className="border-t cd-border-c cursor-pointer hover:bg-[color:var(--cd-surface)]" onClick={() => setDetailDocId(d.docId)}>
                      <td className="py-2 pr-3 font-mono text-[11px] cd-text-faint">{d.docNo ?? "-"}</td>
                      <td className="py-2 pr-3 cd-text-faint">{d.formName}</td>
                      <td className="py-2 pr-3 cd-text">
                        {tab === "watched" && d.unread && (
                          <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle" style={{ background: "var(--cd-primary)" }} title="안 읽음" />
                        )}
                        {d.title}
                        {tab === "watched" && d.watchKind && (
                          <span className="ml-1.5 text-[10px] cd-text-faint">{d.watchKind === "view" ? "(열람)" : "(참조)"}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 cd-text-faint">{d.drafterName ?? "-"}</td>
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
                      <td className="py-2 pr-3 font-mono text-[11px] cd-text-faint">{short(d.completedAt)}</td>
                      <td className="py-2 font-mono text-[11px]">
                        {exp ? (
                          <span className={exp.expired ? "text-[color:var(--cd-danger,#FA896B)] font-bold" : "cd-text-faint"}>
                            {exp.text}
                            {exp.expired ? " (만료)" : ""}
                          </span>
                        ) : (
                          <span className="cd-text-faint">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detailDocId && <ApprovalDocModal docId={detailDocId} theme={theme} onClose={() => setDetailDocId(null)} onChanged={load} />}
    </div>
  );
}
