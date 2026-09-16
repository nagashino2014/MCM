"use client";

// 사내 설문 집계 — 문항별 분포(막대)·척도 평균·자유응답 목록 + CSV 내려받기.
// 익명 설문은 응답자 목록이 비어 오므로(서버에서 차단) 화면에서도 섹션 자체를 숨긴다.

import { useCallback, useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { CdBadge, CdButton, CdEmptyState } from "@/components/cdash";
import type { SurveyResults } from "@/lib/survey/types";

function pct(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
}

/** 집계를 CSV 한 장으로 — 문항·보기·응답수·비율. 엑셀 한글 깨짐 방지로 BOM 을 붙인다. */
function toCsv(r: SurveyResults): string {
  const rows: string[][] = [["문항", "구분", "응답 수", "비율(%)"]];
  for (const s of r.stats) {
    if (s.counts) {
      for (const c of s.counts) rows.push([s.title, c.label, String(c.count), String(pct(c.count, s.answered))]);
    } else if (s.distribution) {
      for (const d of s.distribution) rows.push([s.title, `${d.score}점`, String(d.count), String(pct(d.count, s.answered))]);
      rows.push([s.title, "평균", String(s.average ?? 0), ""]);
    } else if (s.texts) {
      for (const t of s.texts) rows.push([s.title, t, "", ""]);
    }
  }
  return "﻿" + rows.map((row) => row.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\r\n");
}

export function SurveyResultsPanel({ surveyId }: { surveyId: string }) {
  const [results, setResults] = useState<SurveyResults | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/survey/surveys/${surveyId}/results`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "집계를 불러오지 못했습니다.");
        setResults(data.results as SurveyResults);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [surveyId]);

  const download = useCallback(() => {
    if (!results) return;
    const blob = new Blob([toCsv(results)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${results.survey.title}_집계.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [results]);

  if (error) return <div className="rounded-2xl border cd-border-c cd-card-bg p-6 text-sm cd-text">{error}</div>;
  if (!results) {
    return (
      <div className="flex items-center gap-2 py-16 justify-center text-sm cd-text-muted">
        <Loader2 className="w-4 h-4 animate-spin" /> 집계 계산 중…
      </div>
    );
  }
  if (results.responseCount === 0) {
    return <CdEmptyState title="아직 응답이 없습니다" description="응답이 들어오면 문항별 분포와 자유응답이 여기에 모입니다." />;
  }

  const rate = results.targetCount ? pct(results.responseCount, results.targetCount) : null;

  return (
    <div className="flex flex-col gap-5" style={{ maxWidth: 900 }}>
      <div className="rounded-2xl border cd-border-c cd-card-bg p-5 flex flex-wrap items-center gap-6">
        <div>
          <div className="text-xs cd-text-faint">응답</div>
          <div className="text-2xl font-semibold cd-text">{results.responseCount}건</div>
        </div>
        {results.targetCount != null && (
          <div>
            <div className="text-xs cd-text-faint">응답률</div>
            <div className="text-2xl font-semibold cd-text">
              {rate}% <span className="text-sm cd-text-faint">/ 대상 {results.targetCount}명</span>
            </div>
          </div>
        )}
        {results.survey.isAnonymous && <CdBadge tone="idle">익명 설문</CdBadge>}
        <div className="flex-1" />
        <CdButton variant="soft" icon={<Download className="w-4 h-4" />} onClick={download}>
          CSV 내려받기
        </CdButton>
      </div>

      {results.stats.map((s, i) => (
        <div key={s.questionId} className="rounded-2xl border cd-border-c cd-card-bg p-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <h3 className="font-semibold cd-text">
              <span className="cd-text-faint mr-2">{i + 1}.</span>
              {s.title}
            </h3>
            <span className="text-xs cd-text-faint whitespace-nowrap">{s.answered}명 응답</span>
          </div>

          {s.counts && (
            <ul className="flex flex-col gap-2">
              {s.counts.map((c) => (
                <li key={c.value}>
                  <div className="flex items-center justify-between text-sm cd-text mb-1">
                    <span>{c.label}</span>
                    <span className="cd-text-muted">
                      {c.count}명 · {pct(c.count, s.answered)}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full" style={{ background: "var(--cd-border)" }}>
                    <div
                      className="h-2 rounded-full"
                      style={{ width: `${pct(c.count, s.answered)}%`, background: "var(--cd-primary)" }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}

          {s.distribution && (
            <>
              <div className="text-sm cd-text mb-2">
                평균 <strong>{s.average}</strong>점
              </div>
              <ul className="flex flex-col gap-2">
                {s.distribution.map((d) => (
                  <li key={d.score}>
                    <div className="flex items-center justify-between text-sm cd-text mb-1">
                      <span>{d.score}점</span>
                      <span className="cd-text-muted">
                        {d.count}명 · {pct(d.count, s.answered)}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full" style={{ background: "var(--cd-border)" }}>
                      <div
                        className="h-2 rounded-full"
                        style={{ width: `${pct(d.count, s.answered)}%`, background: "var(--cd-primary)" }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          {s.texts && (
            <ul className="flex flex-col gap-2">
              {s.texts.length === 0 ? (
                <li className="text-sm cd-text-faint">응답 없음</li>
              ) : (
                s.texts.map((t, ti) => (
                  <li key={ti} className="rounded-xl border cd-border-c px-4 py-2.5 text-sm cd-text whitespace-pre-wrap">
                    {t}
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      ))}

      {!results.survey.isAnonymous && results.respondents.length > 0 && (
        <div className="rounded-2xl border cd-border-c cd-card-bg p-5">
          <h3 className="font-semibold cd-text mb-3">응답자 ({results.respondents.length}명)</h3>
          <ul className="flex flex-wrap gap-2">
            {results.respondents.map((r) => (
              <li key={r.userId} className="rounded-lg border cd-border-c px-3 py-1.5 text-sm cd-text">
                {r.name}
                {r.deptName && <span className="cd-text-faint ml-1 text-xs">{r.deptName}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
