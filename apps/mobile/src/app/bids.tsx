import { useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import {
  ActionBar,
  Badge,
  Button,
  ConfirmSheet,
  EmptyState,
  Screen,
  SegmentedTabs,
  Sheet,
  SkeletonList,
  useToast,
} from '@/components/ui';
import type { SegmentItem } from '@/components/ui';
import { DatePickerSheet } from '@/components/calendar/DatePickerSheet';
import { apiJson } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/auth-context';
import { ACTIVITY_TYPES } from '@/lib/sales/types';
import { useTheme } from '@/theme/useTheme';

/** 발송 항목 구성(웹 알림 설정) 그대로 내려오는 상세 항목 — 값이 있는 것만 담겨 온다. */
interface MatchDetail {
  label: string;
  value: string;
  /** 원문 링크 항목 — 상세 카드 맨 아래 버튼으로 렌더한다. */
  link?: boolean;
}

interface BidMatch {
  noticeId: string;
  bidType: string;
  bidId: string;
  categoryName: string | null;
  title: string | null;
  orgName: string | null;
  regionGroup?: string | null;
  budget: number | null;
  postedAt: string | null;
  deadline: string | null;
  url: string | null;
  matchedAt: string | null;
  details?: MatchDetail[];
}

type Tab = 'recent' | 'posted' | 'deadline';

const SEGMENTS: SegmentItem<Tab>[] = [
  { key: 'recent', label: '최근 매칭' },
  { key: 'posted', label: '최근 공고' },
  { key: 'deadline', label: '마감 임박' },
];
const TYPE_LABEL: Record<string, string> = {
  order_plan: '발주계획',
  prior_spec: '사전규격',
  bid_notice: '입찰공고',
};

/** 지역권 키워드 — 서버 `lib/bid/bid-queries.ts` REGION_GROUPS 의 사본(구 서버 응답 폴백용). */
const REGION_GROUPS: Record<string, string[]> = {
  수도권: ['서울', '경기', '인천'],
  강원권: ['강원'],
  충청권: ['충남', '충북', '충청', '대전', '세종'],
  경북권: ['경북', '경상북도', '대구'],
  경남권: ['경남', '경상남도', '부산', '울산'],
  전라권: ['전북', '전남', '전라', '광주'],
  제주권: ['제주'],
};

/**
 * 용역 분류 태그 색 — 분류는 웹에서 사용자가 만드는 동적 목록이라 고정 매핑이 불가능하다.
 * 분류 목록 순서대로 **영업 스케줄 8종 태그 팔레트**(사용자 지정, ACTIVITY_TYPES)를 순환
 * 할당한다(이름 해시는 비슷한 색이 우연히 겹쳐 "다 똑같아 보이는" 문제가 실제로 났다).
 * 분류를 8개 넘게 만들 일은 사실상 없어 순환이 겹칠 일도 없다.
 */
const CAT_TINTS: { bg: string; text: string }[] = ACTIVITY_TYPES.map((t) => ({ bg: t.color, text: t.ink }));

const money = (n?: number | null) =>
  n && n > 0 ? `${Math.round(n / 10000).toLocaleString('ko-KR')}만원` : '';

/** MM/DD 짧은 날짜 — 공고일 태그용. */
const md = (iso?: string | null) => {
  const d = (iso ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(5, 7)}/${d.slice(8, 10)}` : null;
};

/** 마감까지 남은 일수. 마감이 없거나 형식이 다르면 null. */
function dday(deadline: string | null, today: string): number | null {
  if (!deadline) return null;
  const d = deadline.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const ms = Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Number.isNaN(ms) ? null : Math.round(ms / 86400000);
}

/** 발주기관명 → 지역권(응답에 regionGroup 이 없을 때의 클라 폴백). */
function regionOf(b: BidMatch): string | null {
  if (b.regionGroup !== undefined) return b.regionGroup;
  const org = b.orgName ?? '';
  for (const [g, keys] of Object.entries(REGION_GROUPS)) {
    if (keys.some((k) => org.includes(k))) return g;
  }
  return null;
}

/**
 * 공공입찰 매칭 공고(M6-C → P6 확장) — 푸시 알림의 착지 화면.
 *
 * 정렬 3종(최근 매칭·최근 공고·마감 임박) + 용역 구분·지역권 필터 + 선택/일괄 하드 삭제.
 * 필터는 서버(?categories=&regions=)가 원천이고, 구 서버(파라미터 미지원)에서도 화면이
 * 맞게 보이도록 클라이언트에서 한 번 더 거른다(서버가 걸렀으면 전부 통과라 무해).
 * 삭제는 되돌릴 수 없고 웹 알림 이력에서도 사라진다(하드 삭제 — 사용자 확정).
 */
export default function BidsScreen() {
  const { c } = useTheme();
  const toast = useToast();
  const { user } = useAuth();
  const canEdit = user?.role === 'admin' || user?.role === 'editor';
  const params = useLocalSearchParams<{ filter?: string }>();
  const [tab, setTab] = useState<Tab>(params.filter === 'deadline' ? 'deadline' : 'recent');
  const [cats, setCats] = useState<string[]>([]);
  const [regs, setRegs] = useState<string[]>([]);
  /** 펼쳐 둔 카드(noticeId) — 여러 건 동시에 펼칠 수 있다. */
  const [expanded, setExpanded] = useState<string[]>([]);
  /** 선택 모드 — 카드 탭이 펼침 대신 선택 토글이 된다. */
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<null | 'picked' | 'all' | 'range'>(null);
  /** 일괄 삭제 방식 선택 시트 · 기간 지정 픽커 · 지정된 기간(공고일 기준). */
  const [bulkOpen, setBulkOpen] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const qs = [
    'limit=60',
    tab === 'deadline' ? 'filter=deadline' : tab === 'posted' ? 'sort=posted' : '',
    cats.length ? `categories=${encodeURIComponent(cats.join(','))}` : '',
    regs.length ? `regions=${encodeURIComponent(regs.join(','))}` : '',
  ]
    .filter(Boolean)
    .join('&');
  const list = useApi<{ items: BidMatch[]; today: string; categories?: string[]; regionGroups?: string[] }>(
    `/api/sales/bids/matches?${qs}`,
    { cache: true }
  );

  const raw = list.data?.items ?? [];
  // 클라 이중 필터(구 서버 폴백) — 지역권은 응답 regionGroup 우선, 없으면 기관명 판정.
  const items = useMemo(
    () =>
      raw.filter(
        (b) =>
          (!cats.length || (b.categoryName != null && cats.includes(b.categoryName))) &&
          (!regs.length || regs.includes(regionOf(b) ?? ''))
      ),
    [raw, cats, regs]
  );
  const today = list.data?.today ?? new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const loading = list.loading && !list.data;

  // 필터 옵션 — 서버 facet 우선, 구 서버는 현재 페이지의 분류로 폴백.
  const catOptions = useMemo(() => {
    const server = list.data?.categories;
    if (server?.length) return server;
    return [...new Set(raw.map((b) => b.categoryName).filter((x): x is string => !!x))].sort();
  }, [list.data, raw]);
  const regionOptions = list.data?.regionGroups ?? Object.keys(REGION_GROUPS);

  // 분류 → 태그 색: 옵션 목록 순서로 팔레트 순환(같은 분류는 같은 색, 인접 분류는 다른 색).
  const catTintMap = useMemo(() => {
    const names = [...catOptions];
    for (const b of raw) {
      if (b.categoryName && !names.includes(b.categoryName)) names.push(b.categoryName);
    }
    return new Map(names.map((n, i) => [n, CAT_TINTS[i % CAT_TINTS.length]]));
  }, [catOptions, raw]);
  const tintOf = (name: string) => catTintMap.get(name) ?? CAT_TINTS[0];

  const toggleIn = (arr: string[], v: string) =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const toggle = (noticeId: string) => {
    if (selecting) {
      setPicked((prev) => toggleIn(prev, noticeId));
      return;
    }
    setExpanded((prev) => toggleIn(prev, noticeId));
  };

  const exitSelect = () => {
    setSelecting(false);
    setPicked([]);
  };

  const runDelete = async () => {
    setDeleting(true);
    try {
      const body =
        confirm === 'picked'
          ? { noticeIds: picked }
          : {
              all: true,
              filter: tab === 'deadline' ? 'deadline' : undefined,
              categories: cats.length ? cats : undefined,
              regions: regs.length ? regs : undefined,
              // 기간별 삭제 — 공고일 기준(공고일이 없는 건은 매칭일로 판정, 서버 규칙).
              ...(confirm === 'range' && range ? { postedFrom: range.from, postedTo: range.to } : {}),
            };
      const res = await apiJson<{ deleted: number }>('/api/sales/bids/matches', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      toast.show(`${res.deleted}건을 삭제했습니다.`, 'success');
      setConfirm(null);
      exitSelect();
      await list.reload();
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setDeleting(false);
    }
  };

  const open = async (url: string | null) => {
    if (!url) {
      toast.show('원문 링크가 없는 공고입니다.', 'info');
      return;
    }
    const ok = await Linking.canOpenURL(url).catch(() => false);
    if (!ok) {
      toast.show('링크를 열 수 없습니다.', 'error');
      return;
    }
    await Linking.openURL(url);
  };

  const body = useMemo(() => {
    if (loading) return <SkeletonList count={4} />;
    // 영업 조회 권한이 없는 계정은 403 — "공고가 없다"로 보이면 오해하므로 사유를 밝힌다.
    if (list.error && !items.length) {
      return (
        <EmptyState
          icon="lock-closed-outline"
          title="열람 권한이 없습니다"
          description="공공입찰 조회 권한이 필요합니다. 관리자에게 문의해 주세요."
        />
      );
    }
    if (!items.length) {
      return (
        <EmptyState
          icon="briefcase-outline"
          title={
            cats.length || regs.length
              ? '조건에 맞는 공고가 없습니다'
              : tab === 'deadline'
                ? '마감이 남은 공고가 없습니다'
                : '매칭된 공고가 없습니다'
          }
        />
      );
    }
    return items.map((b) => {
      const d = dday(b.deadline, today);
      const urgent = d != null && d <= 3;
      const isOpen = expanded.includes(b.noticeId);
      const isPicked = picked.includes(b.noticeId);
      const region = regionOf(b);
      const posted = md(b.postedAt);
      const details = b.details ?? [];
      const rows = details.filter((x) => !x.link);
      // 원문은 상세 항목 안의 링크를 우선 쓰고, 없으면 목록의 url 로 대체한다.
      const linkItem = details.find((x) => x.link);
      const linkUrl = linkItem?.value ?? b.url;

      return (
        <Pressable
          key={b.noticeId}
          onPress={() => toggle(b.noticeId)}
          className="rounded-card border bg-cd-card p-4 active:opacity-70"
          style={{ borderColor: selecting && isPicked ? '#6b7cf6' : c.border, borderWidth: selecting && isPicked ? 1.5 : 1 }}>
          <View className="flex-row items-center gap-2">
            {selecting ? (
              <Ionicons
                name={isPicked ? 'checkmark-circle' : 'ellipse-outline'}
                size={19}
                color={isPicked ? '#6b7cf6' : c.faint}
              />
            ) : null}
            <Badge label={TYPE_LABEL[b.bidType] ?? b.bidType} tone="primary" />
            {region ? <Badge label={region} tone="neutral" /> : null}
            {b.categoryName ? (
              <View className="max-w-[40%] rounded-md px-1.5 py-[3px]" style={{ backgroundColor: tintOf(b.categoryName).bg }}>
                <Text className="text-[10.5px] font-bold" numberOfLines={1} style={{ color: tintOf(b.categoryName).text }}>
                  {b.categoryName}
                </Text>
              </View>
            ) : null}
            <View className="flex-1" />
            {d != null ? (
              <Text
                className="text-[11px] font-extrabold"
                style={{ color: urgent ? c.error : c.faint }}>
                {d === 0 ? '오늘 마감' : `D-${d}`}
              </Text>
            ) : null}
          </View>

          <Text className="mt-2 text-[15px] font-bold text-cd-text" numberOfLines={2}>
            {b.title || '(제목 없음)'}
          </Text>

          <View className="mt-1 flex-row items-center gap-2">
            <Text className="flex-1 text-[12px] text-cd-muted" numberOfLines={1}>
              {b.orgName ?? '-'}
            </Text>
            {money(b.budget) ? (
              <Text className="text-[12px] text-cd-muted">{money(b.budget)}</Text>
            ) : null}
          </View>

          <View className="mt-2 flex-row items-center gap-1 border-t border-cd-border pt-2">
            <Text className="flex-1 text-[11px] text-cd-faint">
              {[posted ? `공고 ${posted}` : null, b.deadline ? `마감 ${b.deadline.slice(0, 10)}` : '마감 미정']
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {!selecting ? (
              <>
                <Text className="text-[11px] font-bold" style={{ color: c.primary }}>
                  {isOpen ? '접기' : '상세 보기'}
                </Text>
                <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={13} color={c.primary} />
              </>
            ) : null}
          </View>

          {/* 상세 카드 — 알림 발송 항목 구성 그대로(값이 있는 항목만), 맨 아래에 원문 링크 */}
          {isOpen && !selecting ? (
            <View className="mt-3 rounded-card border border-cd-border bg-cd-bg p-3">
              {rows.length ? (
                rows.map((f) => (
                  <View key={f.label} className="flex-row gap-2 py-1">
                    <Text className="w-[104px] text-[11px] text-cd-faint">{f.label}</Text>
                    <Text className="flex-1 text-[12px] text-cd-text">{f.value}</Text>
                  </View>
                ))
              ) : (
                <Text className="py-1 text-[12px] text-cd-muted">표시할 상세 정보가 없습니다.</Text>
              )}
              {linkUrl ? (
                <Pressable
                  onPress={() => open(linkUrl)}
                  className="mt-2 flex-row items-center justify-center gap-1 rounded-card border border-cd-border py-2 active:opacity-70">
                  <Text className="text-[12px] font-bold" style={{ color: c.primary }}>
                    원문 열기
                  </Text>
                  <Ionicons name="open-outline" size={14} color={c.primary} />
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </Pressable>
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, loading, list.error, tab, today, c, expanded, selecting, picked, cats.length, regs.length, catTintMap]);

  return (
    <View className="flex-1">
      <Screen scroll padded={false} refreshing={list.refreshing} onRefresh={list.reload}>
        <SegmentedTabs items={SEGMENTS} value={tab} onChange={setTab} />

        {/* 필터 칩 — 용역 구분·지역권(다중 선택, 서버 필터) + 우측 끝 선택 모드 토글 */}
        <View className="gap-1.5 px-4 pt-1">
          {catOptions.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {catOptions.map((x) => (
                <FilterChip
                  key={x}
                  label={x}
                  on={cats.includes(x)}
                  tint={tintOf(x)}
                  onPress={() => setCats((p) => toggleIn(p, x))}
                />
              ))}
            </ScrollView>
          ) : null}
          <View className="flex-row items-center gap-1.5">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} className="flex-1">
              {regionOptions.map((x) => (
                <FilterChip key={x} label={x} on={regs.includes(x)} onPress={() => setRegs((p) => toggleIn(p, x))} />
              ))}
            </ScrollView>
            {canEdit && items.length ? (
              <Pressable onPress={() => (selecting ? exitSelect() : setSelecting(true))} hitSlop={8} className="active:opacity-60">
                <Text className="text-[12px] font-bold" style={{ color: selecting ? c.faint : '#6b7cf6' }}>
                  {selecting ? '취소' : '선택'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        <View className="gap-3 p-4 pt-2">{body}</View>
      </Screen>

      {/* 선택 모드 하단 액션 — 하드 삭제(웹 이력에서도 사라진다) */}
      {selecting ? (
        <ActionBar>
          <View className="flex-1">
            <Button
              label={`선택 삭제${picked.length ? ` (${picked.length})` : ''}`}
              variant="danger"
              disabled={!picked.length}
              onPress={() => setConfirm('picked')}
            />
          </View>
          <View className="flex-1">
            <Button label="기간·전체 삭제" variant="ghost" onPress={() => setBulkOpen(true)} />
          </View>
        </ActionBar>
      ) : null}

      {/* 일괄 삭제 방식 — 기간 지정(공고일 기준) 또는 현재 조건 전체 */}
      <Sheet visible={bulkOpen && !rangeOpen} onClose={() => setBulkOpen(false)} title="일괄 삭제">
        <View className="gap-1 pb-1">
          <BulkRow
            icon="calendar-outline"
            title="기간 지정 삭제"
            desc="공고일 기준으로 기간을 골라 그 기간의 공고를 삭제합니다."
            onPress={() => setRangeOpen(true)}
          />
          <BulkRow
            icon="trash-outline"
            title="현재 조건 전체 삭제"
            desc={`지금 정렬·필터에 해당하는 공고 전체(화면에 ${items.length}건 표시 중).`}
            onPress={() => {
              setBulkOpen(false);
              setConfirm('all');
            }}
          />
          <Text className="pt-1 text-[11.5px] text-cd-faint">
            삭제하면 되돌릴 수 없으며, 웹의 알림 이력에서도 함께 사라집니다.
          </Text>
        </View>
      </Sheet>

      <DatePickerSheet
        visible={rangeOpen}
        mode="range"
        title="삭제할 기간(공고일)"
        value={range?.from ?? null}
        valueTo={range?.to ?? null}
        onConfirm={(from, to) => {
          setRange({ from, to });
          setBulkOpen(false);
          setConfirm('range');
        }}
        onClose={() => setRangeOpen(false)}
      />

      <ConfirmSheet
        visible={!!confirm}
        danger
        loading={deleting}
        title={
          confirm === 'picked'
            ? `${picked.length}건을 삭제합니다`
            : confirm === 'range'
              ? `${range?.from ?? ''} ~ ${range?.to ?? ''} 공고를 삭제합니다`
              : '현재 조건의 공고를 모두 삭제합니다'
        }
        message={
          (confirm === 'all'
            ? `정렬·필터에 해당하는 매칭 알림 전체가 대상입니다(화면에 ${items.length}건 표시 중). `
            : confirm === 'range'
              ? '지정한 기간의 공고가 대상이며, 켜 둔 용역 구분·지역권 필터도 함께 적용됩니다. '
              : '') + '삭제하면 되돌릴 수 없으며, 웹의 알림 이력에서도 함께 사라집니다.'
        }
        confirmLabel="삭제"
        onConfirm={runDelete}
        onCancel={() => setConfirm(null)}
      />
    </View>
  );
}

/** 일괄 삭제 방식 선택 행. */
function BulkRow({
  icon,
  title,
  desc,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  desc: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-xl border border-cd-border bg-cd-card p-3.5 active:opacity-70">
      <Ionicons name={icon} size={18} color="#6b7cf6" />
      <View className="flex-1">
        <Text className="text-[14px] font-bold text-cd-text">{title}</Text>
        <Text className="mt-0.5 text-[11.5px] leading-4 text-cd-faint">{desc}</Text>
      </View>
      <Ionicons name="chevron-forward" size={15} color="#9aa0b8" />
    </Pressable>
  );
}

/** 필터 칩 — 선택은 틴트 채움(tint 를 주면 분류색, 없으면 primary), 비선택은 윤곽선. */
function FilterChip({
  label,
  on,
  tint,
  onPress,
}: {
  label: string;
  on: boolean;
  tint?: { bg: string; text: string };
  onPress: () => void;
}) {
  const t = tint ?? { bg: '#e3e6fb', text: '#4353e4' };
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-[5px] rounded-full px-[11px] py-[6px] active:opacity-70"
      style={{
        backgroundColor: on ? t.bg : 'transparent',
        borderWidth: on ? 0 : 1,
        borderColor: '#e3e6ef',
      }}>
      {tint ? <View style={{ backgroundColor: t.text }} className="h-[6px] w-[6px] rounded-full opacity-70" /> : null}
      <Text className={`text-[11.5px] ${on ? 'font-bold' : 'font-semibold'}`} style={{ color: on ? t.text : '#9aa0b8' }}>
        {label}
      </Text>
    </Pressable>
  );
}
