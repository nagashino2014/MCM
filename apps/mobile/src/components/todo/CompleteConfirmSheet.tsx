import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Button, Sheet, Textarea } from '@/components/ui';
import { ApiJsonError } from '@/lib/api';
import { activeCompleteRuleKeys, checkCompletion, describeMissingRule } from '@/lib/todo-completion';
import { TODO_COMPLETE_RULE_KEYS, TODO_COMPLETE_RULE_LABELS, type TodoCompleteRuleKey, type TodoCompleteRules } from '@/lib/todo-types';
import { labelColors } from '@/lib/todo-utils';
import { useTheme } from '@/theme/useTheme';

/**
 * 완료 확인 시트(276, 2026-10-14) — 완료 조건이 있는 할 일을 체크·상태 변경·완료 열 이동으로 완료할 때 먼저 띄운다(웹 CompleteConfirmModal 과 같은 규칙).
 * 제목 · 조건별 충족 표시(✓ / 미충족 문구) · 완료 메모(규칙 note 면 필수) · [완료] / [취소]. 서버 409(code complete_rules)도 failure 로 받아 같은 화면.
 */

/** 서버 409 응답(code complete_rules) — 모달 안내용. */
export interface CompleteRulesFailure {
  message: string;
  missing: TodoCompleteRuleKey[];
  openSubtasks: number;
  openDeps: number;
}

export function asCompleteRulesFailure(err: unknown): CompleteRulesFailure | null {
  if (!(err instanceof ApiJsonError) || err.status !== 409 || err.data.code !== 'complete_rules') return null;
  const missing = (Array.isArray(err.data.missing) ? err.data.missing : []).filter((k): k is TodoCompleteRuleKey =>
    (TODO_COMPLETE_RULE_KEYS as readonly string[]).includes(String(k))
  );
  return { message: err.message, missing, openSubtasks: Number(err.data.openSubtasks ?? 0), openDeps: Number(err.data.openDeps ?? 0) };
}

/** 시트가 판단에 쓰는 최소 필드 — 목록 행(TodoItem)·상세(TodoItemDetail) 모두 만족. */
export interface CompleteConfirmTarget {
  itemId: string;
  title: string;
  status: string;
  completeRules: TodoCompleteRules;
  subtaskTotal: number;
  subtaskDone: number;
  reviewedAt: string | null;
  completionNote: string | null;
  /** 미완료 선행 작업 수(288). */
  openDeps?: number;
}

