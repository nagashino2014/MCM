"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { AutoDateInput } from "@/components/ui/AutoDateInput";
import { FileDropZone } from "@/components/ui/FileDropZone";
import type { PurchaseContractDetail } from "@/lib/contracts/purchase/types";
import { purchaseApi, purchaseJson } from "@/lib/contracts/purchase/client";
import { ModalShell, num, str } from "./primitives";
import { PurchaseContractForm, purchaseFormStateFromRow, purchaseFormToBody, validatePurchaseForm } from "./PurchaseContractForm";

/**
 * 매입 변경계약 입력(331, 2026-11-02 사용자 요청) — 계약 정보 변경과 계약서 PDF 첨부를 한 창에서 한다.
 * 계약서 업로드는 신규 계약 입력과 이 창에서만 가능하다(상세 화면 즉시 업로드는 두지 않는다).
 * 매출 변경계약 모달처럼 첨부 종류를 '변경'(변경계약서)·'누락'(원 계약서)으로 고르며, 차수 표는 없고
 * 변경계약서 문서 수가 차수가 된다(N차 변경계약서 파일명).
 */
export function PurchaseChangeModal({
  detail,
  onClose,
  onSaved,
}: {
  detail: PurchaseContractDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<"info" | "document">("info");
  const [form, setForm] = useState(() => purchaseFormStateFromRow(detail.contract));
  const [changedAt, setChangedAt] = useState(new Date().toISOString().slice(0, 10));
  const [docType, setDocType] = useState<"amendment" | "contract">("amendment");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const amount = detail.milestones.reduce((acc, m) => acc + num(m.amount), 0);
  const id = str(detail.contract.purchase_contract_id);
  const amendmentCount = detail.documents.filter((d) => str(d.document_type) === "amendment").length;
  const hasOriginal = detail.documents.some((d) => str(d.document_type) === "contract");

  const submit = async () => {
    const formError = validatePurchaseForm(form);
    if (formError) {
      toast.show(formError, "error");
      setTab("info");
      return;
    }
    setSaving(true);
    try {
      await purchaseApi(`/api/purchase-contracts/${encodeURIComponent(id)}`, { method: "PATCH", ...purchaseJson(purchaseFormToBody(form)) });
      if (file) {
        const fd = new FormData();
        fd.set("documentType", docType);
        fd.set("documentDate", docType === "amendment" ? changedAt || new Date().toISOString().slice(0, 10) : form.contractDate || changedAt);
        fd.set("file", file);
        const res = await purchaseApi<{ duplicate?: boolean }>(`/api/purchase-contracts/${encodeURIComponent(id)}/documents`, { method: "POST", body: fd });
        if (res.duplicate) toast.show("이미 올린 파일과 같은 PDF라 문서는 추가하지 않았습니다.", "error");
      }
      toast.show("변경계약을 저장했습니다.", "success");
      onSaved();
    } catch (err) {
      toast.show("저장 실패: " + (err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="변경계약 입력" onClose={onClose} wide>
      <div className="border-b cd-border-c px-5 pt-4 flex gap-2">
        {([
          ["info", "계약 정보 변경"],
          ["document", "계약서 PDF"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={
              "rounded-t-xl px-3 py-2 text-xs border border-b-0 " +
              (tab === key ? "cd-card-bg cd-text-primary border-[color:var(--cd-primary)]" : "cd-surface-bg cd-text-faint cd-border-c")
            }
          >
            {label}
          </button>
        ))}
      </div>
      <div className="p-5 min-h-[420px]">
        {tab === "info" && (
          <div className="grid gap-3">
            <label className="grid gap-1 text-sm max-w-[240px]">
              <span className="font-semibold cd-text-muted">변경일</span>
              <AutoDateInput className="cd-input tabular-nums" value={changedAt} onChange={setChangedAt} />
              <span className="text-[11px] cd-text-faint">변경계약서 파일명의 날짜로 쓰입니다. 변경 내용은 메모에 적어 두세요.</span>
            </label>
            <PurchaseContractForm state={form} onChange={setForm} amount={amount} />
          </div>
        )}
        {tab === "document" && (
          <div className="grid gap-3">
            <div className="flex items-center gap-4 text-[12px] cd-text">
              {[
                { value: "amendment" as const, label: "변경", hint: `변경계약서 (${amendmentCount + 1}차)` },
                { value: "contract" as const, label: "누락", hint: hasOriginal ? "계약서(원 계약) 추가" : "계약서(원 계약) — 아직 없음" },
              ].map((opt) => (
                <label key={opt.value} className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="purchase-change-doc-type" checked={docType === opt.value} onChange={() => setDocType(opt.value)} />
                  <span className="font-semibold">{opt.label}</span>
                  <span className="cd-text-faint">{opt.hint}</span>
                </label>
              ))}
            </div>
            <FileDropZone value={file} onChange={setFile} hint={docType === "amendment" ? "변경계약서 PDF 1개 · 30MB 이하" : "원 계약서 PDF 1개 · 30MB 이하"} />
            <p className="text-[11px] cd-text-faint">
              원 계약 폴더에 <code>{docType === "amendment" ? `(변경일)계약명 매입 변경계약서${amendmentCount > 0 ? `(${amendmentCount + 1})` : ""}.pdf` : "(계약일)계약명 매입계약서.pdf"}</code>
              로 저장됩니다. 계약 입력 때 못 받은 원 계약서를 뒤늦게 올리는 경우 <b>누락</b>을 고르세요.
            </p>
          </div>
        )}
      </div>
      <div className="p-5 pt-0 border-t cd-border-c flex justify-end gap-2 mt-2">
        <button type="button" onClick={onClose} className="cd-btn cd-btn-ghost rounded-lg px-4 py-2 text-sm font-semibold cd-text-muted">닫기</button>
        <button type="button" onClick={submit} disabled={saving} className="rounded-lg px-4 py-2 text-sm font-semibold text-white cd-fill-primary disabled:opacity-60">
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </ModalShell>
  );
}
