import "@/components/cdash/cdash.css";

// 인증(로그인·아이디/비밀번호 찾기) 공통 레이아웃 — cdash 라이트 고정(G-L).
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="cdash cd-canvas cd-fields-white min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      data-theme="light"
    >
      {children}
    </div>
  );
}
