import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Button, CtaGradientFill, EmptyState, Screen, SkeletonList, useToast } from '@/components/ui';
import { BoardChips, BoardSections, MoveSheet } from '@/components/todo/BoardSections';
import { DateGroupHeader } from '@/components/todo/parts';
import { QuickAddBar } from '@/components/todo/QuickAddBar';
import { ApprovalEventRow, TodoRow } from '@/components/todo/TodoRow';
import { apiJson } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { TODO_STATUSES, TODO_STATUS_LABELS, type TodoApprovalEvent, type TodoBoard, type TodoColumn, type TodoItem, type TodoStatus } from '@/lib/todo-types';
import { TODO_UI, addDays, eventCovers, fmtLongDate, fmtMd, isOverdue, keyDate, statusTone, todayLocal, weekEnd, withAlpha } from '@/lib/todo-utils';
import { useApi } from '@/lib/use-api';
import { useDirectorySnapshot } from '@/lib/use-directory-snapshot';
import { useTheme } from '@/theme/useTheme';

/**
 * 할 일(§12 · v4 §19-9) — 상단 태그 버튼(오늘·지연·이번 주·공유받음 = 필터) → 범위 탭(내 할 일 | 공유받음 | 프로젝트,
 * 밑줄형) + 보기 토글(목록/보드) → 날짜 그룹(sticky 42px) 목록 또는 보드 섹션 → 하단 퀵애드.
 * 데이터는 웹과 같은 /api/todo/items(가시성은 서버 단일 함수). 완료는 낙관적으로 반영하고
 * 5초 동안 "되돌리기"를 행 자리에 둔다(useToast 에 액션이 없어 §7.5 의 토스트 대신).
 * 보드 생성·멤버 관리는 웹 전용 — 프로젝트 보드가 없으면 빈 상태만 보인다.
 *
 * ⚠ 헤더는 Screen 의 자체 헤더("+" 는 right 슬롯) — _layout 에서 옵션을 주지 않는다.
 */

type Scope = 'my' | 'shared' | 'project';
type ViewMode = 'list' | 'board';
type Filter = 'today' | 'overdue' | 'week' | null;

interface ListRes {
  items: TodoItem[];
  boards: TodoBoard[];
  approvalEvents?: TodoApprovalEvent[];
}

const UNDO_MS = 5000;

/** 날짜 그룹 — 헤더 + 행(할 일·결재 일정 섞음). */
interface Group {
  key: string;
  label: string;
  tone?: 'over' | 'sky';
  sub?: string;
  items: TodoItem[];
  events: TodoApprovalEvent[];
  /** 그룹 안에서 예정 날짜를 보일지(이번 주·이후 등 여러 날이 섞인 그룹). */
  showDate?: boolean;
  /** 비어 있어도 헤더를 그린다(오늘·다음 주 이후). */
  keep?: boolean;
  emptyText?: string;
}

/** 상단 태그 버튼 — 연한 배경 + 같은 계열 진한 테두리, 선택되면 테두리 2px. */
function TagButton({
  label,
  count,
  tone,
  active,
  onPress,
}: {
  label: string;
  count: number;
  tone: keyof typeof TODO_UI.tags;
  active: boolean;
  onPress: () => void;
}) {
  const { c, dark } = useTheme();
  const t = TODO_UI.tags[tone];
  const fg = t.fg ? (dark ? TODO_UI.over.darkFg : t.fg) : c.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityState={{ selected: active }}
      style={{
        height: 30,
        paddingHorizontal: active ? 11 : 12,
        borderRadius: 8,
        borderWidth: active ? 2 : 1,
        borderColor: t.border,
        backgroundColor: dark ? withAlpha(t.border, 0.18) : t.bg,
      }}
      className="flex-row items-center gap-1.5 active:opacity-70">
      <Text style={{ fontSize: 12.5, fontWeight: '500', color: fg }}>{label}</Text>
      <Text style={{ fontSize: 12.5, fontWeight: '600', color: fg }}>{count}</Text>
    </Pressable>
  );
}

