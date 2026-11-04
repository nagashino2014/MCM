import { TAB_BAR_INSET, useTabBarFabBottom } from '@/components/ui/GlassTabBar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import {
  Avatar,
  Count,
  EmptyState,
  GradientIconButton,
  PullRefresh,
  Screen,
  SearchBar,
  SegmentedTabs,
  useToast,
} from '@/components/ui';
import { OrgPickerSheet, type OrgEmployee } from '@/components/pickers/OrgPickerSheet';
import { apiJson } from '@/lib/api';
import { fmtDate, fmtTime } from '@/lib/format';
import { useDirectorySnapshot } from '@/lib/use-directory-snapshot';
import { useWideLayout } from '@/lib/use-wide-layout';
import { useTheme } from '@/theme/useTheme';
import { ChatRoomView } from '@/app/chat/[roomId]';

/** 넓은 배치의 왼쪽 목록 폭(설계안 §6-3). */
const LIST_PANE_WIDTH = 360;

interface ChatRoom {
  roomId: number;
  roomType: 'dm' | 'group';
  name: string;
  memberCount: number;
  peerPhotoPath: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  muted: boolean;
}

type Seg = 'all' | 'dm' | 'group';

interface SearchHit {
  roomId: number;
  roomName: string;
  roomType: 'dm' | 'group';
  messageId: number;
  senderName: string;
  body: string;
  createdAt: string;
}

/** 목록 시각 — 오늘이면 "14:30", 아니면 "8/9". */
function fmtRoomTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay ? fmtTime(iso) : fmtDate(iso);
}

