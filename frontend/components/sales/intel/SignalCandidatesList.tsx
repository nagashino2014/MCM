"use client";

// 수집 신호 후보 — 이전 AI 브리핑 우측 '영업 발굴 후보' 패널을 영업 발굴 탭으로 옮긴 목록.
// 사업장 매칭 + 확정·후보 등급 + 미전환 신호를 보여 주고, 신호 상세에서 영업건으로 전환한다.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCdashTheme } from "@/components/cdash";
import type { IntelSignal } from "./intel-shared";
import { GradeTag, RelevanceTag, TypeTag } from "./intel-shared";
import { IntelEmpty, IntelError, IntelTile } from "./intel-ui-kit";
import { IntelSignalModal } from "./IntelSignalModal";
import { intelApi, intelDate, intelSourceLabel } from "./intelligence-client";

interface DiscoveryCandidate {
  signalId: string; source: string; companyName: string | null; reportName: string | null;
  signalType: string; signalGrade: string; disclosedAt: string | null; facilityName: string | null;
  summary: string | null; industry: string | null; industryRelevance: string | null; relevanceNote: string | null;
}

export function SignalCandidatesList({ canEdit, onCount }: { canEdit: boolean; onCount?: (count: number) => void }) {
  const router = useRouter();
  const { theme } = useCdashTheme();
  const [items, setItems] = useState<DiscoveryCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<IntelSignal | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await intelApi<{ candidates?: DiscoveryCandidate[] }>("/api/sales/rag/discovery");
      const list = Array.isArray(data.candidates) ? data.candidates : [];
      setItems(list); onCount?.(list.length); setError("");
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, [onCount]);
  useEffect(() => { void reload(); }, [reload]);

  async function open(signalId: string) {
    try { setSelected((await intelApi<{ signal: IntelSignal }>(`/api/sales/intel/signals/${encodeURIComponent(signalId)}`)).signal); }
    catch (e) { setError(`신호를 불러오지 못했습니다: ${(e as Error).message}`); }
  }

  return (
    <>
      {error && <div className="mb-2"><IntelError>{error}</IntelError></div>}
      {items.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {items.map((item) => (
            <IntelTile key={item.signalId} onClick={() => void open(item.signalId)}>
              <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                <span className="cd-text text-sm font-bold truncate">{item.companyName ?? item.facilityName ?? "기업 미확인"}</span>
                <TypeTag type={item.signalType} />
                <GradeTag grade={item.signalGrade} />
                <RelevanceTag relevance={item.industryRelevance} note={item.relevanceNote} />
                <span className="cd-pill cd-pill-outline">{intelSourceLabel(item.source)}</span>
              </div>
              <p className="cd-text-muted text-[11px] truncate mt-1">{item.summary ?? item.reportName ?? "—"}</p>
              {item.industryRelevance === "supply_chain" && item.relevanceNote && <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: "var(--cd-primary)" }}>↳ {item.relevanceNote}</p>}
              <p className="cd-text-faint text-[11px] mt-0.5">{[item.facilityName ? `사업장 ${item.facilityName}` : null, item.disclosedAt ? intelDate(item.disclosedAt) : null].filter(Boolean).join(" · ")}</p>
            </IntelTile>
          ))}
        </div>
      ) : (
        <IntelEmpty>{loading ? "불러오는 중…" : "전환할 수집 신호 후보가 없습니다."}</IntelEmpty>
      )}
      {selected && (
        <IntelSignalModal
          theme={theme}
          signal={selected}
          canEdit={canEdit}
          onClose={() => setSelected(null)}
          onChanged={() => void reload()}
          onConverted={(projectId) => router.push(`/sales/${projectId}`)}
        />
      )}
    </>
  );
}
