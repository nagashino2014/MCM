/**
 * 법인카드 증빙 대조 — 누락 내역 분석의 판정 규칙(DB·네트워크 없는 순수 함수, 2026-11-11 사용자 요청).
 *
 * 증빙 없는 카드 건마다 "사용일이 겹치는 출장"을 전 부서에서 찾아 점수를 매긴다.
 *  - 카드에 지정된 부서를 사용자로 단정하지 않는다. 영업관리본부 카드처럼 다른 부서가 자주 쓰는 카드가 있어
 *    부서 일치는 작은 가점일 뿐이고, 타 부서 사용이 많은 카드(shared)는 그 가점도 주지 않는다.
 *  - 결과는 추정이다. 근거(reasons)와 확신도를 함께 내고, 확정·발송은 사람이 한다.
 *  - 가맹점 주소가 없는 건(기업은행 엑셀 등)은 지역을 대조할 수 없어 확신도가 낮게 나온다.
 */
import { SIDO_LIST, extractRegion } from "@scraper/lib/ieps/region";

export interface EvidenceTxn {
  /** 사용일 YYYY-MM-DD */
  usedOn: string;
  storeName: string | null;
  storeAddr: string | null;
  storeBizType: string | null;
  /** 카드 별칭으로 추정한 부서(없으면 null) */
  cardDeptId: string | null;
  /** 증빙된 사용 이력에서 타 부서 사용이 절반을 넘는 카드 */
  cardShared: boolean;
}

export interface EvidenceTrip {
  docId: string;
  from: string;
  to: string;
  deptId: string | null;
  /** 출장지·방문지 글자(업체명·주소·지명) */
  places: string[];
  /** 출장지 업체의 소재지(마스터에 연결된 경우) */
  regions: { sido: string | null; sigungu: string | null }[];
}

export type SpendKind = "transport" | "lodging" | "meal";
export type Confidence = "high" | "mid" | "low";

export interface TripMatch {
  docId: string;
  score: number;
  confidence: Confidence;
  reasons: string[];
}

export type EvidenceVerdict = "trip_likely" | "trip_possible" | "other";

const compact = (v: string | null | undefined) => String(v ?? "").replace(/\s+/g, "");

const KIND_WORDS: [SpendKind, RegExp][] = [
  ["transport", /철도|코레일|KTX|SRT|에스알|고속버스|시외버스|버스터미널|택시|주유|충전소|주차|통행료|하이패스|도로공사|항공|렌터카|렌트카|쏘카|여객/i],
  ["lodging", /호텔|모텔|숙박|리조트|펜션|게스트하우스|여관|스테이/i],
  ["meal", /음식|식당|한식|중식|일식|양식|분식|카페|커피|제과|베이커리|휴게소|편의점|치킨|국밥|김밥/i],
];
const KIND_LABEL: Record<SpendKind, string> = { transport: "교통", lodging: "숙박", meal: "식음" };

/** 가맹점명·업태로 지출 성격을 가늠한다(BC 업태는 "주 차 장"처럼 공백이 섞여 있어 붙여서 본다). */
export function spendKind(storeName: string | null, storeBizType: string | null): SpendKind | null {
  const text = `${compact(storeBizType)} ${compact(storeName)}`;
  return KIND_WORDS.find(([, re]) => re.test(text))?.[0] ?? null;
}

const addDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** 시군구 이름의 어근 — "수원시 영통구" → ["수원", "영통"]. 한 글자 어근(중구·동구 등)은 오탐이 많아 버린다. */
function sigunguStems(sigungu: string | null): string[] {
  return String(sigungu ?? "")
    .split(/\s+/)
    .map((t) => t.replace(/(특별자치시|특별시|광역시|시|군|구)$/u, ""))
    .filter((t) => t.length >= 2);
}

const sidoShort = (sido: string | null): string | null => (sido ? SIDO_LIST.find((s) => s.full === sido || s.short === sido)?.short ?? null : null);

