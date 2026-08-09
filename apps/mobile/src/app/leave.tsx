import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import {
  Badge,
  Button,
  Card,
  CardRow,
  ScreenHeader,
  SegmentedTabs,
  SkeletonList,
  type SegmentItem,
} from '@/components/ui';
import { BarGauge, DayBars, DonutGauge } from '@/components/charts/Gauges';
import { useApi } from '@/lib/use-api';
import { useTheme } from '@/theme/useTheme';

interface LeaveSummary {
  granted: number;
  used: number;
  remaining: number;
}
interface LeaveNotice {
  noticeId: string;
  round: number;
  title?: string | null;
  submittedAt?: string | null;
}
interface DocSummary {
  docId: string;
  title: string;
  status: string;
  submittedAt: string | null;
  updatedAt: string;
  formName: string;
}
interface WeekRow {
  weekStart: string;
  workedMinutes: number;
  overtimeMinutes: number;
  excessMinutes: number;
  daysWorked: number;
  overLimit: boolean;
  excluded: boolean;
}
interface DailyRow {
  workDate: string;
  workedMinutes: number | null;
  isLeaveDay: boolean;
}
interface AttendanceRes {
  weeks: WeekRow[];
  week: string | null;
  daily: DailyRow[];
  limits: { weeklyStandardMinutes: number; weeklyLimitMinutes: number; weeklyOvertimeLimitMinutes: number };
}

