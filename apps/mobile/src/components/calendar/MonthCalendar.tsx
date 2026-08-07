import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Sheet } from "@/components/ui";
import { useTheme } from "@/theme/useTheme";

/**
 * 공용 월 캘린더 — 일정·영업 스케줄·기안 날짜 입력이 함께 쓴다.
 *
 * 웹 `components/calendar/ScheduleCalendar.tsx` 의 6주 격자·레인 배정을 그대로 옮겼다
 * (멀티데이 바가 주 경계를 넘어가도 겹치지 않게 월 전역으로 레인을 잡는다).
 * 모바일은 폭이 좁아 레인을 4→3, 바 높이를 20→16 으로 줄였고 초과분은 셀 하단 "+N".
 *
 * `mode="picker"` 는 날짜 선택 전용이다. 이 모드 덕분에 네이티브 date picker 를
 * 추가하지 않아도 되고(= 네이티브 모듈 없이 OTA 배포 유지), 기안 폼의 date·period 필드가
 * 일정 화면과 같은 달력을 쓴다.
 */

export interface CalendarBar {
  id: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD. 없으면 하루짜리. */
  endDate?: string | null;
  title: string;
  /** 바 배경색(파스텔). */
  color: string;
  /** 바 글자색. 기본은 진한 잉크. */
  ink?: string;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const LANE_H = 16;
const MAX_LANES = 3;
const DATE_ROW_H = 22;
const SUN = "#EF4444";
const SAT = "#3B82F6";

export function ymdOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dayNum(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

interface Span {
  bar: CalendarBar;
  s: number;
  e: number;
}

export function MonthCalendar({
  events = [],
  year,
  month0,
  onMonthChange,
  onEventPress,
  onDayPress,
  mode = "view",
  selected,
  rangeEnd,
}: {
  events?: CalendarBar[];
  year: number;
  /** 0-based 월 */
  month0: number;
  onMonthChange: (year: number, month0: number) => void;
  onEventPress?: (bar: CalendarBar) => void;
  onDayPress?: (iso: string) => void;
  /** picker 는 이벤트 바 대신 선택 상태만 그린다. */
  mode?: "view" | "picker";
  /** 선택된 날짜(YYYY-MM-DD). 범위 선택이면 시작일. */
  selected?: string | null;
  /** 범위 선택의 종료일. */
  rangeEnd?: string | null;
  /**
   * 셀 격자선. 기본은 그린다(날짜 선택 모드에서 칸 경계가 있어야 누르기 쉽다).
   * 일정 화면은 데스크탑 홈 캘린더처럼 선을 없애고 오늘만 원형으로 강조한다.
   */
  grid?: boolean;
}) {
  const { c } = useTheme();
  const [pick, setPick] = useState<null | "year" | "month">(null);
  const now = useMemo(() => new Date(), []);
  const todayIso = ymdOf(now);

  const spans = useMemo<Span[]>(
    () =>
      events
        .filter((b) => b.startDate)
        .map((b) => ({
          bar: b,
          s: dayNum(b.startDate),
          e: Math.max(dayNum(b.endDate || b.startDate), dayNum(b.startDate)),
        }))
        .sort((x, y) => x.s - y.s || x.bar.id.localeCompare(y.bar.id)),
    [events]
  );

  // 레인 배정(월 전역, 최대 3). 초과는 -1 → 셀 하단 "+N".
  const laneOf = useMemo(() => {
    const lanes: Array<Array<{ s: number; e: number }>> = Array.from({ length: MAX_LANES }, () => []);
    const map = new Map<string, number>();
    for (const it of spans) {
      let placed = -1;
      for (let l = 0; l < MAX_LANES; l += 1) {
        if (lanes[l].every((iv) => it.e < iv.s || it.s > iv.e)) {
          lanes[l].push({ s: it.s, e: it.e });
          placed = l;
          break;
        }
      }
      map.set(it.bar.id, placed);
    }
    return map;
  }, [spans]);

  const weeks = useMemo(() => {
    const first = new Date(year, month0, 1);
    const cursor = new Date(year, month0, 1 - first.getDay());
    const out: Date[][] = [];
    for (let w = 0; w < 6; w += 1) {
      const row: Date[] = [];
      for (let d = 0; d < 7; d += 1) {
        row.push(new Date(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }
      out.push(row);
    }
    return out;
  }, [year, month0]);

  const moveMonth = (delta: number) => {
    const m = month0 + delta;
    onMonthChange(year + Math.floor(m / 12), ((m % 12) + 12) % 12);
  };

  const selStart = selected ? dayNum(selected) : null;
  const selEnd = rangeEnd ? dayNum(rangeEnd) : selStart;
  const cellH = mode === "picker" ? 44 : DATE_ROW_H + MAX_LANES * LANE_H + 6;
  const yearOptions = Array.from({ length: 7 }, (_, i) => now.getFullYear() - 3 + i);

  return (
    <View className="rounded-card border border-cd-border bg-cd-card p-3">
      {/* 헤더 — 연·월 선택 + 오늘 + 이전/다음 */}
      <View className="mb-2 flex-row items-center">
        <Pressable
          onPress={() => setPick("year")}
          className="flex-row items-center gap-1 rounded-xl px-2 py-1 active:opacity-60">
          <Text className="text-[17px] font-extrabold text-cd-text">{year}년</Text>
          <Ionicons name="chevron-down" size={13} color={c.faint} />
        </Pressable>
        <Pressable
          onPress={() => setPick("month")}
          className="flex-row items-center gap-1 rounded-xl px-2 py-1 active:opacity-60">
          <Text className="text-[17px] font-extrabold text-cd-primary">{month0 + 1}월</Text>
          <Ionicons name="chevron-down" size={13} color={c.faint} />
        </Pressable>
        <Pressable
          onPress={() => onMonthChange(now.getFullYear(), now.getMonth())}
          className="ml-1 rounded-full border border-cd-border px-2.5 py-1 active:opacity-60">
          <Text className="text-[11px] font-bold text-cd-muted">오늘</Text>
        </Pressable>
        <View className="flex-1" />
        <Pressable
          onPress={() => moveMonth(-1)}
          hitSlop={6}
          className="h-9 w-9 items-center justify-center rounded-xl border border-cd-border active:opacity-60">
          <Ionicons name="chevron-back" size={17} color={c.muted} />
        </Pressable>
        <Pressable
          onPress={() => moveMonth(1)}
          hitSlop={6}
          className="ml-1.5 h-9 w-9 items-center justify-center rounded-xl border border-cd-border active:opacity-60">
          <Ionicons name="chevron-forward" size={17} color={c.muted} />
        </Pressable>
      </View>

      {/* 요일 */}
      <View className="flex-row">
        {WEEKDAYS.map((w, i) => (
          <Text
            key={w}
            className="flex-1 py-1 text-center text-[11px]"
            style={{ color: i === 0 ? SUN : i === 6 ? SAT : c.faint }}>
            {w}
          </Text>
        ))}
      </View>

      {/* 6주 격자 */}
      {weeks.map((week, wi) => {
        const weekStart = dayNum(ymdOf(week[0]));
        const weekEnd = weekStart + 6;
        const segs =
          mode === "picker"
            ? []
            : spans
                .filter((it) => (laneOf.get(it.bar.id) ?? -1) >= 0 && !(it.e < weekStart || it.s > weekEnd))
                .map((it) => ({
                  it,
                  colStart: Math.max(it.s, weekStart) - weekStart,
                  colEnd: Math.min(it.e, weekEnd) - weekStart,
                  lane: laneOf.get(it.bar.id) ?? 0,
                }));
        const overflow = new Array(7).fill(0);
        if (mode !== "picker") {
          for (const it of spans) {
            if ((laneOf.get(it.bar.id) ?? -1) !== -1) continue;
            for (let col = 0; col < 7; col += 1) {
              const dn = weekStart + col;
              if (dn >= it.s && dn <= it.e) overflow[col] += 1;
            }
          }
        }

        return (
          <View key={wi} className="flex-row" style={{ minHeight: cellH }}>
            {week.map((day, di) => {
              const iso = ymdOf(day);
              const dn = dayNum(iso);
              const inMonth = day.getMonth() === month0;
              const dow = day.getDay();
              const isToday = iso === todayIso;
              const inRange = selStart != null && selEnd != null && dn >= selStart && dn <= selEnd;
              const isEdge = dn === selStart || dn === selEnd;
              return (
                <Pressable
                  key={di}
                  onPress={onDayPress ? () => onDayPress(iso) : undefined}
                  disabled={!onDayPress}
                  className="flex-1 border border-cd-border p-1"
                  style={{
                    borderColor: isToday ? c.primary : c.border,
                    backgroundColor: inRange ? (isEdge ? c.primary : c.primarySoft) : c.card,
                    opacity: inMonth ? 1 : 0.4,
                  }}>
                  <Text
                    className={`text-[11px] ${isEdge && inRange ? "font-extrabold" : ""}`}
                    style={{
                      color:
                        isEdge && inRange ? "#FFFFFF" : dow === 0 ? SUN : dow === 6 ? SAT : c.muted,
                    }}>
                    {day.getDate()}
                  </Text>
                  {overflow[di] > 0 ? (
                    <Text className="mt-auto text-[9px]" style={{ color: c.faint }}>
                      +{overflow[di]}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}

            {/* 이벤트 바 — 셀 위에 절대배치(주 단위로 이어 그린다) */}
            {segs.map(({ it, colStart, colEnd, lane }) => (
              <View
                key={it.bar.id}
                pointerEvents="box-none"
                style={{
                  position: "absolute",
                  left: `${(colStart / 7) * 100}%`,
                  width: `${((colEnd - colStart + 1) / 7) * 100}%`,
                  top: DATE_ROW_H + lane * LANE_H,
                  height: LANE_H - 3,
                  paddingHorizontal: 2,
                }}>
                <Pressable
                  onPress={onEventPress ? () => onEventPress(it.bar) : undefined}
                  disabled={!onEventPress}
                  className="flex-1 justify-center rounded-md px-1.5 active:opacity-70"
                  style={{ backgroundColor: it.bar.color }}>
                  <Text numberOfLines={1} className="text-[10px] font-semibold" style={{ color: it.bar.ink ?? "#1f2937" }}>
                    {it.bar.title}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        );
      })}

      {/* 연·월 선택 시트 */}
      <Sheet visible={pick === "year"} onClose={() => setPick(null)} title="연도 선택">
        <View className="gap-1 pb-2">
          {yearOptions.map((y) => (
            <Pressable
              key={y}
              onPress={() => {
                onMonthChange(y, month0);
                setPick(null);
              }}
              className={`rounded-xl px-4 py-3 active:opacity-70 ${y === year ? "bg-cd-primary-soft" : ""}`}>
              <Text className={`text-[15px] ${y === year ? "font-extrabold text-cd-primary" : "text-cd-text"}`}>
                {y}년
              </Text>
            </Pressable>
          ))}
        </View>
      </Sheet>
      <Sheet visible={pick === "month"} onClose={() => setPick(null)} title="월 선택">
        <View className="flex-row flex-wrap gap-2 pb-2">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
            const sel = m === month0 + 1;
            return (
              <Pressable
                key={m}
                onPress={() => {
                  onMonthChange(year, m - 1);
                  setPick(null);
                }}
                style={{ width: "31%" }}
                className={`items-center rounded-xl py-3 active:opacity-70 ${sel ? "bg-cd-primary" : "bg-cd-surface"}`}>
                <Text className={`text-[14px] font-bold ${sel ? "text-white" : "text-cd-muted"}`}>{m}월</Text>
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </View>
  );
}
