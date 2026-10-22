import { createElement } from "react";
import { getDb, rowsToObjects } from "@/lib/db";
import { getCatalogAsset } from "@/lib/catalog/clients";
import { getCredential } from "@/lib/company/profile";
import { readContractDocument } from "@/lib/storage/contract-document-storage";
import { buildPrintHtml, type PrintFontFace } from "@/lib/print-kit/document";
import { PRINT_ORIGIN, type PrintAsset } from "@/lib/print-kit/converter";
import { contentTypeOf, imageSize, readPublicFile, readPublicText, renderStatic } from "@/lib/print-kit/server";
import { tokensToCss, type DesignTokens } from "@/lib/print-kit/tokens";
import { CatalogDocument } from "./components/document";
import type { CoverChoice } from "./components/pages-front";
import { PRINT_OVERRIDES } from "./print-overrides";
import tokensJson from "./tokens.json";
import type { CatalogRenderData, ImageKey, RenderCtx, RenderOptions } from "./types";

/*
 * 회사소개서 자체 완결 HTML 조립(서버) — 블루프린트 §9.
 *   target "print"   : converter 용. 서체·이미지 주소 = https://print.local/…, 자산 바이트를 함께 돌려준다.
 *   target "preview" : 앱 화면 미리보기. 같은 HTML 을 앱 경로(/print-kit/…, /catalog-kit/…, 자산 라우트)로 연다.
 * 스타일 순서: 쪽 틀(print-kit sheet.css) → 토큰(tokens.json → CSS 변수) → 디자인 시스템(kc-*) → 발행본 보정.
 */

export type RenderTarget = "print" | "preview";

const FONT_FILES: Array<{ weight: number; file: string }> = [
  { weight: 400, file: "Pretendard-Regular.woff" },
  { weight: 600, file: "Pretendard-SemiBold.woff" },
  { weight: 700, file: "Pretendard-Bold.woff" },
];
/** 기본 서체 세트 — 서체 라이브러리(P5b) 전까지는 프리텐다드만 들어 있다(converter 이미지에도 같은 파일). */
const BUNDLED_FONT_SETS = new Set(["pretendard"]);

/** 표지 사진 — 표시 상자(pt)와 맞춤 방식. 효과 해상도 = 72 ÷ (pt/px). */
const COVER_PHOTO: Record<CoverChoice["cover"], { file: string; box: [number, number]; fit: "cover" | "width" } | null> = {
  leaf: { file: "assets/hq-cover-tall.webp", box: [368, 515], fit: "cover" },
  strips: { file: "assets/hq-cover-tall.webp", box: [400, 0], fit: "width" },
  band: { file: "assets/hq-cover-wide.webp", box: [842, 300], fit: "cover" },
  center: null,
};
const MIN_PRINT_DPI = 150;
const GOOD_PRINT_DPI = 300;

export interface BuiltCatalogHtml {
  html: string;
  title: string;
  assets: PrintAsset[];
  /** 데이터·자산 단계 확인 사항 */
  notices: string[];
  cover: CoverChoice;
}

async function chooseCover(data: CatalogRenderData, notices: string[]): Promise<CoverChoice> {
  const cover = data.theme.cover;
  const spec = COVER_PHOTO[cover];
  if (!spec || data.theme.coverPhoto === "none") return { cover, photo: null };
  const size = imageSize(await readPublicFile(`catalog-kit/${spec.file}`));
  if (!size) return { cover, photo: `k/${spec.file}` };
  const [bw, bh] = spec.box;
  const ptPerPx = spec.fit === "width" ? bw / size.width : Math.max(bw / size.width, bh / size.height);
  const dpi = Math.round(72 / ptPerPx);
  if (dpi < MIN_PRINT_DPI) {
    notices.push(`표지 사진 해상도가 낮아(${size.width}px → 약 ${dpi}dpi, 인쇄 최소 ${MIN_PRINT_DPI}dpi) 사진 없는 변형으로 만들었습니다. 고해상도 사옥 사진을 올리면 사진 표지로 바뀝니다.`);
    return { cover, photo: null };
  }
  if (dpi < GOOD_PRINT_DPI) notices.push(`표지 사진은 약 ${dpi}dpi 입니다(화면·PDF 는 충분, 인쇄 권장 ${GOOD_PRINT_DPI}dpi 미만).`);
  return { cover, photo: `k/${spec.file}` };
}

