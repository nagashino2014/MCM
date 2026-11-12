"use client";

// 자산 이용 현황(/assets/reservations) — 자산별 예약·이용을 월 캘린더로 표시.
// 데이터원 2종: 출장신청서 상신 건의 법인차량(자동, 결재 중=가예약·승인=확정, 취소는 결재 문서에서)
// + 직접 예약(회의실 등, 법인차량은 하루 안의 짧은 사용만 — 2026-11-12).
// 캘린더는 일정 메뉴의 ScheduleCalendar 를 재사용한다 — 색은 차량(주황)/직접 예약(보라) 2계열.
// 차량 겹침은 출장 상신·직접 예약 저장에서 막고, 그 전에 생긴 겹침은 ⚠ 로 경고한다.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { AlertTriangle, Car, FileText, Plus, Trash2 } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdHelp } from "@/components/cdash/CdHelp";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { AutoDateInput } from "@/components/ui/AutoDateInput";
import { ScheduleCalendar } from "@/components/calendar/ScheduleCalendar";
import { hasPerm, permsOf } from "@/lib/auth/perms";
import { TAG_COLOR_STRONG, type CalendarEvent } from "@/lib/calendar/types";
import { ASSET_KIND_LABELS, type ReservableAsset } from "@/lib/assets/types";
import { TRIP_DRAFT_HREF, TRIP_VEHICLE_GUIDE, vehicleReservationTimeError } from "@/lib/assets/vehicle-booking-rules";
import "@/components/cdash/cdash.css";

interface UsageItem {
  id: string;
  assetId: string | null;
  assetName: string;
  assetKind: "vehicle" | "room" | "etc" | null;
  source: "reservation" | "trip";
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  userName: string | null;
  purpose: string | null;
  docId: string | null;
  docNo: string | null;
  docStatus: "in_progress" | "approved" | null;
  conflict: boolean;
  mine: boolean;
}

