"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, ClipboardCheck, Copy, ExternalLink, Loader2, RefreshCw, RotateCcw, Settings2, XCircle } from "lucide-react";
import "@/components/cdash/cdash.css";
import {
  CdBadge,
  CdButton,
  CdDateInput,
  CdEmptyState,
  CdHelp,
  CdModal,
  CdPageHeader,
  CdTabs,
  isValidDateString,
  useCdToast,
  useCdashTheme,
} from "@/components/cdash";
import type { FilingKind, FilingRow, FilingSettings, FilingStatus, ReportDeliveryMode } from "@/lib/filings/types";
import {
  FILING_KINDS,
  FILING_KIND_LABEL,
  FILING_SITE_LABEL,
  FILING_STATUS_LABEL,
  FILING_TRIGGER_LABEL,
  REPORT_DELIVERY_MODE_LABEL,
  REPORT_DELIVERY_MODES,
} from "@/lib/filings/types";
import { FILINGS_ASSIST_MISSING_MESSAGE, launchFilingsAssist } from "@/lib/filings/assist-launch";

type StatusTab = FilingStatus | "all";
type KindTab = FilingKind | "all";

const STATUS_TABS: { key: StatusTab; label: string }[] = [
  { key: "pending", label: "대기" },
  { key: "submitted", label: "제출 완료" },
  { key: "skipped", label: "제외" },
  { key: "all", label: "전체" },
];

const KIND_SHORT: Record<FilingKind, string> = {
  ieps_staff: "IEPS 기술인력",
  ieps_agency: "IEPS 대행실적",
  etis_career: "ETIS 기술자",
};

function dueBadge(f: FilingRow) {
  if (f.status !== "pending") return <CdBadge tone={f.status === "submitted" ? "success" : "idle"}>{FILING_STATUS_LABEL[f.status]}</CdBadge>;
  if (f.daysLeft == null) return <CdBadge tone="outline">기한 없음</CdBadge>;
  if (f.daysLeft < 0) return <CdBadge tone="error">{-f.daysLeft}일 초과</CdBadge>;
  if (f.daysLeft <= 7) return <CdBadge tone="warn">{f.daysLeft === 0 ? "오늘 마감" : `D-${f.daysLeft}`}</CdBadge>;
  return <CdBadge tone="info">D-{f.daysLeft}</CdBadge>;
}

/**
 * 대외 신고 대기열 — 통합환경허가시스템(IEPS)·엔지니어링종합정보시스템(ETIS) 신고 건을 MCM 데이터에서
 * 파생해 보여 준다. 항목을 열면 사이트 양식 순서대로 정리된 값을 복사할 수 있고, 제출 후 접수번호를 남긴다.
 * 제출 자체는 사이트에서 사람이 한다(문자인증·공동인증서). 자동 입력 도구는 2단계.
 */
