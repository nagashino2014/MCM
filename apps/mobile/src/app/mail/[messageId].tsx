import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import {
  ActionBar,
  Avatar,
  Button,
  EmptyState,
  HtmlView,
  Screen,
  SkeletonList,
  useToast,
} from '@/components/ui';
import { useApi } from '@/lib/use-api';
import { downloadAndShare, downloadAsDataUrl } from '@/lib/download';
import { displayFrom, mailDate } from '@/app/(tabs)/mail';
import { useTheme } from '@/theme/useTheme';

interface Attachment {
  attachmentId: string;
  filename: string;
  contentType: string | null;
  sizeBytes: number | null;
  contentId: string | null;
}
interface MailDetail {
  messageId: string;
  subject: string;
  fromAddr: string | null;
  toAddrs: { name?: string; address: string }[];
  ccAddrs: { name?: string; address: string }[];
  bodyHtml: string | null;
  bodyText: string | null;
  sentAt: string | null;
  createdAt: string;
  attachments: Attachment[];
}

const fmtSize = (n?: number | null) =>
  !n ? '' : n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(n / 1024)}KB`;

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 인라인 이미지는 최대 이만큼만 본문에 심는다(용량·속도). */
const MAX_INLINE = 5;

// 메일 뷰어(M3) — 본문·첨부·답장.
export default function MailViewerScreen() {
  const { messageId } = useLocalSearchParams<{ messageId: string }>();
  const router = useRouter();
  const toast = useToast();
  const { c } = useTheme();

  const { data, loading, error } = useApi<MailDetail>(`/api/mail/messages/${messageId}`);
  const [showTo, setShowTo] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  /** cid → data URL (WebView 는 Bearer 를 못 붙여 앱이 미리 받아 심는다). */
  const [inlineMap, setInlineMap] = useState<Record<string, string>>({});

  const inlineAtts = useMemo(
    () => (data?.attachments ?? []).filter((a) => a.contentId).slice(0, MAX_INLINE),
    [data?.attachments]
  );
  const fileAtts = useMemo(
    () => (data?.attachments ?? []).filter((a) => !a.contentId),
    [data?.attachments]
  );

  // 인라인 이미지 선(先)다운로드
  useEffect(() => {
    if (!inlineAtts.length) return;
    let alive = true;
    void (async () => {
      const out: Record<string, string> = {};
      for (const a of inlineAtts) {
        const url = await downloadAsDataUrl(
          `/api/mail/attachments?id=${encodeURIComponent(a.attachmentId)}`,
          a.filename,
          a.contentType
        );
        if (url && a.contentId) out[a.contentId.replace(/^<|>$/g, '')] = url;
      }
      if (alive) setInlineMap(out);
    })();
    return () => {
      alive = false;
    };
  }, [inlineAtts]);

  const html = useMemo(() => {
    if (!data) return '';
    let body =
      data.bodyHtml && data.bodyHtml.trim()
        ? data.bodyHtml
        : `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(data.bodyText ?? '')}</pre>`;
    // cid: 참조를 미리 받아 둔 data URL 로 치환
    for (const [cid, dataUrl] of Object.entries(inlineMap)) {
      body = body.replace(
        new RegExp(`cid:${cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi'),
        dataUrl
      );
    }
    return body;
  }, [data, inlineMap]);

  const openAttachment = async (a: Attachment) => {
    setBusy(a.attachmentId);
    try {
      await downloadAndShare(
        `/api/mail/attachments?id=${encodeURIComponent(a.attachmentId)}`,
        a.filename,
        a.contentType
      );
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  if (loading && !data) {
    return (
      <Screen>
        <SkeletonList count={3} />
      </Screen>
    );
  }
  if (!data) {
    return (
      <Screen>
        <EmptyState
          icon="alert-circle-outline"
          title="메일을 불러오지 못했습니다"
          description={error ?? undefined}
        />
      </Screen>
    );
  }

  const to = data.toAddrs ?? [];
  const cc = data.ccAddrs ?? [];

  return (
    <SafeAreaView edges={[]} style={{ backgroundColor: c.bg }} className="flex-1 bg-cd-bg">
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}>
        {/* 제목 + 발신자 */}
        <View className="gap-2 rounded-card border border-cd-border bg-cd-card p-4">
          <Text className="text-[18px] font-extrabold leading-6 text-cd-text">
            {data.subject || '(제목 없음)'}
          </Text>
          <View className="flex-row items-center gap-2.5">
            <Avatar name={displayFrom(data.fromAddr)} size="md" />
            <View className="flex-1">
              <Text className="text-[14px] font-bold text-cd-text">{displayFrom(data.fromAddr)}</Text>
              <Text numberOfLines={1} className="text-[11px] text-cd-faint">
                {data.fromAddr ?? ''}
              </Text>
            </View>
            <Text className="text-[11px] text-cd-faint">
              {mailDate(data.sentAt ?? data.createdAt)}
            </Text>
          </View>

          <Pressable onPress={() => setShowTo((v) => !v)} className="active:opacity-70">
            <View className="flex-row items-center gap-1">
              <Text numberOfLines={showTo ? undefined : 1} className="flex-1 text-[12px] text-cd-muted">
                받는 사람 {to.map((t) => t.name || t.address).join(', ') || '-'}
                {cc.length ? ` · 참조 ${cc.map((t) => t.name || t.address).join(', ')}` : ''}
              </Text>
              <Ionicons name={showTo ? 'chevron-up' : 'chevron-down'} size={14} color={c.faint} />
            </View>
          </Pressable>
        </View>

        {/* 본문 — 이미지는 차단·경고 없이 바로 표시한다(사용자 확정 2026-08-10).
            트레이드오프: 원격 이미지 자동 로드 = 발신자 수신확인 픽셀이 동작한다(사내 메일 위주라 수용). */}
        <View className="overflow-hidden rounded-card border border-cd-border bg-cd-card px-3 py-2">
          <HtmlView html={html} showImages />
        </View>

        {/* 첨부 */}
        {fileAtts.length > 0 ? (
          <View className="gap-2 rounded-card border border-cd-border bg-cd-card p-4">
            <Text className="text-[13px] font-bold text-cd-muted">첨부 {fileAtts.length}</Text>
            {fileAtts.map((a) => (
              <Pressable
                key={a.attachmentId}
                onPress={() => openAttachment(a)}
                className="min-h-[44px] flex-row items-center gap-2 rounded-xl border border-cd-border px-3 py-2 active:opacity-70">
                <Ionicons name="document-attach-outline" size={18} color={c.primary} />
                <Text numberOfLines={1} className="flex-1 text-[13px] text-cd-text">
                  {a.filename}
                </Text>
                {busy === a.attachmentId ? (
                  <ActivityIndicator size="small" />
                ) : (
                  <Text className="text-[11px] text-cd-faint">{fmtSize(a.sizeBytes)}</Text>
                )}
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <ActionBar>
        <View className="flex-1">
          <Button
            label="답장"
            icon="arrow-undo-outline"
            onPress={() => router.push(`/mail/compose?reply=${data.messageId}`)}
            full
          />
        </View>
        <View className="flex-1">
          <Button
            label="전달"
            variant="ghost"
            icon="arrow-redo-outline"
            onPress={() => router.push(`/mail/compose?forward=${data.messageId}`)}
            full
          />
        </View>
      </ActionBar>
    </SafeAreaView>
  );
}
