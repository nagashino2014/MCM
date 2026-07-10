// 발주 신호 → 사업장(facilities) 매칭 공용 모듈.
// 기존에는 수집기마다 coreCompanyName 완전일치 Map 을 따로 만들어 썼고(EIASS 매칭률 3.6%),
// 법인격 표기((유)·유한회사 등)·본사명↔사업장명(공장 접미사)·한/영 음차 차이에서 대량 미매칭이 발생했다.
// 이 모듈은 사업장 마스터 보완 배치(2026-07)에서 검증한 정규화 규칙을 매칭 키 파생으로 이식한다.
//  - 키 파생(등록/조회 대칭): 코어명 → 사이트 접미사 제거 → 영문자 한글 음차
//  - facility_aliases(별칭) 를 매칭 모집단에 포함
//  - 동일 키 복수 사업장 허용(다중값 맵) — 대표 1건 채택 + 후보 수 리포트
import { rowsToObjects, type PgDatabase } from "@/lib/db";
import { normalizeCompanyName } from "@/lib/ieps/formatters";
import { SIDO_LIST, SIGUNGU_BY_SIDO_SHORT } from "@scraper/lib/ieps/region";
import { coreCompanyName, isProcurementProxy } from "./signal-extractor";

export type FacilityMatchMethod = "core" | "core_site" | "roman" | "text";

export interface FacilityMatch {
  facilityId: string;
  facilityName: string;
  method: FacilityMatchMethod;
  /** 동일 키에 걸린 사업장 수. 1 초과면 법인 단위 매칭(대표 사업장 채택)으로 해석한다. */
  candidates: number;
}

// 법인격/단체 표기 — coreCompanyName 이 제거하는 ㈜/주식회사/(주) 외의 형태들.
// 특수문자 제거 전에 문자열로 제거해야 "(유)" 가 "유" 로 남는 것을 막는다.
const LEGAL_FORM_RE =
  /유한회사|유한책임회사|재단법인|사단법인|농업회사법인|어업회사법인|합자회사|합명회사|영농조합법인|[（(]\s*유\s*[)）]|[（(]\s*재\s*[)）]|[（(]\s*사\s*[)）]|[（(]\s*합\s*[)）]/g;

// 본사명 ↔ 사업장명 차이의 주범인 사이트 접미사. 반복 제거로 "울산1공장" 류도 흡수.
const SITE_SUFFIX_RE =
  /(제?\d*공장|공장|지사|지점|사업소|사업장|사업부문|본부|캠퍼스|발전소|열병합발전|빛드림본부|지역본부|영업소)$/;

// 영문자 → 한글 음차(LG→엘지, KBI→케이비아이). 사업장 보완 배치에서 검증한 표.
const ROMAN: Record<string, string> = {
  a: "에이", b: "비", c: "씨", d: "디", e: "이", f: "에프", g: "지",
  h: "에이치", i: "아이", j: "제이", k: "케이", l: "엘", m: "엠",
  n: "엔", o: "오", p: "피", q: "큐", r: "알", s: "에스", t: "티",
  u: "유", v: "브이", w: "더블유", x: "엑스", y: "와이", z: "지",
};

const MIN_KEY_LEN = 3;

// "한국동서발전당진(발전본부)"·"현대자동차울산(공장)"처럼 접미사 제거 후 끝에 남는 지역 토큰.
// KOSTAT 시군구 사전(+시도 약칭) 기반이라 임의 문자열 절단이 아니다. 긴 토큰 우선 매칭.
const REGION_TOKENS: string[] = (() => {
  const set = new Set<string>();
  for (const s of SIDO_LIST) if (s.short.length >= 2) set.add(s.short);
  for (const entries of Object.values(SIGUNGU_BY_SIDO_SHORT)) {
    for (const e of entries) {
      const base = e.full.replace(/(시|군|구)$/, "");
      if (base.length >= 2) set.add(base);
      if (e.full.length >= 2) set.add(e.full);
    }
  }
  return [...set].sort((a, b) => b.length - a.length);
})();

// 지역 토큰 제거 후에도 회사 식별력이 남도록 최소 길이를 높게 잡는다("삼성울산"→"삼성" 같은 그룹명 충돌 방지)
const MIN_KEY_LEN_AFTER_REGION = 4;

