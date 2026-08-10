/** presigned PUT 대용량 업로드 — 웹(데모·위젯)은 브라우저 fetch PUT. S3 CORS(PUT) 필요. */
export async function uploadLargeFile(
  url: string,
  file: { uri: string; mimeType: string | null; webFile?: Blob }
): Promise<void> {
  const body = file.webFile ?? (await (await fetch(file.uri)).blob());
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': file.mimeType ?? 'application/octet-stream' },
    body,
  });
  if (!res.ok) throw new Error(`업로드에 실패했습니다. (HTTP ${res.status})`);
}
