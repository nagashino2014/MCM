import { Pressable, ScrollView, Text } from 'react-native';

import { Avatar } from '@/components/ui';

export interface MentionCandidate {
  userId: string;
  name: string;
  positionName: string | null;
  photoPath: string | null;
}

/**
 * 멘션 후보 목록 — 그룹 대화방 입력창에서 `@` 를 치면 입력 영역 맨 위에 뜬다(2026-11-06).
 * activeIndex 는 PC 에서 방향키로 고른 줄이다(Enter·Tab 으로 넣는다). 터치에서는 줄을 누른다.
 */
export function MentionSuggestions({
  candidates,
  activeIndex,
  onPick,
  framed,
}: {
  candidates: MentionCandidate[];
  activeIndex: number;
  onPick: (c: MentionCandidate) => void;
  /** 틀 배치(입력 상자 안) — 구분선을 아래에 둔다. 전체 화면 대화방은 위에 둔다. */
  framed: boolean;
}) {
  return (
    <ScrollView
      style={{ maxHeight: 176 }}
      keyboardShouldPersistTaps="always"
      className={`bg-cd-card ${framed ? 'border-b border-cd-border' : 'border-t border-cd-border'}`}>
      {candidates.map((m, i) => (
        <Pressable
          key={m.userId}
          onPress={() => onPick(m)}
          accessibilityRole="button"
          accessibilityLabel={`${m.name} 멘션`}
          className={`min-h-[44px] flex-row items-center gap-2.5 px-4 py-1.5 active:opacity-70 ${i === activeIndex ? 'bg-cd-primary-soft' : ''}`}>
          <Avatar name={m.name} photoPath={m.photoPath} size="sm" />
          <Text numberOfLines={1} className="flex-1 text-[14px] font-semibold text-cd-text">
            {m.name}
            {m.positionName ? <Text className="text-[12px] font-normal text-cd-faint"> {m.positionName}</Text> : null}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
