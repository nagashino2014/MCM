/** @type {import('next').NextConfig} */
const nextConfig = {
  // 빌드 산출 디렉터리 — 기본은 `.next`. 여러 작업 세션이 dev 서버를 동시에 띄우면
  // 같은 `.next` 를 서로 덮어써 청크가 사라진다("Cannot find module './XXXX.js'").
  // 세션마다 NEXT_DIST_DIR=.next-<이름> 을 주면 산출물이 분리돼 충돌하지 않는다.
  // (미설정 시 기존과 동일 — Dockerfile·배포 경로는 영향 없음)
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  serverExternalPackages: ["sql.js"],
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // DB 에는 `/uploads/logos/<key>` 형태의 path 가 그대로 저장돼 있고,
  // 클라이언트는 같은 경로로 <img src> 를 호출한다.
  // 운영 환경에서는 컨테이너 로컬 fs 에 정적 파일이 없으므로
  // 동일 경로를 인증 프록시 라우트(`/api/uploads/logos/<key>`) 로 넘겨 S3 에서 받게 한다.
  async rewrites() {
    return [
      {
        source: "/uploads/logos/:filename",
        destination: "/api/uploads/logos/:filename",
      },
      // 모바일 앱 웹 데모(public/m-app, Expo 정적 export) — 클린 URL 을 라우트별 HTML 로.
      // expo-router 는 /m-app/login 처럼 확장자 없는 경로를 기대한다(_expo·assets·확장자 있는 파일 제외).
      {
        source: "/m-app",
        destination: "/m-app/index.html",
      },
      // 동적 라우트의 직접 진입·새로고침 — expo 가 만든 [param].html 로 매핑.
      // ⚠ 아래 일반 규칙보다 먼저 두어야 한다(rewrites 는 첫 매치 적용).
      {
        source: "/m-app/chat/:roomId(\\d+)",
        destination: "/m-app/chat/[roomId].html",
      },
      {
        source: "/m-app/:route((?!_expo/)(?!assets/)[^.]+)",
        destination: "/m-app/:route.html",
      },
    ];
  },
};

export default nextConfig;
