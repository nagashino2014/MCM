"use client";

import { Suspense, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { LogIn, ShieldAlert } from "lucide-react";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="glass-panel rounded-3xl p-10 w-[420px] max-w-[92vw] flex items-center justify-center">
          <span className="text-sm text-stone-500">로딩 중…</span>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const callbackUrl = params.get("callbackUrl") ?? "/data/status";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await signIn("credentials", {
        email: email.trim(),
        password,
        redirect: false,
      });
      if (!res || res.error) {
        setError("이메일 또는 비밀번호가 올바르지 않거나, 비활성화된 계정입니다.");
        return;
      }
      router.replace(callbackUrl);
      router.refresh();
    });
  };

  return (
    <div className="glass-panel rounded-3xl p-10 w-[420px] max-w-[92vw] flex flex-col gap-6 reveal">
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-bold uppercase tracking-widest text-primary">
          PermitIQ
        </span>
        <h1 className="text-2xl font-bold text-stone-800">로그인</h1>
        <p className="text-sm text-stone-500">
          IEPS 통합환경허가 데이터 관리 콘솔에 접근하려면 계정 정보를 입력하세요.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wide">
            이메일
          </span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input-field"
            placeholder="admin@example.com"
            autoFocus
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wide">
            비밀번호
          </span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input-field"
            placeholder="********"
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
          <LogIn className="w-4 h-4" />
          {pending ? "확인 중..." : "로그인"}
        </button>
      </form>

      <div className="text-[11px] text-stone-400 text-center">
        계정이 없거나 권한 변경이 필요한 경우 관리자에게 문의하세요.
      </div>
    </div>
  );
}
