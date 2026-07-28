import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';

import { useTheme } from '@/theme/useTheme';
import { useNavBadges } from '@/lib/use-nav-badges';

// 하단 탭 5개 — 블루프린트 §5.1 확정 IA(홈·결재·메일·소통·더보기).
// 영업 화면(일정·사업장·담당자)은 탭에서 내려가고 더보기/홈 빠른실행으로 진입한다.
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

export default function TabsLayout() {
  const { c } = useTheme();
  const badges = useNavBadges();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.faint,
        tabBarStyle: { backgroundColor: c.card, borderTopColor: c.border },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
        headerStyle: { backgroundColor: c.card },
        headerTitleStyle: { color: c.text, fontWeight: '800' },
        headerShadowVisible: false,
        headerTintColor: c.text,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: '홈',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="approval"
        options={{
          title: '결재',
          tabBarIcon: ({ color, size }) => (
            <View>
              <Ionicons name="checkbox-outline" color={color} size={size} />
              <TabBadge count={badges.approvalPending} />
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
        name="collab"
        options={{
          title: '소통',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="megaphone-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: '더보기',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="ellipsis-horizontal" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
