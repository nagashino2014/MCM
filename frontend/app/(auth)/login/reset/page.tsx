"use client";

// 비밀번호 재설정(G-L) — 메일 링크(?token=)로 진입, 새 비밀번호 설정. 토큰은 30분·1회용.

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, KeyRound, ShieldAlert } from "lucide-react";
import { CdButton } from "@/components/cdash/CdButton";
import { CdInput } from "@/components/cdash/CdField";

export default function ResetPage() {
  return (
    <Suspense fallback={null}>
      <ResetForm />
    </Suspense>
  );
}

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    if (password !== confirm) {
      setError("비밀번호가 서로 일치하지 않습니다.");
      return;
    }
    setPending(true);
    try {
      const r = await fetch("/api/auth/reset-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(String(d.error ?? "처리에 실패했습니다."));
        return;
      }
      alert("비밀번호가 변경되었습니다. 새 비밀번호로 로그인하세요.");
      router.replace("/login");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="cd-card-bg rounded-3xl border cd-border-c p-8 w-[440px] max-w-[92vw] flex flex-col gap-5" style={{ boxShadow: "var(--cd-shadow)" }}>
      <div className="flex items-center gap-2.5">
        <span className="w-10 h-10 rounded-xl flex items-center justify-center cd-soft-primary">
          <KeyRound className="w-5 h-5" />
        </span>
        <div className="flex flex-col leading-tight">
          <h1 className="text-lg font-extrabold cd-text">비밀번호 재설정</h1>
          <p className="text-[11px] cd-text-faint">새 비밀번호를 입력하세요(8자 이상).</p>
        </div>
      </div>

      {!token ? (
        <p className="text-sm cd-text-faint py-4 text-center">
          유효하지 않은 접근입니다. 메일의 재설정 링크로 다시 접속해 주세요.
        </p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3.5">
          <CdInput
            label="새 비밀번호"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="8자 이상"
          />
          <CdInput
            label="새 비밀번호 확인"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="한 번 더 입력"
          />
          {error && (
            <div className="flex items-center gap-2 text-xs font-bold cd-error-text cd-error-bg rounded-xl px-3 py-2.5">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <CdButton type="submit" variant="primary" block loading={pending}>
            비밀번호 변경
          </CdButton>
        </form>
      )}

      <Link href="/login" className="text-xs cd-text-faint hover:text-[color:var(--cd-primary)] transition-colors flex items-center gap-1 justify-center">
        <ArrowLeft className="w-3.5 h-3.5" /> 로그인으로 돌아가기
      </Link>
    </div>
  );
}
