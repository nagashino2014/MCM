import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ReactElement } from "react";

/*
 * print-kit 서버 전용 도구 — 정적 렌더, 키트 파일 읽기.
 * 키트 파일(paginate.js·sheet.css·서체·로고·사진)은 frontend/public 아래에 둔다: 실행 이미지에 public 이 그대로 복사되고,
 * 같은 파일을 스튜디오 미리보기가 /print-kit/… 주소로 연다.
 */

/**
 * React 요소 → 정적 HTML.
 * App Router 의 라우트 핸들러는 'react-server' 조건으로 번들되어 `react-dom/server` 를 막아 둔다
 * ("react-dom/server is not supported in React Server Components"). 그래서 번들러를 거치지 않는 Node require 로
 * 서버 렌더러(server.node)를 연다. 컴포넌트는 훅·컨텍스트 없이 props 만 쓰는 순수 함수라 React 판이 섞여도 안전하다.
 */
type StaticRenderer = (el: ReactElement) => string;
let renderer: StaticRenderer | null = null;

function loadRenderer(): StaticRenderer {
  if (renderer) return renderer;
  // eslint-disable-next-line no-eval
  const nodeRequire = eval("require") as NodeRequire;
  const mod = nodeRequire("react-dom/server") as { renderToStaticMarkup: StaticRenderer };
  renderer = mod.renderToStaticMarkup;
  return renderer;
}

export function renderStatic(el: ReactElement): string {
  return loadRenderer()(el);
}

const fileCache = new Map<string, Buffer>();

/** public/ 아래 키트 파일 읽기(캐시). 경로가 public 밖이면 거부한다. */
export async function readPublicFile(rel: string): Promise<Buffer> {
  const cached = fileCache.get(rel);
  if (cached && process.env.NODE_ENV === "production") return cached;
  const root = path.resolve(process.cwd(), "public");
  const target = path.resolve(root, rel);
  if (!target.startsWith(root + path.sep)) throw new Error(`키트 파일 경로가 올바르지 않습니다: ${rel}`);
  const buf = await readFile(target);
  fileCache.set(rel, buf);
  return buf;
}

export async function readPublicText(rel: string): Promise<string> {
  return (await readPublicFile(rel)).toString("utf8");
}

/** PNG·JPEG·WebP 머리에서 픽셀 크기를 읽는다(사진 해상도 검사용). 모르면 null. */
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.length > 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buf.toString("ascii", 12, 16);
    if (chunk === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (chunk === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const b = buf.readUInt32LE(21);
      return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
    }
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
  }
  return null;
}

export function contentTypeOf(file: string): string {
  const ext = path.extname(file).toLowerCase();
  return (
    {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".ttf": "font/ttf",
      ".otf": "font/otf",
      ".css": "text/css",
      ".js": "text/javascript",
    } as Record<string, string>
  )[ext] ?? "application/octet-stream";
}
