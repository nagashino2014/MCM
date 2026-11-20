import { apiFetch } from './api';

/** API 경유 전송 한도(대화방 화면의 MULTIPART_MAX 와 같다). */
const FORWARD_MAX = 25 * 1024 * 1024;

/** 웹(데모·위젯) — Bearer 로 받은 blob 을 대상 방에 새 첨부로 올린다(서버에 전달 전용 API 가 없다). */
export async function forwardChatImage(
  att: { path: string; fileName: string; byteSize: number | null },
  roomId: number
): Promise<void> {
  if ((att.byteSize ?? 0) > FORWARD_MAX) throw new Error('25MB 를 넘는 그림은 전달할 수 없습니다.');
  const src = await apiFetch(att.path);
  if (!src.ok) throw new Error('그림을 불러오지 못했습니다.');
  const blob = await src.blob();
  const fd = new FormData();
  fd.append('file', blob, att.fileName);
  const res = await apiFetch(`/api/chat/rooms/${roomId}/messages`, { method: 'POST', body: fd });
  if (!res.ok) {
    const d = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(d.error ?? `전달 실패 (HTTP ${res.status})`);
  }
}

/** 그림 한 장을 인쇄한다 — 숨은 iframe 에 그림만 넣어 인쇄 창을 띄운다(대화방 화면 전체가 찍히지 않게). */
export async function printChatImage(path: string): Promise<void> {
  const res = await apiFetch(path);
  if (!res.ok) throw new Error('그림을 불러오지 못했습니다.');
  const url = URL.createObjectURL(await res.blob());
  const doc = (globalThis as unknown as { document: Document }).document;
  const frame = doc.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  frame.srcdoc =
    '<!doctype html><html><head><style>@page{margin:10mm}html,body{margin:0}' +
    'img{display:block;max-width:100%;max-height:100vh;margin:0 auto}</style></head>' +
    `<body><img src="${url}" alt=""></body></html>`;
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    // 인쇄 창이 닫힌 뒤 정리 — 닫힘 시점을 알 수 없어 넉넉히 둔다.
    setTimeout(() => {
      URL.revokeObjectURL(url);
      frame.remove();
    }, 60_000);
  };
  doc.body.appendChild(frame);
}
