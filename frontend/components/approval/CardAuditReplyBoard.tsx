"use client";

// 법인카드 사용 내역 소명(회신) — 재무 담당이 요청한 증빙 없는 카드 건에 대해 부서장이 사유를 적는다(352).
// 본인에게 온 요청 건의 사용일·가맹점·금액만 보인다(재무 권한 불필요).
// 진입: 할 일의 링크(/approval/card-audit).

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CreditCard } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdButton } from "@/components/cdash/CdButton";
import { CdBadge } from "@/components/cdash/CdBadge";
import { CdEmptyState } from "@/components/cdash/CdEmptyState";
import "@/components/cdash/cdash.css";

interface RequestRow {
  requestId: string;
  status: "pending" | "answered";
  note: string | null;
  answer: string | null;
  createdAt: string;
  usedAt: string;
  cardLabel: string;
  storeName: string | null;
  storeAddr: string | null;
  amount: number;
  evidenced: boolean;
  trip: { docId: string; docNo: string | null; drafterName: string | null; from: string | null; to: string | null; place: string | null } | null;
}

export function CardAuditReplyBoard() {
  const { theme } = useCdashTheme();
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/approval/card-audit", { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "불러오지 못했습니다.");
      setRows(d.requests ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const answer = async (r: RequestRow) => {
    const value = (draft[r.requestId] ?? r.answer ?? "").trim();
    if (!value) {
      setError("소명 내용을 입력하세요.");
      return;
    }
    setMsg(null);
    setError(null);
    setBusy(r.requestId);
    try {
      const res = await fetch("/api/approval/card-audit", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: r.requestId, answer: value }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error ?? "회신하지 못했습니다.");
      setMsg("회신했습니다.");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-lg overflow-y-auto" data-theme={theme}>
      <CdPageHeader
        icon={<CreditCard className="w-5 h-5" />}
        eyebrow="Approval · Card audit"
        title="법인카드 사용 내역 소명"
        helpTopic="approval.card-audit"
      />
      {msg && <p className="text-[12px] cd-text">{msg}</p>}
      {error && <p className="text-[12px] cd-error-text">{error}</p>}

      {!loading && rows.length === 0 && !error && (
        <CdEmptyState icon={<CreditCard className="w-6 h-6" />} title="받은 소명 요청이 없습니다" />
      )}

      {rows.map((r) => (
        <div key={r.requestId} className="cd-card rounded-lg p-5 flex flex-col gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-[14px] font-semibold cd-text">
              {r.usedAt.slice(0, 10)} · {r.storeName ?? "가맹점 미상"} · {r.amount.toLocaleString("ko-KR")}원
            </h2>
            {r.evidenced ? (
              <CdBadge tone="success">증빙 완료</CdBadge>
            ) : r.status === "answered" ? (
              <CdBadge tone="info">회신함</CdBadge>
            ) : (
              <CdBadge tone="warn">회신 대기</CdBadge>
            )}
          </div>
          <p className="text-[12px] cd-text-faint">
            카드 {r.cardLabel} · {r.storeAddr ?? "가맹점 주소 없음"}
          </p>
          {r.trip && (
            <p className="text-[12px] cd-text">
              같은 날짜의 출장(추정):{" "}
              <Link href={`/approval?docId=${encodeURIComponent(r.trip.docId)}`} target="_blank" className="cd-text-primary">
                {r.trip.drafterName ?? "-"} · {r.trip.from ?? ""}{r.trip.to && r.trip.to !== r.trip.from ? ` ~ ${r.trip.to}` : ""}
                {r.trip.place ? ` · ${r.trip.place}` : ""}
              </Link>
            </p>
          )}
          {r.note && <p className="text-[12px] cd-text-faint">요청 메모: {r.note}</p>}
          <textarea
            className="cd-textarea text-[13px]"
            rows={2}
            aria-label="소명 내용"
            placeholder="누가 어떤 용도로 썼는지 적어 주세요. 출장 경비라면 출장보고서에 담아 올리면 됩니다."
            value={draft[r.requestId] ?? r.answer ?? ""}
            onChange={(e) => setDraft((prev) => ({ ...prev, [r.requestId]: e.target.value }))}
          />
          <div className="flex justify-end">
            <CdButton variant="primary" size="sm" loading={busy === r.requestId} disabled={busy != null} onClick={() => void answer(r)}>
              {r.status === "answered" ? "다시 회신" : "회신"}
            </CdButton>
          </div>
        </div>
      ))}
    </div>
  );
}
