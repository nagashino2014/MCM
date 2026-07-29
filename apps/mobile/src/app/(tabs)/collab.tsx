import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { IconButton, Screen, SegmentedTabs, type SegmentItem } from '@/components/ui';
import { BoardList } from '@/components/collab/BoardList';
import { DirectoryPane } from '@/components/collab/DirectoryPane';
import { OrgChartPane } from '@/components/collab/OrgChartPane';

type Tab = 'company' | 'dept' | 'directory' | 'org';

const ITEMS: SegmentItem<Tab>[] = [
  { key: 'company', label: '전사 공지' },
  { key: 'dept', label: '부서 게시판' },
  { key: 'directory', label: '주소록' },
  { key: 'org', label: '조직도' },
];

// 소통 탭(M4) — 공지·게시판 + 주소록·조직도(블루프린트 §5.1).
export default function CollabScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('company');
  /** 탭 복귀 시 목록을 다시 읽게 하는 키(공지 작성 후 돌아왔을 때 반영). */
  const [nonce, setNonce] = useState(0);

  useFocusEffect(
    useCallback(() => {
      setNonce((n) => n + 1);
    }, [])
  );

  const isBoard = tab === 'company' || tab === 'dept';

  return (
    <Screen scroll={false} padded={false}>
      <View className="flex-row items-center border-b border-cd-border bg-cd-card">
        <View className="flex-1">
          <SegmentedTabs items={ITEMS} value={tab} onChange={setTab} />
        </View>
        {isBoard ? (
          <View className="pr-2">
            <IconButton icon="create-outline" onPress={() => router.push('/board/write')} />
          </View>
        ) : null}
      </View>

      {tab === 'company' ? (
        <BoardList key={`company-${nonce}`} scope="company" />
      ) : tab === 'dept' ? (
        <BoardList key={`dept-${nonce}`} scope="dept" />
      ) : tab === 'directory' ? (
        <DirectoryPane />
      ) : (
        <OrgChartPane />
      )}
    </Screen>
  );
}
