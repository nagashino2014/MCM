import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import {
  ActionBar,
  Badge,
  Button,
  ConfirmSheet,
  EmptyState,
  FilterPill,
  Screen,
  Sheet,
  SkeletonList,
  useToast,
} from '@/components/ui';
import { DatePickerSheet } from '@/components/calendar/DatePickerSheet';
import { apiJson } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/auth-context';
import { ACTIVITY_TYPES } from '@/lib/sales/types';
import { SHADOW_CARD } from '@/theme/tokens';
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

/** 웹 알림 설정의 발송 조건(프로파일) — 목록 상단 버튼(최대 4개)으로 그 조건의 공고만 본다. */
interface NotifyProfileTag {
  profileId: string;
  name: string;
  enabled: boolean;
}

/** 알림 조건 버튼 칸 수 — 소스 태그(3개 + 여백 1칸)와 같은 너비로 맞춘다(사용자 확정 2026-10-19). */
const PROFILE_SLOTS = 4;
/** 우측 필터 토글 버튼 한 변(pt) — 알림 조건 행의 우측 여백도 이 폭으로 맞춘다. */
const FILTER_BTN = 36;
/** 앱 목록 표시 기간(개월) — 지난 공고는 앱에서만 사라지고 웹 목록은 영구 보존(2026-10-19). */
const MAX_AGE_MONTHS = 3;

const TYPE_LABEL: Record<string, string> = {
  order_plan: '발주계획',
  prior_spec: '사전규격',
  bid_notice: '입찰공고',
};

/** 입찰 소스 3태그(동일 너비 필터) — 알림 조건 버튼 아래 배치(사용자 확정 2026-08-10 → 10-19). */
const SOURCE_TAGS: { key: string; label: string }[] = [
  { key: 'bid_notice', label: '입찰 공고' },
  { key: 'order_plan', label: '발주 계획' },
  { key: 'prior_spec', label: '사전 규격' },
];

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
 * 카드의 분류 태그와 상단 알림 조건 버튼(이름이 분류와 같으면 같은 색)이 함께 쓴다.
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

