/**
 * 휴무일(법정공휴일·명절·사내 지정) 조회 — 웹 캘린더와 같은 창구(`/api/home/holidays`)를 쓴다.
 *
 * 웹 `ScheduleCalendar`/`ScheduleCalendarCard` 는 오래전부터 일·공휴일을 붉게 표시하는데
 * 모바일 `MonthCalendar` 에는 빠져 있었다(2026-09-11 지적). 서버가 연 단위로 캐시하므로
 * 앱에서도 연도별 모듈 캐시로 화면 전환·월 이동 시 재호출하지 않는다.
 * 실패해도 침묵 — 캘린더는 공휴일 없이 그대로 동작한다.
 */
import { useEffect, useState } from "react";

import { apiJson } from "@/lib/api";

interface OffDay {
  date: string; // YYYY-MM-DD
  name: string; // 휴무일명(캘린더 표시)
}

/** 연도 → (date → 휴무일명). 성공 응답만 캐시한다. */
const cache = new Map<number, Map<string, string>>();
const EMPTY = new Map<string, string>();

export function useHolidays(year: number): Map<string, string> {
  const [map, setMap] = useState<Map<string, string>>(() => cache.get(year) ?? EMPTY);

  useEffect(() => {
    const hit = cache.get(year);
    if (hit) {
      setMap(hit);
      return;
    }
    let alive = true;
    setMap(EMPTY);
    apiJson<{ holidays?: OffDay[] }>(`/api/home/holidays?year=${year}`)
      .then((d) => {
        if (!Array.isArray(d.holidays)) return;
        const next = new Map(d.holidays.map((h) => [h.date, h.name] as const));
        cache.set(year, next);
        if (alive) setMap(next);
      })
      .catch(() => {
        /* 침묵 — 공휴일 없이 렌더 */
      });
    return () => {
      alive = false;
    };
  }, [year]);

  return map;
}
