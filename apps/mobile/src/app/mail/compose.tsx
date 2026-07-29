import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

import { ActionBar, Button, Input, Textarea, useToast } from '@/components/ui';
import { apiFetch, apiJson } from '@/lib/api';
import { RecipientField } from '@/components/mail/RecipientField';
import { useTheme } from '@/theme/useTheme';

interface MailDetail {
  messageId: string;
  subject: string;
  fromAddr: string | null;
  toAddrs: { name?: string; address: string }[];
  ccAddrs: { name?: string; address: string }[];
  rfcMessageId: string | null;
  references: string[];
}

interface Picked {
  uri: string;
  name: string;
  mimeType: string | null;
  size: number | null;
}

const MAX_TOTAL = 7 * 1024 * 1024;
const fmtSize = (n?: number | null) =>
  !n ? '' : n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(n / 1024)}KB`;

/**
 * 메일 작성·답장·전달(M3).
 *
 * 본문은 **평문**으로 보내고, 원문 인용·서명은 서버가 붙인다(블루프린트 §9.1 확정).
 * 앱 편집기에 원문 HTML 을 싣지 않으므로 서식이 깨지거나 용량이 커지는 문제가 없다.
 */
export default function MailComposeScreen() {
  const { reply, forward, to: toParam } = useLocalSearchParams<{
    reply?: string;
    forward?: string;
    to?: string;
  }>();
  const router = useRouter();
  const toast = useToast();
  const { c } = useTheme();

  const quoteOf = reply || forward || null;
  const quoteMode = forward ? 'forward' : 'reply';

  const [to, setTo] = useState(toParam ?? '');
  const [cc, setCc] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<Picked[]>([]);
  const [sending, setSending] = useState(false);
  const [src, setSrc] = useState<MailDetail | null>(null);

  // 답장·전달이면 원문에서 수신자·제목을 시드한다(본문 인용은 서버 몫).
  useEffect(() => {
    if (!quoteOf) return;
    void (async () => {
      try {
        const d = await apiJson<MailDetail>(`/api/mail/messages/${quoteOf}`);
        setSrc(d);
        const s = (d.subject ?? '').trim();
        if (forward) {
          setSubject(/^(fwd|fw):/i.test(s) ? s : `Fwd: ${s}`);
        } else {
          setSubject(/^re:/i.test(s) ? s : `Re: ${s}`);
          setTo(d.fromAddr ?? '');
        }
      } catch (e) {
        toast.show((e as Error).message, 'error');
      }
    })();
    // toast 는 매 렌더 새 객체 — 의존성에서 제외
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteOf, forward]);

  const pickFiles = async () => {
    const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (res.canceled) return;
    const next = [...files];
    for (const a of res.assets) {
      next.push({ uri: a.uri, name: a.name, mimeType: a.mimeType ?? null, size: a.size ?? null });
    }
    const total = next.reduce((s, f) => s + (f.size ?? 0), 0);
    if (total > MAX_TOTAL) {
      toast.show('첨부 총량이 7MB 를 넘습니다.', 'error');
      return;
    }
    setFiles(next);
  };

  const send = async () => {
    if (!to.trim()) {
      toast.show('받는 사람을 입력하세요.', 'error');
      return;
    }
    setSending(true);
    try {
      const fd = new FormData();
      fd.append('to', to.trim());
      if (cc.trim()) fd.append('cc', cc.trim());
      fd.append('subject', subject);
      // 서버가 평문을 HTML 로 바꾸고 서명·인용을 붙인다.
      fd.append('plainBody', body);
      if (quoteOf) {
        fd.append('quoteOf', quoteOf);
        fd.append('quoteMode', quoteMode);
      }
      if (src?.rfcMessageId && !forward) {
        fd.append('inReplyTo', src.rfcMessageId);
        fd.append('references', [...(src.references ?? []), src.rfcMessageId].join(' '));
      }
      fd.append('idempotencyKey', `m-${Date.now()}-${Math.round(Math.random() * 1e6)}`);
      for (const f of files) {
        // ⚠ SDK 57 fetch 는 {uri,name,type} 파트를 거부한다 → expo-file-system File 로 넘긴다.
        fd.append('files', new File(f.uri) as unknown as Blob, f.name);
      }

      const res = await apiFetch('/api/mail/send', { method: 'POST', body: fd });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? `발송 실패 (HTTP ${res.status})`);
      toast.show('메일을 보냈습니다.', 'success');
      router.back();
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView edges={[]} style={{ backgroundColor: c.bg }} className="flex-1 bg-cd-bg">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
        keyboardVerticalOffset={90}>
        <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, gap: 12 }}>
          <RecipientField label="받는 사람" value={to} onChange={setTo} autoFocus={!quoteOf} />

          {showCc ? (
            <RecipientField label="참조" value={cc} onChange={setCc} />
          ) : (
            <Pressable onPress={() => setShowCc(true)} className="self-start active:opacity-70">
              <Text className="text-[13px] font-bold text-cd-primary">+ 참조 추가</Text>
            </Pressable>
          )}

          <Input label="제목" value={subject} onChangeText={setSubject} placeholder="제목" />

          <Textarea
            label="내용"
            value={body}
            onChangeText={setBody}
            placeholder="내용을 입력하세요."
            minHeight={200}
          />

          {quoteOf ? (
            <View className="flex-row items-center gap-1.5 rounded-xl bg-cd-surface px-3 py-2">
              <Ionicons name="information-circle-outline" size={14} color={c.faint} />
              <Text className="flex-1 text-[12px] text-cd-faint">
                {forward ? '원문이 아래에 함께 전달됩니다.' : '원문이 아래에 인용됩니다.'} 서명도
                자동으로 붙습니다.
              </Text>
            </View>
          ) : null}

          {/* 첨부 */}
          <View className="gap-2">
            <View className="flex-row items-center gap-2">
              <Button label="파일 첨부" variant="ghost" size="sm" icon="attach" onPress={pickFiles} />
              {files.length ? (
                <Text className="text-[12px] text-cd-faint">
                  {files.length}개 · {fmtSize(files.reduce((s, f) => s + (f.size ?? 0), 0))}
                </Text>
              ) : null}
            </View>
            {files.map((f, i) => (
              <View
                key={`${f.uri}-${i}`}
                className="min-h-[44px] flex-row items-center gap-2 rounded-xl border border-cd-border px-3 py-2">
                <Ionicons name="document-outline" size={16} color={c.primary} />
                <Text numberOfLines={1} className="flex-1 text-[13px] text-cd-text">
                  {f.name}
                </Text>
                <Text className="text-[11px] text-cd-faint">{fmtSize(f.size)}</Text>
                <Pressable
                  onPress={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  hitSlop={8}>
                  <Ionicons name="close" size={16} color={c.faint} />
                </Pressable>
              </View>
            ))}
          </View>
        </ScrollView>

        <ActionBar>
          <View className="flex-1">
            <Button label="취소" variant="ghost" onPress={() => router.back()} full />
          </View>
          <View className="flex-[2]">
            <Button label="보내기" icon="send" onPress={send} loading={sending} full />
          </View>
        </ActionBar>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