// 대화 — 목록(15초 폴링) + 세그먼트(전체/개인/그룹) + 새 대화(조직도). MSG-P0.
// 넓은 배치(데스크탑 위젯·PWA, 폭 ≥ 900, 2026-11-04 설계안 §6-3): 왼쪽 목록 360 + 오른쪽 선택한 대화방(ChatRoomView embedded).
// 방을 누르면 라우트 이동 없이 오른쪽만 바뀐다. 좁은 창·네이티브는 지금처럼 /chat/[roomId] 로 이동.
export default function ChatScreen() {
  const fabBottom = useTabBarFabBottom();
  const { c } = useTheme();
  const toast = useToast();
  const wide = useWideLayout();
  // 딥링크(알림·검색)로 /chat/[roomId] 에 들어왔다가 넓은 배치라 여기로 넘어온 경우 — 그 방을 선택한 상태로 연다.
  const params = useLocalSearchParams<{ roomId?: string; name?: string }>();
  const paramRoomId = Number(params.roomId);
  const paramRoom = Number.isSafeInteger(paramRoomId) && paramRoomId > 0 ? { roomId: paramRoomId, name: typeof params.name === 'string' ? params.name : undefined } : null;
  const [selected, setSelected] = useState<{ roomId: number; name?: string } | null>(paramRoom);
  // 파생 상태 갱신(React 권장 패턴, effect 아님) — 파라미터의 방이 바뀔 때만 선택을 따라간다(사용자가 닫은 뒤에는 다시 열지 않음).
  const [seenParam, setSeenParam] = useState(paramRoom?.roomId);
  if (paramRoom?.roomId !== seenParam) {
    setSeenParam(paramRoom?.roomId);
    if (paramRoom) setSelected(paramRoom);
  }
  const openRoom = useCallback(
    (roomId: number, name?: string) => {
      if (wide) setSelected({ roomId, name });
      else router.push({ pathname: '/chat/[roomId]', params: name ? { roomId: String(roomId), name } : { roomId: String(roomId) } });
    },
    [wide]
  );
  const [rooms, setRooms] = useState<ChatRoom[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [seg, setSeg] = useState<Seg>('all');
  const [q, setQ] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [picked, setPicked] = useState<Map<string, OrgEmployee>>(new Map());
  const [creating, setCreating] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    try {
      const r = await apiJson<{ rooms: ChatRoom[] }>('/api/chat/rooms');
      setRooms(r.rooms);
      setError(null);
    } catch (e) {
      // 폴링 실패는 조용히 — 목록이 아직 없을 때만 에러 표시.
      setError((e as Error).message);
    } finally {
      if (refresh) setRefreshing(false);
    }
  }, []);

  // 탭 포커스 동안 15초 폴링(블루프린트 §MSG-3).
  useFocusEffect(
    useCallback(() => {
      void load();
      const t = setInterval(() => void load(), 15000);
      return () => clearInterval(t);
    }, [load])
  );

  // 새 대화 조직도 — 전 직원 열람 가능한 주소록 스냅샷 주입(공용 훅).
  const snapshot = useDirectorySnapshot(!pickerOpen);

  // 메시지 본문 검색(MSG-P2) — 2자 이상 입력 시 서버 검색(디바운스).
  const [hits, setHits] = useState<SearchHit[]>([]);
  useEffect(() => {
    const kw = q.trim();
    if (kw.length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      apiJson<{ hits: SearchHit[] }>(`/api/chat/search?q=${encodeURIComponent(kw)}`)
        .then((r) => setHits(r.hits))
        .catch(() => setHits([]));
    }, 400);
    return () => clearTimeout(t);
  }, [q]);

  const list = useMemo(() => {
    let arr = rooms ?? [];
    if (seg !== 'all') arr = arr.filter((r) => r.roomType === seg);
    const kw = q.trim().toLowerCase();
    if (!kw) return arr;
    return arr.filter((r) =>
      `${r.name} ${r.lastMessagePreview ?? ''}`.toLowerCase().includes(kw)
    );
  }, [rooms, seg, q]);

  const togglePick = useCallback(
    (e: OrgEmployee) => {
      if (!e.userId) {
        toast.show('계정이 연결되지 않은 직원이라 대화를 시작할 수 없습니다.', 'error');
        return;
      }
      setPicked((prev) => {
        const next = new Map(prev);
        if (next.has(e.employeeId)) next.delete(e.employeeId);
        else next.set(e.employeeId, e);
        return next;
      });
    },
    [toast]
  );

  // 부서 일괄 선택 — 전원이 이미 선택돼 있으면 해제, 아니면 추가(계정 없는 직원 제외).
  const toggleDept = useCallback(
    (members: OrgEmployee[]) => {
      const eligible = members.filter((m) => m.userId);
      if (!eligible.length) {
        toast.show('이 부서에는 대화 가능한 계정이 없습니다.', 'error');
        return;
      }
      setPicked((prev) => {
        const next = new Map(prev);
        const allIn = eligible.every((m) => next.has(m.employeeId));
        if (allIn) eligible.forEach((m) => next.delete(m.employeeId));
        else eligible.forEach((m) => next.set(m.employeeId, m));
        return next;
      });
    },
    [toast]
  );

  const createRoom = useCallback(async () => {
    const userIds = [...picked.values()].map((e) => e.userId).filter((v): v is string => !!v);
    if (!userIds.length || creating) return;
    setCreating(true);
    setPickerOpen(false); // 안전망 — 어떤 경로로 불려도 시트부터 닫는다.
    try {
      const res = await apiJson<{ roomId: number }>('/api/chat/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds }),
      });
      setPicked(new Map());
      void load();
      // Modal 닫힘 애니메이션이 끝난 뒤 라우팅 — 열린 Modal 위로 push 하면
      // 뒤 화면이 freeze 되어 시트가 화면을 덮은 채 남는다(2026-08-09 실측).
      await new Promise((r) => setTimeout(r, 350));
      openRoom(res.roomId);
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setCreating(false);
    }
  }, [picked, creating, load, toast, openRoom]);

  return (
    // 대화방 목록은 그라데이션 없이 흰 바탕(2026-11-04 사용자 요청) — 대화창([roomId]) 안은 그라데이션 유지.
    <Screen scroll={false} padded={false} plain>
      <View className="flex-1 flex-row">
      <View style={wide ? { width: LIST_PANE_WIDTH, borderRightWidth: 1, borderRightColor: c.border } : { flex: 1 }}>
      <View className="px-4 pt-2">
        <SearchBar value={q} onChangeText={setQ} placeholder="대화방·메시지 검색" />
      </View>
      <SegmentedTabs<Seg>
        items={[
          { key: 'all', label: '전체' },
          { key: 'dm', label: '개인' },
          { key: 'group', label: '그룹' },
        ]}
        value={seg}
        onChange={setSeg}
      />

      {rooms == null && !error ? (
        <ActivityIndicator className="mt-10" />
      ) : rooms == null && error ? (
        <Text className="mt-10 text-center text-cd-error">{error}</Text>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(r) => String(r.roomId)}
          refreshControl={<PullRefresh refreshing={refreshing} onRefresh={() => load(true)} />}
          contentContainerStyle={{ paddingBottom: 72 + TAB_BAR_INSET }}
          ListEmptyComponent={
            hits.length ? null : (
              <EmptyState
                icon="chatbubbles-outline"
                title="대화가 없습니다"
                description="오른쪽 아래 + 버튼으로 새 대화를 시작해 보세요"
              />
            )
          }
          ListFooterComponent={
            hits.length ? (
              <View className="mt-2">
                <Text className="px-4 pb-1.5 pt-3 text-[12px] font-bold uppercase tracking-wide text-cd-muted">
                  메시지
                </Text>
                {hits.map((h) => (
                  <Pressable
                    key={h.messageId}
                    onPress={() => openRoom(h.roomId, h.roomName)}
                    className="border-b border-cd-grid-line px-4 py-2.5 active:opacity-70">
                    <View className="flex-row items-center gap-1.5">
                      <Text className="text-[12px] font-bold text-cd-primary">{h.roomName}</Text>
                      <Text className="text-[11px] text-cd-faint">
                        {h.senderName} · {fmtRoomTime(h.createdAt)}
                      </Text>
                    </View>
                    <Text numberOfLines={1} className="mt-0.5 text-[13px] text-cd-text">
                      {h.body}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null
          }
          renderItem={({ item }) => <RoomRow r={item} active={wide && selected?.roomId === item.roomId} onPress={() => openRoom(item.roomId, item.name)} />}
        />
      )}

      {/* 새 대화 FAB — 넓은 배치에서는 목록 칸 안 오른쪽 아래 */}
      <View className="absolute right-5" style={{ bottom: fabBottom }}>
        <GradientIconButton icon="add" diameter={54} onPress={() => setPickerOpen(true)} />
      </View>
      </View>

      {wide ? (
        <View className="flex-1">
          {selected ? (
            <ChatRoomView key={selected.roomId} roomId={selected.roomId} name={selected.name} embedded onLeft={() => setSelected(null)} />
          ) : (
            <View className="flex-1 items-center justify-center">
              <EmptyState icon="chatbubble-ellipses-outline" title="대화방을 선택하세요" description="왼쪽 목록에서 대화방을 누르면 여기에 열립니다" />
            </View>
          )}
        </View>
      ) : null}
      </View>

      <OrgPickerSheet
        visible={pickerOpen}
        title="새 대화"
        hint="1명 선택 = 1:1 대화, 여러 명 선택 = 그룹 대화가 만들어집니다."
        multi
        snapshot={snapshot}
        selectedIds={[...picked.keys()]}
        onSelect={togglePick}
        onSelectDept={toggleDept}
        onClearAll={() => setPicked(new Map())}
        onDone={() => void createRoom()}
        onClose={() => setPickerOpen(false)}
      />
      {creating ? (
        <View className="absolute inset-0 items-center justify-center bg-black/20">
          <ActivityIndicator color={c.primary} />
        </View>
      ) : null}
    </Screen>
  );
}

function RoomRow({ r, active, onPress }: { r: ChatRoom; active?: boolean; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityState={{ selected: !!active }}
      // 넓은 배치에서 오른쪽에 열린 방은 pillSelected 바탕으로 표시
      style={active ? { backgroundColor: c.pillSelected } : undefined}
      className="flex-row items-center gap-3 border-b border-cd-grid-line px-4 py-3 active:opacity-70">
      {r.roomType === 'dm' ? (
        <Avatar name={r.name} photoPath={r.peerPhotoPath} size="md" />
      ) : (
        <View className="h-10 w-10 items-center justify-center rounded-full bg-cd-primary-soft">
          <Ionicons name="people" size={19} color={c.primary} />
        </View>
      )}
      <View className="flex-1">
        <View className="flex-row items-center gap-1.5">
          <Text numberOfLines={1} className="max-w-[70%] text-[15px] font-bold text-cd-text">
            {r.name}
          </Text>
          {r.roomType === 'group' ? (
            <Text className="text-[12px] text-cd-faint">{r.memberCount}</Text>
          ) : null}
          {r.muted ? <Ionicons name="notifications-off-outline" size={13} color={c.faint} /> : null}
        </View>
        <Text numberOfLines={1} className="mt-0.5 text-[13px] text-cd-muted">
          {r.lastMessagePreview ?? '메시지가 없습니다'}
        </Text>
      </View>
      <View className="items-end gap-1">
        <Text className="text-[11px] text-cd-faint">{fmtRoomTime(r.lastMessageAt)}</Text>
        <Count value={r.unreadCount} />
      </View>
    </Pressable>
  );
}
