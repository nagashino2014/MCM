import type { EditionKind, NamingMode, RenderOptions } from "./types";

/** 요청값 → 렌더 옵션(모르는 값은 기본값: 인쇄·배포본 · 마스킹판). 클라이언트 안전. */
export function parseRenderOptions(input: Record<string, unknown> | null | undefined): RenderOptions {
  const o = input ?? {};
  const edition: EditionKind = o.edition === "draft" ? "draft" : "print";
  const naming: NamingMode = o.naming === "real" ? "real" : "masked";
  return { edition, naming };
}
