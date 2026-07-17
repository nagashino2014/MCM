/**
 * 공공입찰(bid) 목록 조회 — 종류별 테이블(public_order_plans/prior_specs/bid_notices)에서
 * 필터·서버 페이지네이션으로 읽는다. bidType 은 화이트리스트로만 테이블에 매핑(SQL 주입 방지).
 */
import { getDb, rowsToObjects } from "@/lib/db";
import { buildRuleWhere, type RuleGroup } from "@/lib/bid/match";
import type { BidType } from "@/lib/scraper/types";

const TABLE_BY_TYPE: Record<BidType, string> = {
  order_plan: "public_order_plans",
  prior_spec: "public_prior_specs",
  bid_notice: "public_bid_notices",
};

export interface BidRow {
  bidId: string;
  sourceSlug: string;
  externalId: string;
  orgName: string | null;
  title: string | null;
  budget: number | null;
  postedAt: string | null;
  deadline: string | null;
  method: string | null;
  workType: string | null;
  category: string | null;
  url: string | null;
  /** 발주계획 전용 — 발주년도+발주월 조합(예: "2026-07"). raw_json.orderYear/orderMnth. */
  orderPeriod: string | null;
  /** withRaw 옵션일 때만 — 커스텀 열 계산용 원문(응답에는 내보내지 말 것). */
  raw?: Record<string, unknown>;
  createdAt: string;
}

/** 지역권 → 지역명 키워드 매핑(발주기관명·공사지역명에서 검색). */
export const REGION_GROUPS: Record<string, string[]> = {
  수도권: ["서울", "경기", "인천"],
  강원권: ["강원"],
  충청권: ["충남", "충북", "충청", "대전", "세종"],
  경북권: ["경북", "경상북도", "대구"],
  경남권: ["경남", "경상남도", "부산", "울산"],
  전라권: ["전북", "전남", "전라", "광주"],
  제주권: ["제주"],
};

export interface BidListFilter {
  bidType: BidType;
  q?: string;
  orgName?: string;
  /** 계약방법/조달방식 — 부분일치(일반경쟁/제한경쟁/지명경쟁/수의/적격심사 등). */
  method?: string;
  workType?: string;
  deadlineFrom?: string;
  deadlineTo?: string;
  /** 게시일 범위(YYYY-MM-DD, posted_at 앞자리 비교). */
  postedFrom?: string;
  postedTo?: string;
  /** 예산 금액대(원). */
  budgetMin?: number;
  budgetMax?: number;
  /** REGION_GROUPS 키(수도권/강원권/…). */
  regionGroup?: string;
  /** 용역 분류 조건 그룹(bid_categories.match_rule) — 그룹 내 AND/OR/NOR, 그룹 간 AND. */
  categoryRule?: RuleGroup[];
  /** 열 정렬 — field 는 표준 컬럼명 또는 raw_json 필드명. numeric 이면 숫자 캐스팅 정렬. */
  sort?: { field: string; dir: "asc" | "desc"; numeric?: boolean };
  /** true 면 각 행에 raw(원문 JSON)를 포함 — 커스텀 열(cells) 계산용. */
  withRaw?: boolean;
  limit?: number;
  offset?: number;
}

/** 정렬에 쓸 수 있는 표준 컬럼 화이트리스트(SQL 식별자 주입 방지). */
const STD_SORT_COLS = new Set([
  "org_name", "title", "budget", "posted_at", "deadline", "method", "work_type", "category", "external_id", "created_at",
]);
const RAW_FIELD_RE = /^[A-Za-z0-9_.]{1,60}$/;

function mapRow(r: Record<string, unknown>): BidRow {
  const s = (v: unknown) => (v != null ? String(v) : null);
  // 발주시기 = 발주년도-발주월(2자리). 둘 다 있어야 표기.
  const oy = s(r.order_year);
  const om = s(r.order_mnth);
  const orderPeriod = oy && om ? `${oy}-${om.padStart(2, "0")}` : null;
  return {
    bidId: String(r.bid_id),
    sourceSlug: String(r.source_slug),
    externalId: String(r.external_id),
    orgName: s(r.org_name),
    title: s(r.title),
    budget: r.budget != null ? Number(r.budget) : null,
    postedAt: s(r.posted_at),
    deadline: s(r.deadline),
    method: s(r.method),
    workType: s(r.work_type),
    category: s(r.category),
    url: s(r.url),
    orderPeriod,
    createdAt: String(r.created_at ?? ""),
  };
}