export function FilingQueueBoard() {
  const { theme } = useCdashTheme();
  const { toast } = useCdToast();
  const searchParams = useSearchParams();

  const [status, setStatus] = useState<StatusTab>("pending");
  const [kind, setKind] = useState<KindTab>("all");
  const [rows, setRows] = useState<FilingRow[] | null>(null);
  const [settings, setSettings] = useState<FilingSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<FilingRow | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const load = useCallback(async (opts?: { sync?: boolean }) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ status, kind, sync: opts?.sync === false ? "0" : "1" });
      const res = await fetch(`/api/filings?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { filings: FilingRow[]; settings: FilingSettings };
      setRows(body.filings);
      setSettings(body.settings);
    } catch (err) {
      toast(`불러오기 실패: ${(err as Error).message}`, "error");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [status, kind, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // 홈 카드 딥링크(?open=<filingId>) — 목록에 없으면(다른 상태 탭) 단건 조회
  useEffect(() => {
    const id = searchParams.get("open");
    if (!id || rows === null) return;
    const hit = rows.find((r) => r.filingId === id);
    if (hit) {
      setOpen(hit);
      return;
    }
    void (async () => {
      const res = await fetch(`/api/filings/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (res.ok) setOpen(((await res.json()) as { filing: FilingRow }).filing);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, rows === null]);

  const counts = useMemo(() => {
    const c: Record<KindTab, number> = { all: 0, ieps_staff: 0, ieps_agency: 0, etis_career: 0 };
    for (const r of rows ?? []) {
      c.all += 1;
      c[r.filingKind] += 1;
    }
    return c;
  }, [rows]);

  const onUpdated = (f: FilingRow) => {
    setRows((prev) => (prev ? prev.map((r) => (r.filingId === f.filingId ? f : r)) : prev));
    setOpen(f);
    void load({ sync: false });
  };

  return (
    <div className="cdash cd-fields-white min-h-screen p-6" data-theme={theme}>
      <CdPageHeader
        breadcrumbs={[{ label: "계약" }, { label: "대외 신고 대기열" }]}
        title="대외 신고 대기열"
        help="직원·인사·계약·참여인력 변경에서 신고 대상을 찾습니다. 항목을 열어 값을 복사하고, 외부 사이트에 제출한 뒤 ‘제출 완료’로 표시하세요. 해당하지 않는 건은 ‘제외’를 선택합니다."
        subtitle={settings ? `기준일 ${settings.cutoffOn} 이후 발생분` : undefined}
        meta={rows ? `${rows.length}건` : ""}
        actions={
          <div className="flex gap-2">
            {(kind === "ieps_agency" || kind === "ieps_staff") && (
              <AssistLauncher href={`mcm-filings://open?kind=${kind}`} label={`${KIND_SHORT[kind]} 신고 보조 열기`} />
            )}
            <CdButton variant="soft" icon={<Settings2 className="w-4 h-4" />} onClick={() => setSettingsOpen(true)}>
              설정
            </CdButton>
            <CdButton variant="primary" icon={<RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />} onClick={() => void load()}>
              다시 계산
            </CdButton>
          </div>
        }
        tabs={<CdTabs items={STATUS_TABS} active={status} onChange={setStatus} />}
      />

      <div className="mb-4">
        <CdTabs
          variant="pill"
          items={[
            { key: "all" as KindTab, label: "전체", count: counts.all },
            ...FILING_KINDS.map((k) => ({ key: k as KindTab, label: KIND_SHORT[k], count: counts[k] })),
          ]}
          active={kind}
          onChange={setKind}
        />
      </div>

      {rows === null ? (
        <div className="flex items-center gap-2 py-20 justify-center text-sm cd-text-muted">
          <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중…
        </div>
      ) : rows.length === 0 ? (
        <CdEmptyState
          icon={<ClipboardCheck className="w-6 h-6" />}
          title="해당하는 신고 항목이 없습니다"
          description="입사·퇴사·등급 변경, 계약 체결·변경·완료, 참여 시작·종료가 기록되면 자동으로 올라옵니다."
        />
      ) : (
        <div className="rounded-2xl border cd-border-c cd-card-bg overflow-hidden" style={{ boxShadow: "var(--cd-shadow)" }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead className="cd-table-head">
                <tr className="text-left text-xs cd-text-muted">
                  <th className="px-5 py-3 font-semibold">신고 종류</th>
                  <th className="px-5 py-3 font-semibold">사유</th>
                  <th className="px-5 py-3 font-semibold">항목</th>
                  <th className="px-5 py-3 font-semibold">발생일</th>
                  <th className="px-5 py-3 font-semibold">기한</th>
                  <th className="px-5 py-3 font-semibold">상태</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f, i) => (
                  <tr
                    key={f.filingId}
                    className="cursor-pointer transition-colors hover:cd-soft-primary"
                    style={{ borderTop: i > 0 ? "1px solid var(--cd-border)" : undefined }}
                    onClick={() => setOpen(f)}
                  >
                    <td className="px-5 py-3.5 cd-text-muted whitespace-nowrap">{KIND_SHORT[f.filingKind]}</td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <CdBadge tone="secondary">{FILING_TRIGGER_LABEL[f.triggerKind] ?? f.triggerKind}</CdBadge>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="font-semibold cd-text">{f.title}</div>
                      {f.subtitle && <div className="text-xs cd-text-faint truncate max-w-[420px]">{f.subtitle}</div>}
                    </td>
                    <td className="px-5 py-3.5 cd-text-muted tabular-nums whitespace-nowrap">{f.occurredOn}</td>
                    <td className="px-5 py-3.5 cd-text-muted tabular-nums whitespace-nowrap">{f.dueOn ?? "-"}</td>
                    <td className="px-5 py-3.5 whitespace-nowrap">{dueBadge(f)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <FilingDetailModal filing={open} onClose={() => setOpen(null)} onUpdated={onUpdated} />
      <FilingSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={(s) => {
          setSettings(s);
          setSettingsOpen(false);
          void load();
        }}
      />
    </div>
  );
}

// ───────────────────────── 상세 모달 ─────────────────────────

/**
 * 신고 보조(이 PC 에 설치된 로컬 도구)를 여는 버튼 — mcm-filings:// 링크를 설치 패키지가 등록한다.
 * 웹 페이지는 PC 프로그램을 직접 실행할 수 없어 링크로 넘긴다. 설치가 안 된 PC 에서는 눌러도 반응이 없으므로 안내를 곁에 둔다.
 */
function AssistLauncher({ href, label }: { href: string; label: string }) {
  const { toast } = useCdToast();
  return (
    <span className="inline-flex items-center gap-1">
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault();
          launchFilingsAssist(href, () => toast(FILINGS_ASSIST_MISSING_MESSAGE, "error"));
        }}
        className="cd-action cd-btn cd-btn-primary inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold"
      >
        <ExternalLink className="w-4 h-4" />
        {label}
      </a>
      <CdHelp label="신고 보조 설치 안내">
        <div className="grid gap-2 text-sm">
          <p>
            <b>MCM 신고 보조</b>는 이 PC 의 Chrome 으로 통합환경허가시스템(IEPS)에 값을 채워 주는 설치형 도구입니다. 제출 버튼은 직접 누릅니다.
          </p>
          <p>
            처음 쓰는 PC 는 설치 파일(<code>MCM-Filings-….zip</code>)을 풀고 <code>install.cmd</code> 를 실행하세요(관리자 권한 불필요, Chrome 필요).
          </p>
          <p>버튼을 누르면 브라우저가 “MCM 신고 보조 열기”를 물어봅니다 — [열기]. 아무 반응이 없으면 이 PC 에 설치되지 않은 것입니다.</p>
          <p>처음 한 번은 MCM 계정 로그인과 IEPS 로그인(문자인증)을 묻습니다. IEPS 로그인은 약 1시간 유지됩니다.</p>
        </div>
      </CdHelp>
    </span>
  );
}

function FilingDetailModal({
  filing,
  onClose,
  onUpdated,
}: {
  filing: FilingRow | null;
  onClose: () => void;
  onUpdated: (f: FilingRow) => void;
}) {
  const { toast } = useCdToast();
  const [mode, setMode] = useState<"view" | "submit" | "skip">("view");
  const [receiptNo, setReceiptNo] = useState("");
  const [submittedAt, setSubmittedAt] = useState("");
  const [agentRegisteredAt, setAgentRegisteredAt] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMode("view");
    setReceiptNo(filing?.receiptNo ?? "");
    setSubmittedAt(filing?.submittedAt ?? "");
    setAgentRegisteredAt(filing?.occurredOn ?? "");
    setNote(filing?.note ?? "");
  }, [filing]);

  if (!filing) return null;
  const isAppoint = filing.filingKind === "ieps_staff" && filing.triggerKind === "appoint";

  const copyAll = async () => {
    const text = filing.payload.fields.map((f) => `${f.label}\t${f.value}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast("양식 값을 복사했습니다.", "success");
    } catch {
      toast("복사에 실패했습니다.", "error");
    }
  };
  const copyOne = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      toast("복사했습니다.", "success");
    } catch {
      toast("복사에 실패했습니다.", "error");
    }
  };

  const patch = async (body: Record<string, unknown>) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/filings/${encodeURIComponent(filing.filingId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      onUpdated((json as { filing: FilingRow }).filing);
      setMode("view");
      toast("상태를 저장했습니다.", "success");
    } catch (err) {
      toast(`저장 실패: ${(err as Error).message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const submit = () => {
    if (submittedAt && !isValidDateString(submittedAt)) return toast("제출일이 올바르지 않습니다.", "error");
    if (isAppoint && agentRegisteredAt && !isValidDateString(agentRegisteredAt))
      return toast("선임일자가 올바르지 않습니다.", "error");
    void patch({
      status: "submitted",
      receiptNo: receiptNo || null,
      submittedAt: submittedAt || null,
      note: note || null,
      agentRegisteredAt: isAppoint ? agentRegisteredAt || null : null,
    });
  };

  const footer =
    mode === "view" ? (
      <div className="flex flex-wrap justify-between gap-2 w-full">
        <CdButton variant="soft" icon={<Copy className="w-4 h-4" />} onClick={() => void copyAll()}>
          전체 복사
        </CdButton>
        <div className="flex gap-2">
          {filing.status === "pending" ? (
            <>
              <CdButton icon={<XCircle className="w-4 h-4" />} onClick={() => setMode("skip")}>
                제외
              </CdButton>
              <CdButton variant="primary" icon={<CheckCircle2 className="w-4 h-4" />} onClick={() => setMode("submit")}>
                제출 완료
              </CdButton>
            </>
          ) : (
            <CdButton icon={<RotateCcw className="w-4 h-4" />} disabled={saving} onClick={() => void patch({ status: "pending", note: filing.note })}>
              대기로 되돌리기
            </CdButton>
          )}
        </div>
      </div>
    ) : (
      <div className="flex justify-end gap-2">
        <CdButton onClick={() => setMode("view")} disabled={saving}>
          취소
        </CdButton>
        {mode === "submit" ? (
          <CdButton variant="primary" disabled={saving} onClick={submit}>
            {saving ? "저장 중…" : "제출 완료로 표시"}
          </CdButton>
        ) : (
          <CdButton variant="danger" disabled={saving} onClick={() => void patch({ status: "skipped", note: note || null })}>
            {saving ? "저장 중…" : "제외 처리"}
          </CdButton>
        )}
      </div>
    );

  return (
    <CdModal open onClose={onClose} title={filing.title} size="lg" footer={footer}>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <CdBadge tone="secondary">{FILING_KIND_LABEL[filing.filingKind]}</CdBadge>
        <CdBadge tone="outline">{FILING_TRIGGER_LABEL[filing.triggerKind] ?? filing.triggerKind}</CdBadge>
        {dueBadge(filing)}
        <span className="text-xs cd-text-muted">
          발생 {filing.occurredOn} · 기한 {filing.dueOn ?? "-"}
        </span>
        {filing.payload.site === "ieps" &&
          (filing.status === "pending" || (filing.status === "submitted" && filing.filingKind === "ieps_agency")) && (
            <span className="ml-auto">
              <AssistLauncher
                href={`mcm-filings://open?id=${encodeURIComponent(filing.filingId)}`}
                label={filing.status === "pending" ? "신고 보조 열기" : "신고 보조로 실적보고서 받기"}
              />
            </span>
          )}
      </div>
      <div className="rounded-xl border cd-border-c px-4 py-3 mb-4 text-xs cd-text-muted">
        <div>
          <b className="cd-text">{FILING_SITE_LABEL[filing.payload.site]}</b> › {filing.payload.screen}
        </div>
        {filing.subtitle && <div className="mt-0.5">{filing.subtitle}</div>}
        {filing.status === "submitted" && (
          <div className="mt-1">
            제출 {filing.submittedAt ?? "-"} · {filing.submittedByName ?? "-"}
            {filing.receiptNo ? ` · 접수번호 ${filing.receiptNo}` : ""}
          </div>
        )}
        {filing.status === "skipped" && filing.note && <div className="mt-1">제외 사유: {filing.note}</div>}
        {filing.attachments.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            <span>첨부:</span>
            {filing.attachments.map((a) => (
              <a key={a.documentId} href={a.downloadPath} target="_blank" rel="noreferrer" className="cd-text-primary underline">
                {a.typeLabel} · {a.name}
              </a>
            ))}
          </div>
        )}
      </div>

      {mode === "view" && (
        <div className="rounded-2xl border cd-border-c overflow-hidden">
          <table className="w-full text-sm">
            <tbody>
              {filing.payload.fields.map((f, i) => (
                <tr key={`${f.label}-${i}`} style={{ borderTop: i > 0 ? "1px solid var(--cd-border)" : undefined }}>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold cd-text-muted w-[190px] align-top whitespace-nowrap">
                    {f.label}
                  </th>
                  <td className="px-4 py-2.5 cd-text break-all">
                    {f.value || <span className="cd-text-faint">(비어 있음 — 사이트에서 직접 입력)</span>}
                    {f.hint && <div className="text-[11px] cd-text-faint mt-0.5">{f.hint}</div>}
                  </td>
                  <td className="px-2 py-2.5 w-10 align-top">
                    {f.value && (
                      <button
                        type="button"
                        className="cd-text-faint hover:cd-text-primary"
                        title="복사"
                        onClick={() => void copyOne(f.value)}
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mode === "submit" && (
        <div className="grid gap-3">
          <p className="text-sm cd-text">사이트에서 제출을 마쳤으면 제출일과 접수번호를 남겨 두세요.</p>
          {filing.filingKind === "ieps_agency" && (
            <p className="text-xs cd-text-faint">
              제출 완료로 표시하면 계약 상세의 “대행 실적 보고” 카드에 신고 이력이 기록됩니다. IEPS 실적보고 출력(PDF)은 거기서 첨부하세요.
            </p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <CdDateInput label="제출일" value={submittedAt} onChange={setSubmittedAt} placeholder="비우면 오늘" />
            <label className="grid gap-1 text-sm">
              <span className="text-xs font-semibold cd-text-muted">접수번호(선택)</span>
              <input className="cd-input" value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} />
            </label>
            {isAppoint && (
              <CdDateInput
                label="선임일자(대행인력등록일 확정)"
                hint="직원 등록의 대행인력등록일이 비어 있으면 이 값으로 채웁니다."
                value={agentRegisteredAt}
                onChange={setAgentRegisteredAt}
              />
            )}
          </div>
          <label className="grid gap-1 text-sm">
            <span className="text-xs font-semibold cd-text-muted">메모(선택)</span>
            <textarea className="cd-input min-h-[70px]" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
      )}

      {mode === "skip" && (
        <div className="grid gap-3">
          <p className="text-sm cd-text">신고 대상이 아니거나 이미 처리된 건이면 사유를 남기고 제외합니다.</p>
          <label className="grid gap-1 text-sm">
            <span className="text-xs font-semibold cd-text-muted">제외 사유</span>
            <textarea className="cd-input min-h-[70px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 이미 신고 완료 / 신고 대상 아님" />
          </label>
        </div>
      )}
    </CdModal>
  );
}

// ───────────────────────── 설정 모달 ─────────────────────────

function FilingSettingsModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (s: FilingSettings) => void;
}) {
  const { toast } = useCdToast();
  const [form, setForm] = useState<FilingSettings | null>(null);
  const [users, setUsers] = useState<{ userId: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(null);
    void (async () => {
      const res = await fetch("/api/filings/settings", { cache: "no-store" });
      if (!res.ok) {
        toast("설정을 불러오지 못했습니다.", "error");
        return;
      }
      const body = (await res.json()) as { settings: FilingSettings; users: { userId: string; name: string }[] };
      setForm(body.settings);
      setUsers(body.users);
    })();
  }, [open, toast]);

  const save = async () => {
    if (!form) return;
    if (!isValidDateString(form.cutoffOn)) return toast("기준일이 올바르지 않습니다.", "error");
    setSaving(true);
    try {
      const res = await fetch("/api/filings/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      toast("설정을 저장했습니다.", "success");
      onSaved((json as { settings: FilingSettings }).settings);
    } catch (err) {
      toast(`저장 실패: ${(err as Error).message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const toggleUser = (id: string) =>
    setForm((f) =>
      f
        ? {
            ...f,
            notifyUserIds: f.notifyUserIds.includes(id) ? f.notifyUserIds.filter((x) => x !== id) : [...f.notifyUserIds, id],
          }
        : f
    );

  return (
    <CdModal
      open={open}
      onClose={onClose}
      title="신고 대기열 설정"
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <CdButton onClick={onClose} disabled={saving}>
            취소
          </CdButton>
          <CdButton variant="primary" onClick={() => void save()} disabled={saving || !form}>
            {saving ? "저장 중…" : "저장"}
          </CdButton>
        </div>
      }
    >
      {!form ? (
        <div className="flex items-center gap-2 py-10 justify-center text-sm cd-text-muted">
          <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중…
        </div>
      ) : (
        <div className="grid gap-4">
          <CdDateInput
            label="기준일"
            hint="이 날짜 이전에 발생한 사유(입사·계약 등)는 대기열에 올리지 않습니다. 도입 이전 건의 소급을 막습니다."
            value={form.cutoffOn}
            onChange={(v) => setForm({ ...form, cutoffOn: v })}
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {FILING_KINDS.map((k) => (
              <label key={k} className="grid gap-1 text-sm">
                <span className="text-xs font-semibold cd-text-muted">{FILING_KIND_LABEL[k]} 기한(일)</span>
                <input
                  className="cd-input tabular-nums"
                  inputMode="numeric"
                  value={form.dueDays[k]}
                  onChange={(e) => setForm({ ...form, dueDays: { ...form.dueDays, [k]: Number(e.target.value.replace(/\D/g, "") || 0) } })}
                />
              </label>
            ))}
          </div>
          <label className="grid gap-1 text-sm md:w-1/2">
            <span className="text-xs font-semibold cd-text-muted">대행 실적 보고서 실무자 발송 기본값</span>
            <select
              className="cd-input"
              value={form.reportDelivery}
              onChange={(e) => setForm({ ...form, reportDelivery: e.target.value as ReportDeliveryMode })}
            >
              {REPORT_DELIVERY_MODES.map((m) => (
                <option key={m} value={m}>
                  {REPORT_DELIVERY_MODE_LABEL[m]}
                </option>
              ))}
            </select>
            <span className="text-[11px] cd-text-faint">
              실적 보고서 PDF 가 이력에 붙으면 수행인력의 실무(정)에게 보냅니다. 건마다 신고 보조 패널·계약 상세에서 바꿀 수 있습니다.
            </span>
          </label>
          <label className="grid gap-1 text-sm md:w-1/3">
            <span className="text-xs font-semibold cd-text-muted">기한 임박 알림(일 전)</span>
            <input
              className="cd-input tabular-nums"
              inputMode="numeric"
              value={form.remindBeforeDays}
              onChange={(e) => setForm({ ...form, remindBeforeDays: Number(e.target.value.replace(/\D/g, "") || 0) })}
            />
          </label>
          <div className="grid gap-1.5">
            <span className="text-xs font-semibold cd-text-muted">기한 임박·초과 앱 푸시 수신자</span>
            <div className="flex flex-wrap gap-1.5">
              {users.map((u) => {
                const on = form.notifyUserIds.includes(u.userId);
                return (
                  <button
                    key={u.userId}
                    type="button"
                    onClick={() => toggleUser(u.userId)}
                    className={`cd-pill px-3 py-1 text-xs font-semibold border ${on ? "cd-tint-primary cd-text-primary" : "cd-border-c cd-text-muted"}`}
                  >
                    {u.name}
                  </button>
                );
              })}
              {users.length === 0 && <span className="text-xs cd-text-faint">활성 사용자가 없습니다.</span>}
            </div>
            <span className="text-[11px] cd-text-faint">매일 한 번, 기한이 임박했거나 지난 대기 건이 있으면 알립니다.</span>
          </div>
        </div>
      )}
    </CdModal>
  );
}
