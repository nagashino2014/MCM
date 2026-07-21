import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth-context';
import { apiJson } from '@/lib/api';

// 홈 — /m MobileHome 대응(다가오는 일정 + 미입력 경과 요약). 상세 리스트는 후속 단계.
function countOf(obj: unknown, keys: string[]): number | null {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) {
    const v = (obj as Record<string, unknown>)[k];
    if (Array.isArray(v)) return v.length;
  }
  return null;
}

export default function HomeScreen() {
  const { user, logout } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [upcoming, setUpcoming] = useState<number | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [u, p] = await Promise.all([
        apiJson<unknown>('/api/sales/upcoming-activities').catch(() => null),
        apiJson<unknown>('/api/sales/pending-reports').catch(() => null),
      ]);
      setUpcoming(countOf(u, ['activities', 'items', 'upcoming']));
      setPending(countOf(p, ['reports', 'items', 'pending']));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-neutral-50 dark:bg-neutral-950">
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <View className="gap-4 p-4">
          <View className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <Text className="text-xs text-neutral-500">환영합니다</Text>
            <Text className="mt-1 text-lg font-extrabold text-neutral-900 dark:text-white">
              {user?.name ?? '사용자'}
            </Text>
            {user?.email ? <Text className="text-xs text-neutral-400">{user.email}</Text> : null}
          </View>

          {loading ? (
            <ActivityIndicator className="mt-6" />
          ) : (
            <View className="flex-row gap-3">
              <StatCard label="다가오는 일정" value={upcoming} />
              <StatCard label="미입력 경과" value={pending} />
            </View>
          )}

          {error ? <Text className="text-sm text-red-500">{error}</Text> : null}

          <Pressable
            onPress={() => void logout()}
            className="mt-2 items-center rounded-xl border border-neutral-300 py-3 active:opacity-70 dark:border-neutral-700">
            <Text className="font-semibold text-neutral-700 dark:text-neutral-200">로그아웃</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCard({ label, value }: { label: string; value: number | null }) {
  return (
    <View className="flex-1 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <Text className="text-2xl font-extrabold text-primary">{value ?? '–'}</Text>
      <Text className="mt-1 text-xs text-neutral-500">{label}</Text>
    </View>
  );
}
