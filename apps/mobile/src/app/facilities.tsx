import { useState } from 'react';
import { ActivityIndicator, FlatList, TextInput, Text, View } from 'react-native';
import { RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useApi } from '@/lib/use-api';

interface Facility {
  facilityId: string;
  companyName: string;
  siteAddress?: string;
  representativeName?: string;
  regionSido?: string;
  regionSigungu?: string;
  industryName?: string;
}

// 사업장 — 검색 + 리스트. /m MobileFacilities(탐색 C안)의 축약 1차 버전.
export default function FacilitiesScreen() {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const path = submitted
    ? `/api/facilities?q=${encodeURIComponent(submitted)}&limit=30&sort=name`
    : `/api/facilities?limit=30&sort=name`;
  const { data, loading, refreshing, error, reload } = useApi<{ items: Facility[]; total: number }>(
    path
  );
  const items = data?.items ?? [];

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-cd-bg">
      <View className="border-b border-cd-border bg-cd-card px-4 py-3">
        <View className="flex-row items-center gap-2 rounded-xl border border-cd-border px-3 py-2">
          <Ionicons name="search" size={18} color="#9ca3af" />
          <TextInput
            className="flex-1 text-base text-cd-text"
            placeholder="사업장명 검색"
            placeholderTextColor="#9ca3af"
            autoCapitalize="none"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => setSubmitted(query.trim())}
            returnKeyType="search"
          />
          {query ? (
            <Ionicons
              name="close-circle"
              size={18}
              color="#9ca3af"
              onPress={() => {
                setQuery('');
                setSubmitted('');
              }}
            />
          ) : null}
        </View>
      </View>

      {loading ? (
        <ActivityIndicator className="mt-10" />
      ) : error ? (
        <Text className="mt-10 text-center text-cd-error">{error}</Text>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(f) => f.facilityId}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} />}
          ListHeaderComponent={
            data ? (
              <Text className="mb-1 text-xs text-cd-faint">
                {submitted ? `"${submitted}" 검색` : '전체'} · {data.total ?? items.length}곳
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <Text className="mt-10 text-center text-cd-faint">사업장이 없습니다</Text>
          }
          renderItem={({ item }) => <FacilityCard f={item} />}
        />
      )}
    </SafeAreaView>
  );
}

function FacilityCard({ f }: { f: Facility }) {
  const region = [f.regionSido, f.regionSigungu].filter(Boolean).join(' ');
  return (
    <View className="rounded-2xl border border-cd-border bg-cd-card p-4">
      <Text className="text-base font-bold text-cd-text">{f.companyName}</Text>
      <View className="mt-1 flex-row flex-wrap gap-x-3 gap-y-0.5">
        {region ? <Text className="text-xs text-cd-muted">{region}</Text> : null}
        {f.industryName ? <Text className="text-xs text-cd-muted">{f.industryName}</Text> : null}
        {f.representativeName ? (
          <Text className="text-xs text-cd-muted">대표 {f.representativeName}</Text>
        ) : null}
      </View>
      {f.siteAddress ? (
        <Text className="mt-1 text-xs text-cd-faint" numberOfLines={1}>
          {f.siteAddress}
        </Text>
      ) : null}
    </View>
  );
}
