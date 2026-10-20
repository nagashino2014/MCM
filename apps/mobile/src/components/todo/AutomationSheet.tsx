/**
 * 보드 자동화 시트(296, §29-2 모바일 2차) — 규칙 목록(켬/끔·삭제·탭=편집) + 칩 기반 빌더 + 미리보기 문장. 보드 admin 만 편집.
 * 트리거/행동 선택은 칩(Pressable), 담당·템플릿·메신저 방은 가로 스크롤 칩. 검증은 서버(400 메시지를 토스트로).
 */
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Button, Sheet, useToast } from '@/components/ui';
import { apiJson } from '@/lib/api';
import { useTheme } from '@/theme/useTheme';
import { TODO_STATUSES, TODO_STATUS_LABELS, type TodoBoard, type TodoStatus } from '@/lib/todo-types';
import {
  TODO_RULE_ACTIONS,
  TODO_RULE_ACTION_LABELS,
  TODO_RULE_DEFAULT_MESSAGE,
  TODO_RULE_MAX_PER_BOARD,
  TODO_RULE_TRIGGERS,
  TODO_RULE_TRIGGER_LABELS,
  describeRule,
  type TodoBoardRule,
  type TodoRuleActionKind,
  type TodoRuleTriggerKind,
} from '@/lib/todo-rules';

interface Draft {
  name: string;
  triggerKind: TodoRuleTriggerKind;
  triggerStatus: TodoStatus;
  days: string;
  actionKind: TodoRuleActionKind;
  status: TodoStatus;
  assignee: string;
  roomId: string;
  inApp: boolean;
  message: string;
  templateId: string;
}
const EMPTY: Draft = { name: '', triggerKind: 'completed', triggerStatus: 'doing', days: '1', actionKind: 'notify', status: 'doing', assignee: 'owner', roomId: '', inApp: true, message: TODO_RULE_DEFAULT_MESSAGE, templateId: '' };

function toPayload(d: Draft) {
  return {
    name: d.name.trim(),
    trigger: { kind: d.triggerKind, status: d.triggerKind === 'status' ? d.triggerStatus : undefined, days: d.triggerKind === 'due_before' ? Number(d.days || 0) : undefined },
    condition: {},
    action:
      d.actionKind === 'set_status'
        ? { kind: 'set_status', status: d.status }
        : d.actionKind === 'assign'
          ? { kind: 'assign', assignee: d.assignee }
          : d.actionKind === 'notify'
            ? { kind: 'notify', roomId: d.roomId ? Number(d.roomId) : null, inApp: d.inApp, message: d.message }
            : { kind: 'apply_template', templateId: d.templateId },
  };
}

