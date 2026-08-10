import * as FileSystem from 'expo-file-system/legacy';

/**
 * presigned PUT 대용량 업로드(MSG-P2) — 네이티브는 파일 스트리밍(uploadAsync, 메모리 안전).
 * 웹은 upload-large.web.ts (fetch PUT blob) 로 갈아끼워진다.
 */
export async function uploadLargeFile(
  url: string,
  file: { uri: string; mimeType: string | null; webFile?: Blob }
): Promise<void> {
  const res = await FileSystem.uploadAsync(url, file.uri, {
    httpMethod: 'PUT',
    headers: { 'content-type': file.mimeType ?? 'application/octet-stream' },
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`업로드에 실패했습니다. (HTTP ${res.status})`);
  }
}
