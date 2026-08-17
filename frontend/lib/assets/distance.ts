// 출장지 실도로 거리 추정 (P6-B 보강) — 카카오 로컬(지오코딩) + 카카오모빌리티 길찾기.
// KAKAO_REST_API_KEY 미설정이면 조용히 null 반환(운행기록 초안은 거리 없이 생성 — 수기 입력 경로 유지).
// 같은 사무소·출장지 조합은 trip_route_cache 로 재조회를 막는다.

import { getDb, withDbWrite, rowsToObjects } from "@/lib/db";

const KST_NOW = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");

export type OfficeKey = "main" | "gwacheon" | "ulsan";

/** 사무소 지오코딩 질의 — 좌표 하드코딩 대신 키워드 검색(이전 시 질의만 수정). */
const OFFICES: Record<OfficeKey, { label: string; query: string }> = {
  main: { label: "본사(가산)", query: "서울 금천구 가산디지털1로 100" },
  gwacheon: { label: "과천지사", query: "과천 상상자이타워" },
  ulsan: { label: "울산지사", query: "울산산학융합원" },
};

/** 기안자 부서명 → 사무소. 부서명에 지사 지명이 없으면 본사. */
export function officeKeyForDept(deptName: string | null | undefined): OfficeKey {
  const name = String(deptName ?? "");
  if (name.includes("울산")) return "ulsan";
  if (name.includes("과천")) return "gwacheon";
  return "main";
}

interface Coord {
  x: string; // 경도
  y: string; // 위도
}

const kakaoKey = () => process.env.KAKAO_REST_API_KEY || "";

async function kakaoGet(url: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${kakaoKey()}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

/** 키워드 검색 → 주소 검색 폴백. 첫 결과 좌표. */
async function geocode(query: string): Promise<{ coord: Coord; addr: string } | null> {
  const q = encodeURIComponent(query.trim());
  const kw = await kakaoGet(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${q}&size=1`);
  const kwDoc = (kw?.documents as Array<Record<string, unknown>> | undefined)?.[0];
  if (kwDoc?.x && kwDoc?.y) {
    return { coord: { x: String(kwDoc.x), y: String(kwDoc.y) }, addr: String(kwDoc.road_address_name || kwDoc.address_name || query) };
  }
  const ad = await kakaoGet(`https://dapi.kakao.com/v2/local/search/address.json?query=${q}&size=1`);
  const adDoc = (ad?.documents as Array<Record<string, unknown>> | undefined)?.[0];
  if (adDoc?.x && adDoc?.y) {
    return { coord: { x: String(adDoc.x), y: String(adDoc.y) }, addr: String(adDoc.address_name || query) };
  }
  return null;
}

/** 카카오모빌리티 자동차 길찾기 — 편도 거리(m). */
async function carRouteDistance(origin: Coord, dest: Coord): Promise<{ distanceM: number; durationS: number } | null> {
  const data = await kakaoGet(
    `https://apis-navi.kakaomobility.com/v1/directions?origin=${origin.x},${origin.y}&destination=${dest.x},${dest.y}&priority=RECOMMEND`,
  );
  const route = (data?.routes as Array<Record<string, unknown>> | undefined)?.[0];
  const summary = route?.summary as Record<string, unknown> | undefined;
  if (!summary || Number(route?.result_code ?? 0) !== 0) return null;
  const distanceM = Number(summary.distance || 0);
  if (!distanceM) return null;
  return { distanceM, durationS: Number(summary.duration || 0) };
}

const normDest = (s: string) => s.normalize("NFKC").replace(/\s+/g, "").slice(0, 120);

/**
 * 사무소 → 출장지 편도 실도로 거리(km). 캐시 우선, 키 미설정·지오코딩 실패는 null.
 * 왕복은 호출부에서 ×2.
 */
export async function estimateOneWayKm(officeKey: OfficeKey, destination: string): Promise<number | null> {
  const dest = destination.trim();
  if (!dest || !kakaoKey()) return null;
  const routeKey = `${officeKey}:${normDest(dest)}`;
  const db = await getDb();
  const cached = rowsToObjects(await db.exec(`SELECT distance_m FROM trip_route_cache WHERE route_key = $1`, [routeKey]));
  if (cached.length) return Math.round(Number(cached[0].distance_m) / 100) / 10;

  try {
    const [officeGeo, destGeo] = await Promise.all([geocode(OFFICES[officeKey].query), geocode(dest)]);
    if (!officeGeo || !destGeo) return null;
    const route = await carRouteDistance(officeGeo.coord, destGeo.coord);
    if (!route) return null;
    await withDbWrite(async (tx) => {
      await tx.run(
        `INSERT INTO trip_route_cache (route_key, office_key, destination_raw, resolved_addr, distance_m, duration_s, cached_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (route_key) DO UPDATE SET
           resolved_addr = EXCLUDED.resolved_addr, distance_m = EXCLUDED.distance_m,
           duration_s = EXCLUDED.duration_s, cached_at = EXCLUDED.cached_at`,
        [routeKey, officeKey, dest, destGeo.addr, route.distanceM, route.durationS, KST_NOW()],
      );
    });
    return Math.round(route.distanceM / 100) / 10; // km, 소수 1자리
  } catch {
    return null; // 외부 API 장애가 동기화를 막으면 안 된다
  }
}
