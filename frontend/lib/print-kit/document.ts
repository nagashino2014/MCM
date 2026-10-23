/*
 * print-kit 자체 완결 HTML 조립(클라이언트 안전, 순수 함수) — 블루프린트 §9.
 * 스타일·쪽 나누기 스크립트는 인라인으로 넣고, 서체·이미지는 주소(url)로만 가리킨다.
 *   서버 발행: converter 가 https://print.local/… 주소를 page.route 로 직접 응답한다(외부 네트워크 차단).
 *   화면 미리보기: 같은 HTML 을 앱 경로(/print-kit/…, /api/catalog/assets/…)로 연다.
 * 서체를 base64 로 통째로 넣지 않는다(한글 서체는 굵기당 1MB 이상) — Chromium 이 PDF 에 쓴 글자만 부분 포함한다.
 */

export interface PrintFontFace {
  family: string;
  weight: number;
  style?: "normal" | "italic";
  url: string;
  format: "woff" | "woff2" | "truetype" | "opentype";
  /** 크기 보정(%) — 기준 서체와 시각 크기·글자 폭을 맞춘다(@font-face size-adjust, 회사소개서 블루프린트 §5-4) */
  sizeAdjust?: number;
}

export interface PrintConfig {
  /** 쪽 번호 자릿수(회사소개서 2 → 09) */
  folioDigits?: number;
  /** 이어지는 표·제목에 붙이는 말(기본 " (계속)") */
  continuedLabel?: string;
  /** 서체·이미지 대기 상한(ms) */
  assetTimeoutMs?: number;
}

export interface PrintHtmlOptions {
  lang: string;
  title: string;
  /** 쪽 틀(sheet.css) → 토큰 → 디자인 시스템 → 문서 보정 순서로 넣는다 */
  styles: string[];
  fonts: PrintFontFace[];
  /** 쪽들(.pk-sheet)을 담은 본문 HTML — 보통 renderToStaticMarkup 결과 */
  body: string;
  /** public/print-kit/paginate.js 원문 */
  script: string;
  config?: PrintConfig;
  bodyClass?: string;
  meta?: Record<string, string>;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function fontFaceCss(faces: PrintFontFace[]): string {
  return faces
    .map(
      (f) =>
        `@font-face { font-family: "${f.family}"; font-weight: ${f.weight}; font-style: ${f.style ?? "normal"}; font-display: block; src: url("${f.url}") format("${f.format}");${
          f.sizeAdjust ? ` size-adjust: ${f.sizeAdjust}%;` : ""
        } }`
    )
    .join("\n");
}

/** </style>·</script> 가 본문에 섞여도 태그가 닫히지 않게 한다 */
const safeStyle = (css: string) => css.replace(/<\/style/gi, "<\\/style");
const safeScript = (js: string) => js.replace(/<\/script/gi, "<\\/script");

export function buildPrintHtml(o: PrintHtmlOptions): string {
  const meta = Object.entries(o.meta ?? {})
    .map(([k, v]) => `<meta name="${esc(k)}" content="${esc(v)}">`)
    .join("");
  return (
    `<!doctype html><html lang="${esc(o.lang)}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=842">` +
    `<title>${esc(o.title)}</title>${meta}` +
    `<style>${safeStyle(fontFaceCss(o.fonts))}</style>` +
    o.styles.map((css) => `<style>${safeStyle(css)}</style>`).join("") +
    `</head><body class="pk-doc${o.bodyClass ? " " + esc(o.bodyClass) : ""}">` +
    `<div class="pk-book">${o.body}</div>` +
    `<script>window.__pkConfig=${JSON.stringify(o.config ?? {}).replace(/</g, "\\u003c")};</script>` +
    `<script>${safeScript(o.script)}</script>` +
    `</body></html>`
  );
}

/** A4 가로(297mm) 폭 CSS px ÷ 쪽 폭(842) — converter 가 page.pdf scale 로 쓴다(1px = 1pt). */
export const SHEET_W = 842;
export const SHEET_H = 595;
export const PDF_SCALE = (297 / 25.4) * 96 / SHEET_W;
