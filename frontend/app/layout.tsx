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
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){var t;try{t=localStorage.getItem('cdash-theme')}catch(e){}if(t!=='light'&&t!=='dark')t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t})()` }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
