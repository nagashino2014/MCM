import { ShellBackground } from '@/theme/ShellBackground';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { File as FSFile } from 'expo-file-system';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';

import { AppHeader, Avatar, Button, ConfirmSheet, Input, Sheet, useToast } from '@/components/ui';
import { ChatCamera } from '@/components/chat/ChatCamera';
import { ComposerPlusSheet, type ComposerPlusItem } from '@/components/chat/ComposerPlusSheet';
import { EmojiPickerSheet } from '@/components/chat/EmojiPickerSheet';
import { MentionSuggestions, type MentionCandidate } from '@/components/chat/MentionSuggestions';
import { PersonalDocPickerSheet, type PersonalDoc } from '@/components/chat/PersonalDocPickerSheet';
import { SharePickerSheet } from '@/components/chat/SharePickerSheet';
import { OrgPickerSheet, type OrgEmployee } from '@/components/pickers/OrgPickerSheet';
import { clearActiveChatRoom, setActiveChatRoom } from '@/lib/active-chat';
import { apiFetch, apiJson } from '@/lib/api';
import { applyMention, mentionQueryAtEnd, splitMentions } from '@/lib/chat-mentions';
import { closeChatPopup } from '@/lib/chat-popup';
import { CHAT_SHARE_ICONS, CHAT_SHARE_LABELS, isChatShareType, shareFallbackBody, type ChatShare } from '@/lib/chat-share';
import { useAuth } from '@/lib/auth-context';
import { API_BASE_URL } from '@/lib/config';
import { fmtTime } from '@/lib/format';
import { routeForLink } from '@/lib/deeplink';
import { openAttachment } from '@/lib/open-attachment';
import { dismissChatNotifications } from '@/lib/notification-tray';
import { IS_CHAT_POPUP, IS_DESKTOP_WEB } from '@/lib/platform';
import { getAccessToken } from '@/lib/tokens';
import { uploadLargeFile } from '@/lib/upload-large';
import { useApi } from '@/lib/use-api';
import { useDirectorySnapshot } from '@/lib/use-directory-snapshot';
import { refreshNavBadges } from '@/lib/use-nav-badges';
import { useWideLayout } from '@/lib/use-wide-layout';
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
  /** 사내 기록 카드 — 브리핑(intel_briefing) 또는 입력창 [문서 공유]로 보낸 결재 문서·할 일·사업장. 모르는 종류는 본문만 그린다. */
  sharedRecord?: { type: string; id: string; title: string; href: string } | null;
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

/** API 경유 한도 — 초과분은 presigned PUT 직행(MSG-P2). */
const MULTIPART_MAX = 25 * 1024 * 1024;
/** 파일 선택(📎 대화상자) 파일당 상한 — 서버 presign 과 동일(2026-09-17, 종전 200MB). */
const PRESIGNED_MAX = 2 * 1024 * 1024 * 1024;
/** 끌어다 놓기·클립보드 붙여넣기 파일당 상한(웹·데스크탑 위젯) — 큰 파일은 📎 로. */
const DROP_MAX = 30 * 1024 * 1024;
/** 한 번에 보낼 수 있는 첨부 수 — 여러 개는 고른 순서대로 하나씩 전송한다(메시지도 파일마다 하나). */
const MAX_PENDING = 10;
const sizeText = (b: number) =>
  b >= 1024 * 1024 * 1024 ? `${(b / 1024 / 1024 / 1024).toFixed(2)}GB` : `${(b / 1024 / 1024).toFixed(1)}MB`;

/** 첨부 후보(전송 전) — 웹은 DOM File, 네이티브는 uri. */
interface PendingFile {
  uri: string;
  name: string;
  size: number | null;
  mimeType: string | null;
  webFile?: Blob;
  /** 개인 문서함에서 고른 파일 — 본문을 올리지 않고 서버가 문서함에서 복제한다. */
  personalDocId?: string;
}

