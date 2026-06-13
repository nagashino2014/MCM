/**
 * 같은 출처 API 다운로드에서 서버가 지정한 Content-Disposition 파일명을 우선 사용한다.
 * 없을 때만 기존 fallback 파일명을 쓴다.
 */
export function filenameFromDisposition(res: Response, fallback: string): string {
  const disposition = res.headers.get("content-disposition") ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }

  const quoted = /filename="([^"]+)"/i.exec(disposition)?.[1];
  if (quoted) return quoted;

  const plain = /filename=([^;]+)/i.exec(disposition)?.[1]?.trim();
  return plain || fallback;
}
