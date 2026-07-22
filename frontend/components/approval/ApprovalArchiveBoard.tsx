"use client";

// 문서함(/approval/archive) — 내 기안 완료 / 내가 결재한 문서 / 부서 문서함 / 전사 문서함.
// 물리 폴더가 아닌 저장 뷰(쿼리). 보존연한(완료일+연한)과 만료 경과를 표시한다.
// 설계: docs/e-approval-blueprint.md §5-4·§8-8.

import { useCallback, useEffect, useState } from "react";
import { Archive, FolderOpen } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { ApprovalDocModal, DOC_STATUS_LABEL } from "@/components/approval/ApprovalDocModal";
import "@/components/cdash/cdash.css";

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
}

const TABS = [
  ["mine", "내 기안 완료"],
  ["acted", "내가 결재한 문서"],
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
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("mine");
  const [folders, setFolders] = useState<string[]>([]);
  const [folder, setFolder] = useState<string | null>(null);
  const [docs, setDocs] = useState<ArchiveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailDocId, setDetailDocId] = useState<string | null>(null);

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

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<Archive className="w-5 h-5" />}
        eyebrow="Approval · Archive"
        title="문서함"
        subtitle="완료된 결재 문서를 개인·부서·전사 범위로 조회합니다. 보존연한이 지난 문서는 만료로 표시됩니다."
      />

      <div className="cd-card rounded-3xl p-5 flex flex-col gap-4">
        <div className="flex items-center gap-1 flex-wrap">
          {TABS.map(([k, l]) => (
            <button key={k} type="button" className="cd-chip cd-chip-sm" data-active={tab === k} onClick={() => setTab(k)}>
              {l}
            </button>
          ))}
          {tab === "org" && (
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

        {loading ? (
          <p className="text-sm cd-text-faint">불러오는 중입니다.</p>
        ) : docs.length === 0 ? (
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
                {docs.map((d) => {
                  const exp = expiryOf(d);
                  return (
                    <tr key={d.docId} className="border-t cd-border-c cursor-pointer hover:bg-[color:var(--cd-surface)]" onClick={() => setDetailDocId(d.docId)}>
                      <td className="py-2 pr-3 font-mono text-[11px] cd-text-faint">{d.docNo ?? "-"}</td>
                      <td className="py-2 pr-3 cd-text-faint">{d.formName}</td>
                      <td className="py-2 pr-3 cd-text">{d.title}</td>
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
