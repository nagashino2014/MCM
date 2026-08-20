import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import {
  Badge,
  Button,
  Card,
  ConfirmSheet,
  EmptyState,
  ScreenHeader,
  SkeletonList,
  Textarea,
  useToast,
} from '@/components/ui';
import { apiFetch, apiJson } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useTheme } from '@/theme/useTheme';

/**
 * 업무보고 상세(WR-M1~M3) — 열람 + 실무자 수정·재제출 + 부서장 검토(?review=1) + 임원 지시(?exec=1).
 * 검토 규칙은 웹 ReportEditor 와 동일: 의견 분류 중 '보완 요구'·'오기 정정 요청'일 때만 반려 가능,
 * 확인(confirm)은 머징 대상으로 분류 — 합본·발표는 웹 감독 화면에서.
 * 임원 지시는 EXEC_DIRECTIVE_ACTIONABLE(보완요구·진행촉구·추가보고)만 하달 가능(웹과 동일).
 * 부서장은 지시가 내려온 보고에서 답변(재보고, 1회 제한)을 보낸다.
 */

interface StageRow {
  rowId: string;
  stageOrder: number;
  stageName: string;
  status: 'pending' | 'in_progress' | 'done';
  progressPct?: number | null;
}
interface AsOfStage {
  stageOrder: number;
  status: 'pending' | 'in_progress' | 'done';
  progressPct: number;
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
  execStatus: string | null;
  directorResponse: string | null;
  reReportCount: number;
  execDirective: { kind: string; message: string | null } | null;
  currentStageName: string | null;
  currentStagePct: number | null;
  stages: StageRow[];
  asOfStages: AsOfStage[];
}
/** 대상 공정표 행(전체 타임라인의 이름·순서 소스). */
interface ProcessStage {
  stageOrder: number;
  stageName: string;
  status: 'pending' | 'in_progress' | 'done';
  progressPct: number;
}

const COMMENT_KIND_LABEL: Record<string, string> = {
  amend: '첨삭',
  supplement: '보완 요청',
  correction: '반려(정정)',
};
/** 부서장 의견 분류(웹 REVIEW_COMMENT_KINDS와 동일) — supplement·correction 만 반려 가능. */
const REVIEW_KINDS: { value: string; label: string }[] = [
  { value: 'amend', label: '의견 첨삭' },
  { value: 'supplement', label: '보완 요구' },
  { value: 'correction', label: '오기 정정 요청' },
];
const REJECTABLE = ['supplement', 'correction'];
/** 임원 지시 분류(웹 EXEC_DIRECTIVE_KINDS) — '의견'은 기록용이라 하달 비활성(ACTIONABLE 제외). */
const EXEC_KINDS: { value: string; label: string }[] = [
  { value: 'supplement_request', label: '보완 요구' },
  { value: 'expedite', label: '진행 촉구' },
  { value: 'additional_report', label: '추가보고 지시' },
  { value: 'opinion', label: '의견' },
];
const EXEC_ACTIONABLE = ['supplement_request', 'expedite', 'additional_report'];
const EXEC_KIND_LABEL = Object.fromEntries(EXEC_KINDS.map((k) => [k.value, k.label]));
const STAGE_STATUS: Record<string, string> = { pending: '예정', in_progress: '진행', done: '완료' };

