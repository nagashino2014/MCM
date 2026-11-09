/**
 * 면허·인증 증빙 미리보기 이미지 — PDF 로 올린 증빙의 첫 쪽을 PNG 로 그려 회사소개서 인증 쪽 썸네일에 쓴다(2026-11-09 사용자 요청).
 *
 * - 이미지(png·jpg·webp) 증빙은 원본을 그대로 쓰고, PDF 는 첫 쪽을 그려 둘레의 흰 여백을 잘라낸 PNG 를 만든다.
 * - 만든 PNG 는 원본 옆 `<원본 저장 키>.preview.png` 에 보관한다. 키가 원본에서 정해지므로 DB 열이 필요 없고,
 *   증빙을 바꾸면(새 저장 키) 다음 요청 때 새로 만든다. 이미 올린 증빙도 회사소개서를 처음 그릴 때 채워진다.
 * - 그리기는 재무 공급가 원문 검토와 같은 pdfjs + @napi-rs/canvas 경로(renderGroupPdfPage)를 쓴다 — 10MiB·20쪽 이하, 긴 변 1,600px.
 * - 암호화·손상 PDF 등으로 못 그리면 null(인증 쪽은 기본 아이콘). 같은 프로세스에서는 다시 시도하지 않는다.
 */
import type { CompanyCredential } from "./profile";
import { putContractDocument, readContractDocument } from "@/lib/storage/contract-document-storage";

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
const PDF_EXT = /\.pdf$/i;

export type CredentialFile = NonNullable<CompanyCredential["file"]>;

export const isImageCredentialFile = (f: CredentialFile | null | undefined) => Boolean(f && IMAGE_EXT.test(f.fileName));
export const isPdfCredentialFile = (f: CredentialFile | null | undefined) => Boolean(f && PDF_EXT.test(f.fileName));
/** 회사소개서에 그림을 넣을 수 있는 증빙인가(이미지 또는 PDF) */
export const hasCredentialVisual = (f: CredentialFile | null | undefined) => isImageCredentialFile(f) || isPdfCredentialFile(f);

export const credentialPreviewKey = (storageKey: string) => `${storageKey}.preview.png`;

// 저장 키별 진행·결과 — 같은 증빙을 여러 쪽·요청이 동시에 찾아도 한 번만 그린다
const pending = new Map<string, Promise<Buffer | null>>();

/** 흰 여백 잘라내기 — 스캔본·발급본 둘레의 빈 종이를 걷어 썸네일 안에서 증서가 크게 보이게 한다 */
async function trimWhite(png: Buffer): Promise<Buffer> {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const img = await loadImage(png);
  const w = img.width;
  const h = img.height;
  const src = createCanvas(w, h);
  const ctx = src.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, w, h);
  let top = h, left = w, right = -1, bottom = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (Math.min(data[i], data[i + 1], data[i + 2]) < 235) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  if (right < 0) return png;
  const pad = Math.round(Math.max(w, h) * 0.012);
  const x0 = Math.max(0, left - pad);
  const y0 = Math.max(0, top - pad);
  const cw = Math.min(w, right + pad + 1) - x0;
  const ch = Math.min(h, bottom + pad + 1) - y0;
  // 거의 다 비었거나(잡티) 잘라낼 게 거의 없으면 그대로
  if (cw * ch < w * h * 0.15 || cw * ch > w * h * 0.97) return png;
  const out = createCanvas(cw, ch);
  out.getContext("2d").drawImage(src, x0, y0, cw, ch, 0, 0, cw, ch);
  return out.toBuffer("image/png");
}

async function buildPreview(storageKey: string): Promise<Buffer | null> {
  const key = credentialPreviewKey(storageKey);
  const cached = await readContractDocument(key).catch(() => null);
  if (cached?.length) return cached;
  const pdf = await readContractDocument(storageKey).catch(() => null);
  if (!pdf?.length) return null;
  const { renderGroupPdfPage } = await import("@/lib/finance/supply-group-pdf");
  const page = await renderGroupPdfPage(new Uint8Array(pdf), 1);
  const png = await trimWhite(Buffer.from(page.png)).catch(() => Buffer.from(page.png));
  await putContractDocument(key, png, "image/png");
  return png;
}

/**
 * PDF 증빙의 미리보기 PNG(없으면 만들어 보관). PDF 가 아니거나 못 그리면 null.
 * 실패는 프로세스가 살아 있는 동안 기억한다(쪽을 그릴 때마다 망가진 PDF 를 다시 그리지 않게).
 */
export function ensureCredentialPreview(file: CredentialFile | null | undefined): Promise<Buffer | null> {
  if (!file || !isPdfCredentialFile(file)) return Promise.resolve(null);
  const hit = pending.get(file.storageKey);
  if (hit) return hit;
  const job = buildPreview(file.storageKey).catch((e) => {
    console.warn(`[credential-preview] ${file.fileName}: ${(e as Error)?.message ?? e}`);
    return null;
  });
  pending.set(file.storageKey, job);
  // 성공한 결과는 저장소에 있으니 메모리에는 들고 있지 않는다(있다는 사실과 실패만 기억)
  void job.then((png) => {
    if (png) {
      pending.delete(file.storageKey);
      ready.add(file.storageKey);
    }
  });
  return job;
}

const ready = new Set<string>();

/** 회사소개서에 그림을 넣을 수 있는가 — 이미지 증빙은 바로, PDF 는 미리보기가 있거나 만들 수 있을 때(처음 한 번만 그린다) */
export async function credentialVisualReady(file: CredentialFile | null | undefined): Promise<boolean> {
  if (!file) return false;
  if (isImageCredentialFile(file)) return true;
  if (!isPdfCredentialFile(file)) return false;
  if (ready.has(file.storageKey)) return true;
  return Boolean(await ensureCredentialPreview(file));
}

/** 회사소개서 이미지(c/ 키) — 이미지 증빙은 원본, PDF 증빙은 미리보기 PNG */
export async function readCredentialVisual(file: CredentialFile | null | undefined): Promise<{ data: Buffer; contentType: string } | null> {
  if (!file) return null;
  if (isImageCredentialFile(file)) {
    const data = await readContractDocument(file.storageKey);
    if (!data) return null;
    const ext = file.fileName.split(".").pop()?.toLowerCase() ?? "";
    return { data, contentType: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg" };
  }
  const png = await ensureCredentialPreview(file);
  return png ? { data: png, contentType: "image/png" } : null;
}
