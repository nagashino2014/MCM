"use client";

// 회사소개서 스튜디오 진입점 — 캔버스가 iframe·정적 렌더(react-dom/server 브라우저판)를 쓰므로 서버 렌더 없이 브라우저에서만 연다.
// ?doc=문서 id(없으면 마스터) — 첫 화면의 문서 목록에서 고른 문서를 연다(TP0 문서 복수화).

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";

const CatalogStudio = dynamic(() => import("./CatalogStudio").then((m) => m.CatalogStudio), {
  ssr: false,
  loading: () => <p className="p-4 text-sm">스튜디오를 여는 중…</p>,
});

const DOC_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

export function CatalogStudioPage() {
  const sp = useSearchParams();
  const raw = sp.get("doc") ?? "";
  return <CatalogStudio docId={DOC_ID_RE.test(raw) ? raw : "master"} />;
}
