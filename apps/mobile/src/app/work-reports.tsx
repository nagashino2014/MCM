import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';

import { Badge, Button, EmptyState, ScreenHeader, Sheet, SkeletonList } from '@/components/ui';
import { apiJson } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useTheme } from '@/theme/useTheme';

/**
 * 업무보고(WR-M1) — 블루프린트 docs/mobile-invoice-workreport-blueprint.md.
 *
 * 실무자 뷰: 반려된 보고(재제출 대상) + 내 진행 용역 목록 → 용역 탭 → 보고 이력 →
 * 상세(/work-report/[reportId]) 또는 새 보고 작성(/work-report-draft).
 * 부서장 피드백·임원 지시는 WR-M2/M3 — 이 화면은 서버 무변경으로 기존 라우트만 쓴다.
 * (1차는 용역(계약) 보고만 — Task 보고는 WR-M2 에서.)
 */

interface MyService {
  contractId: string;
  contractTitle: string;
  counterpartyName: string;
  serviceType: string | null;
  lastStage: string | null;
  lastPct: number | null;
  stageIndex: number | null;
  stageTotal: number | null;
  lastReportDate: string | null;
  lastReportSeq: number | null;
  completed: boolean;
}
interface ReboundReport {
  reportId: string;
  subjectLabel: string | null;
  periodStart: string;
  periodEnd: string;
  meetingLabel: string | null;
  reviewerComment: string | null;
  reviewerCommentKind: string | null;
}
interface ReportLogRow {
  reportId: string;
  periodStart: string;
  periodEnd: string;
  reportDate: string | null;
  meetingLabel: string | null;
  status: string;
  title: string | null;
  updatedAt: string;
}

const STATUS_LABEL: Record<string, string> = { draft: '작성 중', submitted: '제출됨' };

export default function WorkReportsScreen() {
  const router = useRouter();
  const { c } = useTheme();
  const services = useApi<{ services: MyService[] }>('/api/work-plan/my-services', { cache: true });
  const rebound = useApi<{ reports: ReboundReport[] }>('/api/work-plan/rebound');
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void services.reload();
      void rebound.reload();
      // 훅 반환 객체는 매 렌더 새로 만들어진다 — 의존성에서 제외.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const reloadAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([services.reload(), rebound.reload()]);
    setRefreshing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 용역 탭 → 보고 이력 시트(용역별 로그는 온디맨드 로드).
  const [logFor, setLogFor] = useState<MyService | null>(null);
  const [logRows, setLogRows] = useState<ReportLogRow[] | null>(null);
  const openLog = async (svc: MyService) => {
    setLogFor(svc);
    setLogRows(null);
    try {
      const d = await apiJson<{ reports: ReportLogRow[] }>(`/api/work-plan/service/${svc.contractId}/reports`);
      setLogRows(d.reports);
    } catch {
      setLogRows([]);
    }
  };

  const list = services.data?.services ?? [];
  const rebounds = rebound.data?.reports ?? [];

  return (
    <SafeAreaView className="flex-1 bg-cd-bg">
      <ScreenHeader title="업무보고" subtitle="용역 추진 보고 작성·확인" back variant="sub" />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingTop: 8, gap: 12, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void reloadAll()} />}>
        {/* 반려/보완 요청 — 재제출 대상 */}
        {rebounds.length > 0 ? (
          <View className="gap-2">
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
          </View>
        ) : null}

        {/* 내 진행 용역 */}
        {services.loading && !services.data ? (
          <SkeletonList count={3} />
        ) : services.error ? (
          <EmptyState
            icon="alert-circle-outline"
            title="불러오지 못했습니다"
            description={services.error}
            action={<Button label="다시 시도" variant="soft" onPress={() => void reloadAll()} />}
          />
        ) : !list.length ? (
          <EmptyState
            icon="clipboard-outline"
            title="진행 중인 용역이 없습니다"
            description="수행인력으로 지정된 용역이 여기에 표시됩니다."
          />
        ) : (
          list.map((svc) => (
            <Pressable
              key={svc.contractId}
              onPress={() => void openLog(svc)}
              className="gap-1.5 rounded-2xl border border-cd-border bg-cd-card p-3.5 active:opacity-70">
              <View className="flex-row items-center gap-2">
                <Text numberOfLines={1} className="flex-1 text-[14px] font-bold text-cd-text">
                  {svc.contractTitle}
                </Text>
                {svc.completed ? <Badge label="완료" tone="success" /> : null}
              </View>
              <Text numberOfLines={1} className="text-[11.5px] text-cd-faint">
                {[svc.counterpartyName, svc.serviceType].filter(Boolean).join(' · ')}
              </Text>
              <View className="mt-0.5 flex-row items-center gap-2">
                {svc.lastStage ? (
                  <Badge
                    label={`${svc.lastStage}${svc.lastPct != null ? ` ${svc.lastPct}%` : ''}`}
                    tone="primary"
                  />
                ) : (
                  <Badge label="보고 전" tone="neutral" />
                )}
                <Text className="flex-1 text-[11px] text-cd-faint">
                  {svc.lastReportDate
                    ? `마지막 보고 ${svc.lastReportDate.slice(0, 10)}${svc.lastReportSeq ? ` (${svc.lastReportSeq}차)` : ''}`
                    : '아직 보고가 없습니다'}
                </Text>
                <Ionicons name="chevron-forward" size={14} color={c.faint} />
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>

      {/* 보고 이력 시트 */}
      <Sheet
        visible={!!logFor}
        onClose={() => setLogFor(null)}
        title={logFor?.contractTitle ?? '보고 이력'}
        footer={
          <View className="flex-1">
            <Button
              label="새 보고 작성"
              icon="create-outline"
              onPress={() => {
                const svc = logFor;
                setLogFor(null);
                if (svc) {
                  router.push({
                    pathname: '/work-report-draft',
                    params: { contractId: svc.contractId, contractTitle: svc.contractTitle },
                  });
                }
              }}
              full
            />
          </View>
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
                    setLogFor(null);
                    router.push({ pathname: '/work-report/[reportId]', params: { reportId: r.reportId } });
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
