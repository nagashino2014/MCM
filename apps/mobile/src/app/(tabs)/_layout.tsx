import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform, Text, View } from 'react-native';

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
      <Text className="text-[10px] font-extrabold text-white">{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

/** 데스크탑 위젯·웹 데모 여부 — 탭 바를 좌측 세로 바로 바꾸는 기준. */
const IS_WEB = Platform.OS === 'web';

export default function TabsLayout() {
  const { c } = useTheme();
  const badges = useNavBadges();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.faint,
        // 데스크탑 위젯은 하단 탭 대신 **좌측 세로 바**(다우 메신저류 관례) — 폰 느낌을 덜고
        // 넓은 창에서 세로 공간을 콘텐츠에 넘긴다. 네이티브(폰)는 하단 탭 그대로.
        tabBarPosition: IS_WEB ? 'left' : 'bottom',
        // ⚠ 좌측 배치에서 'below-icon' 라벨은 uikit 변형이 거부한다(런타임 throw → 화면 백지,
        //   2026-08-10 실측). 좌측일 때만 material 변형으로 바꿔야 아이콘 아래 라벨이 허용된다.
        tabBarVariant: IS_WEB ? 'material' : 'uikit',
        tabBarLabelPosition: 'below-icon',
        tabBarStyle: IS_WEB
          ? {
              backgroundColor: c.card,
              borderRightColor: c.border,
              borderRightWidth: 1,
              borderTopWidth: 0,
              width: 88,
              paddingTop: 10,
            }
          : { backgroundColor: c.card, borderTopColor: c.border },
        tabBarLabelStyle: { fontSize: 10.5, fontWeight: '600' },
        headerStyle: { backgroundColor: c.card },
        headerTitleStyle: { color: c.text, fontWeight: '800' },
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
      <Tabs.Screen name="collab" options={{ title: '소통', href: null }} />
    </Tabs>
  );
}