const STATUS_LABEL: Record<string, string> = {
  draft: '작성 중',
  in_progress: '결재 중',
  approved: '승인',
  rejected: '반려',
  canceled: '취소',
};

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const d1 = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const hm = (min: number) => {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}시간 ${m % 60}분` : `${h}시간`;
};
const hOnly = (min: number) => {
  const h = Math.round((min / 60) * 10) / 10;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
};
const todayIso = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

/**
 * 근태·휴가 — 연차 잔여와 이번 주 초과근무를 한 화면에서 보고, 그 자리에서 신청한다.
 *
 * 두 신청 모두 기안 화면(P1)으로 간다 — 휴가는 `frm-leave-request`,
 * 초과근무는 `frm-overtime-request`(주 12h 를 넘기면 동의 시트가 뜬다).
 * 주별·일별 상세는 별도 화면(/attendance)에 그대로 둔다.
 */
export default function LeaveScreen() {
  const router = useRouter();
  const { c } = useTheme();
  const year = String(new Date().getFullYear());
  const [tab, setTab] = useState<'leave' | 'work'>('leave');

  const balance = useApi<{ summary: LeaveSummary | null }>(`/api/approval/leave?me=1&year=${year}`, { cache: true });
  const notices = useApi<{ notices: LeaveNotice[] }>('/api/home/leave-notices', { cache: true });
  const att = useApi<AttendanceRes>('/api/approval/attendance/me', { cache: true });
  const mine = useApi<{ docs: DocSummary[] }>('/api/approval/docs?box=in_progress');
  const done = useApi<{ docs: DocSummary[] }>('/api/approval/docs?box=completed');

  const [refreshing, setRefreshing] = useState(false);
  const reloadAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([balance.reload(), notices.reload(), att.reload(), mine.reload(), done.reload()]);
    setRefreshing(false);
    // 훅 반환 객체는 매 렌더 새로 만들어진다 — 의존성에서 제외.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reloadAll();
    }, [reloadAll])
  );

  const s = balance.data?.summary;
  const pendingNotices = (notices.data?.notices ?? []).filter((n) => !n.submittedAt);

  /** 내가 올린 문서 중 휴가·초과근무 건. */
  const docsOf = (kw: string[]) => {
    const all = [...(mine.data?.docs ?? []), ...(done.data?.docs ?? [])];
    return all
      .filter((d) => kw.some((k) => d.formName?.includes(k) || d.title?.includes(k)))
      .sort((a, b) => (b.submittedAt ?? b.updatedAt).localeCompare(a.submittedAt ?? a.updatedAt))
      .slice(0, 10);
  };
  const leaveDocs = useMemo(() => docsOf(['휴가']), [mine.data, done.data]);
  const otDocs = useMemo(() => docsOf(['초과', '휴일근무']), [mine.data, done.data]);

  // ── 이번 주 초과근무 ──────────────────────────────────────
  const limits = att.data?.limits;
  const week = att.data?.weeks?.[0] ?? null;
  const otLimit = limits?.weeklyOvertimeLimitMinutes ?? 720;
  const otUsed = week ? week.overtimeMinutes + week.excessMinutes : 0;
  const weekOver52 = !!(week && limits && week.workedMinutes > limits.weeklyLimitMinutes);

  const dayBars = useMemo(() => {
    const rows = att.data?.daily ?? [];
    const start = att.data?.week ?? week?.weekStart ?? null;
    if (!start) return [];
    const base = new Date(`${start}T12:00:00`);
    const today = todayIso();
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const row = rows.find((r) => r.workDate?.slice(0, 10) === iso);
      return {
        label: DOW[d.getDay()],
        minutes: row?.workedMinutes ?? null,
        leave: !!row?.isLeaveDay,
        today: iso === today,
      };
    });
  }, [att.data, week]);

  const goDraft = (formId: string) =>
    router.push({ pathname: '/approval/draft', params: { formId } });

  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: c.bg }} className="flex-1 bg-cd-bg">
      <ScreenHeader title="근태·휴가" subtitle={`${year}년`} back />
      <ScrollView
        contentContainerStyle={{ padding: 18, gap: 14, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reloadAll} tintColor={c.faint} />}>
        {/* 연차 */}
        {balance.loading && !s ? (
          <SkeletonList count={1} />
        ) : (
          <Card title="연차">
            {s ? (
              <View className="mt-1 flex-row items-center gap-4">
                <DonutGauge
                  value={s.remaining}
                  total={s.granted || 1}
                  label={d1(s.remaining)}
                  caption="잔여"
                  color={c.primary}
                />
                <View className="flex-1 gap-2">
                  <Stat label="총 연차" value={`${d1(s.granted)}일`} />
                  <Stat label="사용" value={`${d1(s.used)}일`} tone={c.warning} />
                  <Stat label="잔여" value={`${d1(s.remaining)}일`} tone={c.primary} strong />
                </View>
              </View>
            ) : (
              <Text className="py-2 text-[13px] text-cd-faint">
                연차 정보가 없습니다(직원 정보 연결이 필요합니다).
              </Text>
            )}
            <View className="mt-3">
              <Button label="휴가 신청" icon="calendar-outline" onPress={() => goDraft('frm-leave-request')} full />
            </View>
          </Card>
        )}

        {/* 연차 촉진 고지 */}
        {pendingNotices.length > 0 ? (
          <Card title="연차 사용 촉진 고지" badge={<Badge label={`${pendingNotices.length}`} tone="warning" />}>
            <View className="mt-1 gap-2">
              {pendingNotices.map((n) => (
                <View key={n.noticeId} className="gap-1 rounded-xl bg-cd-warning-soft px-3 py-2.5">
                  <View className="flex-row items-center gap-1.5">
                    <Ionicons name="alert-circle" size={14} color={c.warning} />
                    <Text className="flex-1 text-[13px] font-bold text-cd-warning">
                      {n.round}차 고지 — 회신이 필요합니다
                    </Text>
                  </View>
                  <Text className="text-[12px] text-cd-muted">회신은 웹에서 전자서명으로 진행합니다.</Text>
                </View>
              ))}
            </View>
          </Card>
        ) : null}

        {/* 이번 주 초과근무 */}
        <Card
          title="이번 주 초과근무"
          badge={weekOver52 ? <Badge label="주 52시간 초과" tone="error" /> : undefined}
          action={{ label: '주별 상세', onPress: () => router.push('/attendance') }}>
          {att.loading && !att.data ? (
            <SkeletonList count={1} />
          ) : !week ? (
            <Text className="py-2 text-[13px] text-cd-faint">근태 기록이 아직 없습니다.</Text>
          ) : (
            <View className="mt-1 gap-3">
              <View className="gap-1.5">
                <View className="flex-row items-baseline gap-1.5">
                  <Text className="text-[24px] font-extrabold leading-7" style={{ color: otUsed > otLimit ? c.error : c.text }}>
                    {hOnly(otUsed)}
                  </Text>
                  <Text className="text-[13px] text-cd-muted">/ {hOnly(otLimit)}시간</Text>
                  <View className="flex-1" />
                  <Text className="text-[11.5px] text-cd-faint">{week.weekStart} 주</Text>
                </View>
                <BarGauge value={otUsed} limit={otLimit} />
                <Text className="text-[11.5px] text-cd-faint">
                  근무 {hm(week.workedMinutes)} · {week.daysWorked}일 근무
                  {week.excessMinutes > 0 ? ` · 한도 초과 ${hOnly(week.excessMinutes)}h` : ''}
                </Text>
              </View>

              {dayBars.length ? (
                <View className="gap-1.5">
                  <Text className="text-[12px] font-bold text-cd-faint">일별 근무</Text>
                  <DayBars days={dayBars} max={limits?.weeklyStandardMinutes ? limits.weeklyStandardMinutes / 5 : 480} />
                </View>
              ) : null}

              {week.excluded ? (
                <Text className="text-[11.5px] text-cd-muted">산정 제외로 지정된 주입니다.</Text>
              ) : null}
            </View>
          )}
          <View className="mt-3">
            <Button
              label="초과/휴일근무 신청"
              icon="time-outline"
              variant="ghost"
              onPress={() => goDraft('frm-overtime-request')}
              full
            />
          </View>
        </Card>

        {/* 신청 이력 */}
        <Card title="내 신청">
          <View className="mt-1 gap-2">
            <SegmentedTabs
              items={
                [
                  { key: 'leave', label: '휴가' },
                  { key: 'work', label: '초과근무' },
                ] as SegmentItem<'leave' | 'work'>[]
              }
              value={tab}
              onChange={setTab}
            />
            {(tab === 'leave' ? leaveDocs : otDocs).length === 0 ? (
              <Text className="py-3 text-[13px] text-cd-faint">최근 신청 내역이 없습니다.</Text>
            ) : (
              <View>
                {(tab === 'leave' ? leaveDocs : otDocs).map((d, i) => (
                  <CardRow
                    key={d.docId}
                    first={i === 0}
                    title={d.title}
                    meta={(d.submittedAt ?? d.updatedAt).slice(0, 10)}
                    right={
                      <Badge
                        label={STATUS_LABEL[d.status] ?? d.status}
                        tone={d.status === 'approved' ? 'success' : d.status === 'rejected' ? 'error' : 'neutral'}
                      />
                    }
                    onPress={() => router.push({ pathname: '/approval/[docId]', params: { docId: d.docId } })}
                  />
                ))}
              </View>
            )}
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({
  label,
  value,
  tone,
  strong,
}: {
  label: string;
  value: string;
  tone?: string;
  strong?: boolean;
}) {
  return (
    <View className="flex-row items-baseline">
      <Text className="flex-1 text-[12.5px] text-cd-muted">{label}</Text>
      <Text
        className={`text-[15px] text-cd-text ${strong ? 'font-extrabold' : 'font-bold'}`}
        style={tone ? { color: tone } : undefined}>
        {value}
      </Text>
    </View>
  );
}
