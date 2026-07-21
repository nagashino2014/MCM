import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// 영업 일정 — 월 미니캘린더 + 일 리스트(/m MobileSchedule). 후속 단계에서 데이터 연결.
export default function ScheduleScreen() {
  return (
    <SafeAreaView
      edges={['bottom']}
      className="flex-1 items-center justify-center bg-neutral-50 dark:bg-neutral-950">
      <View className="items-center gap-1">
        <Text className="text-base font-semibold text-neutral-500">영업 일정</Text>
        <Text className="text-sm text-neutral-400">다음 단계에서 구현</Text>
      </View>
    </SafeAreaView>
  );
}
