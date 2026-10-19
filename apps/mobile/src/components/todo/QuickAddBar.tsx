import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { CtaGradientFill, useToast } from '@/components/ui';
import { apiJson } from '@/lib/api';
import { TODO_PRIORITY_LABELS, type TodoItemDetail, type TodoPriority } from '@/lib/todo-types';
import { parseQuickAdd, type QuickParseResult, type QuickTokenKind } from '@/lib/todo-quick-parse';
import { describeRecurrence, fmtMdWd, labelColors, todayLocal, type LabelTone } from '@/lib/todo-utils';
import { useTheme } from '@/theme/useTheme';

/**
 * 하단 고정 퀵애드 바(§7.4·§12·§19-9) — 한 줄 입력 + 전송(앱 공용 primary 그라데이션). 입력 아래에
 * 인식 결과 줄("인식 · [10/14 (화) 15:00 ×] [담당 김민수 ×] · 수정")을 파스텔 칩으로 보여 주고,
 * 칩 × 로 해제하면 그 텍스트는 제목에 남는다. "수정"은 입력으로 되돌아가 원문을 고치는 진입점.
 *
 * - 입력 value 는 원문 그대로 둔다(정규화 함수를 controlled value 에 물리지 않는다 — AGENTS.md).
 * - RN TextInput 에는 compositionend 가 없어 매 변경마다 파싱한다(순수 함수라 비용이 작다).
 *   한글 조합 중 잠깐 다른 칩이 보일 수 있으나 미리보기일 뿐 저장에는 영향이 없다.
 * - "출장"·"초과근무"로 시작하는 입력은 만들지 않는다(§19-5 — 전자결재에서 기안).
 */

const KIND_LABEL: Record<QuickTokenKind, string> = {
  do_date: '할 날',
  do_time: '시각',
  due_date: '마감',
  recurrence: '반복',
  priority: '우선순위',
  board: '보드',
  assignee: '담당',
  note: '메모',
};

/** To-do 에서 만들 수 없는 종류 — 전자결재 양식으로 안내한다. */
const APPROVAL_ONLY = /^\s*(출장|초과근무)/;

/** 해제된 토큰을 제목에 되돌린 결과. */
function applyIgnored(text: string, parsed: QuickParseResult, ignored: Set<QuickTokenKind>): QuickParseResult {
  if (!ignored.size) return parsed;
  const tokens = parsed.tokens.filter((t) => !ignored.has(t.kind));
  let title = '';
  let cursor = 0;
  for (const t of [...tokens].sort((a, b) => a.start - b.start)) {
    title += text.slice(cursor, t.start) + ' ';
    cursor = t.end;
  }
  title += text.slice(cursor);
  return {
    ...parsed,
    title: title
      .replace(/\s+/g, ' ')
      .replace(/^[\s~,.·-]+|[\s~,.·-]+$/g, '')
      .trim(),
    doDate: ignored.has('do_date') ? (parsed.doTime && !ignored.has('do_time') ? todayLocal() : null) : parsed.doDate,
    doTime: ignored.has('do_time') ? null : parsed.doTime,
    dueDate: ignored.has('due_date') ? null : parsed.dueDate,
    recurrence: ignored.has('recurrence') ? null : parsed.recurrence,
    priority: ignored.has('priority') ? null : parsed.priority,
    boardToken: ignored.has('board') ? null : parsed.boardToken,
    assigneeToken: ignored.has('assignee') ? null : parsed.assigneeToken,
    note: ignored.has('note') ? null : parsed.note,
    tokens,
  };
}

interface Chip {
  key: string;
  kinds: QuickTokenKind[];
  label: string;
  tone: LabelTone;
}

