"use client";

/**
 * 계정 영구 삭제 확인 모달(2026-10-19) — 테스트·오발급 계정 정리용. 퇴사자는 인사 이력의 퇴사 처리로 안내한다.
 * 열리면 GET /api/admin/users/[id]/purge 로 미리보기(차단 사유·함께 삭제·참조 끊김·경고)를 받는다.
 * 실행 조건: 차단 사유 없음 + (경고가 있으면 "영향 확인" 체크) + 로그인 ID 재입력 일치.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { CdButton, CdModal } from "@/components/cdash";
import type { AccountPurgePreview, PurgeCount } from "@/lib/auth/account-purge";
import type { UserRow } from "./types";

function CountList({ items, title, hint }: { items: PurgeCount[]; title: string; hint?: string }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="cd-label mb-1">{title}</p>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
        {items.map((c) => (
          <li key={c.key} className="flex justify-between gap-2">
            <span className={c.record ? "font-medium" : "cd-text-muted"} style={c.record ? { color: "var(--cd-error)" } : undefined}>
              {c.label}
            </span>
            <b>{c.count}건</b>
          </li>
        ))}
      </ul>
      {hint && <p className="text-[11px] cd-text-faint mt-1">{hint}</p>}
    </div>
  );
}

export function AccountPurgeModal({ user, onClose, onPurged }: { user: UserRow | null; onClose: () => void; onPurged: (user: UserRow, employeeDeleted: boolean) => void }) {
  const [preview, setPreview] = useState<AccountPurgePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [withEmployee, setWithEmployee] = useState(true);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const open = !!user;

  // 열릴 때·직원 동반 여부가 바뀔 때 미리보기 재조회(동반 여부에 따라 직원 쪽 건수가 달라진다)
  useEffect(() => {
    setPreview(null);
    setError(null);
    setAck(false);
    if (!user) return;
    let alive = true;
    fetch(`/api/admin/users/${encodeURIComponent(user.userId)}/purge?employee=${withEmployee ? "1" : "0"}`, { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { preview?: AccountPurgePreview; error?: string };
        if (!res.ok) throw new Error(data.error ?? `미리보기 실패 (${res.status})`);
        if (alive) setPreview(data.preview ?? null);
      })
      .catch((e) => {
        if (alive) setError((e as Error).message);
      });
    return () => {
      alive = false;
    };
  }, [user, withEmployee]);
  useEffect(() => {
    setConfirm("");
    setWithEmployee(true);
  }, [user]);

  const needAck = !!preview && preview.warnings.length > 0;
  const ready = !!preview && preview.canPurge && (!needAck || ack) && confirm.trim() === preview.confirmText && !busy;

  const run = async () => {
    if (!user || !preview || !ready) return;
    setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ confirm: confirm.trim(), employee: withEmployee && preview.employee ? "1" : "0", ack: ack ? "1" : "0" });
      const res = await fetch(`/api/admin/users/${encodeURIComponent(user.userId)}?${qs.toString()}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string; employeeDeleted?: boolean };
      if (!res.ok) throw new Error(data.error ?? `삭제 실패 (${res.status})`);
      onPurged(user, !!data.employeeDeleted);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <CdModal
      open={open}
      onClose={() => (busy ? undefined : onClose())}
      title="계정 영구 삭제"
      size="md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <CdButton variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            취소
          </CdButton>
          <CdButton variant="danger" size="sm" onClick={() => void run()} disabled={!ready} icon={busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : undefined}>
            영구 삭제
          </CdButton>
        </div>
      }
    >
      {user && (
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex items-start gap-2 rounded-lg border px-3 py-2" style={{ borderColor: "var(--cd-error-soft)", background: "var(--cd-error-soft)", color: "var(--cd-error)" }} role="alert">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">되돌릴 수 없습니다.</p>
              <p className="text-xs mt-0.5">
                퇴사자는 삭제하지 말고 조직 인원의 인사 이력에서 <b>퇴사 처리</b>를 하세요(기록 보존·계정 비활성). 이 기능은 테스트·오발급 계정 정리용입니다.
              </p>
            </div>
          </div>

          <div className="rounded-lg border cd-border-c p-3 flex flex-col gap-1">
            <p>
              <span className="cd-text-muted">계정</span> <b>{user.name}</b> <span className="cd-text-faint">({user.loginId ?? user.email})</span>
              {preview?.user.role === "admin" && <span className="ml-1 text-xs cd-text-faint">· admin 플래그</span>}
            </p>
            {preview?.employee ? (
              <p>
                <span className="cd-text-muted">연결된 직원</span> {preview.employee.name}
                <span className="cd-text-faint">
                  {" "}
                  · {preview.employee.employeeNo ?? "사번 없음"} · {preview.employee.deptId ?? "부서 없음"} · {preview.employee.status === "active" ? "재직" : "비활성"}
                </span>
              </p>
            ) : preview ? (
              <p className="cd-text-faint">연결된 직원 프로필이 없습니다.</p>
            ) : null}
          </div>

          {!preview && !error && (
            <p className="cd-text-faint flex items-center gap-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> 영향 범위를 확인하는 중…
            </p>
          )}
          {error && (
            <p className="text-xs" style={{ color: "var(--cd-error)" }} role="alert">
              {error}
            </p>
          )}

          {preview && preview.blockers.length > 0 && (
            <ul className="rounded-lg border px-3 py-2 text-xs flex flex-col gap-1" style={{ borderColor: "var(--cd-error-soft)", color: "var(--cd-error)" }} aria-label="삭제할 수 없는 사유">
              {preview.blockers.map((b) => (
                <li key={b}>• {b}</li>
              ))}
            </ul>
          )}

          {preview && preview.canPurge && (
            <>
              {preview.employee && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={withEmployee} onChange={(e) => setWithEmployee(e.target.checked)} disabled={busy} />
                  직원 프로필(조직 인원 · {preview.employee.name})도 함께 삭제
                  <span className="text-xs cd-text-faint">— 끄면 인원은 남고 계정 연결만 끊깁니다</span>
                </label>
              )}
              <CountList items={preview.cascades} title="함께 삭제되는 것" />
              <CountList items={preview.orphans} title="남지만 참조가 비는 것" hint="기록은 남고 작성자·직원 표시만 비게 됩니다." />
              {preview.cascades.length === 0 && preview.orphans.length === 0 && <p className="text-xs cd-text-faint">영향을 받는 부속 데이터가 없습니다.</p>}

              {needAck && (
                <label className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--cd-error-soft)" }}>
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} disabled={busy} className="mt-0.5" />
                  <span>
                    <b style={{ color: "var(--cd-error)" }}>업무 기록이 영향을 받습니다</b>({preview.warnings.map((w) => `${w.label} ${w.count}건`).join(", ")}). 실제 직원이라면 취소하고 퇴사 처리를 사용하세요. 영향을 확인했습니다.
                  </span>
                </label>
              )}

              <label className="flex flex-col gap-1">
                <span className="cd-label">
                  확인을 위해 <code className="px-1 rounded cd-surface-bg">{preview.confirmText}</code> 를 입력하세요
                </span>
                <input className="cd-input" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={preview.confirmText} autoComplete="off" spellCheck={false} disabled={busy} />
              </label>
            </>
          )}
        </div>
      )}
    </CdModal>
  );
}
