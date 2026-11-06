import { useState } from 'react';
import { Pressable, ScrollView, Text, View, type LayoutChangeEvent } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ActionTile, Button, Card, Sheet, useToast } from '@/components/ui';
import { apiJson } from '@/lib/api';
import { IS_WEB_RAIL } from '@/lib/platform';
import {
  DEFAULT_QUICK_KEYS,
  MAX_QUICK_TILES,
  QUICK_ACTIONS,
  availableQuickActions,
  quickToneColor,
  resolveQuickActions,
} from '@/lib/quick-actions';
import { useTheme } from '@/theme/useTheme';

/**
 * 홈 "빠른 실행" 카드 — 탭에 없는 기능으로 1탭 진입. 2026-11-06 부터 **누구나 자기 타일을 넣고 뺄 수 있다**(사용자 요청).
 *
 * - 구성은 계정별로 서버에 저장된다(`/api/home/layout` 의 quickActions) — 휴대폰과 PC 위젯이 같은 구성을 쓴다.
 *   단, 카메라가 필요한 명함·영수증은 PC 에서 보이지 않는다(목록·타일 모두). PC 에서 저장해도 그 타일은 구성에 남겨
 *   휴대폰에서 사라지지 않게 한다(이 기기에서 못 쓰는 키는 그대로 앞에 보존).
 * - 편집은 카드 오른쪽 위 "편집" → 시트에서 체크로 고른다(최대 MAX_QUICK_TILES 개, 고른 순서대로 놓인다).
 * - `saved` 가 null 이면 기본 구성. 저장 뒤 `onSaved` 로 홈이 설정을 다시 읽는다.
 */
export function QuickActionsCard({
  saved,
  onSaved,
  onLayout,
}: {
  saved: string[] | null | undefined;
  onSaved: () => void;
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  const { c, dark } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  // 저장 직후 서버 응답을 기다리는 동안에도 새 구성이 바로 보이게 한다.
  const [local, setLocal] = useState<string[] | null | undefined>(undefined);
  const [seenSaved, setSeenSaved] = useState(saved);
  if (saved !== seenSaved) {
    setSeenSaved(saved);
    setLocal(undefined);
  }

  const tiles = resolveQuickActions(local === undefined ? saved : local);
  const options = availableQuickActions();

  const openEdit = () => {
    setDraft(tiles.map((t) => t.key));
    setEditing(true);
  };
  const toggle = (key: string) => {
    setDraft((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      if (prev.length >= MAX_QUICK_TILES) {
        toast.show(`빠른 실행은 ${MAX_QUICK_TILES}개까지 둘 수 있습니다.`, 'error');
        return prev;
      }
      return [...prev, key];
    });
  };
  const save = async (picked: string[]) => {
    if (saving) return;
    setSaving(true);
    // 이 기기에서 쓸 수 없는 타일(PC 의 명함·영수증)은 편집 목록에 없으므로, 전에 있던 것을 그대로 앞에 남긴다.
    const base = local === undefined ? saved : local;
    const kept = (Array.isArray(base) ? base : DEFAULT_QUICK_KEYS).filter(
      (k) => QUICK_ACTIONS.some((a) => a.key === k) && !options.some((o) => o.key === k)
    );
    const keys = [...kept, ...picked];
    try {
      await apiJson('/api/home/layout', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quickActions: keys }),
      });
      setLocal(keys);
      setEditing(false);
      onSaved();
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View onLayout={onLayout}>
      <Card title="빠른 실행" action={{ label: '편집', onPress: openEdit }}>
        {/* 네이티브는 좁은 기기(375px)에서 넘치지 않게 줄바꿈 허용. 데스크탑 위젯·PWA 는 justify-between 이면 과하게 벌어져 간격 고정(2026-11-04). */}
        {tiles.length === 0 ? (
          <Text className="py-2 text-[14px] text-cd-muted">편집을 눌러 자주 쓰는 기능을 넣어 보세요.</Text>
        ) : (
          <View className={`mt-1.5 flex-row flex-wrap gap-y-3 ${IS_WEB_RAIL ? 'justify-start gap-x-7' : 'justify-between'}`}>
            {tiles.map((t) => (
              <ActionTile
                key={t.key}
                icon={t.icon}
                label={t.label}
                tone={quickToneColor(t.tone, c, dark)}
                onPress={() => router.push(t.route as Href)}
              />
            ))}
          </View>
        )}
      </Card>

      <Sheet
        visible={editing}
        onClose={() => setEditing(false)}
        title="빠른 실행 편집"
        footer={
          // Sheet 의 footer 는 그 자체가 가로 줄(flex-row gap-2) — 칸 두 개를 바로 넣는다.
          <>
            <View className="flex-1">
              <Button full label="기본값" variant="ghost" disabled={saving} onPress={() => setDraft(DEFAULT_QUICK_KEYS.filter((k) => options.some((o) => o.key === k)))} />
            </View>
            <View className="flex-1">
              <Button full label="저장" loading={saving} onPress={() => void save(draft)} />
            </View>
          </>
        }>
        <Text className="pb-2 text-[12px] text-cd-muted">
          홈에 둘 기능을 고르세요. 고른 순서대로 놓이며 {MAX_QUICK_TILES}개까지 둘 수 있습니다. 이 설정은 내 계정에만 적용됩니다.
        </Text>
        <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
          {options.map((o, i) => {
            const order = draft.indexOf(o.key);
            const on = order >= 0;
            return (
              <Pressable
                key={o.key}
                onPress={() => toggle(o.key)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={o.label}
                className={`flex-row items-center gap-3 py-2.5 active:opacity-60 ${i === 0 ? '' : 'border-t border-cd-border'}`}>
                <View className="h-9 w-9 items-center justify-center rounded-lg bg-cd-surface">
                  <Ionicons name={o.icon} size={18} color={quickToneColor(o.tone, c, dark)} />
                </View>
                <Text className={`flex-1 text-[14px] text-cd-text ${on ? 'font-semibold' : ''}`}>{o.label}</Text>
                {on ? <Text className="text-[12px] text-cd-muted">{order + 1}번째</Text> : null}
                <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? c.primaryFill : c.faint} />
              </Pressable>
            );
          })}
        </ScrollView>
      </Sheet>
    </View>
  );
}
