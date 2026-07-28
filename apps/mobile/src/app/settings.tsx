import { useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import Constants from 'expo-constants';

import { Chip, ConfirmSheet, ListRow, Screen, SectionTitle, useToast } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { canAuthenticate, isLockEnabled, setLockEnabled } from '@/lib/lock';
import { API_BASE_URL } from '@/lib/config';
import type { ThemeMode } from '@/theme/ThemeProvider';
import { useTheme, useThemeMode } from '@/theme/useTheme';

const THEME_OPTIONS: { key: ThemeMode; label: string }[] = [
  { key: 'system', label: '시스템 설정' },
  { key: 'light', label: '라이트' },
  { key: 'dark', label: '다크' },
];

// 설정 — 앱 잠금·알림(M1)·계정·로그아웃.
export default function SettingsScreen() {
  const { user, logout } = useAuth();
  const { c } = useTheme();
  const theme = useThemeMode();
  const toast = useToast();
  const [lock, setLock] = useState(true);
  const [bioAvailable, setBioAvailable] = useState(true);
  const [confirmLogout, setConfirmLogout] = useState(false);

  useEffect(() => {
    void (async () => {
      setLock(await isLockEnabled());
      setBioAvailable(await canAuthenticate());
    })();
  }, []);

  const toggleLock = async (v: boolean) => {
    if (v && !bioAvailable) {
      toast.show('기기에 생체 인증이나 암호가 설정돼 있지 않습니다.', 'error');
      return;
    }
    setLock(v);
    await setLockEnabled(v);
  };

  const version = Constants.expoConfig?.version ?? '-';

  return (
    <Screen scroll padded={false}>
      <SectionTitle>보안</SectionTitle>
      <ListRow
        icon="lock-closed-outline"
        title="앱 잠금"
        subtitle={
          bioAvailable
            ? '5분 이상 벗어났다 돌아오면 생체 인증'
            : '기기에 생체 인증·암호가 없어 사용할 수 없습니다'
        }
        right={
          <Switch
            value={lock}
            onValueChange={toggleLock}
            trackColor={{ true: c.primary, false: c.border }}
          />
        }
      />

      <SectionTitle>화면</SectionTitle>
      <View className="gap-2 px-4 py-3">
        <Text className="text-[13px] text-cd-faint">테마</Text>
        <View className="flex-row gap-2">
          {THEME_OPTIONS.map((o) => (
            <Chip
              key={o.key}
              label={o.label}
              active={(theme?.mode ?? 'system') === o.key}
              onPress={() => theme?.setMode(o.key)}
            />
          ))}
        </View>
      </View>

      <SectionTitle>알림</SectionTitle>
      <ListRow
        icon="notifications-outline"
        title="푸시 알림"
        subtitle="다음 단계에서 열립니다"
        value="준비 중"
      />

      <SectionTitle>계정</SectionTitle>
      <ListRow icon="person-outline" title="이름" value={user?.name ?? '-'} />
      <ListRow icon="mail-outline" title="메일" value={user?.email ?? '-'} />
      <ListRow
        icon="log-out-outline"
        title="로그아웃"
        danger
        onPress={() => setConfirmLogout(true)}
      />

      <View className="items-center gap-1 px-4 py-8">
        <Text className="text-[11px] text-cd-faint">버전 {version}</Text>
        <Text className="text-[11px] text-cd-faint">{API_BASE_URL}</Text>
      </View>

      <ConfirmSheet
        visible={confirmLogout}
        title="로그아웃할까요?"
        message="저장된 로그인 정보와 캐시가 지워집니다."
        confirmLabel="로그아웃"
        danger
        onCancel={() => setConfirmLogout(false)}
        onConfirm={() => {
          setConfirmLogout(false);
          void logout();
        }}
      />
    </Screen>
  );
}
