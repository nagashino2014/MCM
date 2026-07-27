"use client";

// 아이디(사번)·비밀번호 찾기(G-L) — 탭 2종. 결과는 등록 이메일로 발송(계정 열거 방지 — 화면에는 항상 동일 안내).

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, KeyRound, MailCheck, UserSearch } from "lucide-react";
import { CdButton } from "@/components/cdash/CdButton";
import { CdInput } from "@/components/cdash/CdField";
import { CdTabs } from "@/components/cdash/CdTabs";

type Tab = "id" | "pw";

export default function FindPage() {
  const [tab, setTab] = useState<Tab>("id");
  const [name, setName] = useState("");
  const [emailForId, setEmailForId] = useState("");
  const [loginId, setLoginId] = useState("");
  const [emailForPw, setEmailForPw] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    try {
      if (tab === "id") {
        await fetch("/api/auth/find-id", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email: emailForId }),
        });
      } else {
        await fetch("/api/auth/reset-request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ loginId, email: emailForPw }),
        });
      }
      setDone(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="cd-card-bg rounded-3xl border cd-border-c p-8 w-[460px] max-w-[92vw] flex flex-col gap-5" style={{ boxShadow: "var(--cd-shadow)" }}>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-extrabold cd-text">아이디·비밀번호 찾기</h1>
        <p className="text-xs cd-text-faint">인사 정보에 등록된 이메일로 결과를 보내드립니다.</p>
      </div>

      {done ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <span className="w-12 h-12 rounded-2xl flex items-center justify-center cd-soft-primary">
            <MailCheck className="w-6 h-6" />
          </span>
          <p className="text-sm font-semibold cd-text">입력하신 정보가 일치하면 등록된 이메일로 안내를 보냈습니다.</p>
          <p className="text-xs cd-text-faint">
            몇 분 내에 메일이 오지 않으면 입력 정보를 다시 확인하거나 관리자에게 문의하세요.
            {tab === "pw" && <><br />재설정 링크는 30분간 1회 사용할 수 있습니다.</>}
          </p>
          <CdButton variant="soft" onClick={() => setDone(false)}>
            다시 시도
          </CdButton>
        </div>
      ) : (
        <>
          <CdTabs<Tab>
            items={[
              { key: "id", label: "아이디(사번) 찾기", icon: <UserSearch className="w-4 h-4" /> },
              { key: "pw", label: "비밀번호 재설정", icon: <KeyRound className="w-4 h-4" /> },
            ]}
            active={tab}
            onChange={setTab}
          />
          <form onSubmit={submit} className="flex flex-col gap-3.5">
            {tab === "id" ? (
              <>
                <CdInput label="이름" required value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동" />
                <CdInput
                  label="등록 이메일"
                  type="email"
                  required
                  value={emailForId}
                  onChange={(e) => setEmailForId(e.target.value)}
                  placeholder="인사 정보에 등록된 이메일"
                  hint="일치하면 이 이메일로 사번을 보내드립니다."
                />
              </>
            ) : (
              <>
                <CdInput label="사번" required value={loginId} onChange={(e) => setLoginId(e.target.value)} placeholder="사번" />
                <CdInput
                  label="등록 이메일"
                  type="email"
                  required
                  value={emailForPw}
                  onChange={(e) => setEmailForPw(e.target.value)}
                  placeholder="인사 정보에 등록된 이메일"
                  hint="일치하면 이 이메일로 재설정 링크를 보내드립니다."
                />
              </>
            )}
            <CdButton type="submit" variant="primary" block loading={pending}>
              {tab === "id" ? "사번 안내 메일 받기" : "재설정 링크 받기"}
            </CdButton>
          </form>
        </>
      )}

      <Link href="/login" className="text-xs cd-text-faint hover:text-[color:var(--cd-primary)] transition-colors flex items-center gap-1 justify-center">
        <ArrowLeft className="w-3.5 h-3.5" /> 로그인으로 돌아가기
      </Link>
    </div>
  );
}
