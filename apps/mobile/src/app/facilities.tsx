import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';

import {
  Badge,
  Card,
  CardRow,
  EmptyState,
  ScreenHeader,
  SearchBar,
  Sheet,
  SkeletonList,
} from '@/components/ui';
import { apiJson } from '@/lib/api';
import { kvGet, kvSet } from '@/lib/kv';
import { useApi } from '@/lib/use-api';
import { useTheme } from '@/theme/useTheme';

/**
 * 사업장 탐색 — 브라우저 프로토(`/m`)의 C안 하이브리드를 앱으로 되살린 것.
 *
 * 초기 화면: 검색창 + 최근 본 + 관계 카드(용역/영업 진행 중) + 통합허가 20업종 그리드.
 * 검색·필터 모드: 칩 3종([업종][지역][관계]) + N곳 헤더 + 목록 + 더보기.
 * 서버 필터를 그대로 쓴다(`industryCategories`·`sidos`·`engagement`) — 클라이언트에서 거르지 않는다.
 */

const PAGE = 30;
const RECENT_KEY = 'recent-facilities';
const RECENT_MAX = 5;

export interface FacilityItem {
  facilityId: string;
  companyName: string;
  businessRegistrationNo: string | null;
  representativeName: string | null;
  phoneNumber: string | null;
  siteAddress: string | null;
  regionSido: string | null;
  regionSigungu: string | null;
  industryCode: string | null;
  industryName: string | null;
  integratedPermitTarget: string | null;
  decisionNo: string | null;
  permitDate: string | null;
  airClass: number | null;
  waterClass: number | null;
  isClosed: boolean;
}
interface BrowseStats {
  industries: { id: string; label: string; count: number }[];
  contractActive: number;
  salesActive: number;
}
interface FilterOptions {
  sidos: { value: string; count: number }[];
}
type Engagement = 'contract' | 'sales';
interface Filters {
  industries: string[];
  sidos: string[];
  engagement: Engagement[];
}

const EMPTY: Filters = { industries: [], sidos: [], engagement: [] };
const ENGAGEMENT_LABEL: Record<Engagement, string> = { contract: '용역 진행 중', sales: '영업 진행 중' };

