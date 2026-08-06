/** @type {import('tailwindcss').Config} */
//
// cdash 디자인 토큰 이식 — 실제 색 값은 src/global.css 의 --cd-* 변수(라이트/다크 듀얼)에 있고
// 여기서는 이름만 매핑한다. 사용 예: className="bg-cd-card border-cd-border text-cd-text".
// style prop 이 필요한 곳(네비게이션 옵션·아이콘·차트)은 src/theme/tokens.ts 의 hex 상수를 쓴다.
//
const cd = (name) => `rgb(var(--cd-${name}) / <alpha-value>)`;

module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // 기존 화면(login·card·tabs)이 쓰는 브랜드 별칭 — 하위호환 유지.
        // ⚠ Soft Glass Ink 프라이머리와 같은 값을 유지할 것(옛 #5D87FF 는 폐기).
        primary: {
          DEFAULT: "#4A63D8",
          light: "#ECEFFD", // cd-tint-primary
        },
        cd: {
          bg: cd("bg"),
          card: cd("card"),
          surface: cd("surface"),
          border: cd("border"),
          text: cd("text"),
          body: cd("body"),
          muted: cd("muted"),
          faint: cd("faint"),
          "grid-line": cd("grid-line"),
          primary: {
            DEFAULT: cd("primary"),
            soft: cd("primary-soft"),
            strong: cd("primary-strong"),
          },
          secondary: {
            DEFAULT: cd("secondary"),
            soft: cd("secondary-soft"),
          },
          accent: {
            DEFAULT: cd("accent"),
            soft: cd("accent-soft"),
            strong: cd("accent-strong"),
          },
          success: {
            DEFAULT: cd("success"),
            soft: cd("success-soft"),
          },
          warning: {
            DEFAULT: cd("warning"),
            soft: cd("warning-soft"),
          },
          error: {
            DEFAULT: cd("error"),
            soft: cd("error-soft"),
          },
        },
      },
      borderRadius: {
        // 모바일 홈 개편 핸드오프(확정안 2a)의 카드 radius. 웹 .cd-card 는 18px 이지만
        // 모바일은 전용 규격을 받았다 — 앱 전 화면이 이 값을 쓴다.
        card: "16px",
      },
    },
  },
  plugins: [],
};
