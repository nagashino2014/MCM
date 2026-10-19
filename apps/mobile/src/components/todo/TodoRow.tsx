import { Fragment, useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useTheme } from '@/theme/useTheme';
import { TODO_APPROVAL_EVENT_LABELS, type TodoApprovalEvent, type TodoItem } from '@/lib/todo-types';
import { approvalEventColor, dueBadge, fmtIsoShort, fmtMd, fmtRange, isPeriodItem, itemContext, pendingAgeDays, pendingContextParts, periodBadge, withAlpha } from '@/lib/todo-utils';

import { BoardStripe, CheckCircle, ContextDot, DueBadge, KindCircle, MiniAvatar, PastelLabel, SegBar, PriorityLabel } from './parts';

/**
 * 목록 행(v4 §19-9, 76px 이상 — 2026-10-14 66→76 비례 확대, 내부 간격 +2px) — 좌측 4px 보드 색 띠 · 중립 체크 원 · 제목 15px(높음/낮음 라벨) ·
 * 둘째 줄 맥락(색 점 + 용역 · 발주처) · 셋째 줄 메타(예정 · 마감 라벨 · 담당 · 미니 분절 바 n/m · 댓글) · 우측 ⋮.
 * 완료 직후(`justDone`)는 행을 240ms 페이드해 흐리게 두고 "완료 · 되돌리기"를 5초 보여 준다(§7.5).
 * 체크·되돌리기 자체는 상위가 낙관적으로 처리하고 여기서는 그리기만 한다.
 */
export function TodoRow({
  item,
  today,
  justDone,
  onToggle,
  onUndo,
  onPress,
  onMore,
  showAssignee,
  showDate,
  last,
}: {
  item: TodoItem;
  today: string;
  /** 방금 완료 처리된 행 — 흐리게 + 되돌리기 링크. */
  justDone?: boolean;
  onToggle: () => void;
  onUndo?: () => void;
  onPress: () => void;
  /** ⋮ — 상태 변경·더 보기 시트. 없으면 › 로 대신한다. */
  onMore?: () => void;
  /** 담당자 이름을 메타에 보인다(공유받음·보드). 담당이 없으면 "담당 없음". */
  showAssignee?: boolean;
  /** 예정에 날짜까지 보인다(날짜 그룹이 아닌 목록). */
  showDate?: boolean;
  last?: boolean;
}) {
  const { c } = useTheme();
  const done = item.status === 'done' || !!justDone;
  const fade = useSharedValue(1);
  useEffect(() => {
    fade.value = withTiming(justDone ? 0.45 : 1, { duration: 240 });
  }, [justDone, fade]);
  const faded = useAnimatedStyle(() => ({ opacity: fade.value }));

  const due = dueBadge(item, today);
  const context = itemContext(item);
  const when = item.doDate
    ? showDate
      ? `${fmtMd(item.doDate)}${item.doTime ? ` ${item.doTime}` : ''}`
      : item.doTime ?? '종일'
    : null;

  // 메타 조각 — 구분점은 사이에만.
  const meta: React.ReactNode[] = [];
  if (when)
    meta.push(
      <Text key="do" className="text-[12.5px] text-cd-muted">
        <Text className="text-cd-faint">예정 </Text>
        {when}
      </Text>
    );
  if (due)
    meta.push(
      <View key="due" className="flex-row items-center gap-1">
        <Text className="text-[12.5px] text-cd-faint">마감</Text>
        <DueBadge label={due.label} tone={due.tone} />
      </View>
    );
  if (showAssignee)
    meta.push(
      item.assigneeName ? (
        <Text key="who" className="text-[12.5px] text-cd-muted">
          {item.assigneeName}
        </Text>
      ) : (
        <Text key="who" className="text-[12.5px] text-cd-faint">
          담당 없음
        </Text>
      )
    );
  if (isPeriodItem(item) && today)
    meta.push(
      <Text key="period" className="rounded-md bg-cd-primary-soft px-1.5 text-[11.5px] font-semibold text-cd-primary">
        {periodBadge(item.doDate!, item.endDate!, today)}
      </Text>
    );
  if (item.subtaskTotal > 0)
    meta.push(
      <View key="sub" className="flex-row items-center gap-1">
        <SegBar done={item.subtaskDone} total={item.subtaskTotal} />
        <Text className="text-[12.5px] text-cd-muted">
          {item.subtaskDone}/{item.subtaskTotal}
        </Text>
      </View>
    );
  if (item.commentCount > 0)
    meta.push(
      <Text key="cm" className="text-[12.5px] text-cd-muted">
        댓글 {item.commentCount}
      </Text>
    );

  return (
    <Animated.View style={faded}>
      <Pressable
        onPress={onPress}
        style={{ minHeight: 76, paddingVertical: 14, paddingLeft: 16, paddingRight: 8 }}
        className={`flex-row items-start gap-3 active:bg-cd-surface ${last ? '' : 'border-b border-cd-grid-line'}`}>
        <BoardStripe color={item.boardColor} />
        <View style={{ marginTop: 1 }}>
          <CheckCircle done={done} status={item.status} onPress={onToggle} disabled={!item.canEdit} />
        </View>
        <View className="flex-1" style={{ minWidth: 0 }}>
          <View className="flex-row items-center gap-1.5">
            {!done ? <PriorityLabel priority={item.priority} /> : null}
            <Text
              numberOfLines={1}
              className={`flex-1 text-[15px] leading-[21px] ${done ? 'text-cd-faint line-through' : 'text-cd-text'}`}>
              {item.title}
            </Text>
          </View>
          {justDone ? (
            <View className="mt-[5px] flex-row items-center gap-1.5">
              <Text className="text-[12.5px] text-cd-muted">완료됨 ·</Text>
              <Pressable onPress={onUndo} hitSlop={8} className="active:opacity-60">
                <Text className="text-[12.5px] font-semibold text-cd-primary">되돌리기</Text>
              </Pressable>
            </View>
          ) : item.status === 'done' ? (
            // 완료 섹션 행 — 완료 시각 · 완료 메모 1줄(체크를 다시 누르면 되돌리기)
            <Text numberOfLines={1} className="mt-[5px] text-[12.5px] text-cd-faint">
              완료{item.completedAt ? ` · ${fmtIsoShort(item.completedAt)}` : ''}
              {item.completionNote ? ` · ${item.completionNote}` : ''}
            </Text>
          ) : (
            <>
              {context ? (
                <View className="mt-[5px] flex-row items-center gap-1.5">
                  <ContextDot color={item.boardColor} />
                  <Text numberOfLines={1} className="flex-1 text-[12.5px] text-cd-muted">
                    {context}
                  </Text>
                </View>
              ) : null}
              {meta.length ? (
                <View className="mt-[7px] flex-row flex-wrap items-center gap-x-2 gap-y-1">
                  {meta.map((m, i) => (
                    <Fragment key={i}>
                      {i > 0 ? <Text className="text-[12px] text-cd-faint">·</Text> : null}
                      {m}
                    </Fragment>
                  ))}
                </View>
              ) : null}
            </>
          )}
        </View>
        {onMore ? (
          <Pressable
            onPress={onMore}
            hitSlop={6}
            accessibilityLabel="상태 변경·더 보기"
            style={{ marginTop: -4 }}
            className="h-8 w-8 items-center justify-center active:opacity-60">
            <Ionicons name="ellipsis-vertical" size={16} color={c.faint} />
          </Pressable>
        ) : (
          <Ionicons name="chevron-forward" size={16} color={c.faint} style={{ marginTop: 3 }} />
        )}
      </Pressable>
    </Animated.View>
  );
}