function previewUrl(key: ImageKey): string {
  if (key.startsWith("k/")) return `/catalog-kit/${key.slice(2)}`;
  return `/api/catalog/render/asset?key=${encodeURIComponent(key)}`;
}

/** 이미지 키 → 바이트(PDF 용). 없으면 null. */
export async function loadImageKey(key: ImageKey): Promise<{ data: Buffer; contentType: string } | null> {
  const [kind, ...rest] = key.split("/");
  const id = rest.join("/");
  if (!id || id.includes("..")) return null;
  if (kind === "k") {
    const data = await readPublicFile(`catalog-kit/${id}`).catch(() => null);
    return data ? { data, contentType: contentTypeOf(id) } : null;
  }
  if (kind === "a") {
    const asset = await getCatalogAsset(id);
    const data = asset ? await readContractDocument(asset.storageKey) : null;
    return data && asset ? { data, contentType: asset.contentType } : null;
  }
  if (kind === "c") {
    const cred = await getCredential(id);
    const data = cred?.file ? await readContractDocument(cred.file.storageKey) : null;
    return data && cred?.file ? { data, contentType: contentTypeOf(cred.file.fileName) } : null;
  }
  if (kind === "e") {
    const db = await getDb();
    const r = rowsToObjects(await db.exec("SELECT photo_storage_key FROM employee_profiles WHERE employee_id = $1", [id]))[0];
    const storageKey = r?.photo_storage_key ? String(r.photo_storage_key) : "";
    if (!storageKey) return null;
    try {
      const { getEmployeeDocument } = await import("@/lib/storage/employee-document-storage");
      const obj = await getEmployeeDocument(storageKey);
      if (!obj.body) return null;
      const bytes = Buffer.from(await new Response(obj.body).arrayBuffer());
      return { data: bytes, contentType: obj.contentType };
    } catch {
      return null;
    }
  }
  return null;
}

export async function buildCatalogHtml(data: CatalogRenderData, opts: RenderOptions & { target: RenderTarget }): Promise<BuiltCatalogHtml> {
  const notices = [...data.notices];
  const cover = await chooseCover(data, notices);
  const used = new Set<ImageKey>();
  const url = (key: ImageKey) => {
    used.add(key);
    return opts.target === "print" ? PRINT_ORIGIN + key : previewUrl(key);
  };
  let fontSet = data.theme.fontSet;
  if (!BUNDLED_FONT_SETS.has(fontSet)) {
    notices.push(`서체 세트 '${fontSet}'는 아직 서체 라이브러리에 없어 기본 프리텐다드로 만들었습니다.`);
    fontSet = "pretendard";
  }
  const ctx: RenderCtx = { url, opts, docLabel: data.docLabel, fontSet };
  const body = renderStatic(createElement(CatalogDocument, { ctx, data, cover }));
  const [sheetCss, catalogCss, script] = await Promise.all([
    readPublicText("print-kit/sheet.css"),
    readPublicText("catalog-kit/kesi-catalog.css"),
    readPublicText("print-kit/paginate.js"),
  ]);
  const tokensCss = tokensToCss(tokensJson as unknown as DesignTokens, { themeSelector: (id) => `.kc-concept--${id}` });
  const fonts: PrintFontFace[] = FONT_FILES.map((f) => ({
    family: "Pretendard",
    weight: f.weight,
    format: "woff",
    url: opts.target === "print" ? `${PRINT_ORIGIN}fonts/${f.file}` : `/print-kit/fonts/${f.file}`,
  }));
  const title = `${data.company.name} 회사소개서 ${data.asOfLabel}${opts.naming === "real" ? " (실명판)" : ""}`;
  const html = buildPrintHtml({
    lang: "ko",
    title,
    styles: [sheetCss, tokensCss, catalogCss, PRINT_OVERRIDES],
    fonts,
    body,
    script,
    config: { folioDigits: 2, continuedLabel: " (계속)" },
    meta: { author: data.company.name, description: `${data.company.name} 회사소개서(${data.asOfLabel} 기준, 자동 생성)` },
  });

  const assets: PrintAsset[] = [];
  if (opts.target === "print") {
    for (const key of used) {
      const hit = await loadImageKey(key);
      if (hit) assets.push({ path: key, contentType: hit.contentType, data: hit.data });
      else notices.push(`이미지를 읽지 못해 빈칸으로 남았습니다: ${key}`);
    }
  }
  return { html, title, assets, notices, cover };
}
