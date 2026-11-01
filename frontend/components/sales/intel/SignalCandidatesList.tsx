"use client";

// 수집 신호 후보 — 이전 AI 브리핑 우측 '영업 발굴 후보' 패널을 영업 발굴 탭으로 옮긴 목록.
// 사업장 매칭 + 확정·후보 등급 + 미전환 신호를 보여 주고, 신호 상세에서 영업건으로 전환한다.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CdBadge, useCdashTheme } from "@/components/cdash";
import { INTEL_SIGNAL_GRADE_LABELS, INTEL_SIGNAL_TYPE_LABELS } from "@/lib/intel/signal-extractor";
import type { IntelSignal } from "./intel-shared";
import { RELEVANCE_LABEL } from "./intel-shared";
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
      {error && <div className="intel-card-body"><div className="intel-error" role="alert">{error}</div></div>}
      <p className="intel-table cd-text-muted px-5 pb-3">사업장과 매칭된 확정·후보 등급 신호 중 아직 영업건으로 전환하지 않은 것입니다. 투자 프로젝트로 정리되기 전의 개별 신호를 바로 전환할 때 씁니다.</p>
      {items.length > 0 ? (
        <ul className="intel-rows">
          {items.map((item) => (
            <li key={item.signalId}>
              <button type="button" className="intel-row-item" onClick={() => void open(item.signalId)}>
                <div className="intel-row-main">
                  <p className="intel-row-title">{item.companyName ?? item.facilityName ?? "기업 미확인"}</p>
                  <p className="intel-row-meta">{item.summary ?? item.reportName ?? "요약 없음"}</p>
                  <p className="intel-row-meta">
                    {[
                      INTEL_SIGNAL_TYPE_LABELS[item.signalType as keyof typeof INTEL_SIGNAL_TYPE_LABELS] ?? item.signalType,
                      item.industryRelevance ? `업종 관련 ${RELEVANCE_LABEL[item.industryRelevance] ?? item.industryRelevance}` : null,
                      intelSourceLabel(item.source),
                      item.facilityName ? `사업장 ${item.facilityName}` : null,
                      item.disclosedAt ? intelDate(item.disclosedAt) : null,
                    ].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="intel-row-side">
                  <CdBadge tone={item.signalGrade === "confirmed" ? "success" : "idle"}>
                    {INTEL_SIGNAL_GRADE_LABELS[item.signalGrade as keyof typeof INTEL_SIGNAL_GRADE_LABELS] ?? item.signalGrade}
                  </CdBadge>
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="intel-empty">{loading ? "불러오는 중…" : "전환할 수집 신호 후보가 없습니다."}</p>
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