export function QuickAddBar({
  boardId,
  resolveAssignee,
  resolveBoard,
  onCreated,
  inputRef,
  prefill,
}: {
  /** 현재 보고 있는 보드(프로젝트 범위) — 지정하면 그 보드에 만든다. */
  boardId?: string | null;
  /** `@이름` → 사용자. 못 찾으면 null(토큰은 제목에 남긴다). */
  resolveAssignee?: (name: string) => { userId: string; name: string } | null;
  /** `#보드명` → boardId. */
  resolveBoard?: (name: string) => string | null;
  onCreated: (item: TodoItemDetail) => void;
  /** 헤더 "+" 가 입력에 포커스를 주기 위한 ref. */
  inputRef?: RefObject<TextInput | null>;
  /** §26-1 메일·메신저에서 넘어온 제목·연결 — key 가 바뀔 때 입력을 채우고 연결 칩을 보인다. */
  prefill?: { key: string; title?: string | null; linkKind?: string | null; linkId?: string | null; linkLabel?: string | null } | null;
}) {
  const { c, dark } = useTheme();
  const toast = useToast();
  const [text, setText] = useState('');
  // 프리필 연결(§26-1)
  const [link, setLink] = useState<{ kind: string; id: string; label: string | null } | null>(null);
  const prefillKey = useRef<string | null>(null);
  useEffect(() => {
    if (!prefill || prefill.key === prefillKey.current) return;
    prefillKey.current = prefill.key;
    if (prefill.title) setText(prefill.title);
    setLink(prefill.linkKind && prefill.linkId ? { kind: prefill.linkKind, id: prefill.linkId, label: prefill.linkLabel ?? null } : null);
    setTimeout(() => inputRef?.current?.focus(), 50);
  }, [prefill, inputRef]);
  const [ignored, setIgnored] = useState<Set<QuickTokenKind>>(new Set());
  const [sending, setSending] = useState(false);

  const parsed = useMemo(() => {
    const raw = parseQuickAdd(text, { today: todayLocal() });
    return applyIgnored(text, raw, ignored);
  }, [text, ignored]);

  const assignee = parsed.assigneeToken ? (resolveAssignee?.(parsed.assigneeToken) ?? null) : null;
  const targetBoard = parsed.boardToken ? (resolveBoard?.(parsed.boardToken) ?? null) : null;

  // 인식 칩 — 할 날·시각은 한 칩("10/14 (화) 15:00")으로 합친다(시안).
  const chips: Chip[] = [];
  const live = parsed.tokens.filter((t) => !ignored.has(t.kind));
  const has = (k: QuickTokenKind) => live.some((t) => t.kind === k);
  if (has('do_date') || has('do_time')) {
    const kinds: QuickTokenKind[] = [];
    if (has('do_date')) kinds.push('do_date');
    if (has('do_time')) kinds.push('do_time');
    chips.push({
      key: 'when',
      kinds,
      label: [parsed.doDate ? fmtMdWd(parsed.doDate) : null, parsed.doTime].filter(Boolean).join(' '),
      tone: 'sky',
    });
  }
  for (const t of live) {
    if (t.kind === 'do_date' || t.kind === 'do_time') continue;
    let label = t.value;
    let tone: LabelTone = 'gray';
    if (t.kind === 'due_date') {
      label = `마감 ${fmtMdWd(t.value)}`;
      tone = 'sky';
    } else if (t.kind === 'recurrence') label = `반복 ${describeRecurrence(t.value) ?? t.value}`;
    else if (t.kind === 'priority') {
      label = TODO_PRIORITY_LABELS[Number(t.value) as TodoPriority] ?? t.value;
      tone = Number(t.value) === 3 ? 'over' : 'gray';
    } else if (t.kind === 'assignee') {
      label = assignee ? `담당 ${assignee.name}` : `담당 ${t.value}(없음)`;
      tone = 'lavender';
    } else if (t.kind === 'board') label = targetBoard ? `보드 ${t.value}` : `보드 ${t.value}(없음)`;
    else if (t.kind === 'note') label = `메모 ${t.value.length > 12 ? `${t.value.slice(0, 12)}…` : t.value}`;
    chips.push({ key: t.kind, kinds: [t.kind], label, tone });
  }

  const submit = async () => {
    const title = parsed.title.trim();
    if (!title || sending) return;
    if (APPROVAL_ONLY.test(text)) {
      toast.show('출장·초과근무는 전자결재에서 기안합니다', 'info');
      return;
    }
    setSending(true);
    try {
      const body: Record<string, unknown> = {
        title,
        doDate: parsed.doDate,
        doTime: parsed.doTime,
        dueDate: parsed.dueDate,
        recurrence: parsed.recurrence,
        priority: parsed.priority ?? 0,
        note: parsed.note,
      };
      const bid = targetBoard ?? boardId ?? null;
      if (bid) body.boardId = bid;
      if (link) {
        body.linkKind = link.kind;
        body.linkId = link.id;
        body.linkLabel = link.label;
      }
      if (assignee) body.assigneeUserId = assignee.userId;
      const r = await apiJson<{ item: TodoItemDetail }>('/api/todo/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setText('');
      setIgnored(new Set());
      setLink(null);
      onCreated(r.item);
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setSending(false);
    }
  };

  const canSend = !!parsed.title.trim() && !sending;

  return (
    <View className="border-t border-cd-border bg-cd-card px-3 pb-6 pt-2">
      <View className="flex-row items-center gap-2">
        <View className="h-10 flex-1 flex-row items-center gap-2 rounded-lg border border-cd-border bg-cd-card px-3">
          <Ionicons name="add" size={16} color={c.muted} />
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={(t) => {
              setText(t);
              if (!t) setIgnored(new Set());
            }}
            onSubmitEditing={() => void submit()}
            placeholder="할 일 추가 · 예: 내일 3시 미팅 @김민수"
            placeholderTextColor={c.faint}
            returnKeyType="done"
            blurOnSubmit={false}
            className="h-10 flex-1 text-[14px] text-cd-text"
          />
        </View>
        <Pressable
          onPress={() => void submit()}
          disabled={!canSend}
          accessibilityLabel="추가"
          className={`h-10 w-10 items-center justify-center overflow-hidden rounded-lg active:opacity-70 ${canSend ? '' : 'bg-cd-surface'}`}>
          {canSend ? <CtaGradientFill /> : null}
          {sending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="arrow-forward" size={18} color={canSend ? '#fff' : c.faint} />
          )}
        </Pressable>
      </View>
      {chips.length ? (
        <View className="mt-2 flex-row flex-wrap items-center gap-x-2 gap-y-1.5">
          <Text className="text-[12.5px] text-cd-faint">인식</Text>
          {chips.map((ch) => {
            const col = labelColors(ch.tone, dark);
            return (
              <View
                key={ch.key}
                style={{ backgroundColor: col.bg, height: 24, borderRadius: 6, paddingLeft: 8, paddingRight: 2 }}
                className="flex-row items-center gap-1">
                <Text style={{ fontSize: 12.5, color: col.fg }}>{ch.label}</Text>
                <Pressable
                  hitSlop={6}
                  onPress={() => setIgnored((p) => new Set([...p, ...ch.kinds]))}
                  accessibilityLabel={`${ch.kinds.map((k) => KIND_LABEL[k]).join('·')} 해제`}
                  className="h-5 w-5 items-center justify-center active:opacity-60">
                  <Ionicons name="close" size={13} color={col.fg} />
                </Pressable>
              </View>
            );
          })}
          <View className="flex-1" />
          <Pressable onPress={() => inputRef?.current?.focus()} hitSlop={6} className="active:opacity-60">
            <Text className="text-[12.5px] font-medium text-cd-primary">수정</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