export default function WorkReportDetailScreen() {
  const router = useRouter();
  const { c } = useTheme();
  const { reportId, review, exec } = useLocalSearchParams<{ reportId: string; review?: string; exec?: string }>();
  const reviewMode = review === '1';
  const execMode = exec === '1';
  const toast = useToast();
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
  // 수정·재제출 진입 조건 — 작성 중이거나 반려/보완 상태의 보고(권한 검증은 서버 몫). 검토·임원 모드에서는 숨긴다.
  const editable = !reviewMode && !execMode && !!r && (r.status === 'draft' || r.reviewStatus === 'rejected');

  // ── 공정 타임라인(사용자 요청 2026-08-20) — 현재 공정 배지 옆 ∨ 로 펼친다.
  //    이름·순서는 대상 공정표에서, 상태는 이 보고 시점 누적(asOfStages)으로 덮는다(미보고 단계는 예정).
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timeline, setTimeline] = useState<ProcessStage[] | null>(null);
  const toggleTimeline = async () => {
    const next = !timelineOpen;
    setTimelineOpen(next);
    if (!next || timeline || !r) return;
    try {
      const path =
        r.subjectKind === 'task'
          ? `/api/work-tasks/${r.taskId}/process-stages`
          : `/api/contracts/${r.contractId}/process-stages`;
      const d = await apiJson<{ stages: ProcessStage[] }>(path);
      const asOf = new Map(r.asOfStages.map((s) => [s.stageOrder, s]));
      setTimeline(
        [...d.stages]
          .sort((a, b) => a.stageOrder - b.stageOrder)
          .map((s) => {
            const o = asOf.get(s.stageOrder);
            return { ...s, status: o?.status ?? 'pending', progressPct: o?.progressPct ?? 0 };
          })
      );
    } catch (e) {
      setTimeline([]);
      toast.show(`공정표를 불러오지 못했습니다: ${(e as Error).message}`, 'error');
    }
  };

  // ── 부서장 검토(WR-M2) — 의견 분류·의견 텍스트, 반려는 확인 시트를 거친다.
  const [kind, setKind] = useState('amend');
  const [comment, setComment] = useState('');
  const [commentSeeded, setCommentSeeded] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const [acting, setActing] = useState<'reject' | 'confirm' | null>(null);
  // 기존 의견 프리필(1회) — 렌더 중 setState 금지 규칙에 따라 시드 플래그로 처리.
  if (reviewMode && r && !commentSeeded) {
    setCommentSeeded(true);
    if (r.reviewerComment) setComment(r.reviewerComment);
    if (r.reviewerCommentKind) setKind(r.reviewerCommentKind);
  }

  const submitReview = async (action: 'reject' | 'confirm') => {
    if (!r) return;
    if (action === 'reject' && !comment.trim()) {
      toast.show('반려 사유(의견)를 입력하세요.', 'error');
      return;
    }
    setActing(action);
    try {
      const res = await apiFetch(`/api/work-plan/report/${r.reportId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reviewerComment: comment.trim() || null, reviewerCommentKind: kind }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      toast.show(
        action === 'reject'
          ? '반려했습니다 — 작성자에게 재제출 대상으로 표시됩니다.'
          : '확인 완료 — 머징(임원 보고) 대상으로 분류됩니다.',
        'success'
      );
      setConfirmReject(false);
      await reload();
    } catch (e) {
      setConfirmReject(false);
      toast.show((e as Error).message, 'error');
    } finally {
      setActing(null);
    }
  };

  // ── 임원 지시(WR-M3) — ACTIONABLE 분류만 하달 가능.
  const [execKind, setExecKind] = useState(EXEC_KINDS[0].value);
  const [execMsg, setExecMsg] = useState('');
  const [execSending, setExecSending] = useState(false);
  const submitDirective = async () => {
    if (!r) return;
    if (!execMsg.trim()) {
      toast.show('지시 내용을 입력하세요.', 'error');
      return;
    }
    setExecSending(true);
    try {
      const res = await apiFetch(`/api/work-plan/report/${r.reportId}/directive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: execKind, message: execMsg.trim(), contractId: r.contractId }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      toast.show('지시를 하달했습니다 — 부서장 재보고 대상이 됩니다.', 'success');
      setExecMsg('');
      await reload();
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setExecSending(false);
    }
  };

  // ── 부서장 재보고(임원 지시 답변, 1회 제한) — 검토 모드에서 지시가 내려온 보고에만.
  const [respMsg, setRespMsg] = useState('');
  const [respSending, setRespSending] = useState(false);
  const submitResponse = async () => {
    if (!r) return;
    if (!respMsg.trim()) {
      toast.show('답변 내용을 입력하세요.', 'error');
      return;
    }
    setRespSending(true);
    try {
      const res = await apiFetch(`/api/work-plan/report/${r.reportId}/re-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directorResponse: respMsg.trim() }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      toast.show('재보고를 제출했습니다.', 'success');
      setRespMsg('');
      await reload();
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setRespSending(false);
    }
  };

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
                <>
                  {/* 현재 공정 + 전체 타임라인 펼침(∨) — 사용자 요청 2026-08-20 */}
                  <View className="flex-row items-center gap-2">
                    <View className="shrink">
                      <Badge
                        label={`현재 공정 ${r.currentStageName}${r.currentStagePct != null ? ` ${r.currentStagePct}%` : ''}`}
                        tone="primary"
                      />
                    </View>
                    <Pressable
                      onPress={() => void toggleTimeline()}
                      hitSlop={8}
                      className="h-7 w-7 items-center justify-center rounded-full border border-cd-border bg-cd-card active:opacity-60">
                      <Ionicons name={timelineOpen ? 'chevron-up' : 'chevron-down'} size={15} color={c.primary} />
                    </Pressable>
                  </View>
                  {timelineOpen ? (
                    timeline == null ? (
                      <ActivityIndicator className="py-3" color={c.primary} />
                    ) : timeline.length === 0 ? (
                      <Text className="py-1 text-[12px] text-cd-faint">공정표가 없습니다.</Text>
                    ) : (
                      <View className="mt-1 items-start gap-0.5">
                        {timeline.map((s, i) => {
                          const on = s.status !== 'pending';
                          const done = s.status === 'done';
                          return (
                            <View key={s.stageOrder} className="items-start" style={{ width: '55%' }}>
                              {i > 0 ? (
                                <View className="w-full items-center py-0.5">
                                  <Ionicons name="arrow-down" size={13} color={c.faint} />
                                </View>
                              ) : null}
                              <View
                                className={`w-full flex-row items-center gap-1.5 rounded-xl border px-3 py-2 ${
                                  done
                                    ? 'border-cd-success bg-cd-success-soft'
                                    : on
                                      ? 'border-cd-primary bg-cd-primary-soft'
                                      : 'border-cd-border bg-cd-card'
                                }`}>
                                <Text
                                  numberOfLines={1}
                                  className={`flex-1 text-[12px] font-bold ${
                                    done ? 'text-cd-success' : on ? 'text-cd-primary' : 'text-cd-muted'
                                  }`}>
                                  {s.stageName}
                                </Text>
                                <Text
                                  className={`text-[10.5px] ${done ? 'text-cd-success' : on ? 'text-cd-primary' : 'text-cd-faint'}`}>
                                  {done ? '완료' : on ? `${s.progressPct}%` : '예정'}
                                </Text>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    )
                  ) : null}
                </>
              ) : null}
            </View>

            {/* 부서장 의견 / 임원 지시·재보고 — 본문보다 먼저(판단 근거) */}
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
                  <Text className="text-[12.5px] font-bold text-cd-primary">
                    임원 지시{EXEC_KIND_LABEL[r.execDirective.kind] ? ` — ${EXEC_KIND_LABEL[r.execDirective.kind]}` : ''}
                  </Text>
                </View>
                <Text className="text-[13px] leading-5 text-cd-text">{r.execDirective.message}</Text>
                {r.directorResponse ? (
                  <View className="mt-1 gap-0.5 rounded-xl bg-cd-card px-3 py-2">
                    <Text className="text-[11.5px] font-bold text-cd-muted">부서장 답변 (재보고)</Text>
                    <Text className="text-[12.5px] leading-4 text-cd-body">{r.directorResponse}</Text>
                  </View>
                ) : null}
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
              <Card title="공정 진행 (이 보고의 갱신)">
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
                    params: {
                      reportId: r.reportId,
                      subjectKind: r.subjectKind,
                      subjectId: r.subjectKind === 'task' ? (r.taskId ?? '') : (r.contractId ?? ''),
                    },
                  })
                }
                full
              />
            ) : null}

            {/* 부서장 검토 패널(WR-M2) — 제출된 보고만 */}
            {reviewMode && r.status === 'submitted' ? (
              <Card title="부서장 검토">
                <View className="mt-2 gap-3">
                  <View className="flex-row flex-wrap gap-2">
                    {REVIEW_KINDS.map((k) => (
                      <Pressable
                        key={k.value}
                        onPress={() => setKind(k.value)}
                        className={`rounded-full border px-3.5 py-2 active:opacity-70 ${
                          kind === k.value ? 'border-cd-primary bg-cd-primary-soft' : 'border-cd-border bg-cd-card'
                        }`}>
                        <Text className={`text-[12.5px] font-bold ${kind === k.value ? 'text-cd-primary' : 'text-cd-muted'}`}>
                          {k.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Textarea
                    minHeight={80}
                    value={comment}
                    onChangeText={setComment}
                    placeholder="작성자에게 전달할 의견"
                  />
                  <View className="flex-row gap-2">
                    <View className="flex-1">
                      <Button
                        label="반려"
                        variant="danger"
                        disabled={!REJECTABLE.includes(kind) || !!acting}
                        loading={acting === 'reject'}
                        onPress={() => setConfirmReject(true)}
                        full
                      />
                    </View>
                    <View className="flex-[1.4]">
                      <Button
                        label="확인 (머징 대상)"
                        disabled={!!acting}
                        loading={acting === 'confirm'}
                        onPress={() => void submitReview('confirm')}
                        full
                      />
                    </View>
                  </View>
                  {!REJECTABLE.includes(kind) ? (
                    <Text className="text-[11px] leading-4 text-cd-faint">
                      반려는 [보완 요구]·[오기 정정 요청] 의견일 때만 가능합니다. 합본(머징)·임원 보고는 웹
                      감독 화면에서 진행합니다.
                    </Text>
                  ) : null}
                </View>
              </Card>
            ) : null}

            {/* 부서장 재보고(WR-M3) — 임원 지시가 내려온 보고에 답변(1회 제한) */}
            {reviewMode && r.execStatus === 'directed' ? (
              r.reReportCount >= 1 ? (
                <Text className="px-1 text-center text-[11.5px] text-cd-faint">재보고(1회)를 이미 제출했습니다.</Text>
              ) : (
                <Card title="임원 지시 답변 (재보고)">
                  <View className="mt-2 gap-3">
                    <Textarea
                      minHeight={80}
                      value={respMsg}
                      onChangeText={setRespMsg}
                      placeholder="지시에 대한 조치·답변 내용 (재보고는 1회만 가능합니다)"
                    />
                    <Button
                      label="재보고 제출"
                      icon="arrow-undo-outline"
                      loading={respSending}
                      onPress={() => void submitResponse()}
                      full
                    />
                  </View>
                </Card>
              )
            ) : null}

            {/* 임원 지시 패널(WR-M3) — 제출된 보고만, '의견' 분류는 하달 비활성(웹 동일) */}
            {execMode && r.status === 'submitted' ? (
              <Card title="임원 검토·지시">
                <View className="mt-2 gap-3">
                  <View className="flex-row flex-wrap gap-2">
                    {EXEC_KINDS.map((k) => (
                      <Pressable
                        key={k.value}
                        onPress={() => setExecKind(k.value)}
                        className={`rounded-full border px-3.5 py-2 active:opacity-70 ${
                          execKind === k.value ? 'border-cd-primary bg-cd-primary-soft' : 'border-cd-border bg-cd-card'
                        }`}>
                        <Text
                          className={`text-[12.5px] font-bold ${execKind === k.value ? 'text-cd-primary' : 'text-cd-muted'}`}>
                          {k.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Textarea minHeight={80} value={execMsg} onChangeText={setExecMsg} placeholder="부서장에게 하달할 지시 내용" />
                  <Button
                    label="지시 하달"
                    icon="megaphone-outline"
                    disabled={!EXEC_ACTIONABLE.includes(execKind) || execSending}
                    loading={execSending}
                    onPress={() => void submitDirective()}
                    full
                  />
                  {!EXEC_ACTIONABLE.includes(execKind) ? (
                    <Text className="text-[11px] leading-4 text-cd-faint">
                      [의견] 분류는 기록용이라 하달할 수 없습니다 — 의견 기록은 웹 임원 검토 화면에서 진행합니다.
                    </Text>
                  ) : null}
                </View>
              </Card>
            ) : null}
          </>
        )}
      </ScrollView>

      <ConfirmSheet
        visible={confirmReject}
        title="이 보고를 반려할까요?"
        message="작성자에게 재제출 대상으로 표시되고, 입력한 의견이 전달됩니다."
        confirmLabel="반려"
        danger
        loading={acting === 'reject'}
        onConfirm={() => void submitReview('reject')}
        onCancel={() => setConfirmReject(false)}
      />
    </SafeAreaView>
  );
}
