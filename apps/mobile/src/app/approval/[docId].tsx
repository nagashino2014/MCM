import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ActionBar,
  Badge,
  Button,
  EmptyState,
  Screen,
  Sheet,
  SkeletonList,
  Textarea,
  useToast,
} from '@/components/ui';
import { FieldValue, type FieldDef } from '@/components/approval/FieldValue';
import { StepTimeline, type Step } from '@/components/approval/StepTimeline';
import { apiJson } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { DOC_STATUS_LABEL } from '@/app/(tabs)/approval';
import { useTheme } from '@/theme/useTheme';

interface DocDetail {
  docId: string;
  docNo: string | null;
  formName: string;
  title: string;
  urgent: boolean;
  status: string;
  drafterName: string | null;
  drafterPosition: string | null;
  deptName: string | null;
  submittedAt: string | null;
  fields: FieldDef[];
  fieldValues: Record<string, unknown>;
  steps: Step[];
  myStepId: string | null;
  aiSummary?: { lines: string[]; figures: { label: string; value: string }[] } | null;
}

/**
 * 결재 문서 상세(M2) — 결재선·본문 조회 + 승인/반려.
 * 기안 작성·수정은 앱에서 하지 않는다(양식 편집은 웹, 블루프린트 §3.1 B등급).
 */
export default function ApprovalDocScreen() {
  const { docId } = useLocalSearchParams<{ docId: string }>();
  const router = useRouter();
  const toast = useToast();
  const { c } = useTheme();

  const { data, loading, error } = useApi<{ doc: DocDetail }>(`/api/approval/docs/${docId}`);
  const doc = data?.doc;

  const [rejectOpen, setRejectOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [acting, setActing] = useState<'approve' | 'reject' | null>(null);

  const act = async (action: 'approve' | 'reject') => {
    if (!doc?.myStepId) return;
    if (action === 'reject' && !comment.trim()) {
      toast.show('반려 사유를 입력해 주세요.', 'error');
      return;
    }
    setActing(action);
    try {
      await apiJson(`/api/approval/docs/${doc.docId}/act`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stepId: doc.myStepId,
          action,
          comment: comment.trim() || undefined,
        }),
      });
      setRejectOpen(false);
      setComment('');
      toast.show(action === 'approve' ? '승인했습니다.' : '반려했습니다.', 'success');
      // 목록·뱃지는 결재함으로 돌아갈 때 focus 에서 갱신된다.
      router.back();
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setActing(null);
    }
  };

  if (loading && !doc) {
    return (
      <Screen>
        <SkeletonList count={3} />
      </Screen>
    );
  }
  if (!doc) {
    return (
      <Screen>
        <EmptyState
          icon="alert-circle-outline"
          title="문서를 불러오지 못했습니다"
          description={error ?? undefined}
        />
      </Screen>
    );
  }

  const canAct = !!doc.myStepId && doc.status === 'in_progress';
  const visibleFields = doc.fields.filter((f) => f.type !== 'static' || f.content);

  return (
    // 상단은 네비게이터 헤더가 처리하고, 하단 액션 바는 자체 padding 으로 안전영역을 확보한다.
    <SafeAreaView edges={[]} style={{ backgroundColor: c.bg }} className="flex-1 bg-cd-bg">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}>
        {/* 헤더 */}
        <View className="gap-1.5 rounded-card border border-cd-border bg-cd-card p-4">
          <View className="flex-row flex-wrap items-center gap-1.5">
            {doc.urgent ? <Badge label="긴급" tone="error" /> : null}
            <Badge label={doc.formName} tone="primary" />
            <Badge
              label={DOC_STATUS_LABEL[doc.status] ?? doc.status}
              tone={
                doc.status === 'approved' ? 'success' : doc.status === 'rejected' ? 'error' : 'neutral'
              }
            />
          </View>
          <Text className="text-[18px] font-extrabold leading-6 text-cd-text">{doc.title}</Text>
          <Text className="text-[12px] text-cd-faint">
            {doc.drafterName ?? '-'}
            {doc.drafterPosition ? ` ${doc.drafterPosition}` : ''}
            {doc.deptName ? ` · ${doc.deptName}` : ''}
            {doc.docNo ? ` · ${doc.docNo}` : ''}
          </Text>
        </View>

        {/* AI 요약 */}
        {doc.aiSummary && (doc.aiSummary.lines.length > 0 || doc.aiSummary.figures.length > 0) ? (
          <View className="gap-1.5 rounded-card bg-cd-primary-soft p-4">
            <Text className="text-[11px] font-extrabold tracking-wide text-cd-primary">AI 요약</Text>
            {doc.aiSummary.lines.map((l, i) => (
              <Text key={i} className="text-[13px] leading-5 text-cd-text">
                · {l}
              </Text>
            ))}
            {doc.aiSummary.figures.length > 0 ? (
              <View className="mt-1 flex-row flex-wrap gap-x-4 gap-y-1">
                {doc.aiSummary.figures.map((f, i) => (
                  <Text key={i} className="text-[12px] text-cd-muted">
                    {f.label} <Text className="font-bold text-cd-text">{f.value}</Text>
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* 결재선 */}
        <View className="gap-3 rounded-card border border-cd-border bg-cd-card p-4">
          <Text className="text-[13px] font-extrabold text-cd-muted">결재선</Text>
          <StepTimeline steps={doc.steps} />
        </View>

        {/* 본문(양식 필드) */}
        <View className="gap-4 rounded-card border border-cd-border bg-cd-card p-4">
          <Text className="text-[13px] font-extrabold text-cd-muted">내용</Text>
          {visibleFields.map((f) => (
            <FieldValue key={f.key} field={f} value={doc.fieldValues?.[f.key]} />
          ))}
        </View>

        {!canAct && doc.status === 'in_progress' ? (
          <Text className="px-1 text-[12px] text-cd-faint">
            내 결재 차례가 아닙니다.
          </Text>
        ) : null}
      </ScrollView>

      {canAct ? (
        <ActionBar>
          <View className="flex-1">
            <Button
              label="반려"
              variant="ghost"
              icon="close"
              onPress={() => setRejectOpen(true)}
              full
            />
          </View>
          <View className="flex-[2]">
            <Button
              label="승인"
              icon="checkmark"
              onPress={() => act('approve')}
              loading={acting === 'approve'}
              full
            />
          </View>
        </ActionBar>
      ) : null}

      <Sheet
        visible={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="반려 사유"
        footer={
          <>
            <View className="flex-1">
              <Button label="취소" variant="ghost" onPress={() => setRejectOpen(false)} full />
            </View>
            <View className="flex-1">
              <Button
                label="반려"
                variant="danger"
                onPress={() => act('reject')}
                loading={acting === 'reject'}
                full
              />
            </View>
          </>
        }>
        <Textarea
          value={comment}
          onChangeText={setComment}
          placeholder="반려 사유를 입력하세요(기안자에게 전달됩니다)."
          minHeight={120}
          autoFocus
        />
      </Sheet>
    </SafeAreaView>
  );
}
