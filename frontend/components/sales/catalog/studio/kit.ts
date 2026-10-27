"use client";

// 스튜디오 지면 키트 — 캔버스·썸네일·미리보기 틀(iframe)에 넣는 문서 CSS·서체·쪽 검사 스크립트.
// 문서 지면은 앱 화면과 CSS 를 섞지 않는다(Precision UI §6 예외: 문서 미리보기) — 그래서 iframe 안에 따로 싣는다.
// 순서는 PDF 와 같다: 쪽 틀(sheet.css) → 토큰 → 디자인 시스템(kc-*) → 발행본 보정 → 스튜디오 요소(글상자·도형·이미지).

import { fontFaceCss } from "@/lib/print-kit/document";
import { tokensToCss, type DesignTokens } from "@/lib/print-kit/tokens";
import tokensJson from "@/lib/catalog/render/tokens.json";
import { PRINT_OVERRIDES } from "@/lib/catalog/render/print-overrides";
import { facePreviewUrl, usableFontSet, type FontSetDef } from "@/lib/catalog/fonts";
import { STUDIO_PRINT_CSS } from "@/lib/catalog/studio/compose";

export interface StudioKit {
  /** 문서 CSS(서체 제외) */
  css: string;
  /** paginate.js 원문 */
  paginate: string;
  /** 서체 라이브러리 세트(스튜디오를 열 때 받음) — 업로드 서체 @font-face·역할 변수 CSS */
  fontSets?: FontSetDef[];
}

let kitPromise: Promise<StudioKit> | null = null;

export function loadStudioKit(): Promise<StudioKit> {
  kitPromise ??= Promise.all(
    ["/print-kit/sheet.css", "/catalog-kit/kesi-catalog.css", "/print-kit/paginate.js"].map((u) =>
      // no-cache = 매번 ETag 로 재검증(바뀌지 않았으면 304). force-cache 는 배포 뒤에도 옛 CSS 를 써서 새 모양(일러스트 등)이 깨졌다
      fetch(u, { cache: "no-cache" }).then((r) => {
        if (!r.ok) throw new Error(`지면 키트를 읽지 못했습니다(${u})`);
        return r.text();
      })
    )
  ).then(([sheet, catalog, paginate]) => ({
    css: [sheet, tokensToCss(tokensJson as unknown as DesignTokens, { themeSelector: (id) => `.kc-concept--${id}` }), catalog, PRINT_OVERRIDES, STUDIO_PRINT_CSS].join("\n"),
    paginate,
  }));
  kitPromise.catch(() => {
    kitPromise = null;
  });
  return kitPromise;
}

/** 세트의 @font-face(+ 사용자 세트는 역할 변수 CSS) — 기본 서체는 /print-kit/fonts, 업로드 서체는 /api/catalog/fonts/… */
export function fontCssFor(fontSetId: string, sets: FontSetDef[] = []): string {
  const set = usableFontSet(fontSetId, sets);
  const faces = fontFaceCss(
    set.faces.map((f) => ({
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
  return set.css ? `${faces}\n${set.css}` : faces;
}

const safe = (css: string) => css.replace(/<\/style/gi, "<\\/style");
const safeJs = (js: string) => js.replace(/<\/script/gi, "<\\/script");

/** 틀 문서 — body 안 내용은 호출자가 넣는다(정적 HTML) 또는 #st-root 에 포털로 그린다 */
export function frameDocument(kit: StudioKit, fontSetId: string, opts: { body?: string; extraCss?: string; script?: "check" | "paginate" | null } = {}): string {
  const script =
    opts.script === "check"
      ? `<script>window.__pkConfig={manual:true};</script><script>${safeJs(kit.paginate)}</script>`
      : opts.script === "paginate"
        ? `<script>window.__pkConfig={folioDigits:2,continuedLabel:" (계속)"};</script><script>${safeJs(kit.paginate)}</script>`
        : "";
  return (
    `<!doctype html><html lang="ko"><head><meta charset="utf-8">` +
    `<style id="st-font">${safe(fontCssFor(fontSetId, kit.fontSets))}</style><style>${safe(kit.css)}</style>` +
    `<style>html,body{margin:0;padding:0}body.pk-doc.st-frame{background:transparent;overflow:hidden}</style><style id="st-extra">${safe(opts.extraCss ?? "")}</style>` +
    `</head><body class="pk-doc st-frame">${opts.body ?? '<div id="st-root"></div>'}${script}</body></html>`
  );
}
