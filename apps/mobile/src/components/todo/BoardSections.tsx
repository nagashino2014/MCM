import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Button, EmptyState, Sheet } from '@/components/ui';
import { TODO_STATUS_LABELS, type TodoBoard, type TodoColumn, type TodoItem } from '@/lib/todo-types';
import { columnTone, dueBadge, itemContext, labelColors, type LabelTone } from '@/lib/todo-utils';
import { useTheme } from '@/theme/useTheme';

import { BoardStripe, DueBadge, PastelLabel, PriorityLabel, SectionHeader, SegBar } from './parts';

/**
 * 보드 보기(v4 §19-3·10) — 가로 칸반 대신 **열 = 세로 접이식 섹션**. 열 이름은 파스텔 칩(할 일 회색 · 진행 중 sky ·
 * 검토 lavender · 확인 대기 sage, 나머지 순환) + 건수 + WIP "권장 N건 초과" 라벨. 카드는 좌측 띠 · 제목 · 맥락 ·
 * 하단(마감 라벨 · 미니 분절 바 · 담당 이름). 완료·보류 열은 맨 아래 접힘 행.
 * 카드 길게 누름 → "열 이동" 시트(MoveSheet, 검토 열엔 "담당·참조자에게 알림"). 가로 DnD 는 P4.
 */

