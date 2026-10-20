"use client";

// 부재·대결 설정(DA-1, 본인) — 부재 기간 동안 내 차례 결재를 대결자에게 넘기거나 다음 결재자로 건너뛴다.
// 최종 결재자 단계에는 적용하지 않는다(D-2). 승인된 휴가에는 '휴가 연동 기본 대결자'가 적용된다(D-1).
// 설계: docs/e-approval-delegation-blueprint.md §3·§6-1.

import { useCallback, useEffect, useState } from "react";
import { UserRoundCog } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdButton } from "@/components/cdash/CdButton";
import { CdBadge, type CdBadgeTone } from "@/components/cdash/CdBadge";
import { CdCheckbox, CdDateInput, CdInput, isValidDateString } from "@/components/cdash/CdField";
import { OrgPickerModal } from "@/components/approval/OrgPickerModal";
import "@/components/cdash/cdash.css";

interface Absence {
  absenceId: string;
  startDate: string;
  endDate: string;
  mode: "delegate" | "skip";
  delegateUserId: string | null;
  delegateName: string | null;
  reason: string | null;
  allowSelfAct: boolean;
  state: "active" | "upcoming" | "ended" | "canceled";
}

interface DefaultDelegate {
  delegateUserId: string | null;
  delegateName: string | null;
  enabled: boolean;
}

const STATE_LABEL: Record<Absence["state"], { label: string; tone: CdBadgeTone }> = {
  active: { label: "진행 중", tone: "info" },
  upcoming: { label: "예정", tone: "secondary" },
  ended: { label: "종료", tone: "idle" },
  canceled: { label: "취소", tone: "idle" },
};

type PickerTarget = "absence" | "default" | null;

