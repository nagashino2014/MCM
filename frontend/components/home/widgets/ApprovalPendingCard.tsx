"use client";

import { ClipboardCheck } from "lucide-react";
import { HomeCard, HomeRow } from "../HomeCard";
import { useHomeWidget } from "../useHomeWidget";

interface PendingDoc {
  docId: string;
  docNo: string | null;
  formName: string;
  title: string;
  urgent: boolean;
  drafterName: string | null;
  submittedAt: string | null;
}

const short = (s: string | null) => (s ? s.slice(0, 10) : "-");

/**
 * 결재 대기(홈, G3) — 내 차례인 결재 문서 요약. 클릭 시 결재함 3-pane 의 해당 문서로 딥링크.
 * 협업 3종 요약(미결재·안읽은 메일·오늘 일정)의 하나로 홈 상단에 노출한다.
 */
export function ApprovalPendingCard() {
  const w = useHomeWidget<{ docs: PendingDoc[] }>("/api/approval/docs?box=pending");
  if (w.status === "forbidden") return null;
  const docs = w.status === "ok" ? w.data.docs : [];

  return (
    <HomeCard
      icon={<ClipboardCheck className="w-4 h-4" />}
      title="결재 대기"
      count={docs.length}
      href="/approval"
      loading={w.status === "loading"}
      error={w.status === "error" ? w.message : undefined}
      empty={docs.length === 0}
      emptyText="대기 중인 결재가 없습니다."
    >
      <ul className="flex flex-col gap-1.5">
        {docs.slice(0, 5).map((d) => (
          <li key={d.docId}>
            <HomeRow href={`/approval?docId=${encodeURIComponent(d.docId)}`}>
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] font-semibold cd-text truncate">
                  {d.urgent && <span className="text-[10px] text-[color:var(--cd-danger,#FA896B)] font-bold mr-1">[긴급]</span>}
                  {d.title}
                </span>
                <span className="block text-[11px] cd-text-faint truncate">
                  {d.formName} · {d.drafterName ?? "-"} · {short(d.submittedAt)}
                </span>
              </span>
            </HomeRow>
          </li>
        ))}
        {docs.length > 5 && (
          <li className="text-[11px] cd-text-faint text-center pt-0.5">외 {docs.length - 5}건 — 전자결재에서 확인</li>
        )}
      </ul>
    </HomeCard>
  );
}
