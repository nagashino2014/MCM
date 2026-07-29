import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { ActionBar, Button, Chip, EmptyState, Input, Screen, Textarea, useToast } from '@/components/ui';
import { apiJson } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useTheme } from '@/theme/useTheme';

interface LeaveType {
  key: string;
  label: string;
  deduct: 'full' | 'half' | null;
  days: number | null;
}
interface PresetStep {
  stepType: 'agree' | 'approve';
  assigneeUserId: string;
  assigneeName: string | null;
  assigneePosition: string | null;
}
interface Preset {
  presetId: string;
  name: string;
  steps: PresetStep[];
}

/** YYYYMMDD·YYYY-MM-DD 입력을 ISO(YYYY-MM-DD)로. 빈 값은 ''. */
function normDate(v: string): string {
  const s = v.replace(/[^\d]/g, '');
  if (s.length !== 8) return '';
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}
const todayCompact = () => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * 휴가 신청(M5) — 결재 문서를 만들어 상신한다.
 *
 * 기안 전반은 웹에서 하지만(§3.1 B등급), 휴가 신청만은 모바일에서 자주 쓰므로 전용 폼을 둔다.
 * 필드 키는 서버 양식 정의(frm-leave-request)와 맞춘다: leave_type · leave_period · reason.
 */
