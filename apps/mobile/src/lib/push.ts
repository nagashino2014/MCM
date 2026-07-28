/**
 * 푸시 알림(M1) — Expo Push Service.
 *
 * 흐름: 권한 요청 → Expo push token 획득 → 서버 등록(/api/mobile/push/register)
 *       → 알림 수신(포그라운드 배너 / 백그라운드 탭 → 딥링크).
 *
 * ⚠ 실기기에서만 동작한다(시뮬레이터·Expo Go(Android)는 토큰 발급 불가).
 */
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";

import { apiFetch } from "./api";

/** 포그라운드에서도 배너를 띄운다(SDK 54+ 필드명: shouldShowBanner/List). */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

function projectId(): string | undefined {
  return (
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    Constants.easConfig?.projectId
  );
}

/** 안드로이드는 채널이 없으면 알림이 조용히 무시된다. */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("default", {
    name: "기본 알림",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#5D87FF",
  });
}

export type PushRegisterResult =
  | { ok: true; token: string }
  | { ok: false; reason: "denied" | "unsupported" | "error" };

/**
 * 권한을 확인·요청하고 토큰을 서버에 등록한다.
 * `promptIfNeeded=false` 면 이미 허용된 경우에만 조용히 갱신한다(앱 시작 시 호출용).
 */
export async function registerForPush(promptIfNeeded = false): Promise<PushRegisterResult> {
  try {
    if (!Device.isDevice) return { ok: false, reason: "unsupported" };

    const current = await Notifications.getPermissionsAsync();
    let status = current.status;
    if (status !== "granted") {
      if (!promptIfNeeded) return { ok: false, reason: "denied" };
      const req = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
      });
      status = req.status;
    }
    if (status !== "granted") return { ok: false, reason: "denied" };

    await ensureAndroidChannel();

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: projectId() });
    if (!token) return { ok: false, reason: "error" };

    await apiFetch("/api/mobile/push/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expoToken: token,
        platform: Platform.OS === "ios" ? "ios" : "android",
        deviceId: Device.modelName ?? null,
        appVersion: Constants.expoConfig?.version ?? null,
      }),
    });
    return { ok: true, token };
  } catch (e) {
    console.warn("[push] 등록 실패:", e);
    return { ok: false, reason: "error" };
  }
}

/** 로그아웃 시 이 기기로 더는 알림이 가지 않도록 폐기한다. */
export async function unregisterPush(): Promise<void> {
  try {
    if (!Device.isDevice) return;
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") return;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: projectId() });
    if (!token) return;
    await apiFetch(`/api/mobile/push/register?expoToken=${encodeURIComponent(token)}`, {
      method: "DELETE",
    });
  } catch {
    // 폐기 실패는 조용히 무시(다음 로그인 시 토큰이 새 사용자로 이전된다).
  }
}

/** 앱 아이콘 뱃지 갱신(미결재+안읽은 메일 합). */
export async function setBadgeCount(n: number): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, n));
  } catch {
    /* noop */
  }
}
