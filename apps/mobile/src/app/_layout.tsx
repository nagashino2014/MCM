import '@/global.css';

import { useEffect } from 'react';
import { ActivityIndicator, Platform, View, useWindowDimensions } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { LockGate } from '@/components/LockGate';
import { NavHeader, type NavHeaderProps } from '@/components/ui/AppHeader';
import { ToastProvider } from '@/components/ui';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { usePushSetup } from '@/lib/use-push';
import { useWidgetBridge } from '@/lib/use-widget-bridge';
import { IS_WEB_RAIL, WEB_SHELL_CHAT_MAX_WIDTH, WEB_SHELL_MAX_WIDTH } from '@/lib/platform';
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

/**
 * 좌측 레일 환경(데스크탑 위젯·PWA)의 가운데 섬. 기본은 WEB_SHELL_MAX_WIDTH 로 가운데 정렬.
 * 대화 탭(chat)에서는 대화방 칸만 더 넓힐 수 있게 최대 폭을 WEB_SHELL_CHAT_MAX_WIDTH 로 올린다(2026-11-06 사용자 요청).
 * 이때 섬의 **왼쪽 끝은 다른 탭과 같은 자리**에 두고 오른쪽으로만 늘린다 — 탭을 오갈 때 레일과 목록이 좌우로 튀지 않는다.
 */
function WebIsland({ chat, children }: { chat: boolean; children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const left = Math.max(0, Math.round((width - WEB_SHELL_MAX_WIDTH) / 2));
  return (
    <View
      style={
        chat
          ? { flex: 1, width: Math.min(WEB_SHELL_CHAT_MAX_WIDTH, width - left), marginLeft: left, alignSelf: 'flex-start' }
          : { flex: 1, width: '100%', maxWidth: WEB_SHELL_MAX_WIDTH, alignSelf: 'center' }
      }>
      {children}
    </View>
  );
}

function RootNavigator() {
  const { status } = useAuth();
  const { dark } = useTheme();
  const segments = useSegments();
  const router = useRouter();

  usePushSetup();
  // 데스크탑 위젯 셸에 미읽음·새 메시지·테마를 알린다(웹 + 위젯 안에서만 동작).
  useWidgetBridge(status === 'authed', dark);

  // 웹 문서 바탕색을 앱 테마에 맞춘다(+html.tsx DOC_BACKGROUND 의 실행 중 보정) — 불투명 바탕이어야 위젯 iframe 안에서
  // 글자가 ClearType 으로 그려진다. 앱에서 라이트/다크를 고정하면 OS 설정과 달라질 수 있어 여기서 덮어쓴다.
  const { c: palette } = useTheme();
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.documentElement.style.backgroundColor = palette.bg;
  }, [palette.bg]);

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
      <View className="flex-1 items-center justify-center bg-transparent">
        <ActivityIndicator />
      </View>
    );
  }

  // 네비게이터가 그리는 헤더도 공용 AppHeader(NavHeader) — 홈·전체 메뉴를 뺀 모든 화면의 상단이 같은 모양(2026-11-04).
  const header = {
    headerShown: true,
    header: (p: unknown) => <NavHeader {...(p as NavHeaderProps)} />,
  };

  const stack = (
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="login" />
        {/* 명함 화면은 자체 헤더를 그린다(iOS 헤더 갱신 루프 회피 이력). */}
        <Stack.Screen name="card" />
        {/* 영수증(진입 메뉴)·촬영·보관함도 같은 이유로 자체 헤더를 그린다 */}
        <Stack.Screen name="receipt-menu" />
        <Stack.Screen name="receipts" />
        {/* 발행 요청(IR-M1)도 자체 헤더를 그린다 */}
        <Stack.Screen name="invoice-requests" />
        {/* 업무보고(WR-M1) — 목록·상세·작성 모두 자체 헤더 */}
        <Stack.Screen name="work-reports" />
        <Stack.Screen name="work-report/[reportId]" />
        <Stack.Screen name="work-report-draft" />
        {/* 일정은 태그 칩·참조 지정을 담은 자체 헤더를 그린다 */}
        <Stack.Screen name="schedule" />
        {/* 사업장 탐색·상세는 검색·필터를 담은 자체 헤더를 그린다 */}
        <Stack.Screen name="facilities" />
        <Stack.Screen name="facility/[facilityId]" />
        <Stack.Screen name="contacts" options={{ ...header, title: '담당자' }} />
        <Stack.Screen name="settings" options={{ ...header, title: '설정' }} />
        <Stack.Screen name="board/[postId]" options={{ ...header, title: '공지' }} />
        <Stack.Screen name="board/write" options={{ ...header, title: '글쓰기' }} />
        {/* 알림 — 내역(자체 헤더, 우측 톱니로 설정) / 설정(네비게이터 헤더). 2026-11-04 분리 */}
        <Stack.Screen name="notifications" />
        <Stack.Screen name="notification-settings" options={{ ...header, title: '알림 설정' }} />
        <Stack.Screen name="approval/[docId]" options={{ ...header, title: '결재 문서' }} />
        {/* 기안은 자체 헤더(양식명)를 그린다 */}
        <Stack.Screen name="approval/draft" />
        {/* 대화방은 방이름을 담은 자체 헤더를 그린다 */}
        <Stack.Screen name="chat/[roomId]" />
        <Stack.Screen name="briefings/[briefingId]" options={{ ...header, title: '공유 브리핑' }} />
        <Stack.Screen name="mail/[messageId]" options={{ ...header, title: '메일' }} />
        <Stack.Screen name="mail/compose" options={{ ...header, title: '메일 쓰기' }} />
        {/* 근태·휴가는 연차 게이지·주 초과근무를 담은 자체 헤더를 그린다 */}
        <Stack.Screen name="leave" />
        <Stack.Screen name="attendance" options={{ ...header, title: '내 근태' }} />
        <Stack.Screen name="bids" options={{ ...header, title: '공공입찰' }} />
        {/* 사내 설문(참여) — 목록·응답 모두 자체 헤더를 그린다 */}
        <Stack.Screen name="surveys" />
        <Stack.Screen name="survey/[surveyId]" />
        {/* 할 일(To-do) — 목록("할 일")·상세("할 일 상세") 모두 Screen 자체 헤더(건수 부제·저장 상태). */}
        <Stack.Screen name="todo/index" />
        <Stack.Screen name="todo/[itemId]" />
        <Stack.Screen name="todo/inbox" />
        {/* 사용 매뉴얼(4단계) — 목록·기사 모두 자체 헤더 */}
        <Stack.Screen name="manual/index" />
        <Stack.Screen name="manual/[articleId]" />
      </Stack>
  );

  return (
    <>
      <StatusBar style={dark ? 'light' : 'dark'} />
      {/* 데스크탑 위젯·PWA(좌측 레일): 창을 최대화해도 모바일 화면 구성이 늘어지지 않게 최대 폭의 가운데 섬 —
          바탕 그라데이션(ThemeProvider 루트)은 창 전체에 깔리고 섬은 그 위에 떠 있다(2026-11-04). */}
      {IS_WEB_RAIL ? <WebIsland chat={(segments as string[])[0] === '(tabs)' && (segments as string[])[1] === 'chat'}>{stack}</WebIsland> : stack}
    </>
  );
}
