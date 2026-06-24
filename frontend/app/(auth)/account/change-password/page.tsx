"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { KeyRound, ShieldAlert } from "lucide-react";

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
    <div className="glass-panel rounded-3xl p-10 w-[420px] max-w-[92vw] flex flex-col gap-6 reveal">
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-bold uppercase tracking-widest text-primary">PermitIQ</span>
        <h1 className="text-2xl font-bold text-stone-800">비밀번호 변경</h1>
        <p className="text-sm text-stone-500">
          최초 로그인입니다. 초기 비밀번호(사번)를 새 비밀번호로 변경해야 계속 진행할 수 있습니다.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wide">현재 비밀번호</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="input-field"
            placeholder="초기 비밀번호(= 사번)"
            autoFocus
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wide">새 비밀번호</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="input-field"
            placeholder="8자 이상"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wide">새 비밀번호 확인</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="input-field"
            placeholder="새 비밀번호 재입력"
          />
        </label>

        {error && (
          <div className="flex items-center gap-2 text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
            <ShieldAlert className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={pending}
          className="rounded-xl px-4 py-3 text-sm font-bold text-white bg-primary hover:bg-primary/90 shadow-sm flex items-center justify-center gap-2 disabled:opacity-60"
        >
          <KeyRound className="w-4 h-4" />
          {pending ? "변경 중..." : "비밀번호 변경"}
        </button>
      </form>
    </div>
  );
}
