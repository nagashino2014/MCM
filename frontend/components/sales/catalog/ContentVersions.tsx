"use client";

// 회사소개서 편집 콘텐츠(인사말·조직도) 공용 판 기록 — 확정할 때마다 남은 판 목록과 [불러오기].

import { History } from "lucide-react";
import { CdHelp } from "@/components/cdash/CdHelp";

export interface VersionItem {
  version: number;
  note: string;
  savedAt: string;
  savedByName: string;
}

/** ISO(UTC) 저장 시각 → 보는 사람 시간대의 'YYYY. M. D. HH:mm' */
export function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("ko-KR", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function ContentVersions({
  versions,
  busy,
  helpTopic,
  onRestore,
}: {
  versions: VersionItem[];
  busy: boolean;
  helpTopic: string;
  onRestore: (version: number) => void;
}) {
  const latest = versions[0]?.version ?? null;
  return (
    <section className="cd-card p-4">
      <h3 className="cd-text font-semibold text-base flex items-center gap-1 mb-2">
        <History className="w-4 h-4 cd-text-primary" /> 판 기록 <CdHelp topic={helpTopic} />
      </h3>
      {versions.length === 0 ? (
        <p className="text-sm cd-text-faint">아직 확정한 판이 없습니다.</p>
      ) : (
        <div className="divide-y cd-border-c rounded-lg border cd-border-c">
          {versions.map((v) => (
            <div key={v.version} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="cd-text font-semibold tabular-nums shrink-0">{v.version}판</span>
              {v.version === latest && <span className="cd-pill cd-pill-info shrink-0">소개서에 쓰는 판</span>}
              <span className="flex-1 min-w-0 text-xs cd-text-muted truncate">
                {fmtTime(v.savedAt)}
                {v.savedByName && ` · ${v.savedByName}`}
                {v.note && ` · ${v.note}`}
              </span>
              <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm shrink-0" disabled={busy} onClick={() => onRestore(v.version)}>
                불러오기
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
