import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useApi } from '@/lib/use-api';
import { callPhone, currentMonth, fmtDate, fmtTime, sendSms, shiftMonth } from '@/lib/format';

interface ActivityContact {
  id?: string;
  personName?: string;
  mobilePhone?: string | null;
  officePhone?: string | null;
}
interface Activity {
  activityId: string;
  projectTitle?: string;
  facilityName?: string;
  activityType?: string;
  scheduledAt?: string;
  summary?: string;
  contacts?: ActivityContact[];
}

// 영업 일정 — 월 네비 + 활동 카드(연락처 원터치 tel/sms). /m MobileSchedule 대응.
export default function ScheduleScreen() {
  const [month, setMonth] = useState(currentMonth());
  const { data, loading, refreshing, error, reload } = useApi<{ activities: Activity[] }>(
    `/api/sales/schedule?month=${month}`
  );
  const activities = data?.activities ?? [];

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-neutral-50 dark:bg-neutral-950">
      <View className="flex-row items-center justify-between border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
        <Pressable onPress={() => setMonth((m) => shiftMonth(m, -1))} className="p-2 active:opacity-60">
          <Ionicons name="chevron-back" size={20} color="#5D87FF" />
        </Pressable>
        <Text className="text-base font-extrabold text-neutral-900 dark:text-white">{month}</Text>
        <Pressable onPress={() => setMonth((m) => shiftMonth(m, 1))} className="p-2 active:opacity-60">
          <Ionicons name="chevron-forward" size={20} color="#5D87FF" />
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator className="mt-10" />
      ) : error ? (
        <Text className="mt-10 text-center text-red-500">{error}</Text>
      ) : (
        <FlatList
          data={activities}
          keyExtractor={(a) => a.activityId}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} />}
          ListEmptyComponent={
            <Text className="mt-10 text-center text-neutral-400">이 달 일정이 없습니다</Text>
          }
          renderItem={({ item }) => <ActivityCard a={item} />}
        />
      )}
    </SafeAreaView>
  );
}

function ActivityCard({ a }: { a: Activity }) {
  return (
    <View className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <View className="flex-row items-center gap-2">
        <View className="rounded-lg bg-primary-light px-2 py-1">
          <Text className="text-xs font-bold text-primary">
            {fmtDate(a.scheduledAt)} {fmtTime(a.scheduledAt)}
          </Text>
        </View>
        {a.activityType ? <Text className="text-xs text-neutral-500">{a.activityType}</Text> : null}
      </View>
      <Text className="mt-2 text-base font-bold text-neutral-900 dark:text-white">
        {a.projectTitle || a.facilityName || '(제목 없음)'}
      </Text>
      {a.facilityName && a.projectTitle ? (
        <Text className="text-xs text-neutral-500">{a.facilityName}</Text>
      ) : null}
      {a.summary ? (
        <Text className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{a.summary}</Text>
      ) : null}
      {a.contacts?.length ? (
        <View className="mt-3 gap-1 border-t border-neutral-100 pt-2 dark:border-neutral-800">
          {a.contacts.map((c, i) => {
            const phone = c.mobilePhone || c.officePhone;
            return (
              <View key={c.id ?? i} className="flex-row items-center justify-between">
                <Text className="text-sm text-neutral-700 dark:text-neutral-200">{c.personName}</Text>
                {phone ? (
                  <View className="flex-row gap-4">
                    <Pressable onPress={() => callPhone(phone)} className="active:opacity-60">
                      <Ionicons name="call" size={18} color="#5D87FF" />
                    </Pressable>
                    <Pressable onPress={() => sendSms(phone)} className="active:opacity-60">
                      <Ionicons name="chatbubble-ellipses" size={18} color="#5D87FF" />
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
