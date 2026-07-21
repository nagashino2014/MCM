/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      // cdash 디자인 토큰 이식(웹 --cd-* 대응). primary = 블루 #5D87FF.
      // 라이트/다크 듀얼은 useTheme(색상 스킴)로 처리하고, 여기선 브랜드 팔레트만 고정.
      colors: {
        primary: {
          DEFAULT: "#5D87FF",
          light: "#ECF2FF", // cd-tint-primary
        },
      },
    },
  },
  plugins: [],
};