export function AssetCalendarBoard() {
  const { theme } = useCdashTheme();
  const { data: session } = useSession();
  // 예약 취소 API 는 본인 예약 또는 asset.manage 보유자 — 관리자는 남의 직접 예약도 취소할 수 있다(F-38).
  const canManage = hasPerm(permsOf(session?.user), "asset.manage");
  const now = new Date();
  const [cur, setCur] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [usage, setUsage] = useState<UsageItem[]>([]);
  const [assets, setAssets] = useState<ReservableAsset[]>([]);
  const [assetFilter, setAssetFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 새 예약 폼
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ assetId: "", date: "", startTime: "", endTime: "", purpose: "" });
  const [saving, setSaving] = useState(false);

  const month = `${cur.y}-${String(cur.m + 1).padStart(2, "0")}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/assets/reservations?month=${month}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "이용 현황을 불러오지 못했습니다.");
      setUsage(data.usage ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [month]);
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch("/api/assets?activeOnly=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (Array.isArray(d?.assets)) setAssets(d.assets);
      })
      .catch(() => {});
  }, []);

  const filtered = useMemo(
    () => (assetFilter ? usage.filter((u) => u.assetId === assetFilter) : usage),
    [usage, assetFilter]
  );

  // ScheduleCalendar 재사용 — 차량(출장 유래)=vehicle(주황), 직접 예약=refs(보라) 색 계열.
  const events = useMemo<CalendarEvent[]>(
    () =>
      filtered.map((u) => ({
        id: u.id,
        tag: u.source === "trip" ? "vehicle" : "refs",
        kind: "vehicle",
        title: `${u.conflict ? "⚠ " : ""}${u.assetName} · ${u.userName ?? "-"}`,
        startDate: u.startDate,
        endDate: u.endDate,
        startTime: u.startTime,
        people: [],
        summary: u.purpose,
        docId: u.docId,
        status: u.docStatus,
      })),
    [filtered]
  );

  const formVehicle = assets.find((a) => a.assetId === form.assetId)?.kind === "vehicle";

  const create = async () => {
    if (!form.assetId || !form.date) {
      alert("자산과 날짜를 선택하세요.");
      return;
    }
    // 법인차량은 하루 안의 짧은 사용만(서버도 같은 규칙으로 막는다)
    if (formVehicle) {
      const timeError = vehicleReservationTimeError(form.startTime, form.endTime);
      if (timeError) {
        alert(timeError);
        return;
      }
    }
    setSaving(true);
    try {
      const res = await fetch("/api/assets/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId: form.assetId,
          reservedOn: form.date,
          startTime: form.startTime || null,
          endTime: form.endTime || null,
          purpose: form.purpose || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "예약 실패");
      setForm({ assetId: "", date: "", startTime: "", endTime: "", purpose: "" });
      setFormOpen(false);
      await load();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (u: UsageItem) => {
    if (!u.id.startsWith("resv:")) return;
    const owner = !u.mine && u.userName ? `${u.userName}님의 ` : "";
    if (!confirm(`${u.assetName} ${u.startDate} ${owner}예약을 취소할까요?`)) return;
    try {
      const res = await fetch(`/api/assets/reservations/${encodeURIComponent(u.id.slice(5))}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "취소 실패");
      await load();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const fmtWhen = (u: UsageItem) => {
    const s = u.startDate.slice(5).replace("-", ".");
    const e = u.endDate.slice(5).replace("-", ".");
    const range = u.endDate !== u.startDate ? `${s} ~ ${e}` : s;
    const time = u.startTime && u.endTime ? ` ${u.startTime}~${u.endTime}` : u.startTime ? ` ${u.startTime}` : "";
    return range + time;
  };

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-4 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        title="자산 이용 현황"
        meta={`${month} · ${filtered.length}건`}
        actions={
          <div className="flex items-center gap-2">
            <select className="cd-select" style={{ width: 160 }} value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)}>
              <option value="">전체 자산</option>
              {assets.map((a) => (
                <option key={a.assetId} value={a.assetId}>
                  {a.name} ({ASSET_KIND_LABELS[a.kind]})
                </option>
              ))}
            </select>
            <button
              type="button"
              className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold flex items-center gap-1.5"
              onClick={() => setFormOpen((v) => !v)}
            >
              <Plus className="w-3.5 h-3.5" /> 직접 예약
            </button>
          </div>
        }
      />
      {error && <p className="text-sm cd-error-text">{error}</p>}

      {/* 법인차량 예약 규칙 안내 — 직접 예약은 짧은 일시 사용, 출장은 출장신청서로 기간 전체를 잡는다. */}
      <div className="flex items-center gap-2 flex-wrap text-[12px] cd-text-muted">
        <span className="flex items-start gap-1.5 min-w-0">
          <Car className="w-3.5 h-3.5 shrink-0 mt-[2px]" style={{ color: TAG_COLOR_STRONG.vehicle }} />
          <span>법인차량 직접 예약은 우체국 방문처럼 하루 안의 짧은 사용만 받습니다. {TRIP_VEHICLE_GUIDE}.</span>
        </span>
        <Link href={TRIP_DRAFT_HREF} className="cd-action cd-btn cd-btn-sm cd-btn-soft inline-flex items-center gap-1 !text-[12px]">
          <FileText className="w-3.5 h-3.5" /> 출장신청서 작성
        </Link>
      </div>

      {/* 직접 예약 폼 — 회의실 등 + 법인차량 짧은 사용. 출장 차량은 출장신청서 상신으로 자동 반영된다. */}
      {formOpen && (
        <div className="rounded-2xl border cd-border-c p-3 flex items-end gap-2 flex-wrap">
          <label className="text-[11px] cd-text-faint flex flex-col gap-1">
            <span className="cd-label-text">자산</span>
            <select className="cd-select" style={{ width: 170 }} value={form.assetId} onChange={(e) => setForm((p) => ({ ...p, assetId: e.target.value }))}>
              <option value="">선택</option>
              {assets.map((a) => (
                <option key={a.assetId} value={a.assetId}>
                  {a.name} ({ASSET_KIND_LABELS[a.kind]})
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] cd-text-faint flex flex-col gap-1">
            <span className="cd-label-text">날짜</span>
            <AutoDateInput className="cd-input" value={form.date} onChange={(date) => setForm((p) => ({ ...p, date }))} />
          </label>
          <label className="text-[11px] cd-text-faint flex flex-col gap-1">
            <span className="cd-label-text">{formVehicle ? "시작(필수)" : "시작(비우면 종일)"}</span>
            <input type="time" className="cd-input" value={form.startTime} onChange={(e) => setForm((p) => ({ ...p, startTime: e.target.value }))} />
          </label>
          <label className="text-[11px] cd-text-faint flex flex-col gap-1">
            <span className="cd-label-text">{formVehicle ? "종료(필수)" : "종료"}</span>
            <input type="time" className="cd-input" value={form.endTime} onChange={(e) => setForm((p) => ({ ...p, endTime: e.target.value }))} />
          </label>
          <label className="text-[11px] cd-text-faint flex flex-col gap-1 flex-1 min-w-[160px]">
            <span className="cd-label-text">목적</span>
            <input className="cd-input w-full" value={form.purpose} onChange={(e) => setForm((p) => ({ ...p, purpose: e.target.value }))} placeholder={formVehicle ? "방문처·용도" : "회의명·용도"} />
          </label>
          <button type="button" className="cd-btn cd-btn-primary rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50" disabled={saving} onClick={create}>
            {saving ? "등록 중..." : "예약 등록"}
          </button>
        </div>
      )}

      {loading && usage.length === 0 ? (
        <p className="text-sm cd-text-faint">불러오는 중입니다.</p>
      ) : (
        <>
          <ScheduleCalendar
            events={events}
            year={cur.y}
            month0={cur.m}
            onMonthChange={(y, m) => setCur({ y, m })}
            onEventClick={() => {}}
          />
          <div className="flex items-center gap-3 text-[11px] cd-text-faint">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: TAG_COLOR_STRONG.vehicle }} /> 출장 법인차량(결재 연동)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: TAG_COLOR_STRONG.refs }} /> 직접 예약
            </span>
            <span className="flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" style={{ color: "var(--cd-warning)" }} /> 이중 배정 경고
            </span>
            <CdHelp topic="assets.legend" />
          </div>

          {/* 이용 목록 */}
          <div className="cd-card p-4 gap-2">
            {filtered.map((u) => (
              <div key={u.id} className="flex items-center gap-3 rounded-xl border cd-border-c px-2.5 py-[13.5px]" style={u.conflict ? { borderColor: "var(--cd-warning)" } : undefined}>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: u.source === "trip" ? TAG_COLOR_STRONG.vehicle : TAG_COLOR_STRONG.refs }} />
                <span className="text-[13px] font-bold cd-text shrink-0">{u.assetName}</span>
                <span className="text-[12px] cd-text-muted tabular-nums shrink-0">{fmtWhen(u)}</span>
                <span className="text-[12px] cd-text-muted truncate flex-1 min-w-0">
                  {u.userName ?? "-"}
                  {u.purpose && <span className="cd-text-faint"> · {u.purpose}</span>}
                </span>
                {u.source === "trip" && (
                  <>
                    <span className={`cd-pill shrink-0 !text-[11px] ${u.docStatus === "approved" ? "cd-pill-success" : "cd-pill-warn"}`}>
                      {u.docStatus === "approved" ? "확정" : "가예약 · 결재 중"}
                    </span>
                    {u.docId && (
                      <Link
                        href={`/approval?docId=${encodeURIComponent(u.docId)}`}
                        className="cd-action shrink-0 inline-flex items-center gap-1 text-[12px] cd-text-primary whitespace-nowrap"
                        title={`출장신청서${u.docNo ? ` ${u.docNo}` : ""} 열기(차량 변경·취소는 결재 문서에서)`}
                      >
                        <FileText className="w-3.5 h-3.5" /> 출장신청서
                        {u.docNo && <span className="hidden md:inline">{u.docNo}</span>}
                      </Link>
                    )}
                  </>
                )}
                {u.conflict && <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--cd-warning)" }} />}
                {(u.mine || canManage) && u.source === "reservation" && (
                  <button type="button" className="shrink-0 p-1 rounded-md cd-text-faint hover:cd-error-text" title="예약 취소" onClick={() => remove(u)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
            {filtered.length === 0 && <p className="text-xs cd-text-faint py-4 text-center">이 달 이용 내역이 없습니다.</p>}
          </div>
        </>
      )}
    </div>
  );
}
