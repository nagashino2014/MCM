/**
 * access/refresh 토큰 보관 — 네이티브는 expo-secure-store(Keychain/Keystore),
 * web(개발 편의)은 localStorage 폴백.
 */
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const ACCESS = "mcm.accessToken";
const REFRESH = "mcm.refreshToken";

const isWeb = Platform.OS === "web";

async function setItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function getItem(key: string): Promise<string | null> {
  if (isWeb) return globalThis.localStorage?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

async function delItem(key: string): Promise<void> {
  if (isWeb) {
    globalThis.localStorage?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export function getAccessToken(): Promise<string | null> {
  return getItem(ACCESS);
}

export function getRefreshToken(): Promise<string | null> {
  return getItem(REFRESH);
}

export async function saveTokens(access: string, refresh: string): Promise<void> {
  await Promise.all([setItem(ACCESS, access), setItem(REFRESH, refresh)]);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([delItem(ACCESS), delItem(REFRESH)]);
}
