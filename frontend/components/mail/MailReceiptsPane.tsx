"use client";

// 수신 확인 화면(G2-10) — 내 보낸 메일들의 수신처별 열람 여부·시각.
// 추적 픽셀 기반(그룹웨어 표준) — 이미지 차단 클라이언트는 '미확인'으로 남는다.

import { useCallback, useEffect, useState } from "react";
import { CheckCheck, Loader2, MailCheck, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { CdBadge } from "@/components/cdash/CdBadge";
import { CdEmptyState } from "@/components/cdash/CdEmptyState";
import { CdIconButton } from "@/components/cdash/CdButton";
import type { ReceiptItem } from "@/lib/mail/receipts";
import { fmtListDate } from "@/components/mail/MailListPane";

function fmtFull(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function MailReceiptsPane() {
  const [items, setItems] = useState<ReceiptItem[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/mail/receipts?limit=50");
      if (r.ok) {
        const d = await r.json();
        setItems(Array.isArray(d.items) ? d.items : []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="flex items-center justify-between px-4 py-2.5 border-b cd-border-c">
        <span className="text-sm font-semibold cd-text flex items-center gap-1.5">
          <MailCheck className="w-4 h-4" /> 수신 확인
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[11px] cd-text-faint">수신자가 메일을 열면 확인 시각이 기록됩니다(이미지 차단 시 미확인).</span>
          <CdIconButton label="새로고침" size="sm" onClick={load}>
            <RefreshCw className="w-4 h-4" />
          </CdIconButton>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-10 cd-text-faint">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <CdEmptyState title="보낸 메일이 없습니다." description="메일을 보내면 수신처별 확인 현황이 여기에 표시됩니다." />
        ) : (
          <ul className="divide-y cd-border-c">
            {items.map((m) => {
              const opened = m.recipients.filter((r) => r.openedAt).length;
              return (
                <li key={m.messageId} className="px-4 py-3 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium cd-text truncate">{m.subject || "(제목 없음)"}</span>
                    <span className="text-[11px] cd-text-faint shrink-0">
                      {fmtListDate(m.sentAt ?? m.createdAt)} · 확인 {opened}/{m.recipients.length}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {m.recipients.map((r, i) => (
                      <span
                        key={`${r.address}-${i}`}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs",
                          r.openedAt ? "cd-success-bg cd-success-text border-transparent" : "cd-border-c cd-text-faint"
                        )}
                        title={r.openedAt ? `최초 확인 ${fmtFull(r.openedAt)} · ${r.openCount}회 열람` : "미확인"}
                      >
                        {r.openedAt && <CheckCheck className="w-3 h-3" />}
                        <span className="max-w-[14rem] truncate">{r.address}</span>
                        {r.kind !== "to" && <CdBadge tone="outline">{r.kind === "cc" ? "참조" : "숨은참조"}</CdBadge>}
                        <span>{r.openedAt ? fmtFull(r.openedAt) : "미확인"}</span>
                      </span>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
