"use client";

// 외부 메일 프로그램(아웃룩 등) 연결 — 메일 설정 화면 섹션(306).
// 직원: 서버 정보 확인 + 메일 전용 앱 비밀번호 발급·폐기(평문은 발급 직후 한 번만 보인다).
// 관리자: 연결 사용 여부·서버 주소. 꺼져 있으면 직원에게는 섹션을 보이지 않는다.
// 설계: docs/mail-external-client-plan.md

import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, MonitorSmartphone, Plus, Trash2 } from "lucide-react";
import { CdButton } from "@/components/cdash/CdButton";
import { CdCheckbox, CdInput } from "@/components/cdash/CdField";
import { CdHelp } from "@/components/cdash/CdHelp";
import { useCdToast } from "@/components/cdash/CdToast";
import type { AppPasswordItem, ExternalClientConfig } from "@/lib/mail/app-passwords";

function when(iso: string | null): string {
  if (!iso) return "사용 기록 없음";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function MailExternalClientSection({ isAdmin }: { isAdmin: boolean }) {
  const { toast } = useCdToast();
  const [config, setConfig] = useState<ExternalClientConfig | null>(null);
  const [draft, setDraft] = useState<ExternalClientConfig | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [passwords, setPasswords] = useState<AppPasswordItem[]>([]);
  const [label, setLabel] = useState("");
  const [issued, setIssued] = useState<{ label: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/mail/external-client");
    if (!r.ok) return;
    const d = await r.json();
    setConfig(d.config);
    setDraft(d.config);
    setUsername(d.username ?? null);
    setPasswords(Array.isArray(d.passwords) ? d.passwords : []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("복사했습니다.", "success");
    } catch {
      toast("복사하지 못했습니다. 직접 선택해 복사하세요.", "warn");
    }
  };

  const create = async () => {
    if (!label.trim()) {
      toast("앱 비밀번호 이름을 입력하세요(예: 사무실 아웃룩).", "warn");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/mail/external-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast(d.error ?? "앱 비밀번호를 만들지 못했습니다.", "error");
        return;
      }
      setIssued({ label: d.item.label, password: d.password });
      setLabel("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (p: AppPasswordItem) => {
    if (!window.confirm(`'${p.label}' 앱 비밀번호를 폐기할까요? 이 비밀번호를 쓰는 메일 프로그램은 1분 안에 연결이 끊깁니다.`)) return;
    const r = await fetch(`/api/mail/external-client?id=${encodeURIComponent(p.appPasswordId)}`, { method: "DELETE" });
    if (r.ok) {
      toast("앱 비밀번호를 폐기했습니다.", "success");
      if (issued && issued.label === p.label) setIssued(null);
      await load();
    } else {
      toast("폐기하지 못했습니다.", "error");
    }
  };

  const saveConfig = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const r = await fetch("/api/mail/external-client", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast(d.error ?? "저장하지 못했습니다.", "error");
        return;
      }
      toast("외부 메일 프로그램 연결 설정을 저장했습니다.", "success");
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!config || (!config.enabled && !isAdmin)) return null;

  return (
    <section className="rounded-xl border cd-border-c p-4 flex flex-col gap-3">
      <h3 className="text-sm font-bold cd-text flex items-center gap-1.5">
        <MonitorSmartphone className="w-4 h-4" /> 외부 메일 프로그램
        <CdHelp topic="mail.external-client" />
      </h3>

      {isAdmin && draft && (
        <div className="rounded-lg border cd-border-c px-3 py-2 flex flex-col gap-2">
          <p className="text-xs font-bold cd-text">
            연결 설정 <span className="text-[10px] cd-text-faint font-medium">(관리자 전용)</span>
          </p>
          <CdCheckbox
            label="아웃룩 등 외부 메일 프로그램 연결 허용"
            checked={draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          />
          <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_6rem] gap-2">
            <CdInput label="받는 메일 서버(IMAP)" value={draft.imapHost} onChange={(e) => setDraft({ ...draft, imapHost: e.target.value })} />
            <CdInput label="포트" type="number" value={draft.imapPort} onChange={(e) => setDraft({ ...draft, imapPort: Number(e.target.value) })} />
            <CdInput label="보내는 메일 서버(SMTP)" value={draft.smtpHost} onChange={(e) => setDraft({ ...draft, smtpHost: e.target.value })} />
            <CdInput label="포트" type="number" value={draft.smtpPort} onChange={(e) => setDraft({ ...draft, smtpPort: Number(e.target.value) })} />
          </div>
          <p className="text-xs cd-text-faint">끄면 직원 화면에서 이 섹션이 사라지고, 붙어 있던 메일 프로그램은 1분 안에 연결이 끊깁니다.</p>
          <div>
            <CdButton variant="soft" loading={busy} onClick={saveConfig}>
              연결 설정 저장
            </CdButton>
          </div>
        </div>
      )}

      {config.enabled ? (
        <>
          <p className="text-xs cd-text-faint">
            아웃룩·휴대폰 기본 메일 앱 등에서 이 메일함을 쓸 때 아래 정보를 입력합니다. 비밀번호는 앱 로그인 비밀번호가 아니라 여기서 만든
            앱 비밀번호를 씁니다.
          </p>
          <table className="text-xs cd-text w-full">
            <tbody>
              <tr className="border-b cd-border-c">
                <th className="text-left font-medium cd-text-muted py-1.5 pr-3 w-36">받는 메일(IMAP)</th>
                <td className="py-1.5">
                  {config.imapHost} · 포트 {config.imapPort} · SSL/TLS
                </td>
              </tr>
              <tr className="border-b cd-border-c">
                <th className="text-left font-medium cd-text-muted py-1.5 pr-3">보내는 메일(SMTP)</th>
                <td className="py-1.5">
                  {config.smtpHost} · 포트 {config.smtpPort} · SSL/TLS · 인증 사용
                </td>
              </tr>
              <tr>
                <th className="text-left font-medium cd-text-muted py-1.5 pr-3">사용자 이름</th>
                <td className="py-1.5">{username ?? "메일함이 아직 없습니다(메일을 한 번 보내거나 받으면 만들어집니다)."}</td>
              </tr>
            </tbody>
          </table>

          {issued && (
            <div className="rounded-lg border cd-border-c px-3 py-2 flex flex-col gap-1.5" role="status">
              <p className="text-xs font-bold cd-text">
                <KeyRound className="w-3.5 h-3.5 inline -mt-0.5" /> &apos;{issued.label}&apos; 앱 비밀번호
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="text-base font-bold cd-text tracking-wider select-all">{issued.password}</code>
                <CdButton size="sm" variant="ghost" icon={<Copy className="w-3.5 h-3.5" />} onClick={() => copy(issued.password)}>
                  복사
                </CdButton>
              </div>
              <p className="text-xs" style={{ color: "var(--cd-warning)" }}>이 창을 벗어나면 다시 볼 수 없습니다. 지금 메일 프로그램에 입력하세요. 띄어쓰기는 넣지 않아도 됩니다.</p>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            {passwords.map((p) => (
              <div key={p.appPasswordId} className="rounded-lg border cd-border-c px-3 py-2 flex flex-wrap items-center gap-2">
                <KeyRound className="w-4 h-4 cd-text-faint" />
                <span className="text-sm font-medium cd-text">{p.label}</span>
                <span className="text-xs cd-text-faint">
                  만든 날 {when(p.createdAt).slice(0, 10)} · 마지막 사용 {when(p.lastUsedAt)}
                  {p.lastUsedIp ? ` (${p.lastUsedIp})` : ""}
                </span>
                <span className="flex-1" />
                <CdButton size="sm" variant="ghost" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={() => revoke(p)}>
                  폐기
                </CdButton>
              </div>
            ))}
            {!passwords.length && <p className="text-xs cd-text-faint">만든 앱 비밀번호가 없습니다.</p>}
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="w-56">
              <CdInput label="앱 비밀번호 이름" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="예: 사무실 아웃룩" maxLength={40} />
            </div>
            <CdButton variant="primary" icon={<Plus className="w-4 h-4" />} loading={busy} onClick={create}>
              앱 비밀번호 만들기
            </CdButton>
          </div>
        </>
      ) : (
        <p className="text-xs cd-text-faint">연결이 꺼져 있어 직원 화면에는 이 섹션이 보이지 않습니다.</p>
      )}
    </section>
  );
}