function Chips<T extends string>({ options, value, onChange, disabled }: { options: { key: T; label: string }[]; value: T; onChange: (v: T) => void; disabled?: boolean }) {
  const { c } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            disabled={disabled}
            accessibilityState={{ selected: on }}
            className={`h-8 justify-center rounded-lg border px-3 ${on ? 'border-cd-primary bg-cd-primary-soft' : 'border-cd-border bg-cd-card'}`}>
            <Text style={{ fontSize: 12.5, color: on ? c.primary : c.text, fontWeight: on ? '600' : '400' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function AutomationSheet({ board, visible, onClose }: { board: TodoBoard; visible: boolean; onClose: () => void }) {
  const { c } = useTheme();
  const toast = useToast();
  const canEdit = board.myRole === 'admin';
  const [rules, setRules] = useState<TodoBoardRule[] | null>(null);
  const [members, setMembers] = useState<{ userId: string; name: string }[]>([]);
  const [rooms, setRooms] = useState<{ roomId: number; name: string }[]>([]);
  const [templates, setTemplates] = useState<{ templateId: string; name: string }[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    const bid = encodeURIComponent(board.boardId);
    setRules(null);
    apiJson<{ rules: TodoBoardRule[] }>(`/api/todo/boards/${bid}/rules`).then((d) => alive && setRules(d.rules ?? [])).catch((e) => { if (alive) { setRules([]); toast.show((e as Error).message, 'error'); } });
    if (board.kind !== 'personal') apiJson<{ members: { userId: string; name: string }[] }>(`/api/todo/boards/${bid}/members`).then((d) => alive && setMembers(d.members ?? [])).catch(() => {});
    apiJson<{ rooms: { roomId: number; name: string }[] }>('/api/chat/rooms').then((d) => alive && setRooms(d.rooms ?? [])).catch(() => {});
    apiJson<{ templates: { templateId: string; name: string }[] }>(`/api/todo/templates${board.kind !== 'personal' ? `?boardId=${bid}` : ''}`).then((d) => alive && setTemplates(d.templates ?? [])).catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, board.boardId]);

  const names = useMemo(
    () => ({
      users: Object.fromEntries(members.map((m) => [m.userId, m.name])),
      rooms: Object.fromEntries(rooms.map((r) => [String(r.roomId), r.name])),
      templates: Object.fromEntries(templates.map((t) => [t.templateId, t.name])),
    }),
    [members, rooms, templates]
  );
  const preview = useMemo(() => {
    const p = toPayload(draft);
    return describeRule({ trigger: p.trigger as TodoBoardRule['trigger'], condition: {}, action: p.action as TodoBoardRule['action'] }, names);
  }, [draft, names]);

  const save = async () => {
    if (!canEdit || busy) return;
    setBusy(true);
    try {
      const bid = encodeURIComponent(board.boardId);
      const payload = toPayload(draft);
      if (editing) {
        const d = await apiJson<{ rule: TodoBoardRule }>(`/api/todo/boards/${bid}/rules/${encodeURIComponent(editing)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        setRules((rs) => (rs ?? []).map((r) => (r.ruleId === editing ? d.rule : r)));
        toast.show('규칙을 저장했습니다.', 'success');
      } else {
        const d = await apiJson<{ rule: TodoBoardRule }>(`/api/todo/boards/${bid}/rules`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        setRules((rs) => [...(rs ?? []), d.rule]);
        toast.show('규칙을 추가했습니다.', 'success');
      }
      setDraft(EMPTY);
      setEditing(null);
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (r: TodoBoardRule) => {
    try {
      const d = await apiJson<{ rule: TodoBoardRule }>(`/api/todo/boards/${encodeURIComponent(board.boardId)}/rules/${encodeURIComponent(r.ruleId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !r.enabled }) });
      setRules((rs) => (rs ?? []).map((x) => (x.ruleId === r.ruleId ? d.rule : x)));
    } catch (e) {
      toast.show((e as Error).message, 'error');
    }
  };
  const remove = (r: TodoBoardRule) => {
    Alert.alert('규칙 삭제', `'${r.name}' 규칙을 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiJson(`/api/todo/boards/${encodeURIComponent(board.boardId)}/rules/${encodeURIComponent(r.ruleId)}`, { method: 'DELETE' });
            setRules((rs) => (rs ?? []).filter((x) => x.ruleId !== r.ruleId));
            if (editing === r.ruleId) {
              setEditing(null);
              setDraft(EMPTY);
            }
          } catch (e) {
            toast.show((e as Error).message, 'error');
          }
        },
      },
    ]);
  };
  const edit = (r: TodoBoardRule) => {
    setEditing(r.ruleId);
    setDraft({
      name: r.name,
      triggerKind: r.trigger.kind,
      triggerStatus: r.trigger.status ?? 'doing',
      days: String(r.trigger.days ?? 1),
      actionKind: r.action.kind,
      status: r.action.status ?? 'doing',
      assignee: r.action.assignee ?? 'owner',
      roomId: r.action.roomId ? String(r.action.roomId) : '',
      inApp: r.action.inApp !== false,
      message: r.action.message ?? TODO_RULE_DEFAULT_MESSAGE,
      templateId: r.action.templateId ?? '',
    });
  };
  const full = (rules?.length ?? 0) >= TODO_RULE_MAX_PER_BOARD && !editing;
  const statusOpts = TODO_STATUSES.map((s) => ({ key: s, label: TODO_STATUS_LABELS[s] }));

  return (
    <Sheet visible={visible} onClose={onClose} title={`자동화 — ${board.name}`} fillHeight={0.9}>
      <ScrollView automaticallyAdjustKeyboardInsets className="flex-1" contentContainerStyle={{ gap: 12, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <Text className="text-[12px] text-cd-muted">할 일이 바뀔 때 보드가 대신 처리합니다. 규칙이 일으킨 변경은 다른 규칙을 다시 타지 않습니다.{!canEdit ? ' (보드 관리자만 편집)' : ''}</Text>

        <View className="gap-1.5">
          {rules === null ? (
            <Text className="text-[13px] text-cd-faint">불러오는 중…</Text>
          ) : rules.length === 0 ? (
            <Text className="text-[13px] text-cd-faint">아직 규칙이 없습니다.</Text>
          ) : (
            rules.map((r) => (
              <View key={r.ruleId} className={`flex-row items-center gap-2 rounded-lg border bg-cd-card px-3 py-2 ${editing === r.ruleId ? 'border-cd-primary' : 'border-cd-border'}`} style={{ opacity: r.enabled ? 1 : 0.55 }}>
                <Ionicons name="flash-outline" size={15} color={c.primary} />
                <Pressable onPress={() => (canEdit ? edit(r) : undefined)} className="flex-1" style={{ minWidth: 0 }}>
                  <Text numberOfLines={1} className="text-[13.5px] font-semibold text-cd-text">
                    {r.name}
                  </Text>
                  <Text numberOfLines={2} className="text-[11.5px] text-cd-muted">
                    {describeRule(r, names)} · {r.runCount}회
                  </Text>
                </Pressable>
                {canEdit ? (
                  <>
                    <Switch value={r.enabled} onValueChange={() => void toggle(r)} />
                    <Pressable onPress={() => remove(r)} hitSlop={8} accessibilityLabel={`${r.name} 삭제`} className="active:opacity-60">
                      <Ionicons name="trash-outline" size={17} color={c.muted} />
                    </Pressable>
                  </>
                ) : null}
              </View>
            ))
          )}
        </View>

        {canEdit ? (
          <View className="gap-3 rounded-lg border border-cd-border bg-cd-surface p-3">
            <Text className="text-[12.5px] font-semibold text-cd-text">{editing ? '규칙 편집' : '새 규칙'}</Text>
            <TextInput value={draft.name} onChangeText={(v) => set({ name: v })} placeholder="규칙 이름(예: 완료되면 검토 요청)" placeholderTextColor={c.faint} maxLength={80} className="h-10 rounded-lg border border-cd-border bg-cd-card px-3 text-[14px] text-cd-text" />
            <Text className="text-[11.5px] text-cd-muted">트리거</Text>
            <Chips options={TODO_RULE_TRIGGERS.map((k) => ({ key: k, label: TODO_RULE_TRIGGER_LABELS[k] }))} value={draft.triggerKind} onChange={(v) => set({ triggerKind: v })} />
            {draft.triggerKind === 'status' ? <Chips options={statusOpts} value={draft.triggerStatus} onChange={(v) => set({ triggerStatus: v })} /> : null}
            {draft.triggerKind === 'due_before' ? (
              <View className="flex-row items-center gap-2">
                <Text className="text-[12.5px] text-cd-muted">마감</Text>
                <TextInput value={draft.days} onChangeText={(v) => set({ days: v.replace(/[^0-9]/g, '').slice(0, 2) })} keyboardType="number-pad" className="h-9 w-14 rounded-lg border border-cd-border bg-cd-card px-2 text-center text-[14px] text-cd-text" />
                <Text className="text-[12.5px] text-cd-muted">일 전(0=당일)</Text>
              </View>
            ) : null}
            <Text className="text-[11.5px] text-cd-muted">행동</Text>
            <Chips options={TODO_RULE_ACTIONS.map((k) => ({ key: k, label: TODO_RULE_ACTION_LABELS[k] }))} value={draft.actionKind} onChange={(v) => set({ actionKind: v })} />
            {draft.actionKind === 'set_status' ? <Chips options={statusOpts} value={draft.status} onChange={(v) => set({ status: v })} /> : null}
            {draft.actionKind === 'assign' ? <Chips options={[{ key: 'owner', label: '작성자' }, ...members.map((m) => ({ key: m.userId, label: m.name }))]} value={draft.assignee} onChange={(v) => set({ assignee: v })} /> : null}
            {draft.actionKind === 'apply_template' ? (
              templates.length ? (
                <Chips options={templates.map((t) => ({ key: t.templateId, label: t.name }))} value={draft.templateId} onChange={(v) => set({ templateId: v })} />
              ) : (
                <Text className="text-[12px] text-cd-faint">저장된 템플릿이 없습니다.</Text>
              )
            ) : null}
            {draft.actionKind === 'notify' ? (
              <>
                <Chips options={[{ key: '', label: '메신저 방 없음' }, ...rooms.map((r) => ({ key: String(r.roomId), label: r.name }))]} value={draft.roomId} onChange={(v) => set({ roomId: v })} />
                <View className="flex-row items-center gap-2">
                  <Switch value={draft.inApp} onValueChange={(v) => set({ inApp: v })} />
                  <Text className="text-[12.5px] text-cd-text">담당자 인앱 알림</Text>
                </View>
                <TextInput value={draft.message} onChangeText={(v) => set({ message: v })} maxLength={300} placeholder="메시지 — {title} {status} {assignee} {board}" placeholderTextColor={c.faint} className="h-10 rounded-lg border border-cd-border bg-cd-card px-3 text-[13px] text-cd-text" />
              </>
            ) : null}
            <Text className="text-[12.5px] text-cd-text">→ {preview}</Text>
            <View className="flex-row gap-2">
              {editing ? (
                <View className="flex-1">
                  <Button label="새 규칙으로" variant="ghost" size="sm" onPress={() => { setEditing(null); setDraft(EMPTY); }} />
                </View>
              ) : null}
              <View className="flex-1">
                <Button label={busy ? '저장 중…' : editing ? '규칙 저장' : full ? `최대 ${TODO_RULE_MAX_PER_BOARD}개` : '규칙 추가'} variant="primary" size="sm" onPress={() => void save()} disabled={busy || !draft.name.trim() || full} />
              </View>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}
