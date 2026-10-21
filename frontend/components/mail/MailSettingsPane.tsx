"use client";

// 메일 설정 화면(G2-12) — 스팸 설정·보관함 용량 배분·외부 메일 프로그램(IMAP/SMTP, 306) + (관리자) 사용자별 총용량 할당.

import { useCallback, useEffect, useState } from "react";
import { AtSign, Check, Download, HardDrive, Loader2, Mail, Settings2, ShieldAlert, Users } from "lucide-react";
import { CdButton } from "@/components/cdash/CdButton";
import { CdCheckbox, CdInput, CdSelect } from "@/components/cdash/CdField";
import { useCdToast } from "@/components/cdash/CdToast";
import { MailAddressManager } from "@/components/mail/MailAddressManager";
import { MailAliasManager } from "@/components/mail/MailAliasManager";
import { MailExternalClientSection } from "@/components/mail/MailExternalClientSection";
import { MailImportManager } from "@/components/mail/MailImportManager";
import { MailQuotaModal } from "@/components/mail/MailQuotaModal";
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
  const [quotaModalOpen, setQuotaModalOpen] = useState(false);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full cd-text-faint">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 flex flex-col gap-4">
      <h2 className="text-base font-bold cd-text flex items-center gap-1.5">
        <Settings2 className="w-4 h-4" /> 메일 설정
      </h2>

      {/* 넓은 화면(2xl+)의 관리자: 왼쪽 = 개인·관리 설정, 오른쪽 = 회사 주소(직원별 카드). 좁으면 위아래로 쌓는다. */}
      <div className={adminList ? "grid gap-4 items-start 2xl:grid-cols-[minmax(0,34rem)_minmax(0,1fr)]" : ""}>
      <div className="flex flex-col gap-4 min-w-0 max-w-3xl">

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

      <div>
        <CdButton variant="primary" loading={saving} icon={<Check className="w-4 h-4" />} onClick={save}>
          설정 저장
        </CdButton>
      </div>

      {/* 메일 가져오기(281) — 전 직원. 아마란스 백업 ZIP·.eml 을 본인 메일함으로 */}
      <section className="rounded-xl border cd-border-c p-4 flex flex-col gap-2">
        <h3 className="text-sm font-bold cd-text flex items-center gap-1.5">
          <Download className="w-4 h-4" /> 메일 가져오기
        </h3>
        <p className="text-xs cd-text-faint">아마란스 메일함 백업(ZIP)이나 .eml 파일로 예전 메일을 내 메일함에 옮깁니다.</p>
        <MailImportManager />
      </section>

      {/* 외부 메일 프로그램(아웃룩 등 IMAP/SMTP, 306) — 관리자가 켜면 전 직원에게 보인다 */}
      <MailExternalClientSection isAdmin={!!adminList} />

      {/* 관리자 — 인원별 용량 배분(조직도 모달, G2-13) */}
      {adminList && (
        <section className="rounded-xl border cd-border-c p-4 flex flex-col gap-2">
          <h3 className="text-sm font-bold cd-text flex items-center gap-1.5">
            <Users className="w-4 h-4" /> 인원별 용량 배분 <span className="text-[10px] cd-text-faint font-medium">(관리자 전용)</span>
          </h3>
          <p className="text-xs cd-text-faint">조직도에서 인원을 선택해 메일·개인 문서함 용량을 할당합니다.</p>
          <div>
            <CdButton variant="soft" icon={<Users className="w-4 h-4" />} onClick={() => setQuotaModalOpen(true)}>
              인원별 용량 배분
            </CdButton>
          </div>
        </section>
      )}

      {/* 관리자 — 별칭·배포리스트(G5, 메일 P4) */}
      {adminList && (
        <section className="rounded-xl border cd-border-c p-4 flex flex-col gap-2">
          <h3 className="text-sm font-bold cd-text flex items-center gap-1.5">
            <AtSign className="w-4 h-4" /> 별칭 · 배포리스트 <span className="text-[10px] cd-text-faint font-medium">(관리자 전용)</span>
          </h3>
          <p className="text-xs cd-text-faint">
            sales@ 같은 대표 주소(별칭)나 all@ 같은 배포리스트를 만들고 수신 인원을 지정합니다. 이 주소로 수신된 메일은 지정 인원 모두의 받은편지함에 배달됩니다.
          </p>
          <MailAliasManager
            mailboxes={adminList.map((m) => ({ mailboxId: m.mailboxId, address: m.address, displayName: m.displayName || m.address }))}
          />
        </section>
      )}
      </div>

      {/* 관리자 — 회사 주소(다중 도메인, 280) */}
      {adminList && (
        <section className="rounded-xl border cd-border-c p-4 flex flex-col gap-2 min-w-0">
          <h3 className="text-sm font-bold cd-text flex items-center gap-1.5">
            <Mail className="w-4 h-4" /> 회사 주소 <span className="text-[10px] cd-text-faint font-medium">(관리자 전용)</span>
          </h3>
          <p className="text-xs cd-text-faint">직원별 메일 주소와 발신(대표) 주소를 관리합니다. 대표 주소를 바꾸면 다음 발송부터 그 주소로 나갑니다.</p>
          <MailAddressManager />
        </section>
      )}
      </div>

      <MailQuotaModal open={quotaModalOpen} onClose={() => setQuotaModalOpen(false)} onSaved={load} />
    </div>
  );
}
