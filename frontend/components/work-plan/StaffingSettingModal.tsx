"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { UserCog, X } from "lucide-react";
import StaffingPanel from "@/components/staffing/StaffingPanel";

export default function StaffingSettingModal({
  contractId,
  participantsUrl,
  roleOptions,
  theme,
  onClose,
}: {
  contractId: string;
  participantsUrl?: string;
  roleOptions?: string[];
  theme: "light" | "dark";
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div className="cdash-vars cd-fields-white fixed inset-0 z-[95] flex items-center justify-center p-4" data-theme={theme}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative cd-card-bg border cd-border-c rounded-3xl w-full max-w-5xl max-h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b cd-border-c">
          <h2 className="font-bold cd-text inline-flex items-center gap-2">
            <UserCog className="w-4 h-4 cd-text-primary" /> 수행인력 설정
          </h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg cd-text-faint hover:cd-text" aria-label="닫기">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          <StaffingPanel contractId={contractId} participantsUrl={participantsUrl} roleOptions={roleOptions} />
        </div>
      </div>
    </div>,
    document.body
  );
}
