/**
 * 날씨 위젯 씬 판정 — 데스크탑 `frontend/components/home/widgets/WeatherWidget.tsx` 와 같은 규칙.
 *
 * 우선순위: 명절 시즌(설·추석) > 크리스마스(12월) > 맑음 한정 계절 씬(봄·여름휴가·가을) > 기본 날씨 4종.
 * ⚠ 웹 규칙이 바뀌면 여기도 같이 바꾼다(두 화면의 씬이 갈라지면 안 된다).
 */

export type BaseKind = "맑음" | "흐림" | "비" | "눈";
export type SceneKind = BaseKind | "봄" | "여름휴가" | "가을" | "설날" | "추석" | "크리스마스";

export interface HolidaySeason {
  kind: "seol" | "chuseok";
  day: string;
  start: string;
  end: string;
}

export interface WeatherData {
  temp: number;
  hi: number;
  lo: number;
  base: BaseKind;
}

/** 씬 캔버스 원본 크기 — 모든 씬 좌표가 이 좌표계 기준이다(웹과 동일). */
export const SCENE_W = 400;
export const SCENE_H = 286;

/** 위치 미허용/실패 시 기본 위치 — 본사(서울 금천구). */
export const DEFAULT_LOC = { lat: 37.4569, lon: 126.8956, label: "서울특별시 금천구" };

/** Open-Meteo weather_code → 기본 씬 4종. */
export function toBaseKind(code: number): BaseKind {
  if (code === 0 || code === 1) return "맑음";
  if (code === 2 || code === 3 || code === 45 || code === 48) return "흐림";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "눈";
  if (code >= 51) return "비";
  return "흐림";
}

/** 카드 배경 그라데이션 정지점 — 웹의 `linear-gradient(160deg, …)` 를 SVG stop 으로 옮긴 값. */
export interface GradientStop {
  offset: number;
  color: string;
  opacity: number;
}

export interface SceneMeta {
  bg: GradientStop[];
  /** 상태 문구 서픽스("맑음 · 여름 휴가철"). */
  desc?: string;
  badgeBg: string;
  badgeFg: string;
}

export const SCENE_META: Record<SceneKind, SceneMeta> = {
  맑음: {
    bg: [
      { offset: 0, color: "#FFE4AA", opacity: 0.55 },
      { offset: 0.58, color: "#BED2FF", opacity: 0.45 },
      { offset: 1, color: "#FFFFFF", opacity: 0.6 },
    ],
    badgeBg: "",
    badgeFg: "",
  },
  흐림: {
    bg: [
      { offset: 0, color: "#CED6E6", opacity: 0.7 },
      { offset: 0.62, color: "#E2E7F2", opacity: 0.55 },
      { offset: 1, color: "#FFFFFF", opacity: 0.6 },
    ],
    badgeBg: "",
    badgeFg: "",
  },
  비: {
    bg: [
      { offset: 0, color: "#A8BADE", opacity: 0.6 },
      { offset: 0.6, color: "#CDDAF0", opacity: 0.5 },
      { offset: 1, color: "#FFFFFF", opacity: 0.6 },
    ],
    badgeBg: "",
    badgeFg: "",
  },
  눈: {
    bg: [
      { offset: 0, color: "#D6E0F0", opacity: 0.75 },
      { offset: 0.6, color: "#EBF0FA", opacity: 0.6 },
      { offset: 1, color: "#FFFFFF", opacity: 0.65 },
    ],
    badgeBg: "",
    badgeFg: "",
  },
  설날: {
    bg: [
      { offset: 0, color: "#FFD0BE", opacity: 0.55 },
      { offset: 0.56, color: "#FFECD6", opacity: 0.5 },
      { offset: 1, color: "#FFFFFF", opacity: 0.65 },
    ],
    desc: "설 연휴 시즌",
    badgeBg: "rgba(216,75,63,0.14)",
    badgeFg: "#C4483C",
  },
  추석: {
    bg: [
      { offset: 0, color: "#C6BCF0", opacity: 0.5 },
      { offset: 0.58, color: "#FFE0C4", opacity: 0.45 },
      { offset: 1, color: "#FFFFFF", opacity: 0.62 },
    ],
    desc: "추석 연휴 시즌",
    badgeBg: "rgba(142,134,238,0.18)",
    badgeFg: "#7568D8",
  },
  크리스마스: {
    bg: [
      { offset: 0, color: "#BAE2D4", opacity: 0.55 },
      { offset: 0.58, color: "#D4E2F8", opacity: 0.5 },
      { offset: 1, color: "#FFFFFF", opacity: 0.65 },
    ],
    desc: "크리스마스 시즌",
    badgeBg: "rgba(59,175,142,0.18)",
    badgeFg: "#2E8C71",
  },
  여름휴가: {
    bg: [
      { offset: 0, color: "#FFECAA", opacity: 0.5 },
      { offset: 0.56, color: "#96D6F0", opacity: 0.48 },
      { offset: 1, color: "#BCEADE", opacity: 0.5 },
    ],
    desc: "여름 휴가철",
    badgeBg: "rgba(95,182,232,0.22)",
    badgeFg: "#2E6FA0",
  },
  봄: {
    bg: [
      { offset: 0, color: "#FACDDA", opacity: 0.5 },
      { offset: 0.58, color: "#D6ECDE", opacity: 0.45 },
      { offset: 1, color: "#FFFFFF", opacity: 0.62 },
    ],
    desc: "벚꽃 개화",
    badgeBg: "rgba(240,150,175,0.2)",
    badgeFg: "#C2557E",
  },
  가을: {
    bg: [
      { offset: 0, color: "#F0C496", opacity: 0.5 },
      { offset: 0.58, color: "#FAE2C4", opacity: 0.45 },
      { offset: 1, color: "#FFFFFF", opacity: 0.62 },
    ],
    desc: "단풍 절정",
    badgeBg: "rgba(219,123,60,0.18)",
    badgeFg: "#B05A28",
  },
};

export const kstToday = (): string => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

/** 씬 + 배지 문구 결정(웹 WeatherWidget 의 useMemo 와 같은 분기). */
export function pickScene(
  base: BaseKind,
  now: Date,
  seasons: HolidaySeason[]
): { scene: SceneKind; badge: string | null } {
  const todayYmd = kstToday();
  const month = now.getMonth() + 1;
  const season = seasons.find((s) => todayYmd >= s.start && todayYmd <= s.end);
  const dday = (target: string) =>
    Math.ceil(
      (new Date(`${target}T00:00:00+09:00`).getTime() - new Date(`${todayYmd}T00:00:00+09:00`).getTime()) / 86400000
    );

  if (season) {
    const label = season.kind === "seol" ? "설" : "추석";
    const n = dday(season.day);
    return {
      scene: season.kind === "seol" ? "설날" : "추석",
      badge: n > 0 ? `${label} 연휴 D-${n}` : `${label} 연휴`,
    };
  }
  if (month === 12) {
    const n = dday(`${now.getFullYear()}-12-25`);
    return { scene: "크리스마스", badge: n > 0 ? `성탄 D-${n}` : "크리스마스" };
  }
  if (base === "맑음") {
    if (month >= 3 && month <= 5) return { scene: "봄", badge: "봄 시즌" };
    if (month === 7 || month === 8) return { scene: "여름휴가", badge: "휴가 시즌" };
    if (month === 10 || month === 11) return { scene: "가을", badge: "가을 시즌" };
  }
  return { scene: base, badge: null };
}
