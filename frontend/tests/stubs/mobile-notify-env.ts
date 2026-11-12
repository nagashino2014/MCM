// test:push-notify 전용 — 앱(apps/mobile) 모듈이 쓰는 react-native·./api·./notification-tray 를 대신한다.
export const apiCalls: string[] = [];
export const badgeSyncs: number[] = [];
let nextBadges: Record<string, number> = { mailUnread: 0, approvalPending: 0, chatUnread: 0 };
let gate: Promise<void> = Promise.resolve();

export function setNextBadges(v: Record<string, number>): void {
  nextBadges = v;
}
/** 다음 응답을 이 약속이 풀릴 때까지 붙잡는다(동시 호출 시험용). */
export function holdApi(p: Promise<void>): void {
  gate = p;
}

export async function apiJson<T>(path: string): Promise<T> {
  apiCalls.push(path);
  const snapshot = { ...nextBadges };
  await gate;
  return snapshot as T;
}

export async function syncAppBadge(count: number): Promise<void> {
  badgeSyncs.push(count);
}

export const AppState = { addEventListener: () => ({ remove() {} }) };
