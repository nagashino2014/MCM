/**
 * PDF 텍스트 레이어 추출(디지털 발급본 대상). unpdf(pdfjs) 사용.
 * - 홈택스/정부24 등 텍스트 레이어가 있는 PDF 는 OCR 없이 즉시·무비용 추출.
 * - 스캔·사진 PDF 는 텍스트가 거의 없어 hasUsableTextLayer 가 false → 상위에서 CLOVA OCR 로 폴백.
 * - unpdf 는 ESM 전용이라 dynamic import; 어떤 이유로든 실패하면 "" 반환(상위가 CLOVA 폴백).
 */

/** PDF 의 텍스트 레이어를 추출. 실패 시 "" (throw 하지 않음). */
export async function extractPdfTextLayer(file: File): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const buf = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocumentProxy(buf);
    const { text } = await extractText(pdf, { mergePages: true });
    return typeof text === "string" ? text : String(text ?? "");
  } catch {
    return "";
  }
}

/** 스캔본은 텍스트 레이어가 거의 비어 있으므로, 한글 글자 수로 '진짜 텍스트 PDF' 여부를 판정. */
export function hasUsableTextLayer(text: string): boolean {
  const hangul = (text.match(/[가-힣]/g) || []).length;
  return hangul >= 30;
}