export function ApprovalAbsenceBoard() {
  const { theme } = useCdashTheme();
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState("");
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [defaultDelegate, setDefaultDelegate] = useState<DefaultDelegate>({ delegateUserId: null, delegateName: null, enabled: false });
  const [pending, setPending] = useState<{ middle: number; final: number }>({ middle: 0, final: 0 });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<PickerTarget>(null);

  // 등록 폼
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [mode, setMode] = useState<"delegate" | "skip">("delegate");
  const [delegate, setDelegate] = useState<{ userId: string; name: string } | null>(null);
  const [reason, setReason] = useState("");
  const [allowSelfAct, setAllowSelfAct] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/approval/absences", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "불러오지 못했습니다.");
      setToday(String(data.today ?? ""));
      setAbsences(Array.isArray(data.absences) ? data.absences : []);
      if (data.defaultDelegate) setDefaultDelegate(data.defaultDelegate);
      if (data.pending) setPending(data.pending);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const formError = (() => {
    if (!startDate || !endDate) return "부재 기간을 입력하세요.";
    if (!isValidDateString(startDate) || !isValidDateString(endDate)) return "부재 기간을 올바른 날짜로 입력하세요.";
    if (startDate > endDate) return "종료일이 시작일보다 앞설 수 없습니다.";
    if (today && endDate < today) return "이미 지난 기간은 등록할 수 없습니다.";
    if (mode === "delegate" && !delegate) return "대결자를 지정하세요.";
    return null;
  })();
  const startsNow = !!startDate && !!today && startDate <= today;

  const submit = async () => {
    if (formError) return;
    setSaving(true);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/approval/absences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate,
          endDate,
          mode,
          delegateUserId: mode === "delegate" ? delegate?.userId ?? null : null,
          reason: reason.trim() || null,
          allowSelfAct,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "등록하지 못했습니다.");
      setMsg(
        Number(data.rerouted) > 0
          ? `부재를 등록했습니다. 대기 중이던 결재 ${data.rerouted}건을 넘겼습니다.`
          : "부재를 등록했습니다."
      );
      setStartDate("");
      setEndDate("");
      setReason("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (a: Absence) => {
    if (!confirm(`${a.startDate} ~ ${a.endDate} 부재를 취소할까요?\n이미 대결자에게 넘어간 결재는 그대로 남습니다(원결재자도 처리 가능 설정이면 직접 처리할 수 있습니다).`)) return;
    setMsg(null);
    setError(null);
    try {
      const res = await fetch(`/api/approval/absences?absenceId=${encodeURIComponent(a.absenceId)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "취소하지 못했습니다.");
      setMsg("부재를 취소했습니다.");
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const saveDefault = async (userId: string | null) => {
    setMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/approval/absences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delegateUserId: userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "저장하지 못했습니다.");
      if (data.defaultDelegate) setDefaultDelegate(data.defaultDelegate);
      setMsg(userId ? "휴가 연동 기본 대결자를 저장했습니다." : "휴가 연동 기본 대결자를 해제했습니다.");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl overflow-y-auto" data-theme={theme}>
      <CdPageHeader
        icon={<UserRoundCog className="w-5 h-5" />}
        eyebrow="Approval · Absence"
        title="부재·대결 설정"
        help="출장·휴가 등으로 결재할 수 없는 기간을 미리 등록하면, 그 기간에 내 차례가 된 결재가 대결자에게 넘어가거나 다음 결재자로 건너뜁니다. 최종 결재자로 지정된 결재는 넘어가지 않고 복귀 후 직접 결재해야 결재가 끝납니다."
      />

      <div className="cd-card rounded-3xl p-5 flex flex-col gap-2">
        <p className="text-[12.5px] cd-text">
          지금 내 차례로 대기 중인 결재: <b>{pending.middle + pending.final}건</b>
          {pending.final > 0 && <span className="cd-text-faint"> (그중 최종 결재 {pending.final}건은 부재 중에도 넘어가지 않습니다)</span>}
        </p>
        <p className="text-[11.5px] cd-text-faint">최종 결재자로 지정된 문서는 대결·건너뛰기 없이 복귀 후 직접 결재해야 합니다.</p>
      </div>

      <div className="cd-card rounded-3xl p-5 flex flex-col gap-4">
        <h2 className="text-[14px] font-semibold cd-text">부재 등록</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
          <CdDateInput label="시작일" required value={startDate} onChange={setStartDate} />
          <CdDateInput label="종료일" required value={endDate} onChange={setEndDate} />
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-[12px] font-semibold cd-text mb-1">처리 방식</legend>
          <label className="flex items-start gap-2 text-[12.5px] cd-text">
            <input type="radio" name="absence-mode" checked={mode === "delegate"} onChange={() => setMode("delegate")} className="mt-0.5" />
            <span>
              대결자 지정 — 지정한 사람이 나 대신 결재합니다.
            </span>
          </label>
          <label className="flex items-start gap-2 text-[12.5px] cd-text">
            <input type="radio" name="absence-mode" checked={mode === "skip"} onChange={() => setMode("skip")} className="mt-0.5" />
            <span>다음 결재자로 넘기기 — 내 단계를 생략하고 다음 결재자에게 바로 넘깁니다.</span>
          </label>
        </fieldset>
        {mode === "delegate" && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-semibold cd-text">대결자</span>
            <span className="text-[12.5px] cd-text">{delegate ? delegate.name : <span className="cd-text-faint">미지정</span>}</span>
            <CdButton size="sm" onClick={() => setPicker("absence")}>
              {delegate ? "변경" : "조직도에서 선택"}
            </CdButton>
          </div>
        )}
        <div className="max-w-xl">
          <CdInput label="사유" placeholder="예: 해외 출장(선택)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={100} />
        </div>
        {mode === "delegate" && (
          <CdCheckbox
            label="부재 중에도 내가 직접 처리할 수 있게 둡니다(일찍 복귀했을 때)."
            checked={allowSelfAct}
            onChange={(e) => setAllowSelfAct(e.target.checked)}
          />
        )}
        <div className="flex flex-wrap items-center gap-3">
          <CdButton variant="primary" disabled={!!formError || saving} onClick={submit}>
            {saving ? "등록 중..." : "부재 등록"}
          </CdButton>
          {formError && (startDate || endDate) ? (
            <span className="text-[12px]" style={{ color: "var(--cd-error)" }}>{formError}</span>
          ) : startsNow && pending.middle > 0 ? (
            <span className="text-[12px] cd-text-faint">
              등록하면 지금 대기 중인 결재 {pending.middle}건이 {mode === "delegate" ? "대결자에게" : "다음 결재자에게"} 바로 넘어갑니다.
            </span>
          ) : null}
        </div>
        {msg && <p className="text-[12px] cd-text">{msg}</p>}
        {error && <p className="text-[12px]" style={{ color: "var(--cd-error)" }}>{error}</p>}
      </div>

      <div className="cd-card rounded-3xl p-5 flex flex-col gap-3">
        <h2 className="text-[14px] font-semibold cd-text">내 부재 기간</h2>
        {loading ? (
          <p className="text-sm cd-text-faint">불러오는 중입니다.</p>
        ) : absences.length === 0 ? (
          <p className="text-[12.5px] cd-text-faint">등록한 부재가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead className="cd-table-head">
                <tr className="text-left cd-text-faint text-[11px]">
                  <th className="py-1.5 pr-3 font-semibold">상태</th>
                  <th className="py-1.5 pr-3 font-semibold">기간</th>
                  <th className="py-1.5 pr-3 font-semibold">처리 방식</th>
                  <th className="py-1.5 pr-3 font-semibold">사유</th>
                  <th className="py-1.5 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {absences.map((a) => (
                  <tr key={a.absenceId} className="border-t cd-border-c">
                    <td className="py-2 pr-3">
                      <CdBadge tone={STATE_LABEL[a.state].tone}>{STATE_LABEL[a.state].label}</CdBadge>
                    </td>
                    <td className="py-2 pr-3 cd-text whitespace-nowrap">
                      {a.startDate} ~ {a.endDate}
                    </td>
                    <td className="py-2 pr-3 cd-text">
                      {a.mode === "delegate" ? `대결 · ${a.delegateName ?? "-"}` : "다음 결재자로 넘기기"}
                      {a.mode === "delegate" && !a.allowSelfAct && <span className="cd-text-faint"> (본인 처리 불가)</span>}
                    </td>
                    <td className="py-2 pr-3 cd-text-faint">{a.reason ?? "-"}</td>
                    <td className="py-2 text-right">
                      {(a.state === "active" || a.state === "upcoming") && (
                        <CdButton size="sm" variant="ghost" onClick={() => cancel(a)}>
                          취소
                        </CdButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="cd-card rounded-3xl p-5 flex flex-col gap-3">
        <h2 className="text-[14px] font-semibold cd-text">휴가 연동 기본 대결자</h2>
        <p className="text-[11.5px] cd-text-faint">
          부재를 따로 등록하지 않아도, 승인된 휴가신청서 기간에는 이 사람이 대신 결재합니다. 지정하지 않으면 휴가 중에도 결재가 넘어가지 않습니다.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] cd-text">
            {defaultDelegate.delegateUserId ? defaultDelegate.delegateName ?? defaultDelegate.delegateUserId : <span className="cd-text-faint">미지정</span>}
          </span>
          <CdButton size="sm" onClick={() => setPicker("default")}>
            {defaultDelegate.delegateUserId ? "변경" : "조직도에서 선택"}
          </CdButton>
          {defaultDelegate.delegateUserId && (
            <CdButton size="sm" variant="ghost" onClick={() => saveDefault(null)}>
              해제
            </CdButton>
          )}
        </div>
      </div>

      <OrgPickerModal
        open={picker != null}
        title="대결자 선택 — 조직도에서 선택"
        hint="인원을 클릭하면 대결자로 지정됩니다."
        onClose={() => setPicker(null)}
        onSelect={(emp) => {
          if (!emp.userId) {
            alert(`${emp.name} 님은 아직 계정이 연결되지 않아 지정할 수 없습니다.`);
            return;
          }
          if (picker === "absence") setDelegate({ userId: emp.userId, name: emp.name });
          else if (picker === "default") void saveDefault(emp.userId);
          setPicker(null);
        }}
      />
    </div>
  );
}