export default function TodoScreen() {
  const router = useRouter();
  const toast = useToast();
  const { c } = useTheme();
  const { user } = useAuth();
  const me = user?.id ?? '';
  const [scope, setScope] = useState<Scope>('my');
  const [view, setView] = useState<ViewMode>('list');
  const [filter, setFilter] = useState<Filter>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const quickRef = useRef<TextInput | null>(null);

  const today = todayLocal();
  const tomorrow = addDays(today, 1);
  const wEnd = weekEnd(today);

  // 내 할 일은 항상 불러 둔다(보드 목록·태그 건수의 원천). 공유받음은 태그 건수 때문에 캐시로 함께.
  // ⚠ from/to 를 주면 날짜 없는 할 일·이후 할 일이 잘린다 — 구간 없이 받고 결재 일정은 서버 기본(이번 달 ±1개월).
  const myApi = useApi<ListRes>('/api/todo/items?view=my&withApproval=1', { cache: true });
  const sharedApi = useApi<ListRes>('/api/todo/items?view=shared', { cache: true });
  const boards = useMemo(() => myApi.data?.boards ?? [], [myApi.data]);
  const defaultBoardId = boards.find((b) => b.isDefault)?.boardId ?? boards.find((b) => b.kind === 'personal')?.boardId ?? null;
  const projectBoards = useMemo(() => boards.filter((b) => b.kind !== 'personal'), [boards]);
  // 프로젝트 탭 기본 선택 = 첫 프로젝트 보드(effect 로 setState 하지 않고 렌더에서 파생).
  const selectedProjectId = projectId && projectBoards.some((b) => b.boardId === projectId) ? projectId : projectBoards[0]?.boardId ?? null;
  const boardTarget = scope === 'project' ? selectedProjectId : scope === 'my' && view === 'board' ? defaultBoardId : null;
  const boardApi = useApi<ListRes>(`/api/todo/items?view=board&board=${boardTarget ?? ''}&withApproval=1&done=1`, { skip: !boardTarget });

  // 돌아올 때 현재 범위만 재조회. ⚠ reload 를 의존성에 넣으면 매 렌더 재요청(무한 루프 이력).
  const latest = useRef({ scope, myApi, sharedApi, boardApi, boardTarget });
  useEffect(() => {
    latest.current = { scope, myApi, sharedApi, boardApi, boardTarget };
  });
  const reloadCurrent = useCallback(() => {
    const l = latest.current;
    void l.myApi.reload();
    if (l.scope === 'shared') void l.sharedApi.reload();
    if (l.boardTarget) void l.boardApi.reload();
  }, []);
  useFocusEffect(
    useCallback(() => {
      reloadCurrent();
    }, [reloadCurrent])
  );

  // ── 완료 낙관 반영 + 되돌리기 ──
  const [justDone, setJustDone] = useState<Record<string, true>>({});
  const [hidden, setHidden] = useState<Record<string, true>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => {
    const t = timers.current;
    return () => Object.values(t).forEach(clearTimeout);
  }, []);

  const complete = async (it: TodoItem) => {
    if (it.status === 'done') return;
    setJustDone((p) => ({ ...p, [it.itemId]: true }));
    try {
      await apiJson(`/api/todo/items/${it.itemId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done: true }),
      });
      toast.show('완료했습니다', 'success');
      timers.current[it.itemId] = setTimeout(() => {
        setJustDone((p) => {
          const n = { ...p };
          delete n[it.itemId];
          return n;
        });
        setHidden((p) => ({ ...p, [it.itemId]: true }));
        delete timers.current[it.itemId];
        // 반복 할 일은 다음 발생이 새로 생기므로 목록을 다시 받는다.
        if (it.recurrence) reloadCurrent();
      }, UNDO_MS);
    } catch (e) {
      setJustDone((p) => {
        const n = { ...p };
        delete n[it.itemId];
        return n;
      });
      toast.show((e as Error).message, 'error');
    }
  };

  const undo = async (it: TodoItem) => {
    const t = timers.current[it.itemId];
    if (t) clearTimeout(t);
    delete timers.current[it.itemId];
    setJustDone((p) => {
      const n = { ...p };
      delete n[it.itemId];
      return n;
    });
    try {
      await apiJson(`/api/todo/items/${it.itemId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done: false }),
      });
    } catch (e) {
      toast.show((e as Error).message, 'error');
      reloadCurrent();
    }
  };

  const visible = (list: TodoItem[]) => list.filter((it) => !hidden[it.itemId]);
  const openItem = (it: TodoItem) => router.push({ pathname: '/todo/[itemId]', params: { itemId: it.itemId } });
  const openDoc = (ev: TodoApprovalEvent) =>
    ev.docId ? router.push({ pathname: '/approval/[docId]', params: { docId: ev.docId } }) : undefined;

  // ── ⋮ 상태 변경 시트 ──
  const [moreItem, setMoreItem] = useState<TodoItem | null>(null);
  const [changing, setChanging] = useState(false);
  const changeStatus = async (status: TodoStatus) => {
    const it = moreItem;
    if (!it || changing) return;
    if (it.status === status) {
      setMoreItem(null);
      return;
    }
    setChanging(true);
    try {
      await apiJson(`/api/todo/items/${it.itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      toast.show(`"${TODO_STATUS_LABELS[status]}"(으)로 바꿨습니다`, 'success');
      setMoreItem(null);
      reloadCurrent();
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setChanging(false);
    }
  };

  // ── 날짜 그룹 분류(내 할 일 · 프로젝트 목록 공용) ──
  const buildGroups = (list: TodoItem[], events: TodoApprovalEvent[], f: Filter): Group[] => {
    const open = list.filter((it) => it.status !== 'done');
    const done = list.filter((it) => it.status === 'done');
    const overdue = open.filter((it) => isOverdue(it, today));
    const rest = open.filter((it) => !isOverdue(it, today));
    const on = (ymd: string) => rest.filter((it) => keyDate(it) === ymd || (it.dueDate === ymd && (keyDate(it) ?? '') <= ymd));
    const todays = on(today);
    const tomorrows = on(tomorrow).filter((it) => !todays.includes(it));
    const weekStart = addDays(today, 2);
    const inWeek = rest.filter((it) => {
      const k = keyDate(it);
      return k != null && k >= weekStart && k <= wEnd && !todays.includes(it) && !tomorrows.includes(it);
    });
    const later = rest.filter((it) => {
      const k = keyDate(it);
      return k != null && k > wEnd && !todays.includes(it) && !tomorrows.includes(it);
    });
    const noDate = rest.filter((it) => keyDate(it) == null && !todays.includes(it) && !tomorrows.includes(it));
    // 결재 대기(내가 결재할 차례, kind pending)는 날짜와 무관하게 오늘 그룹 맨 위 — 서버 순서(긴급 → 상신 오래된 순) 유지.
    const pending = events.filter((e) => e.kind === 'pending');
    const sched = events.filter((e) => e.kind !== 'pending');
    const evIn = (a: string, b: string) => sched.filter((e) => e.startDate <= b && (e.endDate || e.startDate) >= a);
    const evToday = [...pending, ...sched.filter((e) => eventCovers(e, today))];
    const evTomorrow = sched.filter((e) => eventCovers(e, tomorrow) && !evToday.includes(e));
    const evWeek = weekStart <= wEnd ? evIn(weekStart, wEnd).filter((e) => !evToday.includes(e) && !evTomorrow.includes(e)) : [];
    const evLater = sched.filter((e) => e.startDate > wEnd);

    const g: Group[] = [];
    if (f === 'overdue') return [{ key: 'over', label: '지연', tone: 'over', items: overdue, events: [], showDate: true, keep: true, emptyText: '지연된 할 일이 없습니다.' }];
    if (overdue.length) g.push({ key: 'over', label: '지연', tone: 'over', items: overdue, events: [], showDate: true });
    g.push({ key: 'today', label: '오늘', tone: 'sky', sub: fmtLongDate(today), items: todays, events: evToday, keep: true, emptyText: '오늘 할 일이 없습니다.' });
    if (f === 'today') return g.filter((x) => x.key === 'today');
    if (tomorrows.length || evTomorrow.length) g.push({ key: 'tomorrow', label: '내일', sub: fmtLongDate(tomorrow), items: tomorrows, events: evTomorrow });
    if (weekStart <= wEnd && (inWeek.length || evWeek.length))
      g.push({ key: 'week', label: '이번 주', sub: `${fmtMd(weekStart)} – ${fmtMd(wEnd)}`, items: inWeek, events: evWeek, showDate: true });
    if (f === 'week') return g.filter((x) => x.key !== 'over');
    g.push({ key: 'later', label: '다음 주 이후', items: later, events: evLater, showDate: true, keep: true, emptyText: '예정된 업무가 없습니다.' });
    if (noDate.length) g.push({ key: 'nodate', label: '날짜 없음', items: noDate, events: [] });
    if (done.length) g.push({ key: 'done', label: '완료', items: done, events: [], showDate: true });
    return g;
  };

  // ── 내 할 일 ──
  const myItems = useMemo(() => visible(myApi.data?.items ?? []), [myApi.data, hidden]); // eslint-disable-line react-hooks/exhaustive-deps
  const myEvents = myApi.data?.approvalEvents ?? [];
  const myOpen = myItems.filter((it) => it.status !== 'done');
  const overdueCount = myOpen.filter((it) => isOverdue(it, today)).length;
  const todayCount = myOpen.filter((it) => !isOverdue(it, today) && (keyDate(it) === today || it.dueDate === today)).length;
  const weekCount = myOpen.filter((it) => {
    const k = keyDate(it);
    return !isOverdue(it, today) && ((k != null && k >= today && k <= wEnd) || (it.dueDate != null && it.dueDate >= today && it.dueDate <= wEnd));
  }).length;

  // ── 공유받음 ──
  const sharedItems = useMemo(() => visible(sharedApi.data?.items ?? []), [sharedApi.data, hidden]); // eslint-disable-line react-hooks/exhaustive-deps
  const sharedBoards = sharedApi.data?.boards ?? boards;
  const sharedGroups = useMemo((): Group[] => {
    const assigned = sharedItems.filter((it) => it.assigneeUserId === me);
    const byBoard = new Map<string, { board: TodoBoard; items: TodoItem[] }>();
    const watched: TodoItem[] = [];
    for (const it of sharedItems) {
      if (it.assigneeUserId === me) continue;
      const b = sharedBoards.find((x) => x.boardId === it.boardId);
      if (b && b.kind !== 'personal') {
        const g = byBoard.get(b.boardId) ?? { board: b, items: [] };
        g.items.push(it);
        byBoard.set(b.boardId, g);
      } else watched.push(it);
    }
    const g: Group[] = [];
    if (assigned.length) g.push({ key: 'assigned', label: '나에게 배정', items: assigned, events: [], showDate: true });
    if (watched.length) g.push({ key: 'watched', label: '참조', items: watched, events: [], showDate: true });
    for (const x of byBoard.values()) g.push({ key: x.board.boardId, label: x.board.name, items: x.items, events: [], showDate: true });
    return g;
  }, [sharedItems, sharedBoards, me]);
  const sharedCount = sharedItems.filter((it) => it.assigneeUserId === me).length;

  // ── 보드(프로젝트 · 내 할 일의 보드 보기) ──
  const board = boards.find((b) => b.boardId === boardTarget) ?? null;
  const boardItems = useMemo(() => visible(boardApi.data?.items ?? []), [boardApi.data, hidden]); // eslint-disable-line react-hooks/exhaustive-deps
  const boardEvents = boardApi.data?.approvalEvents ?? [];
  const moveItem = async (it: TodoItem, col: TodoColumn | null) => {
    try {
      await apiJson(`/api/todo/items/${it.itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columnId: col?.columnId ?? null }),
      });
      toast.show(col ? `"${col.name}" 열로 옮겼습니다` : '열 배정을 해제했습니다', 'success');
      void boardApi.reload();
    } catch (e) {
      toast.show((e as Error).message, 'error');
      throw e;
    }
  };

  // ── 퀵애드의 @이름 · #보드 해석 ──
  const org = useDirectorySnapshot();
  const resolveAssignee = (name: string) => {
    const emps = org?.employees ?? [];
    const hit = emps.find((e) => e.name === name && e.userId) ?? emps.find((e) => e.name.includes(name) && e.userId);
    return hit?.userId ? { userId: hit.userId, name: hit.name } : null;
  };
  const resolveBoard = (name: string) => boards.find((b) => b.name === name || (name === '개인' && b.isDefault))?.boardId ?? null;

  const refreshing = myApi.refreshing || sharedApi.refreshing || boardApi.refreshing;

  // ── 태그 버튼 → 필터/범위 ──
  const pickFilter = (f: Exclude<Filter, null>) => {
    setScope('my');
    setView('list');
    setFilter((p) => (p === f ? null : f));
  };
  const pickScope = (s: Scope) => {
    setScope(s);
    setFilter(null);
    if (s === 'shared') setView('list');
  };

  /** 날짜 그룹을 평탄한 노드 배열로 — 헤더 인덱스를 stickyHeaderIndices 에 넘긴다. */
  const renderGroups = (groups: Group[], opts: { showAssignee?: (it: TodoItem) => boolean }) => {
    const nodes: React.ReactNode[] = [];
    const sticky: number[] = [];
    for (const g of groups) {
      const n = g.items.length + g.events.length;
      if (!n && !g.keep) continue;
      // 헤더 건수에는 결재 대기를 넣지 않고 "결재 대기 N" 보조 문구로 보인다(웹과 같은 규칙).
      const pendingN = g.events.filter((ev) => ev.kind === 'pending').length;
      sticky.push(nodes.length);
      nodes.push(<DateGroupHeader key={`h-${g.key}`} label={g.label} tone={g.tone} sub={g.sub} count={pendingN ? `결재 대기 ${pendingN} · ${n - pendingN}` : n} />);
      if (!n) {
        nodes.push(
          <Text key={`e-${g.key}`} className="border-b border-cd-grid-line px-4 pb-4 pt-3.5 text-[12.5px] text-cd-faint">
            {g.emptyText ?? '없습니다.'}
          </Text>
        );
        continue;
      }
      const rows: React.ReactNode[] = [];
      // 오늘 그룹은 결재 일정을 먼저(시간순 맥락, 결재 대기는 그보다 앞), 나머지는 할 일 뒤에.
      const evFirst = g.key === 'today';
      const evs = g.events.map((ev) => (
        <ApprovalEventRow key={ev.id} event={ev} showDate={g.showDate} today={today} onPress={ev.docId ? () => openDoc(ev) : undefined} />
      ));
      const its = g.items.map((it) => (
        <TodoRow
          key={it.itemId}
          item={it}
          today={today}
          justDone={!!justDone[it.itemId]}
          onToggle={() => void complete(it)}
          onUndo={() => void undo(it)}
          onPress={() => openItem(it)}
          onMore={it.canEdit ? () => setMoreItem(it) : undefined}
          showAssignee={opts.showAssignee ? opts.showAssignee(it) : it.assigneeUserId !== me}
          showDate={g.showDate}
        />
      ));
      rows.push(...(evFirst ? [...evs, ...its] : [...its, ...evs]));
      nodes.push(
        <View key={`b-${g.key}`} className="bg-cd-bg">
          {rows}
        </View>
      );
    }
    return { nodes, sticky };
  };

  const body = (): { nodes: React.ReactNode[]; sticky: number[]; padded: boolean } => {
    const plain = (node: React.ReactNode) => ({ nodes: [node], sticky: [], padded: true });
    if (scope === 'my' && view === 'list') {
      if (myApi.loading && !myApi.data) return plain(<SkeletonList key="sk" />);
      const groups = buildGroups(myItems, myEvents, filter);
      if (!myItems.length && !myEvents.length)
        return plain(<EmptyState key="em" icon="checkmark-done-outline" title="할 일이 없습니다" description="아래 입력줄에 적으면 바로 추가됩니다." />);
      return { ...renderGroups(groups, {}), padded: false };
    }
    if (scope === 'shared') {
      if (sharedApi.loading && !sharedApi.data) return plain(<SkeletonList key="sk" />);
      if (!sharedItems.length)
        return plain(
          <EmptyState key="em" icon="people-outline" title="공유받은 할 일이 없습니다" description="담당·참조로 지정되거나 보드 멤버가 되면 여기에 보입니다." />
        );
      return { ...renderGroups(sharedGroups, { showAssignee: (it) => it.assigneeUserId !== me }), padded: false };
    }
    // 프로젝트 · 내 할 일의 보드 보기
    if (scope === 'project' && !projectBoards.length)
      return plain(
        myApi.loading && !myApi.data ? (
          <SkeletonList key="sk" />
        ) : (
          <EmptyState key="em" icon="grid-outline" title="프로젝트 보드가 없습니다" description="웹에서 프로젝트 보드를 만들 수 있습니다. 멤버로 추가되면 여기에 보입니다." />
        )
      );
    if (!board) return plain(myApi.loading ? <SkeletonList key="sk" /> : <EmptyState key="em" icon="grid-outline" title="보드가 없습니다" />);
    if (boardApi.loading && !boardApi.data) return plain(<SkeletonList key="sk" />);
    if (view === 'list') {
      if (!boardItems.length && !boardEvents.length)
        return plain(<EmptyState key="em" icon="checkmark-done-outline" title="이 보드에 할 일이 없습니다" description="아래 입력줄에 적으면 이 보드에 추가됩니다." />);
      return { ...renderGroups(buildGroups(boardItems, boardEvents, null), { showAssignee: () => true }), padded: false };
    }
    return plain(<BoardSections key="bd" board={board} items={boardItems} today={today} onOpen={openItem} onMove={moveItem} />);
  };
  const content = body();

  const scopeTab = (key: Scope, label: string, count?: number) => {
    const on = scope === key;
    return (
      <Pressable
        key={key}
        onPress={() => pickScope(key)}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        className="h-full justify-center px-2.5 active:opacity-70">
        <View className="flex-row items-center gap-1.5">
          <Text className={`text-[14px] ${on ? 'font-semibold text-cd-primary' : 'text-cd-muted'}`}>{label}</Text>
          {count ? <Text className="text-[12px] text-cd-faint">{count}</Text> : null}
        </View>
        {on ? <View className="absolute bottom-0 left-2.5 right-2.5 h-[2px] bg-cd-primary" /> : null}
      </Pressable>
    );
  };
  const viewBtn = (key: ViewMode, icon: 'list-outline' | 'grid-outline', label: string) => {
    const on = view === key;
    const disabled = scope === 'shared';
    return (
      <Pressable
        key={key}
        onPress={() => setView(key)}
        disabled={disabled}
        accessibilityLabel={label}
        accessibilityState={{ selected: on, disabled }}
        className={`h-7 w-[34px] items-center justify-center ${key === 'list' ? 'border-r border-cd-border' : ''} ${on ? 'bg-cd-primary-soft' : 'bg-cd-card'}`}
        style={{ opacity: disabled ? 0.4 : 1 }}>
        <Ionicons name={icon} size={15} color={on ? c.primary : c.muted} />
      </Pressable>
    );
  };

  return (
    <Screen
      title="할 일"
      back
      scroll={false}
      padded={false}
      right={
        <Pressable
          onPress={() => quickRef.current?.focus()}
          accessibilityLabel="새 할 일"
          hitSlop={8}
          className="mr-2 h-9 w-9 items-center justify-center overflow-hidden rounded-lg active:opacity-70">
          <CtaGradientFill />
          <Ionicons name="add" size={20} color="#fff" />
        </Pressable>
      }>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
        {/* 태그 버튼(필터) */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, flexShrink: 0 }}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12 }}>
          <TagButton label="오늘" count={todayCount} tone="today" active={scope === 'my' && filter === 'today'} onPress={() => pickFilter('today')} />
          <TagButton label="지연" count={overdueCount} tone="over" active={scope === 'my' && filter === 'overdue'} onPress={() => pickFilter('overdue')} />
          <TagButton label="이번 주" count={weekCount} tone="week" active={scope === 'my' && filter === 'week'} onPress={() => pickFilter('week')} />
          <TagButton label="공유받음" count={sharedCount} tone="shared" active={scope === 'shared'} onPress={() => pickScope(scope === 'shared' ? 'my' : 'shared')} />
        </ScrollView>
        {/* 범위 탭 + 보기 토글 */}
        <View style={{ height: 46 }} className="flex-row items-end border-b border-cd-border px-4">
          <View className="h-full flex-row">
            {scopeTab('my', '내 할 일')}
            {scopeTab('shared', '공유받음', sharedCount)}
            {scopeTab('project', '프로젝트')}
          </View>
          <View className="flex-1" />
          <View className="mb-2 flex-row overflow-hidden rounded-lg border border-cd-border">
            {viewBtn('list', 'list-outline', '목록')}
            {viewBtn('board', 'grid-outline', '보드')}
          </View>
        </View>
        {scope === 'project' && projectBoards.length ? <BoardChips boards={projectBoards} value={selectedProjectId} onChange={setProjectId} /> : null}
        <ScrollView
          className="flex-1"
          contentContainerStyle={content.padded ? { padding: 16, paddingBottom: 24, gap: 12 } : { paddingBottom: 24 }}
          stickyHeaderIndices={content.sticky}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reloadCurrent} />}>
          {content.nodes}
        </ScrollView>
        <QuickAddBar
          inputRef={quickRef}
          boardId={scope === 'project' ? selectedProjectId : null}
          resolveAssignee={resolveAssignee}
          resolveBoard={resolveBoard}
          onCreated={(item) => {
            toast.show(`"${item.title}" 추가됨`, 'success');
            reloadCurrent();
          }}
        />
      </KeyboardAvoidingView>

      {/* ⋮ 상태 변경·더 보기 */}
      <MoveSheet
        visible={!!moreItem}
        title="상태 변경"
        subtitle={moreItem?.title}
        busy={changing}
        onClose={() => setMoreItem(null)}
        onPick={(k) => void changeStatus(k as TodoStatus)}
        options={TODO_STATUSES.map((s) => ({
          key: s,
          label: TODO_STATUS_LABELS[s],
          tone: statusTone(s),
          current: moreItem?.status === s,
          sub: moreItem?.status === s ? '현재' : s === 'review' ? '담당·참조자에게 알림' : undefined,
        }))}
        extra={
          <View className="pt-1">
            <Button
              label="상세 열기"
              variant="ghost"
              icon="open-outline"
              full
              onPress={() => {
                const it = moreItem;
                setMoreItem(null);
                if (it) openItem(it);
              }}
            />
          </View>
        }
      />
    </Screen>
  );
}
