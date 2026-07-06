"use client";

import { Radar } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdThemeToggle } from "@/components/cdash/CdThemeToggle";
import "@/components/cdash/cdash.css";

export default function SalesIntelPage() {
  const { theme, toggleTheme } = useCdashTheme();
  return (
    <div className="cdash cd-fields-white p-2" data-theme={theme}>
      <CdPageHeader
        icon={<Radar className="w-5 h-5" />}
        eyebrow="SALES & MARKETING"
        title="API & RAG"
        subtitle="공시·뉴스 수집을 벡터화하여 대상 사업장의 투자·증설·신설 신호를 자동 고지합니다."
        actions={<CdThemeToggle theme={theme} onToggle={toggleTheme} />}
      />
      <div className="cd-card-bg rounded-2xl border cd-border-c p-10 text-center cd-text-faint text-sm">
        준비 중입니다.
      </div>
    </div>
  );
}
