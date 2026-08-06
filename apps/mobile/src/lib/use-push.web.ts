/**
 * 웹에는 푸시가 없다 — no-op.
 *
 * 웹 번들은 디자인 미리보기(`npx expo start --web`)용이다. expo-notifications 의 API 는
 * 웹에서 던지므로 훅 자체를 갈아끼운다(`use-color-scheme.web.ts` 와 같은 플랫폼 분기 방식).
 */
export function usePushSetup(): void {}
