import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Badge, Button, Screen, SkeletonList, useToast } from '@/components/ui';
import { apiJson } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useTheme } from '@/theme/useTheme';

/**
 * 사내 설문 응답(모바일) — 웹 /survey/internal/[surveyId]/respond 와 같은 규칙.
 * 1인 1회 제출이라 이미 응답한 설문은 완료 안내만 보여준다. 제출 후 수정은 없다.
 */
type QuestionType = 'single' | 'multi' | 'scale' | 'text' | 'longtext' | 'section';

interface Question {
  questionId: string;
  qtype: QuestionType;
  title: string;
  helpText: string | null;
  isRequired: boolean;
  options: { value: string; label: string }[];
  config: { min?: number; max?: number; minLabel?: string; maxLabel?: string; allowOther?: boolean; maxSelect?: number };
}

interface LoadState {
  survey: { surveyId: string; title: string; description: string | null; isAnonymous: boolean; questions: Question[] };
  open: boolean;
  myResponse: { responseId: string; submittedAt: string } | null;
}

const OTHER = '__other__';
type AnswerValue = string | string[] | number;

export default function SurveyRespondScreen() {
  const { c } = useTheme();
  const toast = useToast();
  const router = useRouter();
  const { surveyId } = useLocalSearchParams<{ surveyId: string }>();
  const { data, loading, error, refreshing, reload } = useApi<LoadState>(`/api/survey/surveys/${surveyId}/responses`);

  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [showMissing, setShowMissing] = useState(false);

  const questions = data?.survey.questions ?? [];
  const answerable = useMemo(() => questions.filter((q) => q.qtype !== 'section'), [questions]);

  const missing = useMemo(
    () =>
      answerable.filter((q) => {
        if (!q.isRequired) return false;
        const v = answers[q.questionId];
        if (v == null) return true;
        if (Array.isArray(v)) return v.length === 0;
        if (typeof v === 'string') return v.trim() === '' || v === `${OTHER}:`;
        return false;
      }),
    [answerable, answers]
  );

  const set = (questionId: string, value: AnswerValue) => setAnswers((prev) => ({ ...prev, [questionId]: value }));

  const submit = async () => {
    if (missing.length > 0) {
      setShowMissing(true);
      toast.show(`필수 문항 ${missing.length}개가 비어 있습니다.`, 'error');
      return;
    }
    setSubmitting(true);
    try {
      await apiJson(`/api/survey/surveys/${surveyId}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers, source: 'mobile' }),
      });
      setDone(true);
      toast.show('응답을 제출했습니다.', 'success');
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !data) {
    return (
      <Screen title="설문" back>
        <SkeletonList />
      </Screen>
    );
  }

  if (error || !data) {
    return (
      <Screen title="설문" back refreshing={refreshing} onRefresh={reload}>
        <View className="rounded-card border border-cd-border bg-cd-card p-5">
          <Text className="text-[14px] text-cd-text">{error ?? '설문을 불러오지 못했습니다.'}</Text>
        </View>
      </Screen>
    );
  }

  const already = done || !!data.myResponse;

  return (
    <Screen title={data.survey.title} back refreshing={refreshing} onRefresh={reload}>
      {!!data.survey.description && !already && (
        <View className="rounded-card border border-cd-border bg-cd-card p-4">
          <Text className="text-[13px] leading-5 text-cd-text">{data.survey.description}</Text>
          {data.survey.isAnonymous && (
            <View className="mt-2 flex-row">
              <Badge label="익명 설문" tone="neutral" />
            </View>
          )}
        </View>
      )}

      {already ? (
        <View className="items-center rounded-card border border-cd-border bg-cd-card p-6">
          <Ionicons name="checkmark-circle" size={40} color={c.success} />
          <Text className="mt-2 text-[15px] font-bold text-cd-text">응답이 제출되었습니다</Text>
          <Text className="mt-1 text-center text-[12.5px] text-cd-muted">
            참여해 주셔서 감사합니다. 제출한 응답은 수정할 수 없습니다.
          </Text>
          <View className="mt-4 w-full">
            <Button label="설문 목록으로" onPress={() => router.replace('/surveys')} />
          </View>
        </View>
      ) : !data.open ? (
        <View className="rounded-card border border-cd-border bg-cd-card p-5">
          <Text className="text-[14px] text-cd-text">지금은 응답을 받지 않는 설문입니다.</Text>
        </View>
      ) : (
        <>
          {questions.map((q) => {
            if (q.qtype === 'section') {
              return (
                <View key={q.questionId} className="pt-2">
                  <Text className="text-[15px] font-extrabold text-cd-text">{q.title}</Text>
                  {!!q.helpText && <Text className="mt-1 text-[12.5px] text-cd-muted">{q.helpText}</Text>}
                </View>
              );
            }
            const idx = answerable.findIndex((a) => a.questionId === q.questionId);
            const invalid = showMissing && missing.some((m) => m.questionId === q.questionId);
            return (
              <View
                key={q.questionId}
                className="rounded-card border bg-cd-card p-4"
                style={{ borderColor: invalid ? c.error : c.border }}>
                <Text className="text-[14px] font-bold text-cd-text">
                  <Text className="text-cd-faint">{idx + 1}. </Text>
                  {q.title}
                  {q.isRequired && <Text style={{ color: c.error }}> *</Text>}
                </Text>
                {!!q.helpText && <Text className="mt-1 text-[12px] text-cd-muted">{q.helpText}</Text>}

                <View className="mt-3 gap-2">
                  {q.qtype === 'single' &&
                    q.options.map((o) => {
                      const on = String(answers[q.questionId] ?? '').split(':')[0] === o.value;
                      return (
                        <Pressable
                          key={o.value}
                          className="flex-row items-center gap-2 active:opacity-70"
                          onPress={() => set(q.questionId, o.value)}>
                          <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? c.primary : c.faint} />
                          <Text className="flex-1 text-[13.5px] text-cd-text">{o.label}</Text>
                        </Pressable>
                      );
                    })}

                  {q.qtype === 'single' && q.config.allowOther && (
                    <View className="flex-row items-center gap-2">
                      <Pressable
                        onPress={() => set(q.questionId, `${OTHER}:`)}
                        className="flex-row items-center gap-2 active:opacity-70">
                        <Ionicons
                          name={String(answers[q.questionId] ?? '').startsWith(OTHER) ? 'radio-button-on' : 'radio-button-off'}
                          size={20}
                          color={String(answers[q.questionId] ?? '').startsWith(OTHER) ? c.primary : c.faint}
                        />
                        <Text className="text-[13.5px] text-cd-text">기타</Text>
                      </Pressable>
                      <TextInput
                        className="flex-1 rounded-lg border border-cd-border bg-cd-bg px-3 py-2 text-[13.5px] text-cd-text"
                        placeholder="직접 입력"
                        placeholderTextColor={c.faint}
                        value={String(answers[q.questionId] ?? '').startsWith(`${OTHER}:`) ? String(answers[q.questionId]).slice(OTHER.length + 1) : ''}
                        onChangeText={(t) => set(q.questionId, `${OTHER}:${t}`)}
                      />
                    </View>
                  )}

                  {q.qtype === 'multi' &&
                    q.options.map((o) => {
                      const picked = Array.isArray(answers[q.questionId]) ? (answers[q.questionId] as string[]) : [];
                      const on = picked.includes(o.value);
                      return (
                        <Pressable
                          key={o.value}
                          className="flex-row items-center gap-2 active:opacity-70"
                          onPress={() => set(q.questionId, on ? picked.filter((v) => v !== o.value) : [...picked, o.value])}>
                          <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? c.primary : c.faint} />
                          <Text className="flex-1 text-[13.5px] text-cd-text">{o.label}</Text>
                        </Pressable>
                      );
                    })}
                  {q.qtype === 'multi' && !!q.config.maxSelect && (
                    <Text className="text-[11.5px] text-cd-faint">최대 {q.config.maxSelect}개 선택</Text>
                  )}

                  {q.qtype === 'scale' && (
                    <View>
                      <View className="flex-row flex-wrap gap-2">
                        {Array.from(
                          { length: (q.config.max ?? 5) - (q.config.min ?? 1) + 1 },
                          (_, i) => (q.config.min ?? 1) + i
                        ).map((n) => {
                          const on = answers[q.questionId] === n;
                          return (
                            <Pressable
                              key={n}
                              className="h-11 w-11 items-center justify-center rounded-lg border active:opacity-70"
                              style={{ borderColor: on ? c.primary : c.border, backgroundColor: on ? c.primarySoft : 'transparent' }}
                              onPress={() => set(q.questionId, n)}>
                              <Text className="text-[14px] font-bold" style={{ color: on ? c.primary : c.muted }}>
                                {n}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      {(!!q.config.minLabel || !!q.config.maxLabel) && (
                        <View className="mt-1.5 flex-row justify-between">
                          <Text className="text-[11.5px] text-cd-faint">{q.config.minLabel ?? ''}</Text>
                          <Text className="text-[11.5px] text-cd-faint">{q.config.maxLabel ?? ''}</Text>
                        </View>
                      )}
                    </View>
                  )}

                  {(q.qtype === 'text' || q.qtype === 'longtext') && (
                    <TextInput
                      className="rounded-lg border border-cd-border bg-cd-bg px-3 py-2 text-[13.5px] text-cd-text"
                      multiline={q.qtype === 'longtext'}
                      style={q.qtype === 'longtext' ? { minHeight: 96, textAlignVertical: 'top' } : undefined}
                      maxLength={q.qtype === 'longtext' ? 5000 : 500}
                      placeholder="답변을 입력하세요"
                      placeholderTextColor={c.faint}
                      value={String(answers[q.questionId] ?? '')}
                      onChangeText={(t) => set(q.questionId, t)}
                    />
                  )}
                </View>
              </View>
            );
          })}

          <View className="pb-8 pt-1">
            <Button
              label={submitting ? '제출 중…' : '응답 제출'}
              variant="primary"
              disabled={submitting}
              onPress={() => void submit()}
            />
            <Text className="mt-2 text-center text-[11.5px] text-cd-faint">제출 후에는 수정할 수 없습니다.</Text>
          </View>
        </>
      )}
    </Screen>
  );
}
