"use client";

/**
 * 대행 실적 보고 이력(252) — 계약 상세의 "대행 실적 보고 정보" 카드 안에 들어간다.
 * IEPS 에서 체결·변경·완료 신고를 마치고 실적보고 출력(PDF)을 받아 여기에 쌓는다.
 * 대기열(/contracts/filings)에서 제출 완료로 처리한 건은 자동으로 줄이 생기고, PDF 는 여기서 붙인다.
 *
 * 발송(254): 대행 실적 보고서는 실무자가 허가 서류를 낼 때 함께 제출하는 서류라, PDF 가 붙으면 실무자에게
 * 메일·메신저로 보낸다. 실무자가 없으면 수행인력 설정으로 바로 갈 수 있게 경고를 남긴다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, FileText, Paperclip, Pencil, Plus, Send, Trash2, UserCog, X } from "lucide-react";
import { CdBadge, type CdBadgeTone } from "@/components/cdash/CdBadge";
import { CdDateInput } from "@/components/cdash/CdField";
import { useToast } from "@/components/ui/Toast";
import { FILINGS_ASSIST_MISSING_MESSAGE, launchFilingsAssist } from "@/lib/filings/assist-launch";
import {
  AGENCY_REPORT_KIND_LABEL,
  AGENCY_REPORT_KINDS,
  REPORT_DELIVERY_MODE_LABEL,
  REPORT_DELIVERY_MODES,
  REPORT_DELIVERY_STATUS_LABEL,
  type AgencyReportKind,
  type AgencyReportRow,
  type ReportDeliveryMode,
  type ReportDeliveryResult,
  type ReportDeliveryStatus,
} from "@/lib/filings/types";

interface FormState {
  reportKind: AgencyReportKind;
  reportedOn: string;
  receiptNo: string;
  note: string;
  file: File | null;
  removeFile: boolean;
  /** "" = 설정 기본값을 따른다 */
  deliveryMode: ReportDeliveryMode | "";
}

const emptyForm = (): FormState => ({
  reportKind: "conclude",
  reportedOn: "",
  receiptNo: "",
  note: "",
  file: null,
  removeFile: false,
  deliveryMode: "",
});

const KIND_TONE: Record<AgencyReportKind, CdBadgeTone> = {
  conclude: "info",
  amend: "warn",
  complete: "success",
};

const DELIVERY_TONE: Record<ReportDeliveryStatus, CdBadgeTone> = {
  sent: "success",
  held: "idle",
  no_recipient: "warn",
  failed: "error",
};

/** 발송 결과를 한 줄로 — 저장·발송 직후 토스트. */
function deliveryMessage(d: ReportDeliveryResult): { text: string; tone: "success" | "error" | "info" } {
  const names = d.recipients.map((r) => r.name).join(", ");
  const via = d.channels.map((c) => (c === "mail" ? "메일" : "메신저")).join("·");
  if (d.status === "sent") return { text: `실무자 ${names} 님에게 ${via}로 보냈습니다.${d.error ? ` (일부 실패: ${d.error})` : ""}`, tone: "success" };
  if (d.status === "held") return { text: "발송을 보류했습니다 — 보낼 때 [발송] 을 누르세요.", tone: "info" };
  if (d.status === "no_recipient") return { text: "실무자가 지정되지 않아 보내지 못했습니다 — 수행인력을 설정하세요.", tone: "error" };
  return { text: `발송 실패: ${d.error ?? "알 수 없는 오류"}`, tone: "error" };
}

