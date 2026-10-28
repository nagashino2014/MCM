import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: "var(--primary)",
      },
      // 2026-10-28 shadcn 결정판: 반경 10. rounded-lg(앱 전체 표준 반경 클래스)를 --radius 로 연결한다.
      // shadcn 색 이름(card·muted·accent 등)은 기존 cd-text-muted 등과 겹치지 않게 컴포넌트 도입(P3) 때 --cd-* 로 연결한다.
      borderRadius: {
        lg: "var(--radius, 10px)",
      },
    },
  },
  plugins: [],
};

export default config;
