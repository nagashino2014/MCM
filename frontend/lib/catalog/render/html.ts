import { getDb, rowsToObjects } from "@/lib/db";
import { getCatalogAsset } from "@/lib/catalog/clients";
import { getCredential } from "@/lib/company/profile";
import { buildPrintHtml, type PrintFontFace } from "@/lib/print-kit/document";
import { PRINT_ORIGIN, type PrintAsset } from "@/lib/print-kit/converter";
import { contentTypeOf, imageSize, readPublicFile, readPublicText, renderStatic } from "@/lib/print-kit/server";
import { tokensToCss, type DesignTokens } from "@/lib/print-kit/tokens";
import { CONVERTER_BUNDLED_FONTS, facePreviewUrl, facePrintPath } from "@/lib/catalog/fonts";
import { resolveFontSet } from "@/lib/catalog/font-library";
import { readContractDocument } from "@/lib/storage/contract-document-storage";
import { STUDIO_PRINT_CSS, composeDocument } from "@/lib/catalog/studio/compose";
import type { StudioPageState } from "@/lib/catalog/studio/doc";
import { renderTrees } from "@/lib/catalog/studio/render-tree";
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
  /** 쓴 서체 세트와 업로드 서체 파일(생성본에 남겨 서체를 바꾸거나 꺼도 같은 PDF 를 다시 만든다 — §5-5) */
  fontSet: string;
  fonts: Array<{ fontId: string; weight: number; key: string }>;
}

/** 표지 선택(문서 설정 + 사진 해상도 판정) — 스튜디오도 같은 결과로 그린다 */
export async function chooseCover(data: CatalogRenderData, notices: string[]): Promise<CoverChoice> {
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

/**
 * 문서 HTML — 쪽 계획을 노드 트리로 바꿔 스튜디오 편집층(pages, 없으면 기본본)을 얹어 그린다(블루프린트 §9 · P5).
 * 서체 = 문서 서체 세트(기본 세트 lib/catalog/fonts.ts · 사용자 세트 서체 라이브러리 font-library.ts). converter 이미지에 없는 서체 파일
 * (노토·업로드 서체)은 PDF 요청 자산으로 함께 보낸다 — Chromium 이 쓴 글자만 부분 포함한다.
 */
export async function buildCatalogHtml(
  data: CatalogRenderData,
  opts: RenderOptions & { target: RenderTarget; pages?: StudioPageState[] }
): Promise<BuiltCatalogHtml> {
  const notices = [...data.notices];
  const cover = await chooseCover(data, notices);
  const url = (key: ImageKey) => (opts.target === "print" ? PRINT_ORIGIN + key : previewUrl(key));
  const { set, notice } = await resolveFontSet(data.theme.fontSet);
  if (notice) notices.push(notice);
  const ctx: RenderCtx = { url, opts, docLabel: data.docLabel, fontSet: set.id, concept: data.theme.concept };
  const pages = composeDocument(ctx, data, cover, opts.pages ?? []);
  const body = renderStatic(renderTrees(pages.map((p) => p.tree), { url, data }));
  // 실제로 그린 이미지만 converter 에 보낸다(숨긴 쪽·숨긴 요소·바꾼 사진의 원래 그림은 빼고)
  const used = new Set<ImageKey>();
  if (opts.target === "print") {
    const re = /https:\/\/print\.local\/([A-Za-z0-9_./-]+)/g;
    for (let m = re.exec(body); m; m = re.exec(body)) if (!m[1].startsWith("fonts/")) used.add(m[1].replace(/&amp;/g, "&"));
  }
  for (const p of pages) if (p.orphans.length) notices.push(`'${p.item.label}' 쪽의 편집 ${p.orphans.length}건은 데이터 구조가 바뀌어 붙을 곳을 찾지 못했습니다(스튜디오에서 확인).`);
  const [sheetCss, catalogCss, script] = await Promise.all([
    readPublicText("print-kit/sheet.css"),
    readPublicText("catalog-kit/kesi-catalog.css"),
    readPublicText("print-kit/paginate.js"),
  ]);
  const tokensCss = tokensToCss(tokensJson as unknown as DesignTokens, { themeSelector: (id) => `.kc-concept--${id}` });
  const fonts: PrintFontFace[] = set.faces.map((f) => ({
    family: f.family,
    weight: f.weight,
    format: "woff",
    url: opts.target === "print" ? PRINT_ORIGIN + facePrintPath(f) : facePreviewUrl(f),
    sizeAdjust: f.sizeAdjust,
    ascentOverride: f.ascentOverride,
    descentOverride: f.descentOverride,
    lineGapOverride: f.lineGapOverride,
  }));
  const title = `${data.company.name} 회사소개서 ${data.asOfLabel}${opts.naming === "real" ? " (실명판)" : ""}`;
  const html = buildPrintHtml({
    lang: "ko",
    title,
    // 사용자 세트의 역할 변수(.kc-fontset--u-…)는 디자인 시스템 CSS 뒤에
    styles: [sheetCss, tokensCss, catalogCss, ...(set.css ? [set.css] : []), PRINT_OVERRIDES, STUDIO_PRINT_CSS],
    fonts,
    body,
    script,
    config: { folioDigits: 2, continuedLabel: " (계속)" },
    meta: { author: data.company.name, description: `${data.company.name} 회사소개서(${data.asOfLabel} 기준, 자동 생성)` },
  });

  const assets: PrintAsset[] = [];
  const usedFonts = new Map<string, { fontId: string; weight: number; key: string }>();
  for (const f of set.faces) if (f.upload) usedFonts.set(facePrintPath(f), { fontId: f.upload.fontId, weight: f.upload.fileWeight, key: f.upload.woffKey });
  if (opts.target === "print") {
    const sent = new Set<string>();
    for (const f of set.faces) {
      const assetPath = facePrintPath(f);
      if (sent.has(assetPath) || (!f.upload && CONVERTER_BUNDLED_FONTS.has(f.file))) continue;
      sent.add(assetPath);
      const data = f.upload ? await readContractDocument(f.upload.woffKey) : await readPublicFile(`print-kit/fonts/${f.file}`);
      if (data) assets.push({ path: assetPath, contentType: "font/woff", data });
      else notices.push(`서체 파일을 읽지 못해 대체 서체로 그렸습니다: ${f.family} ${f.weight}`);
    }
    for (const key of used) {
      const hit = await loadImageKey(key);
      if (hit) assets.push({ path: key, contentType: hit.contentType, data: hit.data });
      else notices.push(`이미지를 읽지 못해 빈칸으로 남았습니다: ${key}`);
    }
  }
  return { html, title, assets, notices, cover, fontSet: set.id, fonts: Array.from(usedFonts.values()) };
}