/** 가맹점 소재지와 출장지의 지역 일치 — sigungu(시군구) / sido(시도만) / none / unknown(가맹점 주소 없음) */
export function regionMatch(txn: Pick<EvidenceTxn, "storeAddr">, trip: Pick<EvidenceTrip, "places" | "regions">): "sigungu" | "sido" | "none" | "unknown" {
  const store = extractRegion(txn.storeAddr);
  if (!store.sido && !store.sigungu) return "unknown";
  const stems = sigunguStems(store.sigungu);
  const storeSido = sidoShort(store.sido);
  const placeText = trip.places.map(compact).join(" ");
  const tripRegions = [...trip.regions, ...trip.places.map((p) => extractRegion(p))];

  const sigunguHit =
    tripRegions.some((r) => !!r.sigungu && !!store.sigungu && r.sigungu === store.sigungu && sidoShort(r.sido) === storeSido) ||
    (stems.length > 0 && stems.some((s) => placeText.includes(s)));
  if (sigunguHit) return "sigungu";
  const sidoHit = !!storeSido && (tripRegions.some((r) => sidoShort(r.sido) === storeSido) || placeText.includes(storeSido));
  return sidoHit ? "sido" : "none";
}

/**
 * 출장 한 건에 대한 점수. 사용일이 출장 기간(전후 1일 포함) 밖이면 후보가 아니다(null).
 *  날짜: 기간 안 40 / 전후 1일 15 · 지역: 시군구 35 / 시도 15 · 지출 성격: 교통·숙박 20 / 식음 10 · 카드 부서 일치 10
 */
export function scoreTrip(txn: EvidenceTxn, trip: EvidenceTrip): TripMatch | null {
  const reasons: string[] = [];
  let score = 0;
  if (txn.usedOn >= trip.from && txn.usedOn <= trip.to) {
    score += 40;
    reasons.push("사용일이 출장 기간 안");
  } else if (txn.usedOn === addDays(trip.from, -1) || txn.usedOn === addDays(trip.to, 1)) {
    score += 15;
    reasons.push(txn.usedOn < trip.from ? "출장 전날 사용" : "출장 다음 날 사용");
  } else {
    return null;
  }

  const region = regionMatch(txn, trip);
  if (region === "sigungu") {
    score += 35;
    reasons.push("가맹점 소재지가 출장지와 같은 시·군·구");
  } else if (region === "sido") {
    score += 15;
    reasons.push("가맹점 소재지가 출장지와 같은 시·도");
  } else if (region === "unknown") {
    reasons.push("가맹점 주소 없음(지역 대조 불가)");
  } else {
    reasons.push("가맹점 소재지가 출장지와 다름");
  }

  const kind = spendKind(txn.storeName, txn.storeBizType);
  if (kind) {
    score += kind === "meal" ? 10 : 20;
    reasons.push(`${KIND_LABEL[kind]} 지출`);
  }

  if (txn.cardShared) {
    reasons.push("여러 부서가 쓰는 카드(부서 일치는 보지 않음)");
  } else if (txn.cardDeptId && trip.deptId && txn.cardDeptId === trip.deptId) {
    score += 10;
    reasons.push("카드 지정 부서와 출장 부서가 같음");
  }

  return { docId: trip.docId, score, confidence: score >= 75 ? "high" : score >= 50 ? "mid" : "low", reasons };
}

/** 출장 후보를 점수순으로(동점은 원래 순서). 최대 limit 건. */
export function rankTrips(txn: EvidenceTxn, trips: EvidenceTrip[], limit = 3): TripMatch[] {
  return trips
    .map((t) => scoreTrip(txn, t))
    .filter((m): m is TripMatch => m != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** 분류 — 확신도 중 이상 후보가 있으면 출장 경비 누락 추정, 낮은 후보만 있으면 확인 필요, 후보가 없으면 그 외 사용. */
export function verdictOf(matches: TripMatch[]): EvidenceVerdict {
  if (!matches.length) return "other";
  return matches[0].confidence === "low" ? "trip_possible" : "trip_likely";
}

/** 증빙된 사용 이력으로 본 공용 카드 여부 — 표본 5건 이상이고 카드 지정 부서 사용이 절반 미만. */
export function isSharedCard(cardDeptId: string | null, usageByDept: Record<string, number>): boolean {
  const total = Object.values(usageByDept).reduce((a, b) => a + b, 0);
  if (!cardDeptId || total < 5) return false;
  return (usageByDept[cardDeptId] ?? 0) / total < 0.5;
}