function fmtBytes(n?: number | null): string {
  if (!n || n <= 0) return '';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

const POLL_MS = 3000;

/** 이름 없는 첨부(클립보드 이미지·촬영 사진)의 파일명 — `클립보드-142233.png`. */
function stampName(prefix: string, ext: string): string {
  const t = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${prefix}-${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}.${ext}`;
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${days[d.getDay()]}요일`;
}

// 대화방 라우트(/chat/[roomId]) — 전체 화면 대화방. 넓은 배치(데스크탑 위젯·PWA, 폭 ≥ 900)에서는 대화 탭이 목록+방 2분할로
// 그리므로 알림·검색 딥링크로 들어온 전체 화면 방은 탭으로 넘긴다(2026-11-04 설계안 §6-3).
export default function ChatRoomScreen() {
  const { roomId: roomIdParam, name } = useLocalSearchParams<{ roomId: string; name?: string }>();
  const wide = useWideLayout();
  const nameStr = typeof name === 'string' && name ? name : undefined;
  useEffect(() => {
    if (wide) router.replace({ pathname: '/(tabs)/chat', params: nameStr ? { roomId: roomIdParam, name: nameStr } : { roomId: roomIdParam } });
  }, [wide, roomIdParam, nameStr]);
  if (wide) return null;
  // 대화 팝업 창(?popup=1) — 창 하나에 방 하나. 뒤로가기가 없고, 방을 나가면 창을 닫는다.
  if (IS_CHAT_POPUP) return <ChatRoomView roomId={Number(roomIdParam)} name={nameStr} popup onLeft={closeChatPopup} />;
  return <ChatRoomView roomId={Number(roomIdParam)} name={nameStr} />;
}

// 대화방 — inverted 목록(3초 증분 폴링) + 텍스트 전송 + 읽음 커서. MSG-P0.
// ⚠ 헤더는 자체 렌더(화면 내 Stack.Screen options 금지 — iOS 헤더 갱신 루프 이력).
// embedded: 대화 탭의 오른쪽 칸에 들어갈 때 — 안전영역·뒤로가기 없이, 나가기는 onLeft 로 부모에 알린다.
// popup: 대화 팝업 창(2026-11-06) — embedded 와 같은 모양으로 창 전체를 채운다.
// 둘 다 "틀 배치(framed)": 흰 바탕 위에 **대화 영역(그라데이션)과 입력 상자를 각각 둥근 사각형(반경 10)** 으로 띄운다
// (2026-11-06 사용자 요청). 네이티브·좁은 창의 전체 화면 대화방은 지금처럼 가장자리까지 채운다.
export function ChatRoomView({ roomId, name, embedded, popup, onLeft }: { roomId: number; name?: string; embedded?: boolean; popup?: boolean; onLeft?: () => void }) {
  const framed = !!embedded || !!popup;
  useEffect(() => {
    // 팝업 창은 window.open 이 준 이름(mcm-chat-popup-<id>)을 유지해야 같은 방을 다시 열 때 그 창이 재사용된다.
    if (Platform.OS === 'web' && typeof window !== 'undefined' && !popup && Number.isSafeInteger(roomId) && roomId > 0) window.name = `mcm-chat-${roomId}`;
  }, [roomId, popup]);
  const { c } = useTheme();
  const [inputFocused, setInputFocused] = useState(false);
  const { user } = useAuth();
  const toast = useToast();
  const myId = user?.id ?? '';

  /** 내림차순(최신 첫) — inverted FlatList 순서. */
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  /** 최신 대기 첨부 — 끌어다 놓기·붙여넣기 리스너와 전송이 렌더 사이에 연달아 불려도 개수를 정확히 센다. */
  const pendingRef = useRef<PendingFile[]>([]);
  const setPending = useCallback((next: PendingFile[]) => {
    pendingRef.current = next;
    setPendingFiles(next);
  }, []);
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  // §26-1 메시지 길게 누르기 메뉴(답장 · 할 일로 만들기)
  const [msgMenu, setMsgMenu] = useState<ChatMessage | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [detail, setDetail] = useState<RoomDetail | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invitePicked, setInvitePicked] = useState<Map<string, OrgEmployee>>(new Map());
  const [renameValue, setRenameValue] = useState('');
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [sharePickerOpen, setSharePickerOpen] = useState(false);
  const [docPickerOpen, setDocPickerOpen] = useState(false);
  /** 전송 대기 중인 문서 공유 카드 — 첨부처럼 입력창 위에 보이고, 보내기를 눌러야 나간다. */
  const [pendingShare, setPendingShare] = useState<ChatShare | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const inputRef = useRef<TextInput>(null);
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
  // 서버 기록이 끝나면 하단 탭 배지·앱 아이콘 숫자를 다시 받고, 이 방의 알림을 알림 센터에서 지운다(2026-11-12 —
  // 예전에는 배지를 앱 시작·포그라운드 복귀 때만 받아, 방에서 읽어도 붉은 숫자가 남았다).
  const markRead = useCallback(
    (latestId: number) => {
      if (!latestId || latestId <= lastReadSent.current) return;
      lastReadSent.current = latestId;
      void apiJson(`/api/chat/rooms/${roomId}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: latestId }),
      }).then(() => {
        void refreshNavBadges();
        void dismissChatNotifications(roomId);
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

  // 방 상세도 들어올 때 한 번 받는다 — 멘션 후보와 본문 강조에 멤버 이름이 필요하다(관리 시트를 열 때도 다시 받는다).
  useEffect(() => {
    void loadInitial();
    void loadDetail();
  }, [loadInitial, loadDetail]);

  useFocusEffect(
    useCallback(() => {
      const t = setInterval(() => void poll(), POLL_MS);
      // 보고 있는 방 — 이 방의 새 메시지 푸시는 앱이 켜져 있는 동안 배너를 띄우지 않는다(lib/push.ts).
      setActiveChatRoom(roomId);
      return () => {
        clearInterval(t);
        clearActiveChatRoom(roomId);
      };
    }, [poll, roomId])
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

  // 첨부 확장자 정책(262) — 본인 차단 목록. 최종 판정은 서버, 여기서는 선택 즉시 안내.
  const policy = useApi<{ blocked: string[] }>('/api/attachment-policy/me', { cache: true });
  const blockedExtOf = useCallback(
    (name: string): string | null => {
      const base = name.trim().replace(/[.\s]+$/, '');
      if (!base.includes('.')) return null;
      const ext = base.split('.').pop()?.toLowerCase() ?? '';
      return (policy.data?.blocked ?? []).includes(ext) ? ext : null;
    },
    [policy.data]
  );

  /** 전송 대기 첨부에 추가 — 차단 확장자·크기 상한(max)을 넘는 파일은 빼고 안내한다. 한 번에 MAX_PENDING 개까지. */
  const addPending = useCallback(
    (files: PendingFile[], max: number, overMessage: (size: number) => string) => {
      const ok: PendingFile[] = [];
      for (const f of files) {
        const bad = blockedExtOf(f.name);
        if (bad) {
          toast.show(`보안 정책상 .${bad} 파일은 보낼 수 없습니다. 필요하면 관리자에게 허용을 요청하세요.`, 'error');
          continue;
        }
        if (f.size != null && f.size > max) {
          toast.show(overMessage(f.size), 'error');
          continue;
        }
        ok.push(f);
      }
      const room = MAX_PENDING - pendingRef.current.length;
      if (ok.length > room) toast.show(`첨부는 한 번에 ${MAX_PENDING}개까지 보낼 수 있습니다.`, 'error');
      if (room > 0 && ok.length) setPending([...pendingRef.current, ...ok.slice(0, room)]);
    },
    [toast, blockedExtOf, setPending]
  );
  const overPicked = useCallback((size: number) => `첨부는 파일당 2GB 까지 보낼 수 있습니다. (${sizeText(size)})`, []);

  const pickFile = useCallback(async () => {
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true });
    if (res.canceled || !res.assets?.length) return;
    addPending(
      res.assets.map((a) => ({
        uri: a.uri,
        name: a.name ?? 'file',
        size: a.size ?? null,
        mimeType: a.mimeType ?? null,
        webFile: (a as { file?: Blob }).file,
      })),
      PRESIGNED_MAX,
      overPicked
    );
  }, [addPending, overPicked]);

  /** 사진 촬영(앱) — 권한을 받은 뒤 자체 카메라 덮개를 연다. */
  const openCamera = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      toast.show('카메라 권한이 필요합니다. 설정에서 허용해주세요.', 'error');
      return;
    }
    setCameraOpen(true);
  }, [toast]);

  const onShot = useCallback(
    (uri: string) => {
      let size: number | null = null;
      try {
        size = new FSFile(uri).size ?? null;
      } catch {
        // 크기를 못 읽어도 전송은 된다(25MB 이하 경로) — 촬영 사진은 수 MB 다.
      }
      addPending([{ uri, name: stampName('사진', 'jpg'), size, mimeType: 'image/jpeg' }], PRESIGNED_MAX, overPicked);
    },
    [addPending, overPicked]
  );

  /** 앨범에서 고르기(앱) — 여러 장을 한 번에 고를 수 있다. */
  const pickFromAlbum = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        toast.show('사진 접근 권한이 필요합니다. 설정에서 허용해주세요.', 'error');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        allowsEditing: false,
        allowsMultipleSelection: true,
        selectionLimit: Math.max(1, MAX_PENDING - pendingRef.current.length),
      });
      if (result.canceled || !result.assets?.length) return;
      addPending(
        result.assets.map((a) => ({
          uri: a.uri,
          name: a.fileName ?? stampName('사진', 'jpg'),
          size: a.fileSize ?? null,
          mimeType: a.mimeType ?? 'image/jpeg',
        })),
        PRESIGNED_MAX,
        overPicked
      );
    } catch (e) {
      toast.show(`사진을 가져오지 못했습니다: ${(e as Error).message}`, 'error');
    }
  }, [toast, addPending, overPicked]);

  /** 개인 문서함에서 고른 파일 → 전송 대기 첨부. 본문은 보낼 때 서버가 문서함에서 복제한다. */
  const addPersonalDocs = useCallback(
    (docs: PersonalDoc[]) => {
      addPending(
        docs.map((d) => ({
          uri: `personal-doc:${d.documentId}`,
          name: d.fileName,
          size: d.byteSize,
          mimeType: d.contentType,
          personalDocId: d.documentId,
        })),
        PRESIGNED_MAX,
        overPicked
      );
    },
    [addPending, overPicked]
  );

  /** 웹에서 받은 DOM File → 전송 대기 첨부(드래그앤드롭·붙여넣기 공통). 파일당 30MB — 큰 파일은 📎 파일 선택으로. */
  const acceptWebFiles = useCallback(
    (files: File[], nameOverride?: string) => {
      addPending(
        files.map((file) => ({
          uri: URL.createObjectURL(file),
          name: nameOverride ?? file.name ?? 'file',
          size: file.size,
          mimeType: file.type || null,
          webFile: file,
        })),
        DROP_MAX,
        (size) => `끌어다 놓기는 파일당 30MB 까지입니다(${sizeText(size)}). 큰 파일은 📎 로 첨부해 주세요.`
      );
    },
    [addPending]
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
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) acceptWebFiles(files);
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
      acceptWebFiles([f], stampName('클립보드', ext));
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
  }, [acceptWebFiles]);

  /** 첨부 하나 전송 — 25MB 초과는 presigned PUT 직행 후 확정(MSG-P2), 이하는 API 경유 multipart. */
  const sendFile = useCallback(
    async (file: PendingFile, caption: string) => {
      if (file.personalDocId) {
        await apiJson(`/api/chat/rooms/${roomId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: caption, personalDocId: file.personalDocId }),
        });
        return;
      }
      if ((file.size ?? 0) > MULTIPART_MAX) {
        const presign = await apiJson<{ url: string; storageKey: string; fileName: string }>(
          `/api/chat/rooms/${roomId}/uploads`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileName: file.name,
              contentType: file.mimeType ?? 'application/octet-stream',
              byteSize: file.size ?? 0,
            }),
          }
        );
        await uploadLargeFile(presign.url, file);
        await apiJson(`/api/chat/rooms/${roomId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            body: caption,
            upload: {
              storageKey: presign.storageKey,
              fileName: presign.fileName,
              contentType: file.mimeType ?? 'application/octet-stream',
              byteSize: file.size ?? 0,
            },
          }),
        });
        return;
      }
      // 웹은 DOM File, 네이티브는 expo-file-system File(SDK57 winter fetch 규칙, card.tsx 패턴).
      const fd = new FormData();
      if (Platform.OS === 'web' && file.webFile) {
        fd.append('file', file.webFile, file.name);
      } else {
        fd.append('file', new FSFile(file.uri) as unknown as Blob, file.name);
      }
      if (caption) fd.append('caption', caption);
      const res = await apiFetch(`/api/chat/rooms/${roomId}/messages`, { method: 'POST', body: fd });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `전송 실패 (HTTP ${res.status})`);
      }
    },
    [roomId]
  );

  const send = useCallback(async () => {
    const text = input.trim();
    const files = pendingRef.current;
    const share = pendingShare;
    if ((!text && !files.length && !share) || sending) return;
    setSending(true);
    // 입력은 먼저 비운다 — Enter 로 연달아 보낼 때, 전송 중에 친 다음 글이 완료 시점에 지워지지 않게. 실패하면 되돌린다.
    setInput('');
    // 첨부가 하나면 글은 그 파일의 캡션(종전 동작), 여러 개면 파일을 차례로 보낸 뒤 글을 따로 보낸다.
    // 문서 공유 카드는 글 메시지에 붙는다 — 글이 없으면 "[종류] 제목" 을 본문으로 보낸다.
    const caption = files.length === 1 && !share ? text : '';
    let sentAny = false;
    try {
      for (const f of files) {
        await sendFile(f, caption);
        sentAny = true;
        setPending(pendingRef.current.filter((p) => p !== f));
      }
      if (share || (text && !caption)) {
        await apiJson(`/api/chat/rooms/${roomId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            body: text || (share ? shareFallbackBody(share) : ''),
            replyTo: replyTarget?.messageId ?? undefined,
            sharedRecord: share ?? undefined,
          }),
        });
        setPendingShare(null);
      }
      setReplyTarget(null);
      await poll(); // 서버 확정본을 즉시 반영(낙관적 렌더 없이 단순하게).
    } catch (e) {
      toast.show((e as Error).message, 'error');
      // 여기 오면 글은 아직 나가지 않았다 — 그 사이 새로 친 글이 없을 때만 되돌린다. 이미 나간 첨부는 목록에 반영한다.
      if (text) setInput((cur) => cur || text);
      if (sentAny) void poll();
    } finally {
      setSending(false);
    }
  }, [input, pendingShare, replyTarget, sending, roomId, poll, toast, sendFile, setPending]);

  // 멘션(@) — 그룹 방에서만. 입력 끝의 `@질의` 로 멤버 후보를 띄우고, 고르면 `@이름 ` 으로 바꾼다.
  // 알림 대상은 서버가 본문의 `@이름` 을 방 멤버 이름과 맞춰 정한다(여기서 id 를 따로 보내지 않는다).
  const isGroup = detail?.roomType === 'group';
  const mentionNames = useMemo(() => (isGroup ? (detail?.members ?? []).map((m) => m.name) : []), [isGroup, detail]);
  const mention = useMemo(() => (isGroup ? mentionQueryAtEnd(input) : null), [isGroup, input]);
  /** Esc 로 후보를 닫은 입력 값 — 글이 바뀌면 다시 뜬다. */
  const [mentionClosedFor, setMentionClosedFor] = useState<string | null>(null);
  const [mentionNav, setMentionNav] = useState<{ query: string; index: number }>({ query: '', index: 0 });
  const mentionCandidates = useMemo<MentionCandidate[]>(() => {
    if (!mention || !detail || mentionClosedFor === input) return [];
    const hits = detail.members.filter((m) => m.userId !== myId && m.name.includes(mention.query));
    // 이름을 끝까지 다 친 상태면 후보를 접는다 — Enter 가 곧바로 전송이 되게.
    if (hits.length === 1 && hits[0].name === mention.query) return [];
    return hits.slice(0, 8);
  }, [mention, detail, mentionClosedFor, input, myId]);
  const mentionIndex =
    mention && mentionNav.query === mention.query ? Math.min(mentionNav.index, Math.max(0, mentionCandidates.length - 1)) : 0;

  const pickMention = useCallback(
    (m: MentionCandidate) => {
      if (!mention) return;
      setInput(applyMention(input, mention.start, m.name));
      inputRef.current?.focus();
    },
    [mention, input]
  );

  /** 더하기 메뉴의 [멘션] — 입력 끝에 `@` 를 붙여 후보를 띄운다. */
  const startMention = useCallback(() => {
    setInput((v) => (v && !/\s$/.test(v) ? `${v} @` : `${v}@`));
    inputRef.current?.focus();
  }, []);

  /**
   * PC(데스크탑 위젯·브라우저) 키 입력 — Enter 전송, Shift+Enter 줄바꿈. 멘션 후보가 떠 있으면 방향키·Enter·Tab·Esc 는 후보에 쓴다.
   * 웹(react-native-web)의 nativeEvent 는 DOM KeyboardEvent 다. 한글 조합 중(isComposing·keyCode 229)의 Enter 는 글자 확정이라 건드리지 않는다.
   */
  const onInputKey = useCallback(
    (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      const ne = e.nativeEvent as unknown as KeyboardEvent;
      if (ne.isComposing || ne.keyCode === 229) return;
      if (mention && mentionCandidates.length) {
        if (ne.key === 'ArrowDown' || ne.key === 'ArrowUp') {
          e.preventDefault();
          const n = mentionCandidates.length;
          setMentionNav({ query: mention.query, index: (mentionIndex + (ne.key === 'ArrowDown' ? 1 : n - 1)) % n });
          return;
        }
        if (ne.key === 'Enter' || ne.key === 'Tab') {
          e.preventDefault();
          pickMention(mentionCandidates[mentionIndex]);
          return;
        }
        if (ne.key === 'Escape') {
          e.preventDefault();
          setMentionClosedFor(input);
          return;
        }
      }
      if (ne.key === 'Enter' && !ne.shiftKey) {
        e.preventDefault();
        void send();
      }
    },
    [mention, mentionCandidates, mentionIndex, pickMention, input, send]
  );

  // 더하기(+) 메뉴 항목 — 환경과 방 종류에 맞는 것만 넣는다. 넣을 것이 없으면 + 버튼을 그리지 않는다.
  const plusItems = useMemo<ComposerPlusItem[]>(() => {
    const items: ComposerPlusItem[] = [];
    if (Platform.OS !== 'web') {
      items.push({ key: 'camera', icon: 'camera-outline', label: '사진 촬영' });
      // iOS 는 시스템 사진 선택기가 결과를 돌려주지 않는 문제로 앨범을 숨긴다(명함·영수증 화면과 동일).
      if (Platform.OS !== 'ios') items.push({ key: 'album', icon: 'images-outline', label: '앨범' });
    }
    items.push({ key: 'share', icon: 'document-attach-outline', label: '문서 공유' });
    items.push({ key: 'docs', icon: 'folder-open-outline', label: '문서함' });
    if (isGroup) items.push({ key: 'mention', icon: 'at-outline', label: '멘션' });
    return items;
  }, [isGroup]);
  const onPlusPick = useCallback(
    (key: string) => {
      if (key === 'camera') void openCamera();
      else if (key === 'album') void pickFromAlbum();
      else if (key === 'share') setSharePickerOpen(true);
      else if (key === 'docs') setDocPickerOpen(true);
      else if (key === 'mention') startMention();
    },
    [openCamera, pickFromAlbum, startMention]
  );

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
      if (onLeft) onLeft();
      else router.back();
    } catch (e) {
      toast.show((e as Error).message, 'error');
    }
  }, [roomId, toast, onLeft]);

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
            mentionNames={mentionNames}
            onReply={item.kind !== 'system' && !item.deleted ? () => setMsgMenu(item) : undefined}
          />
        </View>
      );
    },
    [msgs, myId, mentionNames]
  );

  return (
    <SafeAreaView edges={framed ? [] : ['top', 'bottom']} className={framed ? 'flex-1 bg-cd-card' : 'flex-1 bg-transparent'}>
      {/* 틀 배치에서는 셸 그라데이션을 대화 영역 틀 안에만 깐다(아래). */}
      {framed ? null : <ShellBackground />}
      {/* 자체 헤더 — 공용 AppHeader(홈·전체 메뉴 외 모든 화면 공통 모양, 2026-11-04). 2분할 오른쪽 칸에서는 뒤로가기 없음 */}
      <AppHeader
        title={title}
        back={!framed}
        safe={framed ? 'none' : 'extend'}
        right={
          <Pressable
            onPress={() => {
              setMenuOpen(true);
              void loadDetail();
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="대화방 메뉴"
            className="h-10 w-10 items-center justify-center rounded-lg active:bg-cd-surface">
            <Ionicons name="ellipsis-horizontal" size={20} color={c.text} />
          </Pressable>
        }
      />

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}>
        {/* 대화 영역 — 틀 배치에서는 좌우·위 12 를 띄운 둥근 틀(반경 10) 안에 그라데이션과 메시지를 담는다. */}
        <View className="flex-1" style={framed ? { marginHorizontal: 12, marginTop: 12, borderRadius: 10, overflow: 'hidden' } : undefined}>
          {framed ? <ShellBackground /> : null}
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
        </View>

        {/* 입력 영역(답장 인용·첨부 미리보기·입력바) — 틀 배치에서는 세 줄을 한 둥근 상자(반경 10, 테두리 1)로 묶는다.
            상자가 입력창 테두리를 대신하므로 안쪽 TextInput 은 테두리 없이, 포커스는 상자 테두리 색으로 보인다. */}
        <View
          style={
            framed
              ? { marginHorizontal: 12, marginTop: 8, marginBottom: 12, borderRadius: 10, borderWidth: 1, borderColor: inputFocused ? c.primary : c.border, backgroundColor: c.card, overflow: 'hidden' }
              : undefined
          }>

        {/* 멘션 후보 — 그룹 방에서 @ 를 쳤을 때만 */}
        {mentionCandidates.length ? (
          <MentionSuggestions candidates={mentionCandidates} activeIndex={mentionIndex} onPick={pickMention} framed={framed} />
        ) : null}

        {/* 답장 인용 바(MSG-P2) */}
        {replyTarget ? (
          <View className={`flex-row items-center gap-2 bg-cd-card px-4 py-2 ${framed ? 'border-b border-cd-border' : 'border-t border-cd-border'}`}>
            <Ionicons name="return-up-back" size={16} color={c.primary} />
            <View className="flex-1">
              <Text className="text-[12px] font-bold text-cd-primary">
                {replyTarget.senderName}에게 답장
              </Text>
              <Text numberOfLines={1} className="text-[12px] text-cd-muted">
                {replyTarget.body || (replyTarget.attachment ? `첨부 ${replyTarget.attachment.fileName}` : '')}
              </Text>
            </View>
            <Pressable onPress={() => setReplyTarget(null)} hitSlop={8} className="active:opacity-60">
              <Ionicons name="close-circle" size={19} color={c.faint} />
            </Pressable>
          </View>
        ) : null}

        {/* 전송 대기 첨부 미리보기 — 여러 개면 줄마다 하나, 세 줄을 넘으면 안에서 스크롤 */}
        {pendingFiles.length ? (
          <ScrollView
            style={{ maxHeight: 132 }}
            keyboardShouldPersistTaps="handled"
            className={`bg-cd-card ${framed ? 'border-b border-cd-border' : 'border-t border-cd-border'}`}>
            {pendingFiles.map((f, i) => (
              <View key={`${f.uri}-${i}`} className="flex-row items-center gap-2 px-4 py-2">
                <Ionicons
                  name={(f.mimeType ?? '').startsWith('image/') ? 'image-outline' : 'document-outline'}
                  size={17}
                  color={c.primary}
                />
                <Text numberOfLines={1} className="flex-1 text-[13px] text-cd-text">
                  {f.name}
                  {f.size ? <Text className="text-cd-faint">  {fmtBytes(f.size)}</Text> : null}
                </Text>
                <Pressable
                  onPress={() => setPending(pendingRef.current.filter((p) => p !== f))}
                  disabled={sending}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`${f.name} 첨부 취소`}
                  className="active:opacity-60">
                  <Ionicons name="close-circle" size={19} color={c.faint} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        ) : null}

        {/* 전송 대기 문서 공유 카드 */}
        {pendingShare ? (
          <View className={`flex-row items-center gap-2 bg-cd-card px-4 py-2 ${framed ? 'border-b border-cd-border' : 'border-t border-cd-border'}`}>
            <Ionicons name={CHAT_SHARE_ICONS[pendingShare.type]} size={17} color={c.primary} />
            <Text numberOfLines={1} className="flex-1 text-[13px] text-cd-text">
              <Text className="text-cd-faint">{CHAT_SHARE_LABELS[pendingShare.type]}  </Text>
              {pendingShare.title}
            </Text>
            <Pressable
              onPress={() => setPendingShare(null)}
              disabled={sending}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="문서 공유 취소"
              className="active:opacity-60">
              <Ionicons name="close-circle" size={19} color={c.faint} />
            </Pressable>
          </View>
        ) : null}

        {/* 입력바 — ＋ 더하기 · 📎 첨부(대용량) · 이모지 · 텍스트. 일반 파일은 드래그앤드롭/붙여넣기. */}
        <View className={`flex-row items-end gap-1.5 bg-cd-card py-2 ${framed ? 'px-2' : 'border-t border-cd-border px-3'}`}>
          {plusItems.length ? (
            <Pressable
              onPress={() => setPlusOpen(true)}
              disabled={sending}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="추가"
              className="h-[40px] w-[30px] items-center justify-center active:opacity-60">
              <Ionicons name="add" size={25} color={c.muted} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => void pickFile()}
            disabled={sending}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="파일 첨부"
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
            ref={inputRef}
            value={input}
            onChangeText={setInput}
            onKeyPress={IS_DESKTOP_WEB ? onInputKey : undefined}
            placeholder="메시지를 입력하세요"
            placeholderTextColor={c.faint}
            multiline
            textAlignVertical="top"
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            style={framed && Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : undefined}
            className={
              framed
                ? 'max-h-[220px] min-h-[80px] flex-1 bg-transparent px-2 py-2.5 text-[15px] text-cd-text'
                : 'max-h-[220px] min-h-[80px] flex-1 rounded-2xl border border-cd-border bg-transparent px-3.5 py-2.5 text-[15px] text-cd-text'
            }
          />
          <Pressable
            onPress={() => void send()}
            disabled={(!input.trim() && !pendingFiles.length && !pendingShare) || sending}
            className="h-[40px] w-[40px] items-center justify-center rounded-full active:opacity-70"
            style={{ backgroundColor: input.trim() || pendingFiles.length || pendingShare ? c.primaryFill : c.border }}>
            {sending ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
            )}
          </Pressable>
        </View>
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
            <Text className="text-[12px] text-cd-faint">한 번에 {MAX_PENDING}개 · 선택 최대 2GB · 끌어다 놓기 30MB</Text>
          </View>
        </View>
      ) : null}

      <ComposerPlusSheet visible={plusOpen} onClose={() => setPlusOpen(false)} items={plusItems} onPick={onPlusPick} />

      <SharePickerSheet
        visible={sharePickerOpen}
        onClose={() => setSharePickerOpen(false)}
        onPick={(share) => {
          setSharePickerOpen(false);
          setPendingShare(share);
        }}
      />

      <PersonalDocPickerSheet
        visible={docPickerOpen}
        max={MAX_PENDING - pendingFiles.length}
        onClose={() => setDocPickerOpen(false)}
        onDone={(docs) => {
          setDocPickerOpen(false);
          addPersonalDocs(docs);
        }}
      />

      <EmojiPickerSheet
        visible={emojiOpen}
        onClose={() => setEmojiOpen(false)}
        onPick={(e) => setInput((v) => v + e)}
      />

      {/* 방 관리 시트(MSG-P2) — 멤버·이름 변경·초대·알림·나가기 */}
      {/* 메시지 메뉴(§26-1) */}
      <Sheet visible={!!msgMenu} onClose={() => setMsgMenu(null)} title={msgMenu ? `${msgMenu.senderName}의 메시지` : '메시지'}>
        <View className="gap-2">
          {msgMenu?.body ? (
            <Text numberOfLines={3} className="text-[13px] text-cd-muted">
              {msgMenu.body}
            </Text>
          ) : null}
          <Button
            label="답장"
            icon="arrow-undo-outline"
            variant="soft"
            onPress={() => {
              const m = msgMenu;
              setMsgMenu(null);
              if (m) setReplyTarget(m);
            }}
            full
          />
          <Button
            label="할 일로 만들기"
            icon="checkbox-outline"
            variant="ghost"
            onPress={() => {
              const m = msgMenu;
              setMsgMenu(null);
              if (!m) return;
              const text = (m.body ?? '').replace(/\s+/g, ' ').trim();
              router.push({
                pathname: '/todo',
                params: {
                  new: '1',
                  linkKind: 'chat',
                  linkId: `${m.roomId}:${m.messageId}`,
                  linkLabel: `${name ?? '메신저'} · ${m.senderName}`.slice(0, 80),
                  title: text.slice(0, 120),
                },
              });
            }}
            full
          />
        </View>
      </Sheet>
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
            {/* 멤버가 많으면 max-h 를 넘어 아래 액션 버튼과 겹쳤다 — 스크롤 영역으로. */}
            <ScrollView style={{ maxHeight: 220 }}>
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
            </ScrollView>

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
                  <Text className="text-[15px] font-semibold text-cd-text">멤버 초대</Text>
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
                <Text className="text-[15px] font-semibold text-cd-text">
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
                <Text className="text-[15px] font-semibold text-cd-error">나가기</Text>
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

      {/* 사진 촬영 — 자체 카메라 덮개(앱) */}
      {cameraOpen ? (
        <ChatCamera onClose={() => setCameraOpen(false)} onShot={onShot} onError={(m) => toast.show(m, 'error')} />
      ) : null}
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
        <Text numberOfLines={1} className={`text-[14px] font-semibold ${mine ? 'text-white' : 'text-cd-text'}`}>
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
  mentionNames,
  onReply,
}: {
  m: ChatMessage;
  mine: boolean;
  grouped: boolean;
  /** 그룹 방 멤버 이름 — 본문의 `@이름` 을 굵게 그린다. 1대1 방은 빈 배열. */
  mentionNames: string[];
  onReply?: () => void;
}) {
  const { c } = useTheme();
  if (m.kind === 'system') {
    return (
      <View className="my-1.5 items-center">
        <Text className="text-[11px] text-cd-faint">{m.body}</Text>
      </View>
    );
  }
  const time = fmtTime(m.createdAt);
  const body = m.deleted ? '삭제된 메시지입니다.' : m.body;
  const shared = !m.deleted && m.sharedRecord?.type === 'intel_briefing' ? m.sharedRecord : null;
  const sharedRoute = shared && shared.href === `/sales/rag?briefingId=${encodeURIComponent(shared.id)}` ? routeForLink(shared.href) : null;
  // 입력창 [문서 공유]로 보낸 카드(결재 문서·할 일·사업장) — 앱에서 열 화면이 있을 때만 카드로 그린다.
  const card = !m.deleted && m.sharedRecord && isChatShareType(m.sharedRecord.type) ? { ...m.sharedRecord, type: m.sharedRecord.type } : null;
  const cardRoute = card ? routeForLink(card.href) : null;
  // 글 없이 카드만 보낸 메시지의 본문("[종류] 제목")은 카드와 같은 말이라 숨긴다.
  const cardOnly = !!card && !!cardRoute && body === shareFallbackBody(card);
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
          <Text className={`text-[11px] font-bold ${mine ? 'text-white/90' : 'text-cd-primary'}`}>
            {m.replyTo.senderName}
          </Text>
          <Text numberOfLines={1} className={`text-[12px] ${mine ? 'text-white/75' : 'text-cd-muted'}`}>
            {m.replyTo.deleted ? '삭제된 메시지' : m.replyTo.preview}
          </Text>
        </View>
      ) : null}
      {hasAttachment ? <AttachmentContent m={m} mine={mine} /> : null}
      {shared && sharedRoute ? <Pressable accessibilityRole="link" accessibilityLabel={`브리핑 열기: ${shared.title}`} onPress={() => router.push(sharedRoute)} className="gap-2 rounded-lg border border-cd-border bg-cd-card p-3 active:opacity-70">
        <Text className="text-[12px] text-cd-muted">공유 브리핑</Text>
        <Text numberOfLines={3} className="text-[14px] font-medium text-cd-text">{shared.title}</Text>
        <Text className="text-[13px] text-cd-primary">브리핑 열기</Text>
      </Pressable> : null}
      {card && cardRoute ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`${CHAT_SHARE_LABELS[card.type]} 열기: ${card.title}`}
          onPress={() => router.push(cardRoute)}
          className="min-w-[200px] gap-2 rounded-lg border border-cd-border bg-cd-card p-3 active:opacity-70">
          <View className="flex-row items-center gap-1.5">
            <Ionicons name={CHAT_SHARE_ICONS[card.type]} size={14} color={c.muted} />
            <Text className="text-[12px] text-cd-muted">{CHAT_SHARE_LABELS[card.type]}</Text>
          </View>
          <Text numberOfLines={3} className="text-[14px] font-medium text-cd-text">
            {card.title}
          </Text>
          <Text className="text-[13px] text-cd-primary">열기</Text>
        </Pressable>
      ) : null}
      {body && !sharedRoute && !cardOnly ? (
        <Text
          className={`text-[15px] leading-5 ${
            mine ? (m.deleted ? 'italic text-white/70' : 'text-white') : m.deleted ? 'italic text-cd-faint' : 'text-cd-text'
          } ${hasAttachment || (card && cardRoute) ? 'mt-1.5' : ''}`}>
          {m.deleted
            ? body
            : splitMentions(body, mentionNames).map((seg, i) =>
                seg.mention ? (
                  <Text key={i} className={`font-semibold ${mine ? 'text-white' : 'text-cd-primary'}`}>
                    {seg.text}
                  </Text>
                ) : (
                  seg.text
                )
              )}
        </Text>
      ) : null}
    </>
  );

  if (mine) {
    return (
      <View className={`flex-row items-end justify-end gap-1.5 ${grouped ? 'mt-1' : 'mt-2.5'}`}>
        <Text className="text-[11px] text-cd-faint">{time}</Text>
        {bare && !body ? (
          <Pressable onLongPress={onReply} className="max-w-[76%]">
            {content}
          </Pressable>
        ) : (
          <Pressable
            onLongPress={onReply}
            className={`max-w-[76%] rounded-2xl rounded-br-md ${bare ? 'p-1' : 'px-3.5 py-2.5'}`}
            style={{ backgroundColor: c.primaryFill }}>
            {content}
          </Pressable>
        )}
      </View>
    );
  }
  return (
    <View className={`flex-row items-end gap-1.5 ${grouped ? 'mt-1' : 'mt-2.5'}`}>
      {/* 상대 프로필 — 28 에서 20% 키운 34(2026-11-06 사용자 요청). 자리 폭도 32 → 38 로 맞춘다. */}
      <View style={{ width: 38 }}>
        {!grouped ? <Avatar name={m.senderName} photoPath={m.senderPhotoPath} px={34} /> : null}
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
      <Text className="text-[11px] text-cd-faint">{time}</Text>
    </View>
  );
}
