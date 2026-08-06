import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Button, Input, Sheet } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';
import {
  CONSENT_FOOTER,
  CONSENT_VERSION,
  buildConsentSections,
  type OvertimeConsent,
} from '@/lib/approval/overtime-consent';

/**
 * 주 12시간 초과 연장근로 — 특별휴가 전환 동의(전자서명) 시트.
 * 웹 `components/approval/OvertimeConsentModal.tsx` 대응.
 *
 * ⚠ 이 동의 없이는 서버가 상신을 거부한다(`assessOverLimitOnSubmit` 이 throw).
 *   따라서 모바일에 이 시트가 없으면 12h 초과 신청은 영원히 상신되지 않는다.
 */
export function OvertimeConsentSheet({
  visible,
  weekStart,
  weekEnd,
  totalMinutes,
  excessMinutes,
  limitMinutes,
  defaultSigner,
  onAgree,
  onClose,
}: {
  visible: boolean;
  weekStart: string;
  weekEnd: string;
  totalMinutes: number;
  excessMinutes: number;
  limitMinutes: number;
  defaultSigner?: string;
  onAgree: (consent: OvertimeConsent) => void;
  onClose: () => void;
}) {
  const { c } = useTheme();
  const [signer, setSigner] = useState(defaultSigner ?? '');
  const [checked, setChecked] = useState(false);
  const sections = buildConsentSections({ weekStart, weekEnd, totalMinutes, excessMinutes, limitMinutes });

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="연장근로·보상휴가 전환 동의"
      footer={
        <Button
          label="동의하고 상신"
          disabled={!checked}
          onPress={() =>
            onAgree({
              version: CONSENT_VERSION,
              agreedAt: new Date().toISOString(),
              signerName: signer.trim() || '기안자 본인',
              weekStart,
              totalMinutes,
              excessMinutes,
            })
          }
        />
      }>
      <View style={{ maxHeight: 460 }}>
        <ScrollView className="flex-1">
          <View className="gap-3 pb-2">
            {sections.map((s) => (
              <View key={s.heading} className="gap-1">
                <Text className="text-[13px] font-bold text-cd-text">{s.heading}</Text>
                <Text className="text-[12.5px] leading-5 text-cd-body">{s.body}</Text>
              </View>
            ))}
            <Text className="text-[11.5px] leading-4 text-cd-faint">{CONSENT_FOOTER}</Text>

            <View className="gap-1.5 pt-1">
              <Text className="text-[13px] font-bold text-cd-muted">서명자</Text>
              <Input value={signer} onChangeText={setSigner} placeholder="성명" />
            </View>

            <Pressable onPress={() => setChecked((v) => !v)} className="flex-row items-center gap-2 py-1 active:opacity-70">
              <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={22} color={checked ? c.primary : c.faint} />
              <Text className="flex-1 text-[13px] text-cd-body">위 내용을 모두 확인하였으며 이에 동의합니다.</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </Sheet>
  );
}
