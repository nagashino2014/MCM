import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Button, EmptyState, SearchBar, Sheet, SkeletonList } from '@/components/ui';
import { apiJson } from '@/lib/api';

/**
 * 검색 선택 시트 — 양식의 `company_select`·`contract_select`·`contact_select`·`asset_select` 공용.
 * 웹 `ApprovalFormRenderer` 의 4개 전용 입력이 하는 일을 하나로 모았다.
 *
 * 이 시트는 **원본 옵션 객체를 그대로 돌려준다**. 필드 값 형태로 바꾸는 일과 자동 채움
 * (`fillMap`)은 폼 렌더러가 한다 — 시트가 양식 스키마를 알 필요가 없다.
 */

export type EntityKind = 'company' | 'contract' | 'contact' | 'asset' | 'project';

export interface EntityOption {
  id: string;
  label: string;
  sub?: string;
  /** API 원본 — 자동 채움 규칙이 이 객체의 속성을 읽는다. */
  raw: Record<string, unknown>;
}

interface Source {
  title: string;
  placeholder: string;
  /** 검색 시작 글자 수. 0 이면 진입 시 전체를 받아 클라이언트에서 거른다(자산). */
  minChars: number;
  path: (q: string, opts: { assetKind?: string }) => string;
  parse: (json: unknown) => EntityOption[];
  /** 직접 입력 허용 시 버튼 문구 — 웹 렌더러의 체크박스 라벨과 같은 말을 쓴다. */
  manualLabel?: string;
}

const str = (v: unknown): string => (v == null ? '' : String(v));

const SOURCES: Record<EntityKind, Source> = {
  company: {
    title: '업체 선택',
    placeholder: '업체명 검색(2자 이상)',
    minChars: 2,
    path: (q) => `/api/facilities?q=${encodeURIComponent(q)}&limit=15&sort=name`,
    parse: (json) =>
      ((json as { items?: Record<string, unknown>[] }).items ?? []).map((o) => ({
        id: str(o.facilityId),
        label: str(o.companyName),
        sub: [str(o.regionSido), str(o.regionSigungu)].filter(Boolean).join(' ') || str(o.siteAddress),
        raw: o,
      })),
    manualLabel: '미계약 업체(직접 입력)',
  },
  contract: {
    title: '계약 선택',
    placeholder: '계약명·업체명 검색(2자 이상)',
    minChars: 2,
    path: (q) => `/api/contracts?q=${encodeURIComponent(q)}&limit=15`,
    parse: (json) =>
      ((json as { items?: Record<string, unknown>[] }).items ?? []).map((o) => ({
        id: str(o.contractId),
        label: str(o.contractTitle),
        sub: [str(o.counterpartyName), str(o.serviceType)].filter(Boolean).join(' · '),
        raw: o,
      })),
    manualLabel: '미등록 용역(직접 입력)',
  },
  contact: {
    title: '담당자 선택',
    placeholder: '담당자명 검색(2자 이상)',
    minChars: 2,
    path: (q) => `/api/approval/contacts?q=${encodeURIComponent(q)}&limit=15`,
    parse: (json) =>
      ((json as { items?: Record<string, unknown>[] }).items ?? []).map((o) => ({
        id: str(o.id),
        label: `${str(o.personName)}${o.title ? ` ${str(o.title)}` : ''}`,
        sub: str(o.facilityName),
        raw: o,
      })),
  },
  project: {
    title: '영업건 선택',
    placeholder: '영업건·사업장명 검색',
    minChars: 0, // 진행 중 영업건은 수십 건 규모 — 전체를 받아 클라이언트에서 거른다
    path: () => '/api/sales/projects?status=open',
    parse: (json) =>
      ((json as { projects?: Record<string, unknown>[] }).projects ?? []).map((o) => ({
        id: str(o.projectId),
        label: str(o.title),
        sub: str(o.facilityName),
        raw: o,
      })),
  },
  asset: {
    title: '자산 선택',
    placeholder: '자산명 검색',
    minChars: 0,
    path: (_q, opts) => `/api/assets?activeOnly=1${opts.assetKind ? `&kind=${encodeURIComponent(opts.assetKind)}` : ''}`,
    parse: (json) =>
      ((json as { assets?: Record<string, unknown>[] }).assets ?? []).map((o) => ({
        id: str(o.assetId),
        label: str(o.name),
        sub: str(o.kindLabel) || str(o.kind),
        raw: o,
      })),
  },
};

