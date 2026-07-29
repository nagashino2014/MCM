import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Input } from '@/components/ui';
import { apiJson } from '@/lib/api';
import { useTheme } from '@/theme/useTheme';

interface Suggestion {
  name: string;
  address: string;
  detail?: string | null;
  title?: string | null;
  kind?: string;
}

/**
 * 수신자 입력 — 콤마로 여러 명, 마지막 토큰으로 자동완성(웹 RecipientInput 대응).
 * 주소는 `/api/directory/suggest` 가 임직원·별칭·외부 담당자를 함께 준다.
 */
export function RecipientField({
  label,
  value,
  onChange,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  const { c } = useTheme();
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 마지막 토큰(입력 중인 이름)만 질의한다.
  const lastToken = useMemo(() => {
    const parts = value.split(',');
    return (parts[parts.length - 1] ?? '').trim();
  }, [value]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (lastToken.length < 1 || lastToken.includes('@')) {
      setItems([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const d = await apiJson<{ items?: Suggestion[]; suggestions?: Suggestion[] }>(
          `/api/directory/suggest?q=${encodeURIComponent(lastToken)}`
        );
        const list = d.items ?? d.suggestions ?? [];
        setItems(list.slice(0, 8));
        setOpen(list.length > 0);
      } catch {
        setItems([]);
        setOpen(false);
      }
    }, 180);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [lastToken]);

  const pick = (s: Suggestion) => {
    const parts = value.split(',');
    parts[parts.length - 1] = ` ${s.name ? `${s.name} <${s.address}>` : s.address}`;
    onChange(parts.join(',').replace(/^\s+/, '') + ', ');
    setItems([]);
    setOpen(false);
  };

  return (
    <View className="gap-1.5">
      <Input
        label={label}
        value={value}
        onChangeText={onChange}
        placeholder="이름 또는 메일 주소(콤마로 여러 명)"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        autoFocus={autoFocus}
      />
      {open ? (
        <View className="overflow-hidden rounded-xl border border-cd-border bg-cd-card">
          {items.map((s) => (
            <Pressable
              key={`${s.address}-${s.name}`}
              onPress={() => pick(s)}
              className="min-h-[46px] justify-center border-b border-cd-border px-3 py-2 active:bg-cd-surface">
              <Text className="text-[14px] font-bold text-cd-text">
                {s.name || s.address}
                {s.title ? <Text className="font-normal text-cd-faint"> {s.title}</Text> : null}
              </Text>
              <Text numberOfLines={1} className="text-[12px] text-cd-faint">
                {s.address}
                {s.detail ? ` · ${s.detail}` : ''}
              </Text>
            </Pressable>
          ))}
          <Pressable
            onPress={() => setOpen(false)}
            className="items-center py-2 active:opacity-70"
            style={{ backgroundColor: c.surface }}>
            <Text className="text-[12px] text-cd-faint">닫기</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
