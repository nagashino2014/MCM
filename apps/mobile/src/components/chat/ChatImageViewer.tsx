import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';

import { Avatar, Sheet } from '@/components/ui';
import { forwardChatImage, printChatImage } from '@/lib/chat-image-actions';
import { API_BASE_URL } from '@/lib/config';
import { openAttachment } from '@/lib/open-attachment';
import { IS_DESKTOP_WEB } from '@/lib/platform';
import { getAccessToken } from '@/lib/tokens';
import { useApi } from '@/lib/use-api';

/** 뷰어에 넘기는 그림 한 장 — 대화방에 불러온 이미지 메시지에서 만든다(시간 오름차순). */
export interface ChatViewerImage {
  messageId: number;
  senderName: string;
  createdAt: string;
  attachment: { attachmentId: number; fileName: string; contentType: string | null; byteSize: number | null; path: string };
}

interface ForwardRoom {
  roomId: number;
  roomType: 'dm' | 'group';
  name: string;
  memberCount: number;
  peerPhotoPath: string | null;
}

/** 인증 이미지 소스 — 프록시 경로에 Bearer 를 붙인다(Avatar 의 useAuthedSource 패턴). */
export function useAuthedImage(path?: string | null) {
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

/** 배율 한계 — 1 이 화면 맞춤이다. */
const MIN_SCALE = 0.5;
const MAX_SCALE = 8;
const STEP = 1.25;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function fmtBytes(n?: number | null): string {
  if (!n || n <= 0) return '';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function fmtDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 대화방 그림 뷰어(2026-11-20 직원 요청) — 그림을 누르면 전체 화면으로 크게 본다.
 * 확대·축소(버튼, 휠, 두 손가락, 두 번 누르기)·회전·이전/다음·전달·저장·인쇄(PC).
 * 새 네이티브 모듈 없이 RN 기본 PanResponder·Animated 만 쓴다 — OTA 로 반영할 수 있게.
 */
export function ChatImageViewer({
  images,
  openId,
  roomId,
  onClose,
}: {
  images: ChatViewerImage[];
  /** 처음 보여 줄 그림의 메시지 id — null 이면 닫힌 상태. */
  openId: number | null;
  /** 지금 대화방 — 전달 대상 목록에서 뺀다. */
  roomId: number;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const wide = winW >= 640;
  const visible = openId != null;

  const [curId, setCurId] = useState<number | null>(openId);
  useEffect(() => setCurId(openId), [openId]);
  const idx = useMemo(() => images.findIndex((im) => im.messageId === curId), [images, curId]);
  const cur = idx >= 0 ? images[idx] : null;
  // 보던 그림이 지워졌으면 닫는다.
  useEffect(() => {
    if (visible && curId != null && idx < 0) onClose();
  }, [visible, curId, idx, onClose]);

  const src = useAuthedImage(cur?.attachment.path ?? null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [pct, setPct] = useState(100);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState<'save' | 'print' | null>(null);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwarding, setForwarding] = useState<number | null>(null);
  const rooms = useApi<{ rooms: ForwardRoom[] }>('/api/chat/rooms', { skip: !forwardOpen });

  // 화면 맞춤 크기 — 작은 그림은 키우지 않는다(원본 크기 = 화면 맞춤). 회전이 90·270 이면 가로·세로를 바꿔 맞춘다.
  const turned = rotation % 180 !== 0;
  const fit = useMemo(() => {
    if (!nat || !stage.w || !stage.h) return { r: 0, w: stage.w, h: stage.h, dw: stage.w, dh: stage.h };
    const rw = turned ? nat.h : nat.w;
    const rh = turned ? nat.w : nat.h;
    const r = Math.min(stage.w / rw, stage.h / rh, 1);
    return { r, w: nat.w * r, h: nat.h * r, dw: rw * r, dh: rh * r };
  }, [nat, stage, turned]);

  // ── 변환 상태: Animated 값 + 현재값 ref(제스처가 리렌더 없이 읽는다) ──
  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const t = useRef({ s: 1, x: 0, y: 0 });
  const nativeDriver = Platform.OS !== 'web';

  const setT = useCallback(
    (s: number, x: number, y: number, animated = false) => {
      const ns = clamp(s, MIN_SCALE, MAX_SCALE);
      const mx = Math.max(0, (fit.dw * ns - stage.w) / 2);
      const my = Math.max(0, (fit.dh * ns - stage.h) / 2);
      const nx = clamp(x, -mx, mx);
      const ny = clamp(y, -my, my);
      t.current = { s: ns, x: nx, y: ny };
      setPct(Math.round(ns * (fit.r || 1) * 100));
      if (animated) {
        Animated.parallel([
          Animated.timing(scale, { toValue: ns, duration: 150, useNativeDriver: nativeDriver }),
          Animated.timing(tx, { toValue: nx, duration: 150, useNativeDriver: nativeDriver }),
          Animated.timing(ty, { toValue: ny, duration: 150, useNativeDriver: nativeDriver }),
        ]).start();
      } else {
        scale.setValue(ns);
        tx.setValue(nx);
        ty.setValue(ny);
      }
    },
    [fit, stage, scale, tx, ty, nativeDriver]
  );

  /** (cx, cy) — 무대 가운데 기준 좌표 — 를 붙든 채 배율을 바꾼다. */
  const zoomAt = useCallback(
    (s: number, cx: number, cy: number, animated = false) => {
      const ns = clamp(s, MIN_SCALE, MAX_SCALE);
      const k = ns / t.current.s;
      setT(ns, cx - (cx - t.current.x) * k, cy - (cy - t.current.y) * k, animated);
    },
    [setT]
  );

  const go = useCallback(
    (delta: number) => {
      const next = images[idx + delta];
      if (next) setCurId(next.messageId);
    },
    [images, idx]
  );

  // 그림이 바뀌면 처음 상태로.
  useEffect(() => {
    setNat(null);
    setFailed(false);
    setRotation(0);
    setNotice(null);
  }, [curId]);
  // 그림 크기·회전·창 크기가 바뀌면 화면 맞춤으로 되돌린다.
  useEffect(() => {
    setT(1, 0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit.r, fit.dw, fit.dh, stage.w, stage.h]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(id);
  }, [notice]);

  // ── 무대 위치(화면 좌표) — 두 손가락·휠의 기준점 계산용 ──
  const stageRef = useRef<View>(null);
  const box = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const onStageLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setStage({ w: width, h: height });
    stageRef.current?.measureInWindow((x, y, w, h) => {
      box.current = { x, y, w, h };
    });
  };
  const toCenter = (pageX: number, pageY: number) => ({
    cx: pageX - (box.current.x + box.current.w / 2),
    cy: pageY - (box.current.y + box.current.h / 2),
  });

  // PanResponder 는 한 번만 만들므로, 최신 함수·값은 ref 로 읽는다.
  const live = useRef({ setT, zoomAt, go, fit, stage });
  live.current = { setT, zoomAt, go, fit, stage };
  const g = useRef({ pinch: false, startDist: 0, startS: 1, baseX: 0, baseY: 0, moved: false, t0: 0, lastTap: 0 });

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        g.current.pinch = false;
        g.current.moved = false;
        g.current.t0 = Date.now();
        g.current.baseX = t.current.x;
        g.current.baseY = t.current.y;
      },
      onPanResponderMove: (e, gs) => {
        const L = live.current;
        const touches = e.nativeEvent.touches;
        if (touches && touches.length >= 2) {
          const [a, b] = touches;
          const dist = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) || 1;
          if (!g.current.pinch) {
            g.current.pinch = true;
            g.current.startDist = dist;
            g.current.startS = t.current.s;
          }
          g.current.moved = true;
          const { cx, cy } = toCenter((a.pageX + b.pageX) / 2, (a.pageY + b.pageY) / 2);
          L.zoomAt((g.current.startS * dist) / g.current.startDist, cx, cy);
          return;
        }
        if (g.current.pinch) {
          // 두 손가락에서 한 손가락으로 — 끌기 기준을 지금 위치로 다시 잡는다(튀지 않게).
          g.current.pinch = false;
          g.current.baseX = t.current.x - gs.dx;
          g.current.baseY = t.current.y - gs.dy;
        }
        if (Math.abs(gs.dx) > 4 || Math.abs(gs.dy) > 4) g.current.moved = true;
        L.setT(t.current.s, g.current.baseX + gs.dx, g.current.baseY + gs.dy);
      },
      onPanResponderRelease: (e, gs) => {
        const L = live.current;
        const now = Date.now();
        if (!g.current.moved && now - g.current.t0 < 300) {
          if (now - g.current.lastTap < 300) {
            // 두 번 누르기 — 맞춤이면 누른 곳을 2.5배로, 확대돼 있으면 맞춤으로.
            g.current.lastTap = 0;
            if (t.current.s > 1.01) L.setT(1, 0, 0, true);
            else {
              const { cx, cy } = toCenter(e.nativeEvent.pageX, e.nativeEvent.pageY);
              L.zoomAt(2.5, cx, cy, true);
            }
          } else {
            g.current.lastTap = now;
          }
          return;
        }
        // 그림이 화면 폭 안에 있을 때 옆으로 밀면 이전·다음 그림.
        const overflowX = L.fit.dw * t.current.s > L.stage.w + 1;
        if (!g.current.pinch && !overflowX && Math.abs(gs.dx) > 60 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5) {
          L.go(gs.dx > 0 ? -1 : 1);
        }
      },
    })
  ).current;

  // ── 웹: 휠 확대·축소, 키보드(← → + − 0). Esc 는 Modal 의 onRequestClose 가 처리한다. ──
  useEffect(() => {
    if (Platform.OS !== 'web' || !visible || forwardOpen) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { cx, cy } = toCenter(e.clientX, e.clientY);
      zoomAt(t.current.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15), cx, cy);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === '+' || e.key === '=') zoomAt(t.current.s * STEP, 0, 0, true);
      else if (e.key === '-') zoomAt(t.current.s / STEP, 0, 0, true);
      else if (e.key === '0') setT(1, 0, 0, true);
      else return;
      e.preventDefault();
    };
    document.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('wheel', onWheel);
      document.removeEventListener('keydown', onKey);
    };
  }, [visible, forwardOpen, zoomAt, setT, go]);

  const save = async () => {
    if (!cur || busy) return;
    setBusy('save');
    try {
      // 웹은 내려받기, 앱은 공유 시트(사진에 저장·다른 앱으로 보내기)로 넘긴다.
      await openAttachment(cur.attachment.path, cur.attachment.fileName);
      if (Platform.OS === 'web') setNotice({ text: '내려받았습니다.', error: false });
    } catch (e) {
      setNotice({ text: (e as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  };

  const print = async () => {
    if (!cur || busy) return;
    setBusy('print');
    try {
      await printChatImage(cur.attachment.path);
    } catch (e) {
      setNotice({ text: (e as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  };

  const forward = async (room: ForwardRoom) => {
    if (!cur || forwarding != null) return;
    setForwarding(room.roomId);
    try {
      await forwardChatImage(cur.attachment, room.roomId);
      setForwardOpen(false);
      setNotice({ text: `"${room.name}" 방에 전달했습니다.`, error: false });
    } catch (e) {
      setForwardOpen(false);
      setNotice({ text: (e as Error).message, error: true });
    } finally {
      setForwarding(null);
    }
  };

  const meta = cur
    ? [cur.senderName, fmtDay(cur.createdAt), fmtBytes(cur.attachment.byteSize)].filter(Boolean).join('  |  ')
    : '';
  const targets = (rooms.data?.rooms ?? []).filter((r) => r.roomId !== roomId);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: 'rgba(12,14,20,0.94)' }}>
        {/* 상단 — 파일 이름·보낸 사람·날짜·크기, 닫기 */}
        <View
          className="flex-row items-center gap-3 px-4 pb-2"
          style={{ paddingTop: Math.max(insets.top, 10) + 4 }}>
          <View className="flex-1">
            <Text numberOfLines={1} style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>
              {cur?.attachment.fileName ?? ''}
            </Text>
            <Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.62)', fontSize: 12, marginTop: 2 }}>
              {meta}
            </Text>
          </View>
          {images.length > 1 && idx >= 0 ? (
            <Text style={{ color: 'rgba(255,255,255,0.62)', fontSize: 12 }}>
              {idx + 1} / {images.length}
            </Text>
          ) : null}
          <ToolBtn icon="close" label="닫기" onPress={onClose} size={24} />
        </View>

        {/* 무대 — 끌기·두 손가락·두 번 누르기 */}
        <View
          ref={stageRef}
          onLayout={onStageLayout}
          className="flex-1 items-center justify-center overflow-hidden"
          {...pan.panHandlers}
          // 웹: 끌 때 글자 선택·그림 끌어내기가 일어나지 않게.
          style={Platform.OS === 'web' ? ({ cursor: 'grab', userSelect: 'none', touchAction: 'none' } as object) : undefined}>
          {failed ? (
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14 }}>그림을 불러오지 못했습니다.</Text>
          ) : (
            <Animated.View
              pointerEvents="none"
              style={{
                width: fit.w,
                height: fit.h,
                transform: [{ translateX: tx }, { translateY: ty }, { scale }, { rotate: `${rotation}deg` }],
              }}>
              <Image
                source={src}
                style={{ width: '100%', height: '100%' }}
                contentFit="contain"
                onLoad={(e) => setNat({ w: e.source.width, h: e.source.height })}
                onError={() => setFailed(true)}
              />
            </Animated.View>
          )}
          {!nat && !failed ? (
            <View pointerEvents="none" style={{ position: 'absolute' }}>
              <ActivityIndicator color="#fff" />
            </View>
          ) : null}

          {idx > 0 ? (
            <View style={{ position: 'absolute', left: 10 }}>
              <ToolBtn icon="chevron-back" label="이전 그림" onPress={() => go(-1)} filled size={24} />
            </View>
          ) : null}
          {idx >= 0 && idx < images.length - 1 ? (
            <View style={{ position: 'absolute', right: 10 }}>
              <ToolBtn icon="chevron-forward" label="다음 그림" onPress={() => go(1)} filled size={24} />
            </View>
          ) : null}

          {notice ? (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                bottom: 12,
                paddingHorizontal: 14,
                paddingVertical: 9,
                borderRadius: 10,
                backgroundColor: notice.error ? '#b42318' : 'rgba(255,255,255,0.16)',
              }}>
              <Text style={{ color: '#fff', fontSize: 13 }}>{notice.text}</Text>
            </View>
          ) : null}
        </View>

        {/* 하단 도구 — 왼쪽 보기, 오른쪽 전달·저장·인쇄 */}
        <View
          className="flex-row items-center justify-between px-2 pt-2"
          style={{ paddingBottom: Math.max(insets.bottom, 10) }}>
          <View className="flex-row items-center">
            <ToolBtn
              icon="scan-outline"
              label="원본크기"
              text={wide}
              onPress={() => setT(fit.r ? 1 / fit.r : 1, 0, 0, true)}
            />
            <ToolBtn icon="contract-outline" label="화면맞춤" text={wide} onPress={() => setT(1, 0, 0, true)} />
            <ToolBtn icon="remove" label="축소" onPress={() => zoomAt(t.current.s / STEP, 0, 0, true)} />
            <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, minWidth: 40, textAlign: 'center' }}>{pct}%</Text>
            <ToolBtn icon="add" label="확대" onPress={() => zoomAt(t.current.s * STEP, 0, 0, true)} />
            <ToolBtn icon="refresh" label="회전" onPress={() => setRotation((r) => (r + 90) % 360)} />
          </View>
          <View className="flex-row items-center">
            <ToolBtn icon="arrow-redo-outline" label="전달" text={wide} onPress={() => setForwardOpen(true)} />
            <ToolBtn
              icon={Platform.OS === 'web' ? 'download-outline' : 'share-outline'}
              label="저장"
              text={wide}
              loading={busy === 'save'}
              onPress={() => void save()}
            />
            {IS_DESKTOP_WEB ? (
              <ToolBtn icon="print-outline" label="인쇄" text={wide} loading={busy === 'print'} onPress={() => void print()} />
            ) : null}
          </View>
        </View>

        {/* 전달 — 다른 대화방 고르기 */}
        <Sheet
          visible={forwardOpen}
          onClose={() => (forwarding != null ? undefined : setForwardOpen(false))}
          title="다른 대화방으로 전달"
          fillHeight={0.6}>
          {rooms.loading && !rooms.data ? (
            <View className="items-center py-6">
              <ActivityIndicator />
            </View>
          ) : !targets.length ? (
            <Text className="py-6 text-center text-[13px] text-cd-muted">전달할 수 있는 다른 대화방이 없습니다.</Text>
          ) : (
            <ScrollView className="flex-1">
              {targets.map((r) => (
                <Pressable
                  key={r.roomId}
                  onPress={() => void forward(r)}
                  disabled={forwarding != null}
                  className="min-h-[52px] flex-row items-center gap-3 border-b border-cd-grid-line py-2 active:opacity-70">
                  <Avatar name={r.name} photoPath={r.peerPhotoPath} size="sm" />
                  <View className="flex-1">
                    <Text className="text-[14px] font-semibold text-cd-text" numberOfLines={1}>
                      {r.name}
                    </Text>
                    <Text className="text-[12px] text-cd-faint">
                      {r.roomType === 'group' ? `그룹 · ${r.memberCount}명` : '개인'}
                    </Text>
                  </View>
                  {forwarding === r.roomId ? <ActivityIndicator size="small" /> : null}
                </Pressable>
              ))}
            </ScrollView>
          )}
        </Sheet>
      </View>
    </Modal>
  );
}

/** 뷰어 도구 버튼 — 어두운 바탕 위 흰 아이콘(+ 넓은 화면에서는 글자). 반경 10. */
function ToolBtn({
  icon,
  label,
  onPress,
  text,
  filled,
  loading,
  size = 20,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  /** 아이콘 옆에 이름을 함께 적는다. */
  text?: boolean;
  /** 그림 위에 뜨는 버튼(이전·다음) — 반투명 바탕을 깐다. */
  filled?: boolean;
  loading?: boolean;
  size?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        minWidth: 40,
        height: 40,
        paddingHorizontal: text ? 10 : 0,
        borderRadius: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        backgroundColor: pressed
          ? 'rgba(255,255,255,0.24)'
          : hovered
            ? 'rgba(255,255,255,0.14)'
            : filled
              ? 'rgba(0,0,0,0.42)'
              : 'transparent',
      })}>
      {loading ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name={icon} size={size} color="#fff" />}
      {text ? <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>{label}</Text> : null}
    </Pressable>
  );
}
