import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// 담당자 — engagement 필터 + tel:/sms:(/m MobileContacts). 후속 단계에서 데이터 연결.
export default function ContactsScreen() {
  return (
    <SafeAreaView
      edges={['bottom']}
      className="flex-1 items-center justify-center bg-neutral-50 dark:bg-neutral-950">
      <View className="items-center gap-1">
        <Text className="text-base font-semibold text-neutral-500">담당자</Text>
        <Text className="text-sm text-neutral-400">다음 단계에서 구현</Text>
      </View>
    </SafeAreaView>
  );
}
