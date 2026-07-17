/**
 * 공공입찰 사업분야 매칭 → 알림 큐 적재(bid_match_notices, 077).
 * bid-sink 적재 직후 신규 건(insertedItems)에 대해 분류 조건 그룹(match_rule)을 평가하고,
 * 매칭 건을 큐 + alerts(웹 벨)에 넣는다. 실제 채널 발송은 notify-dispatch 가 설정된 시각에 수행.
 * 백필(과거 대량 수집) 경로에서는 호출하지 않는다 — 과거 건 알림 스팸 방지.
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { listCategories } from "@/lib/bid/category-store";
import { evaluateGroups, ruleFromCategory } from "@/lib/bid/match";
import type { InsertedBid } from "@/lib/bid/bid-sink";
import type { BidType } from "@/lib/scraper/types";

const TYPE_LABEL: Record<BidType, string> = {
  order_plan: "발주계획",
  prior_spec: "사전규격",
  bid_notice: "입찰공고",
};

/** 실행당 alerts 고지 상한 — 조건이 느슨할 때의 스팸 방어(큐에는 전부 적재). */
const MAX_ALERTS_PER_RUN = 50;

export interface MatchQueueResult {
  matched: number;
  queued: number;
}

export async function matchAndQueueBidNotices(
  bidType: BidType,
  items: InsertedBid[]
): Promise<MatchQueueResult> {
  const result: MatchQueueResult = { matched: 0, queued: 0 };
  if (!items.length) return result;

  const categories = (await listCategories())
    .filter((c) => c.enabled)
    .map((c) => ({ ...c, groups: ruleFromCategory(c) }))
    .filter((c) => c.groups.length);
  if (!categories.length) return result;

  const nowIso = new Date().toISOString();
  await withDbWrite(async (db) => {
    let alerted = 0;
    for (const it of items) {
      for (const cat of categories) {
        if (!evaluateGroups(it.title, cat.groups)) continue;
        result.matched++;
        const noticeId = "bmn_" + crypto.randomBytes(8).toString("hex");
        // 재실행 중복 방어 — 같은 (종류, 건, 분류)는 1회만 큐잉.
        const rows = rowsToObjects(
          await db.exec(
            `INSERT INTO bid_match_notices
               (notice_id, bid_type, bid_id, category_id, category_name, title, org_name,
                budget, posted_at, deadline, url, matched_at, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending')
             ON CONFLICT (bid_type, bid_id, category_id) DO NOTHING
             RETURNING notice_id`,
            [
              noticeId, bidType, it.bidId, cat.categoryId, cat.name, it.title, it.orgName,
              it.budget, it.postedAt, it.deadline, it.url, nowIso,
            ]
          )
        );
        if (!rows.length) continue; // 이미 큐잉된 건
        result.queued++;
        if (alerted < MAX_ALERTS_PER_RUN) {
          alerted++;
          await db.run(
            `INSERT INTO alerts (severity, source, code, title, body, payload_json, created_at)
             VALUES ('info','bid','bid-match',$1,$2,$3::jsonb,$4)`,
            [
              `[${cat.name}] ${TYPE_LABEL[bidType]} 매칭`,
              `${it.title ?? "제목 없음"} — ${it.orgName ?? "기관 미상"}${it.deadline ? ` · 마감 ${String(it.deadline).slice(0, 10)}` : ""}`,
              JSON.stringify({ bidType, bidId: it.bidId, categoryId: cat.categoryId, noticeId }),
              nowIso,
            ]
          );
        }
      }
    }
  });
  return result;
}
