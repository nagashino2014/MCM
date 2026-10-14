import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Avatar, Button, ConfirmSheet, EmptyState, IconButton, Input, Screen, Sheet, SkeletonList, useToast } from '@/components/ui';
import { DatePickerSheet } from '@/components/calendar/DatePickerSheet';
import { OrgPickerSheet, type OrgEmployee } from '@/components/pickers/OrgPickerSheet';
import { MoveSheet } from '@/components/todo/BoardSections';
import { CompleteConfirmSheet, CompleteRulesChecks, asCompleteRulesFailure, type CompleteRulesFailure } from '@/components/todo/CompleteConfirmSheet';
import { LinkPickerSheet } from '@/components/todo/LinkPickerSheet';
import { BoardStripe, CheckCircle, DueBadge, MiniAvatar, PastelLabel, PriorityDot, SegBar } from '@/components/todo/parts';
import { apiJson } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { completeRulesSummary, hasAnyCompleteRule } from '@/lib/todo-completion';
import {
  TODO_ACTIVITY_ACTIONS,
  TODO_LINK_KIND_LABELS,
  TODO_PRIORITY_LABELS,
  TODO_RECURRENCE_PRESETS,
  TODO_SHARE_ROLE_LABELS,
  TODO_SNOOZE_PRESETS,
  TODO_STATUSES,
  TODO_STATUS_LABELS,
  TODO_WEEKDAY_CODES,
  type TodoActivity,
  type TodoBoard,
  type TodoComment,
  type TodoItem,
  type TodoItemDetail,
  type TodoPriority,
  type TodoShareRole,
  type TodoStatus,
} from '@/lib/todo-types';
import {
  computeDefaultRemindAt,
  describeRecurrence,
  dueBadge,
  fmtIsoShort,
  fmtMd,
  fmtMdWd,
  fmtRelative,
  labelColors,
  statusTone,
  todayLocal,
  withAlpha,
} from '@/lib/todo-utils';
import { useApi } from '@/lib/use-api';
import { useDirectorySnapshot } from '@/lib/use-directory-snapshot';
import { useTheme } from '@/theme/useTheme';

/**
 * 할 일 상세(§7.3 · v4 §19-6, 모바일판) — 헤더(보드 색 띠 + 제목 18px + 프로젝트 칩) 아래 **프레임 카드** 순서:
 * 핵심 4속성(상태·담당·수행 예정·마감) → 관련(용역·발주처 / 사업장 / 연결) → 메모 → 하위 작업(분절 진행바) →
 * 댓글(사진 아바타, 입력란 앞에 내 아바타) → 부가 설정(접힘 요약 = 라벨+값 3열 2행: 우선순위·알림·반복 / 보드·공유·스누즈) → 활동(접힘, 요약은 최근 2건 행마다).
 * 2026-10-14: 핵심 4속성 셀은 클릭 전에도 36px 테두리 박스(날짜가 비면 "YYYYMMDD" + 달력 아이콘, 시트가 열리면 primary 테두리), 메모 기본 높이 2배.
 * 보조 행동(메신저 공유·복제·삭제)은 헤더 ⋯ 시트. 필드마다 바로 저장(PATCH)하고 상단 부제에 저장 상태를 남긴다.
 *
 * - 제목·메모·시각은 로컬 버퍼(useState)에 두고 blur/유효값일 때만 커밋한다(AGENTS.md 규칙).
 * - 응답 { item } 으로 화면 상태를 통째로 바꾼다(서버가 열↔상태·알림 재계산을 한다).
 * - 헤더는 Screen 자체 헤더 — _layout 에서 옵션을 주지 않는다.
 */

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
const SAVE_LABEL: Record<SaveState, string> = {
  idle: '',
  saving: '저장 중…',
  saved: '저장됨 · 방금',
  error: '저장하지 못했습니다',
};

const ACTIVITY_LABEL: Record<(typeof TODO_ACTIVITY_ACTIONS)[number], string> = {
  create: '만듦',
  update: '수정',
  status: '상태 변경',
  assign: '담당 지정',
  due: '마감 변경',
  move: '열 이동',
  share: '공유',
  comment: '댓글',
  complete: '완료',
  reopen: '되돌림',
  snooze: '스누즈',
  archive: '보관',
};

