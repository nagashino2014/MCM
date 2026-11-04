import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';

import { GlassTabBar, type GlassTabBarProps } from '@/components/ui/GlassTabBar';
import { SideRail } from '@/components/ui/SideRail';
import { IS_WEB_RAIL } from '@/lib/platform';
import { NavHeader, type NavHeaderProps } from '@/components/ui/AppHeader';
import { useTheme } from '@/theme/useTheme';
import { useNavBadges } from '@/lib/use-nav-badges';

// 하단 탭 5개 — 모바일 홈 개편 핸드오프의 확정 IA(홈·결재·대화·메일·더보기).
// 소통(공지·주소록·조직도)은 탭에서 내려가고 더보기로 진입한다(라우트는 그대로 유지).
// 영업 화면(일정·사업장·담당자)도 더보기/홈 빠른실행으로 진입한다.
//
// ⚠ 헤더 옵션은 여기(레이아웃)에서만 정적으로 정의한다. 화면 파일 안에서 Stack.Screen 옵션을
//    인라인 렌더하면 iOS 에서 헤더 갱신 루프가 생긴다(명함 화면 실측 이력).

/** 탭 아이콘 우상단 카운트 뱃지. */
function TabBadge({ count }: { count?: number | null }) {
  if (!count) return null;
  return (
    <View className="absolute -right-2.5 -top-1 min-w-[16px] items-center rounded-full bg-cd-error px-1">
      <Text className="text-[11px] font-extrabold text-cd-on-error">{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

export default function TabsLayout() {
  const { c } = useTheme();
  const badges = useNavBadges();

  return (
    <Tabs
      // 네이티브(폰)·폰 목업은 글라스 플로팅 탭 바, 데스크탑 위젯·PWA(IS_WEB_RAIL, lib/platform)는 그 세로판 SideRail(2026-11-04).
      tabBar={(props) =>
        IS_WEB_RAIL ? (
          <SideRail {...(props as unknown as GlassTabBarProps)} />
        ) : (
          <GlassTabBar {...(props as unknown as GlassTabBarProps)} />
        )
      }
      screenOptions={{
        // 셸 바탕(그라데이션)이 비치도록 scene 은 투명 — 탭 바 뒤까지 콘텐츠가 이어진다.
        sceneStyle: { backgroundColor: 'transparent' },
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.faint,
        // 데스크탑 위젯은 하단 탭 대신 **좌측 세로 바**(다우 메신저류 관례) — 폰 느낌을 덜고
        // 넓은 창에서 세로 공간을 콘텐츠에 넘긴다. 네이티브(폰)는 하단 탭 그대로.
        // left 면 react-navigation 이 바와 scene 을 가로로 나란히 놓는다. 커스텀 바(SideRail)라 기본 바의 variant 함정
        // (uikit 이 좌측 below-icon 라벨을 거부해 화면 백지, 2026-08-10 실측)과는 무관하다.
        tabBarPosition: IS_WEB_RAIL ? 'left' : 'bottom',
        tabBarLabelPosition: 'below-icon',
        // position absolute 여야 react-navigation 이 scene 을 바닥까지 늘린다(커스텀 바가 그 위에 뜬다). 레일에서는 쓰이지 않는다.
        tabBarStyle: { position: 'absolute', backgroundColor: 'transparent', borderTopWidth: 0, elevation: 0 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
        headerStyle: { backgroundColor: c.card },
        headerTitleStyle: { color: c.text, fontWeight: '600', fontSize: 17 },
        // 본문 캔버스도 흰색이라 헤더를 그림자 없이 두면 경계가 사라진다 → hairline 유지.
        headerShadowVisible: true,
        headerTintColor: c.text,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: '홈',
          // 홈은 인사말·알림·아바타를 담은 자체 헤더를 그린다(핸드오프 2a §1).
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="approval"
        options={{
          title: '결재',
          header: (p: unknown) => <NavHeader {...(p as NavHeaderProps)} />,
          tabBarIcon: ({ color, size }) => (
            <View>
              <Ionicons name="clipboard-outline" color={color} size={size} />
              <TabBadge count={badges.approvalPending} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: '대화',
          header: (p: unknown) => <NavHeader {...(p as NavHeaderProps)} />,
          tabBarIcon: ({ color, size }) => (
            <View>
              <Ionicons name="chatbubble-outline" color={color} size={size} />
              <TabBadge count={badges.chatUnread} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="mail"
        options={{
          title: '메일',
          header: (p: unknown) => <NavHeader {...(p as NavHeaderProps)} />,
          tabBarIcon: ({ color, size }) => (
            <View>
              <Ionicons name="mail-outline" color={color} size={size} />
              <TabBadge count={badges.mailUnread} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: '더보기', // 탭 라벨은 그대로, 화면 타이틀만 "전체 메뉴"(사용자 확정).
          headerTitle: '전체 메뉴',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="ellipsis-horizontal" color={color} size={size} />
          ),
        }}
      />
      {/* 소통 — 탭에서는 감추고 더보기에서 연다(라우트·화면은 그대로). */}
      <Tabs.Screen name="collab" options={{ title: '소통', href: null, headerShown: false }} />
    </Tabs>
  );
}
