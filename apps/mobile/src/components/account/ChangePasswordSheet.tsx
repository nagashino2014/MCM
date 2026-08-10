import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button, Input, Sheet, useToast } from '@/components/ui';
import { API_BASE_URL } from '@/lib/config';
import { apiJson } from '@/lib/api';

/**
 * 비밀번호 변경 — 웹 `/api/account/change-password`(본인 변경) 를 그대로 쓴다.
 *
 * 두 가지 진입:
 *  - 로그인 후(설정 화면): 세션 토큰으로 바로 변경한다.
 *  - 로그인 전(로그인 화면, `preLogin`): 아이디+현재 비밀번호로 먼저 로그인해 토큰을 얻은 뒤
 *    변경한다. 앱에 별도 "비로그인 변경" API 를 만들지 않기 위한 방식(서버 규칙은 그대로).
 */
export function ChangePasswordSheet({
  visible,
  onClose,
  preLogin,
  defaultIdentifier,
}: {
  visible: boolean;
  onClose: () => void;
  preLogin?: boolean;
  defaultIdentifier?: string;
}) {
  const toast = useToast();
  const [identifier, setIdentifier] = useState(defaultIdentifier ?? '');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setCurrent('');
    setNext('');
    setConfirm('');
    setError(null);
    onClose();
  };

  const submit = async () => {
    if (!current || !next) return setError('현재/새 비밀번호를 모두 입력하세요.');
    if (next.length < 8) return setError('새 비밀번호는 최소 8자 이상이어야 합니다.');
    if (next !== confirm) return setError('새 비밀번호가 서로 다릅니다.');
    if (preLogin && !identifier.trim()) return setError('아이디를 입력하세요.');

    setBusy(true);
    setError(null);
    try {
      if (preLogin) {
        // 로그인 전 변경 — 현재 비밀번호로 토큰을 받아 그 토큰으로 변경한다(세션은 만들지 않는다).
        const res = await fetch(`${API_BASE_URL}/api/mobile/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: identifier.trim(), password: current }),
        });
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(d.error ?? '아이디 또는 현재 비밀번호가 올바르지 않습니다.');
        }
        const d = (await res.json()) as { accessToken: string };
        const chg = await fetch(`${API_BASE_URL}/api/account/change-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${d.accessToken}` },
          body: JSON.stringify({ currentPassword: current, newPassword: next }),
        });
        if (!chg.ok) {
          const e = (await chg.json().catch(() => ({}))) as { error?: string };
          throw new Error(e.error ?? '비밀번호를 바꾸지 못했습니다.');
        }
      } else {
        await apiJson('/api/account/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword: current, newPassword: next }),
        });
      }
      toast.show('비밀번호를 변경했습니다. 다음 로그인부터 새 비밀번호를 사용하세요.', 'success');
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title="비밀번호 변경"
      footer={
        <>
          <View className="flex-1">
            <Button label="취소" variant="ghost" onPress={close} full />
          </View>
          <View className="flex-[2]">
            <Button label="변경" onPress={() => void submit()} loading={busy} full />
          </View>
        </>
      }>
      <View className="gap-3">
        {preLogin ? (
          <Input
            label="아이디"
            placeholder="사번 또는 아이디"
            autoCapitalize="none"
            autoCorrect={false}
            value={identifier}
            onChangeText={setIdentifier}
          />
        ) : null}
        <Input label="현재 비밀번호" secureTextEntry value={current} onChangeText={setCurrent} />
        <Input
          label="새 비밀번호"
          secureTextEntry
          placeholder="8자 이상"
          value={next}
          onChangeText={setNext}
        />
        <Input label="새 비밀번호 확인" secureTextEntry value={confirm} onChangeText={setConfirm} />
        {error ? <Text className="text-[13px] text-cd-error">{error}</Text> : null}
      </View>
    </Sheet>
  );
}
