import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Badge, EmptyState, SkeletonList } from '@/components/ui';
import { useApi } from '@/lib/use-api';
import { fmtDate } from '@/lib/format';
import { useTheme } from '@/theme/useTheme';

interface BoardPost {
  postId: string;
  title: string;
  authorName: string | null;
  deptName: string | null;
  createdAt: string;
  unread?: boolean;
  pinnedNow?: boolean;
  expired?: boolean;
  attachmentCount?: number;
}

/** 공지·부서 게시판 목록. 상세는 /board/[postId](M1 에서 만든 화면)로 간다. */
export function BoardList({ scope }: { scope: 'company' | 'dept' }) {
  const router = useRouter();
  const { c } = useTheme();
  const { data, loading, refreshing, error, reload } = useApi<{
    posts: BoardPost[];
    deptId: string | null;
    message?: string;
  }>(`/api/board?scope=${scope}`, { cache: true });

  const posts = data?.posts ?? [];

  if (loading && !posts.length) {
    return (
      <View className="p-4">
        <SkeletonList count={3} />
      </View>
    );
  }

  return (
    <FlatList
      data={posts}
      keyExtractor={(p) => p.postId}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} />}
      ListEmptyComponent={
        error ? (
          <EmptyState icon="alert-circle-outline" title="불러오지 못했습니다" description={error} />
        ) : (
          <EmptyState
            icon="megaphone-outline"
            title={scope === 'company' ? '등록된 공지가 없습니다' : '부서 게시글이 없습니다'}
            description={data?.message ?? undefined}
          />
        )
      }
      renderItem={({ item }) => (
        <Pressable
          onPress={() => router.push({ pathname: '/board/[postId]', params: { postId: item.postId } })}
          className="gap-1 border-b border-cd-border px-4 py-3.5 active:bg-cd-surface">
          <View className="flex-row items-center gap-1.5">
            {item.pinnedNow ? <Badge label="고정" tone="primary" /> : null}
            {item.expired ? <Badge label="종료" tone="warning" /> : null}
            {item.unread ? <View className="h-1.5 w-1.5 rounded-full bg-cd-primary" /> : null}
            <Text
              numberOfLines={2}
              className={`flex-1 text-[15px] leading-5 ${
                item.unread ? 'font-extrabold text-cd-text' : 'text-cd-muted'
              }`}>
              {item.title}
            </Text>
            {item.attachmentCount ? <Ionicons name="attach" size={14} color={c.faint} /> : null}
          </View>
          <Text className="text-[12px] text-cd-faint">
            {item.authorName ?? '-'}
            {item.deptName ? ` · ${item.deptName}` : ''} · {fmtDate(item.createdAt)}
          </Text>
        </Pressable>
      )}
    />
  );
}
