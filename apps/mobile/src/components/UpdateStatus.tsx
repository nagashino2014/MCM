import { useState } from 'react';
import { Text, View } from 'react-native';
import * as Updates from 'expo-updates';

import { Button, useToast } from '@/components/ui';

/**
 * OTA 업데이트 상태 — "새 버전을 배포했는데 앱이 그대로"일 때 원인을 눈으로 확인하는 창구.
 *
 * 실기기에서 무엇을 실행 중인지(내장 번들인지 내려받은 업데이트인지, 어느 채널·런타임인지)
 * 볼 수 없으면 배포 문제를 추측으로만 다루게 된다. 수동 확인·적용 버튼도 함께 둔다.
 */
export function UpdateStatus() {
  const toast = useToast();
  const {
    currentlyRunning,
    isChecking,
    isDownloading,
    isUpdateAvailable,
    isUpdatePending,
    lastCheckForUpdateTimeSinceRestart,
  } = Updates.useUpdates();
  const [busy, setBusy] = useState(false);

  const when = (d?: Date | null) => {
    if (!d) return '-';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  const checkNow = async () => {
    setBusy(true);
    try {
      const res = await Updates.checkForUpdateAsync();
      if (!res.isAvailable) {
        toast.show('이미 최신입니다.', 'info');
        return;
      }
      toast.show('새 업데이트를 내려받는 중입니다…', 'info');
      const fetched = await Updates.fetchUpdateAsync();
      if (fetched.isNew) {
        toast.show('적용을 위해 앱을 다시 시작합니다.', 'success');
        await Updates.reloadAsync();
      } else {
        toast.show('내려받을 새 번들이 없습니다.', 'info');
      }
    } catch (e) {
      toast.show(`업데이트 확인 실패: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="gap-2 px-4 py-3">
      <Row label="실행 중" value={currentlyRunning.isEmbeddedLaunch ? '내장 번들(빌드에 포함)' : 'OTA 업데이트'} />
      <Row label="채널" value={currentlyRunning.channel ?? '-'} />
      <Row label="런타임" value={currentlyRunning.runtimeVersion ?? '-'} />
      <Row label="업데이트 ID" value={(currentlyRunning.updateId ?? '-').slice(0, 8)} />
      <Row label="번들 생성" value={when(currentlyRunning.createdAt)} />
      <Row label="마지막 확인" value={when(lastCheckForUpdateTimeSinceRestart)} />
      {isUpdateAvailable ? <Row label="상태" value="새 업데이트 있음" /> : null}
      {isUpdatePending ? <Row label="상태" value="다음 실행에 적용 대기" /> : null}

      <View className="mt-1">
        <Button
          label={isChecking ? '확인 중…' : isDownloading ? '내려받는 중…' : '지금 업데이트 확인'}
          icon="cloud-download-outline"
          variant="ghost"
          onPress={checkNow}
          loading={busy || isChecking || isDownloading}
          full
        />
      </View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center">
      <Text className="w-24 text-[12px] text-cd-faint">{label}</Text>
      <Text className="flex-1 text-[12px] text-cd-muted">{value}</Text>
    </View>
  );
}
