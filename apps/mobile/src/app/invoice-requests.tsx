import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';

import {
  Badge,
  Button,
  ConfirmSheet,
  EmptyState,
  GradientButton,
  ScreenHeader,
  SegmentedTabs,
  Sheet,
  SkeletonList,
  Textarea,
  useToast,
  type SegmentItem,
} from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useTheme } from '@/theme/useTheme';

/**
 * 세금계산서 발행 요청(IR-M1) — 블루프린트 docs/mobile-invoice-workreport-blueprint.md.
 *
 * 실무자: 내가 참여한 용역의 미발행 대금 단위를 골라 발행 담당자에게 요청/취소.
 * 담당자(billing.receivable.manage): 요청 수신함 확인 — 실제 발행(바로빌)은 웹에서.
 * 역할 분기는 전용 권한 API 없이 수신함 API 의 403 을 신호로 쓴다(권한 로직 이원화 방지).
 */

interface Milestone {
  milestoneId: string;
  stageLabel: string | null;
  stageOrder: number;
  amount: number | null;
  requested: boolean;
  requestedAt: string | null;
  requestNote: string | null;
}
interface MyContract {
  contractId: string;
  contractTitle: string | null;
  serviceType: string | null;
  facilityName: string | null;
  milestones: Milestone[];
}
interface InboxItem {
  milestoneId: string;
  contractId: string;
  contractTitle: string | null;
  serviceType: string | null;
  facilityName: string | null;
  stageLabel: string | null;
  amount: number | null;
  requestedAt: string | null;
  requestedByName: string | null;
  requestNote: string | null;
}

type Tab = 'inbox' | 'mine';

const won = (n: number | null) => (n == null ? '금액 미정' : `${n.toLocaleString('ko-KR')}원`);

/** 수신함 — 403(담당자 아님)을 구분해야 해서 useApi 대신 status 를 직접 본다. */
function useInbox() {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null); // null = 판정 전
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/home/invoice-requests/inbox');
      if (res.status === 403) {
        setAllowed(false);
        return;
      }
      const d = (await res.json().catch(() => ({}))) as { items?: InboxItem[] };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAllowed(true);
      setItems(d.items ?? []);
    } catch {
      // 네트워크 오류 — 권한 판정을 바꾸지 않는다(다음 리로드에서 재시도).
    } finally {
      setLoading(false);
    }
  }, []);

  return { items, allowed, loading, load };
}

