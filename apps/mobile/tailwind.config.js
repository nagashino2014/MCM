/** @type {import('tailwindcss').Config} */
//
// KESI Frosted 디자인 토큰 이식(2026-11-03) — 실제 색 값은 src/global.css 의 --cd-* 변수(라이트/다크 듀얼)에 있고
// 여기서는 이름만 매핑한다. 사용 예: className="bg-cd-card border-cd-border text-cd-text".
// style prop 이 필요한 곳(네비게이션 옵션·아이콘·차트)은 src/theme/tokens.ts 의 hex 상수를 쓴다.
//
// 닫힌 스케일을 설정에서 강제한다:
//  - 반경: 모든 네모는 10(rounded-lg·xl·2xl·3xl·card 전부 10), 세그먼트 탭 안쪽만 7(rounded-md), pill 은 rounded-full.
//  - 굵기: 400·500·600 세 단계뿐 — font-bold·extrabold·black 도 600 으로 내린다(700 이상은 UI 에 없다).
//
const cd = (name) => `rgb(var(--cd-${name}) / <alpha-value>)`;

module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    borderRadius: {
      none: "0px",
      xs: "2px",
      sm: "4px",
      DEFAULT: "10px",
      md: "7px",
      lg: "10px",
      xl: "10px",
      "2xl": "10px",
      "3xl": "10px",
      card: "10px",
      full: "9999px",
    },
    fontWeight: {
      thin: "400",
      light: "400",
      normal: "400",
      medium: "500",
      semibold: "600",
      bold: "600",
      extrabold: "600",
      black: "600",
    },
    extend: {
      colors: {
        // 기존 화면(login·card·tabs)이 쓰는 브랜드 별칭 — 하위호환 유지(= primary-fill).
        primary: {
          DEFAULT: "#4A63D8",
          light: "#EEF1FB",
        },
        cd: {
          bg: cd("bg"),
          card: cd("card"),
          surface: cd("surface"),
          border: cd("border"),
          "border-strong": cd("border-strong"),
          "card-border": cd("card-border"),
          text: cd("text"),
          body: cd("body"),
          muted: cd("muted"),
          faint: cd("faint"),
          "grid-line": cd("grid-line"),
          "on-primary": cd("on-primary"),
          "on-error": cd("on-error"),
          "tab-selected": cd("tab-selected"),
          "tab-selected-ink": cd("tab-selected-ink"),
          primary: {
            DEFAULT: cd("primary"),
            soft: cd("primary-soft"),
            strong: cd("primary-strong"),
            fill: cd("primary-fill"),
            edge: cd("primary-fill-edge"),
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
    },
  },
  plugins: [],
};
