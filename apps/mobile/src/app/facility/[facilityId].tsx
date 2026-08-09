import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';

import { Badge, Card, CardRow, EmptyState, GradientIconButton, ScreenHeader, SkeletonList } from '@/components/ui';
import { useApi } from '@/lib/use-api';
import { callPhone, fmtDate, sendSms } from '@/lib/format';
import { useTheme } from '@/theme/useTheme';

/**
 * 사업장 상세(요약) — 현장·미팅에서 필요한 것만.
 *
 * 데스크탑 `FacilityDetailPanel`(4천 줄)의 전체 데이터를 내리지 않는다. 기본 정보·허가·담당자·
 * 최근 활동까지만 보여주고 깊은 편집은 웹에 맡긴다.
 * 허가는 **허가번호·허가일만** 표기한다(2026-08-06 사용자 확정 — 상세 허가 정보 태그화는 후속).
 */

interface Permit {
  permitId: string;
  decisionNo: string | null;
  permitType: string | null;
  permitDate: string | null;
  isFirstPermit: number;
}
interface Detail {
  facilityId: string;
  companyName: string;
  businessRegistrationNo: string | null;
  representativeName: string | null;
  siteAddress: string | null;
  phoneNumber: string | null;
  industryCode: string | null;
  industryName: string | null;
  regionSido: string | null;
  regionSigungu: string | null;
  isClosed: boolean;
  permits: Permit[];
}
interface Person {
  id: number;
  personName: string;
  title: string | null;
  departmentName?: string | null;
  officePhone: string | null;
  mobilePhone: string | null;
  email: string | null;
  status?: string;
}
interface SalesItem {
  projectId?: string;
  activityId?: string;
  title?: string | null;
  projectTitle?: string | null;
  activityType?: string | null;
  scheduledAt?: string | null;
  summary?: string | null;
}

