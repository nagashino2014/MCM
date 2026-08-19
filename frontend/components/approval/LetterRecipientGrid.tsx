"use client";

// 수신처/참조 인라인 편집 그리드 — 발송공문 목록의 사후 편집(메일주소 보완)과
// 공문 이관 등록 모달이 공용으로 쓴다.

import { Trash2 } from "lucide-react";
import type { LetterRecipient } from "@/lib/letter/types";

/** 수신처/참조 인라인 편집 그리드 — 백필 문서의 메일주소 사후 입력·이관 등록 모달 공용. */
export function RecipientEditGrid({ label, list, onChange }: { label: string; list: LetterRecipient[]; onChange: (next: LetterRecipient[]) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-bold cd-text">{label}</span>
      {list.map((r, i) => (
        <div key={i} className="grid grid-cols-2 md:grid-cols-5 gap-1.5 items-center">
          <input className="cd-input" placeholder="업체/기관" value={r.facilityName ?? ""} onChange={(e) => onChange(list.map((x, xi) => (xi === i ? { ...x, facilityName: e.target.value } : x)))} />
          <input className="cd-input" placeholder="부서" value={r.deptName ?? ""} onChange={(e) => onChange(list.map((x, xi) => (xi === i ? { ...x, deptName: e.target.value } : x)))} />
          <input className="cd-input" placeholder="성명" value={r.name} onChange={(e) => onChange(list.map((x, xi) => (xi === i ? { ...x, name: e.target.value } : x)))} />
          <input className="cd-input" placeholder="직함" value={r.title ?? ""} onChange={(e) => onChange(list.map((x, xi) => (xi === i ? { ...x, title: e.target.value } : x)))} />
          <div className="flex items-center gap-1">
            <input className="cd-input flex-1" placeholder="메일주소" value={r.email ?? ""} onChange={(e) => onChange(list.map((x, xi) => (xi === i ? { ...x, email: e.target.value } : x)))} />
            <button type="button" className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]" onClick={() => onChange(list.filter((_, xi) => xi !== i))}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ))}
      <button type="button" className="cd-btn rounded-lg border border-dashed cd-border-c px-3 py-1.5 text-[11px] cd-text-faint self-start" onClick={() => onChange([...list, { name: "" }])}>
        ＋ 추가
      </button>
    </div>
  );
}
