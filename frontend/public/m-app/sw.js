/*
 * MCM 웹앱 서비스 워커(2026-11-04) — PWA 설치 요건용 최소 구현.
 * ⚠ 캐시를 두지 않는다: 번들은 next 배포마다 바뀌고, 캐시가 있으면 옛 화면이 남아 배포가 반영되지 않는다.
 *   모든 요청은 네트워크로 그대로 흘린다.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  e.respondWith(fetch(e.request));
});
