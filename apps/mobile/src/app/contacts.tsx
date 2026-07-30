import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, TextInput, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useApi } from '@/lib/use-api';
import { callPhone, sendSms } from '@/lib/format';

interface Contact {
  id: string;
  personName?: string;
  title?: string;
  departmentName?: string;
  facilityName?: string;
  officePhone?: string | null;
  mobilePhone?: string | null;
  status?: string;
}

// 담당자 — 리스트 + 검색 + 원터치 tel/sms. /m MobileContacts 대응.
export default function ContactsScreen() {
  const { data, loading, refreshing, error, reload } = useApi<{ contacts: Contact[] }>(
    '/api/sales/contacts'
  );
  const [q, setQ] = useState('');
  const all = useMemo(() => data?.contacts ?? [], [data]);
  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return all;
    return all.filter((c) =>
      `${c.personName ?? ''} ${c.facilityName ?? ''} ${c.departmentName ?? ''}`
        .toLowerCase()
        .includes(kw)
    );
  }, [all, q]);

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-cd-bg">
      <View className="border-b border-cd-border bg-cd-card px-4 py-3">
        <View className="flex-row items-center gap-2 rounded-xl border border-cd-border px-3 py-2">
          <Ionicons name="search" size={18} color="#9ca3af" />
          <TextInput
            className="flex-1 text-base text-cd-text"
            placeholder="담당자·사업장·부서 검색"
            placeholderTextColor="#9ca3af"
            autoCapitalize="none"
            value={q}
            onChangeText={setQ}
          />
          {q ? (
            <Ionicons name="close-circle" size={18} color="#9ca3af" onPress={() => setQ('')} />
          ) : null}
        </View>
      </View>

      {loading ? (
        <ActivityIndicator className="mt-10" />
      ) : error ? (
        <Text className="mt-10 text-center text-cd-error">{error}</Text>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} />}
          ListEmptyComponent={
            <Text className="mt-10 text-center text-cd-faint">담당자가 없습니다</Text>
          }
          renderItem={({ item }) => <ContactCard c={item} />}
        />
      )}
    </SafeAreaView>
  );
}

function ContactCard({ c }: { c: Contact }) {
  const phone = c.mobilePhone || c.officePhone;
  const sub = [c.departmentName, c.facilityName].filter(Boolean).join(' · ');
  return (
    <View className="flex-row items-center justify-between rounded-2xl border border-cd-border bg-cd-card p-4">
      <View className="flex-1 pr-3">
        <View className="flex-row items-center gap-2">
          <Text className="text-base font-bold text-cd-text">
            {c.personName ?? '(이름 없음)'}
          </Text>
          {c.title ? <Text className="text-xs text-cd-muted">{c.title}</Text> : null}
        </View>
        {sub ? <Text className="mt-0.5 text-xs text-cd-muted">{sub}</Text> : null}
        {phone ? <Text className="mt-0.5 text-xs text-cd-faint">{phone}</Text> : null}
      </View>
      {phone ? (
        <View className="flex-row gap-3">
          <Pressable
            onPress={() => callPhone(phone)}
            className="h-9 w-9 items-center justify-center rounded-full bg-primary-light active:opacity-60">
            <Ionicons name="call" size={18} color="#4A63D8" />
          </Pressable>
          <Pressable
            onPress={() => sendSms(phone)}
            className="h-9 w-9 items-center justify-center rounded-full bg-primary-light active:opacity-60">
            <Ionicons name="chatbubble-ellipses" size={18} color="#4A63D8" />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
