/**
 * 인증이 필요한 파일 내려받기 — 게시판·메일 첨부 공용.
 *
 * ⚠ SDK 57 의 `FileSystem.downloadAsync` 는 런타임에 throw 한다(deprecated).
 *   Bearer 헤더가 필요하므로 `File.createDownloadTask` 경로를 쓴다.
 */
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import { API_BASE_URL } from "./config";
import { getAccessToken } from "./tokens";

/** 파일명에 쓸 수 없는 문자를 정리(캐시 경로 충돌·오류 방지). */
function safeName(name: string): string {
  return (name || "file").replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
}

/** API 경로(또는 절대 URL)의 파일을 캐시에 내려받는다. */
export async function downloadToCache(path: string, fileName: string): Promise<File> {
  const url = path.startsWith("http") ? path : `${API_BASE_URL}${path}`;
  const token = await getAccessToken();
  const dest = new File(Paths.cache, safeName(fileName));
  if (dest.exists) dest.delete();
  const task = File.createDownloadTask(url, dest, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  await task.downloadAsync();
  if (!dest.exists) throw new Error("파일을 내려받지 못했습니다.");
  return dest;
}

/** 내려받아 시스템 공유 시트로 연다(미리보기·다른 앱으로 전달). */
export async function downloadAndShare(
  path: string,
  fileName: string,
  mimeType?: string | null
): Promise<void> {
  const file = await downloadToCache(path, fileName);
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("이 기기에서는 첨부를 열 수 없습니다.");
  }
  await Sharing.shareAsync(file.uri, { mimeType: mimeType ?? undefined });
}

/**
 * 이미지를 data URL 로 읽는다(메일 본문의 cid: 인라인 이미지 치환용).
 * WebView 는 요청에 Bearer 를 붙일 수 없어서, 앱이 미리 받아 본문에 심어야 한다.
 */
export async function downloadAsDataUrl(
  path: string,
  fileName: string,
  mimeType?: string | null
): Promise<string | null> {
  try {
    const file = await downloadToCache(path, fileName);
    const b64 = await file.base64();
    return `data:${mimeType || "image/png"};base64,${b64}`;
  } catch {
    return null;
  }
}
