"use client";

// 담당자 추가 이메일 입력(376, 2026-11-20 직원 요청 29) — 등록·수정 창 공용.
// 대표 이메일 칸 아래에 붙여, 회사 메일·개인 메일처럼 주소가 여러 개인 사람의 나머지 주소를 한 창에서 넣는다.

import { Plus, X } from "lucide-react";
import { EXTRA_EMAIL_LIMIT } from "@/lib/directory-emails";

export function ExtraEmailsField({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      {value.length > 0 && <span className="cd-label-text">추가 이메일</span>}
      {value.map((v, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            className="cd-input flex-1"
            value={v}
            placeholder="예: 개인 메일 주소"
            aria-label={`추가 이메일 ${i + 1}`}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <button
            type="button"
            className="p-1.5 rounded-md cd-text-faint hover:cd-error-text shrink-0"
            title="이 주소 지우기"
            aria-label={`추가 이메일 ${i + 1} 지우기`}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      {value.length < EXTRA_EMAIL_LIMIT && (
        <button
          type="button"
          className="self-start text-[12px] cd-text-primary flex items-center gap-1"
          onClick={() => onChange([...value, ""])}
        >
          <Plus className="w-3.5 h-3.5" /> 이메일 추가
        </button>
      )}
    </div>
  );
}
