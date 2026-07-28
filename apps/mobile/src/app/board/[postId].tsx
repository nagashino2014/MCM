import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';

import { Badge, EmptyState, HtmlView, Screen, SkeletonList, useToast } from '@/components/ui';
import { useApi } from '@/lib/use-api';
import { API_BASE_URL } from '@/lib/config';
import { getAccessToken } from '@/lib/tokens';
import { fmtDate } from '@/lib/format';
import { useTheme } from '@/theme/useTheme';

interface Attachment {
  attachmentId: string;
  fileName: string;
  contentType: string | null;
  byteSize: number | null;
  storageKey: string;
}
interface Post {
  postId: string;
  scope: 'company' | 'dept';
  deptName: string | null;
  title: string;
  bodyHtml: string;
  authorName: string | null;
  createdAt: string;
  pinnedNow?: boolean;
  expired?: boolean;
  attachments?: Attachment[];
}

const fmtSize = (n?: number | null) =>
  !n ? '' : n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(n / 1024)}KB`;

/**
 * 공지·게시글 상세(읽기) — 푸시 딥링크의 도착 지점.
 * 조회하면 서버가 읽음 처리까지 한다(GET /api/board/[postId]).
 * 목록·작성은 M4(소통 탭)에서 붙인다.
 */
export default function BoardPostScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const { c } = useTheme();
  const toast = useToast();
  const [downloading, setDownloading] = useState<string | null>(null);

  const { data, loading, error, refreshing, reload } = useApi<{ post: Post }>(
    `/api/board/${postId}`,
    { cache: true }
  );
  const post = data?.post;

  const openAttachment = async (a: Attachment) => {
    setDownloading(a.attachmentId);
    try {
      // ⚠ SDK 57 의 `FileSystem.downloadAsync` 는 런타임에 throw 한다(deprecated).
      //   Bearer 헤더가 필요하므로 createDownloadTask 경로를 쓴다.
      const token = await getAccessToken();
      const dest = new File(Paths.cache, a.fileName);
      if (dest.exists) dest.delete();
      const task = File.createDownloadTask(
        `${API_BASE_URL}/api/board/attachments?key=${encodeURIComponent(a.storageKey)}`,
        dest,
        { headers: token ? { Authorization: `Bearer ${token}` } : undefined }
      );
      const out = await task.downloadAsync();
      const uri = out?.uri ?? dest.uri;
      if (!dest.exists) throw new Error('첨부를 내려받지 못했습니다.');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: a.contentType ?? undefined });
      } else {
        toast.show('이 기기에서는 첨부를 열 수 없습니다.', 'error');
      }
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <Screen scroll refreshing={refreshing} onRefresh={reload}>
      {loading && !post ? (
        <SkeletonList count={2} />
      ) : error && !post ? (
        <EmptyState icon="alert-circle-outline" title="글을 불러오지 못했습니다" description={error} />
      ) : !post ? (
        <EmptyState icon="document-outline" title="게시글이 없습니다" />
      ) : (
        <>
          <View className="gap-2 rounded-card border border-cd-border bg-cd-card p-4">
            <View className="flex-row flex-wrap items-center gap-1.5">
              <Badge
                label={post.scope === 'company' ? '전사 공지' : (post.deptName ?? '부서 게시판')}
                tone={post.scope === 'company' ? 'primary' : 'neutral'}
              />
              {post.pinnedNow ? <Badge label="상단 고정" tone="secondary" /> : null}
              {post.expired ? <Badge label="게시 종료" tone="warning" /> : null}
            </View>
            <Text className="text-[19px] font-extrabold leading-7 text-cd-text">{post.title}</Text>
            <Text className="text-[12px] text-cd-faint">
              {post.authorName ?? '-'} · {fmtDate(post.createdAt)}
            </Text>
          </View>

          <View className="overflow-hidden rounded-card border border-cd-border bg-cd-card px-3 py-2">
            <HtmlView html={post.bodyHtml || '<p></p>'} />
          </View>

          {post.attachments?.length ? (
            <View className="gap-2 rounded-card border border-cd-border bg-cd-card p-4">
              <Text className="text-[13px] font-bold text-cd-muted">
                첨부 {post.attachments.length}
              </Text>
              {post.attachments.map((a) => (
                <Pressable
                  key={a.attachmentId}
                  onPress={() => openAttachment(a)}
                  className="min-h-[44px] flex-row items-center gap-2 rounded-xl border border-cd-border px-3 py-2 active:opacity-70">
                  <Ionicons name="document-attach-outline" size={18} color={c.primary} />
                  <Text numberOfLines={1} className="flex-1 text-[13px] text-cd-text">
                    {a.fileName}
                  </Text>
                  {downloading === a.attachmentId ? (
                    <ActivityIndicator size="small" />
                  ) : (
                    <Text className="text-[11px] text-cd-faint">{fmtSize(a.byteSize)}</Text>
                  )}
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}
