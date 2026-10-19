/**
 * 타임라인(§29-1, 2026-10-19) — 모바일 1차는 읽기 전용(결정 J). 상위 할 일의 기간 막대·오늘선을 가로 스크롤 시간축에 그린다.
 * 하위 마일스톤·의존 화살표·드래그는 웹에서(모바일 2차). 막대 탭 = 상세로.
 */
import { useEffect, useMemo, useRef } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { useTheme } from '@/theme/useTheme';
import type { TodoItem } from '@/lib/todo-types';
import { addDays, diffDays, fmtMd, labelColors, withAlpha } from '@/lib/todo-utils';

const DAY_W = 26;
const ROW_H = 36;
const DAYS = 56; // 8주 창(오늘 기준 -1주 ~ +7주)
const WD = ['일', '월', '화', '수', '목', '금', '토'];

const mondayOf = (ymd: string): string => {
  const d = new Date(`${ymd}T12:00:00Z`);
  return addDays(ymd, -((d.getUTCDay() + 6) % 7));
};
const clamp = (n: number) => Math.max(0, Math.min(DAYS - 1, n));

interface Row {
  item: TodoItem;
  start: string;
  end: string;
  due: boolean;
}

export function TimelineView({ items, today, onOpen }: { items: TodoItem[]; today: string; onOpen: (item: TodoItem) => void }) {
  const { c, dark } = useTheme();
  const over = labelColors('over', dark);
  const windowStart = useMemo(() => addDays(mondayOf(today), -7), [today]);
  const scrollRef = useRef<ScrollView>(null);

  const { rows, undated } = useMemo(() => {
    const rows: Row[] = [];
    const undated: TodoItem[] = [];
    for (const it of items) {
      if (it.parentItemId) continue;
      if (it.doDate) rows.push({ item: it, start: it.doDate, end: it.endDate && it.endDate >= it.doDate ? it.endDate : it.doDate, due: false });
      else if (it.dueDate) rows.push({ item: it, start: it.dueDate, end: it.dueDate, due: true });
      else undated.push(it);
    }
    rows.sort((a, b) => a.start.localeCompare(b.start) || a.item.title.localeCompare(b.item.title));
    return { rows: rows.filter((r) => diffDays(r.end, windowStart) >= 0 && diffDays(r.start, windowStart) < DAYS), undated };
  }, [items, windowStart]);

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollTo({ x: Math.max(0, diffDays(today, windowStart) * DAY_W - 60), animated: false }), 50);
    return () => clearTimeout(t);
  }, [today, windowStart]);

  const days = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDays(windowStart, i)), [windowStart]);
  const months = useMemo(() => {
    const out: { key: string; from: number; len: number }[] = [];
    days.forEach((d, i) => {
      const ym = d.slice(0, 7);
      const last = out[out.length - 1];
      if (last && last.key === ym) last.len += 1;
      else out.push({ key: ym, from: i, len: 1 });
    });
    return out;
  }, [days]);
  const trackW = DAYS * DAY_W;
  const todayX = diffDays(today, windowStart) * DAY_W + DAY_W / 2;

  return (
    <View className="flex-1">
      <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator contentContainerStyle={{ width: trackW }}>
        <View style={{ width: trackW }}>
          {/* 월 */}
          <View style={{ height: 20, flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: c.border }}>
            {months.map((m) => (
              <View key={m.key} style={{ width: m.len * DAY_W, borderLeftWidth: 1, borderLeftColor: c.border, paddingLeft: 6, justifyContent: 'center' }}>
                <Text className="text-[11px] font-semibold text-cd-text" numberOfLines={1}>
                  {Number(m.key.slice(5, 7))}월
                </Text>
              </View>
            ))}
          </View>
          {/* 일 */}
          <View style={{ height: 30, flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: c.border }}>
            {days.map((d) => {
              const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
              const isToday = d === today;
              return (
                <View key={d} style={{ width: DAY_W, alignItems: 'center', justifyContent: 'center', backgroundColor: wd === 0 || wd === 6 ? withAlpha(c.muted, 0.08) : undefined }}>
                  <Text style={{ fontSize: 10, color: isToday ? c.primary : c.faint, fontWeight: isToday ? '700' : '400' }}>{Number(d.slice(8, 10))}</Text>
                  <Text style={{ fontSize: 9, color: isToday ? c.primary : c.faint }}>{WD[wd]}</Text>
                </View>
              );
            })}
          </View>
          {/* 행 */}
          <View style={{ height: Math.max(rows.length, 1) * ROW_H, position: 'relative' }}>
            {/* 주말 음영 + 행 구분선 */}
            {days.map((d, i) => {
              const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
              return wd === 0 || wd === 6 ? <View key={d} pointerEvents="none" style={{ position: 'absolute', left: i * DAY_W, top: 0, bottom: 0, width: DAY_W, backgroundColor: withAlpha(c.muted, 0.06) }} /> : null;
            })}
            {rows.map((_, i) => (
              <View key={i} pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: (i + 1) * ROW_H - 1, height: 1, backgroundColor: withAlpha(c.border, 0.7) }} />
            ))}
            {todayX >= 0 && todayX <= trackW ? <View pointerEvents="none" style={{ position: 'absolute', left: todayX, top: 0, bottom: 0, width: 2, backgroundColor: c.primary, opacity: 0.7 }} /> : null}
            {rows.length === 0 ? (
              <Text className="px-3 py-4 text-[12.5px] text-cd-faint">이 기간에 날짜가 있는 할 일이 없습니다.</Text>
            ) : (
              rows.map((r, i) => {
                const x0 = clamp(diffDays(r.start, windowStart));
                const x1 = clamp(diffDays(r.end, windowStart));
                const left = x0 * DAY_W + 1;
                const width = Math.max(DAY_W - 2, (x1 - x0 + 1) * DAY_W - 2);
                const done = r.item.status === 'done';
                const late = !done && r.end < today;
                const tint = r.item.boardColor || c.primary;
                return (
                  <Pressable
                    key={r.item.itemId}
                    onPress={() => onOpen(r.item)}
                    accessibilityLabel={`${r.item.title} ${r.due ? `마감 ${fmtMd(r.start)}` : `${fmtMd(r.start)}${r.end !== r.start ? ` ~ ${fmtMd(r.end)}` : ''}`}`}
                    style={{
                      position: 'absolute',
                      left,
                      width,
                      top: i * ROW_H + 6,
                      height: ROW_H - 12,
                      borderRadius: 6,
                      paddingHorizontal: 8,
                      justifyContent: 'center',
                      backgroundColor: withAlpha(tint, done ? 0.18 : 0.38),
                      borderWidth: 1,
                      borderStyle: r.due ? 'dashed' : 'solid',
                      borderColor: late ? over.fg : withAlpha(tint, 0.8),
                      opacity: done ? 0.6 : 1,
                    }}>
                    <Text numberOfLines={1} style={{ fontSize: 11.5, color: c.text, textDecorationLine: done ? 'line-through' : 'none' }}>
                      {r.item.title}
                      {r.item.openDeps > 0 && !done ? ` ⛓${r.item.openDeps}` : ''}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </View>
        </View>
      </ScrollView>
      <View className="flex-row items-center justify-between px-3 py-2">
        <Text className="text-[11px] text-cd-faint">
          {fmtMd(windowStart)} ~ {fmtMd(addDays(windowStart, DAYS - 1))} · 막대를 누르면 상세
        </Text>
        {undated.length ? <Text className="text-[11px] text-cd-faint">날짜 없음 {undated.length}건</Text> : null}
      </View>
    </View>
  );
}
