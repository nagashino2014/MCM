"use client";

// 상단바 "매뉴얼" 버튼 — [새로 작성] 바로 오른쪽(blueprint §1.1). 보지 않은 변경 기록이 있으면 점을 표시한다.

import { BookOpen } from "lucide-react";
import { useManual } from "./ManualContext";

export function ManualButton() {
  const manual = useManual();
  if (!manual) return null;
  return (
    <button
      type="button"
      onClick={() => manual.open()}
      className="cd-btn cd-btn-ghost relative inline-flex shrink-0 items-center gap-1.5"
      aria-label={manual.hasUnseen ? "사용 매뉴얼 (새 소식 있음, F1)" : "사용 매뉴얼 (F1)"}
      aria-haspopup="dialog"
      aria-expanded={manual.isOpen}
      title="사용 매뉴얼 (F1)"
    >
      <BookOpen className="h-4 w-4" aria-hidden="true" />
      <span className="hidden sm:inline">매뉴얼</span>
      {manual.hasUnseen && (
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full" style={{ background: "var(--cd-primary)" }} aria-hidden="true" />
      )}
    </button>
  );
}
