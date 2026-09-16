import { useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Badge, EmptyState, Screen, SkeletonList } from '@/components/ui';
import { useApi } from '@/lib/use-api';
import { useTheme } from '@/theme/useTheme';

/**
 * 사내 설문(참여) — 웹 /survey/internal 의 "참여할 설문" 과 같은 목록.
 * 외부 설문(구글 폼·QR 배포)은 모바일에 넣지 않는다(작성자 전용 기능).
 * 서버는 /api/survey/my 가 접수 중 · 대상자 · 응답 여부까지 걸러서 내려준다.
 */
interface SurveyRow {
  surveyId: string;
  title: string;
  description: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  isAnonymous: boolean;
  questionCount?: number;
  respondedAt?: string | null;
}

const dot = (d: string) => d.replace(/-/g, '.').replace(/^20/, '');

function period(s: SurveyRow): string {
  if (s.periodStart && s.periodEnd) return `${dot(s.periodStart)} ~ ${dot(s.periodEnd)}`;
  if (s.periodEnd) return `~ ${dot(s.periodEnd)}`;
  if (s.periodStart) return `${dot(s.periodStart)} ~`;
  return '상시 접수';
}

export default function SurveysScreen() {
  const { c } = useTheme();
  const router = useRouter();
  const { data, loading, refreshing, reload } = useApi<{ surveys: SurveyRow[] }>('/api/survey/my', { cache: true });
  const surveys = data?.surveys ?? [];

  // 응답을 마치고 돌아오면 목록의 "응답 완료" 표시가 갱신되어야 한다.
  // ⚠ reload 를 의존성에 넣으면 매 렌더마다 재요청이 걸린다(무한 루프 이력).
  useFocusEffect(
    useCallback(() => {
      void reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  return (
    <Screen title="사내 설문" back refreshing={refreshing} onRefresh={reload}>
      {loading && surveys.length === 0 ? (
        <SkeletonList />
      ) : surveys.length === 0 ? (
        <EmptyState icon="clipboard-outline" title="참여할 설문이 없습니다" description="새 설문이 열리면 여기에 표시됩니다." />
      ) : (
        surveys.map((s) => (
          <Pressable
            key={s.surveyId}
            className="rounded-card border border-cd-border bg-cd-card p-4 active:opacity-70"
            onPress={() => router.push(`/survey/${s.surveyId}`)}>
            <View className="flex-row items-start gap-2">
              <Text className="flex-1 text-[15px] font-bold text-cd-text" numberOfLines={2}>
                {s.title}
              </Text>
              {s.respondedAt ? <Badge label="응답 완료" tone="success" /> : <Badge label="참여 가능" tone="primary" />}
            </View>
            {!!s.description && (
              <Text className="mt-1.5 text-[12.5px] text-cd-muted" numberOfLines={2}>
                {s.description}
              </Text>
            )}
            <View className="mt-2.5 flex-row items-center gap-2 border-t border-cd-border pt-2">
              <Ionicons name="calendar-outline" size={13} color={c.faint} />
              <Text className="text-[11.5px] text-cd-faint">{period(s)}</Text>
              <Text className="text-[11.5px] text-cd-faint">·</Text>
              <Text className="text-[11.5px] text-cd-faint">{s.questionCount ?? 0}개 문항</Text>
              {s.isAnonymous && (
                <>
                  <Text className="text-[11.5px] text-cd-faint">·</Text>
                  <Text className="text-[11.5px] text-cd-faint">익명</Text>
                </>
              )}
            </View>
          </Pressable>
        ))
      )}
    </Screen>
  );
}
