import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ActionTile, Sheet } from '@/components/ui';

export interface ComposerPlusItem {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}

/**
 * 대화 입력창의 더하기(+) 메뉴(2026-11-06) — 항상 보이는 버튼을 늘리지 않고 도구를 담는 자리.
 * 타일은 홈 빠른 실행(ActionTile)과 같은 모양이다. 어떤 항목을 넣을지는 대화방 화면이 환경(앱·웹)과 방 종류에 맞춰 정한다.
 */
export function ComposerPlusSheet({
  visible,
  onClose,
  items,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  items: ComposerPlusItem[];
  onPick: (key: string) => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title="추가">
      <View className="flex-row flex-wrap gap-x-7 gap-y-4 px-1">
        {items.map((it) => (
          <ActionTile
            key={it.key}
            icon={it.icon}
            label={it.label}
            onPress={() => {
              // ⚠ Modal 교대 표시 — 이 시트의 닫힘 애니메이션이 끝난 뒤 다음 시트·선택 창을 연다
              //   (동시에 열면 iOS 에서 두 번째 Modal 이 나타나지 않는다, 대화방 관리 시트와 동일).
              onClose();
              setTimeout(() => onPick(it.key), 350);
            }}
          />
        ))}
      </View>
    </Sheet>
  );
}
