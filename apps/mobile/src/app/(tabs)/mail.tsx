import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';

import {
  Avatar,
  Button,
  EmptyState,
  IconButton,
  ListFooter,
  Screen,
  SearchBar,
  Sheet,
  SkeletonList,
  useToast,
} from '@/components/ui';
import { apiJson } from '@/lib/api';
import { useApi, useInfiniteApi } from '@/lib/use-api';
import { useNavBadges } from '@/lib/use-nav-badges';
import { useTheme } from '@/theme/useTheme';

export interface MailItem {
  messageId: string;
  subject: string;
  snippet: string;
  fromAddr: string | null;
  toAddrs: { name?: string; address: string }[];
  hasAttachments: boolean;
  sentAt: string | null;
  createdAt: string;
  isRead: boolean;
  isStarred: boolean;
}

interface FolderInfo {
  folderId: string;
  name: string;
  systemKind: string | null;
  unread: number;
  total: number;
}

/** 시스템 폴더 아이콘 — 사용자 폴더는 기본 폴더 아이콘. */
const FOLDER_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  inbox: 'mail-outline',
  sent: 'send-outline',
  drafts: 'document-outline',
  archive: 'archive-outline',
  spam: 'alert-circle-outline',
  trash: 'trash-outline',
};

/** 보낸 사람 표기 — "이름 <주소>" 형태면 이름만, 아니면 주소 로컬파트. */
export function displayFrom(addr: string | null): string {
  if (!addr) return '(발신자 없음)';
  const m = /^\s*"?([^"<]+?)"?\s*<([^>]+)>\s*$/.exec(addr);
  if (m) return m[1].trim();
  return addr.split('@')[0];
}

/** 오늘이면 시각, 올해면 월/일, 그 외 연-월-일. 그룹웨어 메일 관례. */
export function mailDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  if (d.toDateString() === now.toDateString()) return `${p(d.getHours())}:${p(d.getMinutes())}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}`;
}