/** 오늘(YYYY-MM-DD)에서 N개월 전 — 구 서버(maxAgeMonths 미지원) 응답을 클라에서 한 번 더 거르는 기준. */
function monthsAgo(today: string, n: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * 공공입찰 매칭 공고(M6-C → P6 확장) — 푸시 알림의 착지 화면.
 *
 * 알림 조건 버튼(웹 발송 조건, 최대 4개 — 분류색 점 필) + 입찰 소스 3태그 + 지역권 필터 드롭다운
 * + 선택/일괄 하드 삭제. 용역 분류 칩은 알림 조건 버튼과 이름이 겹쳐 2026-11-03 드롭다운에서 제거했다
 * (분류는 알림 조건으로 고르고, 카드의 분류 태그 색만 남긴다).
 * 정렬은 최근 매칭순 고정(정렬 3탭은 2026-10-19 제거), 공고일 기준 최근 3개월만 보인다.
 * 필터는 서버(?profile=&types=&regions=)가 원천이고, 구 서버(파라미터 미지원)에서도 화면이
 * 맞게 보이도록 클라이언트에서 한 번 더 거른다(서버가 걸렀으면 전부 통과라 무해).
 * 삭제는 되돌릴 수 없고 웹 알림 이력에서도 사라진다(하드 삭제 — 사용자 확정).
 */
export default function BidsScreen() {
  const { c, dark } = useTheme();
  const toast = useToast();
  const { user } = useAuth();
  const canEdit = user?.role === 'admin' || user?.role === 'editor';
  /** 선택한 알림 조건(단일 선택 — 다시 누르면 해제). */
  const [profile, setProfile] = useState<string | null>(null);
  const [types, setTypes] = useState<string[]>([]);
  const [regs, setRegs] = useState<string[]>([]);
  /** 지역권 필터 드롭다운 — 필터 아이콘으로 접고 편다(기본 접힘). */
  const [filterOpen, setFilterOpen] = useState(false);
  /** 펼쳐 둔 카드(noticeId) — 여러 건 동시에 펼칠 수 있다. */
  const [expanded, setExpanded] = useState<string[]>([]);
  /** 선택 모드 — 카드 탭이 펼침 대신 선택 토글이 된다. */
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<null | 'picked' | 'all' | 'range' | 'one'>(null);
  /** 개별 삭제 대상(카드 휴지통 버튼). */
  const [confirmOne, setConfirmOne] = useState<string | null>(null);
  /** 일괄 삭제 방식 선택 시트 · 기간 지정 픽커 · 지정된 기간(공고일 기준). */
  const [bulkOpen, setBulkOpen] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const qs = [
    'limit=60',
    `maxAgeMonths=${MAX_AGE_MONTHS}`,
    profile ? `profile=${encodeURIComponent(profile)}` : '',
    types.length ? `types=${encodeURIComponent(types.join(','))}` : '',
    regs.length ? `regions=${encodeURIComponent(regs.join(','))}` : '',
  ]
    .filter(Boolean)
    .join('&');
  const list = useApi<{
    items: BidMatch[];
    today: string;
    since?: string;
    categories?: string[];
    regionGroups?: string[];
    profiles?: NotifyProfileTag[];
  }>(
    `/api/sales/bids/matches?${qs}`,
    { cache: true }
  );

  const raw = list.data?.items ?? [];
  const today = list.data?.today ?? new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const since = list.data?.since ?? monthsAgo(today, MAX_AGE_MONTHS);
  // 클라 이중 필터(구 서버 폴백) — 지역권은 응답 regionGroup 우선, 없으면 기관명 판정.
  // 3개월 창도 서버(maxAgeMonths)와 같은 기준(공고일, 없으면 매칭일)으로 한 번 더 거른다.
  const items = useMemo(
    () =>
      raw.filter(
        (b) =>
          (!types.length || types.includes(b.bidType)) &&
          (!regs.length || regs.includes(regionOf(b) ?? '')) &&
          (!since || (b.postedAt || b.matchedAt || '').slice(0, 10) >= since)
      ),
    [raw, types, regs, since]
  );
  const profiles = (list.data?.profiles ?? []).slice(0, PROFILE_SLOTS);
  // 선택한 조건이 웹에서 삭제됐으면 선택을 푼다(없는 조건으로 빈 목록이 고정되지 않게).
  useEffect(() => {
    if (profile && list.data?.profiles && !list.data.profiles.some((p) => p.profileId === profile)) {
      setProfile(null);
    }
  }, [profile, list.data]);
  const loading = list.loading && !list.data;

  // 분류 목록(태그 색 순환 기준) — 서버 facet 우선, 구 서버는 현재 페이지의 분류로 폴백.
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
  /** 알림 조건 버튼 색 — 조건 이름이 분류 이름과 같으면 그 분류색, 아니면 버튼 순서대로 팔레트 순환. */
  const profileTint = (p: NotifyProfileTag, i: number) => catTintMap.get(p.name) ?? CAT_TINTS[i % CAT_TINTS.length];

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
        confirm === 'one'
          ? { noticeIds: confirmOne ? [confirmOne] : [] }
          : confirm === 'picked'
            ? { noticeIds: picked }
            : {
                all: true,
                // 앱 표시 창(3개월) 밖의 행은 지우지 않는다 — 웹 목록은 영구 보존.
                maxAgeMonths: MAX_AGE_MONTHS,
                profile: profile ?? undefined,
                types: types.length ? types : undefined,
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
          title={profile || types.length || regs.length ? '조건에 맞는 공고가 없습니다' : '매칭된 공고가 없습니다'}
          description={`최근 ${MAX_AGE_MONTHS}개월 공고만 표시합니다.`}
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
          className="rounded-lg border bg-cd-card p-4 active:opacity-80"
          style={[
            { borderColor: selecting && isPicked ? c.primary : c.cardBorder, borderWidth: selecting && isPicked ? 1.5 : 1 },
            dark ? SHADOW_CARD.dark : SHADOW_CARD.light,
          ]}>
          <View className="flex-row items-center gap-2">
            {selecting ? (
              <Ionicons
                name={isPicked ? 'checkmark-circle' : 'ellipse-outline'}
                size={19}
                color={isPicked ? c.primary : c.faint}
              />
            ) : null}
            <Badge label={TYPE_LABEL[b.bidType] ?? b.bidType} tone="primary" />
            {region ? <Badge label={region} tone="neutral" /> : null}
            {b.categoryName ? (
              // 분류 태그 — 분류색 연한 바탕(알림 조건 버튼과 같은 색). Badge 와 같은 pill 규격.
              <View className="h-5 max-w-[40%] justify-center rounded-full px-2" style={{ backgroundColor: tintOf(b.categoryName).bg }}>
                <Text className="text-[12px] font-medium" numberOfLines={1} style={{ color: tintOf(b.categoryName).text }}>
                  {b.categoryName}
                </Text>
              </View>
            ) : null}
            <View className="flex-1" />
            {d != null ? (
              <Text
                className="text-[12px] font-semibold"
                style={{ color: urgent ? c.error : c.muted }}>
                {d === 0 ? '오늘 마감' : d < 0 ? '마감' : `D-${d}`}
              </Text>
            ) : null}
          </View>

          <Text className="mt-2 text-[15px] font-medium text-cd-text" numberOfLines={2}>
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
            <Text className="flex-1 text-[12px] text-cd-muted">
              {[posted ? `공고 ${posted}` : null, b.deadline ? `마감 ${b.deadline.slice(0, 10)}` : '마감 미정']
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {!selecting ? (
              <>
                {canEdit ? (
                  // 개별 삭제(사용자 확정 2026-08-10) — 확인 시트를 거쳐 하드 삭제.
                  <Pressable
                    onPress={() => {
                      setConfirmOne(b.noticeId);
                      setConfirm('one');
                    }}
                    hitSlop={8}
                    className="mr-2 active:opacity-60">
                    <Ionicons name="trash-outline" size={15} color={c.faint} />
                  </Pressable>
                ) : null}
                <Text className="text-[13px] font-medium" style={{ color: c.primary }}>
                  {isOpen ? '접기' : '상세 보기'}
                </Text>
                <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={13} color={c.primary} />
              </>
            ) : null}
          </View>

          {/* 상세 영역 — 알림 발송 항목 구성 그대로(값이 있는 항목만), 맨 아래에 원문 링크.
              카드 안 카드가 되지 않도록 surface 바탕만 깔고 테두리·그림자는 두지 않는다. */}
          {isOpen && !selecting ? (
            <View className="mt-3 rounded-lg bg-cd-surface p-3">
              {rows.length ? (
                rows.map((f) => (
                  <View key={f.label} className="flex-row gap-2 py-1">
                    <Text className="w-[104px] text-[12px] text-cd-muted">{f.label}</Text>
                    <Text className="flex-1 text-[12px] text-cd-text">{f.value}</Text>
                  </View>
                ))
              ) : (
                <Text className="py-1 text-[12px] text-cd-muted">표시할 상세 정보가 없습니다.</Text>
              )}
              {linkUrl ? (
                <Pressable
                  onPress={() => open(linkUrl)}
                  className="mt-2 flex-row items-center justify-center gap-1 rounded-lg border border-cd-border bg-cd-card py-2 active:opacity-70">
                  <Text className="text-[13px] font-medium" style={{ color: c.primary }}>
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
  }, [items, loading, list.error, profile, types.length, today, c, dark, expanded, selecting, picked, canEdit, regs.length, catTintMap]);

  return (
    <View className="flex-1">
      <Screen scroll padded={false} refreshing={list.refreshing} onRefresh={list.reload}>
        <View className="gap-1.5 px-4 pt-3">
          {/* 알림 조건 버튼 — 웹 발송 조건(기술진단·통합허가 등) 최대 4칸, 소스 태그와 같은 너비.
              분류색 점 + 선택 시 그 색의 연한 바탕(카드의 분류 태그와 같은 색). 우측 끝은 필터 버튼
              폭만큼 비워 아래 행과 칸을 맞춘다. 꺼진 조건은 종 꺼짐 아이콘. */}
          {profiles.length ? (
            <View className="flex-row items-center gap-1.5">
              {Array.from({ length: PROFILE_SLOTS }, (_, i) => {
                const p = profiles[i];
                if (!p) return <View key={`empty-${i}`} className="flex-1" />;
                const on = profile === p.profileId;
                const tint = profileTint(p, i);
                return (
                  <FilterPill
                    key={p.profileId}
                    size="sm"
                    label={p.name}
                    active={on}
                    grow
                    dot={tint.text}
                    tint={tint}
                    icon={
                      !p.enabled ? (
                        <Ionicons name="notifications-off-outline" size={12} color={on ? tint.text : c.faint} />
                      ) : undefined
                    }
                    onPress={() => setProfile(on ? null : p.profileId)}
                  />
                );
              })}
              <View style={{ width: FILTER_BTN }} />
            </View>
          ) : null}

          {/* 입찰 소스 3태그 + 1칸 여백(알림 조건 4칸과 너비 정렬) + 우측 끝 필터 토글(지역권 드롭다운) */}
          <View className="flex-row items-center gap-1.5">
            {SOURCE_TAGS.map((t) => (
              <FilterPill
                key={t.key}
                size="sm"
                label={t.label}
                active={types.includes(t.key)}
                grow
                onPress={() => setTypes((p) => toggleIn(p, t.key))}
              />
            ))}
            <View className="flex-1" />
            <Pressable
              onPress={() => setFilterOpen((v) => !v)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityState={{ expanded: filterOpen }}
              className="items-center justify-center rounded-lg border active:opacity-60"
              style={{
                width: FILTER_BTN,
                height: FILTER_BTN,
                borderColor: c.border,
                backgroundColor: filterOpen ? c.primarySoft : 'transparent',
              }}>
              <Ionicons
                name="options-outline"
                size={18}
                color={filterOpen || regs.length ? c.primaryStrong : c.muted}
              />
              {regs.length ? (
                <View className="absolute right-1 top-1 h-2 w-2 rounded-full" style={{ backgroundColor: c.primary }} />
              ) : null}
            </Pressable>
          </View>

          {/* 드롭다운 — 지역권 칩(다중 선택, 서버 필터). 지역은 "권"을 뗀 2글자 표기, 7개를 한 줄(sm). */}
          {filterOpen ? (
            <View className="flex-row gap-1">
              {regionOptions.map((x) => (
                <FilterPill
                  key={x}
                  size="sm"
                  label={x.replace(/권$/, '')}
                  active={regs.includes(x)}
                  onPress={() => setRegs((p) => toggleIn(p, x))}
                />
              ))}
            </View>
          ) : null}

          {/* 선택 모드·일괄 삭제 진입(편집 권한) — 필터 버튼과 붙으면 오조작이 나서 여백을 둔다. */}
          {canEdit && items.length ? (
            <View className="mt-2 flex-row items-center justify-end gap-4 pb-0.5">
              <Pressable onPress={() => (selecting ? exitSelect() : setSelecting(true))} hitSlop={8} className="active:opacity-60">
                <Text className="text-[13px] font-medium" style={{ color: selecting ? c.muted : c.primary }}>
                  {selecting ? '취소' : '선택'}
                </Text>
              </Pressable>
              {!selecting ? (
                <Pressable onPress={() => setBulkOpen(true)} hitSlop={8} className="flex-row items-center gap-1 active:opacity-60">
                  <Ionicons name="trash-outline" size={13} color={c.error} />
                  <Text className="text-[13px] font-medium text-cd-error">일괄 삭제</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
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
              full
              onPress={() => setConfirm('picked')}
            />
          </View>
          <View className="flex-1">
            <Button label="기간·전체 삭제" variant="ghost" full onPress={() => setBulkOpen(true)} />
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
            desc={`지금 알림 조건·필터에 해당하는 최근 ${MAX_AGE_MONTHS}개월 공고 전체(화면에 ${items.length}건 표시 중).`}
            onPress={() => {
              setBulkOpen(false);
              setConfirm('all');
            }}
          />
          <Text className="pt-1 text-[12px] text-cd-muted">
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
          confirm === 'one'
            ? '이 공고를 삭제합니다'
            : confirm === 'picked'
              ? `${picked.length}건을 삭제합니다`
              : confirm === 'range'
                ? `${range?.from ?? ''} ~ ${range?.to ?? ''} 공고를 삭제합니다`
                : '현재 조건의 공고를 모두 삭제합니다'
        }
        message={
          (confirm === 'all'
            ? `알림 조건·필터(소스 태그 포함)에 해당하는 최근 ${MAX_AGE_MONTHS}개월 매칭 알림 전체가 대상입니다(화면에 ${items.length}건 표시 중). `
            : confirm === 'range'
              ? `지정한 기간의 공고가 대상이며(최근 ${MAX_AGE_MONTHS}개월 이내), 켜 둔 알림 조건·소스·지역권 필터도 함께 적용됩니다. `
              : '') + '삭제하면 되돌릴 수 없으며, 웹의 알림 이력에서도 함께 사라집니다.'
        }
        confirmLabel="삭제"
        onConfirm={runDelete}
        onCancel={() => setConfirm(null)}
      />
    </View>
  );
}

/** 일괄 삭제 방식 선택 행 — 시트 안이라 그림자 없는 평면 행(테두리만). */
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
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-lg border border-cd-border bg-cd-card p-3.5 active:opacity-70">
      <Ionicons name={icon} size={18} color={c.primary} />
      <View className="flex-1">
        <Text className="text-[14px] font-semibold text-cd-text">{title}</Text>
        <Text className="mt-0.5 text-[12px] leading-4 text-cd-muted">{desc}</Text>
      </View>
      <Ionicons name="chevron-forward" size={15} color={c.faint} />
    </Pressable>
  );
}
