import { useMemo, useState } from 'react';
import { FlatList, Linking, Pressable, RefreshControl, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';

import { Avatar, Chip, EmptyState, SearchBar, SkeletonList, useToast } from '@/components/ui';
import { useApi } from '@/lib/use-api';
import { callPhone, sendSms } from '@/lib/format';
import { useTheme } from '@/theme/useTheme';

export interface DirDept {
  deptId: string;
  deptName: string;
  parentDeptId: string | null;
  displayOrder: number;
  accentColor: string | null;
}
export interface DirPerson {
  employeeId: string;
  name: string;
  deptId: string | null;
  deptName: string | null;
  positionName: string | null;
  positionRankOrder: number | null;
  companyEmail: string | null;
  mobilePhone: string | null;
  companyPhone: string | null;
}

export function useDirectory() {
  return useApi<{ departments: DirDept[]; people: DirPerson[] }>('/api/directory', { cache: true });
}

/** 임직원 주소록 — 검색 + 부서 필터 + 카드에서 전화·문자·메일 원터치. */
export function DirectoryPane() {
  const { c } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const { data, loading, refreshing, reload, error } = useDirectory();
  const [q, setQ] = useState('');
  const [dept, setDept] = useState<string | null>(null);

  const people = useMemo(() => {
    const s = q.trim().toLowerCase();
    let list = data?.people ?? [];
    if (dept) list = list.filter((p) => p.deptId === dept);
    if (s) {
      list = list.filter((p) =>
        [p.name, p.deptName, p.positionName, p.companyEmail].some((v) =>
          (v ?? '').toLowerCase().includes(s)
        )
      );
    }
    // 직급이 높을수록 rank_order 가 크다 → 내림차순(웹과 동일 규칙).
    return [...list].sort(
      (a, b) => (b.positionRankOrder ?? 0) - (a.positionRankOrder ?? 0) || a.name.localeCompare(b.name)
    );
  }, [data?.people, q, dept]);

  const copy = async (text: string) => {
    await Clipboard.setStringAsync(text);
    toast.show('복사했습니다.', 'success');
  };

  if (loading && !data) {
    return (
      <View className="p-4">
        <SkeletonList count={4} />
      </View>
    );
  }

  return (
    <View className="flex-1">
      <View className="gap-2 border-b border-cd-border bg-cd-card px-4 py-2.5">
        <SearchBar value={q} onChangeText={setQ} placeholder="이름·부서·직급 검색" />
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={[{ deptId: '', deptName: '전체' } as DirDept, ...(data?.departments ?? [])]}
          keyExtractor={(d) => d.deptId || 'all'}
          contentContainerStyle={{ gap: 8 }}
          renderItem={({ item }) => (
            <Chip
              label={item.deptName}
              active={(dept ?? '') === item.deptId}
              onPress={() => setDept(item.deptId || null)}
            />
          )}
        />
      </View>

      <FlatList
        data={people}
        keyExtractor={(p) => p.employeeId}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} />}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListEmptyComponent={
          <EmptyState
            icon="people-outline"
            title={error ? '불러오지 못했습니다' : '해당하는 임직원이 없습니다'}
            description={error ?? undefined}
          />
        }
        renderItem={({ item }) => (
          <View className="gap-2 border-b border-cd-border px-4 py-3">
            <View className="flex-row items-center gap-3">
              <Avatar name={item.name} size="md" />
              <View className="flex-1">
                <Text className="text-[15px] font-bold text-cd-text">
                  {item.name}
                  {item.positionName ? (
                    <Text className="text-[13px] font-normal text-cd-muted"> {item.positionName}</Text>
                  ) : null}
                </Text>
                <Text className="text-[12px] text-cd-faint">{item.deptName ?? '-'}</Text>
              </View>
            </View>

            <View className="flex-row flex-wrap gap-2">
              {item.mobilePhone ? (
                <>
                  <ContactBtn icon="call" label="전화" onPress={() => callPhone(item.mobilePhone)} />
                  <ContactBtn icon="chatbubble" label="문자" onPress={() => sendSms(item.mobilePhone)} />
                </>
              ) : null}
              {item.companyPhone ? (
                <ContactBtn
                  icon="business"
                  label="사내"
                  onPress={() => callPhone(item.companyPhone)}
                />
              ) : null}
              {item.companyEmail ? (
                <>
                  <ContactBtn
                    icon="mail"
                    label="메일"
                    onPress={() =>
                      router.push(
                        `/mail/compose?to=${encodeURIComponent(`${item.name} <${item.companyEmail}>`)}`
                      )
                    }
                  />
                  <ContactBtn
                    icon="copy-outline"
                    label="주소 복사"
                    onPress={() => void copy(item.companyEmail!)}
                  />
                </>
              ) : null}
            </View>
            {item.companyEmail ? (
              <Text numberOfLines={1} className="text-[11px] text-cd-faint">
                {item.companyEmail}
              </Text>
            ) : null}
          </View>
        )}
      />
    </View>
  );
}

function ContactBtn({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      className="min-h-[36px] flex-row items-center gap-1.5 rounded-full border border-cd-border px-3 active:opacity-70">
      <Ionicons name={icon} size={14} color={c.primary} />
      <Text className="text-[12px] font-bold text-cd-muted">{label}</Text>
    </Pressable>
  );
}

/** 외부 연락처(사업장 담당자)는 기존 담당자 화면을 재사용한다. */
export function ExternalContactsHint() {
  const router = useRouter();
  return (
    <EmptyState
      icon="briefcase-outline"
      title="외부 연락처"
      description="사업장 담당자는 담당자 화면에서 검색·연락할 수 있습니다."
      action={
        <Pressable
          onPress={() => router.push('/contacts')}
          className="min-h-[44px] justify-center rounded-xl bg-cd-primary px-5 active:opacity-80">
          <Text className="text-[15px] font-bold text-white">담당자 열기</Text>
        </Pressable>
      }
    />
  );
}

/** Linking 직접 사용 여지를 남겨둔다(향후 지도·웹 링크 등). */
export const openUrl = (url: string) => void Linking.openURL(url);
