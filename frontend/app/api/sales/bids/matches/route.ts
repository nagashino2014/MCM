import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects, type PgDatabase } from "@/lib/db";
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

/**
 * 사업분야 매칭 공고 목록(M6-C) — 매칭 알림 큐(bid_match_notices)를 그대로 읽는다.
 *
 * 푸시로 받은 알림을 눌렀을 때 볼 화면의 데이터원이다. 웹의 /api/sales/bids 는
 * 종류별 커스텀 열 계산까지 하는 무거운 목록이라, "알림으로 온 그 건들"만 보는
 * 용도로는 맞지 않는다.
 *
 * ?filter=deadline 이면 마감이 남은 건만(임박순), 기본은 최근 매칭순.
 */
export async function GET(req: NextRequest) {
  try {
    await requirePermission("sales.view");
    const sp = req.nextUrl.searchParams;
    const limit = Math.min(Math.max(Number(sp.get("limit")) || 50, 1), 200);
    const offset = Math.max(Number(sp.get("offset")) || 0, 0);
    const byDeadline = sp.get("filter") === "deadline";
    const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

    // 같은 공고가 여러 분류에 매칭될 수 있어 bid 단위로 접는다(최근 매칭 1건 대표).
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(
        `SELECT * FROM (
           SELECT DISTINCT ON (bid_type, bid_id)
                  notice_id, bid_type, bid_id, category_name, title, org_name,
                  budget, posted_at, deadline, url, matched_at
             FROM bid_match_notices
            ${byDeadline ? `WHERE deadline IS NOT NULL AND deadline <> '' AND substring(deadline, 1, 10) >= $3` : ""}
            ORDER BY bid_type, bid_id, matched_at DESC
         ) t
         ORDER BY ${byDeadline ? "substring(deadline, 1, 10) ASC" : "matched_at DESC"}
         LIMIT $1 OFFSET $2`,
        byDeadline ? [limit, offset, today] : [limit, offset]
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
      budget: r.budget != null ? Number(r.budget) : null,
      postedAt: r.posted_at != null ? String(r.posted_at) : null,
      deadline: r.deadline != null ? String(r.deadline) : null,
      url: r.url != null ? String(r.url) : null,
      matchedAt: r.matched_at != null ? String(r.matched_at) : null,
    }));
    return NextResponse.json({ items, today });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
