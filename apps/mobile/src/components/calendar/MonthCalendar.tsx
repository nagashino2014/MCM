import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Sheet } from '@/components/ui';
import { CAL_MUTED, TAG_INK } from '@/lib/calendar/types';
import { useHolidays } from '@/lib/calendar/use-holidays';
import { SHADOW_CARD } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

/**
 * 공용 월 캘린더 — 일정·영업 스케줄·기안 날짜 입력이 함께 쓴다. KESI Frosted 규격(2026-11-03).
 *
 * variant
 *  - `pills`(기본)·`bars`: **연속 일정 바** — 멀티데이 일정은 걸치는 날을 하나의 가로 바로 잇는다(주 단위 세그먼트,
 *    주가 바뀌면 다음 줄에 이어진다). 예전 pills 모드는 날마다 끊어진 필을 반복해 제목이 거의 안 보였고(2026-11-03 사용자 지적),
 *    예전 bars 모드는 월 전역 레인 배정이라 빈 레인이 많아 셀이 커졌다 → 두 모드를 이 구현으로 통합했다(값만 다르고 결과는 같다).
 *    레인은 **주마다** 독립 배정(최대 3), 초과분은 셀 아래 "+N". 셀 높이는 그 주의 레인 수에 맞춰 가변.
 *    `breakOnHoliday` 바(할 일)는 토·일·공휴일에서 끊긴다 — 휴일에는 바를 그리지 않고 전후를 별도 세그먼트로.
 *  - `picker`: 날짜·기간 선택 전용(이벤트 없음, 셀 44). DatePickerSheet 가 쓴다.
 *
 * picker 모드 덕분에 네이티브 date picker 를 넣지 않아도 되고(= 네이티브 모듈 없이 OTA 배포 유지),
 * 기안 폼의 date·period 필드가 일정 화면과 같은 달력을 쓴다.
 */

