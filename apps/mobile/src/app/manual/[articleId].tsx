import { useRef } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { EmptyState, PullRefresh, Screen, SkeletonList } from '@/components/ui';
import { ManualBlocks, ManualInline, type ManualBlock } from '@/components/manual/ManualBlocks';
import { useApi } from '@/lib/use-api';
import { useTheme } from '@/theme/useTheme';

/**
 * 매뉴얼 기사(모바일 4단계) — /api/manual/[articleId] 가 내 권한으로 거른 절만 내려준다.
 * ?section= 이 있으면 그 절이 그려진 뒤 그 위치로 스크롤한다. 절 제목 옆 ↑ 은 기사 맨 위로.
 */
interface ArticleResponse {
  article: {
    id: string;
    title: string;
    summary: string[];
    reviewedAt: string;
    sections: { id: string; title: string; blocks: ManualBlock[] }[];
  };
}

export default function ManualArticleScreen() {
  const { c } = useTheme();
  const router = useRouter();
  const { articleId, section } = useLocalSearchParams<{ articleId: string; section?: string }>();
  const { data, loading, error, refreshing, reload } = useApi<ArticleResponse>(`/api/manual/${encodeURIComponent(articleId ?? '')}`, {
    cache: true,
  });
  const scrollRef = useRef<ScrollView>(null);
  const jumped = useRef(false);
  const article = data?.article;

  const onLink = (target: string, sec?: string) =>
    router.push(sec ? `/manual/${target}?section=${encodeURIComponent(sec)}` : `/manual/${target}`);

  return (
    <Screen title={article?.title ?? '사용 매뉴얼'} subtitle={article ? `업데이트 ${article.reviewedAt}` : undefined} back scroll={false} padded={false}>
      {loading && !article ? (
        <View className="p-4">
          <SkeletonList />
        </View>
      ) : !article ? (
        <EmptyState
          icon="book-outline"
          title="기사를 볼 수 없습니다"
          description={error ?? '권한이 없거나 없어진 기사입니다.'}
        />
      ) : (
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 28 }}
          refreshControl={<PullRefresh refreshing={refreshing} onRefresh={reload} tintColor={c.faint} />}>
          {article.summary.length > 0 ? (
            <View className="gap-1.5 rounded-card border border-cd-border bg-cd-card px-4 py-3">
              <Text className="text-[12px] font-bold text-cd-muted">이 화면에서 할 수 있는 일</Text>
              {article.summary.map((s, i) => (
                <View key={i} className="flex-row gap-2">
                  <Text className="text-[14px] leading-[23px] text-cd-muted">•</Text>
                  <View className="flex-1">
                    <ManualInline text={s} />
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {article.sections.map((s) => (
            <View
              key={s.id}
              className="gap-3"
              onLayout={(e) => {
                if (section && s.id === section && !jumped.current) {
                  jumped.current = true;
                  const y = e.nativeEvent.layout.y;
                  setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true }), 50);
                }
              }}>
              <View className="flex-row items-center gap-1.5 border-b border-cd-border pb-1.5">
                <Text className="flex-1 text-[16px] font-extrabold text-cd-text">{s.title}</Text>
                <Pressable
                  onPress={() => scrollRef.current?.scrollTo({ y: 0, animated: true })}
                  accessibilityLabel="매뉴얼 맨 위로"
                  hitSlop={10}
                  className="h-8 w-8 items-center justify-center rounded-lg active:opacity-60">
                  <Ionicons name="arrow-up" size={16} color={c.faint} />
                </Pressable>
              </View>
              <ManualBlocks blocks={s.blocks} onLink={onLink} />
            </View>
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}
