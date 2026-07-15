/**
 * 업로드된 명세/가이드 파일에서 텍스트 추출 (analyze 입력용).
 * MVP는 docx 만 지원 — 새 의존성 없이 기존 jszip 으로 word/document.xml 을 풀어 텍스트를 뽑는다.
 * (표 구조는 행/셀 경계에 개행·탭을 넣어 근사 보존 — LLM 이 요청변수/응답필드 표를 파악할 정도면 충분.)
 * pdf/xlsx/hwpx 는 추후(별도 라이브러리 필요).
 */

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8MB

/** OOXML document.xml → 평문(표 경계 보존). */
function docxXmlToText(xml: string): string {
  return xml
    .replace(/<w:tab\b[^>]*\/?>/g, "\t")
    .replace(/<\/w:tc>/g, "\t")
    .replace(/<\/w:tr>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:br\b[^>]*\/?>/g, "\n")
    .replace(/<[^>]+>/g, "") // 나머지 태그(<w:t> 여닫이 포함) 제거 → 텍스트런만 남음
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export interface ExtractedFile {
  kind: string;
  text: string;
}

/** docx 파일 → 텍스트. 미지원 형식·초과 크기는 throw. */
export async function extractGuideFileText(file: File): Promise<ExtractedFile> {
  if (file.size > MAX_FILE_BYTES) throw new Error("file_too_large");
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();
  const isDocx =
    name.endsWith(".docx") ||
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (!isDocx) {
    throw new Error("file_type_unsupported"); // MVP: docx 만
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const JSZipMod = (await import("jszip")) as unknown as { default: typeof import("jszip") };
  const JSZip = JSZipMod.default ?? (JSZipMod as unknown as typeof import("jszip"));
  const zip = await JSZip.loadAsync(buf);
  const doc = zip.file("word/document.xml");
  if (!doc) throw new Error("docx_no_document_xml");
  const xml = await doc.async("string");
  return { kind: "docx", text: docxXmlToText(xml) };
}
