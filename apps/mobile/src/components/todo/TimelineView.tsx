/**
 * 타임라인(§29-1 모바일, 2026-10-20 개편) — 읽기 전용(결정 J).
 *   위: 가로 스크롤 시간축 그래프(막대에는 번호만 — 폭이 좁아 이름은 아래 목록으로), 주말 열은 요일 글자 대신 색(일=옅은 붉은색·토=옅은 파란색).
 *   아래: 그래프와 충분히 띄운 일정 목록 — 번호·이름·기간·중요도·지연 여부. 복수 일자 일정(할 날~종료일)은 웹과 같이 하위 작업 보조 행을
 *   그래프·목록 모두에 펼친다(상태 색·진행율, 날짜 없는 하위는 상위 기간 위 점선 '날짜 미정'). 막대·행 탭 = 상세로.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/theme/useTheme';
import { apiJson } from '@/lib/api';
import { TODO_STATUS_LABELS, type TodoItem, type TodoItemDetail, type TodoStatus } from '@/lib/todo-types';
// ⚠ 모바일 diffDays(a, b) = b − a (웹 todo-utils 와 반대) — 창 기준 위치는 diffDays(windowStart, 날짜)
import { addDays, diffDays, fmtMd, isOverdue, labelColors, withAlpha } from '@/lib/todo-utils';
import { PriorityLabel, StatusDot } from './parts';

const DAY_W = 26;
const ROW_H = 30;
const SUB_H = 24;
const DAYS = 56; // 8주 창(오늘 기준 -1주 ~ +7주)

const mondayOf = (ymd: string): string => {
  const d = new Date(`${ymd}T12:00:00Z`);
  return addDays(ymd, -((d.getUTCDay() + 6) % 7));
};
const clamp = (n: number) => Math.max(0, Math.min(DAYS - 1, n));
const isMultiDay = (it: TodoItem) => !!it.doDate && !!it.endDate && it.endDate > it.doDate && it.subtaskTotal > 0;

interface Row {
  key: string;
  item: TodoItem;
  depth: 0 | 1;
  no: string;
  start: string;
  end: string;
  due: boolean;
  undated?: boolean;
  milestone?: boolean;
}

/** 하위 상태별 막대 색(웹 todo-tl-* 와 같은 계열) */
function statusTone(st: TodoStatus, c: ReturnType<typeof useTheme>['c'], dark: boolean): { bg: string; border: string; dashed?: boolean } {
  switch (st) {
    case 'doing':
      return { bg: withAlpha('#b9cfee', dark ? 0.3 : 0.55), border: '#8fb0e0' };
    case 'review':
      return { bg: withAlpha('#c9b8ec', dark ? 0.3 : 0.45), border: '#b39ce3' };
    case 'done':
      return { bg: withAlpha('#9fd9ba', dark ? 0.28 : 0.45), border: '#7cc9a0' };
    case 'hold':
      return { bg: 'transparent', border: '#b8bec9', dashed: true };
    default:
      return { bg: withAlpha(c.muted, dark ? 0.18 : 0.12), border: c.border };
  }
}

