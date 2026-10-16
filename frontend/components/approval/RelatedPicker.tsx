"use client";

// 연관 용역/사업장 선택(2026-10-16) — 지출 내역 표·법인카드 불러오기·영수증 직접 첨부가 함께 쓴다.
// 용역(계약)을 우선 보여 주고, 계약 전 영업 출장처럼 용역이 없으면 사업장을 고른다.
// 표 안 팝오버는 가로 스크롤 영역에 잘려 공통 모달로 띄운다.

import { useEffect, useState } from "react";
import { Building2, FileText, Link2, Loader2, Search, X } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";
import type { RelatedRef } from "@/lib/approval/expense-purpose";

interface ContractHit {
  contractId: string;
  title: string;
  contractDate: string | null;
  facilityId: string | null;
  facilityName: string | null;
  counterpartyName: string | null;
}
interface FacilityHit {
  facilityId: string;
  name: string;
  region: string;
}

export function RelatedPickerModal({
  open,
  onClose,
  onPick,
  current,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (ref: RelatedRef | null) => void;
  current?: string;
}) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [contracts, setContracts] = useState<ContractHit[]>([]);
  const [facilities, setFacilities] = useState<FacilityHit[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/approval/related-search?q=${encodeURIComponent(q.trim())}&limit=15`, { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as { contracts?: ContractHit[]; facilities?: FacilityHit[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? "검색 실패");
        if (!alive) return;
        setContracts(data.contracts ?? []);
        setFacilities(data.facilities ?? []);
      } catch (err) {
        if (alive) setError((err as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [open, q]);

  useEffect(() => {
    if (open) setQ("");
  }, [open]);

  const pick = (ref: RelatedRef | null) => {
    onPick(ref);
    onClose();
  };

  return (
    <CdModal open={open} onClose={onClose} title="연관 용역/사업장 선택" size="lg">
      <div className="grid gap-3">
        <label className="flex items-center gap-2 rounded-lg border cd-border-c px-3 py-2">
          <Search className="w-4 h-4 cd-text-faint shrink-0" />
          <input
            autoFocus
            className="w-full bg-transparent text-sm cd-text outline-none"
            placeholder="용역명 또는 업체·사업장 이름"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {loading && <Loader2 className="w-4 h-4 animate-spin cd-text-faint shrink-0" />}
        </label>
        {current && (
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="cd-text-muted truncate">현재: {current}</span>
            <button type="button" className="cd-btn cd-btn-ghost px-2 py-1 text-xs cd-text-muted inline-flex items-center gap-1" onClick={() => pick(null)}>
              <X className="w-3 h-3" /> 선택 해제
            </button>
          </div>
        )}
        {error && <p className="text-xs cd-error-text">{error}</p>}

        <section className="grid gap-1">
          <h3 className="text-xs font-bold cd-text-muted">{q.trim() ? "용역" : "최근 진행 중 용역"}</h3>
          {contracts.length === 0 && !loading && <p className="text-xs cd-text-faint">일치하는 용역이 없습니다.</p>}
          <div className="grid gap-1 max-h-[38vh] overflow-y-auto">
            {contracts.map((c) => (
              <button
                key={c.contractId}
                type="button"
                className="cd-action text-left rounded-lg border cd-border-c px-3 py-2 hover:bg-[color:var(--cd-hover)]"
                onClick={() => pick({ label: c.title, contractId: c.contractId, facilityId: c.facilityId })}
              >
                <div className="flex items-center gap-1.5 text-sm cd-text">
                  <FileText className="w-3.5 h-3.5 cd-text-primary shrink-0" />
                  <span className="truncate">{c.title}</span>
                </div>
                <div className="text-[11px] cd-text-faint truncate pl-5">
                  {[c.facilityName ?? c.counterpartyName, c.contractDate].filter(Boolean).join(" · ")}
                </div>
              </button>
            ))}
          </div>
        </section>

        {q.trim() && (
          <section className="grid gap-1">
            <h3 className="text-xs font-bold cd-text-muted">사업장 — 용역이 없을 때(계약 전 영업 출장 등)</h3>
            {facilities.length === 0 && !loading && <p className="text-xs cd-text-faint">일치하는 사업장이 없습니다.</p>}
            <div className="grid gap-1 max-h-[24vh] overflow-y-auto">
              {facilities.map((f) => (
                <button
                  key={f.facilityId}
                  type="button"
                  className="cd-action text-left rounded-lg border cd-border-c px-3 py-2 hover:bg-[color:var(--cd-hover)]"
                  onClick={() => pick({ label: f.name, contractId: null, facilityId: f.facilityId })}
                >
                  <div className="flex items-center gap-1.5 text-sm cd-text">
                    <Building2 className="w-3.5 h-3.5 cd-text-muted shrink-0" />
                    <span className="truncate">{f.name}</span>
                  </div>
                  {f.region && <div className="text-[11px] cd-text-faint truncate pl-5">{f.region}</div>}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </CdModal>
  );
}

/** 표·목록 칸 안의 선택 버튼 — 값이 있으면 이름, 없으면 '선택'. required 면 빈 칸을 경고색으로. */
export function RelatedCellButton({
  label,
  onPick,
  disabled,
  missing,
  className = "",
}: {
  label: string;
  onPick: (ref: RelatedRef | null) => void;
  disabled?: boolean;
  missing?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (disabled) {
    return <div className={`px-1.5 py-1.5 text-[12px] cd-text truncate ${className}`} title={label}>{label}</div>;
  }
  return (
    <>
      <button
        type="button"
        className={`w-full text-left px-1.5 py-1.5 text-[12px] inline-flex items-center gap-1 min-w-0 ${
          label ? "cd-text" : missing ? "text-[color:var(--cd-error)]" : "cd-text-faint"
        } ${className}`}
        style={missing && !label ? { boxShadow: "inset 0 0 0 1px var(--cd-error)" } : undefined}
        title={label || (missing ? "이 지출 목적은 연관 용역/사업장이 필요합니다" : "연관 용역/사업장 선택")}
        onClick={() => setOpen(true)}
      >
        <Link2 className="w-3 h-3 shrink-0" />
        <span className="truncate">{label || (missing ? "선택 필요" : "선택")}</span>
      </button>
      <RelatedPickerModal open={open} onClose={() => setOpen(false)} onPick={onPick} current={label || undefined} />
    </>
  );
}
