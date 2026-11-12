// 메일 첨부 미리보기 형식 판정(직원 요청 23, 2026-11-12) — 화면(눈 아이콘 표시 여부)과
// 다운로드 API(?preview=… 응답 방식)가 같은 기준을 쓰도록 한 곳에 둔다. 서버 전용 import 금지.
//   image   : 브라우저가 그대로 그리는 이미지(svg 는 스크립트를 품을 수 있어 제외)
//   pdf     : 브라우저 PDF 뷰어
//   convert : 문서 변환 서비스(converter, LibreOffice)로 PDF 를 만들어 표시 — 결재 첨부와 같은 경로
//   text    : 글자로 표시(EUC-KR 파일도 서버에서 UTF-8 로 바꿔 준다)
//   html    : 글자로 받아 스크립트·외부 요청을 막은 sandbox iframe 에 그린다
//   none    : 미리보기 미지원(zip·dwg 등) — 내려받아 확인

export type MailAttachmentPreviewKind = "image" | "pdf" | "convert" | "text" | "html" | "none";

const KIND_BY_EXT: Record<string, MailAttachmentPreviewKind> = {
  jpg: "image",
  jpeg: "image",
  png: "image",
  gif: "image",
  bmp: "image",
  webp: "image",
  pdf: "pdf",
  // converter/office_convert.py 의 CONVERTIBLE_EXTS 중 문서 형식(txt·csv 는 글자로 바로 보여 준다)
  hwp: "convert",
  hwpx: "convert",
  doc: "convert",
  docx: "convert",
  xls: "convert",
  xlsx: "convert",
  ppt: "convert",
  pptx: "convert",
  odt: "convert",
  ods: "convert",
  odp: "convert",
  rtf: "convert",
  txt: "text",
  csv: "text",
  log: "text",
  md: "text",
  json: "text",
  xml: "text",
  html: "html",
  htm: "html",
};

/** 이미지 인라인 응답의 Content-Type — 저장된 content_type(보낸 쪽이 정한 값)은 믿지 않고 확장자로 정한다. */
export const MAIL_PREVIEW_IMAGE_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
};

export function mailAttachmentExt(filename: string): string {
  const m = String(filename ?? "").toLowerCase().match(/\.([a-z0-9]{1,6})$/);
  return m ? m[1] : "";
}

export function mailAttachmentPreviewKind(filename: string): MailAttachmentPreviewKind {
  return KIND_BY_EXT[mailAttachmentExt(filename)] ?? "none";
}
