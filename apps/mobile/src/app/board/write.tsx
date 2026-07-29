import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

import { ActionBar, Button, Chip, Input, Textarea, useToast } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { useTheme } from '@/theme/useTheme';

interface Picked {
  uri: string;
  name: string;
  size: number | null;
}

const fmtSize = (n?: number | null) =>
  !n ? '' : n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(n / 1024)}KB`;

/**
 * 공지·게시글 작성(M4).
 * 본문은 평문으로 보내고 서버가 HTML 로 바꾼다(메일과 같은 규칙 — 블루프린트 §9.1).
 * 공지 기간·고정 기간 같은 세부 설정은 웹에서 한다(여기서는 상단 고정 여부만).
 */
export default function BoardWriteScreen() {
  const router = useRouter();
  const toast = useToast();
  const { c } = useTheme();

  const [scope, setScope] = useState<'company' | 'dept'>('dept');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState(false);
  const [notifyPush, setNotifyPush] = useState(true);
  const [files, setFiles] = useState<Picked[]>([]);
  const [saving, setSaving] = useState(false);

  const pickFiles = async () => {
    const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (res.canceled) return;
    setFiles((prev) => [
      ...prev,
      ...res.assets.map((a) => ({ uri: a.uri, name: a.name, size: a.size ?? null })),
    ]);
  };

  const submit = async () => {
    if (!title.trim()) {
      toast.show('제목을 입력하세요.', 'error');
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('scope', scope);
      fd.append('title', title.trim());
      fd.append('plainBody', body);
      fd.append('pinned', pinned ? '1' : '0');
      fd.append('notifyEmail', notifyEmail ? '1' : '0');
      fd.append('notifyPush', notifyPush ? '1' : '0');
      for (const f of files) {
        // SDK 57 fetch 는 {uri,name,type} 파트를 거부한다 → File 로 넘긴다.
        fd.append('files', new File(f.uri) as unknown as Blob, f.name);
      }
      const res = await apiFetch('/api/board', { method: 'POST', body: fd });
      const d = (await res.json().catch(() => ({}))) as { error?: string; attachFailed?: string[] };
      if (!res.ok) throw new Error(d.error ?? `등록 실패 (HTTP ${res.status})`);
      if (d.attachFailed?.length) {
        toast.show(`글은 등록됐지만 첨부 ${d.attachFailed.length}건은 실패했습니다.`, 'error');
      } else {
        toast.show('등록했습니다.', 'success');
      }
      router.back();
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView edges={[]} style={{ backgroundColor: c.bg }} className="flex-1 bg-cd-bg">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
        keyboardVerticalOffset={90}>
        <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, gap: 12 }}>
          <View className="gap-1.5">
            <Text className="text-[13px] font-bold text-cd-muted">게시 위치</Text>
            <View className="flex-row gap-2">
              <Chip label="부서 게시판" active={scope === 'dept'} onPress={() => setScope('dept')} />
              <Chip label="전사 공지" active={scope === 'company'} onPress={() => setScope('company')} />
            </View>
            {scope === 'company' ? (
              <Text className="text-[11px] text-cd-faint">
                전사 공지는 게시판 관리 권한이 있어야 등록됩니다.
              </Text>
            ) : null}
          </View>

          <Input label="제목" value={title} onChangeText={setTitle} placeholder="제목" />
          <Textarea
            label="내용"
            value={body}
            onChangeText={setBody}
            placeholder="내용을 입력하세요."
            minHeight={200}
          />

          <View className="gap-2 rounded-card border border-cd-border bg-cd-card p-4">
            <Row label="상단 고정" value={pinned} onChange={setPinned} />
            <Row label="메일 알림 발송" value={notifyEmail} onChange={setNotifyEmail} />
            <Row label="모바일 푸시 알림" value={notifyPush} onChange={setNotifyPush} />
            <Text className="text-[11px] text-cd-faint">
              {scope === 'company' ? '전 임직원' : '소속 부서원'}에게 발송됩니다(작성자 본인 제외).
            </Text>
          </View>

          <View className="gap-2">
            <View className="flex-row items-center gap-2">
              <Button label="파일 첨부" variant="ghost" size="sm" icon="attach" onPress={pickFiles} />
              {files.length ? (
                <Text className="text-[12px] text-cd-faint">{files.length}개</Text>
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
            <Button label="등록" icon="checkmark" onPress={submit} loading={saving} full />
          </View>
        </ActionBar>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Row({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const { c } = useTheme();
  return (
    <View className="min-h-[40px] flex-row items-center">
      <Text className="flex-1 text-[14px] text-cd-text">{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: c.primary, false: c.border }} />
    </View>
  );
}
