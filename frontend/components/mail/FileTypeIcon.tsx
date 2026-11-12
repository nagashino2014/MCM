// 파일 형식 아이콘(2026-11-12 사용자 요청) — 메일 첨부 목록에서 확장자별로 알아보기 쉬운 아이콘을 그린다.
// 제품 로고를 흉내 내지 않고, 접힌 모서리 문서 + 형식 색 띠(확장자 글자) + 종류 그림(글줄·표·막대·지퍼·사진 등)으로 구분한다.
// 등록되지 않은 형식은 윈도 기본 파일 아이콘처럼 빈 흰 문서로 그린다.

type Glyph = "lines" | "grid" | "slides" | "zipper" | "picture" | "code" | "pdf" | "cad" | "pen";

interface FileTypeSpec {
  /** 색 띠에 쓰는 글자 */
  label: string;
  /** 띠·그림 색 */
  color: string;
  glyph: Glyph;
  /** 띠 글자색(기본 흰색) */
  ink?: string;
}

const SPEC: Record<string, FileTypeSpec> = {
  hwp: { label: "HWP", color: "#1f8fcf", glyph: "lines" },
  hwpx: { label: "HWPX", color: "#1f8fcf", glyph: "lines" },
  doc: { label: "DOC", color: "#2b5797", glyph: "lines" },
  docx: { label: "DOCX", color: "#2b5797", glyph: "lines" },
  xls: { label: "XLS", color: "#1e7145", glyph: "grid" },
  xlsx: { label: "XLSX", color: "#1e7145", glyph: "grid" },
  csv: { label: "CSV", color: "#1e7145", glyph: "grid" },
  ppt: { label: "PPT", color: "#c8472b", glyph: "slides" },
  pptx: { label: "PPTX", color: "#c8472b", glyph: "slides" },
  pdf: { label: "PDF", color: "#d93025", glyph: "pdf" },
  zip: { label: "ZIP", color: "#a16207", glyph: "zipper" },
  rar: { label: "RAR", color: "#7e3fa0", glyph: "zipper" },
  egg: { label: "EGG", color: "#e5a000", glyph: "zipper", ink: "#3b2a00" },
  "7z": { label: "7Z", color: "#57534e", glyph: "zipper" },
  html: { label: "HTML", color: "#e8590c", glyph: "code" },
  htm: { label: "HTM", color: "#e8590c", glyph: "code" },
  txt: { label: "TXT", color: "#6b7280", glyph: "lines" },
  dwg: { label: "DWG", color: "#b42318", glyph: "cad" },
  dxf: { label: "DXF", color: "#b42318", glyph: "cad" },
  dwf: { label: "DWF", color: "#0b6e99", glyph: "cad" },
  jpg: { label: "JPG", color: "#0d9488", glyph: "picture" },
  jpeg: { label: "JPG", color: "#0d9488", glyph: "picture" },
  png: { label: "PNG", color: "#7c3aed", glyph: "picture" },
  bmp: { label: "BMP", color: "#4f6bd8", glyph: "picture" },
  gif: { label: "GIF", color: "#db2777", glyph: "picture" },
  webp: { label: "WEBP", color: "#0d9488", glyph: "picture" },
  ai: { label: "AI", color: "#f08c00", glyph: "pen", ink: "#2a1500" },
};

/** 파일 이름 → 소문자 확장자(없으면 ""). */
export function fileExtension(filename: string): string {
  const m = String(filename ?? "").toLowerCase().match(/\.([a-z0-9]{1,6})$/);
  return m ? m[1] : "";
}

/** 이 확장자에 전용 아이콘이 있는지(테스트·매뉴얼 확인용). */
export function hasFileTypeIcon(filename: string): boolean {
  return fileExtension(filename) in SPEC;
}