export async function listBids(filter: BidListFilter): Promise<{ items: BidRow[]; total: number }> {
  const table = TABLE_BY_TYPE[filter.bidType];
  if (!table) return { items: [], total: 0 };

  const db = await getDb();
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };

  if (filter.q?.trim()) {
    const like = `%${filter.q.trim()}%`;
    where.push(`(title LIKE ${add(like)} OR org_name LIKE ${add(like)})`);
  }
  if (filter.orgName?.trim()) where.push(`org_name LIKE ${add(`%${filter.orgName.trim()}%`)}`);
  if (filter.method?.trim()) where.push(`method LIKE ${add(`%${filter.method.trim()}%`)}`);
  if (filter.workType?.trim()) where.push(`work_type = ${add(filter.workType.trim())}`);
  if (filter.deadlineFrom?.trim()) where.push(`deadline >= ${add(filter.deadlineFrom.trim())}`);
  if (filter.deadlineTo?.trim()) where.push(`deadline <= ${add(filter.deadlineTo.trim())}`);
  // 게시일 범위 — posted_at 은 "YYYY-MM-DD hh:mm:ss" 텍스트라 앞 10자리 비교.
  if (filter.postedFrom?.trim()) where.push(`substr(posted_at, 1, 10) >= ${add(filter.postedFrom.trim())}`);
  if (filter.postedTo?.trim()) where.push(`substr(posted_at, 1, 10) <= ${add(filter.postedTo.trim())}`);
  if (filter.budgetMin != null && filter.budgetMin > 0) where.push(`budget >= ${add(filter.budgetMin)}`);
  if (filter.budgetMax != null && filter.budgetMax > 0) where.push(`budget <= ${add(filter.budgetMax)}`);
  // 지역권 — 발주기관명 + 공사지역명(raw_json.cnstwkRgnNm)에서 지역명 키워드 OR 매칭.
  const regionKeys = filter.regionGroup ? REGION_GROUPS[filter.regionGroup] : null;
  if (regionKeys?.length) {
    const ors = regionKeys.map((k) => {
      const like = add(`%${k}%`);
      return `(org_name LIKE ${like} OR COALESCE(raw_json->>'cnstwkRgnNm','') LIKE ${like})`;
    });
    where.push(`(${ors.join(" OR ")})`);
  }
  // 용역 분류 — 조건 그룹(AND/OR/NOR)을 사업명에 적용.
  if (filter.categoryRule?.length) {
    const ruleSql = buildRuleWhere(filter.categoryRule, add, "title");
    if (ruleSql) where.push(ruleSql);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filter.limit ?? 20, 1), 100);
  const offset = Math.max(filter.offset ?? 0, 0);

  const totalRows = rowsToObjects(await db.exec(`SELECT COUNT(*)::int AS n FROM ${table} ${whereSql}`, params));
  const total = Number(totalRows[0]?.n ?? 0);

  // 열 정렬 — 표준 컬럼은 화이트리스트 식별자, raw 필드는 파라미터 바인딩(raw_json->>$n).
  let orderSql = `ORDER BY COALESCE(NULLIF(posted_at, ''), created_at) DESC`;
  const s = filter.sort;
  if (s?.field) {
    const dir = s.dir === "asc" ? "ASC" : "DESC";
    if (STD_SORT_COLS.has(s.field)) {
      orderSql =
        s.field === "budget"
          ? `ORDER BY budget ${dir} NULLS LAST`
          : `ORDER BY NULLIF(${s.field}, '') ${dir} NULLS LAST`;
    } else if (RAW_FIELD_RE.test(s.field)) {
      const p = add(s.field);
      orderSql = s.numeric
        ? `ORDER BY NULLIF(regexp_replace(COALESCE(raw_json->>${p}, ''), '[^0-9.\\-]', '', 'g'), '')::numeric ${dir} NULLS LAST`
        : `ORDER BY NULLIF(raw_json->>${p}, '') ${dir} NULLS LAST`;
    }
  }

  const rows = rowsToObjects(
    await db.exec(
      `SELECT *, raw_json->>'orderYear' AS order_year, raw_json->>'orderMnth' AS order_mnth
         FROM ${table} ${whereSql}
       ${orderSql}
       LIMIT ${add(limit)} OFFSET ${add(offset)}`,
      params
    )
  );
  const items = rows.map((r) => {
    const row = mapRow(r);
    if (filter.withRaw) {
      try {
        const v = typeof r.raw_json === "string" ? JSON.parse(r.raw_json) : r.raw_json;
        if (v && typeof v === "object") row.raw = v as Record<string, unknown>;
      } catch {
        // raw 파싱 실패 시 생략
      }
    }
    return row;
  });
  return { items, total };
}