export function TimelineView({ items, today, onOpen }: { items: TodoItem[]; today: string; onOpen: (item: TodoItem) => void }) {
  const { c, dark } = useTheme();
  const over = labelColors('over', dark);
  const windowStart = useMemo(() => addDays(mondayOf(today), -7), [today]);
  const scrollRef = useRef<ScrollView>(null);
  const [subs, setSubs] = useState<Record<string, TodoItem[]>>({});
  const requested = useRef(new Map<string, string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // 복수 일자 일정의 하위 작업 — 상세 API(동시 3건). 하위 수·완료 수·수정 시각이 바뀌면 다시.
  useEffect(() => {
    const need = items.filter((it) => {
      if (it.parentItemId || !isMultiDay(it)) return false;
      const sig = `${it.subtaskTotal}:${it.subtaskDone}:${it.updatedAt}`;
      if (requested.current.get(it.itemId) === sig) return false;
      requested.current.set(it.itemId, sig);
      return true;
    });
    if (!need.length) return;
    const queue = [...need];
    const worker = async () => {
      while (queue.length) {
        const it = queue.shift()!;
        try {
          const d = await apiJson<{ item: TodoItemDetail }>(`/api/todo/items/${it.itemId}`);
          if (mounted.current) setSubs((m) => ({ ...m, [it.itemId]: d.item.subtasks }));
        } catch {
          requested.current.delete(it.itemId);
        }
      }
    };
    void Promise.all([worker(), worker(), worker()]);
  }, [items]);

  const { rows, undatedCount } = useMemo(() => {
    const tops: Row[] = [];
    let undatedCount = 0;
    for (const it of items) {
      if (it.parentItemId) continue;
      if (it.doDate) tops.push({ key: it.itemId, item: it, depth: 0, no: '', start: it.doDate, end: it.endDate && it.endDate >= it.doDate ? it.endDate : it.doDate, due: false });
      else if (it.dueDate) tops.push({ key: it.itemId, item: it, depth: 0, no: '', start: it.dueDate, end: it.dueDate, due: true });
      else undatedCount += 1;
    }
    tops.sort((a, b) => a.start.localeCompare(b.start) || a.item.title.localeCompare(b.item.title));
    const visibleTops = tops.filter((r) => diffDays(windowStart, r.end) >= 0 && diffDays(windowStart, r.start) < DAYS);
    const rows: Row[] = [];
    visibleTops.forEach((r, i) => {
      r.no = String(i + 1);
      rows.push(r);
      if (!isMultiDay(r.item)) return;
      (subs[r.item.itemId] ?? []).forEach((st, j) => {
        const no = `${i + 1}-${j + 1}`;
        if (st.milestoneKind && (st.actualDate ?? st.doDate ?? st.dueDate)) {
          const d = (st.actualDate ?? st.doDate ?? st.dueDate)!;
          rows.push({ key: st.itemId, item: st, depth: 1, no, start: d, end: d, due: false, milestone: true });
        } else if (st.doDate) rows.push({ key: st.itemId, item: st, depth: 1, no, start: st.doDate, end: st.endDate && st.endDate >= st.doDate ? st.endDate : st.doDate, due: false });
        else if (st.dueDate) rows.push({ key: st.itemId, item: st, depth: 1, no, start: st.dueDate, end: st.dueDate, due: true });
        else rows.push({ key: st.itemId, item: st, depth: 1, no, start: r.start, end: r.end, due: false, undated: true });
      });
    });
    return { rows, undatedCount };
  }, [items, subs, windowStart]);

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollTo({ x: Math.max(0, diffDays(windowStart, today) * DAY_W - 60), animated: false }), 50);
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
  const sunBg = dark ? withAlpha('#f3b8b8', 0.14) : '#fdeeee';
  const satBg = dark ? withAlpha('#b9cfee', 0.14) : '#ebf2fd';
  const weekendBg = (d: string) => {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    return wd === 0 ? sunBg : wd === 6 ? satBg : undefined;
  };
  const trackW = DAYS * DAY_W;
  const todayX = diffDays(windowStart, today) * DAY_W + DAY_W / 2;
  const rowTop: number[] = [];
  let acc = 0;
  for (const r of rows) {
    rowTop.push(acc);
    acc += r.depth === 0 ? ROW_H : SUB_H;
  }
  const graphH = Math.max(acc, ROW_H);
  const lateOf = (r: Row) => !r.undated && r.depth === 0 && isOverdue(r.item, today);

  return (
    <View className="flex-1">
      {/* ── 그래프 ── */}
      <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator contentContainerStyle={{ width: trackW }}>
        <View style={{ width: trackW }}>
          <View style={{ height: 20, flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: c.border }}>
            {months.map((m) => (
              <View key={m.key} style={{ width: m.len * DAY_W, borderLeftWidth: 1, borderLeftColor: c.border, paddingLeft: 6, justifyContent: 'center' }}>
                <Text className="text-[11px] font-semibold text-cd-text" numberOfLines={1}>
                  {Number(m.key.slice(5, 7))}월
                </Text>
              </View>
            ))}
          </View>
          <View style={{ height: 24, flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: c.border }}>
            {days.map((d) => {
              const isToday = d === today;
              const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
              const tone = wd === 0 ? over.fg : wd === 6 ? c.primary : c.faint;
              return (
                <View key={d} style={{ width: DAY_W, alignItems: 'center', justifyContent: 'center', backgroundColor: weekendBg(d) }}>
                  <Text style={{ fontSize: 10.5, color: isToday ? c.primary : tone, fontWeight: isToday ? '700' : '400' }}>{Number(d.slice(8, 10))}</Text>
                </View>
              );
            })}
          </View>
          <View style={{ height: graphH, position: 'relative' }}>
            {days.map((d, i) => {
              const bg = weekendBg(d);
              return bg ? <View key={d} pointerEvents="none" style={{ position: 'absolute', left: i * DAY_W, top: 0, bottom: 0, width: DAY_W, backgroundColor: bg }} /> : null;
            })}
            {rows.map((r, i) =>
              r.depth === 1 ? <View key={`sb${r.key}`} pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: rowTop[i], height: SUB_H, backgroundColor: withAlpha(c.muted, 0.05) }} /> : null
            )}
            {todayX >= 0 && todayX <= trackW ? <View pointerEvents="none" style={{ position: 'absolute', left: todayX, top: 0, bottom: 0, width: 2, backgroundColor: c.primary, opacity: 0.7 }} /> : null}
            {rows.length === 0 ? (
              <Text className="px-3 py-3 text-[12.5px] text-cd-faint">이 기간에 날짜가 있는 할 일이 없습니다.</Text>
            ) : (
              rows.map((r, i) => {
                const x0 = clamp(diffDays(windowStart, r.start));
                const x1 = clamp(diffDays(windowStart, r.end));
                const h = r.depth === 0 ? ROW_H : SUB_H;
                if (r.milestone) {
                  return (
                    <Pressable key={r.key} onPress={() => onOpen(r.item)} style={{ position: 'absolute', left: x0 * DAY_W + DAY_W / 2 - 8, top: rowTop[i] + h / 2 - 9, width: 16, height: 18, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 14, color: r.item.status === 'done' ? c.faint : r.item.boardColor || c.primary }}>◆</Text>
                    </Pressable>
                  );
                }
                const done = r.item.status === 'done';
                const late = lateOf(r);
                const tint = r.item.boardColor || c.primary;
                const tone = r.depth === 1 ? statusTone(r.item.status, c, dark) : null;
                return (
                  <Pressable
                    key={r.key}
                    onPress={() => onOpen(r.item)}
                    accessibilityLabel={`${r.no}. ${r.item.title}`}
                    style={{
                      position: 'absolute',
                      left: x0 * DAY_W + 1,
                      width: Math.max(DAY_W - 2, (x1 - x0 + 1) * DAY_W - 2),
                      top: rowTop[i] + (r.depth === 0 ? 5 : 4),
                      height: h - (r.depth === 0 ? 10 : 8),
                      borderRadius: 5,
                      paddingHorizontal: 5,
                      justifyContent: 'center',
                      overflow: 'hidden',
                      // 개인 보드처럼 옅은 회색 보드도 막대가 보이도록 메인 막대는 진하게 + 회색 계열 테두리
                      backgroundColor: r.undated ? 'transparent' : tone ? tone.bg : withAlpha(tint, done ? 0.3 : 0.75),
                      borderWidth: 1,
                      borderStyle: r.undated || r.due || tone?.dashed ? 'dashed' : 'solid',
                      borderColor: late ? over.fg : tone ? (r.undated ? c.muted : tone.border) : withAlpha(c.muted, 0.55),
                      opacity: done ? 0.6 : 1,
                    }}>
                    {r.depth === 1 && !r.undated && r.item.progressPct != null && !done ? (
                      <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${r.item.progressPct}%`, backgroundColor: withAlpha('#8fb0e0', 0.45) }} />
                    ) : null}
                    <Text numberOfLines={1} style={{ fontSize: r.depth === 0 ? 11 : 10, fontWeight: '700', color: c.text }}>
                      {r.no}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </View>
        </View>
      </ScrollView>

      {/* ── 일정 목록(그래프 아래, 충분한 간격) ── */}
      <View style={{ height: 20 }} />
      <View className="border-t border-cd-border">
        <View className="flex-row items-center justify-between px-4 pb-1 pt-3">
          <Text className="text-[12px] font-semibold text-cd-muted">
            일정 {rows.filter((r) => r.depth === 0).length}건 · {fmtMd(windowStart)} ~ {fmtMd(addDays(windowStart, DAYS - 1))}
          </Text>
          {undatedCount ? <Text className="text-[11.5px] text-cd-faint">날짜 없음 {undatedCount}건</Text> : null}
        </View>
        {rows.map((r) => {
          const late = lateOf(r);
          const period = r.undated ? '날짜 미정' : r.milestone ? `◆ ${r.item.actualDate ? `실제 ${fmtMd(r.start)}` : `예정 ${fmtMd(r.start)}`}` : r.due ? `마감 ${fmtMd(r.start)}` : r.start === r.end ? fmtMd(r.start) : `${fmtMd(r.start)} ~ ${fmtMd(r.end)} · ${diffDays(r.start, r.end) + 1}일`;
          if (r.depth === 1) {
            const tone = statusTone(r.item.status, c, dark);
            return (
              <Pressable key={`l${r.key}`} onPress={() => onOpen(r.item)} className="flex-row items-center gap-2 py-1.5 pl-10 pr-4 active:bg-cd-surface">
                <Text className="w-8 text-[11px] text-cd-faint">{r.no}</Text>
                <Text numberOfLines={1} className="flex-1 text-[12.5px] text-cd-text">
                  {r.item.title}
                </Text>
                <Text className="text-[11px] text-cd-faint">{period}</Text>
                <View style={{ backgroundColor: tone.bg, borderColor: tone.border, borderWidth: 1, borderStyle: tone.dashed ? 'dashed' : 'solid', borderRadius: 5, paddingHorizontal: 5 }}>
                  <Text className="text-[10.5px] font-semibold text-cd-text">
                    {TODO_STATUS_LABELS[r.item.status]}
                    {r.item.status !== 'done' && r.item.progressPct != null ? ` ${r.item.progressPct}%` : ''}
                  </Text>
                </View>
              </Pressable>
            );
          }
          return (
            <Pressable key={`l${r.key}`} onPress={() => onOpen(r.item)} className="gap-0.5 border-b border-cd-grid-line px-4 py-2.5 active:bg-cd-surface">
              <View className="flex-row items-center gap-2">
                <View style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: withAlpha(r.item.boardColor || c.primary, 0.35), alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
                  <Text className="text-[11px] font-bold text-cd-text">{r.no}</Text>
                </View>
                <StatusDot status={r.item.status} />
                <Text numberOfLines={1} className={`flex-1 text-[14px] font-semibold ${r.item.status === 'done' ? 'text-cd-faint line-through' : 'text-cd-text'}`}>
                  {r.item.title}
                </Text>
                <PriorityLabel priority={r.item.priority} />
                {late ? (
                  <Text className="rounded-md px-1.5 text-[11px] font-semibold" style={{ color: over.fg, backgroundColor: over.bg }}>
                    지연
                  </Text>
                ) : null}
              </View>
              <View className="flex-row items-center gap-1.5 pl-7">
                <Ionicons name={r.due ? 'flag-outline' : 'calendar-outline'} size={12} color={c.faint} />
                <Text className="text-[12px] text-cd-muted">{period}</Text>
                {r.item.subtaskTotal > 0 ? (
                  <Text className="text-[11.5px] text-cd-faint">
                    · 하위 {r.item.subtaskDone}/{r.item.subtaskTotal}
                  </Text>
                ) : null}
                {r.item.assigneeName ? <Text className="ml-auto text-[11.5px] text-cd-faint">{r.item.assigneeName}</Text> : null}
              </View>
            </Pressable>
          );
        })}
        <Text className="px-4 py-3 text-[11px] text-cd-faint">막대·행을 누르면 상세. 여러 날에 걸친 일정은 하위 작업을 함께 보여 줍니다.</Text>
      </View>
    </View>
  );
}
