import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { File as FSFile } from 'expo-file-system';
import { Image } from 'expo-image';

import { Avatar, Button, ConfirmSheet, CTA_FROM, Input, Sheet, useToast } from '@/components/ui';
import { EmojiPickerSheet } from '@/components/chat/EmojiPickerSheet';
import { OrgPickerSheet, type OrgEmployee } from '@/components/pickers/OrgPickerSheet';
import { apiFetch, apiJson } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { API_BASE_URL } from '@/lib/config';
import { fmtTime } from '@/lib/format';
import { openAttachment } from '@/lib/open-attachment';
import { getAccessToken } from '@/lib/tokens';
import { uploadLargeFile } from '@/lib/upload-large';
import { useDirectorySnapshot } from '@/lib/use-directory-snapshot';
import { useTheme } from '@/theme/useTheme';

interface ChatAttachment {
  attachmentId: number;
  fileName: string;
  contentType: string | null;
  byteSize: number | null;
  path: string;
}

interface ChatMessage {
  messageId: number;
  roomId: number;
  senderId: string;
  senderName: string;
  senderPhotoPath: string | null;
  kind: 'text' | 'file' | 'image' | 'system';
  body: string;
  replyToMessageId: number | null;
  createdAt: string;
  deleted: boolean;
  attachment: ChatAttachment | null;
  replyTo: {
    messageId: number;
    senderName: string;
    preview: string;
    kind: string;
    deleted: boolean;
  } | null;
}

interface RoomDetail {
  roomId: number;
  roomType: 'dm' | 'group';
  name: string | null;
  muted: boolean;
  members: {
    userId: string;
    name: string;
    positionName: string | null;
    photoPath: string | null;
    memberRole: 'owner' | 'member';
  }[];
}

/** API 경유 한도 — 초과분은 presigned PUT 직행(200MB 상한, MSG-P2). */
const MULTIPART_MAX = 25 * 1024 * 1024;
const PRESIGNED_MAX = 200 * 1024 * 1024;

/** 첨부 후보(전송 전) — 웹은 DOM File, 네이티브는 uri. */
interface PendingFile {
  uri: string;
  name: string;
  size: number | null;
  mimeType: string | null;
  webFile?: Blob;
}

