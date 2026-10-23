"use client";

// 회사소개서 스튜디오 진입점 — 캔버스가 iframe·정적 렌더(react-dom/server 브라우저판)를 쓰므로 서버 렌더 없이 브라우저에서만 연다.

import dynamic from "next/dynamic";

const CatalogStudio = dynamic(() => import("./CatalogStudio").then((m) => m.CatalogStudio), {
  ssr: false,
  loading: () => <p className="p-4 text-sm">스튜디오를 여는 중…</p>,
});

export function CatalogStudioPage() {
  return <CatalogStudio docId="master" />;
}