export default function FacilitiesScreen() {
  const router = useRouter();
  const { c } = useTheme();

  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [sheet, setSheet] = useState<null | 'industry' | 'sido' | 'engagement'>(null);
  const [recent, setRecent] = useState<{ facilityId: string; companyName: string; siteAddress: string | null }[]>([]);

  const [items, setItems] = useState<FacilityItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [end, setEnd] = useState(false);

  const stats = useApi<BrowseStats>('/api/facilities/browse-stats', { cache: true });
  const options = useApi<{ filters?: FilterOptions }>('/api/facilities?includeFilters=1&limit=1', { cache: true });

  const active = !!submitted.trim() || filters.industries.length > 0 || filters.sidos.length > 0 || filters.engagement.length > 0;

  useFocusEffect(
    useCallback(() => {
      void kvGet<typeof recent>(RECENT_KEY).then((v) => v && setRecent(v.value.slice(0, RECENT_MAX)));
    }, [])
  );

  const buildPath = useCallback(
    (offset: number) => {
      const p = new URLSearchParams({ limit: String(PAGE), offset: String(offset), sort: 'name' });
      if (submitted.trim()) p.set('q', submitted.trim());
      if (filters.industries.length) p.set('industryCategories', filters.industries.join(','));
      if (filters.sidos.length) p.set('sidos', filters.sidos.join(','));
      if (filters.engagement.length) p.set('engagement', filters.engagement.join(','));
      return `/api/facilities?${p.toString()}`;
    },
    [submitted, filters]
  );

  const load = useCallback(
    async (offset: number) => {
      setLoading(true);
      try {
        const res = await apiJson<{ items?: FacilityItem[]; total?: number }>(buildPath(offset));
        const list = res.items ?? [];
        setItems((prev) => (offset === 0 ? list : [...prev, ...list]));
        setTotal(res.total ?? (offset === 0 ? list.length : offset + list.length));
        setEnd(list.length < PAGE);
      } catch {
        if (offset === 0) setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [buildPath]
  );

  useEffect(() => {
    if (!active) {
      setItems([]);
      setTotal(0);
      return;
    }
    void load(0);
  }, [active, load]);

  const openDetail = (f: FacilityItem) => {
    const next = [
      { facilityId: f.facilityId, companyName: f.companyName, siteAddress: f.siteAddress },
      ...recent.filter((r) => r.facilityId !== f.facilityId),
    ].slice(0, RECENT_MAX);
    setRecent(next);
    void kvSet(RECENT_KEY, next);
    router.push({ pathname: '/facility/[facilityId]', params: { facilityId: f.facilityId } });
  };

  const toggle = <K extends keyof Filters>(key: K, v: Filters[K][number]) =>
    setFilters((prev) => {
      const arr = prev[key] as string[];
      const next = arr.includes(v as string) ? arr.filter((x) => x !== v) : [...arr, v as string];
      return { ...prev, [key]: next } as Filters;
    });

  const chipLabel = (key: keyof Filters, base: string) => {
    const n = filters[key].length;
    return n ? `${base} ${n}` : base;
  };

  const sidoOptions = options.data?.filters?.sidos ?? [];
  const industryOptions = stats.data?.industries ?? [];

  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: c.bg }} className="flex-1 bg-cd-bg">
      <ScreenHeader title="사업장" subtitle={active ? `${total.toLocaleString()}곳` : undefined} back />
      <View className="px-[18px] pb-2">
        <SearchBar
          value={q}
          onChangeText={setQ}
          placeholder="사업장명·사업자번호 검색"
          onSubmit={() => setSubmitted(q)}
        />
      </View>

      {/* 필터 칩 */}
      <View className="flex-row gap-2 px-[18px] pb-2">
        <FilterChip label={chipLabel('industries', '업종')} on={!!filters.industries.length} onPress={() => setSheet('industry')} />
        <FilterChip label={chipLabel('sidos', '지역')} on={!!filters.sidos.length} onPress={() => setSheet('sido')} />
        <FilterChip label={chipLabel('engagement', '관계')} on={!!filters.engagement.length} onPress={() => setSheet('engagement')} />
        {active ? (
          <Pressable
            onPress={() => {
              setQ('');
              setSubmitted('');
              setFilters(EMPTY);
            }}
            hitSlop={6}
            className="h-[34px] flex-row items-center gap-1 rounded-full px-2 active:opacity-60">
            <Ionicons name="close-circle" size={15} color={c.faint} />
            <Text className="text-[12px] text-cd-faint">초기화</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 18, paddingTop: 4, gap: 14, paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={loading && items.length === 0}
            onRefresh={() => (active ? load(0) : (stats.reload(), options.reload()))}
            tintColor={c.faint}
          />
        }>
        {!active ? (
          <>
            {recent.length ? (
              <Card title="최근 본 사업장">
                <View className="mt-1">
                  {recent.map((r, i) => (
                    <CardRow
                      key={r.facilityId}
                      first={i === 0}
                      title={r.companyName}
                      meta={r.siteAddress ?? undefined}
                      onPress={() =>
                        router.push({ pathname: '/facility/[facilityId]', params: { facilityId: r.facilityId } })
                      }
                    />
                  ))}
                </View>
              </Card>
            ) : null}

            {/* 관계 카드 — 우리와 일이 얽혀 있는 사업장부터 */}
            <View className="flex-row gap-2">
              <RelationCard
                label="용역 진행 중"
                count={stats.data?.contractActive ?? 0}
                tone={c.primary}
                onPress={() => setFilters({ ...EMPTY, engagement: ['contract'] })}
              />
              <RelationCard
                label="영업 진행 중"
                count={stats.data?.salesActive ?? 0}
                tone={c.warning}
                onPress={() => setFilters({ ...EMPTY, engagement: ['sales'] })}
              />
            </View>

            <Card title="통합허가 업종">
              {stats.loading && !stats.data ? (
                <SkeletonList count={2} />
              ) : (
                <View className="mt-1 flex-row flex-wrap gap-2">
                  {industryOptions.map((it) => (
                    <Pressable
                      key={it.id}
                      onPress={() => setFilters({ ...EMPTY, industries: [it.id] })}
                      style={{ width: '31.5%' }}
                      className="gap-0.5 rounded-xl border border-cd-border px-2.5 py-2.5 active:opacity-70">
                      <Text numberOfLines={2} className="text-[11.5px] font-semibold text-cd-body">
                        {it.label}
                      </Text>
                      <Text className="text-[13px] font-extrabold text-cd-text">{it.count}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </Card>
          </>
        ) : loading && !items.length ? (
          <SkeletonList count={4} />
        ) : !items.length ? (
          <EmptyState icon="business-outline" title="조건에 맞는 사업장이 없습니다" />
        ) : (
          <>
            <Card>
              <View>
                {items.map((f, i) => (
                  <CardRow
                    key={f.facilityId}
                    first={i === 0}
                    title={f.companyName}
                    meta={[f.regionSido, f.regionSigungu, f.industryName].filter(Boolean).join(' · ') || undefined}
                    right={f.isClosed ? <Badge label="폐업" tone="neutral" /> : undefined}
                    onPress={() => openDetail(f)}
                  />
                ))}
              </View>
            </Card>
            {!end ? (
              <Pressable
                onPress={() => load(items.length)}
                className="items-center rounded-card border border-cd-border py-3 active:opacity-70">
                <Text className="text-[13px] font-bold text-cd-primary">{loading ? '불러오는 중…' : '더보기'}</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </ScrollView>

      {/* 필터 시트 */}
      <Sheet visible={sheet === 'industry'} onClose={() => setSheet(null)} title="업종 선택">
        <View style={{ maxHeight: 420 }}>
          <ScrollView>
            {industryOptions.map((it) => (
              <CheckRow
                key={it.id}
                label={`${it.label} (${it.count})`}
                on={filters.industries.includes(it.id)}
                onPress={() => toggle('industries', it.id)}
              />
            ))}
          </ScrollView>
        </View>
      </Sheet>
      <Sheet visible={sheet === 'sido'} onClose={() => setSheet(null)} title="지역 선택">
        <View style={{ maxHeight: 420 }}>
          <ScrollView>
            {sidoOptions.map((s) => (
              <CheckRow
                key={s.value}
                label={`${s.value} (${s.count})`}
                on={filters.sidos.includes(s.value)}
                onPress={() => toggle('sidos', s.value)}
              />
            ))}
          </ScrollView>
        </View>
      </Sheet>
      <Sheet visible={sheet === 'engagement'} onClose={() => setSheet(null)} title="관계 선택">
        <View>
          {(['contract', 'sales'] as Engagement[]).map((k) => (
            <CheckRow
              key={k}
              label={ENGAGEMENT_LABEL[k]}
              on={filters.engagement.includes(k)}
              onPress={() => toggle('engagement', k)}
            />
          ))}
        </View>
      </Sheet>
    </SafeAreaView>
  );
}

function FilterChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      className="h-[34px] flex-row items-center gap-1 rounded-full border px-3 active:opacity-70"
      style={{ borderColor: on ? c.primary : c.border, backgroundColor: on ? c.primarySoft : c.card }}>
      <Text className="text-[12.5px] font-bold" style={{ color: on ? c.primary : c.muted }}>
        {label}
      </Text>
      <Ionicons name="chevron-down" size={13} color={on ? c.primary : c.faint} />
    </Pressable>
  );
}

function RelationCard({
  label,
  count,
  tone,
  onPress,
}: {
  label: string;
  count: number;
  tone: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 gap-1 rounded-card border border-cd-border bg-cd-card p-4 active:opacity-70">
      <Text className="text-[12px] text-cd-muted">{label}</Text>
      <Text className="text-[22px] font-extrabold leading-none" style={{ color: tone }}>
        {count.toLocaleString()}
      </Text>
    </Pressable>
  );
}

function CheckRow({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-2.5 border-b border-cd-grid-line py-3 active:opacity-70">
      <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? c.primary : c.faint} />
      <Text className="flex-1 text-[14px] text-cd-text">{label}</Text>
    </Pressable>
  );
}
