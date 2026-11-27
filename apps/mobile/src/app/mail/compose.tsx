import { ShellBackground } from '@/theme/ShellBackground';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

import { ActionBar, Button, FilterPill, Input, Textarea, useToast } from '@/components/ui';
import { htmlToPlain, plainToHtml } from '@/components/approval/FormField';
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

interface Signature {
  signatureId: string;
  name: string;
  bodyHtml: string;
  isDefault: boolean;
}

/** 서명 없음 선택값 — 서버에 applySignature=0 으로 보낸다. */
const NO_SIGNATURE = '__none__';

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
  // 숨은참조(2026-11-27 직원 요청 36) — 받는 사람에게 보이지 않는 수신자. 서버 /api/mail/send 의 bcc 필드.
  const [bcc, setBcc] = useState('');
  const [showBcc, setShowBcc] = useState(false);
  // 서명(직원 요청 35) — 내 서명 목록에서 고른다. 기본 서명이 처음 선택되고, 하나도 없으면 여기서 바로 만든다.
  const [signatures, setSignatures] = useState<Signature[] | null>(null);
  const [signatureId, setSignatureId] = useState<string>(NO_SIGNATURE);
  const [sigDraft, setSigDraft] = useState<string | null>(null);
  const [sigSaving, setSigSaving] = useState(false);
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

  const loadSignatures = async (select?: string) => {
    try {
      const d = await apiJson<{ signatures?: Signature[] }>('/api/mail/signatures');
      const list = Array.isArray(d.signatures) ? d.signatures : [];
      setSignatures(list);
      setSignatureId(select ?? list.find((s) => s.isDefault)?.signatureId ?? NO_SIGNATURE);
    } catch {
      setSignatures(null); // 서명 목록을 못 받아도 메일은 쓸 수 있다(서버가 기본 서명을 붙인다)
    }
  };
  useEffect(() => {
    void loadSignatures();
  }, []);

  // 서명이 하나도 없을 때 — 평문 서명을 만들어 기본 서명으로 저장한다(PC 메일 설정의 서명과 같은 목록).
  const saveNewSignature = async () => {
    const text = (sigDraft ?? '').trim();
    if (!text) {
      toast.show('서명 내용을 입력하세요.', 'error');
      return;
    }
    setSigSaving(true);
    try {
      const res = await apiFetch('/api/mail/signatures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '기본 서명', bodyHtml: plainToHtml(text), isDefault: true }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string; signatureId?: string };
      if (!res.ok) throw new Error(d.error ?? `서명 저장 실패 (HTTP ${res.status})`);
      setSigDraft(null);
      await loadSignatures(d.signatureId);
      toast.show('서명을 저장했습니다.', 'success');
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setSigSaving(false);
    }
  };

  const selectedSig = signatures?.find((s) => s.signatureId === signatureId) ?? null;

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
      if (bcc.trim()) fd.append('bcc', bcc.trim());
      fd.append('subject', subject);
      // 서버가 평문을 HTML 로 바꾸고 서명·인용을 붙인다.
      fd.append('plainBody', body);
      // 서명 — 목록을 받았을 때만 고른 값을 보낸다(못 받았으면 지금처럼 서버가 기본 서명을 붙인다).
      if (signatures) {
        if (signatureId === NO_SIGNATURE) fd.append('applySignature', '0');
        else fd.append('signatureId', signatureId);
      }
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
    <SafeAreaView edges={[]} className="flex-1 bg-transparent">
      <ShellBackground />
      {/* 안드로이드도 padding — edge-to-edge 에서는 창이 키보드만큼 줄지 않아 입력란이 가려진다(직원 요청 37과 같은 원인). */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'web' ? undefined : 'padding'}
        className="flex-1"
        keyboardVerticalOffset={90}>
        <ScrollView automaticallyAdjustKeyboardInsets className="flex-1" contentContainerStyle={{ padding: 16, gap: 12 }}>
          <RecipientField label="받는 사람" value={to} onChange={setTo} autoFocus={!quoteOf} />

          {showCc ? <RecipientField label="참조" value={cc} onChange={setCc} /> : null}
          {showBcc ? <RecipientField label="숨은참조" value={bcc} onChange={setBcc} /> : null}
          {!showCc || !showBcc ? (
            <View className="flex-row gap-4">
              {!showCc ? (
                <Pressable onPress={() => setShowCc(true)} className="active:opacity-70">
                  <Text className="text-[13px] font-bold text-cd-primary">+ 참조 추가</Text>
                </Pressable>
              ) : null}
              {!showBcc ? (
                <Pressable onPress={() => setShowBcc(true)} className="active:opacity-70">
                  <Text className="text-[13px] font-bold text-cd-primary">+ 숨은참조 추가</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <Input label="제목" value={subject} onChangeText={setSubject} placeholder="제목" />

          <Textarea
            label="내용"
            value={body}
            onChangeText={setBody}
            placeholder="내용을 입력하세요."
            minHeight={200}
          />

          {/* 서명 — 본문 아래에 붙는다(서버 조립). 목록을 못 받으면 칸을 숨기고 서버가 기본 서명을 붙인다. */}
          {signatures ? (
            <View className="gap-1.5">
              <Text className="text-[12px] font-medium text-cd-muted">서명</Text>
              {signatures.length ? (
                <View className="flex-row flex-wrap gap-1.5">
                  {signatures.map((s) => (
                    <FilterPill
                      key={s.signatureId}
                      label={s.name || '서명'}
                      active={signatureId === s.signatureId}
                      onPress={() => setSignatureId(s.signatureId)}
                    />
                  ))}
                  <FilterPill label="서명 없음" active={signatureId === NO_SIGNATURE} onPress={() => setSignatureId(NO_SIGNATURE)} />
                </View>
              ) : sigDraft == null ? (
                <Pressable onPress={() => setSigDraft('')} className="self-start active:opacity-70">
                  <Text className="text-[13px] font-bold text-cd-primary">+ 서명 만들기</Text>
                </Pressable>
              ) : null}
              {selectedSig ? (
                <View className="rounded-xl border border-cd-border bg-cd-surface px-3 py-2">
                  <Text className="text-[12px] text-cd-muted">{htmlToPlain(selectedSig.bodyHtml).trim()}</Text>
                </View>
              ) : null}
              {sigDraft != null ? (
                <View className="gap-2">
                  <Textarea
                    value={sigDraft}
                    onChangeText={setSigDraft}
                    placeholder={'이름 직급\n회사명 · 전화번호'}
                    minHeight={80}
                  />
                  <View className="flex-row gap-2">
                    <Button label="취소" variant="ghost" size="sm" onPress={() => setSigDraft(null)} />
                    <Button label="서명 저장" size="sm" onPress={saveNewSignature} loading={sigSaving} />
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}

          {quoteOf ? (
            <View className="flex-row items-center gap-1.5 rounded-xl bg-cd-surface px-3 py-2">
              <Ionicons name="information-circle-outline" size={14} color={c.faint} />
              <Text className="flex-1 text-[12px] text-cd-faint">
                {forward ? '원문이 아래에 함께 전달됩니다.' : '원문이 아래에 인용됩니다.'}
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
