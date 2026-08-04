"use client";

// 주 12시간 초과 상신 시 — 특별휴가(보상휴가) 전환 동의 팝업(전자서명).
// 문구는 lib/approval/overtime-consent.ts(사용자 확정본)와 공용. 체크 후 [동의 및 전자서명]을
// 눌러야 상신이 이어지며, 동의 이력은 field_values._overtime_consent 로 문서에 남는다(서버도 강제).

import { useEffect, useState } from "react";
import { PenLine, X } from "lucide-react";
import {
  buildConsentSections,
  CONSENT_FOOTER,
  CONSENT_VERSION,
  type OvertimeConsent,
} from "@/lib/approval/overtime-consent";

export function OvertimeConsentModal({
  open,
  weekStart,
  weekEnd,
  totalMinutes,
  excessMinutes,
  limitMinutes,
  onAgree,
  onClose,
}: {
  open: boolean;
  weekStart: string;
  weekEnd: string;
  totalMinutes: number;
  excessMinutes: number;
  limitMinutes: number;
  onAgree: (consent: OvertimeConsent) => void;
  onClose: () => void;
}) {
  const [checked, setChecked] = useState(false);
  const [signerName, setSignerName] = useState("");

  // 서명자 성명 — 세션 사용자명(문서 기안자 본인).
  useEffect(() => {
    if (!open) return;
    setChecked(false);
    let alive = true;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d?.user?.name) setSignerName(String(d.user.name));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open]);

  if (!open) return null;
  const sections = buildConsentSections({ weekStart, weekEnd, totalMinutes, excessMinutes, limitMinutes });
  const now = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  const nowLabel = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())} ${p2(now.getHours())}:${p2(now.getMinutes())}`;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" style={{ background: "rgba(23,28,44,0.42)" }}>
      <div
        className="w-full max-w-[560px] max-h-[88vh] overflow-y-auto rounded-2xl p-6 flex flex-col gap-4"
        style={{ background: "var(--cd-card-solid)", boxShadow: "var(--cd-shadow-hover)" }}
      >
        <div className="flex items-start gap-2">
          <h2 className="text-[16px] font-extrabold cd-text leading-snug">
            연장근로(주 12시간 초과) 및 보상휴가 전환 동의서
          </h2>
          <button type="button" className="ml-auto cd-text-faint hover:text-[color:var(--cd-text)]" aria-label="닫기" onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-[12.5px] cd-text-body">본인은 아래 초과근무 신청과 관련하여 다음 사항을 확인하고 동의합니다.</p>

        <div className="flex flex-col gap-3">
          {sections.map((s) => (
            <div key={s.heading}>
              <p className="text-[12.5px] font-bold cd-text mb-1">{s.heading}</p>
              <p className="text-[12.5px] cd-text-body leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>

        <p className="text-[11.5px] cd-text-faint">{CONSENT_FOOTER}</p>

        <div className="rounded-xl border cd-border-c p-3.5 flex flex-col gap-2.5">
          <label className="flex items-start gap-2 text-[12.5px] cd-text cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            위 내용을 모두 확인하였으며, 자유로운 의사에 따라 동의합니다.
          </label>
          <div className="flex items-center gap-2 text-[12px] cd-text-faint">
            <span>
              서명자: <b className="cd-text">{signerName || "기안자 본인"}</b> · 동의 일시: {nowLabel}
            </span>
            <button
              type="button"
              disabled={!checked}
              onClick={() =>
                onAgree({
                  version: CONSENT_VERSION,
                  agreedAt: new Date().toISOString(),
                  signerName: signerName || "기안자 본인",
                  weekStart,
                  totalMinutes,
                  excessMinutes,
                })
              }
              className="ml-auto cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40"
            >
              <PenLine className="w-3.5 h-3.5" /> 동의 및 전자서명
            </button>
          </div>
        </div>

        <p className="text-[10.5px] cd-text-faint">
          동의하지 않으면 상신할 수 없습니다. 신청 시간을 조정해 주 한도(12시간) 이내로 변경하면 동의 없이 상신할 수 있습니다.
        </p>
      </div>
    </div>
  );
}
