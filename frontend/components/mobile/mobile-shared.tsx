"use client";

import { useState } from "react";
import { Phone, Smartphone, X } from "lucide-react";
import { ACTIVITY_TYPE_META, type SalesActivityType } from "@/lib/sales/types";

// 모바일 화면 공용 소품 — 시트(풀스크린 하단 모달)·활동유형 태그·상태 표시.

/** API 응답 shape(서버 UpcomingActivity와 동일). 일정 화면·홈 공용. */
export interface MobileActivity {
  activityId: string;
  projectId: string;
  projectTitle: string;
  facilityName: string | null;
  activityType: SalesActivityType;
  scheduledAt: string; // KST 벽시계 'YYYY-MM-DDTHH:MM:00'
  endedAt: string | null;
  summary: string | null;
  /** 일정에 연결된 사업장 담당자(월 조회 API 만 내려줌 — 홈의 upcoming 응답엔 없음) */
  contacts?: {
    id: number;
    personName: string;
    title: string | null;
    departmentName: string | null;
    mobilePhone: string | null;
    officePhone: string | null;
  }[];
}

export function ActivityTag({ type }: { type: SalesActivityType }) {
  const meta = ACTIVITY_TYPE_META[type];
  if (!meta) return null;
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold shrink-0"
      style={{ background: meta.color, color: "#1f2937" }}
    >
      {meta.short}
    </span>
  );
}

/** 'YYYY-MM-DDTHH:MM' → 'HH:MM'. 시간 없으면 빈 문자열. */
export function timeOf(iso: string): string {
  const t = iso.slice(11, 16);
  return t === "00:00" ? "" : t;
}

/** KST 오늘 'YYYY-MM-DD'. scheduled_at 이 KST 벽시계 문자열이라 날짜 문자열끼리 비교한다. */
export function kstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export function Loading() {
  return <div className="cd-text-faint text-sm text-center py-10">불러오는 중…</div>;
}

export function ErrorBox({ message }: { message: string }) {
  return <div className="cd-error-bg cd-error-text rounded-xl px-4 py-3 text-sm">{message}</div>;
}

export function Empty({ label }: { label: string }) {
  return (
    <div className="cd-text-faint text-sm text-center py-8 cd-card-bg rounded-2xl border cd-border-c">{label}</div>
  );
}

/** 하단에서 올라오는 시트 — 모바일 상세 뷰 공용(데스크톱 모달 대체). */
export function MobileSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center"
      style={{ background: "rgba(17,22,29,0.45)" }}
      onClick={onClose}
    >
      <div
        className="cd-card-bg rounded-t-3xl w-full flex flex-col"
        style={{ maxWidth: 480, maxHeight: "85dvh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0">
          <h3 className="cd-text text-base font-extrabold truncate">{title}</h3>
          <button className="cd-btn cd-btn-ghost cd-btn-sm shrink-0" onClick={onClose} aria-label="닫기">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-4 pb-6" style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** 시트 내부 라벨-값 행. */
export function SheetRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="cd-text-faint text-xs shrink-0 pt-0.5" style={{ width: 72 }}>{label}</span>
      <span className="cd-text text-sm flex-1 min-w-0 break-words">{value}</span>
    </div>
  );
}

/** 일정 상세 시트(홈·일정 공용) — 연결 담당자 카드 + 종료된 일정 경과 입력(M2/M3). */
export function ActivityDetailSheet({
  activity: detail,
  today,
  onClose,
  onSaved,
}: {
  activity: MobileActivity;
  today: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 경과 입력 가능 = 일정 기간이 시작된 것(데스크톱 ScheduleModal 의 기간경과 노출과 같은 취지)
  const canReport = (detail.endedAt ?? detail.scheduledAt).slice(0, 10) <= today;

  const save = async () => {
    if (!note.trim()) {
      setError("경과 내용을 입력하세요.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/sales/activities/${encodeURIComponent(detail.activityId)}/progress`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ progressNote: note.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <MobileSheet title={ACTIVITY_TYPE_META[detail.activityType]?.label ?? "일정 상세"} onClose={onClose}>
      <div className="rounded-xl border cd-border-c px-3 py-1.5">
        <SheetRow label="영업 건" value={detail.projectTitle} />
        <SheetRow label="사업장" value={detail.facilityName ?? "—"} />
        <SheetRow
          label="일시"
          value={`${detail.scheduledAt.slice(0, 10)} ${timeOf(detail.scheduledAt)}${
            detail.endedAt ? ` ~ ${detail.endedAt.slice(0, 10)} ${timeOf(detail.endedAt)}` : ""
          }`.trim()}
        />
        {detail.summary && <SheetRow label="업무 상세" value={detail.summary} />}
      </div>

      {/* 일정에 연결된 사업장 담당자 — 미팅 전 확인·즉시 통화 */}
      {(detail.contacts?.length ?? 0) > 0 && (
        <div className="mt-3">
          <h4 className="cd-text-muted text-xs font-bold mb-1.5">사업장 담당자</h4>
          <div className="flex flex-col gap-1.5">
            {detail.contacts!.map((c) => (
              <div key={c.id} className="rounded-xl border cd-border-c px-3 py-2.5 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="cd-text text-sm font-bold truncate">
                    {c.personName}
                    {c.title && <span className="cd-text-muted font-normal ml-1.5 text-xs">{c.title}</span>}
                  </div>
                  <div className="cd-text-faint text-xs truncate">
                    {[c.departmentName, c.mobilePhone ?? c.officePhone].filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
                {(c.mobilePhone ?? c.officePhone) && (
                  <a href={`tel:${c.mobilePhone ?? c.officePhone}`} className="cd-btn cd-btn-soft cd-btn-sm shrink-0" aria-label="전화">
                    <Phone className="w-4 h-4" />
                  </a>
                )}
                {c.mobilePhone && (
                  <a href={`sms:${c.mobilePhone}`} className="cd-btn cd-btn-soft cd-btn-sm shrink-0" aria-label="문자">
                    <Smartphone className="w-4 h-4" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {canReport ? (
        <div className="mt-3">
          <h4 className="cd-text-muted text-xs font-bold mb-1.5">경과 입력</h4>
          <textarea
            className="cd-textarea w-full"
            rows={4}
            placeholder="일정 진행 경과를 입력하세요 (입력 시 일정이 종료 처리되고 진행 단계가 갱신됩니다)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {error && <p className="cd-error-text text-xs mt-1">{error}</p>}
          <button className="cd-btn cd-btn-primary cd-btn-block justify-center mt-2" style={{ height: 44 }} onClick={save} disabled={saving}>
            {saving ? "저장 중…" : "경과 저장"}
          </button>
        </div>
      ) : (
        <p className="cd-text-faint text-xs mt-3">경과는 일정 기간이 지난 뒤 입력할 수 있습니다.</p>
      )}
    </MobileSheet>
  );
}
