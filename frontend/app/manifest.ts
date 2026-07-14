import type { MetadataRoute } from "next";

// PWA manifest — 모바일(/m) 홈 화면 설치용. 오프라인·푸시는 범위 외(service worker 없음).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MCM PermitIQ",
    short_name: "MCM",
    description: "MCM 영업 모바일 — 일정·사업장·담당자·명함",
    start_url: "/m",
    display: "standalone",
    background_color: "#eef2f8",
    theme_color: "#5d87ff",
    icons: [
      { src: "/icons/mcm-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/mcm-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/mcm-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
