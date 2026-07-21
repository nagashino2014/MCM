import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth-context';

// 로그인 화면 — 사번/아이디 + 비밀번호. 성공 시 루트 게이트가 (tabs)로 이동시킨다.
export default function LoginScreen() {
  const { login } = useAuth();
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
    <SafeAreaView className="flex-1 bg-white dark:bg-neutral-950">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-center px-6">
        <View className="mb-10 items-center">
          <View className="mb-3 h-14 w-14 items-center justify-center rounded-2xl bg-primary">
            <Text className="text-xl font-extrabold text-white">M</Text>
          </View>
          <Text className="text-2xl font-extrabold text-neutral-900 dark:text-white">MCM</Text>
          <Text className="mt-1 text-sm text-neutral-500">영업 현장 관리</Text>
        </View>

        <View className="gap-3">
          <TextInput
            className="rounded-xl border border-neutral-300 px-4 py-3 text-base text-neutral-900 dark:border-neutral-700 dark:text-white"
            placeholder="사번 또는 아이디"
            autoCapitalize="none"
            autoCorrect={false}
            value={identifier}
            onChangeText={setIdentifier}
            placeholderTextColor="#9ca3af"
            editable={!loading}
          />
          <TextInput
            className="rounded-xl border border-neutral-300 px-4 py-3 text-base text-neutral-900 dark:border-neutral-700 dark:text-white"
            placeholder="비밀번호"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={onSubmit}
            placeholderTextColor="#9ca3af"
            editable={!loading}
          />
          {error ? <Text className="text-sm text-red-500">{error}</Text> : null}
          <Pressable
            onPress={onSubmit}
            disabled={loading}
            className="mt-2 items-center rounded-xl bg-primary py-3.5 active:opacity-80">
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-base font-bold text-white">로그인</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
