import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Button, EmptyState, ListRow, SearchBar, Sheet, SkeletonList } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { useTheme } from '@/theme/useTheme';

export interface PersonalDoc {
  documentId: string;
  fileName: string;
  contentType: string | null;
  byteSize: number;
  createdAt: string;
}

function fmtBytes(n: number): string {
  if (!n || n <= 0) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

/**
 * 개인 문서함에서 첨부 — 대화방 입력창의 더하기 메뉴 [문서함](2026-11-06).
 * 내 문서함(/api/personal-docs) 목록에서 여러 개를 골라 [첨부]를 누르면 전송 대기 첨부로 올라간다.
 * 파일 본문은 내려받지 않는다 — 보낼 때 서버가 문서함에서 대화방 첨부로 복제한다(원본은 문서함에 남는다).
 */
export function PersonalDocPickerSheet({
  visible,
  max,
  onDone,
  onClose,
}: {
  visible: boolean;
  /** 지금 더 올릴 수 있는 첨부 수. */
  max: number;
  onDone: (docs: PersonalDoc[]) => void;
  onClose: () => void;
}) {
  const { c } = useTheme();
  const api = useApi<{ docs: PersonalDoc[] }>('/api/personal-docs', { skip: !visible });
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);

  // 열릴 때 초기화 — effect 대신 렌더 중 파생(LinkPickerSheet 와 같은 규칙).
  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) {
      setQ('');
      setPicked([]);
    }
  }

  const docs = api.data?.docs ?? [];
  const term = q.trim().toLowerCase();
  const shown = term ? docs.filter((d) => d.fileName.toLowerCase().includes(term)) : docs;
  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : prev.length < max ? [...prev, id] : prev));

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="문서함"
      fillHeight={0.85}
      footer={
        <View className="flex-1">
          <Button
            full
            label={picked.length ? `첨부 (${picked.length})` : '첨부'}
            disabled={!picked.length}
            onPress={() => onDone(docs.filter((d) => picked.includes(d.documentId)))}
          />
        </View>
      }>
      <View className="flex-1 gap-2">
        <SearchBar value={q} onChangeText={setQ} placeholder="파일 이름 검색" />
        {api.error ? (
          <EmptyState icon="alert-circle-outline" title={api.error} />
        ) : api.loading && !docs.length ? (
          <View className="pt-3">
            <SkeletonList count={3} />
          </View>
        ) : !docs.length ? (
          <EmptyState icon="folder-open-outline" title="문서함이 비어 있습니다" description="PC 화면의 개인 문서함에 올린 파일이 여기에 보입니다." />
        ) : !shown.length ? (
          <EmptyState icon="search-outline" title="검색 결과가 없습니다" />
        ) : (
          <ScrollView automaticallyAdjustKeyboardInsets className="flex-1" keyboardShouldPersistTaps="handled">
            {shown.map((d) => {
              const on = picked.includes(d.documentId);
              return (
                <ListRow
                  key={d.documentId}
                  icon={(d.contentType ?? '').startsWith('image/') ? 'image-outline' : 'document-outline'}
                  title={d.fileName}
                  subtitle={[fmtBytes(d.byteSize), fmtDate(d.createdAt)].filter(Boolean).join(' · ')}
                  right={<Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? c.primary : c.faint} />}
                  onPress={() => toggle(d.documentId)}
                />
              );
            })}
          </ScrollView>
        )}
      </View>
    </Sheet>
  );
}
