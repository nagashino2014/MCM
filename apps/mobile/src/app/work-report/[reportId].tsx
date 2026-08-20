import { useCallback } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { Badge, Button, Card, EmptyState, ScreenHeader, SkeletonList } from '@/components/ui';
import { useApi } from '@/lib/use-api';
import { useTheme } from '@/theme/useTheme';

/**
 * 업무보고 상세(WR-M1) — 열람 + 실무자 수정·재제출 진입.
 * 부서장 피드백·임원 지시 "액션"은 WR-M2/M3 — 여기서는 남긴 의견·지시를 보여 주기만 한다.
 */

interface StageRow {
  rowId: string;
  stageOrder: number;
  stageName: string;
  status: 'pending' | 'in_progress' | 'done';
  progressPct?: number | null;
}
interface ReportDetail {
  reportId: string;
  subjectKind: 'contract' | 'task';
  contractId: string | null;
  taskId: string | null;
  deptName: string | null;
  authorName: string | null;
  periodStart: string;
  periodEnd: string;
  reportDate: string | null;
  meetingLabel: string | null;
  meetingSeq: number | null;
  status: string;
  title: string | null;
  progressText: string | null;
  planText: string | null;
  reviewerComment: string | null;
  reviewerCommentKind: string | null;
  reviewStatus: string | null;
  execDirective: { kind: string; message: string | null } | null;
  currentStageName: string | null;
  currentStagePct: number | null;
  stages: StageRow[];
}

const COMMENT_KIND_LABEL: Record<string, string> = {
  amend: '첨삭',
  supplement: '보완 요청',
  correction: '반려(정정)',
};
const STAGE_STATUS: Record<string, string> = { pending: '예정', in_progress: '진행', done: '완료' };

export default function WorkReportDetailScreen() {
  const router = useRouter();
  const { c } = useTheme();
  const { reportId } = useLocalSearchParams<{ reportId: string }>();
  const { data, loading, refreshing, error, reload } = useApi<{ report: ReportDetail }>(
    `/api/work-plan/report/${reportId}`
  );

  useFocusEffect(
    useCallback(() => {
      void reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const r = data?.report;
  // 수정·재제출 진입 조건 — 작성 중이거나 반려/보완 상태의 계약 보고(권한 검증은 서버 몫).
  const editable = !!r && r.subjectKind === 'contract' && (r.status === 'draft' || r.reviewStatus === 'rejected');

  return (
    <SafeAreaView className="flex-1 bg-cd-bg">
      <ScreenHeader title="업무보고" subtitle={r?.title || `${r?.periodStart ?? ''} ~ ${r?.periodEnd ?? ''}`} back variant="sub" />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingTop: 8, gap: 12, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void reload()} />}>
        {loading && !r ? (
          <SkeletonList count={3} />
        ) : !r ? (
          <EmptyState icon="document-outline" title="보고를 찾을 수 없습니다" description={error ?? undefined} />
        ) : (
          <>
            {/* 머리 정보 */}
            <View className="gap-1.5 rounded-2xl border border-cd-border bg-cd-card p-3.5">
              <View className="flex-row items-center gap-2">
                <Text className="flex-1 text-[12.5px] text-cd-muted">
                  {[r.meetingLabel, r.meetingSeq ? `${r.meetingSeq}차` : null, r.deptName].filter(Boolean).join(' · ')}
                </Text>
                <Badge
                  label={r.status === 'submitted' ? '제출됨' : '작성 중'}
                  tone={r.status === 'submitted' ? 'success' : 'neutral'}
                />
                {r.reviewStatus === 'rejected' ? <Badge label="보완 요청" tone="warning" /> : null}
              </View>
              <Text className="text-[12.5px] text-cd-muted">
                기간 {r.periodStart} ~ {r.periodEnd}
                {r.authorName ? ` · 작성 ${r.authorName}` : ''}
              </Text>
              {r.currentStageName ? (
                <Badge label={`현재 공정 ${r.currentStageName}${r.currentStagePct != null ? ` ${r.currentStagePct}%` : ''}`} tone="primary" />
              ) : null}
            </View>

            {/* 부서장 의견 / 임원 지시 — 있으면 본문보다 먼저 보여 준다(재제출 판단 근거) */}
            {r.reviewerComment ? (
              <View className="gap-1 rounded-2xl border p-3.5" style={{ backgroundColor: '#fffaf0', borderColor: '#f5e3c0' }}>
                <View className="flex-row items-center gap-1.5">
                  <Ionicons name="chatbubble-ellipses" size={14} color="#b47700" />
                  <Text className="text-[12.5px] font-bold" style={{ color: '#4a3a12' }}>
                    부서장 의견{r.reviewerCommentKind ? ` — ${COMMENT_KIND_LABEL[r.reviewerCommentKind] ?? r.reviewerCommentKind}` : ''}
                  </Text>
                </View>
                <Text className="text-[13px] leading-5" style={{ color: '#6d5c30' }}>
                  {r.reviewerComment}
                </Text>
              </View>
            ) : null}
            {r.execDirective?.message ? (
              <View className="gap-1 rounded-2xl bg-cd-primary-soft p-3.5">
                <View className="flex-row items-center gap-1.5">
                  <Ionicons name="megaphone" size={14} color={c.primary} />
                  <Text className="text-[12.5px] font-bold text-cd-primary">임원 지시</Text>
                </View>
                <Text className="text-[13px] leading-5 text-cd-text">{r.execDirective.message}</Text>
              </View>
            ) : null}

            <Card title="추진 내역 (이번 기간)">
              <Text className="mt-1 text-[13.5px] leading-5 text-cd-body">
                {r.progressText || '작성된 내용이 없습니다.'}
              </Text>
            </Card>
            <Card title="추진 계획 (다음 기간)">
              <Text className="mt-1 text-[13.5px] leading-5 text-cd-body">
                {r.planText || '작성된 내용이 없습니다.'}
              </Text>
            </Card>

            {r.stages.length ? (
              <Card title="공정 진행">
                <View className="mt-1 gap-1">
                  {r.stages.map((s, i) => (
                    <View
                      key={s.rowId}
                      className={`flex-row items-center gap-2 py-2 ${i === 0 ? '' : 'border-t border-cd-grid-line'}`}>
                      <Text numberOfLines={1} className="flex-1 text-[13px] font-semibold text-cd-text">
                        {s.stageName}
                      </Text>
                      {s.progressPct != null ? (
                        <Text className="text-[12px] text-cd-muted">{s.progressPct}%</Text>
                      ) : null}
                      <Badge
                        label={STAGE_STATUS[s.status] ?? s.status}
                        tone={s.status === 'done' ? 'success' : s.status === 'in_progress' ? 'primary' : 'neutral'}
                      />
                    </View>
                  ))}
                </View>
              </Card>
            ) : null}

            {editable ? (
              <Button
                label={r.reviewStatus === 'rejected' ? '수정 후 재제출' : '이어서 작성'}
                icon="create-outline"
                onPress={() =>
                  router.push({
                    pathname: '/work-report-draft',
                    params: { reportId: r.reportId, contractId: r.contractId ?? '' },
                  })
                }
                full
              />
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
