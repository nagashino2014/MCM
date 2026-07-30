import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Badge, Chip, EmptyState, SkeletonList } from '@/components/ui';
import { useApi } from '@/lib/use-api';
import { callPhone, currentMonth, fmtTime, sendSms, shiftMonth } from '@/lib/format';
import { useTheme } from '@/theme/useTheme';

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
/** 인적 일정(휴가) — /api/home/calendar. scope 로 본인/부서를 구분한다. */
interface LeaveEntry {
  entryId: string;
  scope: string;
  name: string;
  positionName: string | null;
  deptName: string | null;
  date: string;
  label: string;
  kind: string;
}

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
/** ISO(또는 날짜문자열) → 'YYYY-MM-DD'(KST 기준). */
function dayKey(v?: string | null): string {
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
const todayKey = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

/**
 * 일정(M6-B) — 월 격자 캘린더 + 선택일 상세.
 *
 * 데이터원은 데스크탑 홈 캘린더와 같다: 영업 활동(/api/sales/schedule)과
 * 휴가(/api/home/calendar). 좁은 화면이라 격자에는 점만 찍고, 상세는 아래 리스트로 뺀다
 * (셀 안에 일정 제목을 넣으면 읽을 수 없다 — 축소 대신 재배치).
 */
export default function ScheduleScreen() {
  const { c } = useTheme();
  const [month, setMonth] = useState(currentMonth());
  const [selected, setSelected] = useState<string>(todayKey());
  const [showLeave, setShowLeave] = useState(true);

  const sales = useApi<{ activities: Activity[] }>(`/api/sales/schedule?month=${month}`, {
    cache: true,
  });
  // 부서 휴가까지 함께 본다(데스크탑 기본 스코프와 동일).
  const leave = useApi<{ entries: LeaveEntry[] }>(`/api/home/calendar?month=${month}&scopes=self,dept`, {
    cache: true,
    skip: !showLeave,
  });

  const activities = sales.data?.activities ?? [];
  const leaves = showLeave ? (leave.data?.entries ?? []) : [];

  /** 날짜별 묶음 — 격자에 점을 찍고 선택일 리스트를 만드는 근거. */
  const byDay = useMemo(() => {
    const map = new Map<string, { acts: Activity[]; leaves: LeaveEntry[] }>();
    const put = (k: string) => {
      if (!map.has(k)) map.set(k, { acts: [], leaves: [] });
      return map.get(k)!;
    };
    for (const a of activities) {
      const k = dayKey(a.scheduledAt);
      if (k) put(k).acts.push(a);
    }
    for (const l of leaves) {
      const k = dayKey(l.date);
      if (k) put(k).leaves.push(l);
    }
    return map;
  }, [activities, leaves]);

  /** 월 격자 — 앞뒤 빈 칸을 채워 7열로 맞춘다. */
  const cells = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const days = new Date(y, m, 0).getDate();
    const lead = first.getDay();
    const out: (string | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= days; d++) {
      out.push(`${month}-${String(d).padStart(2, '0')}`);
    }
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [month]);

  const sel = byDay.get(selected);
  const loading = sales.loading && !sales.data;

  return (
    <SafeAreaView edges={['bottom']} style={{ backgroundColor: c.bg }} className="flex-1 bg-cd-bg">
      {/* 월 네비 */}
      <View className="flex-row items-center justify-between border-b border-cd-border bg-cd-card px-2 py-2">
        <Pressable onPress={() => setMonth((m) => shiftMonth(m, -1))} className="p-2 active:opacity-60">
          <Ionicons name="chevron-back" size={20} color={c.primary} />
        </Pressable>
        <Pressable
          onPress={() => {
            setMonth(currentMonth());
            setSelected(todayKey());
          }}
          className="px-3 py-1 active:opacity-60">
          <Text className="text-[16px] font-extrabold text-cd-text">{month}</Text>
        </Pressable>
        <Pressable onPress={() => setMonth((m) => shiftMonth(m, 1))} className="p-2 active:opacity-60">
          <Ionicons name="chevron-forward" size={20} color={c.primary} />
        </Pressable>
      </View>

      <ScrollView
        className="flex-1"
        refreshControl={
          <RefreshControl
            refreshing={sales.refreshing}
            onRefresh={() => {
              sales.reload();
              if (showLeave) leave.reload();
            }}
          />
        }
        contentContainerStyle={{ paddingBottom: 32 }}>
        {/* 요일 머리 */}
        <View className="flex-row px-2 pt-2">
          {DOW.map((d, i) => (
            <Text
              key={d}
              className="flex-1 text-center text-[11px] font-bold"
              style={{ color: i === 0 ? c.error : i === 6 ? c.primary : c.faint }}>
              {d}
            </Text>
          ))}
        </View>

        {/* 월 격자 */}
        <View className="flex-row flex-wrap px-2 pb-2">
          {cells.map((k, i) => {
            if (!k) return <View key={`e${i}`} style={{ width: `${100 / 7}%` }} className="h-14" />;
            const info = byDay.get(k);
            const dow = i % 7;
            const isSel = k === selected;
            const isToday = k === todayKey();
            return (
              <Pressable
                key={k}
                onPress={() => setSelected(k)}
                style={{ width: `${100 / 7}%` }}
                className="h-14 items-center justify-center active:opacity-60">
                <View
                  className={`h-8 w-8 items-center justify-center rounded-full ${
                    isSel ? 'bg-cd-primary' : isToday ? 'bg-cd-primary-soft' : ''
                  }`}>
                  <Text
                    className={`text-[13px] ${isSel ? 'font-extrabold text-white' : 'font-bold'}`}
                    style={
                      isSel
                        ? undefined
                        : { color: dow === 0 ? c.error : dow === 6 ? c.primary : c.text }
                    }>
                    {Number(k.slice(8))}
                  </Text>
                </View>
                {/* 일정 점 — 영업(파랑)·휴가(초록) */}
                <View className="mt-0.5 h-1.5 flex-row gap-0.5">
                  {info?.acts.length ? (
                    <View style={{ backgroundColor: c.primary }} className="h-1.5 w-1.5 rounded-full" />
                  ) : null}
                  {info?.leaves.length ? (
                    <View style={{ backgroundColor: c.success }} className="h-1.5 w-1.5 rounded-full" />
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* 필터 */}
        <View className="flex-row gap-2 border-t border-cd-border px-4 py-2.5">
          <Chip label="영업 일정" active onPress={() => {}} />
          <Chip label="휴가" active={showLeave} onPress={() => setShowLeave((v) => !v)} />
        </View>

        {/* 선택일 상세 */}
        <View className="gap-3 p-4">
          <Text className="text-[15px] font-extrabold text-cd-text">
            {selected.slice(5).replace('-', '월 ')}일
            <Text className="text-[13px] font-normal text-cd-faint">
              {' '}
              {DOW[new Date(selected).getDay()]}요일
            </Text>
          </Text>

          {loading ? (
            <SkeletonList count={2} />
          ) : !sel || (sel.acts.length === 0 && sel.leaves.length === 0) ? (
            <EmptyState icon="calendar-outline" title="이 날 일정이 없습니다" />
          ) : (
            <>
              {sel.leaves.map((l) => (
                <View
                  key={l.entryId}
                  className="flex-row items-center gap-2 rounded-card border border-cd-border bg-cd-card p-3">
                  <Ionicons name="airplane-outline" size={16} color={c.success} />
                  <Text className="flex-1 text-[14px] text-cd-text">
                    {l.name}
                    {l.positionName ? ` ${l.positionName}` : ''}
                  </Text>
                  <Badge label={l.label} tone="success" />
                </View>
              ))}
              {sel.acts.map((a) => (
                <ActivityCard key={a.activityId} a={a} />
              ))}
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ActivityCard({ a }: { a: Activity }) {
  const { c } = useTheme();
  return (
    <View className="rounded-card border border-cd-border bg-cd-card p-4">
      <View className="flex-row items-center gap-2">
        <View className="rounded-lg bg-cd-primary-soft px-2 py-1">
          <Text className="text-[11px] font-bold text-cd-primary">{fmtTime(a.scheduledAt)}</Text>
        </View>
        {a.activityType ? <Text className="text-[11px] text-cd-muted">{a.activityType}</Text> : null}
      </View>
      <Text className="mt-2 text-[15px] font-bold text-cd-text">
        {a.projectTitle || a.facilityName || '(제목 없음)'}
      </Text>
      {a.facilityName && a.projectTitle ? (
        <Text className="text-[12px] text-cd-muted">{a.facilityName}</Text>
      ) : null}
      {a.summary ? <Text className="mt-1 text-[13px] text-cd-muted">{a.summary}</Text> : null}
      {a.contacts?.length ? (
        <View className="mt-3 gap-1 border-t border-cd-border pt-2">
          {a.contacts.map((ct, i) => {
            const phone = ct.mobilePhone || ct.officePhone;
            return (
              <View key={ct.id ?? i} className="flex-row items-center justify-between">
                <Text className="text-[13px] text-cd-text">{ct.personName}</Text>
                {phone ? (
                  <View className="flex-row gap-4">
                    <Pressable onPress={() => callPhone(phone)} className="active:opacity-60">
                      <Ionicons name="call" size={18} color={c.primary} />
                    </Pressable>
                    <Pressable onPress={() => sendSms(phone)} className="active:opacity-60">
                      <Ionicons name="chatbubble-ellipses" size={18} color={c.primary} />
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
