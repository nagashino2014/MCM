import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { GradientButton, Input, Sheet, Textarea, useToast } from '@/components/ui';
import { EntityPickerSheet, type EntityOption } from '@/components/pickers/EntityPickerSheet';
import { DatePickerSheet } from '@/components/calendar/DatePickerSheet';
import { apiJson } from '@/lib/api';
import { useTheme } from '@/theme/useTheme';
import { ACTIVITY_TYPES, PLACE_TYPES, type SalesActivityType } from '@/lib/sales/types';
import { PickChip } from './NewProjectSheet';

/**
 * 영업 일정(활동) 등록 시트 — 데스크탑 ScheduleModal 의 모바일 축약판.
 * 필수(영업건·일정명·시작 일시)만 받고 담당인력·접견자·견적/투찰 상세는 웹에서 보완한다
 * (블루프린트 P5 — "필수 항목만 받고 나머지는 나중에 채우는 방식으로 축약").
 *
 * 영업건·날짜 픽커가 열리는 동안 폼 시트를 잠시 숨긴다(Modal 중첩 회피, 입력값은 보존).
 */

/** HHMM 입력을 HH:MM 으로 — 웹 AutoTimeInput·FormField 의 time 규칙과 동일. */
const maskTime = (t: string) => {
  const d = t.replace(/[^\d]/g, '').slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
};
const validTime = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

