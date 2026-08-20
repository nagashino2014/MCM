import { useCallback, useMemo, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import {
  Badge,
  Card,
  EmptyState,
  GradientButton,
  GradientIconButton,
  OutlineButton,
  ScreenHeader,
  Sheet,
  SkeletonList,
  Textarea,
  useToast,
} from '@/components/ui';
import { MonthCalendar, type CalendarBar } from '@/components/calendar/MonthCalendar';
import { NewProjectSheet } from '@/components/sales/NewProjectSheet';
import { NewActivitySheet } from '@/components/sales/NewActivitySheet';
import { apiJson } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/theme/useTheme';
import {
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_META,
  type MonthActivity,
  type PendingReport,
} from '@/lib/sales/types';

/**
 * 영업 — 데스크탑 SalesBoard·SalesCalendar 의 모바일 대응(P5).
 *
 * 신규 영업건·일정 등록 → 월 캘린더(활동 유형별 색) → 경과 미입력(전 기간, 상단 고정)
 * → 이 달 스케줄 타임라인. 일정 탭 → 상세 시트(연락처 전화/문자) → [경과 입력].
 *
 * 경과 입력은 전용 경량 API(PUT /api/sales/activities/{id}/progress)만 쓴다 —
 * 활동 본 PUT 은 전체 교체라 부분 갱신에 쓰면 다른 필드가 소실된다(서버 주석의 함정).
 * 등록 버튼은 sales.edit 근사인 admin·editor 에게만 보인다(데스크탑 canEdit 과 같은 판정).
 */

const monthKey = (y: number, m0: number) => `${y}-${String(m0 + 1).padStart(2, '0')}`;
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

export default function SalesScreen() {
  const { c } = useTheme();
  const { user } = useAuth();
  const toast = useToast();
  const canEdit = user?.role === 'admin' || user?.role === 'editor';

  const now = useMemo(() => new Date(), []);
  const [cur, setCur] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const month = monthKey(cur.y, cur.m);

  const sched = useApi<{ activities: MonthActivity[] }>(`/api/sales/schedule?month=${month}`, { cache: true });
  const pending = useApi<{ reports: PendingReport[] }>('/api/sales/pending-reports', { cache: true });
  const activities = sched.data?.activities ?? [];
  const reports = pending.data?.reports ?? [];
  const pendingCount = reports.reduce((n, r) => n + (r.activities?.length ?? 0), 0);

  const [newProject, setNewProject] = useState(false);
  const [newActivity, setNewActivity] = useState(false);
  const [detail, setDetail] = useState<MonthActivity | null>(null);
  const [progressFor, setProgressFor] = useState<{ activityId: string; title: string } | null>(null);

  const [refreshing, setRefreshing] = useState(false);
  const reloadAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([sched.reload(), pending.reload()]);
    setRefreshing(false);
    // 훅 반환 객체는 매 렌더 새로 만들어진다 — 의존성에서 제외.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bars: CalendarBar[] = useMemo(
    () =>
      activities.map((a) => {
        const meta = ACTIVITY_TYPE_META[a.activityType];
        return {
          id: a.activityId,
          startDate: a.scheduledAt.slice(0, 10),
          endDate: (a.endedAt ?? a.scheduledAt).slice(0, 10),
          title: a.facilityName ?? a.projectTitle,
          color: meta.color,
          ink: meta.ink,
        };
      }),
    [activities]
  );

  /** 이 달 타임라인 — 날짜별 그룹(오름차순). */
  const grouped = useMemo(() => {
    const map = new Map<string, MonthActivity[]>();
    for (const a of activities) {
      const day = a.scheduledAt.slice(0, 10);
      const arr = map.get(day) ?? [];
      arr.push(a);
      map.set(day, arr);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, list]) => ({
        day,
        list: list.sort((x, y) => x.scheduledAt.localeCompare(y.scheduledAt)),
      }));
  }, [activities]);

  const today = todayIso();
  const dayLabel = (iso: string) => {
    const d = new Date(`${iso}T12:00:00`);
    return `${d.getMonth() + 1}/${d.getDate()} (${DOW[d.getDay()]})`;
  };

  /** 상세 시트의 경과 입력 노출 — 기간이 경과한 일정만(데스크탑 showProgress 와 같은 규칙). */
  const detailEnded = detail ? (detail.endedAt ?? detail.scheduledAt).slice(0, 16) < new Date().toISOString().slice(0, 16) : false;

  const call = (phone: string) => Linking.openURL(`tel:${phone.replace(/[^0-9+]/g, '')}`).catch(() => {});
  const sms = (phone: string) => Linking.openURL(`sms:${phone.replace(/[^0-9+]/g, '')}`).catch(() => {});

  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: c.bg }} className="flex-1 bg-cd-bg">
      <ScreenHeader title="영업" subtitle={`${cur.y}년 ${cur.m + 1}월`} back variant="sub" />
      <ScrollView
        contentContainerStyle={{ padding: 18, paddingTop: 0, gap: 14, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reloadAll} tintColor={c.faint} />}>
        {canEdit ? (
          <View className="flex-row gap-2">
            <View className="flex-1">
              <GradientButton label="신규 영업건" icon="add" onPress={() => setNewProject(true)} />
            </View>
            <View className="flex-1">
              <OutlineButton label="일정 등록" icon="calendar-outline" onPress={() => setNewActivity(true)} />
            </View>
          </View>
        ) : null}

        {/* 유형 범례 — 캘린더 필 색의 의미(2글자 태그) */}
        <View className="flex-row flex-wrap justify-end gap-x-[10px] gap-y-[5px]">
          {ACTIVITY_TYPES.map((t) => (
            <View key={t.code} className="flex-row items-center gap-[4px]">
              <View style={{ backgroundColor: t.color }} className="h-[7px] w-[7px] rounded-full" />
              <Text className="text-[10.5px] font-semibold" style={{ color: '#9aa0b8' }}>
                {t.short}
              </Text>
            </View>
          ))}
        </View>

        <MonthCalendar
          events={bars}
          year={cur.y}
          month0={cur.m}
          onMonthChange={(y, m) => setCur({ y, m })}
          onEventPress={(bar) => setDetail(activities.find((a) => a.activityId === bar.id) ?? null)}
        />

        {/* 경과 미입력 — 전 기간, 상단 고정(홈 KPI 와 같은 소스) */}
        {pendingCount > 0 ? (
          <Card title="경과 미입력" badge={<Badge label={`${pendingCount}`} tone="warning" />}>
            <View className="mt-2 gap-2">
              {reports.map((r) =>
                (r.activities ?? []).map((a) => {
                  const meta = ACTIVITY_TYPE_META[a.activityType];
                  return (
                    <Pressable
                      key={a.activityId}
                      onPress={() =>
                        canEdit
                          ? setProgressFor({ activityId: a.activityId, title: `${r.facilityName ?? r.title} · ${meta.label}` })
                          : undefined
                      }
                      className="flex-row items-center gap-3 rounded-xl border p-3 active:opacity-70"
                      style={{ backgroundColor: '#fffaf0', borderColor: '#f5e3c0' }}>
                      <TypeTag short={meta.short} color={meta.color} ink={meta.ink} />
                      <View className="flex-1">
                        {/* 카드 배경이 테마 무관 크림색이라 글자색도 고정 잉크로(다크에서 밝은 토큰색이 묻힘). */}
                        <Text numberOfLines={1} className="text-[13px] font-semibold" style={{ color: '#4a3a12' }}>
                          {r.title}
                        </Text>
                        <Text numberOfLines={1} className="mt-0.5 text-[11.5px]" style={{ color: '#8d7c50' }}>
                          {[r.facilityName, (a.endedAt ?? a.scheduledAt)?.slice(0, 10)].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                      {canEdit ? (
                        <Text className="text-[12px] font-bold" style={{ color: '#b47700' }}>
                          경과 입력
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })
              )}
            </View>
          </Card>
        ) : null}

        {/* 이 달 스케줄 타임라인 */}
        {sched.loading && !activities.length ? (
          <SkeletonList count={3} />
        ) : !grouped.length ? (
          <EmptyState icon="briefcase-outline" title="이 달에 등록된 영업 일정이 없습니다" />
        ) : (
          <Card title="스케줄">
            <View className="mt-1">
              {grouped.map(({ day, list }) => (
                <View key={day}>
                  <View className="mt-2.5 flex-row items-center gap-2">
                    <Text
                      className={`text-[11.5px] ${day === today ? 'font-extrabold' : 'font-bold'}`}
                      style={{ color: day === today ? '#4353e4' : '#9aa0b8' }}>
                      {day === today ? `오늘 · ${dayLabel(day)}` : dayLabel(day)}
                    </Text>
                    <View className="h-px flex-1" style={{ backgroundColor: '#f0f1f7' }} />
                  </View>
                  {list.map((a) => {
                    const meta = ACTIVITY_TYPE_META[a.activityType];
                    return (
                      <Pressable
                        key={a.activityId}
                        onPress={() => setDetail(a)}
                        className="flex-row items-center gap-3 py-2.5 active:opacity-70">
                        <Text className="w-[42px] text-[12px] font-bold tabular-nums" style={{ color: '#565e82' }}>
                          {a.scheduledAt.slice(11, 16) || '--:--'}
                        </Text>
                        <TypeTag short={meta.short} color={meta.color} ink={meta.ink} />
                        <View className="flex-1">
                          <Text numberOfLines={1} className="text-[13px] font-semibold text-cd-text">
                            {a.facilityName ?? a.projectTitle}
                          </Text>
                          <Text numberOfLines={1} className="mt-0.5 text-[11.5px] text-cd-faint">
                            {a.summary ?? a.projectTitle}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={14} color={c.faint} />
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
          </Card>
        )}
      </ScrollView>

      {/* 일정 상세 */}
      <Sheet visible={!!detail && !progressFor} onClose={() => setDetail(null)} title={detail?.projectTitle ?? '영업 일정'}>
        {detail ? (
          <View className="gap-3">
            <View className="flex-row items-center gap-2">
              <TypeTag
                short={ACTIVITY_TYPE_META[detail.activityType].label}
                color={ACTIVITY_TYPE_META[detail.activityType].color}
                ink={ACTIVITY_TYPE_META[detail.activityType].ink}
                wide
              />
              <Text className="text-[13px] text-cd-body">
                {detail.scheduledAt.slice(0, 16).replace('T', ' ')}
                {detail.endedAt ? ` ~ ${detail.endedAt.slice(0, 16).replace('T', ' ')}` : ''}
              </Text>
            </View>
            {detail.facilityName ? (
              <InfoRow label="사업장" value={detail.facilityName} />
            ) : null}
            {detail.summary ? <InfoRow label="업무상세" value={detail.summary} /> : null}
            {detail.contacts?.length ? (
              <View className="gap-1.5">
                <Text className="text-[12px] font-bold text-cd-faint">사업장 담당자</Text>
                {detail.contacts.map((p) => {
                  const phone = p.mobilePhone || p.officePhone;
                  return (
                    <View
                      key={p.id}
                      className="flex-row items-center gap-2 rounded-xl border p-3"
                      style={{ backgroundColor: '#fbfbfe', borderColor: '#eef0f7' }}>
                      <View className="flex-1">
                        <Text className="text-[13.5px] font-semibold text-cd-text">
                          {p.personName ?? '담당자'}
                          {p.title ? ` ${p.title}` : ''}
                        </Text>
                        {p.departmentName || phone ? (
                          <Text className="mt-0.5 text-[11.5px] text-cd-faint">
                            {[p.departmentName, phone].filter(Boolean).join(' · ')}
                          </Text>
                        ) : null}
                      </View>
                      {phone ? (
                        <>
                          <RoundAction icon="call" onPress={() => call(phone)} />
                          {p.mobilePhone ? <RoundAction icon="chatbubble-ellipses" onPress={() => sms(p.mobilePhone!)} /> : null}
                        </>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ) : null}
            {canEdit && detailEnded ? (
              <GradientButton
                label="경과 입력"
                icon="create-outline"
                onPress={() => {
                  const a = detail;
                  setProgressFor({
                    activityId: a.activityId,
                    title: `${a.facilityName ?? a.projectTitle} · ${ACTIVITY_TYPE_META[a.activityType].label}`,
                  });
                }}
              />
            ) : null}
          </View>
        ) : null}
      </Sheet>

      <ProgressSheet
        target={progressFor}
        onClose={() => setProgressFor(null)}
        onSaved={() => {
          setProgressFor(null);
          setDetail(null);
          void reloadAll();
          toast.show('경과를 저장했습니다.', 'success');
        }}
      />

      <NewProjectSheet visible={newProject} onClose={() => setNewProject(false)} onCreated={() => void reloadAll()} />
      <NewActivitySheet visible={newActivity} onClose={() => setNewActivity(false)} onCreated={() => void reloadAll()} />
    </SafeAreaView>
  );
}

/** 경과 입력 시트 — 전용 경량 API 로 progress_note 만 갱신(활동은 done 처리된다). */
function ProgressSheet({
  target,
  onClose,
  onSaved,
}: {
  target: { activityId: string; title: string } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!target || !note.trim()) {
      toast.show('경과 내용을 입력하세요.', 'error');
      return;
    }
    setSaving(true);
    try {
      await apiJson(`/api/sales/activities/${target.activityId}/progress`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ progressNote: note.trim() }),
      });
      setNote('');
      onSaved();
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      visible={!!target}
      onClose={onClose}
      title="경과 입력"
      footer={<View className="flex-1"><GradientButton label="저장" loading={saving} onPress={submit} /></View>}>
      <View className="gap-3">
        {target ? (
          <Text numberOfLines={2} className="text-[13px] font-semibold text-cd-muted">
            {target.title}
          </Text>
        ) : null}
        <Textarea
          minHeight={96}
          maxLength={200}
          value={note}
          onChangeText={setNote}
          placeholder="진행상황·결과 (200자 이내)"
          autoFocus
        />
      </View>
    </Sheet>
  );
}

/** 활동 유형 태그 — 파스텔 배경 + 잉크 텍스트(캘린더 필과 같은 색 문법). */
function TypeTag({ short, color, ink, wide }: { short: string; color: string; ink: string; wide?: boolean }) {
  return (
    <View className={`rounded-md ${wide ? 'px-2.5' : 'px-1.5'} py-[3px]`} style={{ backgroundColor: color }}>
      <Text className="text-[10.5px] font-bold" style={{ color: ink }}>
        {short}
      </Text>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="gap-1">
      <Text className="text-[12px] font-bold text-cd-faint">{label}</Text>
      <Text className="text-[14px] leading-5 text-cd-text">{value}</Text>
    </View>
  );
}

/** 연락처 행 우측 원형 액션(전화·문자) — 앱 공통 CTA 그라데이션. */
function RoundAction({ icon, onPress }: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
  return <GradientIconButton icon={icon} onPress={onPress} />;
}