export default function FacilityDetailScreen() {
  const { facilityId } = useLocalSearchParams<{ facilityId: string }>();
  const { c } = useTheme();

  const detail = useApi<Detail>(`/api/facilities/${facilityId}`, { cache: true });
  const contacts = useApi<{ mainNumber?: string | null; people?: Person[] }>(
    `/api/facilities/${facilityId}/contacts`,
    { cache: true }
  );
  const sales = useApi<{ items?: SalesItem[] }>(`/api/facilities/${facilityId}/sales-history`, { cache: true });

  const d = detail.data;
  const people = (contacts.data?.people ?? []).filter((p) => p.status !== 'inactive');
  // 허가는 최신 1건이 대표(서버가 허가일 내림차순으로 준다). 최초 허가는 배지로 구분.
  const permit = d?.permits?.[0] ?? null;
  const region = [d?.regionSido, d?.regionSigungu].filter(Boolean).join(' ');

  const openMap = () => {
    const addr = d?.siteAddress;
    if (!addr) return;
    // 지도앱은 OS 기본 처리에 맡긴다(설치 앱에 따라 카카오·네이버·구글 중 선택 시트가 뜬다).
    void Linking.openURL(`geo:0,0?q=${encodeURIComponent(addr)}`).catch(() =>
      Linking.openURL(`https://map.kakao.com/link/search/${encodeURIComponent(addr)}`)
    );
  };

  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: c.bg }} className="flex-1 bg-cd-bg">
      <ScreenHeader title={d?.companyName ?? '사업장'} subtitle={region || undefined} back />
      <ScrollView
        contentContainerStyle={{ padding: 18, gap: 14, paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={detail.refreshing}
            onRefresh={() => {
              detail.reload();
              contacts.reload();
              sales.reload();
            }}
            tintColor={c.faint}
          />
        }>
        {detail.loading && !d ? (
          <SkeletonList count={3} />
        ) : !d ? (
          <EmptyState icon="business-outline" title="사업장을 불러오지 못했습니다" description={detail.error ?? undefined} />
        ) : (
          <>
            <Card title="기본 정보" badge={d.isClosed ? <Badge label="폐업" tone="neutral" /> : undefined}>
              <View className="mt-1">
                <Field label="사업자등록번호" value={d.businessRegistrationNo} />
                <Field label="대표자" value={d.representativeName} />
                <Field
                  label="소재지"
                  value={d.siteAddress}
                  action={d.siteAddress ? { icon: 'map-outline', onPress: openMap } : undefined}
                />
                <Field
                  label="대표 전화"
                  value={d.phoneNumber ?? contacts.data?.mainNumber ?? null}
                  action={
                    d.phoneNumber || contacts.data?.mainNumber
                      ? { icon: 'call-outline', onPress: () => callPhone(d.phoneNumber ?? contacts.data?.mainNumber ?? '') }
                      : undefined
                  }
                />
              </View>
            </Card>

            <Card title="업종·허가">
              <View className="mt-1">
                <Field label="업종" value={[d.industryName, d.industryCode].filter(Boolean).join(' · ') || null} />
                <Field
                  label="통합허가"
                  value={d.permits?.length ? `허가 ${d.permits.length}건` : '허가 정보 없음'}
                />
                <Field label="허가번호" value={permit?.decisionNo} />
                <Field label="허가일" value={permit?.permitDate ? fmtDate(permit.permitDate) : null} />
              </View>
            </Card>

            <Card title="담당자" badge={people.length ? <Badge label={`${people.length}`} tone="neutral" /> : undefined}>
              {contacts.loading && !contacts.data ? (
                <SkeletonList count={2} />
              ) : !people.length ? (
                <Text className="py-2 text-[13px] text-cd-faint">등록된 담당자가 없습니다.</Text>
              ) : (
                <View className="mt-1">
                  {people.slice(0, 8).map((p, i) => {
                    const phone = p.mobilePhone || p.officePhone;
                    return (
                      <CardRow
                        key={p.id}
                        first={i === 0}
                        title={`${p.personName}${p.title ? ` ${p.title}` : ''}`}
                        meta={[p.departmentName, phone].filter(Boolean).join(' · ') || undefined}
                        right={
                          phone ? (
                            <View className="flex-row gap-1.5">
                              <IconAction icon="call" onPress={() => callPhone(phone)} />
                              <IconAction icon="chatbubble-ellipses" onPress={() => sendSms(phone)} />
                            </View>
                          ) : undefined
                        }
                      />
                    );
                  })}
                </View>
              )}
            </Card>

            <Card title="최근 영업 활동">
              {sales.loading && !sales.data ? (
                <SkeletonList count={2} />
              ) : !(sales.data?.items ?? []).length ? (
                <Text className="py-2 text-[13px] text-cd-faint">활동 이력이 없습니다.</Text>
              ) : (
                <View className="mt-1">
                  {(sales.data?.items ?? []).slice(0, 5).map((s, i) => (
                    <CardRow
                      key={s.activityId ?? s.projectId ?? String(i)}
                      first={i === 0}
                      title={s.title ?? s.projectTitle ?? s.activityType ?? '활동'}
                      meta={[s.scheduledAt ? fmtDate(s.scheduledAt) : null, s.summary].filter(Boolean).join(' · ') || undefined}
                    />
                  ))}
                </View>
              )}
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({
  label,
  value,
  action,
}: {
  label: string;
  value?: string | null;
  action?: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void };
}) {
  const { c } = useTheme();
  return (
    <View className="flex-row items-center gap-2 border-b border-cd-grid-line py-2.5">
      <Text className="w-[92px] text-[12px] text-cd-faint">{label}</Text>
      <Text className="flex-1 text-[13.5px] text-cd-text">{value || '-'}</Text>
      {action ? (
        <Pressable onPress={action.onPress} hitSlop={8} className="active:opacity-60">
          <Ionicons name={action.icon} size={17} color={c.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}

function IconAction({ icon, onPress }: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
  // 전화·문자 원형 버튼은 앱 공통으로 CTA 그라데이션(담당자 목록·영업 상세와 동일).
  return <GradientIconButton icon={icon} onPress={onPress} diameter={32} />;
}