export function NewActivitySheet({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { c } = useTheme();
  const toast = useToast();
  const [picking, setPicking] = useState<null | 'project' | 'start' | 'end'>(null);
  const [project, setProject] = useState<{ id: string; title: string; facility: string } | null>(null);
  const [type, setType] = useState<SalesActivityType>('visit');
  const [startDate, setStartDate] = useState<string | null>(null);
  const [startTime, setStartTime] = useState('09:00'); // 데스크탑 defaultDate 프리필과 같은 기본
  const [endDate, setEndDate] = useState<string | null>(null);
  const [endTime, setEndTime] = useState('');
  const [place, setPlace] = useState('');
  const [summary, setSummary] = useState('');
  const [saving, setSaving] = useState(false);

  const showPlace = PLACE_TYPES.includes(type);

  const reset = () => {
    setProject(null);
    setType('visit');
    setStartDate(null);
    setStartTime('09:00');
    setEndDate(null);
    setEndTime('');
    setPlace('');
    setSummary('');
  };

  const submit = async () => {
    if (!project) {
      toast.show('영업건을 선택하세요.', 'error');
      return;
    }
    if (!startDate) {
      toast.show('일시(시작)를 입력하세요.', 'error');
      return;
    }
    if (startTime && !validTime(startTime)) {
      toast.show('시작 시각은 HH:MM 형식으로 입력하세요.', 'error');
      return;
    }
    if (endDate && endTime && !validTime(endTime)) {
      toast.show('종료 시각은 HH:MM 형식으로 입력하세요.', 'error');
      return;
    }
    setSaving(true);
    try {
      await apiJson(`/api/sales/projects/${project.id}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activityType: type,
          status: 'planned',
          // 데스크탑과 같은 KST 벽시계 문자열. 시간을 비우면 00:00(웹 withDate 규칙).
          scheduledAt: `${startDate}T${startTime || '00:00'}`,
          endedAt: endDate ? `${endDate}T${endTime || '00:00'}` : null,
          place: showPlace ? place.trim() || null : null,
          summary: summary.trim() || null,
          contactPersonIds: [],
          assignees: [],
        }),
      });
      toast.show('일정을 등록했습니다.', 'success');
      reset();
      onCreated();
      onClose();
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Sheet
        visible={visible && !picking}
        onClose={onClose}
        title="영업 일정 등록"
        footer={<View className="flex-1"><GradientButton label="등록" loading={saving} onPress={submit} /></View>}>
        <View className="gap-3.5">
          <View className="gap-1.5">
            <Text className="text-[13px] font-bold text-cd-muted">영업건 *</Text>
            <Pressable
              onPress={() => setPicking('project')}
              className="min-h-[46px] flex-row items-center gap-2 rounded-xl border border-cd-border bg-cd-card px-3.5 active:opacity-70">
              <Ionicons name="briefcase-outline" size={16} color={project ? c.text : c.faint} />
              <View className="flex-1">
                <Text numberOfLines={1} className={`text-[15px] ${project ? 'font-semibold text-cd-text' : 'text-cd-faint'}`}>
                  {project?.title ?? '진행 중 영업건에서 선택'}
                </Text>
                {project?.facility ? (
                  <Text numberOfLines={1} className="text-[11.5px] text-cd-faint">
                    {project.facility}
                  </Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={15} color={c.faint} />
            </Pressable>
          </View>

          <View className="gap-1.5">
            <Text className="text-[13px] font-bold text-cd-muted">일정명 *</Text>
            <View className="flex-row flex-wrap gap-[7px]">
              {ACTIVITY_TYPES.map((t) => (
                <PickChip key={t.code} label={t.label} on={type === t.code} onPress={() => setType(t.code)} />
              ))}
            </View>
          </View>

          <View className="gap-1.5">
            <Text className="text-[13px] font-bold text-cd-muted">일시 (시작 *)</Text>
            <View className="flex-row gap-2">
              <DateButton value={startDate} placeholder="시작일" onPress={() => setPicking('start')} />
              <View style={{ width: 92 }}>
                <Input value={startTime} onChangeText={(t) => setStartTime(maskTime(t))} keyboardType="numeric" placeholder="HHMM" />
              </View>
            </View>
            <View className="flex-row gap-2">
              <DateButton value={endDate} placeholder="종료일 (선택)" onPress={() => setPicking('end')} onClear={endDate ? () => { setEndDate(null); setEndTime(''); } : undefined} />
              <View style={{ width: 92 }}>
                <Input value={endTime} onChangeText={(t) => setEndTime(maskTime(t))} keyboardType="numeric" placeholder="HHMM" editable={!!endDate} />
              </View>
            </View>
          </View>

          {showPlace ? <Input label="장소" value={place} onChangeText={setPlace} placeholder="도로명 주소" /> : null}

          <Textarea
            label={`업무상세 (${summary.length}/100)`}
            minHeight={64}
            maxLength={100}
            value={summary}
            onChangeText={setSummary}
            placeholder="100자 이내"
          />
        </View>
      </Sheet>

      <EntityPickerSheet
        visible={visible && picking === 'project'}
        kind="project"
        onSelect={(opt: EntityOption) => setProject({ id: opt.id, title: opt.label, facility: opt.sub ?? '' })}
        onClose={() => setPicking(null)}
      />
      <DatePickerSheet
        visible={visible && picking === 'start'}
        title="시작일 선택"
        value={startDate}
        onConfirm={(d) => setStartDate(d)}
        onClose={() => setPicking(null)}
      />
      <DatePickerSheet
        visible={visible && picking === 'end'}
        title="종료일 선택"
        value={endDate ?? startDate}
        onConfirm={(d) => setEndDate(d)}
        onClose={() => setPicking(null)}
      />
    </>
  );
}

/** 날짜 표시 버튼 — 탭하면 공용 월 캘린더 픽커(P0-1)가 열린다. */
function DateButton({
  value,
  placeholder,
  onPress,
  onClear,
}: {
  value: string | null;
  placeholder: string;
  onPress: () => void;
  onClear?: () => void;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      className="min-h-[46px] flex-1 flex-row items-center gap-2 rounded-xl border border-cd-border bg-cd-card px-3.5 active:opacity-70">
      <Ionicons name="calendar-outline" size={16} color={value ? c.text : c.faint} />
      <Text className={`flex-1 text-[15px] ${value ? 'font-semibold text-cd-text' : 'text-cd-faint'}`}>
        {value ?? placeholder}
      </Text>
      {onClear ? (
        <Pressable hitSlop={8} onPress={onClear}>
          <Ionicons name="close-circle" size={17} color={c.faint} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}