export interface CalendarBar {
  id: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD. 없으면 하루짜리. */
  endDate?: string | null;
  title: string;
  /** 바 배경색. */
  color: string;
  /** 글자색. */
  ink?: string;
  /** true 면 휴일(토·일·공휴일)에서 바를 끊는다 — 할 일처럼 근무일에만 의미 있는 일정. 출장·휴가는 휴일을 포함해 잇는다. */
  breakOnHoliday?: boolean;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
/** 날짜 숫자 줄 — 오늘 원(26) + 위 여백 2 가 들어가는 높이. 바는 이 아래부터 쌓인다. */
const DATE_ROW_H = 28;
/** 휴무일명 줄(글자 10) — 그 주에 당월 휴무일이 있으면 바를 이 만큼 더 내린다. */
const HOLIDAY_ROW_H = 12;
/** 레인 간격 = 바 높이 16 + 바 사이 2. */
const BAR_H = 16;
const LANE_H = BAR_H + 2;
const MAX_LANES = 3;
/** 초과 "+N" 줄. */
const OVERFLOW_ROW_H = 14;
/** 셀 최소 높이(마지막 주는 익월만 있는 경우가 많아 44 유지 — 기존 특례). */
const CELL_MIN_H = 54;
const CELL_MIN_H_LAST = 44;
const CELL_H_PICKER = 44;

export function ymdOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dayNum(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

interface Span {
  bar: CalendarBar;
  s: number;
  e: number;
}

/** 한 주 안의 바 조각 — 열(0=일 … 6=토) 범위와 배정 레인(-1 = 초과). */
interface Seg {
  bar: CalendarBar;
  colStart: number;
  colEnd: number;
  lane: number;
}

export function MonthCalendar({
  events = [],
  year,
  month0,
  onMonthChange,
  onEventPress,
  onDayPress,
  variant = 'pills',
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
  /** `pills`·`bars` 는 같은 연속 바 모드(호환), `picker` 는 날짜 선택 전용. */
  variant?: 'pills' | 'bars' | 'picker';
  /** 선택된 날짜(YYYY-MM-DD). 범위 선택이면 시작일. */
  selected?: string | null;
  /** 범위 선택의 종료일. */
  rangeEnd?: string | null;
}) {
  const { c, dark } = useTheme();
  // 날짜 숫자 색 — 상수(라이트 전용 hex)를 다크에서 그대로 쓰면 당월이 어둡고 전·익월이 밝아
  // 뒤집혀 보인다(09-04 실기기 실측). 다크는 테마 토큰으로: 당월=본문색, 전·익월=흐린색.
  const dayInk = dark ? c.text : CAL_MUTED.day;
  const outside = dark ? c.faint : CAL_MUTED.outside;
  const outsideSun = dark ? `${CAL_MUTED.sun}66` : CAL_MUTED.outsideSun;
  // 휴무일(법정공휴일·사내 지정) — 웹 캘린더와 같은 규칙: 일요일과 같은 붉은 숫자 + 휴무일명.
  const holidays = useHolidays(year);
  const [pick, setPick] = useState<null | 'year' | 'month'>(null);
  const now = useMemo(() => new Date(), []);
  const todayIso = ymdOf(now);
  const isPicker = variant === 'picker';

  const spans = useMemo<Span[]>(
    () =>
      isPicker
        ? []
        : events
            .filter((b) => b.startDate)
            .map((b) => ({
              bar: b,
              s: dayNum(b.startDate),
              e: Math.max(dayNum(b.endDate || b.startDate), dayNum(b.startDate)),
            }))
            .sort((x, y) => x.s - y.s || y.e - x.e || x.bar.id.localeCompare(y.bar.id)),
    [events, isPicker]
  );

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
  const yearOptions = Array.from({ length: 7 }, (_, i) => now.getFullYear() - 3 + i);

  return (
    <View
      className="rounded-lg border bg-cd-card px-3 pb-3 pt-4"
      style={[{ borderColor: c.cardBorder }, dark ? SHADOW_CARD.dark : SHADOW_CARD.light]}>
      {/* 툴바 — 연·월 + 오늘 / 이전·다음 */}
      <View className="flex-row items-center justify-between px-1">
        <View className="flex-row items-center gap-2">
          <Pressable onPress={() => setPick('year')} className="flex-row items-center gap-1 active:opacity-60">
            <Text className="text-[16px] font-semibold text-cd-text">
              {year}년 {month0 + 1}월
            </Text>
            <Ionicons name="chevron-down" size={14} color={c.muted} />
          </Pressable>
          <Pressable
            onPress={() => onMonthChange(now.getFullYear(), now.getMonth())}
            className="h-8 justify-center rounded-lg border border-cd-border px-3 active:opacity-60">
            <Text className="text-[12px] font-medium" style={{ color: c.text }}>
              오늘
            </Text>
          </Pressable>
        </View>
        <View className="flex-row gap-1.5">
          <NavButton icon="chevron-back" onPress={() => moveMonth(-1)} />
          <NavButton icon="chevron-forward" onPress={() => moveMonth(1)} />
        </View>
      </View>

      {/* 요일 */}
      <View className="mt-3 flex-row">
        {WEEKDAYS.map((w, i) => (
          <Text
            key={w}
            className="flex-1 py-1 text-center text-[11px] font-medium"
            style={{ color: i === 0 ? CAL_MUTED.sun : i === 6 ? CAL_MUTED.sat : CAL_MUTED.weekdayLabel }}>
            {w}
          </Text>
        ))}
      </View>

      {/* 6주 격자 — 격자선 없이 여백으로 나눈다 */}
      {weeks.map((week, wi) => {
        const weekStart = dayNum(ymdOf(week[0]));
        const weekEnd = weekStart + 6;
        const isos = week.map((d) => ymdOf(d));
        // 휴일 열(토·일·공휴일) — breakOnHoliday 바를 끊는 기준.
        const offCol = isos.map((iso, col) => col === 0 || col === 6 || holidays.has(iso));
        // 휴무일명을 보일 셀이 이 주에 있으면 바를 한 줄 내린다(날짜 숫자 아래 붉은 명칭과 겹치지 않게).
        const holidayRow = !isPicker && week.some((d, col) => d.getMonth() === month0 && holidays.has(isos[col])) ? HOLIDAY_ROW_H : 0;

        // 주 단위 세그먼트 — 주 범위로 자르고, breakOnHoliday 면 휴일에서 끊는다.
        const segs: Seg[] = [];
        for (const it of spans) {
          if (it.e < weekStart || it.s > weekEnd) continue;
          const a = Math.max(it.s, weekStart) - weekStart;
          const b = Math.min(it.e, weekEnd) - weekStart;
          if (!it.bar.breakOnHoliday) {
            segs.push({ bar: it.bar, colStart: a, colEnd: b, lane: -1 });
            continue;
          }
          let runStart = -1;
          let pushed = 0;
          for (let col = a; col <= b + 1; col += 1) {
            const off = col > b || offCol[col];
            if (!off && runStart < 0) runStart = col;
            if (off && runStart >= 0) {
              segs.push({ bar: it.bar, colStart: runStart, colEnd: col - 1, lane: -1 });
              pushed += 1;
              runStart = -1;
            }
          }
          // 걸친 날이 전부 휴일이면 끊을 곳이 없다 — 숨기지 않고 원래 범위대로 그린다.
          if (!pushed) segs.push({ bar: it.bar, colStart: a, colEnd: b, lane: -1 });
        }
        // 레인 배정(주 단위, 최대 3) — 시작 열 순·긴 것 먼저. 초과는 -1 → 셀 하단 "+N".
        segs.sort((x, y) => x.colStart - y.colStart || y.colEnd - x.colEnd || x.bar.id.localeCompare(y.bar.id));
        const lanes: { s: number; e: number }[][] = Array.from({ length: MAX_LANES }, () => []);
        const overflow = new Array<number>(7).fill(0);
        let laneCount = 0;
        for (const sg of segs) {
          for (let l = 0; l < MAX_LANES; l += 1) {
            if (lanes[l].every((iv) => sg.colEnd < iv.s || sg.colStart > iv.e)) {
              lanes[l].push({ s: sg.colStart, e: sg.colEnd });
              sg.lane = l;
              laneCount = Math.max(laneCount, l + 1);
              break;
            }
          }
          if (sg.lane < 0) for (let col = sg.colStart; col <= sg.colEnd; col += 1) overflow[col] += 1;
        }
        const hasOverflow = overflow.some((n) => n > 0);
        const contentH = DATE_ROW_H + holidayRow + laneCount * LANE_H + (hasOverflow ? OVERFLOW_ROW_H : 0) + 4;
        const cellH = isPicker ? CELL_H_PICKER : Math.max(wi === 5 ? CELL_MIN_H_LAST : CELL_MIN_H, contentH);
        const barTop = DATE_ROW_H + holidayRow;

        return (
          <View key={wi} className="flex-row" style={{ height: cellH, marginTop: 2 }}>
            {week.map((day, di) => {
              const iso = isos[di];
              const dn = weekStart + di;
              const inMonth = day.getMonth() === month0;
              const dow = day.getDay();
              const isToday = iso === todayIso;
              const inRange = selStart != null && selEnd != null && dn >= selStart && dn <= selEnd;
              const isEdge = dn === selStart || dn === selEnd;
              const holiday = holidays.get(iso) ?? null;
              // 휴무일명은 당월 셀에만(웹과 동일 표기). picker 는 붉은 숫자만.
              const showHolidayName = !!holiday && inMonth && !isPicker;
              const red = dow === 0 || !!holiday;
              const numColor = !inMonth
                ? red
                  ? outsideSun
                  : outside
                : red
                  ? CAL_MUTED.sun
                  : dow === 6
                    ? CAL_MUTED.sat
                    : dayInk;

              return (
                <Pressable
                  key={di}
                  onPress={onDayPress ? () => onDayPress(iso) : undefined}
                  disabled={!onDayPress}
                  className="flex-1 items-center px-[2px]"
                  style={{ height: cellH }}>
                  {/* 날짜 숫자 줄(28) — 선택 범위가 우선, 그다음 오늘(26px 원). 선택 모드에서도 오늘을 보여준다. */}
                  <View className="items-center justify-center" style={{ height: DATE_ROW_H }}>
                    {isPicker && inRange ? (
                      <View
                        className="h-[26px] w-[26px] items-center justify-center rounded-full"
                        style={{ backgroundColor: isEdge ? c.primaryFill : c.primarySoft }}>
                        <Text className="text-[12px] font-semibold" style={{ color: isEdge ? '#ffffff' : c.primaryStrong }}>
                          {day.getDate()}
                        </Text>
                      </View>
                    ) : isToday ? (
                      <View
                        className="h-[26px] w-[26px] items-center justify-center rounded-full"
                        style={{ backgroundColor: isPicker ? c.surface : c.primaryFill }}>
                        <Text className="text-[12px] font-semibold" style={{ color: isPicker ? c.primary : '#ffffff' }}>
                          {day.getDate()}
                        </Text>
                      </View>
                    ) : (
                      <Text className="text-[12px] font-medium" style={{ color: numColor }}>
                        {day.getDate()}
                      </Text>
                    )}
                  </View>

                  {/* 휴무일명(당월) — 웹 캘린더의 붉은 명칭 표기와 동일. 셀 안 글자만 10 허용. */}
                  {showHolidayName ? (
                    <Text
                      numberOfLines={1}
                      className="w-full text-center text-[10px] font-medium"
                      style={{ color: CAL_MUTED.sun, height: HOLIDAY_ROW_H, lineHeight: HOLIDAY_ROW_H }}>
                      {holiday}
                    </Text>
                  ) : null}

                  {/* 레인 초과 "+N" — 바 아래 바닥에 붙인다. */}
                  {overflow[di] > 0 ? (
                    <Text className="mt-auto text-[10px] font-medium" style={{ color: c.muted, lineHeight: OVERFLOW_ROW_H }}>
                      +{overflow[di]}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}

            {/* 연속 일정 바 — 주 안에서 걸치는 열을 하나로 잇는다. 끊긴 조각마다 제목을 반복한다. */}
            {segs
              .filter((sg) => sg.lane >= 0)
              .map((sg) => (
                <View
                  key={`${sg.bar.id}:${sg.colStart}`}
                  pointerEvents="box-none"
                  style={{
                    position: 'absolute',
                    left: `${(sg.colStart / 7) * 100}%`,
                    width: `${((sg.colEnd - sg.colStart + 1) / 7) * 100}%`,
                    top: barTop + sg.lane * LANE_H,
                    height: BAR_H,
                    paddingHorizontal: 1,
                  }}>
                  <Pressable
                    onPress={onEventPress ? () => onEventPress(sg.bar) : undefined}
                    disabled={!onEventPress}
                    className="flex-1 justify-center rounded-sm px-1 active:opacity-70"
                    style={{ backgroundColor: sg.bar.color }}>
                    <Text numberOfLines={1} className="text-[10px] font-medium" style={{ color: sg.bar.ink ?? TAG_INK }}>
                      {sg.bar.title}
                    </Text>
                  </Pressable>
                </View>
              ))}
          </View>
        );
      })}

      {/* 연·월 선택 시트 */}
      <Sheet visible={pick === 'year'} onClose={() => setPick(null)} title="연도 선택">
        <View className="gap-1 pb-2">
          {yearOptions.map((y) => (
            <Pressable
              key={y}
              onPress={() => {
                onMonthChange(y, month0);
                setPick('month');
              }}
              className={`rounded-lg px-4 py-3 active:opacity-70 ${y === year ? 'bg-cd-primary-soft' : ''}`}>
              <Text className={`text-[15px] ${y === year ? 'font-semibold text-cd-primary-strong' : 'text-cd-text'}`}>
                {y}년
              </Text>
            </Pressable>
          ))}
        </View>
      </Sheet>
      <Sheet visible={pick === 'month'} onClose={() => setPick(null)} title="월 선택">
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
                style={{ width: '31%', backgroundColor: sel ? c.primaryFill : c.surface }}
                className="items-center rounded-lg py-3 active:opacity-70">
                <Text className={`text-[14px] ${sel ? 'font-semibold' : 'font-medium'}`} style={{ color: sel ? '#ffffff' : c.muted }}>
                  {m}월
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </View>
  );
}

/** 이전·다음 달 — 32×32, 반경 10, surface-sunken 바탕 + ink-muted 아이콘. */
function NavButton({ icon, onPress }: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      className="h-8 w-8 items-center justify-center rounded-lg active:opacity-60"
      style={{ backgroundColor: c.surface }}>
      <Ionicons name={icon} size={16} color={c.muted} />
    </Pressable>
  );
}
