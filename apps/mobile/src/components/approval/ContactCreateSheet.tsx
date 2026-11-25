import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Button, Input, Sheet } from '@/components/ui';
import { apiJson } from '@/lib/api';

/**
 * 접견인 추가 — 출장보고서 접견인 칸에서 목록에 없는 사람을 그 업체의 담당자로 등록하고 바로 접견인으로 넣는다
 * (웹 ContactCreateModal 과 같은 경로: POST /api/directory/contacts, 로그인한 직원 누구나 — 2026-11-25).
 * 업체는 같은 양식에서 고른 등록 업체로 고정한다. 부서는 이름을 적으면 그 업체에 없을 때 새로 만들어진다.
 */
export type CreatedContact = { id: string; name: string; title: string | null; facilityName: string | null };

export function ContactCreateSheet({
  visible,
  facility,
  onCreated,
  onClose,
}: {
  visible: boolean;
  /** 양식의 업체 칸에서 고른 등록 업체. 없으면 등록할 수 없다(안내만 보인다). */
  facility: { facilityId: string; name: string } | null;
  onCreated: (p: CreatedContact) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [dept, setDept] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 열 때마다 빈 양식으로 시작한다.
  useEffect(() => {
    if (!visible) return;
    setName('');
    setTitle('');
    setDept('');
    setMobile('');
    setEmail('');
    setError(null);
    setSaving(false);
  }, [visible]);

  const save = async () => {
    if (!facility) return;
    const personName = name.trim();
    if (!personName) {
      setError('성명을 입력하세요.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const data = await apiJson<{ id: string | number }>('/api/directory/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facilityId: facility.facilityId,
          personName,
          title: title.trim() || null,
          departmentName: dept.trim() || null,
          mobilePhone: mobile.trim() || null,
          email: email.trim() || null,
        }),
      });
      onCreated({ id: String(data.id), name: personName, title: title.trim() || null, facilityName: facility.name || null });
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="접견인 추가"
      footer={facility ? <Button label="등록하고 접견인으로 넣기" onPress={save} loading={saving} full /> : undefined}>
      {facility ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 4 }}>
          <View className="gap-1">
            <Text className="text-[12px] font-medium text-cd-muted">기관·업체</Text>
            <Text className="text-[15px] font-semibold text-cd-text">{facility.name}</Text>
          </View>
          <Input label="성명 *" value={name} onChangeText={setName} placeholder="홍길동" />
          <Input label="직함" value={title} onChangeText={setTitle} placeholder="부장" />
          <Input label="부서" value={dept} onChangeText={setDept} placeholder="환경안전팀" hint="이 업체에 없는 부서면 새로 만들어집니다." />
          <Input label="휴대전화" value={mobile} onChangeText={setMobile} keyboardType="phone-pad" placeholder="010-0000-0000" />
          <Input label="이메일" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
          {error ? <Text className="text-[12px] text-cd-error">{error}</Text> : null}
        </ScrollView>
      ) : (
        <Text className="text-[13px] text-cd-muted">
          업체를 먼저 선택하세요. 업체 칸에서 고른 업체의 담당자로 등록됩니다. 등록되지 않은 업체는 업체 칸에서 직접 입력을 고르면 접견인도
          직접 적을 수 있습니다.
        </Text>
      )}
    </Sheet>
  );
}
