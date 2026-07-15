/**
 * 공공입찰(bid) 목록 조회 — 종류별 테이블(public_order_plans/prior_specs/bid_notices)에서
 * 필터·서버 페이지네이션으로 읽는다. bidType 은 화이트리스트로만 테이블에 매핑(SQL 주입 방지).
 */
import { getDb, rowsToObjects } from "@/lib/db";
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
  createdAt: string;
}

export interface BidListFilter {
  bidType: BidType;
  q?: string;
  orgName?: string;
  method?: string;
  workType?: string;
  deadlineFrom?: string;
  deadlineTo?: string;
  limit?: number;
  offset?: number;
}

function mapRow(r: Record<string, unknown>): BidRow {
  const s = (v: unknown) => (v != null ? String(v) : null);
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
  if (filter.method?.trim()) where.push(`method = ${add(filter.method.trim())}`);
  if (filter.workType?.trim()) where.push(`work_type = ${add(filter.workType.trim())}`);
  if (filter.deadlineFrom?.trim()) where.push(`deadline >= ${add(filter.deadlineFrom.trim())}`);
  if (filter.deadlineTo?.trim()) where.push(`deadline <= ${add(filter.deadlineTo.trim())}`);

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filter.limit ?? 20, 1), 100);
  const offset = Math.max(filter.offset ?? 0, 0);

  const totalRows = rowsToObjects(await db.exec(`SELECT COUNT(*)::int AS n FROM ${table} ${whereSql}`, params));
  const total = Number(totalRows[0]?.n ?? 0);

  const rows = rowsToObjects(
    await db.exec(
      `SELECT * FROM ${table} ${whereSql}
       ORDER BY COALESCE(NULLIF(posted_at, ''), created_at) DESC
       LIMIT ${add(limit)} OFFSET ${add(offset)}`,
      params
    )
  );
  return { items: rows.map(mapRow), total };
}
