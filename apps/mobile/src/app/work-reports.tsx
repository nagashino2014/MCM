import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';

import {
  Badge,
  Button,
  EmptyState,
  ScreenHeader,
  SegmentedTabs,
  Sheet,
  SkeletonList,
  type SegmentItem,
} from '@/components/ui';
import { apiJson } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useTheme } from '@/theme/useTheme';

/**
 * 업무보고(WR-M1·M2) — 블루프린트 docs/mobile-invoice-workreport-blueprint.md.
 *
 * 내 업무 탭(실무자): 반려된 보고(재제출 대상) + 내 진행 용역·Task → 보고 이력 → 상세/작성.
 * 부서 검토 탭(부서장, WR-M2): 부서 용역·Task 의 보고를 열어 의견·보완요구·반려·확인 처리.
 * 임원 검토 탭(WR-M3): exec-cards(통합완료/지시됨/재보고) → 상세(?exec=1)에서 지시 하달.
 *   부서는 review-context 규칙 그대로 — 관리자만 부서 선택, 그 외는 본인 부서 고정.
 *   탭 노출은 웹 메뉴와 같은 개방 정책 — 하달 권한(work_plan.directive)은 서버가 가드한다.
 * 합본(머징)·임원 보고 발표는 웹 감독 화면 전용. 서버 무변경 — 기존 라우트만 쓴다.
 */

type SubjectKind = 'contract' | 'task';

interface SubjectCard {
  kind: SubjectKind;
  id: string;
  title: string;
  subtitle: string | null;
  lastStage: string | null;
  lastPct: number | null;
  lastReportDate: string | null;
  lastReportSeq: number | null;
  completed: boolean;
}
interface MyService {
  contractId: string;
  contractTitle: string;
  counterpartyName: string;
  serviceType: string | null;
  lastStage: string | null;
  lastPct: number | null;
  lastReportDate: string | null;
  lastReportSeq: number | null;
  completed: boolean;
}
interface MyTask {
  taskId: string;
  taskName: string;
  categoryName: string | null;
  lastStage: string | null;
  lastPct: number | null;
  lastReportDate: string | null;
  lastReportSeq: number | null;
  completed: boolean;
}
interface ReboundReport {
  reportId: string;
  subjectLabel: string | null;
  reviewerComment: string | null;
}
interface ReportLogRow {
  reportId: string;
  periodStart: string;
  periodEnd: string;
  reportDate: string | null;
  meetingLabel: string | null;
  status: string;
  title: string | null;
}
interface ExecCard {
  reportId: string;
  subjectKind: SubjectKind;
  subjectLabel: string | null;
  subtitle: string | null;
  subjectDate: string | null;
  progressStage: string | null;
  progressPct: number | null;
  summaryText: string | null;
  meetingLabel: string | null;
  meetingSeq: number | null;
  execStatus: string | null;
  directorResponse: string | null;
}
interface ReviewContext {
  isAdmin: boolean;
  deptId: string | null;
  deptName: string | null;
  departments?: { deptId: string; deptName: string }[];
}

type Tab = 'mine' | 'dept' | 'exec';
type ExecFilter = 'merged' | 'directed' | 're_reported';
const EXEC_FILTERS: { key: ExecFilter; label: string }[] = [
  { key: 'merged', label: '통합완료' },
  { key: 'directed', label: '지시됨' },
  { key: 're_reported', label: '재보고' },
];

const STATUS_LABEL: Record<string, string> = { draft: '작성 중', submitted: '제출됨' };

const svcToCard = (s: MyService): SubjectCard => ({
  kind: 'contract',
  id: s.contractId,
  title: s.contractTitle,
  subtitle: [s.counterpartyName, s.serviceType].filter(Boolean).join(' · ') || null,
  lastStage: s.lastStage,
  lastPct: s.lastPct,
  lastReportDate: s.lastReportDate,
  lastReportSeq: s.lastReportSeq,
  completed: s.completed,
});
const taskToCard = (t: MyTask): SubjectCard => ({
  kind: 'task',
  id: t.taskId,
  title: t.taskName,
  subtitle: t.categoryName,
  lastStage: t.lastStage,
  lastPct: t.lastPct,
  lastReportDate: t.lastReportDate,
  lastReportSeq: t.lastReportSeq,
  completed: t.completed,
});

