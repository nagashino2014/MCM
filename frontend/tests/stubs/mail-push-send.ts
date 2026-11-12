// test:mail-push 전용 가짜 @/lib/notify/push-expo — 실제 Expo 발송 대신 호출만 기록한다.
export const pushCalls: { userIds: string[]; payload: Record<string, unknown> & { event: string } }[] = [];

export async function sendPush(userIds: string[], payload: Record<string, unknown> & { event: string }) {
  pushCalls.push({ userIds, payload });
  return { ok: true, sentTo: userIds.length };
}
