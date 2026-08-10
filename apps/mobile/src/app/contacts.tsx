import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { CtaGradientFill, EmptyState, GradientIconButton, SearchBar, TileGrid } from '@/components/ui';
import { useApi } from '@/lib/use-api';
import { callPhone, sendSms } from '@/lib/format';
import { ORG_CATEGORIES, UNCATEGORIZED } from '@/lib/org-categories';
import { useTheme } from '@/theme/useTheme';

interface Contact {
  id: number;
  personName?: string;
  title?: string;
  departmentName?: string;
  facilityName?: string;
  officePhone?: string | null;
  mobilePhone?: string | null;
  email?: string | null;
  status?: string;
  orgCategory?: string | null;
}

/** 카테고리 필터 키 — null=전체, UNCATEGORIZED=미지정, 그 외 ORG_CATEGORIES 값. */
type CategoryKey = string | null;

// 데스크탑 /directory 외부 연락처 좌측 분류(전체 + 6종 + 미지정)의 모바일 대응.
// 아이콘은 lucide → Ionicons 근사(Landmark→library, Beaker→flask), tone 은 화면에서 theme 색으로 채운다.
const CATEGORY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  공공기관: 'library-outline',
  공기업: 'flash-outline',
  민간기업: 'business-outline',
  금융기관: 'card-outline',
  협력업체: 'flask-outline',
  '협회·조합': 'people-circle-outline',
};

// 담당자 — 카테고리 타일(외부 연락처 7분류) + 검색 + 원터치 tel/sms.
export default function ContactsScreen() {
  const { c } = useTheme();
  const { data, loading, refreshing, error, reload } = useApi<{ contacts: Contact[] }>(
    '/api/sales/contacts'
  );
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<CategoryKey>(null);

  // 데스크탑 DirectoryBoard 와 동일하게 비활성(inactive) 담당자는 제외한다(분류 건수 일치 기준).
  const all = useMemo(
    () => (data?.contacts ?? []).filter((x) => x.status !== 'inactive'),
    [data]
  );

  // 카테고리별 건수 — 검색어와 무관하게 전체 기준(타일 배지).
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of all) {
      const key = x.orgCategory && x.orgCategory.trim() ? x.orgCategory : UNCATEGORIZED;
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [all]);

  const list = useMemo(() => {
    let arr = all;
    if (cat === UNCATEGORIZED) arr = arr.filter((x) => !x.orgCategory || !x.orgCategory.trim());
    else if (cat) arr = arr.filter((x) => x.orgCategory === cat);
    const kw = q.trim().toLowerCase();
    if (!kw) return arr;
    return arr.filter((x) =>
      `${x.personName ?? ''} ${x.facilityName ?? ''} ${x.departmentName ?? ''}`
        .toLowerCase()
        .includes(kw)
    );
  }, [all, cat, q]);

  const tiles: { key: CategoryKey; label: string; icon: keyof typeof Ionicons.glyphMap; tone: string; count: number }[] = [
    { key: null, label: '전체', icon: 'people-outline', tone: c.primary, count: all.length },
    ...ORG_CATEGORIES.map((name, i) => ({
      key: name as CategoryKey,
      label: name,
      icon: CATEGORY_ICONS[name] ?? 'business-outline',
      tone: [c.secondary, c.warning, c.success, c.primaryStrong, c.error, c.primary][i],
      count: counts.get(name) ?? 0,
    })),
    { key: UNCATEGORIZED, label: '미지정', icon: 'help-circle-outline', tone: c.faint, count: counts.get(UNCATEGORIZED) ?? 0 },
  ];

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-cd-bg">
      <View className="gap-3 border-b border-cd-border bg-cd-card px-4 pb-3 pt-3">
        <SearchBar value={q} onChangeText={setQ} placeholder="담당자·사업장·부서 검색" />
        <TileGrid columns={4}>
          {tiles.map((t) => (
            <CategoryTile
              key={t.key ?? 'all'}
              label={t.label}
              icon={t.icon}
              tone={t.tone}
              count={t.count}
              active={cat === t.key}
              onPress={() => setCat(t.key)}
            />
          ))}
        </TileGrid>
      </View>

      {loading ? (
        <ActivityIndicator className="mt-10" />
      ) : error ? (
        <Text className="mt-10 text-center text-cd-error">{error}</Text>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(x) => String(x.id)}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} />}
          ListEmptyComponent={
            <EmptyState
              icon="people-outline"
              title="담당자가 없습니다"
              description={cat || q ? '다른 카테고리나 검색어로 시도해 보세요' : undefined}
            />
          }
          renderItem={({ item }) => <ContactCard c={item} />}
        />
      )}
    </SafeAreaView>
  );
}

/** 카테고리 타일 — 홈 빠른 실행(ActionTile) 룩 + 선택 시 CTA 그라데이션 채움 + 건수 배지. */
function CategoryTile({
  label,
  icon,
  tone,
  count,
  active,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} className="flex-1 items-center gap-[6px] active:opacity-70">
      <View>
        <View
          className={`h-[50px] w-[50px] items-center justify-center overflow-hidden rounded-[18px] ${
            active ? '' : 'border border-cd-border bg-cd-card'
          }`}
          style={{
            shadowColor: '#3C4696',
            shadowOpacity: active ? 0.2 : 0.12,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 6 },
            elevation: 3,
          }}>
          {active ? <CtaGradientFill soft /> : null}
          <Ionicons name={icon} size={22} color={active ? '#FFFFFF' : tone} />
        </View>
        {count > 0 ? (
          <View className="absolute -right-1.5 -top-1 min-w-[18px] items-center justify-center rounded-full bg-cd-primary px-1 py-[1px]">
            <Text className="text-[9.5px] font-extrabold text-white">
              {count > 999 ? '999+' : count}
            </Text>
          </View>
        ) : null}
      </View>
      <Text
        numberOfLines={1}
        className={`text-[10.5px] ${active ? 'font-extrabold text-cd-primary' : 'font-semibold text-cd-body'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

function ContactCard({ c }: { c: Contact }) {
  const phone = c.mobilePhone || c.officePhone;
  const email = (c.email ?? '').trim();
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
      {/* 원터치 액션 — 전화·문자·메일(메일은 수신자를 채운 쓰기 화면으로). */}
      {phone || email ? (
        <View className="flex-row gap-2">
          {phone ? (
            <GradientIconButton soft icon="call" diameter={30} iconSize={15} onPress={() => callPhone(phone)} />
          ) : null}
          {phone ? (
            <GradientIconButton
              soft
              icon="chatbubble-ellipses"
              diameter={30}
              iconSize={15}
              onPress={() => sendSms(phone)}
            />
          ) : null}
          {email ? (
            <GradientIconButton
              soft
              icon="mail"
              diameter={30}
              iconSize={15}
              onPress={() => router.push(`/mail/compose?to=${encodeURIComponent(email)}`)}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