function GlyphShape({ glyph, color }: { glyph: Glyph; color: string }) {
  switch (glyph) {
    case "lines":
      return (
        <g stroke={color} strokeWidth="1.4" strokeLinecap="round">
          <path d="M7 7.5h10M7 10.5h10M7 13.5h7" />
        </g>
      );
    case "grid":
      return (
        <g stroke={color} strokeWidth="1.1" fill="none">
          <rect x="6.5" y="6" width="11" height="9" rx="0.8" />
          <path d="M6.5 9h11M6.5 12h11M10.2 6v9M13.8 6v9" />
        </g>
      );
    case "slides":
      return (
        <g fill={color}>
          <rect x="6.5" y="6" width="11" height="8" rx="1" fillOpacity="0.18" stroke={color} strokeWidth="1.1" />
          <rect x="8.5" y="10.5" width="1.8" height="2.4" />
          <rect x="11.1" y="8.6" width="1.8" height="4.3" />
          <rect x="13.7" y="9.6" width="1.8" height="3.3" />
        </g>
      );
    case "zipper":
      return (
        <g fill={color}>
          <rect x="10.5" y="3" width="3" height="1.6" />
          <rect x="12" y="4.6" width="3" height="1.6" />
          <rect x="10.5" y="6.2" width="3" height="1.6" />
          <rect x="12" y="7.8" width="3" height="1.6" />
          <rect x="10.5" y="9.4" width="4.5" height="5" rx="0.8" />
          <rect x="11.9" y="11.2" width="1.7" height="1.6" fill="#fff" />
        </g>
      );
    case "picture":
      return (
        <g>
          <rect x="6.5" y="6" width="11" height="8.5" rx="1" fill={color} fillOpacity="0.14" stroke={color} strokeWidth="1.1" />
          <circle cx="9.6" cy="8.8" r="1.2" fill={color} />
          <path d="M7 14l3.4-3.4 2.2 2.2 1.6-1.6L17 14z" fill={color} />
        </g>
      );
    case "code":
      return (
        <g stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <path d="M9.5 7.5L7 10.2l2.5 2.7M14.5 7.5L17 10.2l-2.5 2.7M12.8 6.8l-1.6 6.8" />
        </g>
      );
    case "pdf":
      // 펼친 문서 위 둥근 고리 — 인쇄 고정 문서의 느낌만 살린다.
      return (
        <g stroke={color} strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 13.8c1.6-1.2 2.9-3.6 3.6-6.4.2-.9-.9-1.2-1.1-.3-.4 1.9 1.6 4.5 5.1 5.4.9.2.8-1-.1-1-2.6.1-5.8 1.2-7.5 2.3z" />
        </g>
      );
    case "cad":
      // 제도용 삼각자·컴퍼스 선
      return (
        <g stroke={color} strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 14.5L12 6l5 8.5z" />
          <path d="M9.4 12.3h5.2" />
          <circle cx="12" cy="6" r="0.9" fill={color} />
        </g>
      );
    case "pen":
      // 펜촉
      return (
        <g stroke={color} strokeWidth="1.3" fill="none" strokeLinejoin="round">
          <path d="M12 5.5l3.6 4.6-1.4 4.4h-4.4l-1.4-4.4z" fill={color} fillOpacity="0.15" />
          <path d="M12 5.5v5.2" />
          <circle cx="12" cy="11.4" r="0.9" fill={color} />
        </g>
      );
  }
}

/** 확장자별 파일 아이콘. size 는 세로 px(가로는 0.8배). */
export function FileTypeIcon({ filename, size = 28, className }: { filename: string; size?: number; className?: string }) {
  const spec = SPEC[fileExtension(filename)];
  const w = Math.round(size * 0.8);
  const page = "M4 1.5h11l5.5 5.5v20a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 27V3A1.5 1.5 0 0 1 4 1.5z";
  if (!spec) {
    // 윈도 기본 파일 아이콘 — 접힌 모서리의 빈 흰 문서.
    return (
      <svg width={w} height={size} viewBox="0 0 24 30" className={className} aria-hidden="true">
        <path d={page} fill="#ffffff" stroke="#9aa3af" strokeWidth="1" />
        <path d="M15 1.5V6a1 1 0 0 0 1 1h4.5" fill="#eef1f5" stroke="#9aa3af" strokeWidth="1" />
      </svg>
    );
  }
  const fontSize = spec.label.length >= 4 ? 5.2 : spec.label.length === 3 ? 6.2 : 7;
  return (
    <svg width={w} height={size} viewBox="0 0 24 30" className={className} aria-hidden="true">
      <path d={page} fill="#ffffff" stroke="#c5cbd3" strokeWidth="1" />
      <path d="M15 1.5V6a1 1 0 0 0 1 1h4.5" fill="#eef1f5" stroke="#c5cbd3" strokeWidth="1" />
      <GlyphShape glyph={spec.glyph} color={spec.color} />
      <rect x="1" y="18" width="20" height="8.5" rx="1.6" fill={spec.color} />
      <text
        x="11"
        y="24.2"
        textAnchor="middle"
        fontSize={fontSize}
        fontWeight="700"
        fill={spec.ink ?? "#ffffff"}
        fontFamily="'Pretendard Variable', Pretendard, system-ui, sans-serif"
        letterSpacing="0.1"
      >
        {spec.label}
      </text>
    </svg>
  );
}
