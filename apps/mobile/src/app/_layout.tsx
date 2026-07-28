import '@/global.css';

import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { LockGate } from '@/components/LockGate';
import { ToastProvider } from '@/components/ui';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { usePushSetup } from '@/lib/use-push';
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

  useEffect(() => {
    if (status === 'loading') return;
    const inLogin = segments[0] === 'login';
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
  };

  return (
    <>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="login" />
        {/* 명함 화면은 자체 헤더를 그린다(iOS 헤더 갱신 루프 회피 이력). */}
        <Stack.Screen name="card" />
        <Stack.Screen name="schedule" options={{ ...header, title: '일정' }} />
        <Stack.Screen name="facilities" options={{ ...header, title: '사업장' }} />
        <Stack.Screen name="contacts" options={{ ...header, title: '담당자' }} />
        <Stack.Screen name="settings" options={{ ...header, title: '설정' }} />
        <Stack.Screen name="board/[postId]" options={{ ...header, title: '공지' }} />
        <Stack.Screen name="notifications" options={{ ...header, title: '알림 설정' }} />
        <Stack.Screen name="approval/[docId]" options={{ ...header, title: '결재 문서' }} />
      </Stack>
    </>
  );
}
