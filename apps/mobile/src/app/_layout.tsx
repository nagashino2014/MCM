import '@/global.css';

import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { LockGate } from '@/components/LockGate';
import { ToastProvider } from '@/components/ui';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { usePushSetup } from '@/lib/use-push';
import { useWidgetBridge } from '@/lib/use-widget-bridge';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { useTheme } from '@/theme/useTheme';

// 루트 레이아웃 — 인증 게이트 + 앱 잠금 + 전역 토스트.
//
// ⚠ 화면별 헤더 옵션은 전부 여기(또는 (tabs)/_layout)에서 정적으로 정의한다.
//    화면 파일 안에서 Stack.Screen 을 인라인 렌더하면 iOS 에서 헤더 갱신 루프가 생긴다.
export default function RootLayout() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <LockGate>
            <RootNavigator />
          </LockGate>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

function RootNavigator() {
  const { status } = useAuth();
  const { c, dark } = useTheme();
  const segments = useSegments();
  const router = useRouter();

  usePushSetup();
  // 데스크탑 위젯 셸에 미읽음·새 메시지를 알린다(웹 + 위젯 안에서만 동작).
  useWidgetBridge(status === 'authed');

  useEffect(() => {
    if (status === 'loading') return;
    const inLogin = segments[0] === 'login';
    // 부품 미리보기(개발 전용)는 로그인 없이 연다 — 디자인 확인용이라 데이터가 필요 없다.
    if (__DEV__ && segments[0] === 'dev-preview') return;
    // 탭 밖 스택 화면(일정·사업장·설정 등)이 생겼으므로 "로그인 화면이 아니면" 을 기준으로 판정한다.
    if (status === 'guest' && !inLogin) {
      router.replace('/login');
    } else if (status === 'authed' && inLogin) {
      router.replace('/(tabs)');
    }
  }, [status, segments, router]);

  if (status === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-cd-bg">
        <ActivityIndicator />
      </View>
    );
  }

  const header = {
    headerShown: true,
    headerStyle: { backgroundColor: c.card },
    headerTitleStyle: { color: c.text, fontWeight: '800' as const },
    headerTintColor: c.text,
    headerShadowVisible: false,
    // 뒤로가기에 이전 라우트명("(tabs)", "leave")이 붙는 iOS 기본 동작 제거 — 셰브론만.
    headerBackButtonDisplayMode: 'minimal' as const,
  };

  return (
    <>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="login" />
        {/* 명함 화면은 자체 헤더를 그린다(iOS 헤더 갱신 루프 회피 이력). */}
        <Stack.Screen name="card" />
        {/* 영수증(진입 메뉴)·촬영·보관함도 같은 이유로 자체 헤더를 그린다 */}
        <Stack.Screen name="receipt-menu" />
        <Stack.Screen name="receipts" />
        {/* 발행 요청(IR-M1)도 자체 헤더를 그린다 */}
        <Stack.Screen name="invoice-requests" />
        {/* 일정은 태그 칩·참조 지정을 담은 자체 헤더를 그린다 */}
        <Stack.Screen name="schedule" />
        {/* 사업장 탐색·상세는 검색·필터를 담은 자체 헤더를 그린다 */}
        <Stack.Screen name="facilities" />
        <Stack.Screen name="facility/[facilityId]" />
        <Stack.Screen name="contacts" options={{ ...header, title: '담당자' }} />
        <Stack.Screen name="settings" options={{ ...header, title: '설정' }} />
        <Stack.Screen name="board/[postId]" options={{ ...header, title: '공지' }} />
        <Stack.Screen name="board/write" options={{ ...header, title: '글쓰기' }} />
        <Stack.Screen name="notifications" options={{ ...header, title: '알림 설정' }} />
        <Stack.Screen name="approval/[docId]" options={{ ...header, title: '결재 문서' }} />
        {/* 기안은 자체 헤더(양식명)를 그린다 */}
        <Stack.Screen name="approval/draft" />
        {/* 대화방은 방이름을 담은 자체 헤더를 그린다 */}
        <Stack.Screen name="chat/[roomId]" />
        <Stack.Screen name="mail/[messageId]" options={{ ...header, title: '메일' }} />
        <Stack.Screen name="mail/compose" options={{ ...header, title: '메일 쓰기' }} />
        {/* 근태·휴가는 연차 게이지·주 초과근무를 담은 자체 헤더를 그린다 */}
        <Stack.Screen name="leave" />
        <Stack.Screen name="attendance" options={{ ...header, title: '내 근태' }} />
        <Stack.Screen name="bids" options={{ ...header, title: '공공입찰' }} />
      </Stack>
    </>
  );
}