/** 완료 조건 체크 3개 — 상세 '부가 설정 › 완료 조건' 공용(체크박스 아이콘 + 라벨 + 보조 문구). */
export function CompleteRulesChecks({ value, disabled, onChange }: { value: TodoCompleteRules; disabled?: boolean; onChange: (next: TodoCompleteRules) => void }) {
  const { c } = useTheme();
  const hints: Record<TodoCompleteRuleKey, string> = {
    subtasks: '미완 하위 작업이 남아 있으면 완료할 수 없습니다',
    note: '완료 확인에서 메모를 적어야 완료됩니다',
    review: "상태를 '검토'로 한 번 거쳐야 완료할 수 있습니다",
    deps: '선행 작업이 모두 완료돼야 완료할 수 있습니다',
  };
  return (
    <View className="gap-2">
      {TODO_COMPLETE_RULE_KEYS.map((k) => {
        const on = !!value[k];
        return (
          <Pressable
            key={k}
            disabled={disabled}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on, disabled }}
            onPress={() => {
              const next: TodoCompleteRules = { ...value };
              if (on) delete next[k];
              else next[k] = true;
              onChange(next);
            }}
            className="flex-row items-start gap-2 active:opacity-70"
            style={{ opacity: disabled ? 0.6 : 1 }}>
            <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? c.primary : c.faint} style={{ marginTop: 1 }} />
            <View className="flex-1" style={{ minWidth: 0 }}>
              <Text className="text-[13.5px] text-cd-text">{TODO_COMPLETE_RULE_LABELS[k]}</Text>
              <Text className="text-[11.5px] text-cd-faint">{hints[k]}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export function CompleteConfirmSheet({
  visible,
  target,
  failure,
  busy,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  target: CompleteConfirmTarget | null;
  failure?: CompleteRulesFailure | null;
  busy?: boolean;
  onConfirm: (completionNote: string | null) => void;
  onClose: () => void;
}) {
  const { c, dark } = useTheme();
  // 시트가 열릴 때마다 메모 버퍼를 대상의 기존 메모로 — 렌더 중 파생(AGENTS.md: controlled 입력은 로컬 버퍼).
  const [note, setNote] = useState('');
  const [sig, setSig] = useState('');
  const curSig = visible && target ? `${target.itemId}:${target.completionNote ?? ''}` : '';
  if (curSig !== sig) {
    setSig(curSig);
    setNote(target?.completionNote ?? '');
  }

  const keys = useMemo(() => activeCompleteRuleKeys(target?.completeRules), [target?.completeRules]);
  const check = target
    ? checkCompletion(target.completeRules, {
        status: target.status,
        openSubtasks: Math.max(0, target.subtaskTotal - target.subtaskDone),
        openDeps: target.openDeps ?? 0,
        completionNote: note,
        reviewedAt: target.reviewedAt,
      })
    : null;
  const serverMissing = new Set((failure?.missing ?? []).filter((k) => k !== 'note'));
  const missing = new Set<TodoCompleteRuleKey>([...(check?.missing ?? []), ...serverMissing]);
  const openSubtasks = failure && serverMissing.has('subtasks') ? Math.max(failure.openSubtasks, check?.openSubtasks ?? 0) : (check?.openSubtasks ?? 0);
  const openDeps = failure && serverMissing.has('deps') ? Math.max(failure.openDeps, check?.openDeps ?? 0) : (check?.openDeps ?? 0);
  const noteRequired = !!target?.completeRules.note;
  const canConfirm = !!target && missing.size === 0 && !busy;
  const ok = labelColors('sage', dark);
  const bad = labelColors('over', dark);

  return (
    <Sheet
      visible={visible && !!target}
      onClose={() => (busy ? undefined : onClose())}
      title="완료 확인"
      footer={
        <>
          <View className="flex-1">
            <Button label="취소" variant="ghost" onPress={onClose} disabled={busy} full />
          </View>
          <View className="flex-1">
            <Button label="완료" variant="primary" onPress={() => onConfirm(note.trim() || null)} loading={busy} disabled={!canConfirm} full />
          </View>
        </>
      }>
      {target ? (
        <View className="gap-3">
          <Text numberOfLines={2} className="text-[14px] font-semibold text-cd-text">
            {target.title}
          </Text>
          {failure ? (
            <View className="flex-row items-center gap-1.5">
              <Ionicons name="alert-circle-outline" size={14} color={c.warning ?? bad.fg} />
              <Text className="text-[12.5px] text-cd-muted">서버가 완료를 거절했습니다 — 아래 조건을 확인하세요.</Text>
            </View>
          ) : null}
          {!target.completeRules.deps && openDeps > 0 ? (
            <View className="flex-row items-center gap-1.5">
              <Ionicons name="alert-circle-outline" size={14} color={c.warning ?? bad.fg} />
              <Text className="text-[12.5px] text-cd-muted">선행 작업 {openDeps}건이 아직 끝나지 않았습니다(경고 — 완료는 가능).</Text>
            </View>
          ) : null}
          <View className="overflow-hidden rounded-lg border border-cd-border bg-cd-card">
            {keys.map((k, i) => {
              const miss = missing.has(k);
              const col = miss ? bad : ok;
              return (
                <View key={k} className={`flex-row items-center gap-2 px-3 py-2 ${i > 0 ? 'border-t border-cd-grid-line' : ''}`}>
                  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: col.bg }} className="items-center justify-center">
                    <Ionicons name={miss ? 'alert' : 'checkmark'} size={12} color={col.fg} />
                  </View>
                  <Text className="text-[13px] font-medium text-cd-text">{TODO_COMPLETE_RULE_LABELS[k]}</Text>
                  <Text numberOfLines={2} className="flex-1 text-right text-[12px]" style={{ color: miss ? col.fg : c.faint }}>
                    {miss ? describeMissingRule(k, openSubtasks, openDeps) : k === 'subtasks' ? `하위 작업 ${target.subtaskDone}/${target.subtaskTotal} 완료` : '충족'}
                  </Text>
                </View>
              );
            })}
          </View>
          <Textarea
            label={noteRequired ? '완료 메모 (필수)' : '완료 메모 (선택)'}
            minHeight={88}
            value={note}
            onChangeText={setNote}
            placeholder={noteRequired ? '완료 결과·확인 사항을 적어야 완료할 수 있습니다' : '완료 결과를 남길 수 있습니다'}
            maxLength={2000}
          />
        </View>
      ) : null}
    </Sheet>
  );
}
