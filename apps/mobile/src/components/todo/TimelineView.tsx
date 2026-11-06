/**
 * 타임라인(§29-1 모바일, 2026-10-20 개편) — 읽기 전용(결정 J).
 *   위: 가로 스크롤 시간축 그래프(막대에는 번호만 — 폭이 좁아 이름은 아래 목록으로), 주말 열은 요일 글자 대신 색(일=옅은 붉은색·토=옅은 파란색).
 *   아래: 그래프와 충분히 띄운 일정 목록 — 번호·이름·기간·중요도·지연 여부. 복수 일자 일정(할 날~종료일)은 웹과 같이 하위 작업 보조 행을
 *   그래프·목록 모두에 펼친다(상태 색·진행율, 날짜 없는 하위는 상위 기간 위 점선 '날짜 미정'). 막대·행 탭 = 상세로.
 *   2026-11-04(사용자 요청): 그래프는 **흰 카드** 안에, 목록은 일정마다 **흰 박스**(상위 + 그 하위 행 한 묶음)로 — 그라데이션 바탕 위에서 가독성.
 *   2026-11-06(사용자 요청, 웹과 맞춤): 종류가 있는 하위 작업도 기간(종료일 > 시작일)이 있으면 ◆ 대신 막대로, ◆ 는 하루짜리만.
 *   상위 막대 = 옅은 바탕 + 같은 색 진한 채움(하위 평균 진행), 막대 폭이 되면 오른쪽에 %(완료 ✓). 목록 상위 행에도 '진행 N%'.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/theme/useTheme';
import { SHADOW_CARD } from '@/theme/tokens';
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
        // 웹 rowOf 와 같은 규칙(302): 종류가 있어도 기간(종료일 > 시작일)이 있으면 막대. ◆ 는 하루짜리 종류 하위만.
        const period = !!st.doDate && !!st.endDate && st.endDate > st.doDate;
        if (st.milestoneKind && !period && (st.actualDate ?? st.doDate ?? st.dueDate)) {
          const d = (st.actualDate ?? st.doDate ?? st.dueDate)!;
          rows.push({ key: st.itemId, item: st, depth: 1, no, start: d, end: d, due: false, milestone: true });
        } else if (st.doDate) rows.push({ key: st.itemId, item: st, depth: 1, no, start: st.doDate, end: st.endDate && st.endDate >= st.doDate ? st.endDate : st.doDate, due: false });
        else if (st.dueDate) rows.push({ key: st.itemId, item: st, depth: 1, no, start: st.dueDate, end: st.dueDate, due: true });
        else rows.push({ key: st.itemId, item: st, depth: 1, no, start: r.start, end: r.end, due: false, undated: true });
      });
    });
    return { rows, undatedCount };
  }, [items, subs, windowStart]);

  // 상위별 하위 평균 진행율(완료 = 100) — 상위 막대 채움·%와 목록의 '진행 N%'
  const aggOf = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [pid, list] of Object.entries(subs)) {
      if (!list.length) continue;
      out[pid] = Math.round(list.reduce((a, x) => a + (x.status === 'done' ? 100 : (x.progressPct ?? 0)), 0) / list.length);
    }
    return out;
  }, [subs]);

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
  const boxStyle = [{ borderColor: c.cardBorder }, dark ? SHADOW_CARD.dark : SHADOW_CARD.light];

  // 목록 묶음 — 상위 행 + 그 뒤에 이어지는 하위 행을 한 박스에.
  const groups: Row[][] = [];
  for (const r of rows) {
    if (r.depth === 0 || !groups.length) groups.push([r]);
    else groups[groups.length - 1].push(r);
  }

  return (
    <View className="flex-1">
      {/* ── 그래프(흰 카드) ── */}
      <View style={boxStyle} className="mx-4 mt-3 overflow-hidden rounded-lg border bg-cd-card">
        <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator contentContainerStyle={{ width: trackW }}>
          <View style={{ width: trackW }}>
            <View style={{ height: 24, flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: c.border }}>
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
                    <Text style={{ fontSize: 11, color: isToday ? c.primary : tone, fontWeight: isToday ? '600' : '400' }}>{Number(d.slice(8, 10))}</Text>
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
                <Text className="px-3 py-2 text-[14px] text-cd-muted">이 기간에 날짜가 있는 할 일이 없습니다.</Text>
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
                  const w = Math.max(DAY_W - 2, (x1 - x0 + 1) * DAY_W - 2);
                  // 진행 표시 — 상위 = 하위 평균(하위를 받아 온 뒤), 하위 = 자체 진행율. 완료는 ✓.
                  const agg = r.depth === 0 ? aggOf[r.item.itemId] : undefined;
                  const fill = r.undated ? null : r.depth === 0 ? (agg != null ? (done ? 100 : agg) : null) : r.item.progressPct != null && !done ? r.item.progressPct : null;
                  const pctText = r.undated ? null : r.depth === 0 ? (agg != null ? (done ? '✓' : `${agg}%`) : null) : done ? '✓' : r.item.progressPct != null ? `${r.item.progressPct}%` : null;
                  // 막대 폭이 번호 + % 글자를 담을 때만 % 를 보인다(하루짜리 막대는 번호만)
                  const showPct = pctText != null && w >= (r.no.length + pctText.length) * 5.5 + 16;
                  return (
                    <Pressable
                      key={r.key}
                      onPress={() => onOpen(r.item)}
                      accessibilityLabel={`${r.no}. ${r.item.title}${pctText && pctText !== '✓' ? ` 진행 ${pctText}` : ''}`}
                      style={{
                        position: 'absolute',
                        left: x0 * DAY_W + 1,
                        width: w,
                        top: rowTop[i] + (r.depth === 0 ? 5 : 4),
                        height: h - (r.depth === 0 ? 10 : 8),
                        borderRadius: 5,
                        paddingHorizontal: 5,
                        flexDirection: 'row',
                        alignItems: 'center',
                        overflow: 'hidden',
                        // 개인 보드처럼 옅은 회색 보드도 막대가 보이도록 메인 막대는 진하게 + 회색 계열 테두리.
                        // 하위 평균 진행이 있는 상위 막대는 바탕을 옅게 깔고 같은 색 진한 채움으로 진행을 보인다(웹과 같은 문법).
                        backgroundColor: r.undated ? 'transparent' : tone ? tone.bg : agg != null ? withAlpha(tint, dark ? 0.22 : 0.3) : withAlpha(tint, done ? 0.3 : 0.75),
                        borderWidth: 1,
                        borderStyle: r.undated || r.due || tone?.dashed ? 'dashed' : 'solid',
                        borderColor: late ? over.fg : tone ? (r.undated ? c.muted : tone.border) : withAlpha(c.muted, 0.55),
                        opacity: done ? 0.6 : 1,
                      }}>
                      {fill != null ? (
                        <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${fill}%`, backgroundColor: r.depth === 0 ? withAlpha(tint, dark ? 0.55 : 0.8) : withAlpha('#8fb0e0', 0.45) }} />
                      ) : null}
                      <Text numberOfLines={1} style={{ fontSize: r.depth === 0 ? 11 : 10, fontWeight: '600', color: c.text }}>
                        {r.no}
                      </Text>
                      {showPct ? (
                        <Text numberOfLines={1} style={{ marginLeft: 'auto', fontSize: r.depth === 0 ? 10 : 9, fontWeight: '600', color: c.muted }}>
                          {pctText}
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })
              )}
            </View>
          </View>
        </ScrollView>
      </View>

      {/* ── 일정 목록(일정마다 흰 박스) ── */}
      <View className="flex-row items-center justify-between px-4 pb-2 pt-5">
        <Text className="text-[12px] font-medium text-cd-muted">
          일정 {rows.filter((r) => r.depth === 0).length}건 · {fmtMd(windowStart)} ~ {fmtMd(addDays(windowStart, DAYS - 1))}
        </Text>
        {undatedCount ? <Text className="text-[12px] text-cd-faint">날짜 없음 {undatedCount}건</Text> : null}
      </View>
      <View className="gap-2 px-4">
        {groups.map((g) => (
          <View key={`g${g[0].key}`} style={boxStyle} className="rounded-lg border bg-cd-card py-1">
            {g.map((r) => {
              const late = lateOf(r);
              const period = r.undated ? '날짜 미정' : r.milestone ? `◆ ${r.item.actualDate ? `실제 ${fmtMd(r.start)}` : `예정 ${fmtMd(r.start)}`}` : r.due ? `마감 ${fmtMd(r.start)}` : r.start === r.end ? fmtMd(r.start) : `${fmtMd(r.start)} ~ ${fmtMd(r.end)} · ${diffDays(r.start, r.end) + 1}일`;
              if (r.depth === 1) {
                const tone = statusTone(r.item.status, c, dark);
                return (
                  <Pressable key={`l${r.key}`} onPress={() => onOpen(r.item)} className="flex-row items-center gap-2 border-t border-cd-grid-line py-2 pl-10 pr-3 active:bg-cd-surface">
                    <Text className="w-8 text-[11px] text-cd-faint">{r.no}</Text>
                    <Text numberOfLines={1} className="flex-1 text-[13px] text-cd-text">
                      {r.item.title}
                    </Text>
                    <Text className="text-[11px] text-cd-faint">{period}</Text>
                    {/* 너비는 "할 일 100%" 기준으로 고정(minWidth) — 진행율 자릿수에 따라 태그 폭이 들쭉날쭉하지 않게(2026-11-04). */}
                    <View style={{ minWidth: 64, alignItems: 'center', backgroundColor: tone.bg, borderColor: tone.border, borderWidth: 1, borderStyle: tone.dashed ? 'dashed' : 'solid', borderRadius: 5, paddingHorizontal: 5 }}>
                      <Text className="text-[11px] font-semibold text-cd-text">
                        {TODO_STATUS_LABELS[r.item.status]}
                        {r.item.status !== 'done' && r.item.progressPct != null ? ` ${r.item.progressPct}%` : ''}
                      </Text>
                    </View>
                  </Pressable>
                );
              }
              return (
                <Pressable key={`l${r.key}`} onPress={() => onOpen(r.item)} className="gap-0.5 px-3 py-2 active:bg-cd-surface">
                  <View className="flex-row items-center gap-2">
                    <View style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: withAlpha(r.item.boardColor || c.primary, 0.35), alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
                      <Text className="text-[11px] font-semibold text-cd-text">{r.no}</Text>
                    </View>
                    <StatusDot status={r.item.status} />
                    <Text numberOfLines={1} className={`flex-1 text-[14px] font-medium ${r.item.status === 'done' ? 'text-cd-faint line-through' : 'text-cd-text'}`}>
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
                      <Text className="text-[12px] text-cd-faint">
                        · 하위 {r.item.subtaskDone}/{r.item.subtaskTotal}
                        {aggOf[r.item.itemId] != null ? ` · 진행 ${aggOf[r.item.itemId]}%` : ''}
                      </Text>
                    ) : null}
                    {r.item.assigneeName ? <Text className="ml-auto text-[12px] text-cd-faint">{r.item.assigneeName}</Text> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
      <Text className="px-4 py-3 text-[11px] text-cd-faint">막대·행을 누르면 상세. 여러 날에 걸친 일정은 하위 작업을 함께 보여 줍니다.</Text>
    </View>
  );
}
