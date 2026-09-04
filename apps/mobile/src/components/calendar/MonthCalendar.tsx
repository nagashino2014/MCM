import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Sheet } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

/**
 * 공용 월 캘린더 — 일정·영업 스케줄·기안 날짜 입력이 함께 쓴다.
 *
 * variant
 *  - `pills`(기본, 핸드오프 3a): 격자선 없이 날짜 숫자를 가운데 두고 **셀 안에 이벤트 필**을 쌓는다.
 *    멀티데이 일정은 걸치는 날마다 필로 반복 표시한다(모바일 폭에서 가로 바는 글자가 안 들어간다).
 *  - `bars`: 웹 ScheduleCalendar 처럼 멀티데이 가로 바 + 월 전역 레인 배정.
 *  - `picker`: 날짜·기간 선택 전용(이벤트 없음).
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
  /** 필·바 배경색. */
  color: string;
  /** 글자색. */
  ink?: string;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const LANE_H = 16;
const MAX_LANES = 3;
const DATE_ROW_H = 22;
/** 핸드오프 3a — 셀 54px(마지막 주 44px), 셀당 필 최대 2개. */
const CELL_H = 54;
const CELL_H_LAST = 44;
const MAX_PILLS = 2;
const SUN = '#d98d84';
const SAT = '#8a9bd6';
const OUTSIDE = '#ced3e2';
const OUTSIDE_SUN = '#e8c2be';
const DAY_INK = '#565e82';
const LABEL = '#a6acc4';

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
  variant?: 'pills' | 'bars' | 'picker';
  /** 선택된 날짜(YYYY-MM-DD). 범위 선택이면 시작일. */
  selected?: string | null;
  /** 범위 선택의 종료일. */
  rangeEnd?: string | null;
}) {
  const { c, dark } = useTheme();
  // 날짜 숫자 색 — 상수(라이트 전용 hex)를 다크에서 그대로 쓰면 당월이 어둡고 전·익월이 밝아
  // 뒤집혀 보인다(09-04 실기기 실측). 다크는 테마 토큰으로: 당월=본문색, 전·익월=흐린색.
  const dayInk = dark ? c.text : DAY_INK;
  const outside = dark ? c.faint : OUTSIDE;
  const outsideSun = dark ? `${SUN}66` : OUTSIDE_SUN;
  const [pick, setPick] = useState<null | 'year' | 'month'>(null);
  const now = useMemo(() => new Date(), []);
  const todayIso = ymdOf(now);
  const isPicker = variant === 'picker';

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

  // bars 모드 레인 배정(월 전역, 최대 3). 초과는 -1 → 셀 하단 "+N".
  const laneOf = useMemo(() => {
    const lanes: Array<Array<{ s: number; e: number }>> = Array.from({ length: MAX_LANES }, () => []);
    const map = new Map<string, number>();
    if (variant !== 'bars') return map;
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
  }, [spans, variant]);

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
    <View className="rounded-card border border-cd-border bg-cd-card px-3 pb-3 pt-3.5">
      {/* 툴바 — 연·월 + 오늘 / 이전·다음 */}
      <View className="flex-row items-center justify-between px-1">
        <View className="flex-row items-baseline gap-2">
          <Pressable onPress={() => setPick('year')} className="flex-row items-baseline gap-1.5 active:opacity-60">
            <Text className="text-[15px] font-extrabold text-cd-text">
              {year}년 {month0 + 1}월
            </Text>
            <Ionicons name="chevron-down" size={12} color="#9aa0b8" />
          </Pressable>
          <Pressable
            onPress={() => onMonthChange(now.getFullYear(), now.getMonth())}
            className="rounded-full border border-cd-border px-[11px] py-1 active:opacity-60">
            <Text className="text-[11px] font-semibold" style={{ color: dayInk }}>
              오늘
            </Text>
          </Pressable>
        </View>
        <View className="flex-row gap-1.5">
          <RoundNav icon="chevron-back" onPress={() => moveMonth(-1)} />
          <RoundNav icon="chevron-forward" onPress={() => moveMonth(1)} />
        </View>
      </View>

      {/* 요일 */}
      <View className="mt-3 flex-row">
        {WEEKDAYS.map((w, i) => (
          <Text
            key={w}
            className="flex-1 py-1 text-center text-[10.5px] font-bold"
            style={{ color: i === 0 ? SUN : i === 6 ? SAT : LABEL }}>
            {w}
          </Text>
        ))}
      </View>

      {/* 6주 격자 — 격자선 없이 여백으로 나눈다(핸드오프 3a) */}
      {weeks.map((week, wi) => {
        const weekStart = dayNum(ymdOf(week[0]));
        const weekEnd = weekStart + 6;
        const cellH = isPicker ? 44 : wi === 5 ? CELL_H_LAST : CELL_H;

        const segs =
          variant === 'bars'
            ? spans
                .filter((it) => (laneOf.get(it.bar.id) ?? -1) >= 0 && !(it.e < weekStart || it.s > weekEnd))
                .map((it) => ({
                  it,
                  colStart: Math.max(it.s, weekStart) - weekStart,
                  colEnd: Math.min(it.e, weekEnd) - weekStart,
                  lane: laneOf.get(it.bar.id) ?? 0,
                }))
            : [];
        const overflow = new Array(7).fill(0);
        if (variant === 'bars') {
          for (const it of spans) {
            if ((laneOf.get(it.bar.id) ?? -1) !== -1) continue;
            for (let col = 0; col < 7; col += 1) {
              const dn = weekStart + col;
              if (dn >= it.s && dn <= it.e) overflow[col] += 1;
            }
          }
        }

        return (
          <View key={wi} className="flex-row" style={{ minHeight: cellH, marginTop: 2 }}>
            {week.map((day, di) => {
              const iso = ymdOf(day);
              const dn = dayNum(iso);
              const inMonth = day.getMonth() === month0;
              const dow = day.getDay();
              const isToday = iso === todayIso;
              const inRange = selStart != null && selEnd != null && dn >= selStart && dn <= selEnd;
              const isEdge = dn === selStart || dn === selEnd;
              const dayPills = variant === 'pills' ? spans.filter((it) => dn >= it.s && dn <= it.e) : [];
              const numColor = !inMonth
                ? dow === 0
                  ? outsideSun
                  : outside
                : dow === 0
                  ? SUN
                  : dow === 6
                    ? SAT
                    : dayInk;

              return (
                <Pressable
                  key={di}
                  onPress={onDayPress ? () => onDayPress(iso) : undefined}
                  disabled={!onDayPress}
                  className="flex-1 items-center px-[2px]"
                  style={{ height: cellH, paddingTop: isToday || (isPicker && inRange) ? 3 : 5 }}>
                  {/* 날짜 숫자 — 선택 범위가 우선, 그다음 오늘(26px 원). 선택 모드에서도 오늘을 보여준다. */}
                  {isPicker && inRange ? (
                    <View
                      className="h-[26px] w-[26px] items-center justify-center rounded-full"
                      style={{ backgroundColor: isEdge ? c.primary : c.primarySoft }}>
                      <Text className="text-[12px] font-bold" style={{ color: isEdge ? '#FFFFFF' : c.primary }}>
                        {day.getDate()}
                      </Text>
                    </View>
                  ) : isToday ? (
                    <View
                      className="h-[26px] w-[26px] items-center justify-center rounded-full"
                      style={{ backgroundColor: isPicker ? c.surface : c.primary }}>
                      <Text
                        className="text-[12px] font-extrabold"
                        style={{ color: isPicker ? c.primary : '#FFFFFF' }}>
                        {day.getDate()}
                      </Text>
                    </View>
                  ) : (
                    <Text className="text-[12px] font-semibold" style={{ color: numColor }}>
                      {day.getDate()}
                    </Text>
                  )}

                  {/* 이벤트 필(pills 모드) */}
                  {dayPills.slice(0, MAX_PILLS).map((it, pi) => (
                    <Pressable
                      key={it.bar.id}
                      onPress={onEventPress ? () => onEventPress(it.bar) : undefined}
                      disabled={!onEventPress}
                      className="w-full rounded-[5px] px-[3px] py-[2px] active:opacity-70"
                      style={{ backgroundColor: it.bar.color, marginTop: pi === 0 ? 4 : 2 }}>
                      <Text numberOfLines={1} className="text-[8.5px] font-bold" style={{ color: it.bar.ink ?? '#1f2937' }}>
                        {it.bar.title}
                      </Text>
                    </Pressable>
                  ))}
                  {dayPills.length > MAX_PILLS ? (
                    <Text className="mt-[2px] text-[8.5px]" style={{ color: LABEL }}>
                      +{dayPills.length - MAX_PILLS}
                    </Text>
                  ) : null}

                  {overflow[di] > 0 ? (
                    <Text className="mt-auto text-[9px]" style={{ color: c.faint }}>
                      +{overflow[di]}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}

            {/* 멀티데이 가로 바(bars 모드) */}
            {segs.map(({ it, colStart, colEnd, lane }) => (
              <View
                key={it.bar.id}
                pointerEvents="box-none"
                style={{
                  position: 'absolute',
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
                  <Text numberOfLines={1} className="text-[10px] font-semibold" style={{ color: it.bar.ink ?? '#1f2937' }}>
                    {it.bar.title}
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
              className={`rounded-xl px-4 py-3 active:opacity-70 ${y === year ? 'bg-cd-primary-soft' : ''}`}>
              <Text className={`text-[15px] ${y === year ? 'font-extrabold text-cd-primary' : 'text-cd-text'}`}>
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
                style={{ width: '31%' }}
                className={`items-center rounded-xl py-3 active:opacity-70 ${sel ? 'bg-cd-primary' : 'bg-cd-surface'}`}>
                <Text className={`text-[14px] font-bold ${sel ? 'text-white' : 'text-cd-muted'}`}>{m}월</Text>
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </View>
  );
}

function RoundNav({ icon, onPress }: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      className="h-7 w-7 items-center justify-center rounded-full active:opacity-60"
      style={{ backgroundColor: '#f3f4fa' }}>
      <Ionicons name={icon} size={13} color={DAY_INK} />
    </Pressable>
  );
}
