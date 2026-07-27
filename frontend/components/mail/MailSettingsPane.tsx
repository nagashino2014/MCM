"use client";

// 메일 설정 화면(G2-12) — 스팸 설정·보관함 용량 배분·외부 클라이언트(POP3/IMAP) 안내 + (관리자) 사용자별 총용량 할당.

import { useCallback, useEffect, useState } from "react";
import { Check, HardDrive, Loader2, Settings2, ShieldAlert, Users } from "lucide-react";
import { CdButton } from "@/components/cdash/CdButton";
import { CdCheckbox, CdInput, CdSelect } from "@/components/cdash/CdField";
import { useCdToast } from "@/components/cdash/CdToast";
import type { MailboxSettings } from "@/lib/mail/spam";

interface AdminMailbox {
  mailboxId: string;
  address: string;
  displayName: string;
  quotaBytes: number | null;
  usedBytes: number | null;
}

const GB = 1024 * 1024 * 1024;

export function MailSettingsPane() {
  const { toast } = useCdToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [quotaBytes, setQuotaBytes] = useState<number | null>(null);
  const [keywords, setKeywords] = useState("");
  const [retentionDays, setRetentionDays] = useState(30);
  const [afterRetention, setAfterRetention] = useState<"delete" | "keep">("delete");
  const [autoDelete, setAutoDelete] = useState(false);
  const [hideRemote, setHideRemote] = useState(true);
  const [split, setSplit] = useState({ inbox: 50, sent: 25, archive: 25 });
  const [adminList, setAdminList] = useState<AdminMailbox[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/mail/settings");
      if (r.ok) {
        const d = await r.json();
        const s = (d.settings ?? {}) as Required<MailboxSettings>;
        setQuotaBytes(d.quotaBytes ?? null);
        setKeywords((s.spamKeywords ?? []).join(", "));
        setRetentionDays(s.spamRetentionDays ?? 30);
        setAfterRetention(s.spamAfterRetention ?? "delete");
        setAutoDelete(s.spamAutoDelete === true);
        setHideRemote(s.spamHideRemote !== false);
        setSplit(s.quotaSplit ?? { inbox: 50, sent: 25, archive: 25 });
      }
      // 관리자면 사용자별 용량 목록(403 이면 숨김).
      const a = await fetch("/api/mail/settings?list=1", { method: "PUT" });
      if (a.ok) {
        const d = await a.json();
        setAdminList(Array.isArray(d.mailboxes) ? d.mailboxes : []);
      } else {
        setAdminList(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    const sum = split.inbox + split.sent + split.archive;
    if (sum !== 100) {
      toast(`용량 배분 합계가 100%가 되어야 합니다(현재 ${sum}%).`, "warn");
      return;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/mail/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spamKeywords: keywords.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean),
          spamRetentionDays: Math.max(1, Math.round(retentionDays)),
          spamAfterRetention: afterRetention,
          spamAutoDelete: autoDelete,
          spamHideRemote: hideRemote,
          quotaSplit: split,
        }),
      });
      if (r.ok) toast("메일 설정을 저장했습니다.", "success");
      else toast("저장에 실패했습니다.", "error");
    } finally {
      setSaving(false);
    }
  };

  const saveQuota = async (m: AdminMailbox, gbValue: number) => {
    const r = await fetch("/api/mail/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mailboxId: m.mailboxId, quotaBytes: Math.round(gbValue * GB) }),
    });
    if (r.ok) {
      toast(`${m.address} 총용량을 ${gbValue}GB 로 설정했습니다.`, "success");
      load();
    } else toast("용량 설정 실패", "error");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full cd-text-faint">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 flex flex-col gap-4 max-w-3xl">
      <h2 className="text-base font-bold cd-text flex items-center gap-1.5">
        <Settings2 className="w-4 h-4" /> 메일 설정
      </h2>

      {/* 스팸 설정 */}
      <section className="rounded-xl border cd-border-c p-4 flex flex-col gap-3">
        <h3 className="text-sm font-bold cd-text flex items-center gap-1.5">
          <ShieldAlert className="w-4 h-4" /> 스팸 메일 설정
        </h3>
        <CdInput
          label="키워드 필터"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder="예: 광고, 대출, casino (콤마로 구분)"
          hint="제목·발신 주소에 포함되면 수신 시 자동으로 스팸함으로 분류합니다."
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <CdInput
            label="스팸함 보관기간(일)"
            type="number"
            min={1}
            value={retentionDays}
            onChange={(e) => setRetentionDays(Number(e.target.value))}
          />
          <CdSelect label="보관기간 경과 후 처리" value={afterRetention} onChange={(e) => setAfterRetention(e.target.value as "delete" | "keep")}>
            <option value="delete">영구 삭제</option>
            <option value="keep">계속 보관</option>
          </CdSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <CdCheckbox label="스팸으로 분류된 메일을 스팸함에 보관하지 않고 즉시 삭제" checked={autoDelete} onChange={(e) => setAutoDelete(e.target.checked)} />
          <CdCheckbox label="스팸 메일 본문의 이미지·링크 숨기기" checked={hideRemote} onChange={(e) => setHideRemote(e.target.checked)} />
        </div>
      </section>

      {/* 용량 배분 */}
      <section className="rounded-xl border cd-border-c p-4 flex flex-col gap-3">
        <h3 className="text-sm font-bold cd-text flex items-center gap-1.5">
          <HardDrive className="w-4 h-4" /> 보관함 용량 배분
        </h3>
        <p className="text-xs cd-text-faint">
          내 총용량 {quotaBytes != null ? `${(quotaBytes / GB).toFixed(1)} GB` : "무제한(관리자 미설정)"} 를 편지함별로 배분합니다(합계 100%).
        </p>
        <div className="grid grid-cols-3 gap-3">
          <CdInput label="받은편지함 %" type="number" min={0} max={100} value={split.inbox} onChange={(e) => setSplit({ ...split, inbox: Number(e.target.value) })} />
          <CdInput label="보낸편지함 %" type="number" min={0} max={100} value={split.sent} onChange={(e) => setSplit({ ...split, sent: Number(e.target.value) })} />
          <CdInput label="보관함 %" type="number" min={0} max={100} value={split.archive} onChange={(e) => setSplit({ ...split, archive: Number(e.target.value) })} />
        </div>
      </section>

      {/* 외부 클라이언트 안내 */}
      <section className="rounded-xl border cd-border-c p-4 flex flex-col gap-1.5">
        <h3 className="text-sm font-bold cd-text">외부 메일 클라이언트(POP3 / IMAP / SMTP)</h3>
        <p className="text-xs cd-text-faint leading-relaxed">
          아웃룩 등 외부 클라이언트 연동(POP3/IMAP/SMTP 계정 발급)은 준비 중입니다. 현재는 웹메일과 모바일 앱에서 이용해 주세요.
          지원이 시작되면 이 화면에 서버 주소·포트·보안 설정 정보가 표시됩니다.
        </p>
      </section>

      <div>
        <CdButton variant="primary" loading={saving} icon={<Check className="w-4 h-4" />} onClick={save}>
          설정 저장
        </CdButton>
      </div>

      {/* 관리자 — 사용자별 총용량 */}
      {adminList && (
        <section className="rounded-xl border cd-border-c p-4 flex flex-col gap-2">
          <h3 className="text-sm font-bold cd-text flex items-center gap-1.5">
            <Users className="w-4 h-4" /> 사용자별 총용량 할당 <span className="text-[10px] cd-text-faint font-medium">(관리자 전용)</span>
          </h3>
          <ul className="divide-y cd-border-c">
            {adminList.map((m) => (
              <QuotaRow key={m.mailboxId} m={m} onSave={saveQuota} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function QuotaRow({ m, onSave }: { m: AdminMailbox; onSave: (m: AdminMailbox, gb: number) => void }) {
  const [gb, setGb] = useState(m.quotaBytes != null ? Number((m.quotaBytes / GB).toFixed(1)) : 5);
  return (
    <li className="py-2 flex items-center gap-2 text-sm">
      <span className="flex-1 min-w-0 truncate cd-text">{m.address}</span>
      <span className="text-xs cd-text-faint shrink-0">{m.quotaBytes != null ? `${(m.quotaBytes / GB).toFixed(1)}GB` : "미설정"}</span>
      <input
        type="number"
        min={0.5}
        step={0.5}
        value={gb}
        onChange={(e) => setGb(Number(e.target.value))}
        className="cd-input !w-24 text-right"
      />
      <span className="text-xs cd-text-faint">GB</span>
      <CdButton size="sm" variant="soft" onClick={() => onSave(m, gb)}>
        적용
      </CdButton>
    </li>
  );
}
