"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  Users as UsersIcon,
  Plus,
  Trash2,
  KeyRound,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";

interface UserRow {
  userId: string;
  email: string;
  name: string;
  role: "admin" | "editor" | "viewer";
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
}

const ROLE_LABEL: Record<UserRow["role"], string> = {
  admin: "관리자",
  editor: "편집자",
  viewer: "조회자",
};

export default function AdminUsersPage() {
  return (
    <ToastProvider>
      <Inner />
    </ToastProvider>
  );
}

function Inner() {
  const { data: session, status: sessionStatus } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const toast = useToast();

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      const json = (await res.json()) as { items: UserRow[] };
      setUsers(json.items || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sessionStatus === "authenticated") reload();
  }, [reload, sessionStatus]);

  if (sessionStatus === "loading") {
    return <div className="p-8 text-stone-400 text-sm">세션 확인 중…</div>;
  }
  if (role !== "admin") {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="glass-card rounded-3xl p-10 text-center max-w-md">
          <ShieldAlert className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-stone-800 mb-1">접근 권한이 없습니다</h2>
          <p className="text-sm text-stone-500">관리자만 접근할 수 있는 페이지입니다.</p>
        </div>
      </div>
    );
  }

  const handleUpdate = async (id: string, patch: Partial<Pick<UserRow, "role" | "status" | "name">>) => {
    try {
      const res = await fetch("/api/admin/users/" + id, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      toast.show("사용자 정보가 갱신되었습니다.");
      reload();
    } catch (err) {
      toast.show("실패: " + (err as Error).message, "error");
    }
  };

  const handleDelete = async (u: UserRow) => {
    if (!confirm("'" + u.email + "' 계정을 삭제할까요? 되돌릴 수 없습니다.")) return;
    try {
      const res = await fetch("/api/admin/users/" + u.userId, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      toast.show("계정이 삭제되었습니다.");
      reload();
    } catch (err) {
      toast.show("실패: " + (err as Error).message, "error");
    }
  };

  return (
    <div className="flex flex-col gap-6 p-2">
      <section className="glass-panel p-8 rounded-3xl relative overflow-hidden reveal">
        <div className="relative z-10 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold text-stone-800 mb-2 flex items-center gap-3">
              <UsersIcon className="w-7 h-7 text-primary" />
              시스템 · 사용자 관리
            </h1>
            <p className="text-stone-600 text-base max-w-3xl">
              관리자 / 편집자 / 조회자 계정을 생성·수정·삭제합니다. 권한 변경은 즉시 적용됩니다.
            </p>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              onClick={reload}
              className="glass-button rounded-xl px-3 py-2 text-xs font-bold text-stone-700 flex items-center gap-1"
            >
              <RefreshCw className={"w-3 h-3 " + (loading ? "animate-spin" : "")} />
              새로고침
            </button>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="rounded-xl px-3 py-2 text-xs font-bold text-white bg-primary hover:bg-primary/90 shadow-sm flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> 계정 생성
            </button>
          </div>
        </div>
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-primary/10 to-transparent pointer-events-none" />
      </section>

      <section className="glass-panel rounded-3xl p-6 reveal delay-1">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-stone-700">계정 ({users.length})</h3>
        </div>
        {error && (
          <div className="text-red-600 text-sm font-bold mb-3">조회 실패: {error}</div>
        )}
        {loading && <div className="text-stone-400 text-sm py-6 text-center">로딩 중…</div>}

        <div className="hidden md:grid grid-cols-[1.4fr_1.6fr_1fr_0.8fr_0.8fr_1fr] gap-3 px-3 py-2 text-[10px] font-bold uppercase text-stone-400 tracking-wide">
          <div>이름</div>
          <div>이메일</div>
          <div>역할</div>
          <div>상태</div>
          <div>가입일</div>
          <div className="text-right">작업</div>
        </div>

        <div className="flex flex-col gap-1.5">
          {users.map((u) => {
            const isSelf = (session?.user as { id?: string } | undefined)?.id === u.userId;
            return (
              <div
                key={u.userId}
                className="grid grid-cols-[1.4fr_1.6fr_1fr_0.8fr_0.8fr_1fr] gap-3 items-center text-left p-3 rounded-xl bg-white/40 border border-white/50"
              >
                <div className="text-sm font-bold text-stone-800 truncate">
                  {u.name}
                  {isSelf && (
                    <span className="ml-2 text-[10px] text-primary font-bold">YOU</span>
                  )}
                </div>
                <div className="text-xs text-stone-600 truncate">{u.email}</div>
                <div>
                  <select
                    className="ui-select text-xs"
                    value={u.role}
                    disabled={isSelf}
                    onChange={(e) =>
                      handleUpdate(u.userId, {
                        role: e.target.value as UserRow["role"],
                      })
                    }
                  >
                    <option value="admin">관리자</option>
                    <option value="editor">편집자</option>
                    <option value="viewer">조회자</option>
                  </select>
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() =>
                      handleUpdate(u.userId, {
                        status: u.status === "active" ? "disabled" : "active",
                      })
                    }
                    disabled={isSelf}
                    className={cn(
                      "px-2 py-1 rounded-full text-[10px] font-bold",
                      u.status === "active"
                        ? "bg-primary/10 text-primary"
                        : "bg-stone-200 text-stone-500",
                      isSelf && "opacity-40 cursor-not-allowed"
                    )}
                  >
                    {u.status === "active" ? "활성" : "비활성"}
                  </button>
                </div>
                <div className="text-[11px] text-stone-500">
                  {u.createdAt?.slice(0, 10)}
                </div>
                <div className="flex items-center justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => setResetTarget(u)}
                    title="비밀번호 재설정"
                    className="p-2 rounded-lg text-stone-400 hover:text-primary"
                  >
                    <KeyRound className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(u)}
                    disabled={isSelf}
                    title="삭제"
                    className={cn(
                      "p-2 rounded-lg text-stone-400 hover:text-red-600",
                      isSelf && "opacity-40 cursor-not-allowed hover:text-stone-400"
                    )}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {createOpen && (
        <CreateUserModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            reload();
            toast.show("계정이 생성되었습니다.");
          }}
        />
      )}
      {resetTarget && (
        <ResetPasswordModal
          user={resetTarget}
          onClose={() => setResetTarget(null)}
          onDone={() => {
            setResetTarget(null);
            toast.show("비밀번호가 재설정되었습니다.");
          }}
        />
      )}
    </div>
  );
}

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRow["role"]>("editor");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, name, password, role }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="glass-panel rounded-3xl w-[480px] max-w-[92vw] p-6 flex flex-col gap-5">
        <div>
          <h3 className="font-bold text-stone-800 text-lg">새 계정 생성</h3>
          <p className="text-xs text-stone-500 mt-1">
            생성 즉시 로그인 가능합니다. 비밀번호는 최소 8자.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <Field label="이름">
            <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="이메일">
            <input
              className="input-field"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="비밀번호 (최소 8자)">
            <input
              className="input-field"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="역할">
            <select
              className="ui-select"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRow["role"])}
            >
              <option value="admin">관리자 (모든 권한)</option>
              <option value="editor">편집자 (사업장/검수/수집)</option>
              <option value="viewer">조회자 (읽기 전용)</option>
            </select>
          </Field>
          {error && (
            <div className="text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-200/70">
          <button
            type="button"
            onClick={onClose}
            className="glass-button rounded-xl px-4 py-2 text-sm font-bold text-stone-700"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={pending}
            className="rounded-xl px-4 py-2 text-sm font-bold text-white bg-primary hover:bg-primary/90 disabled:opacity-50"
          >
            {pending ? "생성 중…" : "생성"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ResetPasswordModal({
  user,
  onClose,
  onDone,
}: {
  user: UserRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/admin/users/" + user.userId + "/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="glass-panel rounded-3xl w-[420px] max-w-[92vw] p-6 flex flex-col gap-5">
        <div>
          <h3 className="font-bold text-stone-800 text-lg">비밀번호 재설정</h3>
          <p className="text-xs text-stone-500 mt-1">
            대상: {user.name} ({user.email})
          </p>
        </div>
        <Field label="새 비밀번호 (최소 8자)">
          <input
            className="input-field"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error && (
          <div className="text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
            {error}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-200/70">
          <button
            type="button"
            onClick={onClose}
            className="glass-button rounded-xl px-4 py-2 text-sm font-bold text-stone-700"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={pending}
            className="rounded-xl px-4 py-2 text-sm font-bold text-white bg-primary hover:bg-primary/90 disabled:opacity-50"
          >
            {pending ? "변경 중…" : "변경"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wide">
        {label}
      </span>
      {children}
    </div>
  );
}
