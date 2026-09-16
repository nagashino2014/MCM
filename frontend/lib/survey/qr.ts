/**
 * 설문 링크 → QR PNG(data URI) 생성. **서버 전용**(qrcode 패키지).
 *
 * 인쇄·화면 배포 겸용이라 오류정정 레벨은 Q(30% 손상 복구), 셀은 고해상도로 뽑아
 * 배포 이미지에서 축소해 쓴다(확대 보간으로 흐려지는 것을 막는다).
 */
import QRCode from "qrcode";

const MAX_URL = 1000;

export function isSurveyLinkValid(url: string): boolean {
  if (!url || url.length > MAX_URL) return false;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** 링크를 QR PNG data URI 로. width 는 출력 픽셀(quiet zone 포함). */
export async function generateQrDataUrl(url: string, width = 880): Promise<string> {
  if (!isSurveyLinkValid(url)) {
    throw Object.assign(new Error("http(s) 로 시작하는 올바른 링크를 입력하세요."), { status: 400 });
  }
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: "Q",
    margin: 1, // 배포 이미지의 흰 프레임이 여백을 더 주므로 1모듈이면 충분
    width: Math.min(Math.max(Math.trunc(width) || 880, 200), 2000),
    color: { dark: "#000000", light: "#FFFFFF" }, // 대비를 낮추면 인식률이 떨어진다 — 순흑/순백 고정
  });
}
