import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Input } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/theme/useTheme';

// 로그인 화면 — 사번/아이디 + 비밀번호. 성공 시 루트 게이트가 (tabs)로 이동시킨다.
export default function LoginScreen() {
  const { login } = useAuth();
  const { c } = useTheme();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    if (!identifier.trim() || !password) {
      setError('아이디와 비밀번호를 입력하세요.');
      return;
    }
    setLoading(true);
    setError(null);
    const r = await login(identifier.trim(), password);
    setLoading(false);
    if (!r.ok) setError(r.error ?? '로그인에 실패했습니다.');
  };

  return (
    <SafeAreaView style={{ backgroundColor: c.bg }} className="flex-1 bg-cd-bg">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-center px-6">
        <View className="mb-10 items-center">
          <View className="mb-3 h-14 w-14 items-center justify-center rounded-2xl bg-cd-primary">
            <Text className="text-xl font-extrabold text-white">M</Text>
          </View>
          <Text className="text-2xl font-extrabold text-cd-text">MCM</Text>
          <Text className="mt-1 text-sm text-cd-muted">한국환경안전연구원 그룹웨어</Text>
        </View>

        <View className="gap-3">
          <Input
            placeholder="사번 또는 아이디"
            autoCapitalize="none"
            autoCorrect={false}
            value={identifier}
            onChangeText={setIdentifier}
            editable={!loading}
          />
          <Input
            placeholder="비밀번호"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={onSubmit}
            editable={!loading}
          />
          {error ? <Text className="text-sm text-cd-error">{error}</Text> : null}
          <View className="mt-2">
            <Button label="로그인" onPress={onSubmit} loading={loading} full />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