/** 계약방법(method) 실데이터 distinct — 필터 옵션용(종류별로 값이 다름: 발주계획엔 적격심사 없음 등). */
export async function listMethodOptions(bidType: BidType): Promise<string[]> {
  const table = TABLE_BY_TYPE[bidType];
  if (!table) return [];
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT method, count(*) AS n FROM ${table} WHERE COALESCE(method,'') <> '' GROUP BY method ORDER BY n DESC LIMIT 20`
    )
  );
  return rows.map((r) => String(r.method));
}

// ── 상세 + 발주계획↔사전규격↔입찰공고 연계 ──────────────────

export interface BidDetail extends BidRow {
  raw: Record<string, unknown>;
}

export interface RelatedBid {
  bidType: BidType;
  bidId: string;
  title: string | null;
  orgName: string | null;
  postedAt: string | null;
}

function mapDetail(r: Record<string, unknown>): BidDetail {
  let raw: Record<string, unknown> = {};
  try {
    const v = typeof r.raw_json === "string" ? JSON.parse(r.raw_json) : r.raw_json;
    if (v && typeof v === "object") raw = v as Record<string, unknown>;
  } catch {
    // raw 파싱 실패 시 빈 객체
  }
  return { ...mapRow(r), raw };
}

export async function getBid(bidType: BidType, bidId: string): Promise<BidDetail | null> {
  const table = TABLE_BY_TYPE[bidType];
  if (!table) return null;
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT *, raw_json->>'orderYear' AS order_year, raw_json->>'orderMnth' AS order_mnth FROM ${table} WHERE bid_id = $1`,
      [bidId]
    )
  );
  return rows.length ? mapDetail(rows[0]) : null;
}

const relFields = "bid_id, title, org_name, posted_at";
const toRelated = (bidType: BidType) => (r: Record<string, unknown>): RelatedBid => ({
  bidType,
  bidId: String(r.bid_id),
  title: r.title != null ? String(r.title) : null,
  orgName: r.org_name != null ? String(r.org_name) : null,
  postedAt: r.posted_at != null ? String(r.posted_at) : null,
});

/**
 * 같은 사업 건의 발주계획↔사전규격↔입찰공고를 찾는다.
 * 연계 키: 발주계획통합번호(orderPlanUntyNo — 발주계획의 external_id이자 타 공고 raw_json에 포함),
 * 입찰공고번호목록(발주계획 raw_json.bidNtceNoList — 입찰공고 external_id 목록).
 */
export async function findRelated(bidType: BidType, detail: BidDetail): Promise<RelatedBid[]> {
  const db = await getDb();
  const out: RelatedBid[] = [];
  const seen = new Set<string>();
  const push = (items: RelatedBid[]) => {
    for (const it of items) {
      const key = `${it.bidType}:${it.bidId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(it);
    }
  };
  const raw = detail.raw;
  const str = (v: unknown) => (v == null ? "" : String(v).trim());

  // 이 건이 가리키는 발주계획통합번호 — 발주계획이면 자신의 external_id, 아니면 raw 의 orderPlanUntyNo.
  const planNo = bidType === "order_plan" ? detail.externalId : str(raw.orderPlanUntyNo ?? raw.orderplanUntyNo);

  if (planNo) {
    // 발주계획 자체(내가 발주계획이 아닐 때)
    if (bidType !== "order_plan") {
      const rows = rowsToObjects(
        await db.exec(`SELECT ${relFields} FROM public_order_plans WHERE external_id = $1 LIMIT 5`, [planNo])
      );
      push(rows.map(toRelated("order_plan")));
    }
    // 같은 발주계획을 참조하는 사전규격/입찰공고
    if (bidType !== "prior_spec") {
      const rows = rowsToObjects(
        await db.exec(`SELECT ${relFields} FROM public_prior_specs WHERE raw_json->>'orderPlanUntyNo' = $1 LIMIT 10`, [planNo])
      );
      push(rows.map(toRelated("prior_spec")));
    }
    if (bidType !== "bid_notice") {
      const rows = rowsToObjects(
        await db.exec(`SELECT ${relFields} FROM public_bid_notices WHERE raw_json->>'orderPlanUntyNo' = $1 LIMIT 10`, [planNo])
      );
      push(rows.map(toRelated("bid_notice")));
    }
  }

  // 발주계획의 입찰공고번호목록 → 입찰공고 external_id 직접 매칭
  const ntceList = str(raw.bidNtceNoList)
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
  if (bidType === "order_plan" && ntceList.length) {
    const ph = ntceList.map((_, i) => `$${i + 1}`).join(",");
    const rows = rowsToObjects(
      await db.exec(`SELECT ${relFields} FROM public_bid_notices WHERE external_id IN (${ph}) LIMIT 20`, ntceList)
    );
    push(rows.map(toRelated("bid_notice")));
  }
  return out;
}