export function EntityPickerSheet({
  visible,
  kind,
  assetKind,
  title,
  onSelect,
  onManual,
  onClose,
  renderRight,
}: {
  visible: boolean;
  kind: EntityKind;
  /** 자산 종류 필터(차량 등) — asset 전용. */
  assetKind?: string;
  title?: string;
  onSelect: (opt: EntityOption) => void;
  /** 직접 입력(미등록 업체·미계약) — 업체·계약에서만 노출된다. */
  onManual?: (text: string) => void;
  onClose: () => void;
  /** 옵션 행 우측 슬롯 — 차량 예약 가용성 배지 등. */
  renderRight?: (opt: EntityOption) => React.ReactNode;
}) {
  const src = SOURCES[kind];
  const [q, setQ] = useState('');
  const [items, setItems] = useState<EntityOption[]>([]);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  // 검색형은 입력이 멎은 뒤(160ms) 조회, 목록형은 열릴 때 1회 조회.
  useEffect(() => {
    if (!visible) return;
    const term = q.trim();
    if (src.minChars > 0 && term.length < src.minChars) {
      setItems([]);
      return;
    }
    const id = ++reqId.current;
    const run = async () => {
      setLoading(true);
      try {
        const json = await apiJson<unknown>(src.path(term, { assetKind }));
        if (reqId.current === id) setItems(src.parse(json));
      } catch {
        if (reqId.current === id) setItems([]);
      } finally {
        if (reqId.current === id) setLoading(false);
      }
    };
    if (src.minChars === 0) {
      void run();
      return;
    }
    const t = setTimeout(run, 160);
    return () => clearTimeout(t);
  }, [visible, q, kind, assetKind, src]);

  // 목록형(자산)은 받아온 전체를 클라이언트에서 거른다.
  const shown = useMemo(() => {
    if (src.minChars > 0) return items;
    const s = q.trim().toLowerCase();
    return s ? items.filter((o) => `${o.label} ${o.sub ?? ''}`.toLowerCase().includes(s)) : items;
  }, [items, q, src.minChars]);

  const close = () => {
    setQ('');
    setItems([]);
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title={title ?? src.title}
      footer={
        src.manualLabel && onManual ? (
          <Button
            variant="ghost"
            label={q.trim() ? `${src.manualLabel} — "${q.trim()}"` : src.manualLabel}
            disabled={!q.trim()}
            onPress={() => {
              const t = q.trim();
              if (!t) return;
              onManual(t);
              close();
            }}
          />
        ) : undefined
      }>
      <View style={{ height: 400 }}>
        <SearchBar value={q} onChangeText={setQ} placeholder={src.placeholder} />
        {loading && !shown.length ? (
          <View className="pt-3">
            <SkeletonList count={3} />
          </View>
        ) : !shown.length ? (
          <EmptyState
            icon="search-outline"
            title={src.minChars > 0 && q.trim().length < src.minChars ? `${src.minChars}자 이상 입력하세요` : '결과가 없습니다'}
          />
        ) : (
          <ScrollView className="mt-2 flex-1" keyboardShouldPersistTaps="handled">
            {shown.map((o) => (
              <Pressable
                key={o.id}
                onPress={() => {
                  onSelect(o);
                  close();
                }}
                className="flex-row items-center gap-2 border-b border-cd-grid-line py-3 active:opacity-70">
                <View className="flex-1">
                  <Text numberOfLines={1} className="text-[14px] font-semibold text-cd-text">
                    {o.label}
                  </Text>
                  {o.sub ? (
                    <Text numberOfLines={1} className="mt-[2px] text-[11.5px] text-cd-faint">
                      {o.sub}
                    </Text>
                  ) : null}
                </View>
                {renderRight?.(o)}
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
    </Sheet>
  );
}
