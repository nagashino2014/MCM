"use client";

import { Users } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdThemeToggle } from "@/components/cdash/CdThemeToggle";
import "@/components/cdash/cdash.css";

export default function SalesContactsPage() {
  const { theme, toggleTheme } = useCdashTheme();
  return (
    <div className="cdash cd-fields-white p-2" data-theme={theme}>
      <CdPageHeader
        icon={<Users className="w-5 h-5" />}
        eyebrow="SALES & MARKETING"
        title="담당자 정보 관리"
        subtitle="사업장 담당자를 전사 횡단으로 조회하고, 명함 OCR·통합 타임라인으로 관리합니다."
        actions={<CdThemeToggle theme={theme} onToggle={toggleTheme} />}
      />
      <div className="cd-card-bg rounded-2xl border cd-border-c p-10 text-center cd-text-faint text-sm">
        준비 중입니다.
      </div>
    </div>
  );
}
