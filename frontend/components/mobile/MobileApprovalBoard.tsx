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

/** 데스크톱 결재함(ApprovalHomeBoard)과 동일한 상태 점 색. */
const STATUS_DOT: Record<string, string> = {
  approved: "var(--cd-success)",
  rejected: "var(--cd-error)",
  in_progress: "var(--cd-primary)",
  pending: "var(--cd-primary)",
  draft: "var(--cd-faint)",
  canceled: "var(--cd-faint)",
};

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
            // 행 위계는 데스크톱 결재함과 동일 — 상태 색 점 1개 + 긴급 배지만, 제목 우선.
            // 카드에서 바로 승인/반려하지 않고 탭하면 상세(모달)에서 내용 확인 후 처리한다.
            <button
              key={d.docId}
              type="button"
              className="text-left cd-card p-3.5 gap-1 active:bg-[color:var(--cd-hover)]"
              style={{ minHeight: 56 }}
              onClick={() => setDetailDocId(d.docId)}
              title={DOC_STATUS_LABEL[d.status] ?? d.status}
            >
              <p className="text-[13.5px] font-bold cd-text leading-[1.4]">
                <span
                  className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
                  style={{ background: STATUS_DOT[d.status] ?? "var(--cd-faint)" }}
                  aria-hidden
                />
                {d.urgent && (
                  <span className="text-[10px] font-extrabold rounded-[5px] px-1.5 py-0.5 mr-1.5 cd-error-bg cd-error-text align-[1px]">
                    긴급
                  </span>
                )}
                {d.title}
              </p>
              <p className="text-[11.5px]" style={{ color: "var(--cd-faint)" }}>
                {d.formName} · {d.drafterName ?? "-"} · {short(d.submittedAt ?? d.updatedAt)}
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
