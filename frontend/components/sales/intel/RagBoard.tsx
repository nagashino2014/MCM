"use client";

// "RAG & 영업 발굴" 스켈레톤(C-1) — D단계(pgvector 벡터 DB + RAG 브리핑)에서 채운다.
// 뉴스 등 후보 미편입 신호를 벡터 DB에 축적하고, 질의형 브리핑(검색→Claude 생성 보고서)과
// 정제된 후보군을 결합한 영업 발굴 화면이 들어올 자리.

import { BookOpenText, Sparkles } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdThemeToggle } from "@/components/cdash/CdThemeToggle";
import "@/components/cdash/cdash.css";

export function RagBoard() {
  const { theme, toggleTheme } = useCdashTheme();

  return (
    <div className="cdash cd-fields-white p-2" data-theme={theme}>
      <CdPageHeader
        icon={<BookOpenText className="w-5 h-5" />}
        eyebrow="SALES & MARKETING"
        title="RAG & 영업 발굴"
        subtitle="수집된 발주 신호와 뉴스 원문을 벡터 DB에 축적해, 질의형 브리핑과 결합한 영업 발굴을 제공할 예정입니다."
        actions={<CdThemeToggle theme={theme} onToggle={toggleTheme} />}
      />

      <section className="cd-card-bg rounded-2xl border cd-border-c p-10 flex flex-col items-center gap-3 text-center">
        <span
          className="inline-flex items-center justify-center w-12 h-12 rounded-2xl"
          style={{ background: "var(--cd-primary-soft)", color: "var(--cd-primary)" }}
        >
          <Sparkles className="w-6 h-6" />
        </span>
        <h2 className="cd-text text-lg font-extrabold">준비 중인 기능입니다</h2>
        <p className="cd-text-muted text-sm max-w-xl leading-relaxed">
          후보로 편입되지 않은 뉴스·신호 전량을 벡터 DB(pgvector)에 축적하고,
          &ldquo;반도체 업종 최근 1년 투자·공장 신설 동향&rdquo; 같은 질의에 답하는
          RAG 브리핑과 영업 발굴 보드가 이 화면에 들어옵니다.
        </p>
        <span className="cd-pill cd-pill-info">D단계 개발 예정</span>
      </section>
    </div>
  );
}
