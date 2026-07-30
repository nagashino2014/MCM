/**
 * API 서버 base URL.
 * - 실기기/에뮬레이터/스테이징 전환은 EXPO_PUBLIC_API_URL 환경변수로 한다(.env 또는 EAS env).
 * - 기본값은 로컬 개발용. 실기기에서 로컬 PC 에 붙을 땐 PC 의 LAN IP(예 http://192.168.0.10:3000)
 *   또는 스테이징 URL 을 EXPO_PUBLIC_API_URL 로 지정한다(localhost 는 실기기에서 자기 자신을 가리킴).
 * - ⚠ 로컬 `.env` 는 **개발 전용**이다. 배포(빌드·OTA)에서 이 값이 새어 들어가면 앱이 통째로 죽는다.
 *   OTA 는 `eas.json` 의 build env 를 쓰지 않는다 — `AGENTS.md` "OTA 발행 시 API 주소" 참고.
 */
export const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000"
).replace(/\/$/, "");