export default function LeaveRequestScreen() {
  const router = useRouter();
  const toast = useToast();
  const { c } = useTheme();

  const types = useApi<{ types: LeaveType[] }>('/api/approval/leave-types', { cache: true });
  const presets = useApi<{ presets: Preset[] }>('/api/approval/line-presets', { cache: true });
  const form = useApi<{ form: { formId: string; name: string; fields: { key: string; label: string; type: string; required?: boolean }[] } }>(
    '/api/approval/forms/frm-leave-request',
    { cache: true }
  );

  const [typeKey, setTypeKey] = useState<string>('');
  const [from, setFrom] = useState(todayCompact());
  const [to, setTo] = useState(todayCompact());
  const [reason, setReason] = useState('');
  const [presetId, setPresetId] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const typeList = types.data?.types ?? [];
  const presetList = presets.data?.presets ?? [];

  useEffect(() => {
    if (!typeKey && typeList.length) setTypeKey(typeList[0].key);
  }, [typeList, typeKey]);
  useEffect(() => {
    if (!presetId && presetList.length) setPresetId(presetList[0].presetId);
  }, [presetList, presetId]);

  const selectedType = typeList.find((t) => t.key === typeKey) ?? null;
  const selectedPreset = presetList.find((p) => p.presetId === presetId) ?? null;

  /** 사유 필드 키 — 양식 정의에서 찾는다(양식이 바뀌어도 따라가도록). */
  const reasonKey = useMemo(() => {
    const fields = form.data?.form?.fields ?? [];
    const f =
      fields.find((x) => x.key === 'reason') ??
      fields.find((x) => x.type === 'multitext') ??
      fields.find((x) => x.label?.includes('사유'));
    return f?.key ?? 'reason';
  }, [form.data]);

  const days = useMemo(() => {
    if (selectedType?.deduct === 'half') return 0.5;
    const a = normDate(from);
    const b = normDate(to) || a;
    if (!a) return 0;
    return Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000) + 1);
  }, [from, to, selectedType]);

  const submit = async () => {
    const a = normDate(from);
    const b = normDate(to) || a;
    if (!selectedType) {
      toast.show('휴가 종류를 선택하세요.', 'error');
      return;
    }
    if (!a) {
      toast.show('휴가 기간을 8자리(YYYYMMDD)로 입력하세요.', 'error');
      return;
    }
    if (!reason.trim()) {
      toast.show('휴가 사유를 입력하세요.', 'error');
      return;
    }
    if (!selectedPreset) {
      toast.show('결재선이 없습니다. 웹에서 결재선을 먼저 저장해 주세요.', 'error');
      return;
    }

    setSaving(true);
    try {
      const res = await apiJson<{ docId: string; docNo?: string | null }>('/api/approval/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit',
          formId: 'frm-leave-request',
          title: `${selectedType.label} 신청 (${a}${b !== a ? `~${b}` : ''})`,
          fieldValues: {
            leave_type: selectedType.key,
            leave_period: { from: a, to: b },
            [reasonKey]: reason.trim(),
          },
          // 단계 순서는 배열 순서로 정해진다(ApprovalLineStepInput 에 stepOrder 는 없다).
          line: selectedPreset.steps.map((s) => ({
            stepType: s.stepType,
            assigneeUserId: s.assigneeUserId,
            assigneeName: s.assigneeName ?? undefined,
            assigneePosition: s.assigneePosition ?? undefined,
          })),
        }),
      });
      toast.show('휴가 신청을 상신했습니다.', 'success');
      router.replace(`/approval/${res.docId}`);
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (types.loading && !typeList.length) {
    return (
      <Screen>
        <Text className="p-4 text-[13px] text-cd-faint">휴가 종류를 불러오는 중입니다.</Text>
      </Screen>
    );
  }

  return (
    <SafeAreaView edges={[]} style={{ backgroundColor: c.bg }} className="flex-1 bg-cd-bg">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
        keyboardVerticalOffset={90}>
        <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, gap: 14 }}>
          {/* 휴가 종류 */}
          <View className="gap-1.5">
            <Text className="text-[13px] font-bold text-cd-muted">휴가 종류</Text>
            <View className="flex-row flex-wrap gap-2">
              {typeList.map((t) => (
                <Chip
                  key={t.key}
                  label={t.label}
                  active={typeKey === t.key}
                  onPress={() => setTypeKey(t.key)}
                />
              ))}
            </View>
            {selectedType ? (
              <Text className="text-[11px] text-cd-faint">
                {selectedType.deduct === 'half'
                  ? '연차 0.5일 차감'
                  : selectedType.deduct === 'full'
                    ? '연차 차감'
                    : '연차 차감 없음'}
              </Text>
            ) : null}
          </View>

          {/* 기간 */}
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Input
                label="시작일"
                value={from}
                onChangeText={setFrom}
                placeholder="YYYYMMDD"
                keyboardType="number-pad"
                maxLength={8}
              />
            </View>
            <View className="flex-1">
              <Input
                label="종료일"
                value={to}
                onChangeText={setTo}
                placeholder="YYYYMMDD"
                keyboardType="number-pad"
                maxLength={8}
              />
            </View>
          </View>
          {days > 0 ? (
            <Text className="-mt-2 text-[12px] text-cd-muted">
              신청 일수 <Text className="font-bold text-cd-text">{days}일</Text>
            </Text>
          ) : null}

          <Textarea
            label="휴가 사유"
            value={reason}
            onChangeText={setReason}
            placeholder="사유를 입력하세요."
            minHeight={120}
          />

          {/* 결재선 */}
          <View className="gap-1.5">
            <Text className="text-[13px] font-bold text-cd-muted">결재선</Text>
            {presetList.length === 0 ? (
              <View className="rounded-xl bg-cd-warning-soft px-3 py-2.5">
                <Text className="text-[12px] leading-4 text-cd-warning">
                  저장된 결재선이 없습니다. 웹의 기안 작성 화면에서 결재선을 한 번 저장하면
                  이후 모바일에서 바로 신청할 수 있습니다.
                </Text>
              </View>
            ) : (
              <>
                <View className="flex-row flex-wrap gap-2">
                  {presetList.map((p) => (
                    <Chip
                      key={p.presetId}
                      label={p.name}
                      active={presetId === p.presetId}
                      onPress={() => setPresetId(p.presetId)}
                    />
                  ))}
                </View>
                {selectedPreset ? (
                  <View className="mt-1 flex-row flex-wrap items-center gap-1.5">
                    {selectedPreset.steps.map((s, i) => (
                      <View key={`${s.assigneeUserId}-${i}`} className="flex-row items-center gap-1">
                        {i > 0 ? <Ionicons name="chevron-forward" size={12} color={c.faint} /> : null}
                        <Text className="text-[12px] text-cd-muted">
                          {s.assigneeName ?? '-'}
                          {s.assigneePosition ? ` ${s.assigneePosition}` : ''}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </>
            )}
          </View>

          {form.error ? (
            <EmptyState
              icon="alert-circle-outline"
              title="휴가 양식을 불러오지 못했습니다"
              description={form.error}
            />
          ) : null}
        </ScrollView>

        <ActionBar>
          <View className="flex-1">
            <Button label="취소" variant="ghost" onPress={() => router.back()} full />
          </View>
          <View className="flex-[2]">
            <Button label="상신" icon="paper-plane" onPress={submit} loading={saving} full />
          </View>
        </ActionBar>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