function stripTrailingRegion(key: string): string | null {
  for (const tok of REGION_TOKENS) {
    if (key.length - tok.length >= MIN_KEY_LEN_AFTER_REGION && key.endsWith(tok)) {
      return key.slice(0, key.length - tok.length);
    }
  }
  return null;
}

/** 매칭 키(코어명): 법인격 전종 제거 후 coreCompanyName. */
export function facilityCoreKey(name: string | null | undefined): string {
  const base = normalizeCompanyName(name ?? "") ?? String(name ?? "");
  return coreCompanyName(base.replace(LEGAL_FORM_RE, "")).toLowerCase();
}

function romanized(key: string): string {
  return key.replace(/[a-z]/g, (ch) => ROMAN[ch] ?? ch);
}

/** 조회/등록 공용 키 파생: [코어, 접미사 제거 …, 각 음차]. 순서 = 신뢰도 순. */
function deriveKeys(coreKey: string): { key: string; method: FacilityMatchMethod }[] {
  const out: { key: string; method: FacilityMatchMethod }[] = [];
  const pushUnique = (key: string, method: FacilityMatchMethod) => {
    if (key.length >= MIN_KEY_LEN && !out.some((o) => o.key === key)) out.push({ key, method });
  };
  pushUnique(coreKey, "core");
  let prev = "";
  let cur = coreKey;
  while (cur && cur !== prev) {
    prev = cur;
    const stripped = cur.replace(SITE_SUFFIX_RE, "");
    if (stripped !== cur) {
      cur = stripped;
      pushUnique(cur, "core_site");
      continue;
    }
    // 접미사가 더 없으면 끝의 지역 토큰(시군구 사전) 제거 시도 — "한국동서발전당진"→"한국동서발전"
    const noRegion = stripTrailingRegion(cur);
    if (noRegion) {
      cur = noRegion;
      pushUnique(cur, "core_site");
    }
  }
  for (const { key, method } of [...out]) {
    if (method === "core" || method === "core_site") {
      const rk = romanized(key);
      if (rk !== key) pushUnique(rk, "roman");
    }
  }
  return out;
}

interface FacEntry {
  facilityId: string;
  name: string;
  /** true = 원명/별칭 코어 그대로의 키. false = 접미사 제거·음차 파생 키. */
  exact: boolean;
}

export interface FacilityMatcher {
  /** 사업자번호(숫자 10자리+) 매칭 — DART 등 BRN 보유 소스용. */
  matchBrn(brnDigits: string | null | undefined): FacilityMatch | null;
  /** 회사명 매칭. 파생 키 순서대로 조회해 첫 히트를 반환. */
  matchName(companyName: string | null | undefined): FacilityMatch | null;
  /** 원문 텍스트 부분포함 매칭(counterparty). 원명 코어 키만 사용(과탐 억제), 최장일치. */
  findInText(text: string, excludeCore: string): FacilityMatch | null;
  /** 모집단 크기(사업장 수). */
  size: number;
}

