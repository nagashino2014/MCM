"use client";

// 회사 주소(다중 도메인) 관리(280, koensain.com 1단계·관리자 전용) — 메일 설정 화면의 관리자 섹션에서 사용.
// 메일함마다 여러 주소(.app 수신 + .com 발신)를 두고, 대표 주소(=발신 주소)를 사람 단위로 바꾼다.
// 설계: docs/company-email-com-domain-phase1.md §5.5.

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, AtSign, Plus, Star, Trash2, UserPlus } from "lucide-react";
import { CdButton } from "@/components/cdash/CdButton";
import { CdCheckbox, CdInput } from "@/components/cdash/CdField";
import { CdHelp } from "@/components/cdash/CdHelp";
import { useCdToast } from "@/components/cdash/CdToast";
import type { AddressAdminList, AddressAdminRow } from "@/lib/mail/addresses-admin";

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const r = await fetch("/api/mail/addresses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: r.ok, data };
}

export function MailAddressManager() {
  const { toast } = useCdToast();
  const [list, setList] = useState<AddressAdminList | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/mail/addresses", { cache: "no-store" });
      if (r.ok) setList((await r.json()) as AddressAdminList);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (key: string, body: Record<string, unknown>, success: string) => {
    setBusy(key);
    try {
      const { ok, data } = await post(body);
      if (ok) {
        toast(success, "success");
        await load();
        return data;
      }
      toast(String(data.error ?? "처리에 실패했습니다."), "error");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const domains = list?.domains ?? [];
  const sendable = useMemo(() => new Set(domains.filter((d) => d.sendEnabled).map((d) => d.domain)), [domains]);
  const rows = useMemo(() => {
    const s = filter.trim().toLowerCase();
    const all = list?.rows ?? [];
    if (!s) return all;
    return all.filter((r) => r.displayName.toLowerCase().includes(s) || r.addresses.some((a) => a.address.includes(s)));
  }, [list, filter]);

  const toggleSend = async (domain: string, enabled: boolean) => {
    const msg = enabled
      ? `${domain} 발신을 켭니다. SES 에서 이 도메인의 DKIM 검증이 끝났는지 확인하셨나요?`
      : `${domain} 발신을 끕니다. 대표 주소가 ${domain} 인 직원은 발송이 멈춥니다. 계속할까요?`;
    if (!window.confirm(msg)) return;
    await run(`send:${domain}`, { op: "domain-send", domain, enabled }, enabled ? "발신을 켰습니다." : "발신을 껐습니다.");
  };

  const bulkRegister = async (domain: string) => {
    if (!window.confirm(`재직자 전원에게 '{앱 주소 앞자리}@${domain}' 주소를 보조 주소로 등록합니다. 대표(발신) 주소는 바뀌지 않습니다. 계속할까요?`)) return;
    const data = await run(`bulk:${domain}`, { op: "bulk-register", domain }, "일괄 등록을 마쳤습니다.");
    const failures = Array.isArray(data?.failures) ? (data!.failures as { who: string; error: string }[]) : [];
    if (data) {
      toast(`등록 ${Number(data.created ?? 0)}건 · 건너뜀 ${Number(data.skipped ?? 0)}건 · 메일함 생성 ${Number(data.mailboxesCreated ?? 0)}건`, "info");
    }
    if (failures.length) {
      window.alert(`등록하지 못한 주소 ${failures.length}건:\n` + failures.map((f) => `- ${f.who}: ${f.error}`).join("\n"));
    }
  };

  const makePrimary = async (row: AddressAdminRow, address: string) => {
    if (!window.confirm(`${row.displayName} 님의 발신 주소를 ${address} 로 바꿉니다. 다음 발송부터 적용됩니다.`)) return;
    await run(`primary:${row.mailboxId}`, { op: "primary", mailboxId: row.mailboxId, address }, "대표 주소를 바꿨습니다.");
  };

  const removeAddress = async (row: AddressAdminRow, address: string) => {
    if (!window.confirm(`${row.displayName} 님의 주소 ${address} 를 지울까요?`)) return;
    await run(`remove:${row.mailboxId}`, { op: "remove", mailboxId: row.mailboxId, address }, "주소를 지웠습니다.");
  };

  const addAddress = async (row: AddressAdminRow) => {
    const input = window.prompt(`${row.displayName} 님에게 추가할 주소를 입력하세요(예: ${row.localPart}@koensain.com).`);
    if (!input?.trim()) return;
    await run(`add:${row.mailboxId}`, { op: "add", mailboxId: row.mailboxId, address: input.trim() }, "주소를 추가했습니다.");
  };

  if (loading && !list) return <p className="text-xs cd-text-faint">불러오는 중입니다.</p>;
  if (!list) return <p className="text-xs cd-error-text">회사 주소 정보를 불러오지 못했습니다.</p>;

  return (
    <div className="flex flex-col gap-3">
      {/* 도메인 — 발신 사용 여부 */}
      <div className="flex flex-col gap-1.5">
        {domains.map((d) => (
          <div key={d.domain} className="rounded-xl border cd-border-c px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <AtSign className="w-3.5 h-3.5 cd-text-primary shrink-0" />
            <span className="text-[12.5px] font-semibold cd-text">{d.domain}</span>
            <span className="text-[11px] cd-text-faint">{d.inboundMode === "ses" ? "수신: 앱(SES)" : "수신: 외부(아마란스)"}</span>
            <div className="flex-1" />
            {d.inboundMode === "external" && (
              <CdButton
                size="sm"
                variant="soft"
                icon={<UserPlus className="w-3.5 h-3.5" />}
                loading={busy === `bulk:${d.domain}`}
                onClick={() => bulkRegister(d.domain)}
              >
                주소 일괄 등록
              </CdButton>
            )}
            <CdCheckbox
              label="발신 사용"
              checked={d.sendEnabled}
              disabled={busy === `send:${d.domain}`}
              onChange={(e) => toggleSend(d.domain, e.target.checked)}
            />
          </div>
        ))}
      </div>
      {list.noMailboxCount > 0 && (
        <p className="text-xs cd-text-faint">메일함이 아직 없는 재직자 {list.noMailboxCount}명 — 주소 일괄 등록 시 메일함을 함께 만듭니다.</p>
      )}

      {/* 직원별 주소 */}
      <div className="flex items-end gap-2">
        <div className="flex-1 max-w-xs">
          <CdInput placeholder="이름·주소 검색" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <CdHelp label="회사 주소 도움말">
          <p>대표 주소는 메일을 보낼 때 쓰는 주소입니다. 대표를 바꿔도 기존 주소로 오는 메일은 계속 받습니다.</p>
          <p className="mt-1">koensain.com 으로 오는 회신은 아마란스에 먼저 도착합니다. 앱에서도 보려면 아마란스 메일 → 환경설정 → 메일 자동 전달에 본인의 koensain.app 주소를 등록하세요.</p>
          <p className="mt-1">문제가 있으면 대표 주소를 koensain.app 으로 되돌리면 다음 발송부터 원래대로 돌아갑니다.</p>
        </CdHelp>
      </div>
      <div className="flex flex-col gap-1.5">
        {rows.map((row) => {
          const mismatch = row.emailLocal != null && row.emailLocal !== row.localPart;
          return (
            <div key={row.mailboxId} className="rounded-xl border cd-border-c px-3 py-2 flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[12.5px] font-semibold cd-text">{row.displayName}</span>
                {mismatch && (
                  <span className="text-[11px] cd-warn-text inline-flex items-center gap-1" title={`사용자 관리 이메일 앞자리: ${row.emailLocal}`}>
                    <AlertTriangle className="w-3 h-3" /> 이메일 앞자리({row.emailLocal})와 다름 — 아마란스 주소 확인 필요
                  </span>
                )}
                <div className="flex-1" />
                <CdButton size="sm" variant="ghost" icon={<Plus className="w-3.5 h-3.5" />} loading={busy === `add:${row.mailboxId}`} onClick={() => addAddress(row)}>
                  주소 추가
                </CdButton>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {row.addresses.map((a) => (
                  <div key={a.address} className="flex items-center gap-1 border cd-border-c rounded-lg px-2 py-1">
                    {a.isPrimary && <Star className="w-3 h-3 cd-text-primary" aria-label="대표 주소" />}
                    <span className={`text-[12px] ${a.isPrimary ? "font-semibold cd-text" : "cd-text-muted"}`}>{a.address}</span>
                    {a.isPrimary ? (
                      <span className="text-[10px] cd-text-primary">대표</span>
                    ) : (
                      <>
                        <CdButton
                          size="sm"
                          variant="ghost"
                          disabled={!sendable.has(a.domain) || busy === `primary:${row.mailboxId}`}
                          title={sendable.has(a.domain) ? "이 주소로 발신" : "이 도메인은 발신이 꺼져 있습니다"}
                          onClick={() => makePrimary(row, a.address)}
                        >
                          대표로
                        </CdButton>
                        {a.source !== "legacy" && (
                          <CdButton
                            size="sm"
                            variant="ghost"
                            className="cd-error-text"
                            title="주소 삭제"
                            aria-label={`${a.address} 삭제`}
                            icon={<Trash2 className="w-3.5 h-3.5" />}
                            disabled={busy === `remove:${row.mailboxId}`}
                            onClick={() => removeAddress(row, a.address)}
                          />
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <p className="text-xs cd-text-faint">표시할 메일함이 없습니다.</p>}
      </div>
    </div>
  );
}
