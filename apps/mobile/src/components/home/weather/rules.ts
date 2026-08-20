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

/** 서버가 돌려준 씬 문자열 검증 — 알 수 없는 값이면 기본 씬(맑음). */
export function toBaseKind(v: unknown): BaseKind {
  const s = String(v ?? "");
  return s === "맑음" || s === "흐림" || s === "비" || s === "눈" ? s : "맑음";
}

/** 카드 배경 그라데이션 정지점 — 웹의 `linear-gradient(160deg, …)` 를 SVG stop 으로 옮긴 값. */
export interface GradientStop {
  offset: number;
  color: string;
  opacity: number;
}

export interface SceneMeta {
  bg: GradientStop[];
  /** 야간 카드 배경 — 핸드오프 야간 확정안의 씬별 165deg 3-stop 딥 네이비. */
  nightBg: GradientStop[];
  /** 상태 문구 서픽스("맑음 · 여름 휴가철"). */
  desc?: string;
  badgeBg: string;
  badgeFg: string;
}

const nStops = (a: string, mid: number, b: string, c: string): GradientStop[] => [
  { offset: 0, color: a, opacity: 1 },
  { offset: mid, color: b, opacity: 1 },
  { offset: 1, color: c, opacity: 1 },
];

export const SCENE_META: Record<SceneKind, SceneMeta> = {
  맑음: {
    bg: [
      { offset: 0, color: "#FFE4AA", opacity: 0.55 },
      { offset: 0.58, color: "#BED2FF", opacity: 0.45 },
      { offset: 1, color: "#FFFFFF", opacity: 0.6 },
    ],
    nightBg: nStops("#141B36", 0.55, "#232E54", "#35406B"),
    badgeBg: "",
    badgeFg: "",
  },
  흐림: {
    bg: [
      { offset: 0, color: "#CED6E6", opacity: 0.7 },
      { offset: 0.62, color: "#E2E7F2", opacity: 0.55 },
      { offset: 1, color: "#FFFFFF", opacity: 0.6 },
    ],
    nightBg: nStops("#1A2138", 0.55, "#28304E", "#39415F"),
    badgeBg: "",
    badgeFg: "",
  },
  비: {
    bg: [
      { offset: 0, color: "#A8BADE", opacity: 0.6 },
      { offset: 0.6, color: "#CDDAF0", opacity: 0.5 },
      { offset: 1, color: "#FFFFFF", opacity: 0.6 },
    ],
    nightBg: nStops("#141A30", 0.55, "#222C4A", "#2E3A5C"),
    badgeBg: "",
    badgeFg: "",
  },
  눈: {
    bg: [
      { offset: 0, color: "#D6E0F0", opacity: 0.75 },
      { offset: 0.6, color: "#EBF0FA", opacity: 0.6 },
      { offset: 1, color: "#FFFFFF", opacity: 0.65 },
    ],
    nightBg: nStops("#181F3A", 0.55, "#262F54", "#39456E"),
    badgeBg: "",
    badgeFg: "",
  },
  설날: {
    bg: [
      { offset: 0, color: "#FFD0BE", opacity: 0.55 },
      { offset: 0.56, color: "#FFECD6", opacity: 0.5 },
      { offset: 1, color: "#FFFFFF", opacity: 0.65 },
    ],
    nightBg: nStops("#1A1E3E", 0.55, "#2C2E56", "#403C6A"),
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
    nightBg: nStops("#161A38", 0.55, "#2A2A52", "#3E3866"),
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
    nightBg: nStops("#12183A", 0.55, "#1F2A52", "#2C3A66"),
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
    nightBg: nStops("#101830", 0.52, "#1B2A4E", "#243554"),
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
    nightBg: nStops("#1D2142", 0.58, "#33305A", "#453E6B"),
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
    nightBg: nStops("#1C1E3C", 0.55, "#322C52", "#463A62"),
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

// ── 일출·일몰(NOAA 근사) — 주/야 전환 판정(웹 WeatherWidget 과 동일 식) ─────────────
const RAD = Math.PI / 180;

/** 해당 날짜·좌표의 일출/일몰(UTC 기준 Date). 극야·백야(한국엔 없음)면 null. */
function sunTime(d: Date, lat: number, lon: number, rising: boolean): Date | null {
  const dayOfYear = Math.floor(
    (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 86400000
  );
  const lngHour = lon / 15;
  const t = dayOfYear + ((rising ? 6 : 18) - lngHour) / 24;
  const M = 0.9856 * t - 3.289;
  let L = M + 1.916 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 282.634;
  L = ((L % 360) + 360) % 360;
  let RA = Math.atan(0.91764 * Math.tan(L * RAD)) / RAD;
  RA = ((RA % 360) + 360) % 360;
  RA += (Math.floor(L / 90) - Math.floor(RA / 90)) * 90;
  RA /= 15;
  const sinDec = 0.39782 * Math.sin(L * RAD);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosH = (Math.cos(90.833 * RAD) - sinDec * Math.sin(lat * RAD)) / (cosDec * Math.cos(lat * RAD));
  if (cosH > 1 || cosH < -1) return null;
  const H = (rising ? 360 - Math.acos(cosH) / RAD : Math.acos(cosH) / RAD) / 15;
  const T = H + RA - 0.06571 * t - 6.622;
  const UT = (((T - lngHour) % 24) + 24) % 24;
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) + UT * 3600000);
}

/** 지금이 밤인가 — 일출 전이거나 일몰 후. */
export function isNightAt(now: Date, lat: number, lon: number): boolean {
  const sunrise = sunTime(now, lat, lon, true);
  const sunset = sunTime(now, lat, lon, false);
  if (!sunrise || !sunset) return false;
  // UTC 날짜 경계 때문에 일몰이 일출보다 앞으로 계산되는 시간대(자정~아침)를 흡수한다:
  // "일출~일몰 사이"가 낮이라는 판정을 시각(시·분)만으로 비교한다 — 한국 위도에선 항상 성립.
  const mins = (x: Date) => x.getHours() * 60 + x.getMinutes();
  const n = mins(now);
  return n < mins(sunrise) || n >= mins(sunset);
}

/** 야간 배지 — 기상특보성만(핸드오프 정책). 실제 특보 API 가 없어 실황으로 근사한다:
 *  비→호우주의 / 눈→한파주의 / 밤 최저 25°↑→열대야. 시즌 문구 배지는 야간에서 제거. */
export function nightBadge(weather: WeatherData | null): { text: string; bg: string; fg: string } | null {
  if (!weather) return null;
  if (weather.base === "비") return { text: "호우주의", bg: "rgba(90,140,240,0.3)", fg: "#A9C4F8" };
  if (weather.base === "눈") return { text: "한파주의", bg: "rgba(120,160,255,0.26)", fg: "#BCD0FF" };
  if (weather.lo >= 25) return { text: "열대야", bg: "rgba(232,112,95,0.28)", fg: "#FFB9AC" };
  return null;
}
