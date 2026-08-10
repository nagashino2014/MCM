import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Sheet } from '@/components/ui';

/**
 * 이모지 피커(WID-P1) — 데스크탑 위젯·웹에는 OS 이모지 키보드가 없어서 필요하다.
 * 목록은 사내 대화에서 실제로 쓸 법한 것만 추린 고정 세트(라이브러리 무의존).
 */
const GROUPS: { key: string; tab: string; label: string; items: string[] }[] = [
  {
    key: 'often',
    tab: '⭐',
    label: '자주 쓰는',
    items: [
      '👍', '🙏', '😊', '😄', '👌', '🙇', '✅', '❗',
      '🔥', '🎉', '💪', '😅', '😢', '😮', '👏', '🤝',
      '📌', '⏰', '📎', '✍️', '🙋', '💯', '❤️', '🫡',
    ],
  },
  {
    key: 'face',
    tab: '😀',
    label: '표정',
    items: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂',
      '🙂', '😉', '😊', '😇', '🥰', '😍', '😘', '😋',
      '😎', '🤩', '🥳', '🤔', '🤨', '😐', '😑', '😶',
      '🙄', '😏', '😮', '😲', '😳', '🥺', '😢', '😭',
      '😤', '😠', '😱', '😴', '🤒', '🤗', '🤭', '🫠',
    ],
  },
  {
    key: 'hand',
    tab: '👍',
    label: '제스처',
    items: [
      '👍', '👎', '👌', '✌️', '🤞', '🤙', '👋', '🙌',
      '👏', '🙏', '🤝', '💪', '🫡', '🙋', '🙇', '🤷',
      '🤦', '👀', '✍️', '👉', '👈', '👆', '👇', '✊',
    ],
  },
  {
    key: 'work',
    tab: '💼',
    label: '업무',
    items: [
      '📌', '📎', '📁', '📄', '📊', '📈', '📉', '🗓️',
      '⏰', '⌛', '✅', '☑️', '❌', '⚠️', '❗', '❓',
      '💼', '🏢', '🏭', '🚗', '✈️', '📞', '📧', '💻',
      '🖨️', '🔧', '🔨', '🧾', '💰', '🧪', '🌱', '♻️',
    ],
  },
  {
    key: 'etc',
    tab: '🎉',
    label: '기타',
    items: [
      '🎉', '🎊', '🎂', '🍰', '☕', '🍚', '🍻', '🍜',
      '🔥', '⭐', '✨', '💡', '💯', '❤️', '💙', '💚',
      '👌', '🆗', '🆕', '🔝', '🚀', '🌞', '🌧️', '❄️',
    ],
  },
];

export function EmojiPickerSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (emoji: string) => void;
}) {
  const [group, setGroup] = useState(GROUPS[0].key);
  const current = GROUPS.find((g) => g.key === group) ?? GROUPS[0];

  return (
    <Sheet visible={visible} onClose={onClose} title="이모지">
      <View className="flex-row gap-1.5 pb-3">
        {GROUPS.map((g) => (
          <Pressable
            key={g.key}
            onPress={() => setGroup(g.key)}
            className={`h-9 flex-1 items-center justify-center rounded-xl border ${
              g.key === group ? 'border-cd-primary bg-cd-primary-soft' : 'border-cd-border bg-cd-card'
            }`}>
            <Text className="text-[17px]">{g.tab}</Text>
          </Pressable>
        ))}
      </View>
      <Text className="pb-1.5 text-[11.5px] font-bold text-cd-faint">{current.label}</Text>
      <ScrollView className="max-h-[230px]" keyboardShouldPersistTaps="handled">
        <View className="flex-row flex-wrap">
          {current.items.map((e, i) => (
            <Pressable
              key={`${e}-${i}`}
              onPress={() => onPick(e)}
              className="h-[42px] w-[12.5%] items-center justify-center rounded-lg active:opacity-50">
              <Text className="text-[23px]">{e}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </Sheet>
  );
}
