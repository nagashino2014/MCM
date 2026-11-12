"use client";

import { useEffect, useState } from "react";
import { Loader2, Send, UserRound } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";

export interface BillingContactView {
  name: string;
  title: string | null;
  department: string | null;
  phone: string | null;
  email: string;
}

export interface InvoiceRequestTarget {
  contractId: string;
  milestoneId: string;
  contractTitle: string | null;
  facilityName: string | null;
  stageLabel: string | null;
  amount: number | null;
  /** 발주처에 세금계산서 담당자가 없음 — 담당자 정보 입력이 필수다. */
  billingContactMissing: boolean;
  /** 현재 등록된 계산서 담당자 — 변경 여부를 확인할 수 있게 보여 준다. */
  billingContacts: BillingContactView[];
}

const EMPTY_CONTACT = { name: "", title: "", department: "", phone: "", email: "" };
const CONTACT_FIELDS: Array<{ key: keyof typeof EMPTY_CONTACT; label: string; placeholder: string; type?: string }> = [
  { key: "name", label: "성명", placeholder: "홍길동" },
  { key: "title", label: "직급", placeholder: "과장" },
  { key: "department", label: "부서", placeholder: "재무팀" },
  { key: "phone", label: "연락처", placeholder: "010-0000-0000", type: "tel" },
  { key: "email", label: "이메일", placeholder: "tax@example.com", type: "email" },
];
const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/**
 * H10 — 발행 요청 대화상자(2026-11-02).
 * 발주처에 계산서 담당자가 없으면 담당자 정보를 필수로 받고, 있으면 현재 담당자를 보여 주며
 * [담당자 변경]으로 새 담당자를 입력할 수 있다(변경 시 기존 담당자에게서 '계산서' 태그만 빠진다).
 */
export function InvoiceRequestDialog({
  target,
  onClose,
  onRequested,
}: {
  target: InvoiceRequestTarget | null;
  onClose: () => void;
  onRequested: () => void;
}) {
  const [note, setNote] = useState("");
  const [contact, setContact] = useState(EMPTY_CONTACT);
  // 서버가 담당자 필요(422)를 알려 오면 목록 응답과 무관하게 입력란을 연다.
  const [needContact, setNeedContact] = useState(false);
  // 담당자가 있을 때 [담당자 변경]을 눌러 새 담당자를 입력 중인지.
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNote("");
    setContact(EMPTY_CONTACT);
    setNeedContact(Boolean(target?.billingContactMissing));
    setChanging(false);
    setError(null);
  }, [target]);

  if (!target) return null;

  const editing = needContact || changing;
  const missing = editing ? CONTACT_FIELDS.filter((f) => !contact[f.key].trim()) : [];
  const emailInvalid = editing && contact.email.trim() !== "" && !isEmail(contact.email);
  const canSubmit = !busy && missing.length === 0 && !emailInvalid;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/contracts/${target.contractId}/milestones/${target.milestoneId}/invoice-request`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ note, billingContact: editing ? contact : undefined }),
        }
      );
      if (res.ok) {
        onRequested();
        return;
      }
      const j = await res.json().catch(() => ({}));
      if (j.code === "billing_contact_required") setNeedContact(true);
      setError(j.error ?? "발행 요청에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <CdModal
      open
      onClose={onClose}
      title="세금계산서 발행 요청"
      size="md"
      footer={
        <>
          <button type="button" onClick={onClose} className="cd-btn cd-btn-ghost text-[12px] px-3 py-1.5">
            취소
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="cd-btn cd-btn-primary text-[12px] px-3 py-1.5 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            발행 요청
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[12px]">
        <div className="rounded-lg border cd-border-c px-3 py-2">
          <div className="cd-text font-medium truncate">{target.contractTitle ?? "제목 없음"}</div>
          <div className="cd-text-faint truncate">{target.facilityName ?? "발주처 미상"}</div>
          <div className="flex items-center justify-between mt-1">
            <span className="cd-text-muted">{target.stageLabel ?? "대금 단계"}</span>
            <span className="font-mono cd-text tabular-nums">
              {target.amount != null ? `${target.amount.toLocaleString("ko-KR")}원` : "-"}
            </span>
          </div>
        </div>

        {!needContact && target.billingContacts.length > 0 && (
          <div className="rounded-lg border cd-border-c px-3 py-2.5 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-semibold cd-text">세금계산서 담당자</span>
              <button
                type="button"
                onClick={() => {
                  setChanging((v) => !v);
                  setContact(EMPTY_CONTACT);
                }}
                className="cd-btn cd-btn-ghost text-[11px] px-2 py-1"
              >
                {changing ? "변경 취소" : "담당자 변경"}
              </button>
            </div>
            {target.billingContacts.map((c, i) => (
              <div key={`${c.email}:${i}`} className={"flex items-start gap-2" + (changing ? " opacity-50" : "")}>
                <UserRound className="w-3.5 h-3.5 cd-text-faint mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="cd-text">
                    <span className="font-medium">{c.name}</span>
                    {[c.title, c.department].filter(Boolean).length > 0 && (
                      <span className="cd-text-muted"> · {[c.title, c.department].filter(Boolean).join(" · ")}</span>
                    )}
                  </div>
                  <div className="cd-text-faint truncate">{[c.phone, c.email].filter(Boolean).join(" · ")}</div>
                </div>
              </div>
            ))}
            {!changing && <p className="text-[11px] cd-text-faint">담당자가 바뀌었다면 [담당자 변경]으로 새 담당자를 입력하세요.</p>}
          </div>
        )}

        {editing && (
          <fieldset className="rounded-lg border cd-border-c px-3 py-2.5 flex flex-col gap-2">
            <legend className="px-1 text-[12px] font-semibold cd-text">{needContact ? "세금계산서 담당자 (필수)" : "새 세금계산서 담당자"}</legend>
            <p className="cd-text-muted">
              {needContact
                ? "이 발주처에 세금계산서 담당자가 등록되어 있지 않습니다. 계산서를 받을 담당자를 입력하면 사업장 담당자로 함께 등록됩니다."
                : "입력한 담당자가 이 발주처의 세금계산서 담당자가 됩니다. 기존 담당자는 사업장 담당자로 남고 계산서 담당만 해제됩니다."}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {CONTACT_FIELDS.map((f) => (
                <label key={f.key} className={f.key === "email" ? "col-span-2" : undefined}>
                  <span className="cd-label-text">{f.label}</span>
                  <input
                    className="cd-input mt-0.5"
                    type={f.type ?? "text"}
                    value={contact[f.key]}
                    placeholder={f.placeholder}
                    aria-label={`담당자 ${f.label}`}
                    aria-required="true"
                    onChange={(e) => setContact((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
            {emailInvalid && <div className="cd-error-text text-[11px]">이메일 형식이 올바르지 않습니다.</div>}
          </fieldset>
        )}

        <label>
          <span className="cd-label-text">요청 메모 (선택)</span>
          <textarea
            className="cd-input mt-0.5 min-h-[64px]"
            value={note}
            maxLength={200}
            placeholder="발행 담당자에게 전달할 내용"
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        {error && <div className="cd-error-text text-[11px]">{error}</div>}
      </div>
    </CdModal>
  );
}
