// 전자결재 첨부 공통 규약 — 공문·견적서·일반 기안이 같은 키(field_values.file_attachments)를 쓴다.
// 결재자가 앱 안에서 내용을 확인할 수 있는 형식만 허용한다(사용자 확정):
//   pdf · hwpx · docx · xlsx · pptx · 이미지. 구형 hwp(바이너리)·zip 등은 업로드 단계에서 막는다.
// 미리보기 경로: pdf/이미지는 원본 그대로, 오피스·hwpx 는 백엔드 LibreOffice 변환 PDF.

/** 문서에 실리는 첨부 1건 — S3 key 기준(발송 메일 동봉·뷰어 미리보기 공용). */
export interface DocAttachment {
  name: string;
  key: string;
  size: number;
}

/** 미리보기 처리 방식 — 뷰어가 어떤 형태로 그릴지 결정한다. */
export type AttachmentPreviewKind = "pdf" | "image" | "convert";

interface AllowedType {
  ext: string;
  /** 업로드 input 의 accept 에 넣을 MIME(빈 문자열이면 확장자만으로 판정) */
  mime: string;
  kind: AttachmentPreviewKind;
  label: string;
}

const ALLOWED: AllowedType[] = [
  { ext: "pdf", mime: "application/pdf", kind: "pdf", label: "PDF" },
  { ext: "hwpx", mime: "application/hwp+zip", kind: "convert", label: "한글(hwpx)" },
  { ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "convert", label: "워드" },
  { ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "convert", label: "엑셀" },
  { ext: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", kind: "convert", label: "파워포인트" },
  { ext: "png", mime: "image/png", kind: "image", label: "이미지" },
  { ext: "jpg", mime: "image/jpeg", kind: "image", label: "이미지" },
  { ext: "jpeg", mime: "image/jpeg", kind: "image", label: "이미지" },
  { ext: "gif", mime: "image/gif", kind: "image", label: "이미지" },
  { ext: "webp", mime: "image/webp", kind: "image", label: "이미지" },
];

/** 파일 input 의 accept 속성 값. */
export const ATTACHMENT_ACCEPT = ALLOWED.map((a) => `.${a.ext}`).join(",");

/** 사용자 안내 문구(작성 화면·오류 메시지 공통). */
export const ATTACHMENT_ALLOWED_TEXT = "pdf · hwpx · docx · xlsx · pptx · 이미지(png/jpg/gif/webp)";

/** 파일명에서 소문자 확장자만 추출("보고서.PDF" → "pdf"). */
export function attachmentExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

/** 업로드 허용 여부 — 확장자 화이트리스트(브라우저가 보내는 MIME 은 신뢰하지 않는다). */
export function isAllowedAttachment(name: string): boolean {
  return ALLOWED.some((a) => a.ext === attachmentExt(name));
}

/** 미리보기 방식 — 알 수 없는 확장자는 변환 시도(백엔드가 거절하면 뷰어가 다운로드로 안내). */
export function attachmentPreviewKind(name: string): AttachmentPreviewKind {
  return ALLOWED.find((a) => a.ext === attachmentExt(name))?.kind ?? "convert";
}

/** 형식 라벨(뷰어 목록 배지). */
export function attachmentTypeLabel(name: string): string {
  return ALLOWED.find((a) => a.ext === attachmentExt(name))?.label ?? (attachmentExt(name).toUpperCase() || "파일");
}

/** Content-Type — S3 업로드·인라인 서빙 공통. */
export function attachmentContentType(name: string): string {
  return ALLOWED.find((a) => a.ext === attachmentExt(name))?.mime || "application/octet-stream";
}

/** 사람이 읽는 파일 크기. */
export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
