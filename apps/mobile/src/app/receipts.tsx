import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';

import { DatePickerSheet } from '@/components/calendar/DatePickerSheet';
import {
  Badge,
  Button,
  ConfirmSheet,
  EmptyState,
  HeaderIconButton,
  Input,
  ScreenHeader,
  SegmentedTabs,
  Sheet,
  SkeletonList,
  useToast,
  type SegmentItem,
} from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { API_BASE_URL } from '@/lib/config';
import { getAccessToken } from '@/lib/tokens';
import { useApi } from '@/lib/use-api';
import { useTheme } from '@/theme/useTheme';

/**
 * 영수증 보관함 — 찍어 둔 개인카드 영수증을 확인·수정·정리한다.
 *
 * 종전에는 촬영(`/receipt`)만 있고 목록이 없어서, 저장은 됐는데 지출결의서 피커에 안 뜨는 건이
 * 생겨도 사용자가 확인할 방법이 없었다(2026-08-19 원인 분석). 날짜가 비었거나 표기가 깨진 건도
 * 여기에는 촬영일 기준으로 반드시 보인다 — 그 자리에서 사용일을 고쳐 피커로 돌려보낼 수 있다.
 *
 * 탭: 미사용(기안에 담을 수 있는 것) / 사용됨(결의서에 실림 — 내용 잠김) / 제외(오촬영 정리).
 */

type Scope = 'unused' | 'used' | 'excluded';

const TABS: SegmentItem<Scope>[] = [
  { key: 'unused', label: '미사용' },
  { key: 'used', label: '사용됨' },
  { key: 'excluded', label: '제외' },
];

interface ReceiptItem {
  receiptId: string;
  paidAt: string | null;
  paidDate: string | null;
  storeName: string | null;
  storeCorpNum: string | null;
  totalAmount: number;
  cardLast4: string | null;
  items: string[];
  memo: string | null;
  docId: string | null;
  docTitle: string | null;
  docNo: string | null;
  docStatus: string | null;
  excluded: boolean;
  createdAt: string;
  categoryLabel: string | null;
}

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

/** 표시용 000-00-00000 */
const fmtCorpNum = (v: string) => {
  const d = v.replace(/[^0-9]/g, '');
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : v;
};

/** 목록에 보여 줄 날짜 라벨 — 사용일이 없으면 촬영일로 대신하고 그 사실을 알린다. */
function dateLabel(r: ReceiptItem): string {
  if (r.paidAt) return r.paidAt.slice(0, 16);
  return `사용일 미상 · ${r.createdAt.slice(0, 10)} 촬영`;
}

