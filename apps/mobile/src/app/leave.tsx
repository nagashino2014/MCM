import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Card, GradientButton, OutlineButton, ScreenHeader, SkeletonList } from '@/components/ui';
import { CHART, DayBars, DonutGauge, OvertimeGauge } from '@/components/charts/Gauges';
import { useApi } from '@/lib/use-api';
import { useTheme } from '@/theme/useTheme';

/**
 * 근태·휴가 — 핸드오프 3a("소프트 플랫" 확장) 그대로.
 *
 * 연차 도넛 + 이번 주 초과근무(한도 마커 게이지·일별 차트)를 한 화면에서 보고 그 자리에서 신청한다.
 * 신청은 둘 다 기안 화면(P1)으로 간다 — 휴가 `frm-leave-request`,
 * 초과근무 `frm-overtime-request`(주 12h 초과면 동의 시트가 뜬다).
 *
 * 차트·배지 색은 cd 토큰이 아니라 핸드오프 고정색이다(의미색 — 테마와 무관하게 같은 뜻이어야 한다).
 */

interface LeaveSummary {
  granted: number;
  used: number;
  remaining: number;
}
interface LeaveNotice {
  noticeId: string;
  round: number;
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
/** 상태 배지 색 — 핸드오프의 '승인'(#1f9d76 / #e2f5ee) 계열. */
const STATUS_TONE: Record<string, { fg: string; bg: string }> = {
  approved: { fg: '#1f9d76', bg: '#e2f5ee' },
  rejected: { fg: '#c0392e', bg: '#fdeceb' },
  in_progress: { fg: '#4353e4', bg: '#e3e6fb' },
  draft: { fg: '#878ea8', bg: '#f3f4fa' },
  canceled: { fg: '#878ea8', bg: '#f3f4fa' },
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

export default function LeaveScreen() {
  const router = useRouter();
  const { c, dark } = useTheme();
  // 수치·제목 잉크 — 라이트는 핸드오프 고정색, 다크는 카드 레이블과 같은 테마 텍스트색(가독성 실측 2026-08-20).
  const ink = dark ? c.text : CHART.ink;
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
  /** 하루 소정근로 — 주 소정(40h)을 5일로 나눈 값. 일별 막대의 '초과 발생' 기준. */
  const dayStandard = limits?.weeklyStandardMinutes ? limits.weeklyStandardMinutes / 5 : 480;

  const dayBars = useMemo(() => {
    const rows = att.data?.daily ?? [];
    const start = att.data?.week ?? week?.weekStart ?? null;
    if (!start) return [];
    const base = new Date(`${start}T12:00:00`);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const row = rows.find((r) => r.workDate?.slice(0, 10) === iso);
      const minutes = row?.workedMinutes ?? null;
      return {
        label: DOW[d.getDay()],
        dow: d.getDay(),
        minutes,
        over: (minutes ?? 0) > dayStandard,
      };
    });
  }, [att.data, week, dayStandard]);

