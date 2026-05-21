import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PermitIQ — IEPS 통합환경허가 관리",
  description: "IEPS 통합환경허가 게시판 수집·OCR 추출·검수·CRM 연동",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
