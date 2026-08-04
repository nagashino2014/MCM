"use client";

// 홈 좌하단 — 내 연차·초과근무 게이지 카드(Soft Glass Ink 핸드오프).
// SVG 링 게이지 2개(r34·stroke9·그라데이션): 연차=사용/총 부여 기준, 초과근무=이번 주 사용/주 한도(12h).
// 하단 스트립: 접속 사용자의 잔존 미사용 특별휴가(장기근속휴가·초과근무 대체휴가)가 있으면 일수와 유형 표시.

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useHomeWidget } from "../useHomeWidget";

interface LeaveMe {
  summary: { granted: number; used: number; remaining: number } | null;
  special?: { kind: string; label: string; remaining: number; unit?: "day" | "hour" }[];
}

interface AttendanceMe {
  weeks: { weekStart: string; overtimeMinutes: number }[];
  limits: { weeklyOvertimeLimitMinutes: number };
}

// 시안(r34·92px)에서 20% 확대 — 카드 높이가 결재 카드와 같아지며 여백이 늘어난 만큼 게이지를 키운다.
const RING_BOX = 110;
const RING_R = 41;
const RING_STROKE = 11;
const RING_C = 2 * Math.PI * RING_R;

/** 링 게이지 — ratio(0~1)만큼 그라데이션 호를 채우고 중심에 잔여값을 쓴다. */
function Gauge({
  gradId,
  from,
  to,
  ratio,
  center,
  centerSub = "잔여",
}: {
  gradId: string;
  from: string;
  to: string;
  ratio: number;
  center: string;
  centerSub?: string;
}) {
  const dash = `${(Math.max(0, Math.min(1, ratio)) * RING_C).toFixed(1)} ${RING_C.toFixed(1)}`;
  const mid = RING_BOX / 2;
  return (
    <span className="relative inline-block" style={{ width: RING_BOX, height: RING_BOX }}>
      <svg width={RING_BOX} height={RING_BOX} viewBox={`0 0 ${RING_BOX} ${RING_BOX}`} style={{ transform: "rotate(-90deg)" }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>
        </defs>
        <circle cx={mid} cy={mid} r={RING_R} fill="none" stroke="rgba(120,135,180,0.16)" strokeWidth={RING_STROKE} />
        <circle
          cx={mid}
          cy={mid}
          r={RING_R}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={dash}
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[20px] font-extrabold cd-text leading-[1.1]">{center}</span>
        <span className="text-[10.5px] font-bold cd-text-faint">{centerSub}</span>
      </span>
    </span>
  );
}

/** 주 시작일(일요일 기준) → "8월 N주" 라벨. */
function weekLabel(weekStart: string | undefined): string {
  if (!weekStart) return "이번 주";
  const d = new Date(`${weekStart}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "이번 주";
  return `${d.getMonth() + 1}월 ${Math.ceil(d.getDate() / 7)}주`;
}

const fmtH = (min: number) => {
  const h = Math.round((min / 60) * 10) / 10;
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
};
const fmtDays = (d: number) => (Number.isInteger(d) ? `${d}일` : `${d.toFixed(1)}일`);

export function LeaveGaugeCard() {
  const year = new Date(Date.now() + 9 * 3600 * 1000).getUTCFullYear();
  const wl = useHomeWidget<LeaveMe>(`/api/approval/leave?me=1&year=${year}`);
  const wa = useHomeWidget<AttendanceMe>("/api/approval/attendance/me");

  const summary = wl.status === "ok" ? wl.data.summary : null;
  const special = wl.status === "ok" ? (wl.data.special ?? []) : [];
  const week = wa.status === "ok" ? wa.data.weeks[0] : undefined;
  const limitMin = wa.status === "ok" ? (wa.data.limits?.weeklyOvertimeLimitMinutes ?? 720) : 720;
  const otMin = week?.overtimeMinutes ?? 0;
  const otRemainMin = Math.max(0, limitMin - otMin);
  const loading = wl.status === "loading" || wa.status === "loading";

  return (
    <section className="cd-card cd-reveal flex-1 min-h-0 px-[18px] py-4 flex flex-col gap-3 overflow-hidden">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-extrabold cd-text">내 연차 · 초과근무</h2>
        <Link
          href="/approval/leave"
          className="ml-auto inline-flex items-center gap-1 text-[11.5px] font-semibold cd-text-faint hover:text-[color:var(--cd-text)] transition-colors"
        >
          근태·휴가
          <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2 animate-pulse pt-2">
          <div className="h-3.5 rounded" style={{ background: "var(--cd-hover)", width: "70%" }} />
          <div className="h-3.5 rounded" style={{ background: "var(--cd-hover)", width: "50%" }} />
        </div>
      ) : (
        // flex-1 + 수직 중앙(pb 로 중앙보다 살짝 위) — 게이지가 카드 상단에 붙지 않는다.
        <div className="flex-1 min-h-0 flex justify-around items-center gap-2 pb-3">
          <div className="flex flex-col items-center gap-1.5">
            <Gauge
              gradId="cdGaugeAnnual"
              from="#6A83EF"
              to="#8E86EE"
              ratio={summary && summary.granted > 0 ? summary.used / summary.granted : 0}
              center={summary ? fmtDays(summary.remaining) : "-"}
            />
            <span className="text-xs font-bold cd-text-body">연차</span>
            <span className="text-[10.5px] cd-text-faint -mt-1">
              {summary ? `사용 ${fmtDays(summary.used)} · 총 ${fmtDays(summary.granted)}` : "부여 이력이 없습니다"}
            </span>
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <Gauge
              gradId="cdGaugeOvertime"
              from="#3BAF8E"
              to="#5FB6E8"
              ratio={limitMin > 0 ? otMin / limitMin : 0}
              center={week ? fmtH(otRemainMin) : "-"}
            />
            <span className="text-xs font-bold cd-text-body">
              초과근무 <span className="font-semibold cd-text-faint">({weekLabel(week?.weekStart)})</span>
            </span>
            <span className="text-[10.5px] cd-text-faint -mt-1">
              {week ? `이번 주 사용 ${fmtH(otMin)} · 주 한도 ${fmtH(limitMin)}` : "근태 기록이 없습니다"}
            </span>
          </div>
        </div>
      )}

      {/* 잔존 미사용 특별휴가 — 있는 경우에만 일수·유형 표시(장기근속휴가·초과근무 대체휴가). */}
      {special.length > 0 && (
        <div
          className="mt-auto flex items-center gap-2 rounded-[11px] px-3 py-[9px]"
          style={{ background: "rgba(227,166,59,0.11)", border: "1px solid rgba(227,166,59,0.22)" }}
        >
          <span
            className="text-[10px] font-extrabold rounded-md px-[7px] py-0.5 whitespace-nowrap"
            style={{ background: "rgba(227,166,59,0.2)", color: "var(--cd-warning)" }}
          >
            특별휴가
          </span>
          <p className="m-0 text-[11.5px] font-semibold truncate" style={{ color: "#8B7B54" }}>
            {special
              .map((s) => `${s.label} ${s.unit === "hour" ? `${fmtH(s.remaining * 60)}` : fmtDays(s.remaining)}`)
              .join(" · ")}
          </p>
        </div>
      )}
    </section>
  );
}
