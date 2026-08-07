/*
 * 홈 날씨 위젯 데이터 소스 — 기상청 동네예보(공공데이터포털) 주경로 + Open-Meteo 폴백.
 *
 * 왜 기상청인가: Open-Meteo(글로벌 모델)는 예보 모델값이라 도심 열섬을 반영하지 못해
 * 실측과 3도 이상 벌어졌다(2026-08-07 가산동: 위젯 30.7 / 실제 34.2). 기상청 초단기실황은
 * 관측 분석값이라 네이버·기상청 앱이 보여주는 '현재 기온'과 같은 값이 나온다.
 *
 * 구성: ①초단기실황 getUltraSrtNcst — T1H(기온)·PTY(강수형태)
 *       ②초단기예보 getUltraSrtFcst — SKY(하늘상태, 실황에는 없다)
 *       ③단기예보   getVilageFcst   — TMX/TMN(일 최고·최저)
 * 키(KMA_SERVICE_KEY)가 없거나 호출이 실패하면 조용히 Open-Meteo 로 떨어진다(위젯은 항상 뜬다).
 */

export type WeatherBaseKind = "맑음" | "흐림" | "비" | "눈";

export interface WeatherResult {
  temp: number;
  hi: number;
  lo: number;
  base: WeatherBaseKind;
  /** 어느 소스에서 나온 값인지 — 위젯 디버깅·폴백 확인용. */
  source: "kma" | "open-meteo";
}

const KMA_BASE = "http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0";

/** 기상청 격자(LCC DFS) 변환 상수 — 기상청 배포 알고리즘 그대로. */
const GRID = { RE: 6371.00877, GRID_KM: 5.0, SLAT1: 30.0, SLAT2: 60.0, OLON: 126.0, OLAT: 38.0, XO: 43, YO: 136 };

/** 위경도 → 기상청 격자 좌표(nx, ny). */
export function latLonToGrid(lat: number, lon: number): { nx: number; ny: number } {
  const DEGRAD = Math.PI / 180.0;
  const re = GRID.RE / GRID.GRID_KM;
  const slat1 = GRID.SLAT1 * DEGRAD;
  const slat2 = GRID.SLAT2 * DEGRAD;
  const olon = GRID.OLON * DEGRAD;
  const olat = GRID.OLAT * DEGRAD;

  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);

  let ra = Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lon * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;

  return {
    nx: Math.floor(ra * Math.sin(theta) + GRID.XO + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + GRID.YO + 0.5),
  };
}

/** 기상청 격자가 커버하는 한반도 범위인지(밖이면 Open-Meteo 로 간다). */
const inKorea = (lat: number, lon: number) => lat >= 32 && lat <= 39.5 && lon >= 124 && lon <= 132;