/** 보드 선택 가로 칩 — 색 점 + 이름. */
export function BoardChips({
  boards,
  value,
  onChange,
}: {
  boards: TodoBoard[];
  value: string | null;
  onChange: (boardId: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0, flexShrink: 0 }}
      contentContainerStyle={{ gap: 6, paddingHorizontal: 16, paddingTop: 10 }}>
      {boards.map((b) => {
        const active = b.boardId === value;
        return (
          <Pressable
            key={b.boardId}
            onPress={() => onChange(b.boardId)}
            className={`h-7 flex-row items-center gap-1.5 rounded-lg border px-2.5 active:opacity-70 ${
              active ? 'border-cd-primary bg-cd-primary-soft' : 'border-cd-border bg-cd-card'
            }`}>
            <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: b.colorHex }} />
            <Text className={`text-[12px] ${active ? 'font-semibold text-cd-primary' : 'text-cd-muted'}`}>
              {b.isDefault ? '개인' : b.name}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** 보드 정보 행 — 프로젝트명 15px/600 + 색 사각 · 발주처 · 멤버 n명. 개인 보드는 그리지 않는다. */
export function BoardInfo({ board }: { board: TodoBoard }) {
  if (board.kind === 'personal') return null;
  const subs = [board.clientName ? `발주처 ${board.clientName}` : null, `멤버 ${board.memberCount + 1}명`].filter(Boolean);
  return (
    <View className="gap-1 px-1 pb-1">
      <View className="flex-row items-center gap-2">
        <View style={{ width: 12, height: 12, borderRadius: 4, backgroundColor: board.colorHex }} />
        <Text numberOfLines={1} className="flex-1 text-[15px] font-semibold text-cd-text">
          {board.projectName ?? board.name}
        </Text>
      </View>
      <Text numberOfLines={1} className="text-[12.5px] text-cd-muted">
        {subs.join(' · ')}
      </Text>
    </View>
  );
}

const UNASSIGNED = '__none__';

/** 열 안의 카드. */
function BoardCard({
  item,
  today,
  onPress,
  onLongPress,
  last,
}: {
  item: TodoItem;
  today: string;
  onPress: () => void;
  onLongPress: () => void;
  last?: boolean;
}) {
  const due = dueBadge(item, today);
  const done = item.status === 'done';
  const context = itemContext(item);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={{ paddingLeft: 16, paddingRight: 12, paddingTop: 11, paddingBottom: 10 }}
      className={`gap-1 active:bg-cd-surface ${last ? '' : 'border-b border-cd-grid-line'}`}>
      <BoardStripe color={item.boardColor} />
      <View className="flex-row items-start gap-1.5">
        {!done ? (
          <View style={{ marginTop: 3 }}>
            <PriorityLabel priority={item.priority} />
          </View>
        ) : null}
        <Text numberOfLines={2} className={`flex-1 text-[15px] leading-[21px] ${done ? 'text-cd-faint line-through' : 'text-cd-text'}`}>
          {item.title}
        </Text>
      </View>
      {context ? (
        <Text numberOfLines={1} className="text-[12.5px] text-cd-muted">
          {context}
        </Text>
      ) : null}
      <View className="mt-[3px] flex-row flex-wrap items-center gap-2">
        {due ? <DueBadge label={due.label} tone={due.tone} /> : null}
        {item.subtaskTotal > 0 ? (
          <View className="flex-row items-center gap-1">
            <SegBar done={item.subtaskDone} total={item.subtaskTotal} />
            <Text className="text-[12.5px] text-cd-muted">
              {item.subtaskDone}/{item.subtaskTotal}
            </Text>
          </View>
        ) : null}
        {item.commentCount > 0 ? (
          <View className="flex-row items-center gap-0.5">
            <Ionicons name="chatbubble-outline" size={11} color="#9aa0ab" />
            <Text className="text-[12.5px] text-cd-muted">{item.commentCount}</Text>
          </View>
        ) : null}
        <View className="flex-1" />
        {item.assigneeName ? (
          <Text className="text-[12.5px] text-cd-text">{item.assigneeName}</Text>
        ) : (
          <Text className="text-[12.5px] text-cd-faint">담당 없음</Text>
        )}
      </View>
    </Pressable>
  );
}

export interface MoveOption {
  key: string;
  label: string;
  tone: LabelTone;
  /** 우측 보조("5 / 3 · 현재", "담당·참조자에게 알림"). */
  sub?: string;
  current?: boolean;
  danger?: boolean;
}

/**
 * 이동 시트 — 보드의 "열 이동"과 목록의 "상태 변경"이 같은 틀을 쓴다. 옵션 행 48px: 파스텔 칩 + 보조문구,
 * 현재 항목 강조. 아래 `extra` 에 "상세 열기" 같은 보조 행동을 둘 수 있다.
 */
export function MoveSheet({
  visible,
  title,
  subtitle,
  options,
  busy,
  onPick,
  onClose,
  extra,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  options: MoveOption[];
  busy?: boolean;
  onPick: (key: string) => void;
  onClose: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <Sheet
      visible={visible}
      onClose={() => (busy ? undefined : onClose())}
      title={title}
      footer={
        <View className="flex-1">
          <Button label="취소" variant="ghost" onPress={onClose} disabled={busy} full />
        </View>
      }>
      {subtitle ? (
        <Text numberOfLines={1} className="mb-3 text-[12px] text-cd-muted">
          {subtitle}
        </Text>
      ) : null}
      <View className="gap-2">
        {options.map((o) => (
          <Pressable
            key={o.key}
            onPress={() => onPick(o.key)}
            disabled={busy}
            className={`h-12 flex-row items-center gap-2.5 rounded-lg border px-3 active:opacity-70 ${
              o.current ? 'border-cd-primary bg-cd-primary-soft' : 'border-cd-border bg-cd-card'
            }`}>
            <PastelLabel label={o.label} tone={o.tone} size={12.5} bold />
            <View className="flex-1" />
            {o.sub ? <Text className={`text-[12px] ${o.danger ? 'text-cd-error' : 'text-cd-muted'}`}>{o.sub}</Text> : null}
          </Pressable>
        ))}
        {extra}
      </View>
    </Sheet>
  );
}

export function BoardSections({
  board,
  items,
  today,
  onOpen,
  onMove,
}: {
  board: TodoBoard;
  items: TodoItem[];
  today: string;
  onOpen: (item: TodoItem) => void;
  /** 열 이동 — 상위가 PATCH 를 보내고 목록을 갱신한다. */
  onMove: (item: TodoItem, column: TodoColumn | null) => Promise<void>;
}) {
  const { dark } = useTheme();
  // 접기 상태는 화면 로컬 — 기본은 열의 collapsed. 완료·보류 열은 맨 아래 접힘 행(기본 접힘).
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [target, setTarget] = useState<TodoItem | null>(null);
  const [moving, setMoving] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, TodoItem[]>();
    for (const it of items) {
      const k = it.columnId ?? UNASSIGNED;
      const arr = map.get(k) ?? [];
      arr.push(it);
      map.set(k, arr);
    }
    return map;
  }, [items]);

  const isFolded = (col: TodoColumn) => col.statusMap === 'done' || col.statusMap === 'hold';
  const isOpen = (col: TodoColumn) => open[col.columnId] ?? !(col.collapsed || isFolded(col));
  const active = board.columns.filter((col) => !isFolded(col));
  const folded = board.columns.filter(isFolded);
  const unassigned = groups.get(UNASSIGNED) ?? [];
  const tones = new Map(board.columns.map((col, i) => [col.columnId, columnTone(col, i)] as const));

  const doMove = async (key: string) => {
    if (!target || moving) return;
    const col = key === UNASSIGNED ? null : board.columns.find((x) => x.columnId === key) ?? null;
    if ((col?.columnId ?? null) === target.columnId) {
      setTarget(null);
      return;
    }
    setMoving(true);
    try {
      await onMove(target, col);
      setTarget(null);
    } finally {
      setMoving(false);
    }
  };

  if (!board.columns.length && !items.length) {
    return <EmptyState icon="grid-outline" title="열이 없습니다" description="웹에서 보드 열을 추가하면 여기에 표시됩니다." />;
  }

  const renderCards = (list: TodoItem[]) =>
    list.map((it, i) => (
      <BoardCard
        key={it.itemId}
        item={it}
        today={today}
        last={i === list.length - 1}
        onPress={() => onOpen(it)}
        onLongPress={() => (it.canEdit ? setTarget(it) : undefined)}
      />
    ));

  const overLabel = labelColors('over', dark);

  return (
    <View className="gap-3">
      <BoardInfo board={board} />
      {active.map((col) => {
        const list = groups.get(col.columnId) ?? [];
        const over = col.wipLimit != null && list.length > col.wipLimit;
        const opened = isOpen(col);
        return (
          <View key={col.columnId} className="overflow-hidden rounded-card border border-cd-border bg-cd-card">
            <SectionHeader
              label={col.name}
              chipTone={tones.get(col.columnId)}
              count={list.length}
              open={opened}
              onToggle={() => setOpen((p) => ({ ...p, [col.columnId]: !opened }))}
              height={44}
              extra={
                over ? (
                  <View style={{ backgroundColor: overLabel.bg, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 1 }}>
                    <Text style={{ fontSize: 11.5, color: overLabel.fg, fontWeight: '500' }}>권장 {col.wipLimit}건 초과</Text>
                  </View>
                ) : null
              }
            />
            {opened ? (
              list.length ? (
                renderCards(list)
              ) : (
                <View className="items-center py-4">
                  <Text className="text-[12.5px] text-cd-faint">카드를 길게 눌러 여기로 옮기세요</Text>
                </View>
              )
            ) : null}
          </View>
        );
      })}
      {unassigned.length ? (
        <View className="overflow-hidden rounded-card border border-cd-border bg-cd-card">
          <SectionHeader label="열 미배정" chipTone="gray" count={unassigned.length} open height={44} />
          {renderCards(unassigned)}
        </View>
      ) : null}

      {/* 완료·보류 — 맨 아래 접힘 행 */}
      {folded.length ? (
        <View className="overflow-hidden rounded-card border border-cd-border bg-cd-card">
          {folded.map((col, i) => {
            const list = groups.get(col.columnId) ?? [];
            const opened = isOpen(col);
            return (
              <View key={col.columnId} className={i === 0 ? '' : 'border-t border-cd-grid-line'}>
                <SectionHeader
                  label={col.name}
                  chipTone={tones.get(col.columnId)}
                  count={list.length}
                  open={opened}
                  onToggle={() => setOpen((p) => ({ ...p, [col.columnId]: !opened }))}
                  height={44}
                  extra={
                    !opened && list[0] ? (
                      <Text numberOfLines={1} className="shrink text-[12px] text-cd-faint">
                        · 최근 {list[0].title}
                      </Text>
                    ) : null
                  }
                />
                {opened ? renderCards(list) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {/* 열 이동 시트 */}
      <MoveSheet
        visible={!!target}
        title="열 이동"
        subtitle={`${target?.title ?? ''} · 길게 눌러 열었습니다`}
        busy={moving}
        onClose={() => setTarget(null)}
        onPick={(k) => void doMove(k)}
        options={board.columns.map((col) => {
          const n = (groups.get(col.columnId) ?? []).length;
          const over = col.wipLimit != null && n > col.wipLimit;
          const cur = target?.columnId === col.columnId;
          const sub = [
            col.wipLimit != null ? `${n} / ${col.wipLimit}` : String(n),
            cur ? '현재' : col.statusMap === 'review' ? '담당·참조자에게 알림' : col.statusMap ? TODO_STATUS_LABELS[col.statusMap] : null,
          ]
            .filter(Boolean)
            .join(' · ');
          return { key: col.columnId, label: col.name, tone: tones.get(col.columnId) ?? 'gray', sub, current: cur, danger: over };
        })}
      />
    </View>
  );
}