const HHMM_OK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** HH:mm 마스킹 입력 — 로컬 버퍼, 유효값일 때만 커밋(FormField.TimeInput 과 같은 규칙). */
function TimeField({
  value,
  onCommit,
  disabled,
  compact,
}: {
  value: string;
  onCommit: (v: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [text, setText] = useState(value);
  // 외부 값이 바뀌면 버퍼를 맞춘다 — effect 대신 렌더 중 파생(setState-in-effect 경고 회피).
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setText(value);
  }
  return (
    <Input
      value={text}
      editable={!disabled}
      keyboardType="numeric"
      placeholder="HH:mm"
      className={compact ? 'min-h-[32px] px-2 py-1 text-[13px]' : 'min-h-[40px] py-2 text-[14px]'}
      onChangeText={(t: string) => {
        const d = t.replace(/[^\d]/g, '').slice(0, 4);
        const masked = d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
        setText(masked);
      }}
      onBlur={() => {
        if (text === '') {
          if (value !== '') onCommit('');
          return;
        }
        if (HHMM_OK.test(text)) {
          if (text !== value) onCommit(text);
        } else setText(value);
      }}
    />
  );
}

/** 선택형 필드 행 — 라벨 + 값 + ›. */
function PickRow({
  label,
  value,
  placeholder,
  onPress,
  onClear,
  disabled,
}: {
  label: string;
  value?: string | null;
  placeholder?: string;
  onPress?: () => void;
  onClear?: () => void;
  disabled?: boolean;
}) {
  const { c } = useTheme();
  return (
    <View className="flex-row items-center gap-2">
      {label ? <Text className="w-[64px] text-[13px] font-bold text-cd-muted">{label}</Text> : null}
      <Pressable
        onPress={onPress}
        disabled={disabled || !onPress}
        className="min-h-[40px] flex-1 flex-row items-center gap-2 rounded-lg border border-cd-border bg-cd-card px-3 active:opacity-70">
        <Text className={`flex-1 text-[14px] ${value ? 'text-cd-text' : 'text-cd-faint'}`} numberOfLines={1}>
          {value || placeholder || '선택'}
        </Text>
        {value && onClear && !disabled ? (
          <Pressable onPress={onClear} hitSlop={8} className="active:opacity-60">
            <Ionicons name="close-circle" size={16} color={c.faint} />
          </Pressable>
        ) : null}
        {onPress && !disabled ? <Ionicons name="chevron-forward" size={14} color={c.faint} /> : null}
      </Pressable>
    </View>
  );
}

/** 프레임 카드(§19-6) — 흰 면 + 1px 경계 + 8px 반경, 12/16 안쪽 여백, 머리글 12px/600 muted. */
function Frame({
  title,
  head,
  children,
  onToggle,
  open,
}: {
  title?: string;
  /** 머리글 제목 옆 보조(건수·진행바). */
  head?: React.ReactNode;
  children: React.ReactNode;
  /** 접이식 — 주면 머리글이 ▸/▾ 토글이 된다. */
  onToggle?: () => void;
  open?: boolean;
}) {
  const { c } = useTheme();
  const headRow = title ? (
    <View className="flex-row items-center gap-2">
      {onToggle ? <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={12} color={c.faint} /> : null}
      <Text className="text-[12px] font-semibold text-cd-muted">{title}</Text>
      {head}
    </View>
  ) : null;
  return (
    <View style={{ borderRadius: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14 }} className="gap-2.5 border border-cd-border bg-cd-card">
      {onToggle ? (
        <Pressable onPress={onToggle} className="active:opacity-70">
          {headRow}
        </Pressable>
      ) : (
        headRow
      )}
      {children}
    </View>
  );
}

/** 핵심 속성 셀 — 11.5px 라벨 + 값(탭 가능). */
/**
 * 핵심 셀 — 클릭 전에도 옅은 입력란(36px · 1px 경계 · 8px)으로 보인다(웹 .todo-kv-v 와 같은 톤). 시트가 열린 동안(active) 경계가 primary.
 * chevron=false 면 ▾ 를 붙이지 않는다(날짜 셀은 빈 상태에서 달력 아이콘을 children 으로 넣는다). trailing 은 박스 오른쪽 바깥(시각 입력).
 */
function KeyCell({
  label,
  onPress,
  disabled,
  active,
  chevron = true,
  trailing,
  children,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  active?: boolean;
  chevron?: boolean;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { c } = useTheme();
  const inner = (
    <View
      style={{ minHeight: 36, borderRadius: 8, borderWidth: 1, borderColor: active ? c.primary : c.border, paddingHorizontal: 10, paddingVertical: 4 }}
      className="flex-1 flex-row items-center gap-1.5 bg-cd-card">
      {children}
      {chevron && onPress && !disabled ? <Ionicons name="chevron-down" size={12} color={c.faint} style={{ marginLeft: 'auto' }} /> : null}
    </View>
  );
  return (
    <View style={{ width: '48%' }} className="gap-[3px]">
      <Text className="text-[11.5px] text-cd-faint">{label}</Text>
      <View className="flex-row items-center gap-1.5">
        {onPress ? (
          <Pressable onPress={onPress} disabled={disabled} className="flex-1 active:opacity-60">
            {inner}
          </Pressable>
        ) : (
          inner
        )}
        {trailing}
      </View>
    </View>
  );
}

/** 댓글 본문 — @이름 하이라이트. */
function MentionText({ body }: { body: string }) {
  const parts = body.split(/(@[^\s@#!,.:;'"()]+)/g);
  return (
    <Text className="text-[13.5px] leading-5 text-cd-text">
      {parts.map((p, i) =>
        p.startsWith('@') ? (
          <Text key={i} className="font-semibold text-cd-primary">
            {p}
          </Text>
        ) : (
          <Text key={i}>{p}</Text>
        )
      )}
    </Text>
  );
}

function activityLine(a: TodoActivity): string {
  const d = a.detail ?? {};
  switch (a.action) {
    case 'status':
      return `${TODO_STATUS_LABELS[String(d.from) as TodoStatus] ?? d.from ?? ''} → ${TODO_STATUS_LABELS[String(d.to) as TodoStatus] ?? d.to ?? ''}`;
    case 'move':
      return d.columnName ? `"${d.columnName}" 열로` : '';
    case 'share':
      return d.role ? TODO_SHARE_ROLE_LABELS[String(d.role) as TodoShareRole] ?? String(d.role) : d.chatRoomId ? '메신저로 공유' : '';
    case 'snooze':
      return d.until ? fmtIsoShort(String(d.until)) : '';
    default:
      return '';
  }
}

/** "10월 13일 (월)" — 핵심 속성의 날짜 표기. */
function fmtKDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const wd = ['일', '월', '화', '수', '목', '금', '토'][new Date(y, m - 1, d).getDay()];
  return `${m}월 ${d}일 (${wd})`;
}

interface ChatRoom {
  roomId: number;
  roomType: 'dm' | 'group';
  name: string;
  memberCount: number;
  peerPhotoPath: string | null;
}

export default function TodoDetailScreen() {
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const router = useRouter();
  const toast = useToast();
  const { c, dark } = useTheme();
  const { user } = useAuth();
  const me = user?.id ?? '';
  const today = todayLocal();

  const { data, loading, error, reload } = useApi<{ item: TodoItemDetail }>(`/api/todo/items/${itemId}`);
  const boardsApi = useApi<{ boards: TodoBoard[] }>('/api/todo/boards', { cache: true });
  const prefsApi = useApi<{ prefs: { defaultRemindAllDayTime: string; defaultRemindBeforeMin: number } }>('/api/todo/prefs', { cache: true });

  const [item, setItem] = useState<TodoItemDetail | null>(null);
  // 서버 응답이 새로 오면 화면 상태로 — 렌더 중 파생(마지막으로 받아들인 응답을 기억).
  const [accepted, setAccepted] = useState<TodoItemDetail | null>(null);
  if (data?.item && data.item !== accepted) {
    setAccepted(data.item);
    setItem(data.item);
  }

  const [save, setSave] = useState<SaveState>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mark = useCallback((s: SaveState) => {
    setSave(s);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (s === 'saved') saveTimer.current = setTimeout(() => setSave('idle'), 4000);
  }, []);

  /** 부분 수정 — 응답 item 으로 교체. 실패 시 입력은 보존하고 상태 문구만 바꾼다(메모는 React Compiler 에 맡긴다). */
  const patch = async (body: Record<string, unknown>) => {
    if (!item) return;
    mark('saving');
    try {
      const r = await apiJson<{ item: TodoItemDetail }>(`/api/todo/items/${item.itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setItem(r.item);
      mark('saved');
    } catch (e) {
      mark('error');
      toast.show((e as Error).message, 'error');
    }
  };

  const post = useCallback(
    async <T,>(path: string, body: unknown, method = 'POST'): Promise<T | null> => {
      mark('saving');
      try {
        const r = await apiJson<T>(path, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        mark('saved');
        return r;
      } catch (e) {
        mark('error');
        toast.show((e as Error).message, 'error');
        return null;
      }
    },
    [mark, toast]
  );

  // ── 로컬 버퍼(제목·메모) ──
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  // 서버 값이 바뀌면(저장 응답·재조회) 버퍼를 맞춘다 — 렌더 중 파생.
  const sig = item ? `${item.itemId} ${item.title} ${item.note ?? ''}` : '';
  const [bufSig, setBufSig] = useState('');
  if (sig !== bufSig) {
    setBufSig(sig);
    if (item) {
      setTitle(item.title);
      setNote(item.note ?? '');
    }
  }

  // ── 시트 상태 ──
  const [statusOpen, setStatusOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [doDateOpen, setDoDateOpen] = useState(false);
  const [dueOpen, setDueOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [recurOpen, setRecurOpen] = useState(false);
  const [personOpen, setPersonOpen] = useState(false);
  const [rolePick, setRolePick] = useState<OrgEmployee | null>(null);
  const [boardOpen, setBoardOpen] = useState(false);
  // 연결 추가·변경은 LinkPickerSheet(종류별 검색·목록)로 — 사용자는 개별 ID를 모른다.
  const [linkOpen, setLinkOpen] = useState(false);
  const [boardPick, setBoardPick] = useState<TodoBoard | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  // 완료 확인 시트(276) — 완료 조건이 있거나 서버가 409 로 거절했을 때
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmFailure, setConfirmFailure] = useState<CompleteRulesFailure | null>(null);
  const [completing, setCompleting] = useState(false);
  const [subTitle, setSubTitle] = useState('');
  const [comment, setComment] = useState('');
  const [sendingComment, setSendingComment] = useState(false);
  const [sendingChat, setSendingChat] = useState<number | null>(null);

  const org = useDirectorySnapshot(!personOpen && !assignOpen && !item);
  const rooms = useApi<{ rooms: ChatRoom[] }>('/api/chat/rooms', { skip: !chatOpen });
  // 댓글 입력란의 "나" 아바타 사진 — 새 API 없이: 주소록 스냅샷(/api/directory, userId+photoPath) → 상세 응답의 owner·담당·공유·댓글 중 내 userId.
  const myPhoto = useMemo(() => {
    const fromOrg = me ? (org?.employees.find((e) => e.userId === me)?.photoPath ?? null) : null;
    if (fromOrg) return fromOrg;
    if (!item || !me) return null;
    if (item.ownerUserId === me && item.ownerPhotoUrl) return item.ownerPhotoUrl;
    if (item.assigneeUserId === me && item.assigneePhotoUrl) return item.assigneePhotoUrl;
    return item.shares.find((s) => s.userId === me)?.photoUrl ?? item.comments.find((cm) => cm.userId === me)?.userPhotoUrl ?? null;
  }, [org, item, me]);

  const canEdit = !!item?.canEdit;
  const isOwner = !!item?.isOwner;
  const boards = useMemo(() => boardsApi.data?.boards ?? [], [boardsApi.data]);
  const board = useMemo(() => boards.find((b) => b.boardId === item?.boardId) ?? null, [boards, item?.boardId]);
  const column = board?.columns.find((col) => col.columnId === item?.columnId) ?? null;

  // ── 반복 프리셋을 현재 날짜 기준으로 채운다(weekly → do_date 요일, monthly → do_date 일). ──
  const recurrenceOptions = useMemo(() => {
    const base = item?.doDate ?? todayLocal();
    const [y, m, d] = base.split('-').map(Number);
    const wd = (new Date(y, m - 1, d).getDay() + 6) % 7;
    return TODO_RECURRENCE_PRESETS.map((p) => {
      let rule = p.rule;
      if (p.key === 'weekly') rule = `weekly:${TODO_WEEKDAY_CODES[wd]}`;
      if (p.key === 'monthly') rule = `monthly:${d}`;
      return { key: p.key, label: describeRecurrence(rule) ?? p.label, rule };
    });
  }, [item?.doDate]);

  // ── 완료/되돌리기(276) — 완료는 완료 조건이 있으면 시트 먼저, 없으면 즉시. 서버 409(code complete_rules)도 시트로. 되돌리기는 제한 없음. ──
  const completeFlow = async (done: boolean, completionNote?: string | null): Promise<boolean> => {
    if (!item || !canEdit || completing) return false;
    if (done && completionNote === undefined && hasAnyCompleteRule(item.completeRules)) {
      setConfirmFailure(null);
      setConfirmOpen(true);
      return false;
    }
    setCompleting(true);
    mark('saving');
    try {
      const r = await apiJson<{ item: TodoItemDetail }>(`/api/todo/items/${item.itemId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done, ...(completionNote !== undefined ? { completionNote } : {}) }),
      });
      setItem(r.item);
      mark('saved');
      setConfirmOpen(false);
      setConfirmFailure(null);
      toast.show(done ? '완료했습니다' : '되돌렸습니다', 'success');
      return true;
    } catch (e) {
      mark('error');
      const failure = asCompleteRulesFailure(e);
      if (failure) {
        setConfirmFailure(failure);
        setConfirmOpen(true);
        return false;
      }
      toast.show((e as Error).message, 'error');
      return false;
    } finally {
      setCompleting(false);
    }
  };

  // ── 하위 작업 ──
  const toggleSub = async (s: TodoItem) => {
    const r = await post<{ item: TodoItemDetail }>(`/api/todo/items/${s.itemId}/complete`, { done: s.status !== 'done' });
    if (r) void reload();
  };
  const addSub = async () => {
    const t = subTitle.trim();
    if (!t || !item) return;
    const r = await post<{ item: TodoItemDetail }>('/api/todo/items', { title: t, parentItemId: item.itemId });
    if (r) {
      setSubTitle('');
      void reload();
    }
  };

  // ── 댓글 ──
  const sendComment = async () => {
    const b = comment.trim();
    if (!b || !item || sendingComment) return;
    setSendingComment(true);
    const r = await post<{ comments: TodoComment[] }>(`/api/todo/items/${item.itemId}/comments`, { body: b });
    setSendingComment(false);
    if (r) {
      setComment('');
      setItem((p) => (p ? { ...p, comments: r.comments, commentCount: r.comments.length } : p));
    }
  };

  // ── 공유·담당 ──
  const share = async (emp: OrgEmployee, role: TodoShareRole) => {
    if (!item || !emp.userId) return;
    const r = await post<{ item: TodoItemDetail }>(`/api/todo/items/${item.itemId}/share`, { userId: emp.userId, role });
    if (r) setItem(r.item);
  };
  const unshare = async (userId: string) => {
    if (!item) return;
    const r = await post<{ item: TodoItemDetail | null }>(
      `/api/todo/items/${item.itemId}/share?userId=${encodeURIComponent(userId)}`,
      undefined,
      'DELETE'
    );
    if (r?.item) setItem(r.item);
    else if (r) void reload();
  };

  // ── 메신저 공유 · 복제 · 삭제 ──
  const sendChat = async (room: ChatRoom) => {
    if (!item || sendingChat) return;
    setSendingChat(room.roomId);
    const r = await post<{ messageId: number }>(`/api/todo/items/${item.itemId}/send-chat`, { roomId: room.roomId });
    setSendingChat(null);
    if (r) {
      setChatOpen(false);
      toast.show(`"${room.name}" 방에 보냈습니다`, 'success');
    }
  };
  /** 복제 — 웹 TodoDetailDrawer 와 같은 필드로 새 항목을 만들고 그 상세로 이동한다. */
  const duplicate = async () => {
    if (!item || duplicating) return;
    setDuplicating(true);
    const r = await post<{ item: TodoItemDetail }>('/api/todo/items', {
      title: `${item.title} (복사)`,
      note: item.note,
      priority: item.priority,
      doDate: item.doDate,
      doTime: item.doTime,
      durationMin: item.durationMin,
      dueDate: item.dueDate,
      recurrence: item.recurrence,
      linkKind: item.linkKind,
      linkId: item.linkId,
      linkLabel: item.linkLabel,
      color: item.color,
      boardId: item.boardId,
      columnId: item.columnId,
    });
    setDuplicating(false);
    if (r) {
      setActionsOpen(false);
      toast.show('복제했습니다', 'success');
      router.push({ pathname: '/todo/[itemId]', params: { itemId: r.item.itemId } });
    }
  };
  const remove = async () => {
    if (!item) return;
    setDeleting(true);
    const r = await post<{ ok: boolean }>(`/api/todo/items/${item.itemId}`, undefined, 'DELETE');
    setDeleting(false);
    if (r) {
      setDeleteOpen(false);
      toast.show('삭제했습니다', 'success');
      router.back();
    }
  };

  // ── 연결 열기(앱 라우트가 있는 종류만) ──
  const openLink = () => {
    if (!item?.linkKind || !item.linkId) return;
    if (item.linkKind === 'facility') router.push({ pathname: '/facility/[facilityId]', params: { facilityId: item.linkId } });
    else if (item.linkKind === 'approval_doc') router.push({ pathname: '/approval/[docId]', params: { docId: item.linkId } });
    else if (item.linkKind === 'url') void Linking.openURL(item.linkId);
  };
  const linkOpenable = item?.linkKind === 'facility' || item?.linkKind === 'approval_doc' || item?.linkKind === 'url';

  const remindLabel = !item
    ? ''
    : item.remindAt
      ? `${fmtIsoShort(item.remindAt)}${item.snoozedUntil ? ' · 스누즈' : ''}`
      : '끔';
  const defaultRemind = item ? computeDefaultRemindAt(item, prefsApi.data?.prefs) : null;
  const isDefaultRemind = !!item && item.remindAt === defaultRemind && !item.snoozedUntil;

  if (loading && !item) {
    return (
      <Screen title="할 일 상세" back>
        <SkeletonList />
      </Screen>
    );
  }
  if (!item) {
    return (
      <Screen title="할 일 상세" back>
        <EmptyState icon="alert-circle-outline" title="할 일을 불러오지 못했습니다" description={error ?? undefined} />
      </Screen>
    );
  }

  const subDone = item.subtasks.filter((s) => s.status === 'done').length;
  const subDoing = item.subtasks.filter((s) => s.status === 'doing' || s.status === 'review').length;
  const subPct = item.subtasks.length ? Math.round((subDone / item.subtasks.length) * 100) : 0;
  const due = dueBadge(item, today);
  const projectLabel = item.projectName ?? (item.boardKind !== 'personal' ? item.boardName : null);
  const boardLabel = board ? `${board.isDefault ? '개인' : board.name}${column ? ` › ${column.name}` : ''}` : item.boardId ? '(보드)' : '없음';
  const shareSummary = item.shares.length
    ? item.shares.map((s) => `${s.name}(${TODO_SHARE_ROLE_LABELS[s.role].replace(/\(.*\)/, '')})`).join(', ')
    : '없음';
  // 부가 설정 접힘 요약(2026-10-14) — 라벨+값 세로 쌍 3열 2행: 우선순위·알림·반복 / 보드·공유·스누즈(값이 없으면 faint).
  const extraSummary: [string, string, boolean][] = [
    ['우선순위', TODO_PRIORITY_LABELS[item.priority], false],
    ['알림', remindLabel, !item.remindAt],
    ['반복', describeRecurrence(item.recurrence) ?? '없음', !item.recurrence],
    ['보드', boardLabel, false],
    ['공유', shareSummary, !item.shares.length],
    ['스누즈', item.snoozedUntil ? `${fmtIsoShort(item.snoozedUntil)}까지` : '없음', !item.snoozedUntil],
    // 완료 조건(276)은 설정된 것만 요약에 보인다.
    ...(completeRulesSummary(item.completeRules) ? ([['완료 조건', completeRulesSummary(item.completeRules) as string, false]] as [string, string, boolean][]) : []),
  ];
  const hasRelated = !!(item.projectName || item.clientName || item.linkKind);
  const statusCol = labelColors(statusTone(item.status), dark);
  const subChip = (s: TodoStatus) =>
    s === 'done' ? <PastelLabel label="완료" tone="sage" /> : s === 'doing' || s === 'review' ? <PastelLabel label={TODO_STATUS_LABELS[s]} tone="sky" /> : null;

  return (
    <Screen
      title="할 일 상세"
      subtitle={SAVE_LABEL[save] || (canEdit ? '바로 저장됩니다' : '열람 전용')}
      back
      scroll={false}
      padded={false}
      right={
        <View className="flex-row items-center">
          <IconButton
            icon={item.status === 'done' ? 'checkmark-circle' : 'checkmark-circle-outline'}
            color={item.status === 'done' ? c.primary : c.muted}
            onPress={() => void completeFlow(item.status !== 'done')}
          />
          <IconButton icon="ellipsis-horizontal" onPress={() => setActionsOpen(true)} />
        </View>
      }>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
        <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 24, gap: 12 }} keyboardShouldPersistTaps="handled">
          {/* 헤더 — 보드 색 띠 + 제목 + 프로젝트 칩 */}
          <View style={{ borderRadius: 8, paddingLeft: 18, paddingRight: 14, paddingVertical: 14 }} className="overflow-hidden border border-cd-border bg-cd-card">
            <BoardStripe color={item.boardColor} width={5} inset={0} />
            <TextInput
              value={title}
              editable={canEdit}
              onChangeText={setTitle}
              onBlur={() => {
                const t = title.trim();
                if (!t) setTitle(item.title);
                else if (t !== item.title) void patch({ title: t });
              }}
              placeholder="제목"
              placeholderTextColor={c.faint}
              multiline
              className={`text-[18px] font-semibold leading-[25px] ${item.status === 'done' ? 'text-cd-muted line-through' : 'text-cd-text'}`}
            />
            {projectLabel ? (
              <View className="mt-1.5 flex-row">
                <View style={{ backgroundColor: withAlpha(item.boardColor, dark ? 0.3 : 0.45), borderRadius: 5, paddingHorizontal: 8, paddingVertical: 2 }}>
                  <Text numberOfLines={1} className="text-[12px] font-medium text-cd-body">
                    {projectLabel}
                  </Text>
                </View>
              </View>
            ) : null}
          </View>

          {/* 완료됨 줄(276) — 완료 시각 · 되돌리기 · 완료 메모 */}
          {item.status === 'done' ? (
            <View style={{ borderRadius: 8, backgroundColor: labelColors('sage', dark).bg }} className="gap-1 border border-cd-border px-3.5 py-2.5">
              <View className="flex-row flex-wrap items-center gap-1.5">
                <Ionicons name="checkmark-circle" size={15} color={labelColors('sage', dark).fg} />
                <Text style={{ color: labelColors('sage', dark).fg }} className="text-[13px] font-semibold">
                  완료됨
                </Text>
                {item.completedAt ? <Text className="text-[13px] text-cd-muted">· {fmtIsoShort(item.completedAt)}</Text> : null}
                {item.archivedAt ? <Text className="text-[12px] text-cd-faint">· 보관됨</Text> : null}
                {canEdit ? (
                  <>
                    <Text className="text-[13px] text-cd-muted">·</Text>
                    <Pressable onPress={() => void completeFlow(false)} disabled={completing} hitSlop={8} className="active:opacity-60">
                      <Text className="text-[13px] font-semibold text-cd-primary">되돌리기</Text>
                    </Pressable>
                  </>
                ) : null}
              </View>
              {item.completionNote ? <Text className="text-[12.5px] leading-[18px] text-cd-text">{item.completionNote}</Text> : null}
            </View>
          ) : null}

          {/* 핵심 4속성 */}
          <Frame>
            <View className="flex-row flex-wrap justify-between gap-y-2.5">
              <KeyCell label="상태" onPress={() => setStatusOpen(true)} disabled={!canEdit} active={statusOpen}>
                <View style={{ backgroundColor: statusCol.bg, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 2 }}>
                  <Text style={{ fontSize: 13, fontWeight: '500', color: statusCol.fg }}>{TODO_STATUS_LABELS[item.status]}</Text>
                </View>
              </KeyCell>
              <KeyCell label="담당" onPress={() => setAssignOpen(true)} disabled={!canEdit} active={assignOpen}>
                {item.assigneeName ? (
                  <>
                    <MiniAvatar name={item.assigneeName} photoUrl={item.assigneePhotoUrl} size={20} />
                    <Text numberOfLines={1} className="shrink text-[14px] text-cd-text">
                      {item.assigneeName}
                    </Text>
                  </>
                ) : (
                  <Text className="text-[14px] text-cd-faint">담당 없음</Text>
                )}
              </KeyCell>
              <KeyCell
                label="수행 예정"
                onPress={() => setDoDateOpen(true)}
                disabled={!canEdit}
                active={doDateOpen}
                chevron={false}
                trailing={
                  <View style={{ width: 66 }}>
                    <TimeField compact value={item.doTime ?? ''} disabled={!canEdit || !item.doDate} onCommit={(v) => void patch({ doTime: v || null })} />
                  </View>
                }>
                {item.doDate ? (
                  <Text numberOfLines={1} className="shrink text-[14px] text-cd-text">
                    {fmtMdWd(item.doDate)}
                  </Text>
                ) : (
                  <>
                    <Text className="text-[14px] text-cd-muted">YYYYMMDD</Text>
                    <Ionicons name="calendar-outline" size={14} color={c.muted} style={{ marginLeft: 'auto' }} />
                  </>
                )}
              </KeyCell>
              <KeyCell label="마감" onPress={() => setDueOpen(true)} disabled={!canEdit} active={dueOpen} chevron={false}>
                {item.dueDate ? (
                  <>
                    <Text numberOfLines={1} className="shrink text-[14px] text-cd-text">
                      {fmtKDate(item.dueDate)}
                    </Text>
                    {due && due.tone !== 'neutral' ? <DueBadge label={due.label} tone={due.tone} /> : null}
                  </>
                ) : (
                  <>
                    <Text className="text-[14px] text-cd-muted">YYYYMMDD</Text>
                    <Ionicons name="calendar-outline" size={14} color={c.muted} style={{ marginLeft: 'auto' }} />
                  </>
                )}
              </KeyCell>
            </View>
            {canEdit && (item.doDate || item.dueDate) ? (
              <View className="flex-row gap-1.5">
                {item.doDate ? <Button label="예정 지우기" size="sm" variant="ghost" onPress={() => void patch({ doDate: null, doTime: null })} /> : null}
                {item.dueDate ? <Button label="마감 지우기" size="sm" variant="ghost" onPress={() => void patch({ dueDate: null })} /> : null}
              </View>
            ) : null}
          </Frame>

          {/* 관련 — 용역·발주처 / 사업장 / 연결 (편집 가능하면 연결이 없어도 추가 버튼을 둔다) */}
          {hasRelated || canEdit ? (
            <Frame title="관련">
              <View className="gap-2">
                {item.projectName || item.clientName ? (
                  <View className="flex-row items-center gap-2.5">
                    <View className="h-7 w-7 items-center justify-center rounded-md bg-cd-surface">
                      <Ionicons name="document-text-outline" size={15} color={c.muted} />
                    </View>
                    <View className="flex-1" style={{ minWidth: 0 }}>
                      <Text className="text-[11.5px] text-cd-faint">용역{item.contractId ? ' · 계약' : ''}</Text>
                      <Text numberOfLines={1} className="text-[13.5px] font-medium text-cd-text">
                        {[item.projectName, item.clientName ? `발주처 ${item.clientName}` : null].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    {item.contractId ? <Text className="text-[11px] text-cd-faint">웹에서 열기</Text> : null}
                  </View>
                ) : null}
                {item.linkKind ? (
                  <Pressable onPress={openLink} disabled={!linkOpenable} className="flex-row items-center gap-2.5 active:opacity-70">
                    <View className="h-7 w-7 items-center justify-center rounded-md bg-cd-surface">
                      <Ionicons name={item.linkKind === 'facility' ? 'business-outline' : 'link-outline'} size={15} color={c.muted} />
                    </View>
                    <View className="flex-1" style={{ minWidth: 0 }}>
                      <Text className="text-[11.5px] text-cd-faint">{TODO_LINK_KIND_LABELS[item.linkKind]}</Text>
                      <Text numberOfLines={1} className="text-[13.5px] font-medium text-cd-text">
                        {item.linkLabel ?? item.linkId ?? ''}
                      </Text>
                    </View>
                    {linkOpenable ? (
                      <Text className="text-[12.5px] text-cd-primary">{item.linkKind === 'facility' ? '사업장 열기' : '열기'}</Text>
                    ) : (
                      <Text className="text-[11px] text-cd-faint">웹에서 열기</Text>
                    )}
                  </Pressable>
                ) : null}
                {canEdit ? (
                  <View className="flex-row flex-wrap gap-1.5">
                    <Button
                      label={item.linkKind ? '연결 변경' : '+ 계약·사업장·결재·영업·업무추진계획·링크 연결'}
                      size="sm"
                      variant="ghost"
                      onPress={() => setLinkOpen(true)}
                    />
                    {item.linkKind ? (
                      <Button label="연결 해제" size="sm" variant="ghost" onPress={() => void patch({ linkKind: null, linkId: null, linkLabel: null })} />
                    ) : null}
                  </View>
                ) : null}
              </View>
            </Frame>
          ) : null}

          {/* 메모 */}
          <Frame title="메모">
            <TextInput
              value={note}
              editable={canEdit}
              onChangeText={setNote}
              onBlur={() => {
                if ((note.trim() || null) !== (item.note ?? null)) void patch({ note: note.trim() || null });
              }}
              placeholder={canEdit ? '메모를 적으면 자동 저장됩니다' : '메모 없음'}
              placeholderTextColor={c.faint}
              multiline
              textAlignVertical="top"
              style={{ minHeight: 96 }} /* 2026-10-14 사용자: 기본 높이 2배(48→96), 자동 늘어남 유지 */
              className="text-[14px] leading-[23px] text-cd-text"
            />
          </Frame>

          {/* 하위 작업 */}
          <Frame
            title="하위 작업"
            head={
              item.subtasks.length ? (
                <>
                  <Text className="text-[12px] text-cd-faint">
                    {subDone}/{item.subtasks.length} · {subPct}%
                  </Text>
                  <SegBar done={subDone} doing={subDoing} total={item.subtasks.length} segW={18} />
                </>
              ) : null
            }>
            <View>
              {item.subtasks.map((s) => (
                <View key={s.itemId} className="min-h-[34px] flex-row items-center gap-2.5">
                  <CheckCircle done={s.status === 'done'} disabled={!s.canEdit} onPress={() => void toggleSub(s)} size={18} />
                  <Text numberOfLines={1} className={`flex-1 text-[13.5px] ${s.status === 'done' ? 'text-cd-faint line-through' : 'text-cd-text'}`}>
                    {s.title}
                  </Text>
                  {subChip(s.status)}
                  {s.dueDate ? (
                    <Text className="text-[11.5px] text-cd-faint">{s.dueDate === today ? '오늘' : fmtMd(s.dueDate)}</Text>
                  ) : s.assigneeName ? (
                    <Text className="text-[11.5px] text-cd-faint">{s.assigneeName}</Text>
                  ) : null}
                </View>
              ))}
              {canEdit ? (
                <View className="min-h-[34px] flex-row items-center gap-2.5">
                  <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.faint }} />
                  <TextInput
                    value={subTitle}
                    onChangeText={setSubTitle}
                    onSubmitEditing={() => void addSub()}
                    placeholder="하위 작업 추가"
                    placeholderTextColor={c.faint}
                    returnKeyType="done"
                    blurOnSubmit={false}
                    className="h-8 flex-1 text-[13.5px] text-cd-text"
                  />
                  {subTitle.trim() ? (
                    <Pressable onPress={() => void addSub()} hitSlop={8} className="active:opacity-60">
                      <Text className="text-[13px] font-semibold text-cd-primary">추가</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : !item.subtasks.length ? (
                <Text className="text-[13px] text-cd-faint">하위 작업이 없습니다.</Text>
              ) : null}
            </View>
          </Frame>

          {/* 댓글 */}
          <Frame title="댓글" head={item.comments.length ? <Text className="text-[12px] text-cd-faint">{item.comments.length}</Text> : null}>
            {item.comments.length ? (
              <View className="gap-3">
                {item.comments.map((cm) => (
                  <View key={cm.commentId} className="flex-row gap-2.5">
                    <MiniAvatar name={cm.userName} photoUrl={cm.userPhotoUrl} size={28} />
                    <View className="flex-1 gap-0.5">
                      <View className="flex-row items-center gap-1.5">
                        <Text className="text-[12px] font-semibold text-cd-text">{cm.userName ?? '-'}</Text>
                        <Text className="text-[12px] text-cd-faint">{fmtRelative(cm.createdAt)}</Text>
                      </View>
                      <MentionText body={cm.body} />
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <Text className="text-[13px] text-cd-faint">아직 댓글이 없습니다. 공유받은 담당·참조자에게 댓글 알림이 갑니다.</Text>
            )}
            {/* 입력 행 — 댓글 행과 같은 배치(내 아바타 28px + 입력). @이름 멘션 파싱·푸시는 그대로(안내 문구만 제거). */}
            <View className="flex-row items-start gap-2.5">
              <View style={{ marginTop: 4 }}>
                <MiniAvatar name={user?.name} photoUrl={myPhoto} size={28} />
              </View>
              <TextInput
                value={comment}
                onChangeText={setComment}
                placeholder="댓글 쓰기"
                placeholderTextColor={c.faint}
                multiline
                className="max-h-[120px] min-h-[36px] flex-1 rounded-lg border border-cd-border bg-cd-bg px-3 py-2 text-[13px] text-cd-text"
              />
              <Pressable
                onPress={() => void sendComment()}
                disabled={!comment.trim() || sendingComment}
                className="h-9 w-9 items-center justify-center rounded-lg active:opacity-70"
                style={{ backgroundColor: comment.trim() ? c.primary : c.border, alignSelf: 'flex-end' }}>
                {sendingComment ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="arrow-up" size={18} color="#fff" />}
              </Pressable>
            </View>
          </Frame>

          {/* 부가 설정(접힘 — 한 줄 요약) */}
          <Frame title="부가 설정" onToggle={() => setExtraOpen((v) => !v)} open={extraOpen}>
            {!extraOpen ? (
              // 3열 2행 — 셀 flexBasis 28% + 열 간격 20 으로 한 행에 3개(행 간격 10). 긴 값(공유)은 한 줄 말줄임.
              <View className="flex-row flex-wrap" style={{ rowGap: 10, columnGap: 20 }}>
                {extraSummary.map(([lb, v, none]) => (
                  <View key={lb} style={{ flexBasis: '28%', flexGrow: 1, minWidth: 0 }} className="gap-0.5">
                    <Text className="text-[11.5px] text-cd-muted">{lb}</Text>
                    <Text numberOfLines={1} className={`text-[13px] ${none ? 'text-cd-faint' : 'text-cd-text'}`}>
                      {v}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <View className="gap-3">
                <View className="flex-row flex-wrap items-center gap-1.5">
                  <Text className="mr-1 w-[56px] text-[13px] font-bold text-cd-muted">우선순위</Text>
                  {([0, 1, 2, 3] as TodoPriority[]).map((p) => {
                    const active = item.priority === p;
                    return (
                      <Pressable
                        key={p}
                        disabled={!canEdit || active}
                        onPress={() => void patch({ priority: p })}
                        className={`h-8 flex-row items-center gap-1.5 rounded-lg border px-2.5 active:opacity-70 ${
                          active ? 'border-cd-primary bg-cd-primary-soft' : 'border-cd-border bg-cd-card'
                        }`}>
                        <PriorityDot priority={p} />
                        <Text className={`text-[12px] ${active ? 'font-semibold text-cd-primary' : 'text-cd-muted'}`}>{TODO_PRIORITY_LABELS[p]}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <View className="flex-row items-center gap-2">
                  <Text className="w-[64px] text-[13px] font-bold text-cd-muted">알림</Text>
                  <Text className="flex-1 text-[14px] text-cd-text" numberOfLines={1}>
                    {remindLabel}
                    {isDefaultRemind ? <Text className="text-cd-faint"> · 기본</Text> : null}
                  </Text>
                </View>
                {canEdit ? (
                  <View className="flex-row gap-1.5 pl-[72px]">
                    <Button label="기본" size="sm" variant={isDefaultRemind ? 'soft' : 'ghost'} disabled={!defaultRemind || isDefaultRemind} onPress={() => void patch({ remindAt: defaultRemind })} />
                    <Button label="끔" size="sm" variant={!item.remindAt ? 'soft' : 'ghost'} disabled={!item.remindAt} onPress={() => void patch({ remindAt: null })} />
                    <Button label="스누즈" size="sm" variant="ghost" icon="alarm-outline" onPress={() => setSnoozeOpen(true)} />
                  </View>
                ) : null}
                <PickRow
                  label="반복"
                  value={describeRecurrence(item.recurrence)}
                  placeholder="반복 없음"
                  onPress={() => setRecurOpen(true)}
                  onClear={() => void patch({ recurrence: null })}
                  disabled={!canEdit}
                />
                <PickRow
                  label="보드·열"
                  value={boardLabel}
                  onPress={() => {
                    setBoardPick(board);
                    setBoardOpen(true);
                  }}
                  disabled={!canEdit}
                />
                {!item.parentItemId ? (
                  <View className="flex-row items-start gap-2">
                    <Text className="w-[64px] pt-0.5 text-[13px] font-bold text-cd-muted">완료 조건</Text>
                    <View className="flex-1">
                      <CompleteRulesChecks value={item.completeRules} disabled={!canEdit} onChange={(next) => void patch({ completeRules: next })} />
                    </View>
                  </View>
                ) : null}
                <View className="flex-row items-start gap-2">
                  <Text className="w-[64px] pt-2 text-[13px] font-bold text-cd-muted">공유</Text>
                  <View className="flex-1 flex-row flex-wrap gap-1.5">
                    {item.shares.map((s) => (
                      <View key={s.userId} className="h-8 flex-row items-center gap-1.5 rounded-lg border border-cd-border bg-cd-card pl-1 pr-1.5">
                        <MiniAvatar name={s.name} photoUrl={s.photoUrl} size={20} />
                        <Text className="text-[12px] text-cd-text">{s.name}</Text>
                        <Text className="text-[10px] text-cd-faint">{TODO_SHARE_ROLE_LABELS[s.role].replace(/\(.*\)/, '')}</Text>
                        {isOwner || s.userId === me ? (
                          <Pressable hitSlop={6} onPress={() => void unshare(s.userId)} className="active:opacity-60">
                            <Ionicons name="close" size={14} color={c.faint} />
                          </Pressable>
                        ) : null}
                      </View>
                    ))}
                    {canEdit ? (
                      <Pressable
                        onPress={() => setPersonOpen(true)}
                        className="h-8 flex-row items-center gap-1 rounded-lg border border-dashed border-cd-border px-2.5 active:opacity-70">
                        <Ionicons name="person-add-outline" size={13} color={c.primary} />
                        <Text className="text-[12px] text-cd-primary">사람 추가</Text>
                      </Pressable>
                    ) : null}
                    {!item.shares.length && !canEdit ? <Text className="pt-2 text-[13px] text-cd-faint">공유 없음</Text> : null}
                  </View>
                </View>
              </View>
            )}
          </Frame>

          {/* 활동(접힘) */}
          <Frame title="활동" head={<Text className="text-[12px] text-cd-faint">{item.activity.length}</Text>} onToggle={() => setLogOpen((v) => !v)} open={logOpen}>
            {logOpen ? (
              <View>
                {item.activity.slice(0, 30).map((a) => (
                  <View key={a.activityId} className="flex-row items-center gap-2 py-1.5">
                    <Text className="flex-1 text-[12.5px] text-cd-body" numberOfLines={1}>
                      <Text className="font-semibold">{a.userName ?? '시스템'}</Text> · {ACTIVITY_LABEL[a.action] ?? a.action}
                      {activityLine(a) ? <Text className="text-cd-muted"> · {activityLine(a)}</Text> : null}
                    </Text>
                    <Text className="text-[11px] text-cd-faint">{fmtRelative(a.createdAt)}</Text>
                  </View>
                ))}
              </View>
            ) : item.activity.length ? (
              // 접힘 요약 — 최근 2건을 행마다 줄바꿈(시각 72px 고정 열 muted + 내용). 펼치면 전체.
              <View>
                {item.activity.slice(0, 2).map((a) => (
                  <View key={a.activityId} className="flex-row items-center gap-2.5 py-0.5">
                    <Text className="w-[72px] text-[12px] text-cd-muted" numberOfLines={1}>
                      {fmtRelative(a.createdAt)}
                    </Text>
                    <Text className="flex-1 text-[12px] text-cd-faint" numberOfLines={1}>
                      {a.userName ?? '시스템'} · {ACTIVITY_LABEL[a.action] ?? a.action}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text className="text-[12.5px] text-cd-faint">기록 없음</Text>
            )}
          </Frame>
          <Text className="px-1 text-[11px] text-cd-faint">
            만든 사람 {item.ownerName ?? '-'} · {fmtIsoShort(item.createdAt)}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── 시트들 ── */}
      {/* 완료 확인(276) — 완료 조건이 있거나 서버가 거절했을 때 */}
      <CompleteConfirmSheet
        visible={confirmOpen}
        target={item}
        failure={confirmFailure}
        busy={completing}
        onConfirm={(note) => void completeFlow(true, note)}
        onClose={() => {
          if (completing) return;
          setConfirmOpen(false);
          setConfirmFailure(null);
        }}
      />

      <MoveSheet
        visible={statusOpen}
        title="상태"
        onClose={() => setStatusOpen(false)}
        onPick={(k) => {
          setStatusOpen(false);
          if (k === item.status) return;
          // 완료는 체크와 같은 경로(완료 조건 시트), 그 외는 PATCH
          if (k === 'done') void completeFlow(true);
          else void patch({ status: k });
        }}
        options={TODO_STATUSES.map((s) => ({
          key: s,
          label: TODO_STATUS_LABELS[s],
          tone: statusTone(s),
          current: item.status === s,
          sub: item.status === s ? '현재' : s === 'review' ? '담당·참조자에게 알림' : undefined,
        }))}
      />

      <DatePickerSheet
        visible={doDateOpen}
        title="수행 예정"
        value={item.doDate}
        onConfirm={(d) => void patch({ doDate: d })}
        onClose={() => setDoDateOpen(false)}
      />
      <DatePickerSheet
        visible={dueOpen}
        title="마감"
        value={item.dueDate}
        onConfirm={(d) => void patch({ dueDate: d })}
        onClose={() => setDueOpen(false)}
      />

      <Sheet visible={snoozeOpen} onClose={() => setSnoozeOpen(false)} title="스누즈">
        <View className="gap-2">
          {TODO_SNOOZE_PRESETS.map((p) => (
            <Pressable
              key={p.key}
              onPress={async () => {
                setSnoozeOpen(false);
                const r = await post<{ item: TodoItemDetail }>(`/api/todo/items/${item.itemId}/snooze`, { preset: p.key });
                if (r) setItem(r.item);
              }}
              className="h-12 flex-row items-center gap-2.5 rounded-lg border border-cd-border bg-cd-card px-3 active:opacity-70">
              <Ionicons name="alarm-outline" size={16} color={c.primary} />
              <Text className="text-[14px] text-cd-text">{p.label}</Text>
            </Pressable>
          ))}
        </View>
      </Sheet>

      <Sheet visible={recurOpen} onClose={() => setRecurOpen(false)} title="반복">
        <View className="gap-2">
          {[{ key: 'none', label: '반복 없음', rule: '' }, ...recurrenceOptions].map((o) => {
            const cur = (item.recurrence ?? '') === o.rule;
            return (
              <Pressable
                key={o.key}
                onPress={() => {
                  setRecurOpen(false);
                  if (!cur) void patch({ recurrence: o.rule || null });
                }}
                className={`h-12 flex-row items-center gap-2.5 rounded-lg border px-3 active:opacity-70 ${cur ? 'border-cd-primary bg-cd-primary-soft' : 'border-cd-border bg-cd-card'}`}>
                <Text className={`flex-1 text-[14px] ${cur ? 'font-semibold text-cd-primary' : 'text-cd-text'}`}>{o.label}</Text>
                {cur ? <Ionicons name="checkmark" size={16} color={c.primary} /> : null}
              </Pressable>
            );
          })}
          <Text className="pt-1 text-[11px] text-cd-faint">완료할 때 다음 발생 1건이 새로 만들어집니다.</Text>
        </View>
      </Sheet>

      {/* 담당 지정 — 핵심 속성의 "담당" */}
      <OrgPickerSheet
        visible={assignOpen}
        title="담당 지정"
        hint="담당은 1명이며 편집할 수 있습니다. 바꾸면 이전 담당은 협업자로 남습니다."
        snapshot={org}
        selectedIds={[]}
        onSelect={(emp) => {
          if (!emp.userId) {
            toast.show('계정이 없는 직원은 담당으로 지정할 수 없습니다.', 'error');
            return;
          }
          setAssignOpen(false);
          void share(emp, 'assignee');
        }}
        onClose={() => setAssignOpen(false)}
      />
      <OrgPickerSheet
        visible={personOpen}
        title="담당·공유할 사람"
        hint="담당은 1명이며 편집할 수 있습니다. 협업자는 편집, 참조자는 열람·댓글만."
        snapshot={org}
        selectedIds={[]}
        onSelect={(emp) => {
          if (!emp.userId) {
            toast.show('계정이 없는 직원은 공유할 수 없습니다.', 'error');
            return;
          }
          setRolePick(emp);
        }}
        onClose={() => setPersonOpen(false)}
      />
      <Sheet visible={!!rolePick} onClose={() => setRolePick(null)} title={rolePick ? `${rolePick.name} · 역할` : '역할'}>
        <View className="gap-2">
          {(['assignee', 'collaborator', 'watcher'] as TodoShareRole[]).map((r) => (
            <Pressable
              key={r}
              onPress={() => {
                const emp = rolePick;
                setRolePick(null);
                if (emp) void share(emp, r);
              }}
              className="h-12 flex-row items-center gap-2.5 rounded-lg border border-cd-border bg-cd-card px-3 active:opacity-70">
              <Ionicons name={r === 'assignee' ? 'person' : r === 'collaborator' ? 'create-outline' : 'eye-outline'} size={16} color={c.primary} />
              <Text className="text-[14px] text-cd-text">{TODO_SHARE_ROLE_LABELS[r]}</Text>
            </Pressable>
          ))}
        </View>
      </Sheet>

      <Sheet visible={boardOpen} onClose={() => setBoardOpen(false)} title="보드·열" fillHeight={0.6}>
        <ScrollView className="flex-1" contentContainerStyle={{ gap: 8 }}>
          <Text className="text-[12px] text-cd-muted">보드</Text>
          {boards.map((b) => {
            const cur = boardPick?.boardId === b.boardId;
            return (
              <Pressable
                key={b.boardId}
                onPress={() => setBoardPick(b)}
                className={`h-11 flex-row items-center gap-2 rounded-lg border px-3 active:opacity-70 ${cur ? 'border-cd-primary bg-cd-primary-soft' : 'border-cd-border bg-cd-card'}`}>
                <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: b.colorHex }} />
                <Text className={`flex-1 text-[14px] ${cur ? 'font-semibold text-cd-primary' : 'text-cd-text'}`}>{b.isDefault ? '개인' : b.name}</Text>
                {b.kind !== 'personal' ? <Text className="text-[11px] text-cd-faint">멤버 {b.memberCount + 1}명</Text> : null}
              </Pressable>
            );
          })}
          {boardPick && boardPick.boardId !== item.boardId ? (
            <Text className="text-[11px] text-cd-warning">
              이동하면 {boardPick.kind === 'personal' ? '그 보드' : `보드 멤버 ${boardPick.memberCount + 1}명`}에게 보입니다.
            </Text>
          ) : null}
          <Text className="pt-2 text-[12px] text-cd-muted">열</Text>
          {(boardPick?.columns ?? []).map((col) => {
            const cur = boardPick?.boardId === item.boardId && item.columnId === col.columnId;
            return (
              <Pressable
                key={col.columnId}
                disabled={cur}
                onPress={() => {
                  setBoardOpen(false);
                  void patch(boardPick && boardPick.boardId !== item.boardId ? { boardId: boardPick.boardId, columnId: col.columnId } : { columnId: col.columnId });
                }}
                className={`h-11 flex-row items-center gap-2.5 rounded-lg border px-3 active:opacity-70 ${cur ? 'border-cd-primary bg-cd-primary-soft' : 'border-cd-border bg-cd-card'}`}>
                <PastelLabel label={col.name} tone={statusTone(col.statusMap)} size={12.5} bold />
                <View className="flex-1" />
                {cur ? <Text className="text-[12px] text-cd-muted">현재</Text> : null}
              </Pressable>
            );
          })}
          {boardPick && !boardPick.columns.length ? <Text className="text-[12px] text-cd-faint">이 보드에는 열이 없습니다.</Text> : null}
        </ScrollView>
      </Sheet>

      {/* 연결 선택 */}
      <LinkPickerSheet
        visible={linkOpen}
        initialKind={item.linkKind}
        onPick={(pick) => {
          setLinkOpen(false);
          void patch({ linkKind: pick.linkKind, linkId: pick.linkId, linkLabel: pick.linkLabel });
        }}
        onClose={() => setLinkOpen(false)}
      />

      {/* ⋯ 보조 행동 */}
      <Sheet visible={actionsOpen} onClose={() => setActionsOpen(false)} title="더 보기">
        <View className="gap-2">
          <Pressable
            onPress={() => {
              setActionsOpen(false);
              setChatOpen(true);
            }}
            className="h-12 flex-row items-center gap-2.5 rounded-lg border border-cd-border bg-cd-card px-3 active:opacity-70">
            <Ionicons name="chatbubble-outline" size={16} color={c.primary} />
            <Text className="text-[14px] text-cd-text">메신저로 공유</Text>
          </Pressable>
          <Pressable
            onPress={() => void duplicate()}
            disabled={duplicating}
            className="h-12 flex-row items-center gap-2.5 rounded-lg border border-cd-border bg-cd-card px-3 active:opacity-70">
            <Ionicons name="copy-outline" size={16} color={c.primary} />
            <Text className="text-[14px] text-cd-text">복제</Text>
            {duplicating ? <ActivityIndicator size="small" /> : null}
          </Pressable>
          {isOwner ? (
            <Pressable
              onPress={() => {
                setActionsOpen(false);
                setDeleteOpen(true);
              }}
              className="h-12 flex-row items-center gap-2.5 rounded-lg border border-cd-border bg-cd-card px-3 active:opacity-70">
              <Ionicons name="trash-outline" size={16} color={c.error} />
              <Text className="text-[14px] text-cd-error">삭제</Text>
            </Pressable>
          ) : null}
        </View>
      </Sheet>

      <Sheet visible={chatOpen} onClose={() => (sendingChat ? undefined : setChatOpen(false))} title="메신저로 공유" fillHeight={0.6}>
        {rooms.loading && !rooms.data ? (
          <SkeletonList count={3} />
        ) : !rooms.data?.rooms?.length ? (
          <EmptyState icon="chatbubbles-outline" title="대화방이 없습니다" />
        ) : (
          <ScrollView className="flex-1">
            {rooms.data.rooms.map((r) => (
              <Pressable
                key={r.roomId}
                onPress={() => void sendChat(r)}
                disabled={sendingChat != null}
                className="min-h-[52px] flex-row items-center gap-3 border-b border-cd-grid-line py-2 active:opacity-70">
                <Avatar name={r.name} photoPath={r.peerPhotoPath} size="sm" />
                <View className="flex-1">
                  <Text className="text-[14px] font-semibold text-cd-text" numberOfLines={1}>
                    {r.name}
                  </Text>
                  <Text className="text-[11.5px] text-cd-faint">{r.roomType === 'group' ? `그룹 · ${r.memberCount}명` : '개인'}</Text>
                </View>
                {sendingChat === r.roomId ? <ActivityIndicator size="small" /> : <Ionicons name="send-outline" size={16} color={c.primary} />}
              </Pressable>
            ))}
          </ScrollView>
        )}
      </Sheet>

      <ConfirmSheet
        visible={deleteOpen}
        title="할 일 삭제"
        message="하위 작업·댓글도 함께 지워집니다. 되돌릴 수 없습니다."
        confirmLabel="삭제"
        danger
        loading={deleting}
        onConfirm={() => void remove()}
        onCancel={() => setDeleteOpen(false)}
      />
    </Screen>
  );
}