/** KST 기준 현재 시각 조각. */
function kstNow(): { ymd: string; hh: number; mm: number } {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  const iso = d.toISOString();
  return { ymd: iso.slice(0, 10).replace(/-/g, ""), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
}

/** ymd/시(hour)에서 n시간을 뺀 값(자정 넘김 처리). */
function shiftHour(ymd: string, hour: number, back: number): { ymd: string; hour: number } {
  let h = hour - back;
  let y = ymd;
  while (h < 0) {
    h += 24;
    const d = new Date(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    y = d.toISOString().slice(0, 10).replace(/-/g, "");
  }
  return { ymd: y, hour: h };
}

interface KmaItem {
  category: string;
  obsrValue?: string;
  fcstValue?: string;
  fcstDate?: string;
  fcstTime?: string;
}

/** 공공데이터포털 인증키 — Decoding 키를 넣었으면 인코딩해서 붙인다(이미 인코딩된 키는 그대로). */
function serviceKeyParam(): string | null {
  const raw = process.env.KMA_SERVICE_KEY?.trim();
  if (!raw) return null;
  return raw.includes("%") ? raw : encodeURIComponent(raw);
}

async function callKma(op: string, params: Record<string, string>): Promise<KmaItem[]> {
  const key = serviceKeyParam();
  if (!key) throw new Error("KMA_SERVICE_KEY 미설정");
  const qs = new URLSearchParams({ dataType: "JSON", pageNo: "1", ...params }).toString();
  const res = await fetch(`${KMA_BASE}/${op}?serviceKey=${key}&${qs}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`${op} HTTP ${res.status}`);
  const json = await res.json();
  const code = json?.response?.header?.resultCode;
  if (code !== "00") throw new Error(`${op} resultCode=${code} ${json?.response?.header?.resultMsg ?? ""}`);
  const items = json?.response?.body?.items?.item;
  return Array.isArray(items) ? (items as KmaItem[]) : [];
}

/** PTY(강수형태)·SKY(하늘상태) → 위젯 씬 4종. PTY 가 우선한다. */
export function kmaToBaseKind(pty: number, sky: number): WeatherBaseKind {
  if (pty === 3 || pty === 7 || pty === 2 || pty === 6) return "눈"; // 눈·눈날림·비/눈·빗방울눈날림
  if (pty > 0) return "비"; // 비·소나기·빗방울
  if (sky === 1) return "맑음";
  return "흐림"; // 3=구름많음, 4=흐림
}

/** Open-Meteo weather_code → 씬 4종(폴백 경로). */
export function openMeteoToBaseKind(code: number): WeatherBaseKind {
  if (code === 0 || code === 1) return "맑음";
  if (code === 2 || code === 3 || code === 45 || code === 48) return "흐림";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "눈";
  if (code >= 51) return "비";
  return "흐림";
}

const num = (v: string | undefined): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function fetchKma(lat: number, lon: number): Promise<WeatherResult> {
  const { nx, ny } = latLonToGrid(lat, lon);
  const grid = { nx: String(nx), ny: String(ny) };
  const { ymd, hh, mm } = kstNow();

  // ① 초단기실황 — 매시 정시 관측이 40분경 올라온다.
  const ncstAt = shiftHour(ymd, hh, mm < 40 ? 1 : 0);
  const ncst = await callKma("getUltraSrtNcst", {
    numOfRows: "20",
    base_date: ncstAt.ymd,
    base_time: `${String(ncstAt.hour).padStart(2, "0")}00`,
    ...grid,
  });
  const temp = num(ncst.find((i) => i.category === "T1H")?.obsrValue);
  if (temp == null) throw new Error("T1H 없음");
  const pty = num(ncst.find((i) => i.category === "PTY")?.obsrValue) ?? 0;

  // ② 초단기예보 — SKY 는 실황에 없어 예보에서 가장 가까운 시각 값을 쓴다(매시 30분 발표, 45분 제공).
  let sky = 1;
  try {
    const fcstAt = shiftHour(ymd, hh, mm < 45 ? 1 : 0);
    const fcst = await callKma("getUltraSrtFcst", {
      numOfRows: "60",
      base_date: fcstAt.ymd,
      base_time: `${String(fcstAt.hour).padStart(2, "0")}30`,
      ...grid,
    });
    const skyItems = fcst.filter((i) => i.category === "SKY");
    sky = num(skyItems[0]?.fcstValue) ?? 1;
  } catch {
    // SKY 실패 시 강수 없으면 맑음으로 둔다(기온·강수형태는 이미 확보).
  }

  // ③ 단기예보 — 일 최고/최저. TMX/TMN 이 없는 발표 회차면 오늘 TMP 시계열로 대체한다.
  let hi = Math.round(temp);
  let lo = Math.round(temp);
  try {
    const slots = [23, 20, 17, 14, 11, 8, 5, 2];
    const nowMin = hh * 60 + mm;
    const slot = slots.find((s) => nowMin >= s * 60 + 10);
    // 02:10 이전이면 오늘 발표분이 없다 → 전날 23시 발표(shiftHour 가 날짜까지 넘겨준다).
    const at = slot != null ? { ymd, hour: slot } : shiftHour(ymd, 0, 1);
    const vilage = await callKma("getVilageFcst", {
      numOfRows: "300",
      base_date: at.ymd,
      base_time: `${String(at.hour).padStart(2, "0")}00`,
      ...grid,
    });
    const today = vilage.filter((i) => i.fcstDate === ymd);
    const tmx = num(today.find((i) => i.category === "TMX")?.fcstValue);
    const tmn = num(today.find((i) => i.category === "TMN")?.fcstValue);
    const temps = today.filter((i) => i.category === "TMP").map((i) => num(i.fcstValue)).filter((n): n is number => n != null);
    hi = Math.round(tmx ?? (temps.length ? Math.max(...temps, temp) : temp));
    lo = Math.round(tmn ?? (temps.length ? Math.min(...temps, temp) : temp));
  } catch {
    // 최고/최저 실패는 치명적이지 않다 — 현재 기온으로 둔다.
  }

  // 실황이 예보를 앞지르는 경우가 있다(2026-08-07 대관령: 현재 29.7 / 예보 최고 27)
  // — "현재 기온이 오늘 최고기온보다 높은" 표시를 막기 위해 현재값을 범위에 포함시킨다.
  return {
    temp,
    hi: Math.max(hi, Math.round(temp)),
    lo: Math.min(lo, Math.round(temp)),
    base: kmaToBaseKind(pty, sky),
    source: "kma",
  };
}

async function fetchOpenMeteo(lat: number, lon: number): Promise<WeatherResult> {
  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=Asia%2FSeoul&forecast_days=1`,
    { cache: "no-store", signal: AbortSignal.timeout(8000) }
  );
  if (!res.ok) throw new Error(`open-meteo HTTP ${res.status}`);
  const d = await res.json();
  const temp = Number(d?.current?.temperature_2m);
  if (!Number.isFinite(temp)) throw new Error("open-meteo 응답 이상");
  return {
    temp,
    hi: Math.round(Number(d.daily?.temperature_2m_max?.[0] ?? temp)),
    lo: Math.round(Number(d.daily?.temperature_2m_min?.[0] ?? temp)),
    base: openMeteoToBaseKind(Number(d.current.weather_code)),
    source: "open-meteo",
  };
}

// 격자 단위 메모리 캐시 — 실황이 10분 주기로 갱신되므로 그 이하로는 재호출하지 않는다
// (홈 화면 특성상 전 직원이 같은 격자를 동시에 조회한다).
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; data: WeatherResult }>();

/** 위젯용 날씨 1건 — 기상청 우선, 실패 시 Open-Meteo. */
export async function getWeather(lat: number, lon: number): Promise<WeatherResult> {
  const key = inKorea(lat, lon) ? (({ nx, ny }) => `${nx},${ny}`)(latLonToGrid(lat, lon)) : `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  let data: WeatherResult;
  if (inKorea(lat, lon) && process.env.KMA_SERVICE_KEY) {
    try {
      data = await fetchKma(lat, lon);
    } catch (err) {
      console.warn("[weather] 기상청 조회 실패 — Open-Meteo 폴백:", (err as Error).message);
      data = await fetchOpenMeteo(lat, lon);
    }
  } else {
    data = await fetchOpenMeteo(lat, lon);
  }
  cache.set(key, { at: Date.now(), data });
  return data;
}
