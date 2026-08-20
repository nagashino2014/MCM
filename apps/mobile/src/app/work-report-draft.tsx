import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { DatePickerSheet } from '@/components/calendar/DatePickerSheet';
import { Button, GradientButton, Input, ScreenHeader, SkeletonList, Textarea, useToast } from '@/components/ui';
import { apiFetch, apiJson } from '@/lib/api';
import { useTheme } from '@/theme/useTheme';

/**
 * 업무보고 작성(WR-M1·M2) — 모바일 경량 작성: 기간·회의 종류·제목·추진내역·추진계획만 받는다.
 * 용역(contract)·Task 둘 다 지원한다(subjectKind 파라미터).
 * 공정 델타(stages)는 웹 전용 — 수정 시에는 **기존 stages 를 그대로 되돌려 보낸다**
 * (saveReport 가 수정 때 stages 를 전량 교체하므로, 빈 배열을 보내면 웹에서 넣은 델타가 지워진다).
 * 저장 계약: POST /api/work-plan/report (SaveReportInput, subjectKind='contract').
 */

const MEETING_LABELS = ['주간회의', '간부간담회'] as const;

interface StageInput {
  stageOrder: number;
  stageCode?: string | null;
  stageName: string;
  status: 'pending' | 'in_progress' | 'done';
  progressPct?: number | null;
  plannedDate?: string | null;
  actualDate?: string | null;
}
interface ReportDetail {
  reportId: string;
  contractId: string | null;
  taskId: string | null;
  periodStart: string;
  periodEnd: string;
  meetingLabel: string | null;
  title: string | null;
  progressText: string | null;
  planText: string | null;
  currentStageName: string | null;
  currentStagePct: number | null;
  stages: (StageInput & { rowId: string })[];
}

/** 이번 주 월~금(KST) — 주간 보고의 기본 기간. */
function thisWeek(): { from: string; to: string } {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const dow = now.getUTCDay(); // 0=일
  const mon = new Date(now);
  mon.setUTCDate(now.getUTCDate() - ((dow + 6) % 7));
  const fri = new Date(mon);
  fri.setUTCDate(mon.getUTCDate() + 4);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(mon), to: iso(fri) };
}

