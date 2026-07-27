"use client";

// 인원별 용량 배분 모달(G2-13, 관리자 전용) — 좌: 조직도 트리뷰 / 우: 요약(도넛)+선택 인원 용량 설정.
// 메일 용량은 실제 저장(mailboxes.quota_bytes), 개인 문서함 용량은 문서함 구현 전이라 UI 만(저장 비활성 안내).

import { useCallback, useEffect, useMemo, useState } from "react";
import { Minus, Plus, Save } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";
import { CdButton } from "@/components/cdash/CdButton";
import { useCdToast } from "@/components/cdash/CdToast";
import OrganizationTree from "@/components/admin/users/OrganizationTree";
import type { OrganizationSnapshot, OrganizationEmployeeRow } from "@/components/admin/users/types";

interface AdminMailbox {
  mailboxId: string;
  userId: string | null;
  address: string;
  displayName: string;
  quotaBytes: number | null;
  usedBytes: number | null;
}

const GB = 1024 * 1024 * 1024;

export function MailQuotaModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { toast } = useCdToast();
  const [snapshot, setSnapshot] = useState<OrganizationSnapshot | null>(null);
  const [mailboxes, setMailboxes] = useState<AdminMailbox[]>([]);
  const [selected, setSelected] = useState<OrganizationEmployeeRow | null>(null);
  const [mailGb, setMailGb] = useState(5);
  const [docGb, setDocGb] = useState(5); // 개인 문서함 — UI 만(추후 문서함 모듈에서 저장)
  const [saving, setSaving] = useState(false);
  const [totalPoolGb, setTotalPoolGb] = useState(100); // 전사 총 설정 용량 — 관리자 편집(G2-15)

  const load = useCallback(async () => {
    try {
      const [orgRes, mbRes] = await Promise.all([
        fetch("/api/sales/org", { cache: "no-store" }),
        fetch("/api/mail/settings?list=1", { method: "PUT" }),
      ]);
      if (orgRes.ok) setSnapshot((await orgRes.json()) as OrganizationSnapshot);
      if (mbRes.ok) {
        const d = await mbRes.json();
        setMailboxes(Array.isArray(d.mailboxes) ? d.mailboxes : []);
        if (Number.isFinite(d.totalPoolGb)) setTotalPoolGb(Number(d.totalPoolGb));
      }
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    if (open) {
      setSelected(null);
      load();
    }
  }, [open, load]);

  const selectedMailbox = useMemo(
    () => (selected?.userId ? mailboxes.find((m) => m.userId === selected.userId) ?? null : null),
    [selected, mailboxes]
  );

  useEffect(() => {
    if (selectedMailbox) setMailGb(selectedMailbox.quotaBytes != null ? Number((selectedMailbox.quotaBytes / GB).toFixed(1)) : 5);
  }, [selectedMailbox]);

  // 요약(도넛) — 총 설정 용량 = 전 인원 quota 합, 사용 = used 합.
  const summary = useMemo(() => {
    const assigned = mailboxes.reduce((s, m) => s + (m.quotaBytes ?? 0), 0);
    const used = mailboxes.reduce((s, m) => s + (m.usedBytes ?? 0), 0);
    const count = mailboxes.length || 1;
    return {
      assignedGb: assigned / GB,
      usedGb: used / GB,
      remainGb: Math.max(0, assigned - used) / GB,
      avgGb: assigned / GB / count,
      pct: assigned > 0 ? Math.min(100, Math.round((used / assigned) * 100)) : 0,
    };
  }, [mailboxes]);

  const save = async () => {
    if (!selectedMailbox) {
      toast("조직도에서 인원을 선택하세요. (메일함이 발급된 인원만 설정 가능)", "warn");
      return;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/mail/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mailboxId: selectedMailbox.mailboxId, quotaBytes: Math.round(mailGb * GB) }),
      });
      if (r.ok) {
        toast(`${selected?.name}님 메일 용량을 ${mailGb}GB 로 저장했습니다. (개인 문서함 용량은 문서함 구현 후 적용)`, "success");
        load();
        onSaved();
      } else toast("저장에 실패했습니다.", "error");
    } finally {
      setSaving(false);
    }
  };

  // 도넛(SVG) 지표.
  const R = 52;
  const C = 2 * Math.PI * R;
  const dash = (summary.pct / 100) * C;

  return (
    <CdModal open={open} onClose={onClose} title="인원별 용량 배분" size="xl" closeOnBackdrop={false}>
      {/* 좌(트리) 축소·우(설정) 확대(20rem→30rem) + 모달 높이 절반 고정(트리는 내부 스크롤) — G2-15 피드백. */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(14rem,1fr)_30rem] gap-4 h-[30rem]">
        {/* 좌 — 조직도 트리뷰(내부 스크롤) */}
        <div className="rounded-xl border cd-border-c overflow-hidden h-full min-h-0">
          <OrganizationTree
            snapshot={snapshot}
            selectedEmployeeId={selected?.employeeId ?? null}
            onSelectEmployee={(emp) => setSelected(emp)}
            embedded
            fillHeight
            hideHeader
          />
        </div>

        {/* 우 — 요약 + 선택 인원 설정(넘치면 내부 스크롤) */}
        <div className="flex flex-col gap-3 min-h-0 overflow-y-auto">
          <div className="rounded-xl border cd-border-c p-3 flex items-center gap-3">
            <svg width="128" height="128" viewBox="0 0 128 128" className="shrink-0">
              <circle cx="64" cy="64" r={R} fill="none" stroke="var(--cd-border)" strokeWidth="14" />
              <circle
                cx="64" cy="64" r={R} fill="none" stroke="var(--cd-primary)" strokeWidth="14"
                strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={C / 4} strokeLinecap="round"
              />
              <text x="64" y="60" textAnchor="middle" fontSize="20" fontWeight="800" fill="var(--cd-text)">{summary.pct}%</text>
              <text x="64" y="78" textAnchor="middle" fontSize="10" fill="var(--cd-faint)">사용 비율</text>
            </svg>
            <dl className="text-xs flex-1 flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <dt className="cd-text-faint">총 설정 용량</dt>
                <dd className="font-bold cd-text flex items-center gap-1">
                  {summary.assignedGb.toFixed(1)} GB /
                  <input
                    type="number"
                    min={1}
                    value={totalPoolGb}
                    onChange={(e) => setTotalPoolGb(Number(e.target.value))}
                    onBlur={async () => {
                      const r = await fetch("/api/mail/settings", {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ totalPoolGb }),
                      });
                      if (r.ok) toast(`전사 총 설정 용량을 ${totalPoolGb}GB 로 저장했습니다.`, "success");
                    }}
                    className="cd-input !w-16 !px-1.5 !py-0.5 text-right text-xs"
                    title="전사 총 설정 용량(GB) — 수정 후 포커스를 벗어나면 저장됩니다"
                  />
                  GB
                </dd>
              </div>
              <Row k="사용 용량" v={`${summary.usedGb.toFixed(2)} GB`} />
              <Row k="잔여 용량" v={`${summary.remainGb.toFixed(1)} GB`} />
              <Row k="1인당 평균" v={`${summary.avgGb.toFixed(1)} GB`} />
            </dl>
          </div>

          <div className="rounded-xl border cd-border-c p-3 flex flex-col gap-3 flex-1">
            {selected ? (
              <>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="cd-label">성명/직급</p>
                    <p className="rounded-lg border cd-border-c px-2.5 py-1.5 bg-white text-black">
                      {selected.name} {selected.positionName ?? ""}
                    </p>
                  </div>
                  <div>
                    <p className="cd-label">부서</p>
                    <p className="rounded-lg border cd-border-c px-2.5 py-1.5 bg-white text-black truncate">
                      {snapshot?.departments.find((d) => d.deptId === selected.deptId)?.deptName ?? "-"}
                    </p>
                  </div>
                </div>
                {!selectedMailbox && (
                  <p className="text-[11px] cd-warn-text cd-warn-bg rounded-lg px-2 py-1.5">이 인원은 아직 메일함이 발급되지 않았습니다(최초 메일 사용 시 자동 발급).</p>
                )}
                <p className="cd-label">할당 용량</p>
                <div className="grid grid-cols-2 gap-3">
                  <Stepper label="메일" value={mailGb} onChange={setMailGb} disabled={!selectedMailbox} />
                  <Stepper label="개인 문서함 (준비 중)" value={docGb} onChange={setDocGb} disabled={false} />
                </div>
                <p className="text-[10px] cd-text-faint">개인 문서함 용량은 문서함 모듈 구현 후 적용됩니다(현재 UI 만).</p>
              </>
            ) : (
              <p className="text-sm cd-text-faint m-auto text-center">조직도에서 인원을 선택하세요.</p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2">
            <CdButton onClick={onClose}>취소</CdButton>
            <CdButton variant="primary" loading={saving} icon={<Save className="w-4 h-4" />} onClick={save}>
              저장
            </CdButton>
          </div>
        </div>
      </div>
    </CdModal>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="cd-text-faint">{k}</dt>
      <dd className="font-bold cd-text">{v}</dd>
    </div>
  );
}

function Stepper({ label, value, onChange, disabled }: { label: string; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="cd-label">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number" min={0.5} step={0.5} value={value} disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="cd-input flex-1 text-right"
        />
        <span className="text-xs cd-text-faint">GB</span>
        <button type="button" disabled={disabled} onClick={() => onChange(Number((value + 0.5).toFixed(1)))} className="p-1.5 rounded-lg border cd-border-c cd-text-muted hover:cd-soft-primary disabled:opacity-40">
          <Plus className="w-3.5 h-3.5" />
        </button>
        <button type="button" disabled={disabled} onClick={() => onChange(Math.max(0.5, Number((value - 0.5).toFixed(1))))} className="p-1.5 rounded-lg border cd-border-c cd-text-muted hover:cd-soft-primary disabled:opacity-40">
          <Minus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
