"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Download, LayoutGrid, RotateCcw, Save } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { HomeStats } from "./HomeStats";
import { HomeEditGrid, type HomeGridEntry } from "./HomeEditGrid";
import { HOME_WIDGETS, EMPTY_HOME_LAYOUT, HOME_HALF_H, HOME_COLS, type HomeLayout, type HomeLayoutItem } from "@/lib/home/widgets";
import type { HomePresets } from "@/lib/home/layout";
import "@/components/cdash/cdash.css";

import { ApprovalPendingCard } from "./widgets/ApprovalPendingCard";
import { MailUnreadCard } from "./widgets/MailUnreadCard";
import { ScheduleCalendarCard } from "./widgets/ScheduleCalendarCard";
import { PendingProgressCard } from "./widgets/PendingProgressCard";
import { UpcomingBidsCard } from "./widgets/UpcomingBidsCard";
import { WorkPlanTodoCard } from "./widgets/WorkPlanTodoCard";
import { InvoiceRequestCard } from "./widgets/InvoiceRequestCard";
import { InvoiceInboxCard } from "./widgets/InvoiceInboxCard";
import { LeaveNoticeInboxCard } from "./widgets/LeaveNoticeInboxCard";
import { QuickFacilitiesCard } from "./widgets/QuickFacilitiesCard";
import { BillingSummaryCard } from "./widgets/BillingSummaryCard";
import { IntelHighlightsCard } from "./widgets/IntelHighlightsCard";
import { MyServicesCard } from "./widgets/MyServicesCard";
import { MetricHighlightCard } from "./widgets/MetricHighlightCard";

/** "7월 29일 수요일" (KST). */
function todayLabel(): string {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const dow = ["일", "월", "화", "수", "목", "금", "토"][kst.getUTCDay()];
  return `${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일 ${dow}요일`;
}

/**
 * 홈 대시보드 보드(cdash).
 * 레이아웃(Soft Glass Ink): masonry 폐기 — 배치가 '중요도'가 아닌 '카드 높이' 순이라
 * 스캔 순서를 예측할 수 없었다(분석 §2 /home).
 * 고정 영역(스탯 4카드·내 차례인 결재·안읽은 메일·캘린더)은 항상 같은 자리에 있고,
 * 나머지 카드는 사용자가 편집 모드에서 표시 여부·위치·크기를 정한다(HC-B, 서버 저장).
 * 권한이 없는 카드는 각 위젯이 API 403 으로 스스로 숨고, 편집 목록에도 나오지 않는다.
 */