// 메일 탭(M3) — 폴더 선택 + 목록. 상세는 /mail/[messageId], 작성은 /mail/compose.
export default function MailScreen() {
  const router = useRouter();
  const toast = useToast();
  const { c } = useTheme();
  const badges = useNavBadges();

  const [folder, setFolder] = useState('inbox');
  const [folderOpen, setFolderOpen] = useState(false);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  /** 롱프레스로 연 단건 액션 시트 대상. */
  const [actionOn, setActionOn] = useState<MailItem | null>(null);

  const folders = useApi<{ folders: FolderInfo[]; address: string | null }>('/api/mail/folders', {
    cache: true,
  });

  const path = useCallback(
    (offset: number) =>
      `/api/mail/messages?folder=${encodeURIComponent(folder)}&limit=30&offset=${offset}` +
      (query ? `&q=${encodeURIComponent(query)}` : ''),
    [folder, query]
  );
  const list = useInfiniteApi<MailItem, { items: MailItem[]; total: number }>(
    path,
    (r) => r.items ?? [],
    30
  );

  useFocusEffect(
    useCallback(() => {
      list.reload();
      folders.reload();
      badges.reload();
      // 훅 반환 객체는 매 렌더 새로 만들어지므로 폴더/검색어만 의존한다.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [folder, query])
  );

  const current = useMemo(
    () => folders.data?.folders?.find((f) => (f.systemKind ?? f.folderId) === folder),
    [folders.data, folder]
  );

  /** 목록에서 바로 읽음 처리(뷰어 진입 시 서버가 처리하지만, 낙관적 갱신으로 즉시 반영). */
  const markRead = (messageId: string) => {
    list.setItems((prev) =>
      prev.map((m) => (m.messageId === messageId ? { ...m, isRead: true } : m))
    );
  };

  const toggleStar = async (m: MailItem) => {
    const next = !m.isStarred;
    list.setItems((prev) =>
      prev.map((x) => (x.messageId === m.messageId ? { ...x, isStarred: next } : x))
    );
    try {
      await apiJson('/api/mail/messages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [m.messageId], action: next ? 'star' : 'unstar' }),
      });
    } catch (e) {
      toast.show((e as Error).message, 'error');
      list.setItems((prev) =>
        prev.map((x) => (x.messageId === m.messageId ? { ...x, isStarred: !next } : x))
      );
    }
  };

  /** 단건 액션(읽음/보관/삭제 등) — 처리 후 목록에서 제거하거나 상태만 바꾼다. */
  const runAction = async (m: MailItem, action: string) => {
    setActionOn(null);
    const removes = action === 'trash' || action === 'archive' || action === 'delete';
    const before = list.items;
    list.setItems((prev) =>
      removes
        ? prev.filter((x) => x.messageId !== m.messageId)
        : prev.map((x) =>
            x.messageId === m.messageId ? { ...x, isRead: action === 'read' } : x
          )
    );
    try {
      await apiJson('/api/mail/messages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [m.messageId], action }),
      });
      folders.reload();
      badges.reload();
    } catch (e) {
      toast.show((e as Error).message, 'error');
      list.setItems(before); // 실패 시 되돌린다
    }
  };

  return (
    <Screen scroll={false} padded={false}>
      {/* 폴더 선택 + 검색 */}
      <View className="gap-2 border-b border-cd-border bg-cd-card px-4 py-2.5">
        <View className="flex-row items-center gap-2">
          <Pressable
            onPress={() => setFolderOpen(true)}
            className="min-h-[36px] flex-row items-center gap-1.5 rounded-xl border border-cd-border px-3 active:opacity-70">
            <Ionicons
              name={FOLDER_ICON[current?.systemKind ?? ''] ?? 'folder-outline'}
              size={16}
              color={c.primary}
            />
            <Text className="text-[14px] font-bold text-cd-text">{current?.name ?? '받은편지함'}</Text>
            {current?.unread ? (
              <Text className="text-[12px] font-extrabold text-cd-primary">{current.unread}</Text>
            ) : null}
            <Ionicons name="chevron-down" size={14} color={c.faint} />
          </Pressable>
          <View className="flex-1" />
          <IconButton icon="create-outline" onPress={() => router.push('/mail/compose')} />
        </View>
        <SearchBar
          value={q}
          onChangeText={setQ}
          onSubmit={() => setQuery(q.trim())}
          placeholder="제목·발신자·본문 검색"
        />
      </View>

      {list.loading && !list.items.length ? (
        <View className="p-4">
          <SkeletonList count={4} />
        </View>
      ) : (
        <FlatList
          data={list.items}
          keyExtractor={(m) => m.messageId}
          refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.reload} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => void list.loadMore()}
          ListFooterComponent={<ListFooter loading={list.loadingMore} end={list.end && list.items.length > 0} />}
          ListEmptyComponent={
            list.error ? (
              <EmptyState icon="alert-circle-outline" title="불러오지 못했습니다" description={list.error} />
            ) : (
              <EmptyState
                icon="mail-open-outline"
                title={query ? '검색 결과가 없습니다' : '메일이 없습니다'}
              />
            )
          }
          renderItem={({ item }) => (
            <MailRow
              item={item}
              folder={folder}
              onPress={() => {
                markRead(item.messageId);
                router.push(`/mail/${item.messageId}`);
              }}
              onLongPress={() => setActionOn(item)}
              onStar={() => void toggleStar(item)}
            />
          )}
        />
      )}

      <Sheet visible={folderOpen} onClose={() => setFolderOpen(false)} title="메일함">
        <View className="gap-1">
          {(folders.data?.folders ?? []).map((f) => {
            const key = f.systemKind ?? f.folderId;
            return (
              <Pressable
                key={f.folderId}
                onPress={() => {
                  setFolder(key);
                  setFolderOpen(false);
                }}
                className={`min-h-[46px] flex-row items-center gap-2.5 rounded-xl px-3 active:opacity-70 ${
                  folder === key ? 'bg-cd-primary-soft' : ''
                }`}>
                <Ionicons
                  name={FOLDER_ICON[f.systemKind ?? ''] ?? 'folder-outline'}
                  size={18}
                  color={folder === key ? c.primary : c.muted}
                />
                <Text
                  className={`flex-1 text-[15px] ${folder === key ? 'font-bold text-cd-primary' : 'text-cd-text'}`}>
                  {f.name}
                </Text>
                {f.unread ? (
                  <Text className="text-[13px] font-extrabold text-cd-primary">{f.unread}</Text>
                ) : (
                  <Text className="text-[12px] text-cd-faint">{f.total || ''}</Text>
                )}
              </Pressable>
            );
          })}
          <View className="mt-2">
            <Button
              label="메일 쓰기"
              icon="create-outline"
              onPress={() => {
                setFolderOpen(false);
                router.push('/mail/compose');
              }}
              full
            />
          </View>
        </View>
      </Sheet>

      {/* 롱프레스 단건 액션 — 스와이프 제스처 대신(제스처 핸들러 도입 없이 안정적으로). */}
      <Sheet
        visible={!!actionOn}
        onClose={() => setActionOn(null)}
        title={actionOn?.subject || '메일'}>
        <View className="gap-1">
          <ActionRow
            icon={actionOn?.isRead ? 'mail-unread-outline' : 'mail-open-outline'}
            label={actionOn?.isRead ? '읽지 않음으로 표시' : '읽음으로 표시'}
            onPress={() => actionOn && void runAction(actionOn, actionOn.isRead ? 'unread' : 'read')}
          />
          {folder !== 'archive' ? (
            <ActionRow
              icon="archive-outline"
              label="보관"
              onPress={() => actionOn && void runAction(actionOn, 'archive')}
            />
          ) : null}
          {folder === 'trash' ? (
            <ActionRow
              icon="refresh-outline"
              label="복원"
              onPress={() => actionOn && void runAction(actionOn, 'restore')}
            />
          ) : (
            <ActionRow
              icon="trash-outline"
              label="휴지통으로"
              danger
              onPress={() => actionOn && void runAction(actionOn, 'trash')}
            />
          )}
        </View>
      </Sheet>
    </Screen>
  );
}

