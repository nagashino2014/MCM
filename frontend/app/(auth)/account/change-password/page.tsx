"use client";

// 최초 로그인 비밀번호 변경 — 로그인 화면과 동일한 cdash(Soft Glass Ink) 결.
// 인증/변경 로직은 무변경, 표면만 교체(레거시 glass-panel·stone·그린 primary 폐기).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { KeyRound, ShieldAlert } from "lucide-react";
import { CdButton } from "@/components/cdash/CdButton";
import { CdInput } from "@/components/cdash/CdField";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) {
      setError("새 비밀번호가 일치하지 않습니다.");
      return;
    }
    if (newPassword.length < 8) {
      setError("새 비밀번호는 최소 8자 이상이어야 합니다.");
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/account/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error ?? "비밀번호 변경에 실패했습니다.");
        return;
      }
      // 변경 후에는 새 비밀번호로 재로그인한다(세션 토큰의 강제변경 플래그 정리).
      await signOut({ redirect: false });
      router.replace("/login?changed=1");
      router.refresh();
    });
  };

  return (
    <div className="cd-card p-10 w-[440px] max-w-[92vw] gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2.5">
          <span className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-extrabold text-white cd-grad-fill shrink-0">
            M
          </span>
          <div className="flex flex-col leading-tight">
            <span className="text-[19px] font-extrabold tracking-tight cd-text">비밀번호 변경</span>
            <span className="text-[11px] font-semibold cd-text-faint">최초 로그인 — 초기 비밀번호를 변경하세요.</span>
          </div>
        </div>
        <p className="text-xs cd-text-faint leading-relaxed">
          초기 비밀번호(= 사번)를 새 비밀번호로 변경해야 계속 진행할 수 있습니다.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <CdInput
          label="현재 비밀번호"
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder="초기 비밀번호(= 사번)"
          autoFocus
        />
        <CdInput
          label="새 비밀번호"
          type="password"
          autoComplete="new-password"
          required
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="8자 이상"
        />
        <CdInput
          label="새 비밀번호 확인"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="새 비밀번호 재입력"
        />

        {error && (
          <div className="flex items-center gap-2 text-xs font-bold cd-error-text cd-error-bg rounded-xl px-3 py-2.5">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <CdButton type="submit" variant="primary" block loading={pending} icon={<KeyRound className="w-4 h-4" />}>
          {pending ? "변경 중..." : "비밀번호 변경"}
        </CdButton>
      </form>

      <p className="text-[11px] cd-text-faint text-center leading-relaxed">
        변경 후에는 새 비밀번호로 다시 로그인해야 합니다.
      </p>
    </div>
  );
}