  const goDraft = (formId: string) => router.push({ pathname: '/approval/draft', params: { formId } });
  const docs = tab === 'leave' ? leaveDocs : otDocs;

  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: c.bg }} className="flex-1 bg-cd-bg">
      <ScreenHeader title="근태·휴가" subtitle={`${year}년`} back variant="sub" />
      <ScrollView
        contentContainerStyle={{ padding: 18, paddingTop: 0, gap: 14, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reloadAll} tintColor={c.faint} />}>
        {/* 연차 */}
        {balance.loading && !s ? (
          <SkeletonList count={1} />
        ) : (
          <Card title="연차">
            {s ? (
              <View className="mt-3 flex-row items-center gap-5">
                <DonutGauge value={s.remaining} total={s.granted || 1} label={d1(s.remaining)} inkColor={ink} />
                <View className="flex-1 gap-[9px]">
                  <StatRow label="총 연차" value={`${d1(s.granted)}일`} ink={ink} />
                  <StatRow label="사용" value={`${d1(s.used)}일`} tone="#7b7ef4" ink={ink} />
                  <StatRow label="잔여" value={`${d1(s.remaining)}일`} strong divider ink={ink} />
                </View>
              </View>
            ) : (
              <Text className="py-2 text-[13px] text-cd-faint">
                연차 정보가 없습니다(직원 정보 연결이 필요합니다).
              </Text>
            )}
            <View className="mt-3.5">
              <GradientButton label="휴가 신청" icon="calendar-outline" onPress={() => goDraft('frm-leave-request')} />
            </View>
          </Card>
        )}

        {/* 연차 촉진 고지 */}
        {pendingNotices.length > 0 ? (
          <Card title="연차 사용 촉진 고지">
            <View className="mt-2 gap-2">
              {pendingNotices.map((n) => (
                <View key={n.noticeId} className="gap-1 rounded-xl px-3 py-2.5" style={{ backgroundColor: '#fdf1d8' }}>
                  <View className="flex-row items-center gap-1.5">
                    <Ionicons name="alert-circle" size={14} color="#b47700" />
                    <Text className="flex-1 text-[13px] font-bold" style={{ color: '#b47700' }}>
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
          badge={weekOver52 ? <TintBadge label="주 52시간 초과" fg="#c0392e" bg="#fdeceb" /> : undefined}
          action={{ label: '주별 상세', onPress: () => router.push('/attendance') }}>
          {att.loading && !att.data ? (
            <SkeletonList count={1} />
          ) : !week ? (
            <Text className="py-2 text-[13px] text-cd-faint">근태 기록이 아직 없습니다.</Text>
          ) : (
            <>
              <View className="mt-3 flex-row items-baseline justify-between">
                <View className="flex-row items-baseline">
                  <Text
                    className="text-[24px] font-extrabold leading-none"
                    style={{ color: otUsed > otLimit ? CHART.gaugeOver : ink }}>
                    {hOnly(otUsed)}
                  </Text>
                  <Text className="text-[13px] font-semibold" style={{ color: CHART.weekday }}>
                    {' '}
                    / {hOnly(otLimit)}시간
                  </Text>
                </View>
                <Text className="text-[11.5px]" style={{ color: CHART.weekday }}>
                  {week.weekStart} 주
                </Text>
              </View>

              <View className="mt-2.5">
                <OvertimeGauge value={otUsed} limit={otLimit} />
              </View>
              <View className="mt-1.5 flex-row justify-between">
                <Text className="text-[10.5px]" style={{ color: CHART.muted }}>
                  근무 {hm(week.workedMinutes)} · {week.daysWorked}일 근무
                </Text>
                {week.excessMinutes > 0 ? (
                  <Text className="text-[10.5px] font-bold" style={{ color: CHART.gaugeOver }}>
                    한도 초과 {hOnly(week.excessMinutes)}h
                  </Text>
                ) : null}
              </View>

              {dayBars.length ? (
                <>
                  <Text className="mt-3.5 text-[12px] font-bold" style={{ color: ink }}>
                    일별 근무
                  </Text>
                  <View className="mt-2.5">
                    <DayBars days={dayBars} max={dayStandard} />
                  </View>
                </>
              ) : null}

              {week.excluded ? (
                <Text className="mt-2.5 text-[11px]" style={{ color: CHART.muted }}>
                  산정 제외로 지정된 주입니다.
                </Text>
              ) : null}
            </>
          )}
          <View className="mt-3">
            <OutlineButton label="초과/휴일근무 신청" icon="time-outline" onPress={() => goDraft('frm-overtime-request')} />
          </View>
        </Card>

        {/* 내 신청 */}
        <Card title="내 신청">
          <View className="mt-3 flex-row gap-2">
            <SegChip label="휴가" on={tab === 'leave'} onPress={() => setTab('leave')} />
            <SegChip label="초과근무" on={tab === 'work'} onPress={() => setTab('work')} />
          </View>
          {docs.length === 0 ? (
            <Text className="py-3 text-[13px] text-cd-faint">최근 신청 내역이 없습니다.</Text>
          ) : (
            <View className="mt-3 gap-2">
              {docs.map((d) => {
                const tone = STATUS_TONE[d.status] ?? STATUS_TONE.draft;
                return (
                  <Pressable
                    key={d.docId}
                    onPress={() => router.push({ pathname: '/approval/[docId]', params: { docId: d.docId } })}
                    className="flex-row items-center gap-3 rounded-xl border p-3 active:opacity-70"
                    style={{ backgroundColor: '#fbfbfe', borderColor: '#eef0f7' }}>
                    <View className="flex-1">
                      <Text numberOfLines={1} className="text-[13px] font-semibold" style={{ color: CHART.ink }}>
                        {d.title}
                      </Text>
                      <Text className="mt-0.5 text-[11.5px]" style={{ color: CHART.weekday }}>
                        {(d.submittedAt ?? d.updatedAt).slice(0, 10)}
                      </Text>
                    </View>
                    <TintBadge label={STATUS_LABEL[d.status] ?? d.status} fg={tone.fg} bg={tone.bg} />
                  </Pressable>
                );
              })}
            </View>
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatRow({
  label,
  value,
  tone,
  strong,
  divider,
  ink = CHART.ink,
}: {
  label: string;
  value: string;
  tone?: string;
  strong?: boolean;
  divider?: boolean;
  /** 값 텍스트 기본색 — 다크에서 테마 텍스트색을 넘긴다. */
  ink?: string;
}) {
  return (
    <View
      className={`flex-row items-baseline justify-between ${divider ? 'border-t pt-[9px]' : ''}`}
      style={divider ? { borderTopColor: '#f0f1f7' } : undefined}>
      <Text className="text-[12px]" style={{ color: CHART.weekday }}>
        {label}
      </Text>
      <Text className={`text-[13px] ${strong ? 'font-extrabold' : 'font-bold'}`} style={{ color: tone ?? ink }}>
        {value}
      </Text>
    </View>
  );
}

/** 틴트 배지 — 핸드오프의 상태·경고 배지(파스텔 배경 + 컬러 텍스트). */
function TintBadge({ label, fg, bg }: { label: string; fg: string; bg: string }) {
  return (
    <View className="rounded-full px-2.5 py-[3px]" style={{ backgroundColor: bg }}>
      <Text className="text-[10.5px] font-bold" style={{ color: fg }}>
        {label}
      </Text>
    </View>
  );
}

/** 세그먼트 칩 — 선택은 primary 틴트, 비선택은 회색 틴트(핸드오프 '내 신청'). */
function SegChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="rounded-full px-4 py-[7px] active:opacity-70"
      style={{ backgroundColor: on ? '#e3e6fb' : '#f3f4fa' }}>
      <Text className={`text-[12px] ${on ? 'font-bold' : 'font-semibold'}`} style={{ color: on ? '#4353e4' : '#878ea8' }}>
        {label}
      </Text>
    </Pressable>
  );
}