function fmtBytes(n?: number | null): string {
  if (!n || n <= 0) return '';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

const POLL_MS = 3000;

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${days[d.getDay()]}요일`;
}

// 대화방 — inverted 목록(3초 증분 폴링) + 텍스트 전송 + 읽음 커서. MSG-P0.
// ⚠ 헤더는 자체 렌더(화면 내 Stack.Screen options 금지 — iOS 헤더 갱신 루프 이력).
export default function ChatRoomScreen() {
  const { roomId: roomIdParam, name } = useLocalSearchParams<{ roomId: string; name?: string }>();
  const roomId = Number(roomIdParam);
  const { c } = useTheme();
  const { user } = useAuth();
  const toast = useToast();
  const myId = user?.id ?? '';

  /** 내림차순(최신 첫) — inverted FlatList 순서. */
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingFile, setPendingFile] = useState<PendingFile | null>(null);
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [detail, setDetail] = useState<RoomDetail | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invitePicked, setInvitePicked] = useState<Map<string, OrgEmployee>>(new Map());
  const [renameValue, setRenameValue] = useState('');
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const snapshot = useDirectorySnapshot(!inviteOpen);

  const loadDetail = useCallback(async () => {
    try {
      const r = await apiJson<{ room: RoomDetail }>(`/api/chat/rooms/${roomId}`);
      setDetail(r.room);
      setRenameValue(r.room.name ?? '');
    } catch {
      // 시트를 열 때 재시도된다 — 조용히.
    }
  }, [roomId]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const endReached = useRef(false);
  const lastReadSent = useRef(0);
  const polling = useRef(false);

  // 읽음 커서 — 최신 메시지를 화면에 띄운 시점에 전진(중복 전송 방지).
  const markRead = useCallback(
    (latestId: number) => {
      if (!latestId || latestId <= lastReadSent.current) return;
      lastReadSent.current = latestId;
      void apiJson(`/api/chat/rooms/${roomId}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: latestId }),
      }).catch(() => {
        // 읽음 실패는 다음 폴링 때 재시도된다 — 조용히.
        lastReadSent.current = 0;
      });
    },
    [roomId]
  );

  const loadInitial = useCallback(async () => {
    try {
      const r = await apiJson<{ messages: ChatMessage[] }>(
        `/api/chat/rooms/${roomId}/messages?limit=50`
      );
      const desc = [...r.messages].reverse();
      setMsgs(desc);
      setError(null);
      endReached.current = r.messages.length < 50;
      if (desc[0]) markRead(desc[0].messageId);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [roomId, markRead]);

  // 증분 폴링 — after=최신 id. 새 메시지는 앞(최신 쪽)에 붙인다.
  const poll = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      let latest = 0;
      setMsgs((prev) => {
        latest = prev?.[0]?.messageId ?? 0;
        return prev;
      });
      const path = latest
        ? `/api/chat/rooms/${roomId}/messages?after=${latest}`
        : `/api/chat/rooms/${roomId}/messages?limit=50`;
      const r = await apiJson<{ messages: ChatMessage[] }>(path);
      if (r.messages.length) {
        const incoming = [...r.messages].reverse();
        setMsgs((prev) => {
          if (!prev) return incoming;
          const known = new Set(prev.map((m) => m.messageId));
          const fresh = incoming.filter((m) => !known.has(m.messageId));
          return fresh.length ? [...fresh, ...prev] : prev;
        });
        markRead(incoming[0].messageId);
      }
    } catch {
      // 폴링 실패는 조용히 — 다음 틱에 재시도.
    } finally {
      polling.current = false;
    }
  }, [roomId, markRead]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  useFocusEffect(
    useCallback(() => {
      const t = setInterval(() => void poll(), POLL_MS);
      return () => clearInterval(t);
    }, [poll])
  );

  const loadOlder = useCallback(async () => {
    if (loadingOlder || endReached.current || !msgs?.length) return;
    setLoadingOlder(true);
    try {
      const oldest = msgs[msgs.length - 1].messageId;
      const r = await apiJson<{ messages: ChatMessage[] }>(
        `/api/chat/rooms/${roomId}/messages?before=${oldest}&limit=50`
      );
      if (r.messages.length < 50) endReached.current = true;
      if (r.messages.length) {
        const older = [...r.messages].reverse();
        setMsgs((prev) => (prev ? [...prev, ...older] : older));
      }
    } catch {
      // 과거 페이징 실패 — 스크롤 재시도로 회복.
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder, msgs, roomId]);

  const pickFile = useCallback(async () => {
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0];
    if (a.size != null && a.size > PRESIGNED_MAX) {
      toast.show('첨부는 200MB 이하만 보낼 수 있습니다.', 'error');
      return;
    }
    setPendingFile({
      uri: a.uri,
      name: a.name ?? 'file',
      size: a.size ?? null,
      mimeType: a.mimeType ?? null,
      webFile: (a as { file?: Blob }).file,
    });
  }, [toast]);

  /** 웹에서 받은 DOM File → 전송 대기 첨부(드래그앤드롭·붙여넣기 공통). */
  const acceptWebFile = useCallback(
    (file: File, nameOverride?: string) => {
      if (file.size > PRESIGNED_MAX) {
        toast.show('첨부는 200MB 이하만 보낼 수 있습니다.', 'error');
        return;
      }
      setPendingFile({
        uri: URL.createObjectURL(file),
        name: nameOverride ?? file.name ?? 'file',
        size: file.size,
        mimeType: file.type || null,
        webFile: file,
      });
    },
    [toast]
  );

  /**
   * 데스크탑 위젯·웹 전용 입력 경로(WID-P1) — 파일 드래그앤드롭 · 클립보드 이미지 붙여넣기.
   * 일상적인 파일은 📎 대화상자 대신 이쪽을 훨씬 많이 쓴다(사용자 확인).
   * ⚠ 위젯에서 동작하려면 셸 창의 `dragDropEnabled:false` 가 필요하다 —
   *   기본값(true)이면 Tauri 가 OS 드롭을 가로채 웹뷰에 DOM 이벤트가 오지 않는다.
   */
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setDragOver(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragOver(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragOver(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) acceptWebFile(f);
    };
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find(
        (it) => it.kind === 'file' && it.type.startsWith('image/')
      );
      if (!item) return; // 텍스트 붙여넣기는 입력창 기본 동작에 맡긴다.
      const f = item.getAsFile();
      if (!f) return;
      e.preventDefault();
      const ext = (item.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
      const t = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      acceptWebFile(f, `클립보드-${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}.${ext}`);
    };
    document.addEventListener('dragenter', onEnter);
    document.addEventListener('dragover', onOver);
    document.addEventListener('dragleave', onLeave);
    document.addEventListener('drop', onDrop);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('dragenter', onEnter);
      document.removeEventListener('dragover', onOver);
      document.removeEventListener('dragleave', onLeave);
      document.removeEventListener('drop', onDrop);
      document.removeEventListener('paste', onPaste);
    };
  }, [acceptWebFile]);

  const send = useCallback(async () => {
    const text = input.trim();
    if ((!text && !pendingFile) || sending) return;
    setSending(true);
    try {
      if (pendingFile && (pendingFile.size ?? 0) > MULTIPART_MAX) {
        // 대용량(25MB 초과) — presigned PUT 직행 후 확정(MSG-P2).
        const presign = await apiJson<{ url: string; storageKey: string; fileName: string }>(
          `/api/chat/rooms/${roomId}/uploads`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileName: pendingFile.name,
              contentType: pendingFile.mimeType ?? 'application/octet-stream',
              byteSize: pendingFile.size ?? 0,
            }),
          }
        );
        await uploadLargeFile(presign.url, pendingFile);
        await apiJson(`/api/chat/rooms/${roomId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            body: text,
            upload: {
              storageKey: presign.storageKey,
              fileName: presign.fileName,
              contentType: pendingFile.mimeType ?? 'application/octet-stream',
              byteSize: pendingFile.size ?? 0,
            },
          }),
        });
        setPendingFile(null);
      } else if (pendingFile) {
        // 첨부 전송 — 웹은 DOM File, 네이티브는 expo-file-system File(SDK57 winter fetch 규칙, card.tsx 패턴).
        const fd = new FormData();
        if (Platform.OS === 'web' && pendingFile.webFile) {
          fd.append('file', pendingFile.webFile, pendingFile.name);
        } else {
          fd.append('file', new FSFile(pendingFile.uri) as unknown as Blob, pendingFile.name);
        }
        if (text) fd.append('caption', text);
        const res = await apiFetch(`/api/chat/rooms/${roomId}/messages`, { method: 'POST', body: fd });
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(d.error ?? `전송 실패 (HTTP ${res.status})`);
        }
        setPendingFile(null);
      } else {
        await apiJson(`/api/chat/rooms/${roomId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: text, replyTo: replyTarget?.messageId ?? undefined }),
        });
      }
      setInput('');
      setReplyTarget(null);
      await poll(); // 서버 확정본을 즉시 반영(낙관적 렌더 없이 단순하게).
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setSending(false);
    }
  }, [input, pendingFile, replyTarget, sending, roomId, poll, toast]);

  // 방 관리 액션(MSG-P2) — 시트에서 실행.
  const toggleMute = useCallback(async () => {
    if (!detail) return;
    try {
      await apiJson(`/api/chat/rooms/${roomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ muted: !detail.muted }),
      });
      setDetail({ ...detail, muted: !detail.muted });
    } catch (e) {
      toast.show((e as Error).message, 'error');
    }
  }, [detail, roomId, toast]);

  const doRename = useCallback(async () => {
    const v = renameValue.trim();
    if (!v || !detail || v === detail.name) return;
    try {
      await apiJson(`/api/chat/rooms/${roomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: v }),
      });
      setDetail({ ...detail, name: v });
      toast.show('방 이름을 바꿨습니다.', 'success');
      void poll();
    } catch (e) {
      toast.show((e as Error).message, 'error');
    }
  }, [renameValue, detail, roomId, toast, poll]);

  const inviteToggle = useCallback(
    (e: OrgEmployee) => {
      if (!e.userId) {
        toast.show('계정이 연결되지 않은 직원입니다.', 'error');
        return;
      }
      setInvitePicked((prev) => {
        const next = new Map(prev);
        if (next.has(e.employeeId)) next.delete(e.employeeId);
        else next.set(e.employeeId, e);
        return next;
      });
    },
    [toast]
  );

  const doInvite = useCallback(async () => {
    const userIds = [...invitePicked.values()].map((e) => e.userId).filter((v): v is string => !!v);
    if (!userIds.length) return;
    try {
      await apiJson(`/api/chat/rooms/${roomId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds }),
      });
      setInvitePicked(new Map());
      toast.show('초대했습니다.', 'success');
      void loadDetail();
      void poll();
    } catch (e) {
      toast.show((e as Error).message, 'error');
    }
  }, [invitePicked, roomId, toast, loadDetail, poll]);

  const doLeave = useCallback(async () => {
    try {
      await apiJson(`/api/chat/rooms/${roomId}/members`, { method: 'DELETE' });
      // ConfirmSheet(Modal) 닫힘이 끝난 뒤 라우팅 — 열린 Modal 과 화면 전환이 겹치면
      // 뒤 화면 freeze 로 시트가 남는다(새 대화 완료 버튼과 동일 이슈).
      await new Promise((r) => setTimeout(r, 350));
      router.back();
    } catch (e) {
      toast.show((e as Error).message, 'error');
    }
  }, [roomId, toast]);

  const title = (detail?.roomType === 'group' && detail.name) || (typeof name === 'string' && name ? name : '대화');

  const renderItem = useCallback(
    ({ item, index }: { item: ChatMessage; index: number }) => {
      // 내림차순 배열 — index+1 이 시간상 직전 메시지.
      const older = msgs?.[index + 1];
      const newDay = !older || dayKey(older.createdAt) !== dayKey(item.createdAt);
      const grouped =
        !newDay &&
        !!older &&
        older.senderId === item.senderId &&
        older.kind !== 'system' &&
        new Date(item.createdAt).getTime() - new Date(older.createdAt).getTime() < 5 * 60 * 1000;
      return (
        <View>
          {newDay ? (
            <View className="my-3 items-center">
              <View className="rounded-full bg-cd-surface px-3 py-1">
                <Text className="text-[11px] text-cd-muted">{dayLabel(item.createdAt)}</Text>
              </View>
            </View>
          ) : null}
          <MessageRow
            m={item}
            mine={item.senderId === myId}
            grouped={grouped}
            onReply={item.kind !== 'system' && !item.deleted ? () => setReplyTarget(item) : undefined}
          />
        </View>
      );
    },
    [msgs, myId]
  );

  return (
    <SafeAreaView edges={['top', 'bottom']} className="flex-1 bg-cd-bg">
      {/* 자체 헤더 */}
      <View className="flex-row items-center gap-1 border-b border-cd-border bg-cd-card px-2 py-2.5">
        <Pressable onPress={() => router.back()} hitSlop={8} className="p-1.5 active:opacity-60">
          <Ionicons name="chevron-back" size={22} color={c.text} />
        </Pressable>
        <Text numberOfLines={1} className="flex-1 text-[16px] font-extrabold text-cd-text">
          {title}
        </Text>
        <Pressable
          onPress={() => {
            setMenuOpen(true);
            void loadDetail();
          }}
          hitSlop={8}
          className="p-1.5 active:opacity-60">
          <Ionicons name="ellipsis-horizontal" size={20} color={c.text} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}>
        {msgs == null && !error ? (
          <ActivityIndicator className="mt-10" />
        ) : msgs == null && error ? (
          <Text className="mt-10 px-6 text-center text-cd-error">{error}</Text>
        ) : (
          <FlatList
            inverted
            data={msgs}
            keyExtractor={(m) => String(m.messageId)}
            renderItem={renderItem}
            contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 10 }}
            onEndReached={() => void loadOlder()}
            onEndReachedThreshold={0.3}
            ListFooterComponent={loadingOlder ? <ActivityIndicator className="py-3" /> : null}
            keyboardShouldPersistTaps="handled"
          />
        )}

        {/* 답장 인용 바(MSG-P2) */}
        {replyTarget ? (
          <View className="flex-row items-center gap-2 border-t border-cd-border bg-cd-card px-4 py-2">
            <Ionicons name="return-up-back" size={16} color={c.primary} />
            <View className="flex-1">
              <Text className="text-[11.5px] font-bold text-cd-primary">
                {replyTarget.senderName}에게 답장
              </Text>
              <Text numberOfLines={1} className="text-[12px] text-cd-muted">
                {replyTarget.body || (replyTarget.attachment ? `📎 ${replyTarget.attachment.fileName}` : '')}
              </Text>
            </View>
            <Pressable onPress={() => setReplyTarget(null)} hitSlop={8} className="active:opacity-60">
              <Ionicons name="close-circle" size={19} color={c.faint} />
            </Pressable>
          </View>
        ) : null}

        {/* 전송 대기 첨부 미리보기 */}
        {pendingFile ? (
          <View className="flex-row items-center gap-2 border-t border-cd-border bg-cd-card px-4 py-2">
            <Ionicons
              name={(pendingFile.mimeType ?? '').startsWith('image/') ? 'image-outline' : 'document-outline'}
              size={17}
              color={c.primary}
            />
            <Text numberOfLines={1} className="flex-1 text-[13px] text-cd-text">
              {pendingFile.name}
              {pendingFile.size ? <Text className="text-cd-faint">  {fmtBytes(pendingFile.size)}</Text> : null}
            </Text>
            <Pressable onPress={() => setPendingFile(null)} hitSlop={8} className="active:opacity-60">
              <Ionicons name="close-circle" size={19} color={c.faint} />
            </Pressable>
          </View>
        ) : null}

        {/* 입력바 — 📎 첨부(대용량) · 이모지 · 텍스트. 일반 파일은 드래그앤드롭/붙여넣기. */}
        <View className="flex-row items-end gap-1.5 border-t border-cd-border bg-cd-card px-3 py-2">
          <Pressable
            onPress={() => void pickFile()}
            disabled={sending}
            hitSlop={6}
            className="h-[40px] w-[30px] items-center justify-center active:opacity-60">
            <Ionicons name="attach" size={23} color={c.muted} />
          </Pressable>
          <Pressable
            onPress={() => setEmojiOpen(true)}
            disabled={sending}
            hitSlop={6}
            className="h-[40px] w-[30px] items-center justify-center active:opacity-60">
            <Ionicons name="happy-outline" size={21} color={c.muted} />
          </Pressable>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="메시지를 입력하세요"
            placeholderTextColor={c.faint}
            multiline
            textAlignVertical="top"
            className="max-h-[220px] min-h-[80px] flex-1 rounded-2xl border border-cd-border bg-cd-bg px-3.5 py-2.5 text-[15px] text-cd-text"
          />
          <Pressable
            onPress={() => void send()}
            disabled={(!input.trim() && !pendingFile) || sending}
            className="h-[40px] w-[40px] items-center justify-center rounded-full active:opacity-70"
            style={{ backgroundColor: input.trim() || pendingFile ? CTA_FROM : c.border }}>
            {sending ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* 드롭존 안내 — 파일을 창 위로 끌어오는 동안만(웹·위젯). */}
      {dragOver ? (
        <View
          pointerEvents="none"
          className="absolute inset-0 items-center justify-center bg-black/45 px-8">
          <View className="items-center gap-2 rounded-3xl border-2 border-dashed border-cd-primary bg-cd-card px-8 py-7">
            <Ionicons name="cloud-upload-outline" size={34} color={c.primary} />
            <Text className="text-[15px] font-extrabold text-cd-text">여기에 놓아 첨부</Text>
            <Text className="text-[12px] text-cd-faint">파일 1개 · 최대 200MB</Text>
          </View>
        </View>
      ) : null}

      <EmojiPickerSheet
        visible={emojiOpen}
        onClose={() => setEmojiOpen(false)}
        onPick={(e) => setInput((v) => v + e)}
      />

      {/* 방 관리 시트(MSG-P2) — 멤버·이름 변경·초대·알림·나가기 */}
      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title="대화방 관리">
        {!detail ? (
          <ActivityIndicator className="py-8" />
        ) : (
          <View className="gap-3">
            {detail.roomType === 'group' ? (
              <View className="flex-row items-end gap-2">
                <View className="flex-1">
                  <Input label="방 이름" value={renameValue} onChangeText={setRenameValue} />
                </View>
                <Button label="변경" onPress={() => void doRename()} />
              </View>
            ) : null}

            <Text className="text-[13px] font-bold text-cd-muted">멤버 {detail.members.length}명</Text>
            <View className="max-h-[220px]">
              {detail.members.map((m) => (
                <View key={m.userId} className="flex-row items-center gap-2.5 border-b border-cd-grid-line py-2">
                  <Avatar name={m.name} photoPath={m.photoPath} size="sm" />
                  <Text className="flex-1 text-[14px] font-semibold text-cd-text">
                    {m.name}
                    {m.positionName ? (
                      <Text className="text-[12px] font-normal text-cd-faint"> {m.positionName}</Text>
                    ) : null}
                  </Text>
                  {m.memberRole === 'owner' ? (
                    <Text className="text-[11px] font-bold text-cd-primary">개설자</Text>
                  ) : null}
                </View>
              ))}
            </View>

            <View className="gap-2 pt-1">
              {detail.roomType === 'group' ? (
                <Pressable
                  onPress={() => {
                    // ⚠ Modal 교대 표시 — 닫힘 애니메이션이 끝난 뒤 다음 Modal 을 연다
                    //   (동시에 열면 iOS 에서 두 번째 Modal 이 나타나지 않는다, P5 영업 실측).
                    setMenuOpen(false);
                    setTimeout(() => setInviteOpen(true), 350);
                  }}
                  className="min-h-[44px] flex-row items-center gap-2.5 active:opacity-70">
                  <Ionicons name="person-add-outline" size={18} color={c.primary} />
                  <Text className="text-[14.5px] font-semibold text-cd-text">멤버 초대</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => void toggleMute()}
                className="min-h-[44px] flex-row items-center gap-2.5 active:opacity-70">
                <Ionicons
                  name={detail.muted ? 'notifications-outline' : 'notifications-off-outline'}
                  size={18}
                  color={c.muted}
                />
                <Text className="text-[14.5px] font-semibold text-cd-text">
                  {detail.muted ? '알림 켜기' : '알림 끄기'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  // Modal 교대 표시(위 초대와 동일).
                  setMenuOpen(false);
                  setTimeout(() => setLeaveConfirm(true), 350);
                }}
                className="min-h-[44px] flex-row items-center gap-2.5 active:opacity-70">
                <Ionicons name="exit-outline" size={18} color={c.error} />
                <Text className="text-[14.5px] font-semibold text-cd-error">나가기</Text>
              </Pressable>
            </View>
          </View>
        )}
      </Sheet>

      <OrgPickerSheet
        visible={inviteOpen}
        title="멤버 초대"
        multi
        snapshot={snapshot}
        selectedIds={[...invitePicked.keys()]}
        onSelect={inviteToggle}
        onClearAll={() => setInvitePicked(new Map())}
        onDone={() => void doInvite()}
        onClose={() => setInviteOpen(false)}
      />

      <ConfirmSheet
        visible={leaveConfirm}
        title="대화방 나가기"
        message={
          detail?.roomType === 'group'
            ? '나가면 이 그룹의 새 메시지를 받지 않습니다. 다시 초대받으면 참여할 수 있습니다.'
            : '대화방을 나갑니다. 상대가 다시 메시지를 보내면 대화가 이어집니다.'
        }
        confirmLabel="나가기"
        danger
        onConfirm={() => {
          setLeaveConfirm(false);
          void doLeave();
        }}
        onCancel={() => setLeaveConfirm(false)}
      />
    </SafeAreaView>
  );
}

/** 인증 이미지 소스 — 프록시 경로에 Bearer 를 붙인다(Avatar 의 useAuthedSource 패턴). */
function useAuthedImage(path?: string | null) {
  const [src, setSrc] = useState<{ uri: string; headers?: Record<string, string> } | null>(null);
  useEffect(() => {
    if (!path) {
      setSrc(null);
      return;
    }
    let alive = true;
    void getAccessToken().then((token) => {
      if (!alive) return;
      setSrc({
        uri: `${API_BASE_URL}${path}`,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
    });
    return () => {
      alive = false;
    };
  }, [path]);
  return src;
}

/** 첨부 렌더 — image 는 인라인, file 은 카드(탭 → 다운로드/공유). */
function AttachmentContent({ m, mine }: { m: ChatMessage; mine: boolean }) {
  const { c } = useTheme();
  const toast = useToast();
  const [opening, setOpening] = useState(false);
  const att = m.attachment!;
  const imgSrc = useAuthedImage(m.kind === 'image' ? att.path : null);

  const open = async () => {
    if (opening) return;
    setOpening(true);
    try {
      await openAttachment(att.path, att.fileName);
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setOpening(false);
    }
  };

  if (m.kind === 'image') {
    return (
      <Pressable onPress={() => void open()} className="active:opacity-80">
        <Image
          source={imgSrc}
          style={{ width: 200, height: 200, borderRadius: 12, backgroundColor: c.surface }}
          contentFit="cover"
          transition={120}
        />
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={() => void open()}
      className="min-w-[170px] flex-row items-center gap-2.5 active:opacity-70">
      <View
        className="h-9 w-9 items-center justify-center rounded-full"
        style={{ backgroundColor: mine ? 'rgba(255,255,255,0.22)' : c.primarySoft }}>
        {opening ? (
          <ActivityIndicator size="small" color={mine ? '#fff' : c.primary} />
        ) : (
          <Ionicons name="document-outline" size={17} color={mine ? '#fff' : c.primary} />
        )}
      </View>
      <View className="flex-1">
        <Text numberOfLines={1} className={`text-[13.5px] font-semibold ${mine ? 'text-white' : 'text-cd-text'}`}>
          {att.fileName}
        </Text>
        <Text className={`text-[11px] ${mine ? 'text-white/70' : 'text-cd-faint'}`}>
          {fmtBytes(att.byteSize) || '파일'}
        </Text>
      </View>
    </Pressable>
  );
}

function MessageRow({
  m,
  mine,
  grouped,
  onReply,
}: {
  m: ChatMessage;
  mine: boolean;
  grouped: boolean;
  onReply?: () => void;
}) {
  if (m.kind === 'system') {
    return (
      <View className="my-1.5 items-center">
        <Text className="text-[11px] text-cd-faint">{m.body}</Text>
      </View>
    );
  }
  const time = fmtTime(m.createdAt);
  const body = m.deleted ? '삭제된 메시지입니다.' : m.body;
  const hasAttachment = !m.deleted && m.attachment != null;
  // 이미지는 버블 패딩 없이 그대로, 파일·텍스트는 버블 패딩.
  const bare = hasAttachment && m.kind === 'image';

  const content = (
    <>
      {m.replyTo && !m.deleted ? (
        <View
          className={`mb-1.5 rounded-lg border-l-2 px-2 py-1 ${
            mine ? 'border-white/60 bg-white/15' : 'border-cd-primary bg-cd-primary-soft'
          }`}>
          <Text className={`text-[10.5px] font-bold ${mine ? 'text-white/90' : 'text-cd-primary'}`}>
            {m.replyTo.senderName}
          </Text>
          <Text numberOfLines={1} className={`text-[11.5px] ${mine ? 'text-white/75' : 'text-cd-muted'}`}>
            {m.replyTo.deleted ? '삭제된 메시지' : m.replyTo.preview}
          </Text>
        </View>
      ) : null}
      {hasAttachment ? <AttachmentContent m={m} mine={mine} /> : null}
      {body ? (
        <Text
          className={`text-[14.5px] leading-5 ${
            mine ? (m.deleted ? 'italic text-white/70' : 'text-white') : m.deleted ? 'italic text-cd-faint' : 'text-cd-text'
          } ${hasAttachment ? 'mt-1.5' : ''}`}>
          {body}
        </Text>
      ) : null}
    </>
  );

  if (mine) {
    return (
      <View className={`flex-row items-end justify-end gap-1.5 ${grouped ? 'mt-1' : 'mt-2.5'}`}>
        <Text className="text-[10px] text-cd-faint">{time}</Text>
        {bare && !body ? (
          <Pressable onLongPress={onReply} className="max-w-[76%]">
            {content}
          </Pressable>
        ) : (
          <Pressable
            onLongPress={onReply}
            className={`max-w-[76%] rounded-2xl rounded-br-md ${bare ? 'p-1' : 'px-3.5 py-2.5'}`}
            style={{ backgroundColor: CTA_FROM }}>
            {content}
          </Pressable>
        )}
      </View>
    );
  }
  return (
    <View className={`flex-row items-end gap-1.5 ${grouped ? 'mt-1' : 'mt-2.5'}`}>
      <View className="w-8">
        {!grouped ? <Avatar name={m.senderName} photoPath={m.senderPhotoPath} size="sm" /> : null}
      </View>
      <View className="max-w-[76%]">
        {!grouped ? (
          <Text className="mb-0.5 text-[11px] text-cd-muted">{m.senderName}</Text>
        ) : null}
        {bare && !body ? (
          <Pressable onLongPress={onReply}>{content}</Pressable>
        ) : (
          <Pressable
            onLongPress={onReply}
            className={`rounded-2xl rounded-bl-md border border-cd-border bg-cd-card ${bare ? 'p-1' : 'px-3.5 py-2.5'}`}>
            {content}
          </Pressable>
        )}
      </View>
      <Text className="text-[10px] text-cd-faint">{time}</Text>
    </View>
  );
}
