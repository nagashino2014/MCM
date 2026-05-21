/** @type {import('next').NextConfig} */
const nextConfig = {
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
    ];
  },
};

export default nextConfig;
