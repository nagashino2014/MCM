"use client";

// 로그인(G-L) — cdash 재설계 + "로그인 유지"(30일/미체크 12시간) + 아이디/비밀번호 찾기 링크.
// 인증 로직(next-auth credentials·스로틀·최초 비번 변경 강제)은 무변경.

import { Suspense, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { LogIn, ShieldAlert } from "lucide-react";
import { CdButton } from "@/components/cdash/CdButton";
import { CdCheckbox, CdInput } from "@/components/cdash/CdField";

// callbackUrl 을 항상 현재 도메인의 경로로 정규화한다(오픈 리다이렉트 방지 겸용).
function toSameOriginPath(target: string): string {
  if (typeof window === "undefined") return target;
  try {
    const u = new URL(target, window.location.origin);
    return (u.pathname + u.search + u.hash) || "/home";
  } catch {
    return target.startsWith("/") ? target : "/home";
  }
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="cd-card-bg rounded-3xl border cd-border-c p-10 w-[420px] max-w-[92vw] flex items-center justify-center">
          <span className="text-sm cd-text-faint">로딩 중…</span>
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
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const callbackUrl = params.get("callbackUrl") ?? "/home";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await signIn("credentials", {
        email: email.trim(),
        password,
        remember: remember ? "1" : "",
        redirect: false,
      });
      if (!res || res.error) {
        setError("사번 또는 비밀번호가 올바르지 않거나, 비활성화된 계정입니다.");
        return;
      }
      router.replace(toSameOriginPath(callbackUrl));
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
            <span className="text-[19px] font-extrabold tracking-tight cd-text">
              MCM <span className="cd-grad-text">GROUPWARE</span>
            </span>
            <span className="text-[11px] font-semibold cd-text-faint">사번과 비밀번호로 로그인하세요.</span>
          </div>
        </div>
        <p className="text-xs cd-text-faint leading-relaxed">
          초기 비밀번호는 사번과 동일하며, 최초 로그인 시 변경해야 합니다.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <CdInput
          label="사번"
          type="text"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="사번 (예: 201903040101)"
          autoFocus
        />
        <CdInput
          label="비밀번호"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="********"
        />

        <div className="flex items-center justify-between">
          <CdCheckbox label="로그인 유지 (30일)" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <div className="flex items-center gap-2 text-xs">
            <Link href="/login/find" className="cd-text-faint hover:text-[color:var(--cd-primary)] transition-colors">
              아이디·비밀번호 찾기
            </Link>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-xs font-bold cd-error-text cd-error-bg rounded-xl px-3 py-2.5">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <CdButton type="submit" variant="primary" block loading={pending} icon={<LogIn className="w-4 h-4" />}>
          {pending ? "확인 중..." : "로그인"}
        </CdButton>
      </form>

      <p className="text-[11px] cd-text-faint text-center leading-relaxed">
        계정이 없거나 권한 변경이 필요한 경우 관리자에게 문의하세요.
        <br />
        공용 PC 에서는 "로그인 유지"를 사용하지 마세요.
      </p>
    </div>
  );
}