export default function InvoiceRequestsScreen() {
  const { c } = useTheme();
  const toast = useToast();
  const inbox = useInbox();
  const mine = useApi<{ contracts: MyContract[] }>('/api/home/invoice-requests/mine');
  // 사용자가 직접 고르기 전에는 역할에 따른 기본 탭 — 담당자는 수신함(요청 확인이 주 업무).
  const [userTab, setUserTab] = useState<Tab | null>(null);
  const tab: Tab = userTab ?? (inbox.allowed === true ? 'inbox' : 'mine');
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void inbox.load();
      void mine.reload();
      // 훅 반환 객체는 매 렌더 새로 만들어진다 — 의존성에서 제외.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const reloadAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([inbox.load(), mine.reload()]);
    setRefreshing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 요청 시트(미요청 단계 탭) / 취소 확인(요청됨 단계 탭) / 수신함 상세
  const [requestFor, setRequestFor] = useState<{ contract: MyContract; m: Milestone } | null>(null);
  const [note, setNote] = useState('');
  const [cancelFor, setCancelFor] = useState<{ contract: MyContract; m: Milestone } | null>(null);
  const [detail, setDetail] = useState<InboxItem | null>(null);
  const [busy, setBusy] = useState(false);

  const submitRequest = async () => {
    if (!requestFor) return;
    setBusy(true);
    try {
      const res = await apiFetch(
        `/api/contracts/${requestFor.contract.contractId}/milestones/${requestFor.m.milestoneId}/invoice-request`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: note.trim() || null }),
        }
      );
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      toast.show('발행을 요청했습니다. 담당자에게 알림이 전달됩니다.', 'success');
      setRequestFor(null);
      setNote('');
      await reloadAll();
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const submitCancel = async () => {
    if (!cancelFor) return;
    setBusy(true);
    try {
      const res = await apiFetch(
        `/api/contracts/${cancelFor.contract.contractId}/milestones/${cancelFor.m.milestoneId}/invoice-request`,
        { method: 'DELETE' }
      );
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      toast.show('발행 요청을 취소했습니다.', 'success');
      setCancelFor(null);
      await reloadAll();
    } catch (e) {
      setCancelFor(null);
      toast.show((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const contracts = mine.data?.contracts ?? [];
  const tabs: SegmentItem<Tab>[] = [
    { key: 'inbox', label: '요청함', count: inbox.items?.length ?? null },
    { key: 'mine', label: '내 용역' },
  ];

  return (
    <SafeAreaView className="flex-1 bg-cd-bg">
      <ScreenHeader title="발행 요청" subtitle="세금계산서 발행 요청·수신함" back variant="sub" />
      {inbox.allowed === true ? <SegmentedTabs items={tabs} value={tab} onChange={setUserTab} /> : null}

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingTop: 8, gap: 12, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void reloadAll()} />}>
        {inbox.allowed === true && tab === 'inbox' ? (
          // ── 담당자 수신함 ──────────────────────────────
          inbox.loading && !inbox.items ? (
            <SkeletonList count={3} />
          ) : !inbox.items?.length ? (
            <EmptyState icon="mail-open-outline" title="대기 중인 발행 요청이 없습니다" />
          ) : (
            inbox.items.map((it) => (
              <Pressable
                key={it.milestoneId}
                onPress={() => setDetail(it)}
                className="gap-1.5 rounded-2xl border border-cd-border bg-cd-card p-3.5 active:opacity-70">
                <View className="flex-row items-center gap-2">
                  <Text numberOfLines={1} className="flex-1 text-[14px] font-bold text-cd-text">
                    {it.contractTitle ?? it.facilityName ?? '계약'}
                  </Text>
                  <Text className="text-[14px] font-extrabold text-cd-text">{won(it.amount)}</Text>
                </View>
                <View className="flex-row items-center gap-2">
                  <Badge label={it.stageLabel ?? '대금 단계'} tone="primary" />
                  <Text numberOfLines={1} className="flex-1 text-[11.5px] text-cd-faint">
                    {it.requestedByName ?? '요청자 미상'} · {it.requestedAt?.slice(0, 10) ?? '-'}
                  </Text>
                </View>
                {it.requestNote ? (
                  <Text numberOfLines={2} className="text-[12px] text-cd-muted">
                    {it.requestNote}
                  </Text>
                ) : null}
              </Pressable>
            ))
          )
        ) : // ── 실무자 내 용역 ──────────────────────────────
        mine.loading && !mine.data ? (
          <SkeletonList count={3} />
        ) : mine.error ? (
          <EmptyState
            icon="alert-circle-outline"
            title="불러오지 못했습니다"
            description={mine.error}
            action={<Button label="다시 시도" variant="soft" onPress={() => void reloadAll()} />}
          />
        ) : !contracts.length ? (
          <EmptyState
            icon="briefcase-outline"
            title="발행 요청할 대금 단위가 없습니다"
            description="참여 중인 용역의 미발행 대금 단위가 여기에 표시됩니다."
          />
        ) : (
          contracts.map((ct) => (
            <View key={ct.contractId} className="rounded-2xl border border-cd-border bg-cd-card p-3.5">
              <Text numberOfLines={1} className="text-[14px] font-bold text-cd-text">
                {ct.contractTitle ?? '계약'}
              </Text>
              <Text numberOfLines={1} className="mt-[2px] text-[11.5px] text-cd-faint">
                {[ct.facilityName, ct.serviceType].filter(Boolean).join(' · ') || '발주처 미상'}
              </Text>
              <View className="mt-2.5 gap-1">
                {ct.milestones.map((m, i) => (
                  <Pressable
                    key={m.milestoneId}
                    onPress={() => {
                      if (m.requested) setCancelFor({ contract: ct, m });
                      else {
                        setNote('');
                        setRequestFor({ contract: ct, m });
                      }
                    }}
                    className={`flex-row items-center gap-2 py-2.5 active:opacity-60 ${
                      i === 0 ? '' : 'border-t border-cd-grid-line'
                    }`}>
                    <View className="flex-1">
                      <Text numberOfLines={1} className="text-[13px] font-semibold text-cd-text">
                        {m.stageLabel ?? `${m.stageOrder + 1}차 대금`}
                      </Text>
                      {m.requested ? (
                        <Text className="mt-[1px] text-[11px] text-cd-faint">
                          {m.requestedAt?.slice(0, 10)} 요청됨 — 탭하여 취소
                        </Text>
                      ) : null}
                    </View>
                    <Text className="text-[13px] font-bold text-cd-text">{won(m.amount)}</Text>
                    {m.requested ? (
                      <Badge label="요청됨" tone="warning" />
                    ) : (
                      <Ionicons name="paper-plane-outline" size={16} color={c.primary} />
                    )}
                  </Pressable>
                ))}
              </View>
            </View>
          ))
        )}

        {inbox.allowed === true && tab === 'inbox' && inbox.items?.length ? (
          <Text className="px-1 text-center text-[11.5px] leading-4 text-cd-faint">
            계산서 발행(바로빌 전자발행)은 웹 홈의 발행 요청 수신함에서 진행합니다.
          </Text>
        ) : null}
      </ScrollView>

      {/* 발행 요청 시트 */}
      <Sheet
        visible={!!requestFor}
        onClose={() => setRequestFor(null)}
        title="발행 요청"
        footer={
          <View className="flex-1">
            <GradientButton label="발행 요청" loading={busy} onPress={() => void submitRequest()} />
          </View>
        }>
        {requestFor ? (
          <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
            <View className="gap-3 pb-2">
              <View className="gap-1 rounded-xl border border-cd-border p-3">
                <Text numberOfLines={1} className="text-[13.5px] font-bold text-cd-text">
                  {requestFor.contract.contractTitle ?? '계약'}
                </Text>
                <Text numberOfLines={1} className="text-[11.5px] text-cd-faint">
                  {requestFor.contract.facilityName ?? '발주처 미상'}
                </Text>
                <View className="mt-1 flex-row items-center justify-between">
                  <Text className="text-[12.5px] text-cd-muted">{requestFor.m.stageLabel ?? '대금 단계'}</Text>
                  <Text className="text-[14px] font-extrabold text-cd-text">{won(requestFor.m.amount)}</Text>
                </View>
              </View>
              <Textarea
                label="요청 메모 (선택)"
                minHeight={64}
                maxLength={200}
                value={note}
                onChangeText={setNote}
                placeholder="발행 담당자에게 전달할 내용"
              />
              <Text className="text-[11.5px] leading-4 text-cd-faint">
                요청하면 발행 담당자에게 알림이 전달되고, 계산서가 발행되면 요청 상태는 자동으로 해소됩니다.
              </Text>
            </View>
          </ScrollView>
        ) : null}
      </Sheet>

      {/* 요청 취소 확인 */}
      <ConfirmSheet
        visible={!!cancelFor}
        title="발행 요청을 취소할까요?"
        message={`${cancelFor?.m.stageLabel ?? '대금 단계'} · ${won(cancelFor?.m.amount ?? null)}`}
        confirmLabel="요청 취소"
        danger
        loading={busy}
        onConfirm={() => void submitCancel()}
        onCancel={() => setCancelFor(null)}
      />

      {/* 수신함 상세 */}
      <Sheet visible={!!detail} onClose={() => setDetail(null)} title="발행 요청 상세">
        {detail ? (
          <View className="gap-2.5">
            <InfoRow label="계약" value={detail.contractTitle ?? '-'} />
            <InfoRow label="발주처" value={detail.facilityName ?? '-'} />
            <InfoRow label="대금 단계" value={detail.stageLabel ?? '-'} />
            <InfoRow label="금액" value={won(detail.amount)} />
            <InfoRow label="요청자" value={detail.requestedByName ?? '-'} />
            <InfoRow label="요청일" value={detail.requestedAt?.slice(0, 16).replace('T', ' ') ?? '-'} />
            {detail.requestNote ? <InfoRow label="메모" value={detail.requestNote} /> : null}
            <View className="mt-1 flex-row items-start gap-2 rounded-xl bg-cd-primary-soft px-3 py-2.5">
              <Ionicons name="information-circle" size={15} color={c.primary} />
              <Text className="flex-1 text-[12px] leading-4 text-cd-primary">
                계산서 발행(바로빌 전자발행)은 웹 홈의 발행 요청 수신함에서 진행합니다. 발행이 완료되면 이
                목록에서 자동으로 사라집니다.
              </Text>
            </View>
          </View>
        ) : null}
      </Sheet>
    </SafeAreaView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row gap-3">
      <Text className="w-16 text-[12.5px] text-cd-faint">{label}</Text>
      <Text className="flex-1 text-[13.5px] font-semibold text-cd-text">{value}</Text>
    </View>
  );
}
