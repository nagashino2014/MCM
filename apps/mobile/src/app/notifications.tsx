import { useCallback, useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';

import { Button, EmptyState, ListRow, Screen, SectionTitle, SkeletonList, useToast } from '@/components/ui';
import { apiJson } from '@/lib/api';
import { registerForPush } from '@/lib/push';
import { useTheme } from '@/theme/useTheme';

interface PrefEvent {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
}
interface Prefs {
  events: PrefEvent[];
  quiet: { enabled: boolean; from: string; to: string };
  deviceCount: number;
}

// 알림 설정 — 이벤트별 수신 토글 + 방해금지. 서버 /api/mobile/push/prefs 와 1:1.
export default function NotificationsScreen() {
  const { c } = useTheme();
  const toast = useToast();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [enabling, setEnabling] = useState(false);

  const load = useCallback(async () => {
    try {
      setPrefs(await apiJson<Prefs>('/api/mobile/push/prefs'));
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
    // toast 는 매 렌더 새 객체 — 의존성에서 제외
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 낙관적 갱신 후 저장(실패하면 서버 응답으로 되돌린다). */
  const save = async (next: Prefs, body: Record<string, unknown>) => {
    setPrefs(next);
    try {
      setPrefs(
        await apiJson<Prefs>('/api/mobile/push/prefs', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      );
    } catch (e) {
      toast.show((e as Error).message, 'error');
      void load();
    }
  };

  const toggleEvent = (key: string, enabled: boolean) => {
    if (!prefs) return;
    void save(
      { ...prefs, events: prefs.events.map((e) => (e.key === key ? { ...e, enabled } : e)) },
      { events: [{ key, enabled }] }
    );
  };

  const toggleQuiet = (enabled: boolean) => {
    if (!prefs) return;
    void save({ ...prefs, quiet: { ...prefs.quiet, enabled } }, { quiet: { ...prefs.quiet, enabled } });
  };

  const enableDevice = async () => {
    setEnabling(true);
    const r = await registerForPush(true);
    setEnabling(false);
    if (r.ok) {
      toast.show('이 기기에서 알림을 받습니다.', 'success');
      void load();
    } else if (r.reason === 'denied') {
      toast.show('기기 설정 > 알림에서 MCM 알림을 허용해 주세요.', 'error');
    } else if (r.reason === 'unsupported') {
      toast.show('실제 기기에서만 푸시를 받을 수 있습니다.', 'error');
    } else {
      toast.show('알림 등록에 실패했습니다.', 'error');
    }
  };

  if (loading) {
    return (
      <Screen>
        <SkeletonList count={4} />
      </Screen>
    );
  }
  if (!prefs) {
    return (
      <Screen>
        <EmptyState icon="notifications-off-outline" title="설정을 불러오지 못했습니다" />
      </Screen>
    );
  }

  return (
    <Screen scroll padded={false}>
      <View className="gap-2 p-4">
        <View className="flex-row items-center gap-2 rounded-card border border-cd-border bg-cd-card p-4">
          <View className="flex-1">
            <Text className="text-[15px] font-bold text-cd-text">
              {prefs.deviceCount > 0 ? '알림 받는 중' : '알림이 꺼져 있습니다'}
            </Text>
            <Text className="text-[12px] text-cd-faint">
              {prefs.deviceCount > 0
                ? `등록된 기기 ${prefs.deviceCount}대`
                : '이 기기에서 알림을 받으려면 켜 주세요'}
            </Text>
          </View>
          {prefs.deviceCount > 0 ? null : (
            <Button label="켜기" size="sm" onPress={enableDevice} loading={enabling} />
          )}
        </View>
      </View>

      <SectionTitle>받을 알림</SectionTitle>
      {prefs.events.map((e) => (
        <ListRow
          key={e.key}
          title={e.label}
          subtitle={e.description}
          right={
            <Switch
              value={e.enabled}
              onValueChange={(v) => toggleEvent(e.key, v)}
              trackColor={{ true: c.primary, false: c.border }}
            />
          }
        />
      ))}

      <SectionTitle>방해금지</SectionTitle>
      <ListRow
        icon="moon-outline"
        title="야간 알림 끄기"
        subtitle={`${prefs.quiet.from} ~ ${prefs.quiet.to} 사이에는 보내지 않습니다`}
        right={
          <Switch
            value={prefs.quiet.enabled}
            onValueChange={toggleQuiet}
            trackColor={{ true: c.primary, false: c.border }}
          />
        }
      />

      <Text className="px-4 py-6 text-[11px] leading-4 text-cd-faint">
        긴급 결재도 방해금지 시간에는 발송되지 않습니다. 중요한 알림을 놓치지 않으려면 해제해 두세요.
      </Text>
    </Screen>
  );
}
