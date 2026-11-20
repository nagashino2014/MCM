import { apiFetch } from './api';
import { downloadToCache } from './download';

/** API 경유 전송 한도(대화방 화면의 MULTIPART_MAX 와 같다) — 전달은 받은 그림을 다시 올리는 방식이라 이 한도를 따른다. */
const FORWARD_MAX = 25 * 1024 * 1024;

/**
 * 대화방 그림을 다른 대화방으로 전달한다(네이티브) — 서버에 전달 전용 API 가 없어, 캐시에 내려받은 파일을
 * 대상 방에 새 첨부로 올린다. 웹은 chat-image-actions.web.ts (blob) 로 갈아끼워진다.
 */
export async function forwardChatImage(
  att: { path: string; fileName: string; byteSize: number | null },
  roomId: number
): Promise<void> {
  if ((att.byteSize ?? 0) > FORWARD_MAX) throw new Error('25MB 를 넘는 그림은 전달할 수 없습니다.');
  const file = await downloadToCache(att.path, att.fileName);
  const fd = new FormData();
  // 네이티브는 expo-file-system File 을 그대로 넘긴다(대화방 sendFile 과 같은 규칙).
  fd.append('file', file as unknown as Blob, att.fileName);
  const res = await apiFetch(`/api/chat/rooms/${roomId}/messages`, { method: 'POST', body: fd });
  if (!res.ok) {
    const d = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(d.error ?? `전달 실패 (HTTP ${res.status})`);
  }
}

/** 인쇄는 PC 웹·데스크탑 위젯에서만 쓴다 — 앱에서는 버튼을 그리지 않는다. */
export async function printChatImage(_path: string): Promise<void> {
  throw new Error('이 기기에서는 인쇄할 수 없습니다.');
}