export default function ReceiptsScreen() {
  const router = useRouter();
  const { c } = useTheme();
  const toast = useToast();
  const [tab, setTab] = useState<Scope>('unused');
  const list = useApi<{ items: ReceiptItem[] }>(`/api/receipts?scope=${tab}&limit=100`);

  // 썸네일·미리보기는 인증이 필요한 경로다(Avatar 의 useAuthedSource 패턴).
  const [authHeaders, setAuthHeaders] = useState<Record<string, string> | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void getAccessToken().then((token) => {
      if (alive && token) setAuthHeaders({ Authorization: `Bearer ${token}` });
    });
    return () => {
      alive = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      void list.reload();
      // 훅 반환 객체는 매 렌더 새로 만들어진다 — 의존성에서 제외.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab])
  );

  // 수정 시트 — 날짜 피커를 띄우는 동안에는 시트를 접는다(중첩 Modal 회피).
  const [editing, setEditing] = useState<ReceiptItem | null>(null);
  const [datePicker, setDatePicker] = useState(false);
  const [form, setForm] = useState({ date: '', time: '', storeName: '', totalAmount: '', memo: '' });
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const open = (r: ReceiptItem) => {
    setEditing(r);
    setForm({
      date: r.paidAt ? r.paidAt.slice(0, 10) : '',
      time: r.paidAt && r.paidAt.length > 10 ? r.paidAt.slice(11, 16) : '',
      storeName: r.storeName ?? '',
      totalAmount: String(r.totalAmount ?? ''),
      memo: r.memo ?? '',
    });
  };
  const close = () => {
    setEditing(null);
    setDatePicker(false);
    setConfirmDelete(false);
  };

  /** 귀속된 영수증은 내용 수정·삭제가 막힌다(서버 규칙과 동일) — 제외/메모만 가능. */
  const locked = !!editing?.docId;

  const patch = async (body: Record<string, unknown>, done: string) => {
    if (!editing) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/receipts/${editing.receiptId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      toast.show(done, 'success');
      close();
      await list.reload();
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const amount = Number(form.totalAmount.replace(/[^0-9]/g, ''));
    if (!(amount > 0)) {
      toast.show('결제 금액을 입력하세요.', 'error');
      return;
    }
    const paidAt = form.date ? (form.time.trim() ? `${form.date} ${form.time.trim()}` : form.date) : null;
    void patch(
      { paidAt, storeName: form.storeName.trim() || null, totalAmount: amount, memo: form.memo.trim() || null },
      '영수증을 수정했습니다.'
    );
  };

  const remove = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/receipts/${editing.receiptId}`, { method: 'DELETE' });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      toast.show('영수증을 삭제했습니다.', 'success');
      close();
      await list.reload();
    } catch (e) {
      setConfirmDelete(false);
      toast.show((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const items = list.data?.items ?? [];

  return (
    <SafeAreaView className="flex-1 bg-cd-bg">
      <ScreenHeader
        title="영수증 보관함"
        subtitle="찍어 둔 개인카드 영수증"
        back
        variant="sub"
        right={<HeaderIconButton icon="camera" onPress={() => router.push('/receipt')} />}
      />
      <SegmentedTabs items={TABS} value={tab} onChange={setTab} />

      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={() => void list.reload()} />}>
        {list.loading ? (
          <View className="px-4 pt-2">
            <SkeletonList count={4} />
          </View>
        ) : list.error ? (
          <EmptyState
            icon="alert-circle-outline"
            title="목록을 불러오지 못했습니다"
            description={list.error}
            action={<Button label="다시 시도" variant="soft" onPress={() => void list.reload()} />}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon="receipt-outline"
            title={
              tab === 'unused'
                ? '담아 둔 영수증이 없습니다'
                : tab === 'used'
                  ? '사용된 영수증이 없습니다'
                  : '제외한 영수증이 없습니다'
            }
            description={
              tab === 'unused'
                ? '영수증을 찍어 두면 지출결의서·출장보고서 작성 때 바로 불러올 수 있습니다.'
                : undefined
            }
            action={
              tab === 'unused' ? (
                <Button label="영수증 촬영" icon="camera" onPress={() => router.push('/receipt')} />
              ) : undefined
            }
          />
        ) : (
          items.map((r) => (
            <Pressable
              key={r.receiptId}
              onPress={() => open(r)}
              className="flex-row items-center gap-3 border-b border-cd-grid-line px-4 py-3 active:opacity-60">
              <Image
                source={{ uri: `${API_BASE_URL}/api/receipts/${r.receiptId}/image`, headers: authHeaders }}
                style={{ width: 46, height: 46, borderRadius: 10, backgroundColor: c.gridLine }}
                contentFit="cover"
              />
              <View className="flex-1">
                <Text numberOfLines={1} className="text-[14px] font-bold text-cd-text">
                  {r.storeName ?? '상호 미상'}
                </Text>
                <Text numberOfLines={1} className="mt-[2px] text-[11.5px] text-cd-faint">
                  {dateLabel(r)}
                  {r.cardLast4 ? ` · ****${r.cardLast4}` : ''}
                </Text>
                {r.docTitle ? (
                  <Text numberOfLines={1} className="mt-[3px] text-[11px] text-cd-primary">
                    {r.docNo ? `${r.docNo} · ` : ''}
                    {r.docTitle}
                  </Text>
                ) : null}
              </View>
              <View className="items-end gap-1">
                <Text className="text-[14px] font-extrabold text-cd-text">{won(r.totalAmount)}</Text>
                {!r.paidAt ? (
                  <Badge label="날짜 확인" tone="warning" />
                ) : r.categoryLabel ? (
                  <Badge label={r.categoryLabel} />
                ) : null}
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>

      {/* 수정 시트 — 날짜 피커를 여는 동안에는 접는다(iOS 중첩 Modal 회피) */}
      <Sheet
        visible={!!editing && !datePicker}
        onClose={close}
        title="영수증 상세"
        footer={
          <>
            <View className="flex-1">
              <Button
                label={editing?.excluded ? '제외 해제' : '제외'}
                variant="ghost"
                onPress={() =>
                  void patch(
                    { excluded: !editing?.excluded },
                    editing?.excluded ? '제외를 해제했습니다.' : '목록에서 제외했습니다.'
                  )
                }
                disabled={busy}
                full
              />
            </View>
            <View className="flex-1">
              <Button label="저장" onPress={save} loading={busy} disabled={locked} full />
            </View>
          </>
        }>
        {editing ? (
          <ScrollView contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
            <Image
              source={{ uri: `${API_BASE_URL}/api/receipts/${editing.receiptId}/image`, headers: authHeaders }}
              style={{ width: '100%', height: 180, borderRadius: 14, backgroundColor: c.gridLine }}
              contentFit="contain"
            />
            {locked ? (
              <View className="flex-row items-start gap-2 rounded-xl bg-cd-primary-soft px-3 py-2.5">
                <Ionicons name="lock-closed" size={15} color={c.primary} />
                <Text className="flex-1 text-[12px] leading-4 text-cd-primary">
                  {editing.docTitle ?? '결재 문서'}에 사용된 영수증이라 내용을 고칠 수 없습니다. 문서에서 먼저 제거하세요.
                </Text>
              </View>
            ) : null}

            <View className="gap-1.5">
              <Text className="text-[13px] font-bold text-cd-muted">사용일</Text>
              <Pressable
                onPress={() => !locked && setDatePicker(true)}
                className={`min-h-[46px] flex-row items-center justify-between rounded-xl border border-cd-border px-3.5 py-3 ${
                  locked ? 'opacity-60' : 'active:opacity-70'
                }`}
                style={{ backgroundColor: c.card }}>
                <Text className={`text-[15px] ${form.date ? 'text-cd-text' : 'text-cd-faint'}`}>
                  {form.date || '날짜 선택'}
                </Text>
                <Ionicons name="calendar-outline" size={17} color={c.muted} />
              </Pressable>
            </View>
            <Input
              label="사용 시각 (선택)"
              value={form.time}
              onChangeText={(v) => setForm((s) => ({ ...s, time: v }))}
              placeholder="12:30"
              keyboardType="numbers-and-punctuation"
              editable={!locked}
            />
            <Input
              label="상호"
              value={form.storeName}
              onChangeText={(v) => setForm((s) => ({ ...s, storeName: v }))}
              editable={!locked}
            />
            {editing.storeCorpNum ? (
              <Text className="-mt-1 text-[11.5px] text-cd-faint">
                사업자번호 {fmtCorpNum(editing.storeCorpNum)}
              </Text>
            ) : null}
            <Input
              label="금액"
              value={form.totalAmount}
              onChangeText={(v) => setForm((s) => ({ ...s, totalAmount: v }))}
              keyboardType="number-pad"
              editable={!locked}
            />
            <Input
              label="메모"
              value={form.memo}
              onChangeText={(v) => setForm((s) => ({ ...s, memo: v }))}
              placeholder="(선택)"
            />

            {!locked ? (
              <Button
                label="영수증 삭제"
                variant="danger"
                icon="trash"
                onPress={() => setConfirmDelete(true)}
                disabled={busy}
                full
              />
            ) : null}
          </ScrollView>
        ) : null}
      </Sheet>

      <DatePickerSheet
        visible={datePicker}
        title="사용일 선택"
        value={form.date || null}
        onConfirm={(from) => {
          setForm((s) => ({ ...s, date: from }));
          setDatePicker(false);
        }}
        onClose={() => setDatePicker(false)}
      />

      <ConfirmSheet
        visible={confirmDelete}
        title="영수증을 삭제할까요?"
        message="이미지와 증빙 PDF까지 함께 지워집니다. 되돌릴 수 없습니다."
        confirmLabel="삭제"
        danger
        loading={busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </SafeAreaView>
  );
}