/**
 * 결재 일정 읽기 전용 행(§11·§19-5) — 체크 없음, 종류 색 파스텔 원 안 아이콘, 종류 칩 + 제목,
 * 맥락(용역 · 발주처), "결재 승인 · 09:30 · 10/13 – 14", 바탕은 종류 색 12% 단색 틴트, 우측 "문서".
 * 탭하면 결재 문서를 연다(docId 없으면 비활성).
 */
export function ApprovalEventRow({
  event,
  onPress,
  showDate,
  last,
  today,
}: {
  event: TodoApprovalEvent;
  onPress?: () => void;
  /** 날짜 그룹 밖(보드 목록 등)이면 기간을 항상 보인다. */
  showDate?: boolean;
  last?: boolean;
  /** 결재 대기 행의 상신 경과일 계산 기준(없으면 event.startDate). */
  today?: string;
}) {
  const { dark } = useTheme();
  if (event.kind === 'pending') return <PendingApprovalRow event={event} onPress={onPress} last={last} today={today ?? event.startDate} />;
  const kind = TODO_APPROVAL_EVENT_LABELS[event.kind] ?? event.kind;
  const color = approvalEventColor(event);
  const tag = event.status === 'approved' ? '결재 승인' : event.status === 'in_progress' ? '결재 진행' : null;
  const time = event.startTime ? (event.endTime ? `${event.startTime} – ${event.endTime}` : event.startTime) : null;
  const range = showDate || (event.endDate && event.endDate !== event.startDate) ? fmtRange(event.startDate, event.endDate) : null;
  const meta = [tag, time ?? (range ? null : '종일'), range].filter(Boolean).join(' · ');
  const context = event.projectName
    ? event.clientName && event.clientName !== event.projectName
      ? `${event.projectName} · ${event.clientName}`
      : event.projectName
    : null;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={{ minHeight: 76, paddingVertical: 14, paddingLeft: 16, paddingRight: 12, backgroundColor: withAlpha(color, 0.12) }}
      className={`flex-row items-start gap-3 active:opacity-70 ${last ? '' : 'border-b border-cd-grid-line'}`}>
      <BoardStripe color={color} />
      <View style={{ marginTop: -1 }}>
        <KindCircle kind={event.kind} color={color} />
      </View>
      <View className="flex-1" style={{ minWidth: 0 }}>
        <View className="flex-row items-center gap-1.5">
          <PastelLabel label={kind} tone="gray" bg={withAlpha(color, dark ? 0.35 : 0.6)} fg={dark ? '#e7eaf4' : '#4d5260'} />
          <Text numberOfLines={1} className="flex-1 text-[14px] leading-[21px] text-cd-body">
            {event.title}
          </Text>
        </View>
        {context ? (
          <View className="mt-[5px] flex-row items-center gap-1.5">
            <ContextDot color={color} />
            <Text numberOfLines={1} className="flex-1 text-[12.5px] text-cd-muted">
              {context}
            </Text>
          </View>
        ) : null}
        <Text className="mt-[7px] text-[12.5px] text-cd-muted">
          {meta}
          {event.drafterName ? <Text className="text-cd-faint"> · {event.drafterName}</Text> : null}
        </Text>
      </View>
      {onPress ? (
        <Text className="text-[12.5px] font-medium text-cd-primary" style={{ marginTop: 3 }}>
          문서
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * 결재 대기 행(내가 결재할 차례, 2026-10-13) — 체크 없음, 파스텔 파랑 원 안 ribbon 아이콘 + "결재 대기" 칩 + 제목,
 * 맥락(용역 · 발주처 · 기안자 · 양식명 · 문서번호 · 상신 M/D(HH:mm)), 상신 2일 이상이면 "D+N" 파스텔 주황, 기안자 소형 아바타,
 * 우측 "결재" → 앱 결재 상세. 결재 일정 토글과 무관하게 오늘 그룹 맨 위에 선다.
 */
export function PendingApprovalRow({
  event,
  onPress,
  last,
  today,
}: {
  event: TodoApprovalEvent;
  onPress?: () => void;
  last?: boolean;
  today: string;
}) {
  const { dark } = useTheme();
  const color = approvalEventColor(event);
  const age = pendingAgeDays(event.submittedAt, today);
  const context = [event.projectName, event.clientName && event.clientName !== event.projectName ? event.clientName : null, ...pendingContextParts(event)]
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={{ minHeight: 76, paddingVertical: 14, paddingLeft: 16, paddingRight: 12, backgroundColor: withAlpha(color, 0.12) }}
      className={`flex-row items-start gap-3 active:opacity-70 ${last ? '' : 'border-b border-cd-grid-line'}`}>
      <BoardStripe color={color} />
      <View style={{ marginTop: -1 }}>
        <KindCircle kind="pending" color={color} />
      </View>
      <View className="flex-1" style={{ minWidth: 0 }}>
        <View className="flex-row items-center gap-1.5">
          <PastelLabel label={TODO_APPROVAL_EVENT_LABELS.pending} tone="sky" bg={withAlpha(color, dark ? 0.35 : 0.6)} fg={dark ? '#e7eaf4' : '#1a47a8'} />
          <Text numberOfLines={1} className="flex-1 text-[14px] leading-[21px] text-cd-text">
            {event.title}
          </Text>
        </View>
        {context ? (
          <View className="mt-[5px] flex-row items-center gap-1.5">
            <ContextDot color={color} />
            <Text numberOfLines={1} className="flex-1 text-[12.5px] text-cd-muted">
              {context}
            </Text>
          </View>
        ) : null}
        <View className="mt-[7px] flex-row items-center gap-2">
          {event.drafterName ? (
            <View className="flex-row items-center gap-1">
              <MiniAvatar name={event.drafterName} photoUrl={event.drafterPhotoUrl} size={18} />
              <Text className="text-[12.5px] text-cd-muted">{event.drafterName}</Text>
            </View>
          ) : null}
          {age != null && age >= 2 ? <DueBadge label={`D+${age}`} tone="today" /> : null}
        </View>
      </View>
      {onPress ? (
        <Text className="text-[12.5px] font-medium text-cd-primary" style={{ marginTop: 3 }}>
          결재
        </Text>
      ) : null}
    </Pressable>
  );
}
