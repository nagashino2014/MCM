import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

/**
 * 웹 정적 export 의 HTML 껍데기(expo-router) — 네이티브에는 영향이 없다.
 * PWA(2026-11-04): 브라우저 "앱으로 설치" 가 되도록 manifest·아이콘·테마색을 달고, 설치 프롬프트를 미리 붙잡아 두며,
 * 서비스 워커(캐시 없음, 설치 요건용)를 등록한다. 데스크탑 위젯(iframe) 안에서는 등록하지 않는다.
 * 경로 접두사(/m-app)는 정적 export 에서만 붙으므로 실행 시 location 으로 판정한다(개발 서버는 /).
 */
const PWA_BOOT = `
(function () {
  if (window.parent !== window) return;
  var base = location.pathname.indexOf('/m-app') === 0 ? '/m-app' : '';
  var link = document.createElement('link'); link.rel = 'manifest'; link.href = base + '/manifest.webmanifest'; document.head.appendChild(link);
  var icon = document.createElement('link'); icon.rel = 'apple-touch-icon'; icon.href = base + '/pwa/icon-192.png'; document.head.appendChild(icon);
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); window.__mcmInstallPrompt = e; });
  // scope 는 '/m-app'(끝 슬래시 없음) — next 가 '/m-app/' 를 '/m-app' 으로 308 돌리므로 start_url·scope 를 슬래시 없이 맞춘다.
  // 워커 파일 위치(/m-app/sw.js)보다 넓은 scope 라 next.config 가 Service-Worker-Allowed: /m-app 헤더를 준다.
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register(base + '/sw.js', { scope: base || '/' }).catch(function () {});
  }
})();
`;

/**
 * 문서 바탕색(2026-11-06) — 데스크탑 위젯은 이 문서를 다른 오리진의 iframe 으로 싣는다. html 에 배경이 없으면 Chromium 이
 * "투명 문서"로 보고 글자 전체에서 ClearType(서브픽셀)을 꺼 회색조로 뿌옇게 그린다(리포트 §8-1 실측). 화면에는 셸 그라데이션이
 * 이 색을 덮으므로 보이는 모양은 그대로다. 값은 theme/tokens.ts 의 bg(라이트 #f1f3f9 · 다크 #141520).
 * 앱 설정으로 테마를 고정한 경우는 _layout 이 실행 중에 html 배경을 다시 맞춘다.
 */
const DOC_BACKGROUND = `html{background-color:#f1f3f9}@media (prefers-color-scheme: dark){html{background-color:#141520}}`;

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="ko">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <meta name="application-name" content="MCM" />
        <meta name="apple-mobile-web-app-title" content="MCM" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="theme-color" content="#4a63d8" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: DOC_BACKGROUND }} />
        <script dangerouslySetInnerHTML={{ __html: PWA_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