export async function buildFacilityMatcher(db: PgDatabase): Promise<FacilityMatcher> {
  const facRows = rowsToObjects(
    await db.exec(
      `SELECT f.facility_id, f.company_name, f.normalized_company_name,
              regexp_replace(coalesce(f.business_registration_no,''),'[^0-9]','','g') AS brn_digits,
              regexp_replace(coalesce(f.site_business_registration_no,''),'[^0-9]','','g') AS site_brn_digits
         FROM facilities f
        WHERE f.deleted_at IS NULL`
    )
  );
  let aliasRows: Record<string, unknown>[] = [];
  try {
    aliasRows = rowsToObjects(await db.exec(`SELECT facility_id, alias FROM facility_aliases`));
  } catch {
    aliasRows = []; // 별칭 테이블 부재/오류는 매칭 자체를 막지 않는다
  }
  const aliasesByFac = new Map<string, string[]>();
  for (const r of aliasRows) {
    const fid = String(r.facility_id ?? "");
    const alias = String(r.alias ?? "").trim();
    if (!fid || !alias) continue;
    const list = aliasesByFac.get(fid) ?? [];
    list.push(alias);
    aliasesByFac.set(fid, list);
  }

  const brnToFac = new Map<string, FacEntry>();
  const byKey = new Map<string, FacEntry[]>();
  const methodByKey = new Map<string, FacilityMatchMethod>();
  let size = 0;

  const register = (key: string, method: FacilityMatchMethod, entry: FacEntry) => {
    const list = byKey.get(key);
    if (list) {
      if (!list.some((e) => e.facilityId === entry.facilityId)) list.push(entry);
      // 같은 키가 더 신뢰도 높은 방법으로도 도달 가능하면 그 방법을 기록
      const order: FacilityMatchMethod[] = ["core", "core_site", "roman", "text"];
      if (order.indexOf(method) < order.indexOf(methodByKey.get(key) ?? "text")) {
        methodByKey.set(key, method);
      }
    } else {
      byKey.set(key, [entry]);
      methodByKey.set(key, method);
    }
  };

  for (const r of facRows) {
    const fid = String(r.facility_id ?? "");
    const cname = String(r.company_name ?? "");
    const nname = String(r.normalized_company_name ?? "").trim();
    if (!fid || (!cname && !nname)) continue;
    if (isProcurementProxy(cname) || isProcurementProxy(nname)) continue;
    size++;
    for (const brn of [String(r.brn_digits ?? ""), String(r.site_brn_digits ?? "")]) {
      if (brn.length >= 10 && !brnToFac.has(brn)) {
        brnToFac.set(brn, { facilityId: fid, name: cname || nname, exact: true });
      }
    }
    const sources = [cname, nname, ...(aliasesByFac.get(fid) ?? [])];
    const seenCore = new Set<string>();
    for (const src of sources) {
      const core = facilityCoreKey(src);
      if (core.length < MIN_KEY_LEN || seenCore.has(core)) continue;
      seenCore.add(core);
      for (const { key, method } of deriveKeys(core)) {
        register(key, method, {
          facilityId: fid,
          name: cname || nname,
          exact: method === "core",
        });
      }
    }
  }

  const pick = (list: FacEntry[], method: FacilityMatchMethod): FacilityMatch => {
    // 원명 코어 그대로 등록된 사업장 우선, 그다음 이름 짧은 순(본사/대표 사업장 근사)
    const sorted = [...list].sort((a, b) => {
      if (a.exact !== b.exact) return a.exact ? -1 : 1;
      return a.name.length - b.name.length;
    });
    return {
      facilityId: sorted[0].facilityId,
      facilityName: sorted[0].name,
      method,
      candidates: list.length,
    };
  };

  return {
    size,
    matchBrn(brnDigits) {
      const bd = String(brnDigits ?? "").replace(/[^0-9]/g, "");
      if (bd.length < 10) return null;
      const e = brnToFac.get(bd);
      return e ? { facilityId: e.facilityId, facilityName: e.name, method: "core", candidates: 1 } : null;
    },
    matchName(companyName) {
      const raw = String(companyName ?? "").trim();
      if (!raw || isProcurementProxy(raw)) return null;
      const core = facilityCoreKey(raw);
      for (const { key, method } of deriveKeys(core)) {
        const list = byKey.get(key);
        if (list?.length) {
          // 등록 측 방법과 조회 측 방법 중 낮은 신뢰도를 매칭 방법으로 보고
          const regMethod = methodByKey.get(key) ?? "core";
          const order: FacilityMatchMethod[] = ["core", "core_site", "roman", "text"];
          const finalMethod = order[Math.max(order.indexOf(method), order.indexOf(regMethod))];
          return pick(list, finalMethod);
        }
      }
      return null;
    },
    findInText(text, excludeCore) {
      if (!text) return null;
      const compact = text.replace(/\s+/g, "").toLowerCase();
      let best: { entry: FacEntry; len: number; count: number } | null = null;
      for (const [key, list] of byKey) {
        // 부분포함 검색은 원명 코어 키만(파생 키는 과탐 위험)
        if ((methodByKey.get(key) ?? "core") !== "core") continue;
        if (key.length < MIN_KEY_LEN || key === excludeCore) continue;
        if (compact.includes(key) && (!best || key.length > best.len)) {
          const m = pick(list, "text");
          best = { entry: { facilityId: m.facilityId, name: m.facilityName, exact: true }, len: key.length, count: m.candidates };
        }
      }
      return best
        ? { facilityId: best.entry.facilityId, facilityName: best.entry.name, method: "text", candidates: best.count }
        : null;
    },
  };
}