export default function WorkReportDraftScreen() {
  const router = useRouter();
  const { c } = useTheme();
  const toast = useToast();
  const params = useLocalSearchParams<{
    reportId?: string;
    subjectKind?: string;
    subjectId?: string;
    subjectTitle?: string;
    // 구 파라미터(WR-M1 초기) 호환
    contractId?: string;
    contractTitle?: string;
  }>();
  const [subjectKind, setSubjectKind] = useState<'contract' | 'task'>(params.subjectKind === 'task' ? 'task' : 'contract');
  const editingId = params.reportId || null;

  const [loading, setLoading] = useState(!!editingId);
  // 기본 기간(이번 주 월~금) — lazy initializer 로 1회만 계산한다.
  const [from, setFrom] = useState(() => thisWeek().from);
  const [to, setTo] = useState(() => thisWeek().to);
  const [meeting, setMeeting] = useState<string>(MEETING_LABELS[0]);
  const [title, setTitle] = useState('');
  const [progressText, setProgressText] = useState('');
  const [planText, setPlanText] = useState('');
  const [datePicker, setDatePicker] = useState(false);
  const [saving, setSaving] = useState<'draft' | 'submitted' | null>(null);
  // 수정 시 되돌려 보낼 원본 값(공정 델타·현재 공정) — 모바일에서는 편집하지 않는다.
  const keepRef = useRef<{ stages: StageInput[]; currentStageName: string | null; currentStagePct: number | null }>({
    stages: [],
    currentStageName: null,
    currentStagePct: null,
  });
  const [subjectId, setSubjectId] = useState(params.subjectId || params.contractId || '');

  // 수정 진입 — 기존 보고 프리필(1회).
  useEffect(() => {
    if (!editingId) return;
    let alive = true;
    void apiJson<{ report: ReportDetail }>(`/api/work-plan/report/${editingId}`)
      .then(({ report }) => {
        if (!alive) return;
        const isTask = !!report.taskId;
        setSubjectKind(isTask ? 'task' : 'contract');
        setSubjectId((isTask ? report.taskId : report.contractId) ?? '');
        setFrom(report.periodStart);
        setTo(report.periodEnd);
        setMeeting(report.meetingLabel ?? MEETING_LABELS[0]);
        setTitle(report.title ?? '');
        setProgressText(report.progressText ?? '');
        setPlanText(report.planText ?? '');
        keepRef.current = {
          stages: report.stages.map(({ rowId: _rowId, ...s }) => s),
          currentStageName: report.currentStageName,
          currentStagePct: report.currentStagePct,
        };
      })
      .catch((e) => toast.show((e as Error).message, 'error'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  const save = async (status: 'draft' | 'submitted') => {
    if (!subjectId) {
      toast.show('대상 정보가 없습니다. 목록에서 다시 진입해 주세요.', 'error');
      return;
    }
    if (status === 'submitted' && !progressText.trim()) {
      toast.show('추진 내역을 입력하세요.', 'error');
      return;
    }
    setSaving(status);
    try {
      const res = await apiFetch('/api/work-plan/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId: editingId ?? undefined,
          subjectKind,
          subjectId,
          periodStart: from,
          periodEnd: to,
          reportDate: to,
          meetingLabel: meeting,
          title: title.trim() || null,
          status,
          progressText: progressText.trim() || null,
          planText: planText.trim() || null,
          currentStageName: keepRef.current.currentStageName,
          currentStagePct: keepRef.current.currentStagePct,
          stages: keepRef.current.stages,
        }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      toast.show(status === 'submitted' ? '보고를 제출했습니다.' : '임시저장했습니다.', 'success');
      router.back();
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setSaving(null);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-cd-bg">
      <ScreenHeader
        title={editingId ? '보고 수정' : '보고 작성'}
        subtitle={params.subjectTitle || params.contractTitle || '업무보고'}
        back
        variant="sub"
      />
      {loading ? (
        <View className="px-4 pt-2">
          <SkeletonList count={3} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingTop: 8, gap: 14, paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled">
          <View className="gap-1.5">
            <Text className="text-[13px] font-bold text-cd-muted">보고 기간</Text>
            <Pressable
              onPress={() => setDatePicker(true)}
              className="min-h-[46px] flex-row items-center justify-between rounded-xl border border-cd-border bg-cd-card px-3.5 active:opacity-70">
              <Text className="text-[15px] font-semibold text-cd-text">
                {from} ~ {to}
              </Text>
              <Ionicons name="calendar-outline" size={17} color={c.muted} />
            </Pressable>
          </View>

          <View className="gap-1.5">
            <Text className="text-[13px] font-bold text-cd-muted">회의 종류</Text>
            <View className="flex-row gap-2">
              {MEETING_LABELS.map((m) => (
                <Pressable
                  key={m}
                  onPress={() => setMeeting(m)}
                  className={`rounded-full border px-4 py-2 active:opacity-70 ${
                    meeting === m ? 'border-cd-primary bg-cd-primary-soft' : 'border-cd-border bg-cd-card'
                  }`}>
                  <Text className={`text-[13px] font-bold ${meeting === m ? 'text-cd-primary' : 'text-cd-muted'}`}>
                    {m}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <Input label="제목 (선택)" value={title} onChangeText={setTitle} placeholder="비우면 기간으로 표시됩니다" />
          <Textarea
            label="추진 내역 (이번 기간) *"
            minHeight={120}
            value={progressText}
            onChangeText={setProgressText}
            placeholder="이번 기간에 수행한 업무를 작성하세요"
          />
          <Textarea
            label="추진 계획 (다음 기간)"
            minHeight={100}
            value={planText}
            onChangeText={setPlanText}
            placeholder="다음 기간 계획을 작성하세요"
          />
          <Text className="text-[11.5px] leading-4 text-cd-faint">
            공정 단계(진행률) 갱신은 웹 업무보고 화면에서 입력합니다 — 모바일 수정 시 기존 공정 입력은 그대로
            유지됩니다.
          </Text>

          <View className="flex-row gap-2">
            <View className="flex-1">
              <Button
                label="임시저장"
                variant="ghost"
                loading={saving === 'draft'}
                disabled={!!saving}
                onPress={() => void save('draft')}
                full
              />
            </View>
            <View className="flex-[2]">
              <GradientButton label="제출" loading={saving === 'submitted'} onPress={() => void save('submitted')} />
            </View>
          </View>
        </ScrollView>
      )}

      <DatePickerSheet
        visible={datePicker}
        title="보고 기간 선택"
        mode="range"
        value={from}
        valueTo={to}
        onConfirm={(f, t) => {
          setFrom(f);
          setTo(t || f);
          setDatePicker(false);
        }}
        onClose={() => setDatePicker(false)}
      />
    </SafeAreaView>
  );
}