export default function WorkReportsScreen() {
  const router = useRouter();
  const { c } = useTheme();
  const [tab, setTab] = useState<Tab>('mine');

  // 내 업무(실무자)
  const services = useApi<{ services: MyService[] }>('/api/work-plan/my-services', { cache: true });
  const tasks = useApi<{ tasks: MyTask[] }>('/api/work-plan/my-tasks', { cache: true });
  const rebound = useApi<{ reports: ReboundReport[] }>('/api/work-plan/rebound');

  // 부서 검토(WR-M2) — 컨텍스트는 1회 로드, 부서 목록은 dept 파라미터로.
  const reviewCtx = useApi<ReviewContext>('/api/work-plan/review-context', { cache: true });
  const [deptSel, setDeptSel] = useState<string | null>(null); // 관리자 부서 선택(비관리자는 서버가 강제)
  const deptId = deptSel ?? reviewCtx.data?.deptId ?? reviewCtx.data?.departments?.[0]?.deptId ?? null;
  const deptQ = deptId ? `?dept=${encodeURIComponent(deptId)}` : '';
  const deptServices = useApi<{ services: MyService[] }>(`/api/work-plan/dept-services${deptQ}`, {
    skip: tab !== 'dept' || !deptId,
  });
  const deptTasks = useApi<{ tasks: MyTask[] }>(`/api/work-plan/dept-tasks${deptQ}`, {
    skip: tab !== 'dept' || !deptId,
  });

  // 임원 검토(WR-M3) — 필터별 카드. 부서는 부서 검토와 같은 선택을 공유한다.
  const [execFilter, setExecFilter] = useState<ExecFilter>('merged');
  const execCards = useApi<{ cards: ExecCard[] }>(
    `/api/work-plan/exec-cards?filter=${execFilter}${deptId ? `&dept=${encodeURIComponent(deptId)}` : ''}`,
    { skip: tab !== 'exec' || !deptId }
  );

  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void services.reload();
      void tasks.reload();
      void rebound.reload();
      // 훅 반환 객체는 매 렌더 새로 만들어진다 — 의존성에서 제외.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const reloadAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      services.reload(),
      tasks.reload(),
      rebound.reload(),
      ...(tab === 'dept' ? [deptServices.reload(), deptTasks.reload()] : []),
      ...(tab === 'exec' ? [execCards.reload()] : []),
    ]);
    setRefreshing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // 대상 탭 → 보고 이력 시트(용역/Task 공용, 온디맨드 로드). review = 부서 검토 진입 여부.
  const [logFor, setLogFor] = useState<{ card: SubjectCard; review: boolean } | null>(null);
  const [logRows, setLogRows] = useState<ReportLogRow[] | null>(null);
  const openLog = async (card: SubjectCard, review: boolean) => {
    setLogFor({ card, review });
    setLogRows(null);
    const path =
      card.kind === 'task' ? `/api/work-tasks/${card.id}/reports` : `/api/work-plan/service/${card.id}/reports`;
    try {
      const d = await apiJson<{ reports: ReportLogRow[] }>(path);
      setLogRows(d.reports);
    } catch {
      setLogRows([]);
    }
  };

  const myCards = [
    ...(services.data?.services ?? []).map(svcToCard),
    ...(tasks.data?.tasks ?? []).map(taskToCard),
  ];
  const deptCards = [
    ...(deptServices.data?.services ?? []).map(svcToCard),
    ...(deptTasks.data?.tasks ?? []).map(taskToCard),
  ];
  const rebounds = rebound.data?.reports ?? [];
  const myLoading = (services.loading && !services.data) || (tasks.loading && !tasks.data);
  const deptLoading = (deptServices.loading && !deptServices.data) || (deptTasks.loading && !deptTasks.data);

  const tabs: SegmentItem<Tab>[] = [
    { key: 'mine', label: '내 업무' },
    { key: 'dept', label: '부서 검토' },
    { key: 'exec', label: '임원 검토' },
  ];

  const renderCard = (card: SubjectCard, review: boolean) => (
    <Pressable
      key={`${card.kind}:${card.id}`}
      onPress={() => void openLog(card, review)}
      className="gap-1.5 rounded-2xl border border-cd-border bg-cd-card p-3.5 active:opacity-70">
      <View className="flex-row items-center gap-2">
        <Badge label={card.kind === 'task' ? 'Task' : '용역'} tone={card.kind === 'task' ? 'secondary' : 'primary'} />
        <Text numberOfLines={1} className="flex-1 text-[14px] font-bold text-cd-text">
          {card.title}
        </Text>
        {card.completed ? <Badge label="완료" tone="success" /> : null}
      </View>
      {card.subtitle ? (
        <Text numberOfLines={1} className="text-[11.5px] text-cd-faint">
          {card.subtitle}
        </Text>
      ) : null}
      <View className="mt-0.5 flex-row items-center gap-2">
        {card.lastStage ? (
          <Badge label={`${card.lastStage}${card.lastPct != null ? ` ${card.lastPct}%` : ''}`} tone="primary" />
        ) : (
          <Badge label="보고 전" tone="neutral" />
        )}
        <Text className="flex-1 text-[11px] text-cd-faint">
          {card.lastReportDate
            ? `마지막 보고 ${card.lastReportDate.slice(0, 10)}${card.lastReportSeq ? ` (${card.lastReportSeq}차)` : ''}`
            : '아직 보고가 없습니다'}
        </Text>
        <Ionicons name="chevron-forward" size={14} color={c.faint} />
      </View>
    </Pressable>
  );

  return (
    <SafeAreaView className="flex-1 bg-cd-bg">
      <ScreenHeader title="업무보고" subtitle="용역·Task 추진 보고" back variant="sub" />
      <SegmentedTabs items={tabs} value={tab} onChange={setTab} />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingTop: 8, gap: 12, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void reloadAll()} />}>
        {tab === 'mine' ? (
          <>
            {/* 반려/보완 요청 — 재제출 대상 */}
            {rebounds.map((r) => (
              <Pressable
                key={r.reportId}
                onPress={() => router.push({ pathname: '/work-report/[reportId]', params: { reportId: r.reportId } })}
                className="gap-1 rounded-2xl border p-3.5 active:opacity-70"
                style={{ backgroundColor: '#fffaf0', borderColor: '#f5e3c0' }}>
                <View className="flex-row items-center gap-1.5">
                  <Ionicons name="alert-circle" size={15} color="#b47700" />
                  <Text numberOfLines={1} className="flex-1 text-[13px] font-bold" style={{ color: '#4a3a12' }}>
                    {r.subjectLabel ?? '보고'} — 보완·재제출이 필요합니다
                  </Text>
                </View>
                {r.reviewerComment ? (
                  <Text numberOfLines={2} className="text-[12px]" style={{ color: '#8d7c50' }}>
                    {r.reviewerComment}
                  </Text>
                ) : null}
              </Pressable>
            ))}

            {myLoading ? (
              <SkeletonList count={3} />
            ) : services.error ? (
              <EmptyState
                icon="alert-circle-outline"
                title="불러오지 못했습니다"
                description={services.error}
                action={<Button label="다시 시도" variant="soft" onPress={() => void reloadAll()} />}
              />
            ) : !myCards.length ? (
              <EmptyState
                icon="clipboard-outline"
                title="진행 중인 업무가 없습니다"
                description="수행인력으로 지정된 용역·Task가 여기에 표시됩니다."
              />
            ) : (
              myCards.map((card) => renderCard(card, false))
            )}
          </>
        ) : (
          <>
            {/* 부서 검토(WR-M2) — 관리자만 부서 선택 노출 */}
            {reviewCtx.data?.isAdmin && reviewCtx.data.departments?.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8 }}>
                {reviewCtx.data.departments.map((d) => (
                  <Pressable
                    key={d.deptId}
                    onPress={() => setDeptSel(d.deptId)}
                    className={`min-h-[34px] justify-center rounded-full border px-3.5 active:opacity-70 ${
                      d.deptId === deptId ? 'border-cd-primary bg-cd-primary-soft' : 'border-cd-border bg-cd-card'
                    }`}>
                    <Text className={`text-[13px] font-bold ${d.deptId === deptId ? 'text-cd-primary' : 'text-cd-muted'}`}>
                      {d.deptName}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : reviewCtx.data?.deptName ? (
              <Text className="px-1 text-[12px] text-cd-faint">{reviewCtx.data.deptName} 소속 보고를 검토합니다.</Text>
            ) : null}

            {!deptId ? (
              <EmptyState icon="git-network-outline" title="검토할 부서가 없습니다" description="소속 부서 정보가 필요합니다." />
            ) : deptLoading ? (
              <SkeletonList count={3} />
            ) : !deptCards.length ? (
              <EmptyState icon="clipboard-outline" title="부서에 진행 중인 업무가 없습니다" />
            ) : (
              deptCards.map((card) => renderCard(card, true))
            )}
          </>
        )}

        {/* 임원 검토(WR-M3) — 필터별 exec 카드 → 상세(?exec=1)에서 지시 하달 */}
        {tab === 'exec' ? (
          <>
            <View className="flex-row gap-2">
              {EXEC_FILTERS.map((f) => (
                <Pressable
                  key={f.key}
                  onPress={() => setExecFilter(f.key)}
                  className={`rounded-full border px-3.5 py-2 active:opacity-70 ${
                    execFilter === f.key ? 'border-cd-primary bg-cd-primary-soft' : 'border-cd-border bg-cd-card'
                  }`}>
                  <Text className={`text-[12.5px] font-bold ${execFilter === f.key ? 'text-cd-primary' : 'text-cd-muted'}`}>
                    {f.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            {!deptId ? (
              <EmptyState icon="git-network-outline" title="부서 정보가 없습니다" />
            ) : execCards.loading && !execCards.data ? (
              <SkeletonList count={3} />
            ) : !(execCards.data?.cards ?? []).length ? (
              <EmptyState
                icon="ribbon-outline"
                title={
                  execFilter === 'merged'
                    ? '검토 대기(통합완료) 보고가 없습니다'
                    : execFilter === 'directed'
                      ? '지시 하달된 보고가 없습니다'
                      : '재보고된 보고가 없습니다'
                }
              />
            ) : (
              (execCards.data?.cards ?? []).map((card) => (
                <Pressable
                  key={card.reportId}
                  onPress={() =>
                    router.push({ pathname: '/work-report/[reportId]', params: { reportId: card.reportId, exec: '1' } })
                  }
                  className="gap-1.5 rounded-2xl border border-cd-border bg-cd-card p-3.5 active:opacity-70">
                  <View className="flex-row items-center gap-2">
                    <Badge label={card.subjectKind === 'task' ? 'Task' : '용역'} tone={card.subjectKind === 'task' ? 'secondary' : 'primary'} />
                    <Text numberOfLines={1} className="flex-1 text-[14px] font-bold text-cd-text">
                      {card.subjectLabel ?? '보고'}
                    </Text>
                    {card.execStatus === 'directed' ? <Badge label="지시됨" tone="warning" /> : null}
                    {card.execStatus === 're_reported' ? <Badge label="재보고" tone="success" /> : null}
                  </View>
                  <Text numberOfLines={1} className="text-[11.5px] text-cd-faint">
                    {[card.subtitle, card.meetingLabel, card.meetingSeq ? `${card.meetingSeq}차` : null, card.subjectDate?.slice(0, 10)]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  {card.progressStage ? (
                    <View className="flex-row">
                      <Badge
                        label={`${card.progressStage}${card.progressPct != null ? ` ${card.progressPct}%` : ''}`}
                        tone="primary"
                      />
                    </View>
                  ) : null}
                  {card.summaryText ? (
                    <Text numberOfLines={2} className="text-[12px] leading-4 text-cd-muted">
                      {card.summaryText}
                    </Text>
                  ) : null}
                </Pressable>
              ))
            )}
          </>
        ) : null}
      </ScrollView>

      {/* 보고 이력 시트 — 실무자 진입에서만 [새 보고 작성] 노출 */}
      <Sheet
        visible={!!logFor}
        onClose={() => setLogFor(null)}
        title={logFor?.card.title ?? '보고 이력'}
        footer={
          logFor && !logFor.review ? (
            <View className="flex-1">
              <Button
                label="새 보고 작성"
                icon="create-outline"
                onPress={() => {
                  const f = logFor;
                  setLogFor(null);
                  if (f) {
                    router.push({
                      pathname: '/work-report-draft',
                      params: { subjectKind: f.card.kind, subjectId: f.card.id, subjectTitle: f.card.title },
                    });
                  }
                }}
                full
              />
            </View>
          ) : undefined
        }>
        <ScrollView style={{ maxHeight: 420, flexShrink: 1 }}>
          {logRows == null ? (
            <SkeletonList count={2} />
          ) : logRows.length === 0 ? (
            <Text className="py-6 text-center text-[13px] text-cd-faint">아직 작성된 보고가 없습니다.</Text>
          ) : (
            <View className="gap-1 pb-2">
              {logRows.map((r) => (
                <Pressable
                  key={r.reportId}
                  onPress={() => {
                    const f = logFor;
                    setLogFor(null);
                    router.push({
                      pathname: '/work-report/[reportId]',
                      params: { reportId: r.reportId, ...(f?.review ? { review: '1' } : {}) },
                    });
                  }}
                  className="flex-row items-center gap-2 rounded-xl px-2 py-2.5 active:opacity-60">
                  <View className="flex-1">
                    <Text numberOfLines={1} className="text-[13.5px] font-semibold text-cd-text">
                      {r.title || `${r.periodStart.slice(5)} ~ ${r.periodEnd.slice(5)} 보고`}
                    </Text>
                    <Text className="mt-[1px] text-[11px] text-cd-faint">
                      {[r.meetingLabel, r.reportDate?.slice(0, 10) ?? r.periodEnd.slice(0, 10)]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                  <Badge
                    label={STATUS_LABEL[r.status] ?? r.status}
                    tone={r.status === 'submitted' ? 'success' : 'neutral'}
                  />
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      </Sheet>
    </SafeAreaView>
  );
}
