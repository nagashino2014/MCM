import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { GradientButton, Input, Sheet, Textarea, useToast } from '@/components/ui';
import { EntityPickerSheet, type EntityOption } from '@/components/pickers/EntityPickerSheet';
import { apiJson } from '@/lib/api';
import { useTheme } from '@/theme/useTheme';
import {
  SALES_SERVICE_CATEGORIES,
  SALES_SUBCATEGORIES_BY_CATEGORY,
  type SalesServiceCategory,
} from '@/lib/sales/types';

/**
 * 신규 영업건 등록 시트 — 데스크탑 SalesBoard 의 '영업건 추가' 모달 대응.
 * 필드·기본값을 그대로 따른다(사업장·제목 필수, stage 는 스케쥴 진행도로 자동 분류 → lead 시작).
 *
 * 사업장 선택은 EntityPickerSheet 를 재사용하는데, RN Modal 을 겹쳐 띄우지 않도록
 * 픽커가 열리는 동안 폼 시트를 잠시 숨긴다(컴포넌트는 마운트 유지 → 입력값 보존).
 */
export function NewProjectSheet({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  /** 생성 성공 — 부모가 목록을 갱신한다. */
  onCreated: () => void;
}) {
  const { c } = useTheme();
  const toast = useToast();
  const [picking, setPicking] = useState(false);
  const [facility, setFacility] = useState<{ id: string; name: string } | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<SalesServiceCategory | null>(null);
  const [subcategory, setSubcategory] = useState<string | null>(null);
  const [expected, setExpected] = useState('');
  const [memo, setMemo] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setFacility(null);
    setTitle('');
    setCategory(null);
    setSubcategory(null);
    setExpected('');
    setMemo('');
  };

  const submit = async () => {
    if (!facility || !title.trim()) {
      toast.show('사업장과 제목은 필수입니다.', 'error');
      return;
    }
    setSaving(true);
    try {
      await apiJson('/api/sales/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facilityId: facility.id,
          title: title.trim(),
          // 단계는 영업 스케쥴 진행도에 따라 자동 분류 → 신규 생성 시 lead 로 시작(데스크탑과 동일).
          stage: 'lead',
          priority: 'normal',
          serviceCategory: category,
          serviceSubcategory: subcategory,
          expectedAmount: expected ? Number(expected.replace(/[^0-9]/g, '')) : null,
          memo: memo.trim() || null,
        }),
      });
      toast.show('영업건을 등록했습니다.', 'success');
      reset();
      onCreated();
      onClose();
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Sheet
        visible={visible && !picking}
        onClose={onClose}
        title="신규 영업건"
        footer={<View className="flex-1"><GradientButton label="등록" loading={saving} onPress={submit} /></View>}>
        <View className="gap-3.5">
          <View className="gap-1.5">
            <Text className="text-[13px] font-bold text-cd-muted">사업장 *</Text>
            <Pressable
              onPress={() => setPicking(true)}
              className="min-h-[46px] flex-row items-center gap-2 rounded-xl border border-cd-border bg-cd-card px-3.5 active:opacity-70">
              <Ionicons name="business-outline" size={16} color={facility ? c.text : c.faint} />
              <Text className={`flex-1 text-[15px] ${facility ? 'font-semibold text-cd-text' : 'text-cd-faint'}`}>
                {facility?.name ?? '사업장 검색'}
              </Text>
              {facility ? (
                <Pressable hitSlop={8} onPress={() => setFacility(null)}>
                  <Ionicons name="close-circle" size={17} color={c.faint} />
                </Pressable>
              ) : (
                <Ionicons name="chevron-forward" size={15} color={c.faint} />
              )}
            </Pressable>
          </View>

          <Input label="제목 *" value={title} onChangeText={setTitle} placeholder="예: 통합허가 갱신 영업" />

          <View className="gap-1.5">
            <Text className="text-[13px] font-bold text-cd-muted">용역 분류</Text>
            <View className="flex-row flex-wrap gap-[7px]">
              {SALES_SERVICE_CATEGORIES.map((s) => (
                <PickChip
                  key={s.code}
                  label={s.label}
                  on={category === s.code}
                  onPress={() => {
                    setCategory((prev) => (prev === s.code ? null : s.code));
                    setSubcategory(null);
                  }}
                />
              ))}
            </View>
            {category ? (
              <View className="mt-1 flex-row flex-wrap gap-[7px]">
                {SALES_SUBCATEGORIES_BY_CATEGORY[category].map((s) => (
                  <PickChip
                    key={s.code}
                    label={s.label}
                    on={subcategory === s.code}
                    onPress={() => setSubcategory((prev) => (prev === s.code ? null : s.code))}
                  />
                ))}
              </View>
            ) : null}
          </View>

          <Input
            label="예상 금액"
            value={expected}
            onChangeText={(t) => setExpected(t.replace(/[^0-9]/g, ''))}
            keyboardType="numeric"
            placeholder="원 단위 숫자"
          />
          <Textarea label="메모" minHeight={72} maxLength={200} value={memo} onChangeText={setMemo} placeholder="선택 입력" />
        </View>
      </Sheet>

      <EntityPickerSheet
        visible={visible && picking}
        kind="company"
        onSelect={(opt: EntityOption) => setFacility({ id: opt.id, name: opt.label })}
        onClose={() => setPicking(false)}
      />
    </>
  );
}

/** 선택 칩 — 선택은 primary 틴트, 비선택은 흰 배경 + 윤곽선(일정 필터 칩과 같은 문법). */
export function PickChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="rounded-full px-[13px] py-[7px] active:opacity-70"
      style={{
        backgroundColor: on ? '#e3e6fb' : 'transparent',
        borderWidth: on ? 0 : 1,
        borderColor: '#e3e6ef',
      }}>
      <Text className={`text-[12px] ${on ? 'font-bold' : 'font-semibold'}`} style={{ color: on ? '#4353e4' : '#9aa0b8' }}>
        {label}
      </Text>
    </Pressable>
  );
}
