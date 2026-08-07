/**
 * 날씨 위젯 데이터 — 시계·위치·기상·명절 시즌.
 *
 * 소스는 데스크탑 위젯과 같다: 위치(OS 권한 → 거부 시 본사), 역지오코딩(BigDataCloud, 무키),
 * 기상(`/api/home/weather` — 기상청 초단기실황, 서버가 Open-Meteo 폴백), 명절 구간(`/api/home/holidays`).
 * 위젯은 실패해도 침묵한다 — 시계는 계속 돌고 씬은 기본값(맑음)으로 유지된다.
 */
import { useEffect, useState } from "react";
import * as Location from "expo-location";

import { apiJson } from "@/lib/api";
import { DEFAULT_LOC, toBaseKind, type HolidaySeason, type WeatherData } from "./rules";

/** 1분 해상도 시계 — 위젯이 표시하는 최소 단위가 분이라 초 단위로 리렌더하지 않는다(배터리). */
export function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    // 다음 분 경계에 맞춘 뒤 1분 간격으로 돈다.
    const ms = 60_000 - (Date.now() % 60_000);
    let iv: ReturnType<typeof setInterval> | null = null;
    const to = setTimeout(() => {
      tick();
      iv = setInterval(tick, 60_000);
    }, ms);
    return () => {
      clearTimeout(to);
      if (iv) clearInterval(iv);
    };
  }, []);
  return now;
}

interface Coords {
  lat: number;
  lon: number;
}

/** OS 위치 권한 → 좌표. 거부·실패하면 본사 좌표를 유지한다(권한 요청은 1회). */
function useCoords(): Coords {
  const [coords, setCoords] = useState<Coords>({ lat: DEFAULT_LOC.lat, lon: DEFAULT_LOC.lon });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") return;
        const pos = await Location.getLastKnownPositionAsync({ maxAge: 30 * 60 * 1000 });
        const fix = pos ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }));
        if (alive && fix) setCoords({ lat: fix.coords.latitude, lon: fix.coords.longitude });
      } catch {
        /* 권한 거부·위치 꺼짐 — 기본 위치 유지 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return coords;
}

/** 역지오코딩 — "시도 시군구" 라벨. */
function useLocationLabel(coords: Coords): string | null {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${coords.lat}&longitude=${coords.lon}&localityLanguage=ko`
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || !alive) return;
        // 특별시·광역시는 principalSubdivision/city 가 같은 값이라 구 단위가 안 나온다
        // → OSM adminLevel(4=시도, 6=시군구)에서 뽑는다(웹과 동일).
        const admin: { name?: string; adminLevel?: number }[] = Array.isArray(d.localityInfo?.administrative)
          ? d.localityInfo.administrative
          : [];
        const sido = admin.find((a) => a.adminLevel === 4)?.name ?? d.principalSubdivision;
        const sigungu = admin.find((a) => a.adminLevel === 6)?.name ?? (d.city && d.city !== sido ? d.city : d.locality);
        const parts = [sido, sigungu].filter(Boolean).map((s: string) => String(s).trim());
        const merged = Array.from(new Set(parts)).join(" ");
        if (merged) setLabel(merged);
      })
      .catch(() => {
        if (alive) setLabel((v) => v ?? DEFAULT_LOC.label);
      });
    return () => {
      alive = false;
    };
  }, [coords]);

  return label;
}

/** 기상 — 10분 간격 갱신(초단기실황이 매시 40분경 갱신된다). */
function useForecast(coords: Coords): WeatherData | null {
  const [weather, setWeather] = useState<WeatherData | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      apiJson<{ temp?: number; hi?: number; lo?: number; base?: string }>(
        `/api/home/weather?lat=${coords.lat}&lon=${coords.lon}`
      )
        .then((d) => {
          if (!alive || !Number.isFinite(Number(d.temp))) return;
          setWeather({
            temp: Number(d.temp),
            hi: Math.round(Number(d.hi)),
            lo: Math.round(Number(d.lo)),
            base: toBaseKind(d.base),
          });
        })
        .catch(() => {
          /* 침묵 — 시계는 계속 동작한다 */
        });
    };
    load();
    const t = setInterval(load, 10 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [coords]);

  return weather;
}

/** 설·추석 시즌 구간. */
function useHolidaySeasons(): HolidaySeason[] {
  const [seasons, setSeasons] = useState<HolidaySeason[]>([]);

  useEffect(() => {
    let alive = true;
    apiJson<{ seasons?: HolidaySeason[] }>(`/api/home/holidays?year=${new Date().getFullYear()}`)
      .then((d) => {
        if (alive && Array.isArray(d.seasons)) setSeasons(d.seasons);
      })
      .catch(() => {
        /* 침묵 — 시즌 없이 기본 씬으로 */
      });
    return () => {
      alive = false;
    };
  }, []);

  return seasons;
}

export function useWeather(): {
  locLabel: string | null;
  weather: WeatherData | null;
  seasons: HolidaySeason[];
} {
  const coords = useCoords();
  return {
    locLabel: useLocationLabel(coords),
    weather: useForecast(coords),
    seasons: useHolidaySeasons(),
  };
}
