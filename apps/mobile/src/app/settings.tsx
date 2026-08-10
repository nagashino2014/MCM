import { useEffect, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Card, Chip, ConfirmSheet, Screen, useToast } from '@/components/ui';
import { UpdateStatus } from '@/components/UpdateStatus';
import { ChangePasswordSheet } from '@/components/account/ChangePasswordSheet';
import { getAutoLogin, setAutoLogin, useAuth } from '@/lib/auth-context';
import { canAuthenticate, isLockEnabled, setLockEnabled } from '@/lib/lock';
import { API_BASE_URL } from '@/lib/config';
import type { ThemeMode } from '@/theme/ThemeProvider';
import { useTheme, useThemeMode } from '@/theme/useTheme';

const THEME_OPTIONS: { key: ThemeMode; label: string }[] = [
  { key: 'system', label: '시스템 설정' },
  { key: 'light', label: '라이트' },
  { key: 'dark', label: '다크' },
];

/**
 * 설정 행 — 홈 "빠른 실행"과 같은 스퀘클 아이콘 + 제목/부제 + 우측 슬롯.
 * 구식 1열 리스트 대신 카드 안에 묶는다(전체 메뉴 4b 와 같은 디자인 언어).
 */
function SettingRow({
  icon,
  tone,
  title,
  subtitle,
  value,
  right,
  onPress,
  danger,
  first,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone: string;
  title: string;
  subtitle?: string;
  value?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  danger?: boolean;
  first?: boolean;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      className={`flex-row items-center gap-3 py-2.5 ${first ? '' : 'border-t border-cd-grid-line'} ${
        onPress ? 'active:opacity-70' : ''
      }`}>
      <View
        className="h-[38px] w-[38px] items-center justify-center rounded-[13px] border border-cd-border bg-cd-card"
        style={{
          shadowColor: '#3C4696',
          shadowOpacity: 0.1,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 2,
        }}>
        <Ionicons name={icon} size={18} color={tone} />
      </View>
      <View className="flex-1">
        <Text className={`text-[14px] font-bold ${danger ? 'text-cd-error' : 'text-cd-text'}`}>{title}</Text>
        {subtitle ? <Text className="mt-0.5 text-[11.5px] leading-4 text-cd-faint">{subtitle}</Text> : null}
      </View>
      {value ? <Text className="text-[13px] text-cd-muted">{value}</Text> : null}
      {right}
      {onPress && !right ? <Ionicons name="chevron-forward" size={15} color={c.faint} /> : null}
    </Pressable>
  );
}

// 설정 — 앱 잠금·화면·알림·계정·앱 정보. 카드 그룹 + 컬러 아이콘(현행 UI 컨셉).
export default function SettingsScreen() {
  const { user, logout } = useAuth();
  const { c, dark } = useTheme();
  const router = useRouter();
  const theme = useThemeMode();
  const toast = useToast();
  const [lock, setLock] = useState(true);
  const [bioAvailable, setBioAvailable] = useState(true);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [auto, setAuto] = useState(true);
  const [pwOpen, setPwOpen] = useState(false);
  const purple = dark ? '#a78bfa' : '#7a5fd0';

  useEffect(() => {
    void (async () => {
      setLock(await isLockEnabled());
      setBioAvailable(await canAuthenticate());
      setAuto(await getAutoLogin());
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
      <View className="gap-3.5 px-[18px] py-4">
        {/* 계정 — 맨 위에 프로필 요약 */}
        <Card>
          <View className="flex-row items-center gap-3 pb-1">
            <View className="h-[46px] w-[46px] items-center justify-center rounded-full bg-cd-primary-soft">
              <Text className="text-[16px] font-extrabold text-cd-primary">
                {(user?.name ?? '?').slice(-2)}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="text-[16px] font-extrabold text-cd-text">{user?.name ?? '사용자'}</Text>
              <Text className="mt-0.5 text-[12px] text-cd-faint">{user?.email ?? '-'}</Text>
            </View>
          </View>
        </Card>

        <Card title="보안">
          <SettingRow
            first
            icon="lock-closed-outline"
            tone={c.primary}
            title="앱 잠금"
            subtitle={
              bioAvailable
                ? '5분 이상 벗어났다 돌아오면 생체 인증'
                : '기기에 생체 인증·암호가 없어 사용할 수 없습니다'
            }
            right={
              <Switch value={lock} onValueChange={toggleLock} trackColor={{ true: c.primary, false: c.border }} />
            }
          />
          <SettingRow
            icon="log-in-outline"
            tone={c.success}
            title="자동 로그인"
            subtitle="끄면 앱을 다시 켤 때 로그인 화면으로 갑니다"
            right={
              <Switch
                value={auto}
                onValueChange={(v) => {
                  setAuto(v);
                  void setAutoLogin(v);
                }}
                trackColor={{ true: c.primary, false: c.border }}
              />
            }
          />
          <SettingRow
            icon="key-outline"
            tone={c.warning}
            title="비밀번호 변경"
            subtitle="현재 비밀번호 확인 후 변경"
            onPress={() => setPwOpen(true)}
          />
        </Card>

        <Card title="화면">
          <View className="mt-1 flex-row gap-2">
            {THEME_OPTIONS.map((o) => (
              <Chip
                key={o.key}
                label={o.label}
                active={(theme?.mode ?? 'system') === o.key}
                onPress={() => theme?.setMode(o.key)}
              />
            ))}
          </View>
        </Card>

        <Card title="알림">
          <SettingRow
            first
            icon="notifications-outline"
            tone={purple}
            title="푸시 알림"
            subtitle="받을 알림 종류·방해금지 시간"
            onPress={() => router.push('/notifications')}
          />
        </Card>

        <Card title="앱 정보">
          <View className="pb-1">
            <UpdateStatus />
          </View>
          <SettingRow icon="phone-portrait-outline" tone={c.secondary} title="버전" value={version} />
          <SettingRow icon="server-outline" tone={c.muted} title="서버" value={API_BASE_URL.replace(/^https?:\/\//, '')} />
        </Card>

        <Card>
          <SettingRow
            first
            icon="log-out-outline"
            tone={c.error}
            title="로그아웃"
            subtitle="저장된 로그인 정보와 캐시가 지워집니다"
            danger
            onPress={() => setConfirmLogout(true)}
          />
        </Card>
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

      <ChangePasswordSheet visible={pwOpen} onClose={() => setPwOpen(false)} />
    </Screen>
  );
}
