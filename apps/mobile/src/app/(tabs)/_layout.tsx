import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from 'react-native';

// 하단 탭 4개 — /m MobileShell 탭 구조 계승(홈·일정·사업장·담당자).
const PRIMARY = '#5D87FF';

export default function TabsLayout() {
  const dark = useColorScheme() === 'dark';
  const bg = dark ? '#1c1f24' : '#ffffff';
  const border = dark ? '#2a2e35' : '#e5e7eb';

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: PRIMARY,
        tabBarInactiveTintColor: dark ? '#8b8f97' : '#9ca3af',
        tabBarStyle: { backgroundColor: bg, borderTopColor: border },
        headerStyle: { backgroundColor: bg, borderBottomColor: border },
        headerTitleStyle: { color: dark ? '#ffffff' : '#111827', fontWeight: '800' },
        headerShadowVisible: false,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: '홈',
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: '일정',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="calendar-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="facilities"
        options={{
          title: '사업장',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="business-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="contacts"
        options={{
          title: '담당자',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-outline" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
