"use client";

// 서체 견본 공용 — 서체 하나(또는 세트)의 @font-face 를 화면에 싣고, 브라우저가 실제로 읽었는지 확인한다.
// 견본·세트 미리보기는 문서 지면이다(UI 기준 §6 예외: 문서 미리보기) — 흰 종이 면에 문서와 같은 크기 보정으로 그린다.

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { fontFaceCss } from "@/lib/print-kit/document";
import { facePreviewUrl, type FontFaceFile } from "@/lib/catalog/fonts";
import type { CatalogFont } from "@/lib/catalog/font-types";

/** 서체 하나 → 견본용 별칭 서체(kcf-{id}) 의 굵기별 @font-face(문서와 같은 크기 보정) */
export function fontPreviewFaces(font: CatalogFont): FontFaceFile[] {
  const adj = font.sizeAdjust;
  return font.files
    .filter((f) => f.style === "normal")
    .map((f) => ({
      family: `kcf-${font.fontId}`,
      weight: f.weight,
      file: f.file ?? "",
      sizeAdjust: adj.sizeAdjust !== 100 ? adj.sizeAdjust : undefined,
      ascentOverride: adj.ascentOverride,
      descentOverride: adj.descentOverride,
      lineGapOverride: adj.lineGapOverride,
      upload: font.source === "upload" && f.woffKey ? { fontId: font.fontId, fileWeight: f.weight, woffKey: f.woffKey } : undefined,
    }));
}

export function facesCss(faces: FontFaceFile[]): string {
  return fontFaceCss(
    faces.map((f) => ({
      family: f.family,
      weight: f.weight,
      format: "woff" as const,
      url: facePreviewUrl(f),
      sizeAdjust: f.sizeAdjust,
      ascentOverride: f.ascentOverride,
      descentOverride: f.descentOverride,
      lineGapOverride: f.lineGapOverride,
    }))
  );
}

/** @font-face 를 문서에 싣고 굵기마다 읽기 결과를 돌려준다(브라우저가 서체를 거부하면 error) */
export function useLoadedFaces(faces: FontFaceFile[]): { css: string; status: Record<string, "loading" | "ok" | "error"> } {
  const css = useMemo(() => facesCss(faces), [faces]);
  const [status, setStatus] = useState<Record<string, "loading" | "ok" | "error">>({});
  useEffect(() => {
    let alive = true;
    const init: Record<string, "loading"> = {};
    for (const f of faces) init[`${f.family}:${f.weight}`] = "loading";
    setStatus(init);
    // 스타일이 붙은 다음 틱에 읽는다
    const t = setTimeout(() => {
      for (const f of faces) {
        const key = `${f.family}:${f.weight}`;
        document.fonts
          .load(`${f.weight} 20px "${f.family}"`, "가A1")
          .then((loaded) => alive && setStatus((s) => ({ ...s, [key]: loaded.length ? "ok" : "error" })))
          .catch(() => alive && setStatus((s) => ({ ...s, [key]: "error" })));
      }
    }, 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [faces]);
  return { css, status };
}

/** 문서 지면(흰 종이) — 앱 테마와 상관없이 라이트 */
export function Paper({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={`rounded-lg border cd-border-c ${className ?? ""}`} style={{ background: "#ffffff", color: "#1c2333", colorScheme: "light", ...style }} lang="ko">
      {children}
    </div>
  );
}

export const SPECIMEN = {
  title: "통합환경허가 컨설팅, 함께 만드는 푸른 내일",
  latin: "The quick brown fox jumps over the lazy dog",
  digits: "0123456789 · 1,307 · 97건 · 7.4%",
  body:
    "2017년부터 통합환경허가 사업장의 허가 신청서 작성, 배출영향분석, 최적가용기법 검토를 수행해 왔습니다. 대기·수질·폐기물 분야 기술인력이 사업장 현장 조사부터 허가 이후 사후관리까지 한 팀으로 함께합니다.",
  table: [
    ["구분", "사업장", "완료"],
    ["통합환경허가 최초허가", "97", "100%"],
    ["변경허가·변경신고", "175", "98.3%"],
    ["유해대기오염물질(HAPs)", "586", "100%"],
  ],
  figure: "1,307",
};