export function AgencyReportList({
  contractId,
  onOpenStaffing,
  staffingOpen = false,
}: {
  contractId: string;
  /** 수행인력 설정 모달을 수행인력 탭으로 연다 */
  onOpenStaffing?: () => void;
  staffingOpen?: boolean;
}) {
  const toast = useToast();
  const [reports, setReports] = useState<AgencyReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  /** 신고 대기열 설정의 발송 기본값 — 읽을 권한이 없으면 null */
  const [defaultMode, setDefaultMode] = useState<ReportDeliveryMode | null>(null);
  /** null=폼 닫힘, ""=신규 추가, 그 외=수정 중인 reportId */
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/contracts/${encodeURIComponent(contractId)}/agency-reports`, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const body = (await res.json()) as { reports: AgencyReportRow[] };
      setReports(body.reports ?? []);
    } catch {
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, [contractId]);

  useEffect(() => {
    void load();
    setEditing(null);
  }, [load]);

  useEffect(() => {
    fetch("/api/filings/settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { settings?: { reportDelivery?: ReportDeliveryMode } } | null) => setDefaultMode(b?.settings?.reportDelivery ?? null))
      .catch(() => setDefaultMode(null));
  }, []);

  // 수행인력 모달을 닫고 돌아오면 목록을 다시 읽는다(실무자를 지정했는지 경고를 갱신)
  const prevStaffingOpen = useRef(staffingOpen);
  useEffect(() => {
    if (prevStaffingOpen.current && !staffingOpen) void load();
    prevStaffingOpen.current = staffingOpen;
  }, [staffingOpen, load]);

  const showDelivery = (d: ReportDeliveryResult | null | undefined) => {
    if (!d) return;
    const m = deliveryMessage(d);
    toast.show(m.text, m.tone);
  };

  const openNew = () => {
    setForm(emptyForm());
    setEditing("");
  };

  const openEdit = (row: AgencyReportRow) => {
    setForm({
      reportKind: row.reportKind,
      reportedOn: row.reportedOn,
      receiptNo: row.receiptNo ?? "",
      note: row.note ?? "",
      file: null,
      removeFile: false,
      deliveryMode: row.deliveryMode ?? "",
    });
    setEditing(row.reportId);
  };

  const close = () => {
    setEditing(null);
    setForm(emptyForm());
    if (fileRef.current) fileRef.current.value = "";
  };

  const save = async () => {
    if (saving) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.reportedOn)) {
      toast.show("신고일을 8자리(YYYYMMDD)로 입력해 주세요.", "error");
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.set("reportKind", form.reportKind);
      fd.set("reportedOn", form.reportedOn);
      fd.set("receiptNo", form.receiptNo.trim());
      fd.set("note", form.note.trim());
      fd.set("deliveryMode", form.deliveryMode);
      if (form.file) fd.set("file", form.file);
      if (form.removeFile && !form.file) fd.set("removeFile", "1");
      const isNew = editing === "";
      const url = isNew
        ? `/api/contracts/${encodeURIComponent(contractId)}/agency-reports`
        : `/api/contracts/${encodeURIComponent(contractId)}/agency-reports/${encodeURIComponent(String(editing))}`;
      const res = await fetch(url, { method: isNew ? "POST" : "PATCH", body: fd });
      const body = (await res.json().catch(() => ({}))) as {
        reports?: AgencyReportRow[];
        delivery?: ReportDeliveryResult | null;
        error?: string;
      };
      if (!res.ok) throw new Error(body?.error ?? "HTTP " + res.status);
      setReports(body.reports ?? []);
      if (body.delivery) showDelivery(body.delivery);
      else toast.show(isNew ? "신고 이력을 추가했습니다." : "신고 이력을 수정했습니다.", "success");
      close();
    } catch (err) {
      toast.show("저장 실패: " + (err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const send = async (row: AgencyReportRow) => {
    if (sendingId) return;
    setSendingId(row.reportId);
    try {
      const res = await fetch(
        `/api/contracts/${encodeURIComponent(contractId)}/agency-reports/${encodeURIComponent(row.reportId)}/deliver`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
      );
      const body = (await res.json().catch(() => ({}))) as {
        reports?: AgencyReportRow[];
        delivery?: ReportDeliveryResult | null;
        error?: string;
      };
      if (!res.ok) throw new Error(body?.error ?? "HTTP " + res.status);
      setReports(body.reports ?? []);
      showDelivery(body.delivery);
    } catch (err) {
      toast.show("발송 실패: " + (err as Error).message, "error");
    } finally {
      setSendingId(null);
    }
  };

  const remove = async (row: AgencyReportRow) => {
    if (saving) return;
    const label = `${AGENCY_REPORT_KIND_LABEL[row.reportKind]} 신고(${row.reportedOn})`;
    if (!window.confirm(`${label} 이력을 삭제할까요?${row.documentName ? " 첨부한 신고서 PDF도 함께 지워집니다." : ""}`)) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/contracts/${encodeURIComponent(contractId)}/agency-reports/${encodeURIComponent(row.reportId)}`,
        { method: "DELETE" }
      );
      const body = (await res.json().catch(() => ({}))) as { reports?: AgencyReportRow[]; error?: string };
      if (!res.ok) throw new Error(body?.error ?? "HTTP " + res.status);
      setReports(body.reports ?? []);
      toast.show("신고 이력을 삭제했습니다.", "success");
      if (editing === row.reportId) close();
    } catch (err) {
      toast.show("삭제 실패: " + (err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 border-t cd-border-c pt-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-baseline gap-2">
          <h4 className="font-bold cd-text text-sm">신고 이력</h4>
          <span className="text-[11px] cd-text-faint">
            IEPS 실적보고 출력(PDF)을 체결 → 변경 → 완료 순으로 보관 · PDF 를 붙이면 실무자에게 발송
          </span>
        </div>
        <button
          type="button"
          onClick={editing === "" ? close : openNew}
          className="cd-btn px-3 py-1.5 text-xs font-bold inline-flex items-center gap-1"
        >
          {editing === "" ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {editing === "" ? "취소" : "이력 추가"}
        </button>
      </div>

      {editing === "" && (
        <ReportForm form={form} setForm={setForm} onSave={save} onCancel={close} saving={saving} fileRef={fileRef} defaultMode={defaultMode} />
      )}

      <div className="grid gap-2">
        {loading && <p className="text-sm cd-text-faint">불러오는 중…</p>}
        {!loading && reports.length === 0 && editing !== "" && (
          <p className="text-sm cd-text-faint">
            신고 이력이 없습니다. IEPS 신고를 마쳤다면 [이력 추가]로 실적보고 PDF를 보관해 두세요.
          </p>
        )}
        {reports.map((row) =>
          editing === row.reportId ? (
            <ReportForm
              key={row.reportId}
              form={form}
              setForm={setForm}
              onSave={save}
              onCancel={close}
              saving={saving}
              fileRef={fileRef}
              currentFileName={row.documentName}
              defaultMode={defaultMode}
            />
          ) : (
            <div key={row.reportId} className="rounded-xl border cd-border-c px-3 py-2">
              <div className="flex items-center gap-2">
                <CdBadge tone={KIND_TONE[row.reportKind]} className="shrink-0">
                  {AGENCY_REPORT_KIND_LABEL[row.reportKind]}
                </CdBadge>
                <span className="text-sm cd-text tabular-nums shrink-0">{row.reportedOn}</span>
                {row.receiptNo && <span className="text-xs cd-text-muted shrink-0">접수 {row.receiptNo}</span>}
                {row.documentPath ? (
                  <a
                    href={row.documentPath}
                    target="_blank"
                    rel="noreferrer"
                    className="cd-action inline-flex items-center gap-1 text-xs cd-text-primary truncate"
                    title={row.documentName ?? "신고서"}
                  >
                    <FileText className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{row.documentName ?? "신고서 PDF"}</span>
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs cd-text-faint">
                    <Paperclip className="w-3.5 h-3.5" />
                    신고서 미첨부
                    {row.filingId && (
                      // 대기열로 신고한 건은 신고 보조(설치형 도구)가 IEPS 실적 보고서를 받아 여기 붙이고 실무자에게 보낸다.
                      // 밑줄 글자 링크는 클릭 뒤 포커스 테두리가 안쪽으로 그려져 첫 글자를 가렸다 — 여백 있는 작은 버튼으로 둔다.
                      <a
                        href={`mcm-filings://open?id=${encodeURIComponent(row.filingId)}`}
                        onClick={(e) => {
                          e.preventDefault();
                          launchFilingsAssist(e.currentTarget.href, () => toast.show(FILINGS_ASSIST_MISSING_MESSAGE, "error"));
                        }}
                        className="cd-action cd-btn ml-2 inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold cd-text-primary"
                        title="이 PC 의 MCM 신고 보조로 IEPS 실적 보고서를 받아 붙입니다(패널의 [실적보고서 받기])"
                      >
                        <Download className="w-3.5 h-3.5" />
                        IEPS 에서 받기
                      </a>
                    )}
                  </span>
                )}
                {row.documentId && <DeliveryBadge row={row} />}
                {row.note && <span className="text-xs cd-text-faint truncate">{row.note}</span>}
                <div className="ml-auto flex items-center gap-1 shrink-0">
                  {row.documentId && (
                    <button
                      type="button"
                      onClick={() => send(row)}
                      disabled={sendingId === row.reportId}
                      className="cd-btn px-2.5 py-1 text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50"
                      title="실무자에게 실적 보고서를 보냅니다"
                    >
                      <Send className="w-3.5 h-3.5" />
                      {sendingId === row.reportId ? "보내는 중…" : row.deliveryStatus === "sent" ? "재발송" : "발송"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openEdit(row)}
                    className="cd-icon-button p-1.5 cd-text-faint hover:cd-text"
                    title="수정 · 신고서 첨부 · 발송 방식"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(row)}
                    className="cd-icon-button p-1.5 cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]"
                    title="이력 삭제"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {row.deliveryStatus === "no_recipient" && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg cd-warn-bg px-3 py-2 text-xs">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 cd-warn-text" />
                  <span className="cd-text">
                    실무자(실무(정))가 지정되지 않아 보고서를 보내지 못했습니다. 수행인력에서 실무자를 지정한 뒤 [발송] 을 누르세요.
                  </span>
                  {onOpenStaffing && (
                    <button
                      type="button"
                      onClick={onOpenStaffing}
                      className="cd-btn cd-btn-primary ml-auto px-3 py-1 text-xs font-bold inline-flex items-center gap-1"
                    >
                      <UserCog className="w-3.5 h-3.5" />
                      수행인력 설정
                    </button>
                  )}
                </div>
              )}
              {row.deliveryStatus === "failed" && row.deliveryError && (
                <p className="mt-2 text-xs text-[color:var(--cd-danger,#FA896B)]">발송 실패: {row.deliveryError}</p>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}

/** 발송 상태 배지 — 받는 사람·채널·시각은 툴팁으로. */
function DeliveryBadge({ row }: { row: AgencyReportRow }) {
  if (!row.deliveryStatus) {
    return (
      <CdBadge tone="outline" className="shrink-0">
        미발송
      </CdBadge>
    );
  }
  const who = row.deliveryRecipients.map((r) => `${r.name}(${r.role})`).join(", ");
  const title =
    row.deliveryStatus === "sent"
      ? `${who} · ${row.deliveredAt ? row.deliveredAt.slice(0, 16).replace("T", " ") : ""}`
      : row.deliveryError ?? REPORT_DELIVERY_STATUS_LABEL[row.deliveryStatus];
  return (
    <CdBadge tone={DELIVERY_TONE[row.deliveryStatus]} className="shrink-0" title={title}>
      {REPORT_DELIVERY_STATUS_LABEL[row.deliveryStatus]}
    </CdBadge>
  );
}

function ReportForm({
  form,
  setForm,
  onSave,
  onCancel,
  saving,
  fileRef,
  currentFileName,
  defaultMode,
}: {
  form: FormState;
  setForm: (next: FormState) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  fileRef: React.RefObject<HTMLInputElement | null>;
  currentFileName?: string | null;
  defaultMode: ReportDeliveryMode | null;
}) {
  const attachedLabel = form.file
    ? form.file.name
    : form.removeFile
      ? "첨부 해제됨"
      : currentFileName || "선택된 파일 없음";
  return (
    <div className="mb-2 grid gap-3 rounded-xl border cd-border-c p-3">
      <div className="grid grid-cols-1 md:grid-cols-[140px_180px_minmax(0,1fr)] gap-3">
        <label className="grid gap-1 text-sm">
          <span className="font-bold cd-text-muted">신고 구분</span>
          <select
            className="cd-input"
            value={form.reportKind}
            onChange={(e) => setForm({ ...form, reportKind: e.target.value as AgencyReportKind })}
          >
            {AGENCY_REPORT_KINDS.map((k) => (
              <option key={k} value={k}>
                {AGENCY_REPORT_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-bold cd-text-muted">신고일</span>
          <CdDateInput value={form.reportedOn} onChange={(v) => setForm({ ...form, reportedOn: v })} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-bold cd-text-muted">접수번호 (선택)</span>
          <input
            type="text"
            className="cd-input"
            placeholder="IEPS 보고회차"
            value={form.receiptNo}
            onChange={(e) => setForm({ ...form, receiptNo: e.target.value })}
          />
        </label>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_200px_auto] gap-3 items-end">
        <label className="grid gap-1 text-sm">
          <span className="font-bold cd-text-muted">비고 (선택)</span>
          <input
            type="text"
            className="cd-input"
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-bold cd-text-muted">실무자 발송</span>
          <select
            className="cd-input"
            value={form.deliveryMode}
            onChange={(e) => setForm({ ...form, deliveryMode: e.target.value as ReportDeliveryMode | "" })}
          >
            <option value="">기본값{defaultMode ? ` (${REPORT_DELIVERY_MODE_LABEL[defaultMode]})` : ""}</option>
            {REPORT_DELIVERY_MODES.map((m) => (
              <option key={m} value={m}>
                {REPORT_DELIVERY_MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-2">
          <label className="cd-action cd-btn px-3 py-2 text-xs font-bold cursor-pointer inline-flex items-center gap-1">
            <Paperclip className="w-3.5 h-3.5" />
            신고서 PDF
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => setForm({ ...form, file: e.target.files?.[0] ?? null, removeFile: false })}
            />
          </label>
          {(form.file || currentFileName) && !form.removeFile && (
            <button
              type="button"
              className="cd-icon-button p-1.5 cd-text-faint hover:cd-text"
              title="첨부 해제"
              onClick={() => setForm({ ...form, file: null, removeFile: true })}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs cd-text-faint truncate">
          {attachedLabel}
          {form.file ? " — 저장하면 실무자 발송 설정에 따라 바로 보냅니다" : ""}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={onCancel} className="cd-btn px-3 py-1.5 text-xs font-bold">
            취소
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="cd-btn cd-btn-primary px-4 py-1.5 text-xs font-bold disabled:opacity-50"
          >
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AgencyReportList;
