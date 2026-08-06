import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Screen } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

/**
 * 대화(사내 메신저) — 자리만 잡아둔 화면.
 *
 * 홈 개편 핸드오프의 확정 IA 가 홈·결재·대화·메일·더보기 5탭이라 탭은 먼저 만들었다.
 * 실제 메신저 기능은 별도 과제다(실시간 채널·읽음·첨부).
 */
export default function ChatScreen() {
  const { c } = useTheme();
  return (
    <Screen scroll={false}>
      <View className="flex-1 items-center justify-center gap-3 px-10">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-cd-primary-soft">
          <Ionicons name="chatbubble-ellipses-outline" size={28} color={c.primary} />
        </View>
        <Text className="text-[17px] font-extrabold text-cd-text">사내 메신저 준비 중</Text>
        <Text className="text-center text-[13px] leading-5 text-cd-muted">
          실시간 대화 기능을 준비하고 있습니다.{'\n'}
          그때까지 업무 연락은 메일과 공지를 이용해 주세요.
        </Text>
      </View>
    </Screen>
  );
}
