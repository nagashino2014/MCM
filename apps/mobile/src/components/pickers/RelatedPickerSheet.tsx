import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Button, EmptyState, SearchBar, Sheet, SkeletonList } from '@/components/ui';
import { apiJson } from '@/lib/api';
import type { RelatedRef } from '@/lib/expense-purpose';
import { useTheme } from '@/theme/useTheme';

/**
 * 연관 용역/사업장 선택 시트(2026-10-16) — 영수증 촬영·영수증함에서 "어느 용역(사업장)에 쓴 비용인지" 고른다.
 * 웹 RelatedPickerModal 과 같은 API(/api/approval/related-search, 결재 권한만 필요)를 쓴다.
 * 용역(진행 중 우선)을 먼저, 검색어가 있으면 사업장(계약 전 영업 출장 등)을 아래에 보여 준다.
 */

interface ContractHit {
  contractId: string;
  title: string;
  contractDate: string | null;
  facilityId: string | null;
  facilityName: string | null;
  counterpartyName: string | null;
}
interface FacilityHit {
  facilityId: string;
  name: string;
  region: string;
}

export function RelatedPickerSheet({
  visible,
  current,
  onSelect,
  onClose,
}: {
  visible: boolean;
  current?: RelatedRef | null;
  onSelect: (ref: RelatedRef | null) => void;
  onClose: () => void;
}) {
  const { c: t } = useTheme(); // 다크 보정(2026-10-18) — map 변수 c 와 충돌해 별칭
  const [q, setQ] = useState('');
  const [contracts, setContracts] = useState<ContractHit[]>([]);
  const [facilities, setFacilities] = useState<FacilityHit[]>([]);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    if (!visible) return;
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const json = await apiJson<{ contracts?: ContractHit[]; facilities?: FacilityHit[] }>(
          `/api/approval/related-search?q=${encodeURIComponent(q.trim())}&limit=15`,
        );
        if (reqId.current !== id) return;
        setContracts(json.contracts ?? []);
        setFacilities(json.facilities ?? []);
      } catch {
        if (reqId.current === id) {
          setContracts([]);
          setFacilities([]);
        }
      } finally {
        if (reqId.current === id) setLoading(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [visible, q]);

  const close = () => {
    setQ('');
    onClose();
  };
  const pick = (ref: RelatedRef | null) => {
    onSelect(ref);
    close();
  };

  const empty = !contracts.length && !facilities.length;

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title="연관 용역/사업장"
      footer={current ? <Button variant="ghost" label="선택 해제" onPress={() => pick(null)} /> : undefined}>
      <View style={{ height: 440 }}>
        <SearchBar value={q} onChangeText={setQ} placeholder="용역명 또는 업체·사업장 이름" />
        {loading && empty ? (
          <View className="pt-3">
            <SkeletonList count={3} />
          </View>
        ) : empty ? (
          <EmptyState icon="search-outline" title="결과가 없습니다" />
        ) : (
          <ScrollView automaticallyAdjustKeyboardInsets className="mt-2 flex-1" keyboardShouldPersistTaps="handled">
            <Text className="pb-1 pt-2 text-[11.5px] font-semibold text-cd-muted">
              {q.trim() ? '용역' : '최근 진행 중 용역'}
            </Text>
            {contracts.map((c) => (
              <Pressable
                key={c.contractId}
                onPress={() => pick({ label: c.title, contractId: c.contractId, facilityId: c.facilityId })}
                className="flex-row items-center gap-2 border-b border-cd-grid-line py-3 active:opacity-70">
                <Ionicons name="document-text-outline" size={16} color={t.primary} />
                <View className="flex-1">
                  <Text numberOfLines={1} className="text-[14px] font-semibold text-cd-text">
                    {c.title}
                  </Text>
                  <Text numberOfLines={1} className="mt-[2px] text-[11.5px] text-cd-faint">
                    {[c.facilityName ?? c.counterpartyName, c.contractDate].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </Pressable>
            ))}
            {q.trim() && facilities.length > 0 ? (
              <>
                <Text className="pb-1 pt-4 text-[11.5px] font-semibold text-cd-muted">사업장 — 용역이 없을 때(계약 전 영업 출장 등)</Text>
                {facilities.map((f) => (
                  <Pressable
                    key={f.facilityId}
                    onPress={() => pick({ label: f.name, contractId: null, facilityId: f.facilityId })}
                    className="flex-row items-center gap-2 border-b border-cd-grid-line py-3 active:opacity-70">
                    <Ionicons name="business-outline" size={16} color={t.muted} />
                    <View className="flex-1">
                      <Text numberOfLines={1} className="text-[14px] font-semibold text-cd-text">
                        {f.name}
                      </Text>
                      {f.region ? (
                        <Text numberOfLines={1} className="mt-[2px] text-[11.5px] text-cd-faint">
                          {f.region}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                ))}
              </>
            ) : null}
          </ScrollView>
        )}
      </View>
    </Sheet>
  );
}
