import "@/components/cdash/cdash.css";

// 인증(로그인·아이디/비밀번호 찾기) 공통 레이아웃 — cdash 라이트 고정(G-L).
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="cdash cd-fields-white min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      data-theme="light"
      style={{ background: "var(--cd-bg)" }}
    >
      <div
        className="absolute inset-0 -z-10"
        style={{
          background: "linear-gradient(135deg, var(--cd-primary-soft) 0%, transparent 45%, var(--cd-secondary-soft) 100%)",
          opacity: 0.6,
        }}
      />
      {children}
    </div>
  );
}
