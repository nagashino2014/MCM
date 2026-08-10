import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { REGION_GROUPS } from "@/lib/bid/bid-queries";
import { fieldValue } from "@/lib/bid/notify-dispatch";
import {
  DEFAULT_CONTENT_FIELDS,
  loadBidNotifyConfig,
  type NotifyBidType,
} from "@/lib/bid/notify-settings";

const TABLE_BY_TYPE: Record<string, string> = {
  order_plan: "public_order_plans",
  prior_spec: "public_prior_specs",
  bid_notice: "public_bid_notices",
};

interface MatchDetail {
  label: string;
  value: string;
  /** 원문 링크 항목 — 앱에서 카드 맨 아래 링크 버튼으로 렌더한다. */
  link?: boolean;
}

/**
 * 건별 상세 항목 — 알림 발송 항목 구성(설정) 그대로, 값이 있는 항목만.
 * 구성이 없는 종류는 기본 프리셋을 쓴다. 앱이 태그를 눌렀을 때 펼칠 카드의 내용.
 */
async function loadDetails(
  db: PgDatabase,
  rows: { bid_type: string; bid_id: string }[]
): Promise<Map<string, MatchDetail[]>> {
  const out = new Map<string, MatchDetail[]>();
  if (!rows.length) return out;

  const { profiles } = await loadBidNotifyConfig();
  const byType = new Map<string, string[]>();
  for (const r of rows) {
    const arr = byType.get(r.bid_type) ?? [];
    arr.push(r.bid_id);
    byType.set(r.bid_type, arr);
  }

  for (const [type, ids] of byType) {
    const table = TABLE_BY_TYPE[type];
    if (!table || !ids.length) continue;
    // 발송 항목 구성은 이 종류를 발송 대상으로 둔 첫 조건의 것을 따른다.
    const configured = profiles.find((p) => p.contentFields[type as NotifyBidType]?.length)
      ?.contentFields[type as NotifyBidType];
    const fields = configured?.length ? configured : DEFAULT_CONTENT_FIELDS[type as NotifyBidType];
    if (!fields?.length) continue;

    const ph = ids.map((_, i) => `$${i + 1}`).join(",");
    const detailRows = rowsToObjects(
      await db.exec(`SELECT * FROM ${table} WHERE bid_id IN (${ph})`, ids)
    );
    for (const r of detailRows) {
      let raw: Record<string, unknown> = {};
      try {
        const v = typeof r.raw_json === "string" ? JSON.parse(r.raw_json) : r.raw_json;
        if (v && typeof v === "object") raw = v as Record<string, unknown>;
      } catch {
        // raw 파싱 실패 시 표준 컬럼만
      }
      const merged: Record<string, unknown> = {
        ...raw,
        org_name: r.org_name, title: r.title, budget: r.budget, posted_at: r.posted_at,
        deadline: r.deadline, method: r.method, work_type: r.work_type, category: r.category,
        url: r.url, external_id: r.external_id,
      };
      const details: MatchDetail[] = [];
      for (const f of fields) {
        const v = fieldValue(merged, f.name);
        if (!v) continue;
        details.push({ label: f.label, value: v, ...(/^https?:\/\//.test(v) ? { link: true } : {}) });
      }
      if (details.length) out.set(`${type}:${String(r.bid_id)}`, details);
    }
  }
  return out;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 발주기관명에서 지역권(REGION_GROUPS 키)을 판정 — 첫 매칭 그룹. */
function regionGroupOf(orgName: string | null): string | null {
  if (!orgName) return null;
  for (const [group, keys] of Object.entries(REGION_GROUPS)) {
    if (keys.some((k) => orgName.includes(k))) return group;
  }
  return null;
}

/** 목록·삭제가 공유하는 필터 WHERE 조립(큐 행 대상). */
function buildMatchWhere(opts: {
  byDeadline: boolean;
  today: string;
  categories: string[];
  regions: string[];
  /** 입찰 소스 필터(모바일 개편) — bid_notice·order_plan·prior_spec. */
  bidTypes?: string[];
  /** 기간별 삭제(P6 추가) — 공고일 기준(YYYY-MM-DD), 공고일이 없는 행은 매칭일로 대체. */
  dateFrom?: string;
  dateTo?: string;
}): { whereSql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (opts.byDeadline) {
    where.push(`deadline IS NOT NULL AND deadline <> '' AND substring(deadline, 1, 10) >= ${add(opts.today)}`);
  }
  if (opts.bidTypes?.length) {
    const ph = opts.bidTypes.map((t) => add(t)).join(",");
    where.push(`bid_type IN (${ph})`);
  }
  if (opts.categories.length) {
    const ph = opts.categories.map((c) => add(c)).join(",");
    where.push(`category_name IN (${ph})`);
  }
  // 지역권 — 발주기관명 키워드 OR 매칭(웹 BidListFilter.regionGroup 과 같은 규칙, raw 없음).
  if (opts.regions.length) {
    const ors: string[] = [];
    for (const g of opts.regions) {
      for (const k of REGION_GROUPS[g] ?? []) ors.push(`org_name LIKE ${add(`%${k}%`)}`);
    }
    if (ors.length) where.push(`(${ors.join(" OR ")})`);
  }
  const dateExpr = `substring(COALESCE(NULLIF(posted_at, ''), matched_at), 1, 10)`;
  if (opts.dateFrom) where.push(`${dateExpr} >= ${add(opts.dateFrom)}`);
  if (opts.dateTo) where.push(`${dateExpr} <= ${add(opts.dateTo)}`);
  return { whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseListParam(v: string | null): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * 사업분야 매칭 공고 목록(M6-C) — 매칭 알림 큐(bid_match_notices)를 그대로 읽는다.
 *
 * 푸시로 받은 알림을 눌렀을 때 볼 화면의 데이터원이다. 웹의 /api/sales/bids 는
 * 종류별 커스텀 열 계산까지 하는 무거운 목록이라, "알림으로 온 그 건들"만 보는
 * 용도로는 맞지 않는다.
 *
 * 정렬: 기본 최근 매칭순 · ?sort=posted 최근 공고순 · ?filter=deadline 마감 임박순(남은 건만).
 * 필터: ?categories=용역분류명,… · ?regions=수도권,…(REGION_GROUPS 키).
 * 응답에 regionGroup(발주기관명 판정)과 categories(큐 전체의 분류 목록 — 필터 UI 옵션)를 싣는다.
 */
export async function GET(req: NextRequest) {
  try {
    await requirePermission("sales.view");
    const sp = req.nextUrl.searchParams;
    const limit = Math.min(Math.max(Number(sp.get("limit")) || 50, 1), 200);
    const offset = Math.max(Number(sp.get("offset")) || 0, 0);
    const byDeadline = sp.get("filter") === "deadline";
    const byPosted = sp.get("sort") === "posted";
    const categories = parseListParam(sp.get("categories"));
    const regions = parseListParam(sp.get("regions")).filter((g) => REGION_GROUPS[g]);
    // 입찰 소스(?types=bid_notice,order_plan,prior_spec) — 모바일 소스 3태그 필터.
    const bidTypes = parseListParam(sp.get("types")).filter((t) =>
      ["bid_notice", "order_plan", "prior_spec"].includes(t)
    );
    const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

    const { whereSql, params } = buildMatchWhere({ byDeadline, today, categories, regions, bidTypes });
    const orderSql = byDeadline
      ? "substring(deadline, 1, 10) ASC"
      : byPosted
        ? "NULLIF(posted_at, '') DESC NULLS LAST"
        : "matched_at DESC";

    // 같은 공고가 여러 분류에 매칭될 수 있어 bid 단위로 접는다(최근 매칭 1건 대표).
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(
        `SELECT * FROM (
           SELECT DISTINCT ON (bid_type, bid_id)
                  notice_id, bid_type, bid_id, category_name, title, org_name,
                  budget, posted_at, deadline, url, matched_at
             FROM bid_match_notices
            ${whereSql}
            ORDER BY bid_type, bid_id, matched_at DESC
         ) t
         ORDER BY ${orderSql}
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      )
    );

    // 필터 UI 옵션 — 큐 전체에 존재하는 분류(필터와 무관하게 고정 목록).
    const catRows = rowsToObjects(
      await db.exec(
        `SELECT DISTINCT category_name FROM bid_match_notices
          WHERE category_name IS NOT NULL AND category_name <> '' ORDER BY category_name`
      )
    );

    // 앱이 태그를 눌러 펼칠 상세 항목 — 종류별 일괄 조회(건별 왕복 없음).
    const detailMap = await loadDetails(
      db,
      rows.map((r) => ({ bid_type: String(r.bid_type), bid_id: String(r.bid_id) }))
    ).catch(() => new Map<string, MatchDetail[]>());

    const items = rows.map((r) => ({
      noticeId: String(r.notice_id),
      bidType: String(r.bid_type),
      bidId: String(r.bid_id),
      details: detailMap.get(`${String(r.bid_type)}:${String(r.bid_id)}`) ?? [],
      categoryName: r.category_name != null ? String(r.category_name) : null,
      title: r.title != null ? String(r.title) : null,
      orgName: r.org_name != null ? String(r.org_name) : null,
      regionGroup: regionGroupOf(r.org_name != null ? String(r.org_name) : null),
      budget: r.budget != null ? Number(r.budget) : null,
      postedAt: r.posted_at != null ? String(r.posted_at) : null,
      deadline: r.deadline != null ? String(r.deadline) : null,
      url: r.url != null ? String(r.url) : null,
      matchedAt: r.matched_at != null ? String(r.matched_at) : null,
    }));
    return NextResponse.json({
      items,
      today,
      categories: catRows.map((r) => String(r.category_name)),
      regionGroups: Object.keys(REGION_GROUPS),
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/**
 * 매칭 알림 하드 삭제(P6, 사용자 확정) — 큐는 알림 전달용이지 감사 기록이 아니다.
 * 웹의 알림 벨·이력에서도 함께 사라지는 것이 의도된 동작.
 *
 * body: `{ noticeIds: [...] }`(선택 삭제) 또는
 *       `{ all: true, filter?, categories?, regions?, postedFrom?, postedTo? }`
 *       (현재 필터 범위 일괄 — 무조건 전체 금지. postedFrom/To 는 기간별 삭제, 공고일 기준).
 * 카드(bid 단위)와 어긋나지 않게 **(bid_type, bid_id) 쌍 전체 행**을 지운다 —
 * notice 행만 지우면 같은 공고의 다른 분류 매칭 행이 남아 카드가 되살아난다.
 */
export async function DELETE(req: NextRequest) {
  try {
    await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const body = (await req.json().catch(() => ({}))) as {
      noticeIds?: unknown;
      all?: boolean;
      filter?: string;
      types?: unknown;
      categories?: unknown;
      regions?: unknown;
      postedFrom?: unknown;
      postedTo?: unknown;
    };
    const noticeIds = Array.isArray(body.noticeIds)
      ? body.noticeIds.map((v) => String(v)).filter(Boolean)
      : [];
    const asList = (v: unknown) =>
      Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];

    const deleted = await withDbWrite(async (db) => {
      // 삭제할 (bid_type, bid_id) 쌍을 먼저 확정한다.
      let pairRows: Record<string, unknown>[];
      if (noticeIds.length) {
        const ph = noticeIds.map((_, i) => `$${i + 1}`).join(",");
        pairRows = rowsToObjects(
          await db.exec(
            `SELECT DISTINCT bid_type, bid_id FROM bid_match_notices WHERE notice_id IN (${ph})`,
            noticeIds
          )
        );
      } else if (body.all === true) {
        const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
        const { whereSql, params } = buildMatchWhere({
          byDeadline: body.filter === "deadline",
          today,
          bidTypes: asList(body.types).filter((t) => ["bid_notice", "order_plan", "prior_spec"].includes(t)),
          categories: asList(body.categories),
          regions: asList(body.regions).filter((g) => REGION_GROUPS[g]),
          dateFrom: typeof body.postedFrom === "string" && DAY_RE.test(body.postedFrom) ? body.postedFrom : undefined,
          dateTo: typeof body.postedTo === "string" && DAY_RE.test(body.postedTo) ? body.postedTo : undefined,
        });
        pairRows = rowsToObjects(
          await db.exec(`SELECT DISTINCT bid_type, bid_id FROM bid_match_notices ${whereSql}`, params)
        );
      } else {
        return 0;
      }
      if (!pairRows.length) return 0;

      const params: unknown[] = [];
      const tuples = pairRows
        .map((r) => {
          params.push(String(r.bid_type), String(r.bid_id));
          return `($${params.length - 1}, $${params.length})`;
        })
        .join(",");
      await db.run(`DELETE FROM bid_match_notices WHERE (bid_type, bid_id) IN (${tuples})`, params);
      return pairRows.length;
    });

    return NextResponse.json({ ok: true, deleted });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