export function HomeBoard({ role }: { role?: string }) {
  const { theme } = useCdashTheme();
  const [editing, setEditing] = useState(false);
  const [layout, setLayout] = useState<HomeLayout>(EMPTY_HOME_LAYOUT);
  const [presets, setPresets] = useState<HomePresets>({});
  const [available, setAvailable] = useState<Array<{ key: string; label: string }>>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/home/layout", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || !alive) return;
        // widgetConfig(metrics 선택 지표)까지 그대로 실어야 새로고침 후에도 유지된다.
        if (d.layout) setLayout({ ...d.layout, hidden: d.layout.hidden ?? [], items: d.layout.items ?? {} });
        if (d.presets) setPresets(d.presets);
        if (Array.isArray(d.available)) setAvailable(d.available);
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const persist = useCallback((next: HomeLayout) => {
    setLayout(next);
    fetch("/api/home/layout", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ layout: next }),
    }).catch(() => {
      /* 저장 실패가 화면 조작을 막지 않는다 */
    });
  }, []);

  const toggleHidden = (key: string) => {
    const hidden = layout.hidden.includes(key)
      ? layout.hidden.filter((k) => k !== key)
      : [...layout.hidden, key];
    persist({ ...layout, hidden });
  };

  const resetLayout = () => persist({ hidden: [], items: {} });

  /** 현재 배치(표시 카드+위치·크기)를 프리셋 슬롯에 저장한다. widgetConfig 는 전역이라 제외. */
  const savePreset = (slot: "1" | "2" | "3") => {
    const snapshot: HomeLayout = { hidden: layout.hidden, items: layout.items };
    const next = { ...presets, [slot]: snapshot };
    setPresets(next);
    fetch("/api/home/layout", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ presets: next }),
    }).catch(() => {
      /* 저장 실패가 화면 조작을 막지 않는다 */
    });
  };

  /** 프리셋 슬롯을 현재 배치로 적용한다(metrics 지표 선택 등 widgetConfig 는 유지). */
  const applyPreset = (slot: "1" | "2" | "3") => {
    const preset = presets[slot];
    if (!preset) return;
    persist({ ...layout, hidden: preset.hidden, items: preset.items });
  };

  // 배치 대상 카드 — 권한(available)과 숨김(hidden)을 모두 통과한 것만.
  const entries = useMemo<HomeGridEntry[]>(() => {
    const NODES: Record<string, React.ReactNode> = {
      leaveNotice: <LeaveNoticeInboxCard />,
      pendingProgress: <PendingProgressCard theme={theme} />,
      upcomingBids: <UpcomingBidsCard />,
      workPlan: <WorkPlanTodoCard />,
      invoiceRequest: <InvoiceRequestCard />,
      invoiceInbox: <InvoiceInboxCard />,
      billingSummary: <BillingSummaryCard />,
      myServices: <MyServicesCard />,
      intel: <IntelHighlightsCard />,
      quickFacilities: <QuickFacilitiesCard role={role} />,
      metrics: (
        <MetricHighlightCard
          metricKey={layout.widgetConfig?.metrics?.metricKey}
          onSelect={(metricKey) => persist({ ...layout, widgetConfig: { ...layout.widgetConfig, metrics: { metricKey } } })}
        />
      ),
    };
    const allowed = new Set(available.map((a) => a.key));
    return HOME_WIDGETS.filter(
      (w) => (available.length === 0 || allowed.has(w.key)) && !layout.hidden.includes(w.key)
    ).map((w) => ({ key: w.key, node: NODES[w.key], defaultW: w.defaultW, defaultH: w.defaultH }));
  }, [available, layout, persist, role, theme]);

  const onGridChange = useCallback(
    (items: Record<string, HomeLayoutItem>) => {
      setLayout((prev) => {
        const next = { ...prev, items };
        fetch("/api/home/layout", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ layout: next }),
        }).catch(() => {
          /* 침묵 */
        });
        return next;
      });
    },
    []
  );

  return (
    <div className="cdash cd-fields-white flex flex-col gap-4 p-4 rounded-3xl min-h-full" data-theme={theme}>
      <CdPageHeader
        title="홈"
        meta={todayLabel()}
        actions={
          <div className="flex items-center gap-1.5">
            {/* 저장된 배치 프리셋 빠른 전환 — 편집 모드에 들어가지 않고 바로 갈아입는다. */}
            {(["1", "2", "3"] as const).map(
              (slot) =>
                presets[slot] && (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => applyPreset(slot)}
                    className="cd-chip cd-chip-sm"
                    title={`배치 프리셋 ${slot} 적용`}
                  >
                    <LayoutGrid className="w-3 h-3" />
                    {slot}
                  </button>
                )
            )}
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              data-active={editing || undefined}
              className="cd-chip"
              title="카드 표시 여부와 위치·크기를 조정합니다"
            >
              {editing ? <Check className="w-3.5 h-3.5" /> : <LayoutGrid className="w-3.5 h-3.5" />}
              {editing ? "편집 완료" : "홈 화면 편집"}
            </button>
          </div>
        }
      />

      {/* 편집 패널 — 표시할 카드 선택(권한 있는 항목만 나열) */}
      {editing && (
        <section className="cd-card px-[18px] py-3.5 gap-2.5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-extrabold cd-text">표시할 카드</h2>
            <span className="text-[11.5px] cd-text-faint">
              스탯·결재 대기·안읽은 메일·캘린더는 항상 표시됩니다. 좌상단 손잡이로 이동, 우측·하단·모서리 핸들로 너비·높이를 조절하세요
              (위 고정 카드와 같은 폭으로 맞추려면 {HOME_COLS}칸 중 왼쪽 14칸·오른쪽 10칸).
            </span>
            <button type="button" onClick={resetLayout} className="cd-chip cd-chip-sm ml-auto shrink-0" title="배치와 표시 설정을 처음 상태로">
              <RotateCcw className="w-3 h-3" />
              기본값
            </button>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {available.length === 0 && loaded && (
              <span className="text-[12px] cd-text-faint">표시할 수 있는 카드가 없습니다.</span>
            )}
            {available.map((w) => (
              <button
                key={w.key}
                type="button"
                onClick={() => toggleHidden(w.key)}
                data-active={!layout.hidden.includes(w.key) || undefined}
                className="cd-chip cd-chip-sm"
              >
                {!layout.hidden.includes(w.key) && <Check className="w-3 h-3" />}
                {w.label}
              </button>
            ))}
          </div>

          {/* 배치 프리셋 3슬롯 — 현재 배치를 저장해 두고 헤더 칩으로 바로 전환한다(126). */}
          <div className="flex items-center gap-2 flex-wrap pt-1 border-t cd-hairline-c">
            <h2 className="text-sm font-extrabold cd-text">배치 프리셋</h2>
            <span className="text-[11.5px] cd-text-faint">저장한 슬롯은 홈 상단에 전환 버튼으로 나타납니다.</span>
            <div className="flex items-center gap-1.5 ml-auto">
              {(["1", "2", "3"] as const).map((slot) => (
                <span key={slot} className="flex items-center gap-1 rounded-lg border cd-line-c px-1.5 py-1">
                  <span className="text-[11.5px] font-extrabold cd-text px-0.5">{slot}</span>
                  <button
                    type="button"
                    onClick={() => applyPreset(slot)}
                    disabled={!presets[slot]}
                    className="cd-chip cd-chip-sm disabled:opacity-40"
                    title={presets[slot] ? `프리셋 ${slot} 불러오기` : "저장된 배치가 없습니다"}
                  >
                    <Download className="w-3 h-3" />
                    불러오기
                  </button>
                  <button
                    type="button"
                    onClick={() => savePreset(slot)}
                    className="cd-chip cd-chip-sm"
                    title={`현재 배치를 프리셋 ${slot}에 저장`}
                  >
                    <Save className="w-3 h-3" />
                    저장
                  </button>
                </span>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 고정 영역 — 스탯 4카드 */}
      <HomeStats />

      {/* 고정 영역 — 좌: 내 차례인 결재·안읽은 메일(각각 캘린더 높이의 절반) / 우: 캘린더.
          높이를 고정해 두면 아래 사용자 배치 영역의 시작 위치가 데이터 양에 따라 흔들리지 않는다.
          열 체계는 배치 영역과 동일한 24열 — 좌 14 / 우 10 이라 카드 좌우 경계가 정확히 맞물린다
          (fr 비율로 나누면 12열 그리드에 떨어지지 않아 폭을 맞출 수 없었다). */}
      {/* ⚠ 아래 24 / 14 / 10 은 HOME_COLS·HOME_FIXED_LEFT_COLS 와 같은 값이어야 한다
          (Tailwind 는 정적 클래스만 생성하므로 상수를 문자열에 끼워 넣을 수 없다). */}
      <div className="grid grid-cols-1 gap-4 items-start xl:grid-cols-[repeat(24,minmax(0,1fr))]">
        <div className="flex flex-col gap-4 min-w-0 xl:[grid-column:span_14]">
          <div style={{ height: HOME_HALF_H }} className="[&>section]:h-full min-w-0">
            <ApprovalPendingCard />
          </div>
          <div style={{ height: HOME_HALF_H }} className="[&>section]:h-full min-w-0">
            <MailUnreadCard />
          </div>
        </div>
        <div className="min-w-0 xl:[grid-column:span_10]">
          <ScheduleCalendarCard />
        </div>
      </div>

      {/* 사용자 배치 영역 */}
      <HomeEditGrid entries={entries} layout={layout} editing={editing} onChange={onGridChange} />
    </div>
  );
}
