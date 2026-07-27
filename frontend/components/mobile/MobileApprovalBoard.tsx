"use client";

// 모바일 결재함(/m/approval) — 결재 대기 카드 + 예정/내 기안 탭. 상세는 공용 모달
// (렌더러가 모바일에서 1열로 강하)로 열어 승인/반려까지 처리한다. §8-9 테스트 구현.

import { useCallback, useEffect, useState } from "react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { ApprovalDocModal, DOC_STATUS_LABEL } from "@/components/approval/ApprovalDocModal";
import "@/components/cdash/cdash.css";

interface DocSummary {
  docId: string;
  docNo: string | null;
  formName: string;
  title: string;
  urgent: boolean;
  status: string;
  drafterName: string | null;
  submittedAt: string | null;
  updatedAt: string;
  aiSummary?: { lines: string[]; figures: { label: string; value: string }[]; precedent?: string | null } | null;
}

const TABS = [
  ["pending", "결재 대기"],
  ["upcoming", "예정"],
  ["in_progress", "내 기안"],
] as const;

const short = (s: string | null) => (s ? s.slice(5, 16).replace("T", " ") : "-");

export function MobileApprovalBoard() {
  const { theme } = useCdashTheme();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("pending");
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailDocId, setDetailDocId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/approval/docs?box=${tab}`, { cache: "no-store" });
      const data = await res.json();
      setDocs(res.ok ? (data.docs ?? []) : []);
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-1">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" className="cd-chip cd-chip-sm" data-active={tab === k} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      {loading ? (
        <p className="text-sm cd-text-faint py-6 text-center">불러오는 중입니다.</p>
      ) : docs.length === 0 ? (
        <p className="text-sm cd-text-faint py-6 text-center">문서가 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {docs.map((d) => (
            <button
              key={d.docId}
              type="button"
              className="text-left rounded-2xl border cd-border-c cd-card-bg p-3.5 flex flex-col gap-1 active:bg-[color:var(--cd-surface)]"
              onClick={() => setDetailDocId(d.docId)}
            >
              <div className="flex items-center gap-1.5">
                {d.urgent && (
                  <span className="text-[10px] font-bold rounded-full px-1.5 py-0.5 border border-[color:var(--cd-danger,#FA896B)] text-[color:var(--cd-danger,#FA896B)]">
                    긴급
                  </span>
                )}
                <span className="text-[10px] rounded-full px-1.5 py-0.5 cd-tint-primary">{d.formName}</span>
                <span className="ml-auto text-[10px] cd-text-faint">{DOC_STATUS_LABEL[d.status] ?? d.status}</span>
              </div>
              <p className="text-[13px] font-bold cd-text">{d.title}</p>
              <p className="text-[11px] cd-text-faint">
                {d.drafterName ?? "-"} · {short(d.submittedAt ?? d.updatedAt)}
                {d.docNo ? ` · ${d.docNo}` : ""}
              </p>
              {d.aiSummary && d.aiSummary.lines.length > 0 && (
                <div className="rounded-lg cd-tint-primary px-2.5 py-1.5 flex flex-col gap-0.5 mt-0.5">
                  <span className="text-[9px] font-bold cd-text-primary tracking-wide">AI 요약</span>
                  {d.aiSummary.lines.slice(0, 3).map((l, i) => (
                    <p key={i} className="text-[11px] cd-text leading-tight">· {l}</p>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
      {detailDocId && <ApprovalDocModal docId={detailDocId} theme={theme} onClose={() => setDetailDocId(null)} onChanged={load} />}
    </div>
  );
}