function ActionRow({
  icon,
  label,
  onPress,
  danger,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      className="min-h-[48px] flex-row items-center gap-2.5 rounded-xl px-3 active:bg-cd-surface">
      <Ionicons name={icon} size={18} color={danger ? c.error : c.muted} />
      <Text className={`text-[15px] ${danger ? 'text-cd-error' : 'text-cd-text'}`}>{label}</Text>
    </Pressable>
  );
}

function MailRow({
  item,
  folder,
  onPress,
  onLongPress,
  onStar,
}: {
  item: MailItem;
  folder: string;
  onPress: () => void;
  onLongPress: () => void;
  onStar: () => void;
}) {
  const { c } = useTheme();
  // 보낸편지함·임시보관함은 "받는 사람"을 보여주는 게 맞다.
  const who =
    folder === 'sent' || folder === 'drafts'
      ? (item.toAddrs?.[0]?.name ?? item.toAddrs?.[0]?.address ?? '(수신자 없음)')
      : displayFrom(item.fromAddr);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      className="flex-row gap-3 border-b border-cd-border px-4 py-3 active:bg-cd-surface">
      <Avatar name={who} size="md" />
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-1.5">
          <Text
            numberOfLines={1}
            className={`flex-1 text-[14px] ${item.isRead ? 'text-cd-muted' : 'font-extrabold text-cd-text'}`}>
            {who}
          </Text>
          <Text className="text-[11px] text-cd-faint">{mailDate(item.sentAt ?? item.createdAt)}</Text>
        </View>
        <Text
          numberOfLines={1}
          className={`text-[14px] ${item.isRead ? 'text-cd-muted' : 'font-bold text-cd-text'}`}>
          {item.subject || '(제목 없음)'}
        </Text>
        <View className="flex-row items-center gap-1.5">
          {item.hasAttachments ? (
            <Ionicons name="attach" size={13} color={c.faint} />
          ) : null}
          <Text numberOfLines={1} className="flex-1 text-[12px] text-cd-faint">
            {item.snippet}
          </Text>
        </View>
      </View>
      <Pressable onPress={onStar} hitSlop={10} className="justify-center">
        <Ionicons
          name={item.isStarred ? 'star' : 'star-outline'}
          size={18}
          color={item.isStarred ? c.warning : c.faint}
        />
      </Pressable>
    </Pressable>
  );
}
