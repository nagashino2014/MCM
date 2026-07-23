"use client";

import { useState } from "react";
import { MailWarning, Plus, Trash2, Check, FileText, X } from "lucide-react";
import { HomeCard } from "../HomeCard";
import { useHomeWidget } from "../useHomeWidget";
import { AutoDateInput } from "@/components/ui/AutoDateInput";
import { LeaveNoticePreview } from "@/components/approval/LeaveNoticePreview";

interface MyNotice {
  noticeId: string;
  year: string;
  round: number;
  name: string;
  title: string;
  paragraphs: string[];
  granted: number;
  used: number;
  remaining: number;
  noticeDate: string;
  deadline: string;
  status: string; // sent | submitted | assigned
  plan: string[];
  assigned: string[];
  planTotal: number;
  submittedAt: string | null;
}

interface CompanyInfo {
  companyName: string;
  ceoName: string;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * 수신 문서함(홈) — 연차 사용촉진 고지. 1차 고지(sent)는 사용예정일 회신 + 클릭 전자서명.
 * 수신 고지가 없는 계정은 위젯 자체를 숨긴다.
 */
export function LeaveNoticeInboxCard() {
  const w = useHomeWidget<{ notices: MyNotice[]; company: CompanyInfo | null }>("/api/home/leave-notices");
  const [openId, setOpenId] = useState<string | null>(null);
  const [viewNotice, setViewNotice] = useState<MyNotice | null>(null);

  if (w.status === "forbidden") return null;
  const notices = w.status === "ok" ? w.data.notices : [];
  const company = w.status === "ok" ? w.data.company : null;
  // 수신 고지가 없으면 위젯을 노출하지 않는다(로딩/에러는 표시).
  if (w.status === "ok" && notices.length === 0) return null;

  const pending = notices.filter((n) => n.round === 1 && n.status === "sent").length;

  return (
    <HomeCard
      icon={<MailWarning className="w-4 h-4" />}
      title="수신 문서함"
      count={pending}
      accent="#FA896B"
      loading={w.status === "loading"}
      error={w.status === "error" ? w.message : undefined}
    >
      <ul className="flex flex-col gap-2">
        {notices.map((n) => (
          <li key={n.noticeId} className="rounded-lg border cd-border-c px-3 py-2.5 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] font-semibold cd-text truncate">{n.title}</span>
                <span className="block text-[11px] cd-text-faint">
                  {n.year}년 · 발생 {fmt(n.granted)} · 사용 {fmt(n.used)} · 잔여 {fmt(n.remaining)}일 · 고지 {n.noticeDate}
                </span>
              </span>
              <StatusBadge status={n.status} />
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                className="cd-btn cd-btn-ghost text-[11px] px-2 py-1 flex items-center gap-1"
                onClick={() => setViewNotice(n)}
              >
                <FileText className="w-3 h-3" /> 고지서 보기
              </button>
              {n.round === 1 && n.status === "sent" && openId !== n.noticeId && (
                <button
                  type="button"
                  className="cd-btn cd-btn-soft text-[11px] px-2.5 py-1"
                  onClick={() => setOpenId(n.noticeId)}
                >
                  사용예정일 회신
                </button>
              )}
            </div>

            {n.round === 1 && n.status === "sent" && openId === n.noticeId ? (
              <ReplyForm notice={n} onDone={() => { setOpenId(null); w.reload(); }} onCancel={() => setOpenId(null)} />
            ) : n.status === "submitted" && n.plan.length > 0 ? (
              <div className="text-[11px] cd-text-faint">
                제출한 사용예정일: <span className="cd-text font-medium">{n.plan.join(", ")}</span>
              </div>
            ) : n.status === "assigned" && n.assigned.length > 0 ? (
              <div className="text-[11px] cd-text-faint">
                회사 지정일: <span className="cd-text font-medium">{n.assigned.join(", ")}</span>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {viewNotice && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.5)" }} onClick={() => setViewNotice(null)}>
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-end mb-2">
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[12px] font-semibold text-white/90 hover:text-white"
                onClick={() => setViewNotice(null)}
              >
                <X className="w-4 h-4" /> 닫기
              </button>
            </div>
            <LeaveNoticePreview
              round={viewNotice.round}
              title={viewNotice.title}
              paragraphs={viewNotice.paragraphs}
              info={{ name: viewNotice.name, granted: viewNotice.granted, used: viewNotice.used, remaining: viewNotice.remaining }}
              noticeDate={viewNotice.noticeDate}
              deadline={viewNotice.deadline}
              planTotal={viewNotice.planTotal}
              plan={viewNotice.plan}
              assigned={viewNotice.assigned}
              companyName={company?.companyName}
              ceoName={company?.ceoName}
            />
          </div>
        </div>
      )}
    </HomeCard>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    sent: { label: "회신 필요", cls: "border border-[color:var(--cd-danger,#FA896B)] text-[color:var(--cd-danger,#FA896B)]" },
    submitted: { label: "제출 완료", cls: "cd-tint-primary cd-text-primary" },
    assigned: { label: "지정 통보", cls: "cd-tint-primary cd-text-primary" },
  };
  const s = map[status] ?? { label: status, cls: "cd-text-faint" };
  return <span className={`text-[10px] rounded-full px-2 py-0.5 shrink-0 font-semibold ${s.cls}`}>{s.label}</span>;
}

/** 1차 고지 회신 — 사용예정일 여러 개 입력 + 클릭 전자서명 동의. */
function ReplyForm({ notice, onDone, onCancel }: { notice: MyNotice; onDone: () => void; onCancel: () => void }) {
  const [dates, setDates] = useState<string[]>([""]);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);

  const setDate = (i: number, v: string) => setDates((ds) => ds.map((d, j) => (j === i ? v : d)));
  const addDate = () => setDates((ds) => [...ds, ""]);
  const delDate = (i: number) => setDates((ds) => (ds.length > 1 ? ds.filter((_, j) => j !== i) : ds));

  const filled = dates.filter((d) => d.trim());

  const submit = async () => {
    if (filled.length === 0) {
      alert("사용예정일을 1일 이상 입력하세요.");
      return;
    }
    if (!agree) {
      alert("전자서명 동의에 체크해주세요.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/approval/leave-notices/${notice.noticeId}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan: filled, agree: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        onDone();
      } else {
        alert(data.error ?? "회신에 실패했습니다.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg cd-tint-primary p-2.5 flex flex-col gap-2">
      <div className="text-[10.5px] cd-text-faint leading-relaxed">
        잔여 연차 {fmt(notice.remaining)}일에 대한 사용예정일을 지정해 회신합니다. ({notice.deadline}까지 · 사용시기는 추후 변경 가능)
      </div>
      <div className="flex flex-col gap-1.5">
        {dates.map((d, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <AutoDateInput
              value={d}
              onChange={(v) => setDate(i, v)}
              className="cd-input text-[12px] px-2 py-1 h-8 w-36"
            />
            <button
              type="button"
              className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)] disabled:opacity-30"
              onClick={() => delDate(i)}
              disabled={dates.length <= 1}
              title="삭제"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            {i === dates.length - 1 && (
              <button type="button" className="cd-text-primary hover:opacity-70" onClick={addDate} title="날짜 추가">
                <Plus className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
      </div>
      <label className="flex items-start gap-2 text-[11px] cd-text cursor-pointer">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5" />
        <span>위 사용예정일로 회신하며, 본인 성명·사번·회신 시각이 전자서명으로 기록되는 것에 동의합니다.</span>
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="cd-btn cd-btn-primary text-[11px] px-2.5 py-1 disabled:opacity-50 flex items-center gap-1"
        >
          <Check className="w-3 h-3" /> 회신 제출
        </button>
        <button type="button" onClick={onCancel} className="cd-btn cd-btn-ghost text-[11px] px-2 py-1">
          취소
        </button>
      </div>
    </div>
  );
}
