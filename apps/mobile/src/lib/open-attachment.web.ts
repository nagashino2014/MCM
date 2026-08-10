import { apiFetch } from './api';

/** 웹(데모·위젯) — Bearer 로 blob 을 받아 브라우저 다운로드로 넘긴다. */
export async function openAttachment(path: string, fileName: string): Promise<void> {
  const res = await apiFetch(path);
  if (!res.ok) throw new Error('다운로드에 실패했습니다.');
  const blob = await res.blob();
  const doc = (globalThis as unknown as { document: Document }).document;
  const a = doc.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}
