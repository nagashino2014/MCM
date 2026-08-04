"use client";

import { ClipboardCheck } from "lucide-react";
import { HomeCard, HomeRow } from "../HomeCard";
import { useHomeWidget } from "../useHomeWidget";

interface PendingDoc {
  docId: string;
  docNo: string | null;
  formName: string;
  folderId?: string | null;
  title: string;
  urgent: boolean;
  drafterName: string | null;
  submittedAt: string | null;
}

const short = (s: string | null) => (s ? s.slice(0, 10) : "-");

// 양식 파트별 색 바(핸드오프 2a) — 인사/업무/회계 3파트, 긴급은 주황 오버라이드.
const FOLDER_BAR: Record<string, string> = {
  "fld-hr": "#6A83EF", // 인사
  "fld-biz": "#5FB6E8", // 업무
  "fld-finance": "#3BAF8E", // 회계
};
const URGENT_BAR = "#E8705F";

/**
 * 결재 대기(홈, G3) — 내 차례인 결재 문서 요약. 클릭 시 결재함 3-pane 의 해당 문서로 딥링크.
 * 행 좌측 세로 색 바로 양식 파트(인사·업무·회계)를 구분하고 긴급은 주황 바 + soft 배지.
 */
export function ApprovalPendingCard() {
  const w = useHomeWidget<{ docs: PendingDoc[] }>("/api/approval/docs?box=pending");
  if (w.status === "forbidden") return null;
  const docs = w.status === "ok" ? w.data.docs : [];

  return (
    <HomeCard
      icon={<ClipboardCheck className="w-4 h-4" />}
      title="내 차례인 결재"
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
              <span
                className="w-1 h-[30px] rounded-[2px] shrink-0"
                style={{ background: d.urgent ? URGENT_BAR : FOLDER_BAR[d.folderId ?? ""] ?? "var(--cd-faint)", opacity: 0.85 }}
              />
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] font-semibold cd-text truncate">
                  {d.urgent && (
                    <span
                      className="text-[10px] font-extrabold rounded-[5px] px-1.5 py-0.5 mr-1.5 align-[1px]"
                      style={{ background: "rgba(232,112,95,0.14)", color: "var(--cd-error)" }}
                    >
                      긴급
                    </span>
                  )}
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
