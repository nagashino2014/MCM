import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { EmptyState, Screen, SearchBar, SkeletonList } from '@/components/ui';
import { useApi } from '@/lib/use-api';
import { useTheme } from '@/theme/useTheme';

/**
 * 사용 매뉴얼(모바일 4단계) — 웹 /manual 과 같은 원본(frontend/content/manual)을 /api/manual 로 받는다.
 * 서버가 내 권한으로 걸러 주므로 앱은 받은 목차·검색 결과를 그대로 그린다.
 * 기사는 웹 화면 기준 설명이라 머리에 그 사실을 한 줄 남긴다.
 */
interface TocChapter {
  id: string;
  title: string;
  group: string;
  articles: { id: string; title: string; summary: string }[];
}
interface ChangelogRow {
  date: string;
  kind: string;
  title: string;
  articles: string[];
}
interface SearchHit {
  articleId: string;
  title: string;
  section: string | null;
  sectionTitle: string | null;
}

export default function ManualScreen() {
  const { c } = useTheme();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  // 입력 250ms 뒤에 검색(글자마다 요청하지 않게)
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const toc = useApi<{ toc: TocChapter[]; changelog: ChangelogRow[] }>('/api/manual', { cache: true });
  const search = useApi<{ hits: SearchHit[] }>(`/api/manual?q=${encodeURIComponent(q)}`, { skip: !q });

  const goArticle = (id: string, section?: string | null) =>
    router.push(section ? `/manual/${id}?section=${encodeURIComponent(section)}` : `/manual/${id}`);

  const chapters = toc.data?.toc ?? [];
  const recent = (toc.data?.changelog ?? []).slice(0, 5);

  return (
    <Screen title="사용 매뉴얼" back refreshing={toc.refreshing} onRefresh={toc.reload}>
      <SearchBar value={query} onChangeText={setQuery} placeholder="기능·버튼 이름 검색 (초성도 됩니다)" />
      <Text className="px-1 text-[12px] leading-[18px] text-cd-faint">
        웹 화면 기준 설명입니다. 모바일 앱에는 없는 기능도 있습니다.
      </Text>

      {q ? (
        search.loading ? (
          <SkeletonList />
        ) : (search.data?.hits ?? []).length === 0 ? (
          <EmptyState icon="search-outline" title="찾는 설명이 없습니다" description="다른 낱말이나 초성으로 찾아 보세요." />
        ) : (
          <View className="rounded-card border border-cd-border bg-cd-card">
            {(search.data?.hits ?? []).map((h, i) => (
              <Pressable
                key={`${h.articleId}-${h.section ?? ''}`}
                onPress={() => goArticle(h.articleId, h.section)}
                className={`flex-row items-center gap-2 px-4 py-3 active:opacity-60 ${i > 0 ? 'border-t border-cd-border' : ''}`}>
                <View className="flex-1">
                  <Text className="text-[14.5px] font-semibold text-cd-text" numberOfLines={1}>
                    {h.title}
                  </Text>
                  {h.sectionTitle ? (
                    <Text className="mt-0.5 text-[12px] text-cd-faint" numberOfLines={1}>
                      {h.sectionTitle}
                    </Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={16} color={c.faint} />
              </Pressable>
            ))}
          </View>
        )
      ) : toc.loading && chapters.length === 0 ? (
        <SkeletonList />
      ) : toc.error && chapters.length === 0 ? (
        <EmptyState icon="book-outline" title="매뉴얼을 불러오지 못했습니다" description="잠시 뒤 당겨서 다시 시도해 주세요." />
      ) : (
        <>
          {recent.length > 0 ? (
            <View className="rounded-card border border-cd-border bg-cd-card px-4 py-3">
              <Text className="pb-1.5 text-[12px] font-bold text-cd-muted">최근 바뀐 점</Text>
              {recent.map((e, i) => (
                <Pressable
                  key={`${e.date}-${e.title}`}
                  disabled={!e.articles[0]}
                  onPress={() => e.articles[0] && goArticle(e.articles[0])}
                  className={`flex-row items-center gap-2 py-2 active:opacity-60 ${i > 0 ? 'border-t border-cd-border' : ''}`}>
                  <Text className="text-[11.5px] text-cd-faint">{e.date.slice(5).replace('-', '.')}</Text>
                  <Text className="text-[11.5px] font-bold text-cd-primary">{e.kind}</Text>
                  <Text className="flex-1 text-[13.5px] text-cd-text" numberOfLines={1}>
                    {e.title.replace(/\[|\]/g, '')}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <View className="rounded-card border border-cd-border bg-cd-card">
            {chapters.map((ch, i) => {
              const expanded = open === ch.id;
              return (
                <View key={ch.id} className={i > 0 ? 'border-t border-cd-border' : ''}>
                  <Pressable
                    onPress={() => setOpen(expanded ? null : ch.id)}
                    accessibilityState={{ expanded }}
                    className="flex-row items-center gap-2 px-4 py-3.5 active:opacity-60">
                    <View className="flex-1">
                      <Text className="text-[15px] font-bold text-cd-text">{ch.title}</Text>
                      <Text className="mt-0.5 text-[11.5px] text-cd-faint">
                        {ch.group} · {ch.articles.length}개
                      </Text>
                    </View>
                    <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={c.faint} />
                  </Pressable>
                  {expanded
                    ? ch.articles.map((a) => (
                        <Pressable
                          key={a.id}
                          onPress={() => goArticle(a.id)}
                          className="flex-row items-center gap-2 border-t border-cd-border bg-cd-surface px-4 py-3 active:opacity-60">
                          <View className="flex-1">
                            <Text className="text-[14px] font-semibold text-cd-text">{a.title}</Text>
                            {a.summary ? (
                              <Text className="mt-0.5 text-[12px] leading-[18px] text-cd-muted" numberOfLines={2}>
                                {a.summary.replace(/\[\[(.+?)\]\]/g, '$1').replace(/\*\*(.+?)\*\*/g, '$1')}
                              </Text>
                            ) : null}
                          </View>
                          <Ionicons name="chevron-forward" size={16} color={c.faint} />
                        </Pressable>
                      ))
                    : null}
                </View>
              );
            })}
          </View>
        </>
      )}
    </Screen>
  );
}
