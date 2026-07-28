/**
 * 앱 잠금(생체인증) — 사내 업무 데이터(결재·메일·근태)를 담게 되므로 기본 ON.
 * 백그라운드로 나간 지 GRACE_MS 를 넘겨 복귀하면 잠근다.
 */
import * as LocalAuthentication from "expo-local-authentication";

import { kvGet, kvSet } from "./kv";

const KEY = "lock.enabled";

/** 이 시간 안에 돌아오면 잠그지 않는다(카메라·파일 선택기 왕복 등). */
export const GRACE_MS = 5 * 60 * 1000;

export async function isLockEnabled(): Promise<boolean> {
  const v = await kvGet<boolean>(KEY);
  return v ? v.value : true; // 기본 ON
}

export async function setLockEnabled(enabled: boolean): Promise<void> {
  await kvSet(KEY, enabled);
}

/** 기기에 생체/PIN 이 등록돼 있는지. 없으면 잠금을 걸어도 해제할 수단이 없다. */
export async function canAuthenticate(): Promise<boolean> {
  try {
    const [hw, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hw && enrolled;
  } catch {
    return false;
  }
}

export async function authenticate(): Promise<boolean> {
  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: "MCM 잠금 해제",
      cancelLabel: "취소",
      // 생체 실패 시 기기 암호로 대체 가능(disableDeviceFallback=false 가 기본).
      disableDeviceFallback: false,
    });
    return res.success;
  } catch {
    return false;
  }
}
