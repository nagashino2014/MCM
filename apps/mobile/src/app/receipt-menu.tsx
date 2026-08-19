import { useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';

import { CtaGradientFill, ScreenHeader } from '@/components/ui';
import { useApi } from '@/lib/use-api';
import { useTheme } from '@/theme/useTheme';

/**
 * 영수증 — 촬영과 보관함의 진입 지점(홈 빠른 실행·더보기의 '영수증'이 여기로 온다).
 *
 * 종전에는 촬영(/receipt)과 보관함(/receipts)이 메뉴에 따로 나열돼 있었는데,
 * 사용자가 보기엔 한 가지 일이라 하나로 묶었다(2026-08-19 사용자 요청).
 */
export default function ReceiptMenuScreen() {
  const router = useRouter();
  const { c } = useTheme();
  // 미사용 건수만 배지로 — 보관함에 손볼 게 남았는지 여기서 바로 보인다.
  const unused = useApi<{ items: unknown[] }>('/api/receipts?scope=unused&limit=100');

  useFocusEffect(
    useCallback(() => {
      void unused.reload();
      // 훅 반환 객체는 매 렌더 새로 만들어진다 — 의존성에서 제외.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const count = unused.data?.items?.length ?? 0;

  return (
    <SafeAreaView className="flex-1 bg-cd-bg">
      <ScreenHeader title="영수증" subtitle="개인카드 경비 증빙" back variant="sub" />

      <View className="gap-3 px-4 pt-2">
        <Pressable
          onPress={() => router.push('/receipt')}
          className="h-16 flex-row items-center justify-center gap-2 overflow-hidden rounded-2xl active:opacity-80">
          <CtaGradientFill />
          <Ionicons name="camera" size={22} color="#fff" />
          <Text className="text-base font-bold text-white">영수증 촬영</Text>
        </Pressable>

        <Pressable
          onPress={() => router.push('/receipts')}
          className="h-16 flex-row items-center gap-3 rounded-2xl border border-cd-border bg-cd-card px-4 active:opacity-70">
          <Ionicons name="file-tray-full-outline" size={22} color={c.primary} />
          <View className="flex-1">
            <Text className="text-base font-bold text-cd-text">영수증 보관함</Text>
            <Text className="mt-[1px] text-[11.5px] text-cd-faint">
              {count > 0 ? `미사용 ${count}건 — 확인·수정` : '찍어 둔 영수증 확인·수정'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={c.faint} />
        </Pressable>

        <Text className="mt-1 px-1 text-center text-xs leading-5 text-cd-faint">
          개인카드로 결제한 지류 영수증을 찍어 두면{'\n'}지출결의서·출장보고서 작성 때 불러올 수 있습니다.
        </Text>
      </View>
    </SafeAreaView>
  );
}
