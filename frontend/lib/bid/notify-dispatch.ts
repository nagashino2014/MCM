/**
 * 공공입찰 매칭 알림 발송 디스패처 — 프로파일(발송 조건)마다 독립 발송한다.
 *
 * 각 프로파일은 발송 시각(KST) 이후 첫 체크에서, 매칭 범위(rangeDays)에 해당하는
 * 게시분을 대상 종류 테이블에서 다시 검색해 용역 분류 조건·지역권 필터로 거른 뒤 요약을 보낸다.
 * (큐 소비 방식이 아니라 재검색 — 프로파일마다 분류·지역 필터가 달라 큐 하나로는 분리할 수 없다.
 *  bid_match_notices 는 웹 벨 알림·이력 용도로 유지하고, 발송분은 sent 로 마킹한다.)
 * 발송 수단은 메일(SES)·앱 푸시. 일 1회 멱등(profile.lastDispatchDate).
 * 마감 임박 알림은 입찰 서류 생성 진행 건(bid_packages.status='draft')을 대상으로,
 * 수신자 중 '마감 알림'을 체크한 사람에게만 보낸다.
 */
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import {
  DEFAULT_CONTENT_FIELDS,
  loadBidNotifyConfig,
  patchBidNotifyProfile,
  type BidNotifyProfile,
  type NotifyBidType,
} from "@/lib/bid/notify-settings";
import { listCategories } from "@/lib/bid/category-store";
import { buildRuleWhere, ruleFromCategory } from "@/lib/bid/match";
import { REGION_GROUPS } from "@/lib/bid/bid-queries";
import { listActivePackages } from "@/lib/bid/package-store";
import { sendNotifyEmail, type ChannelSendResult } from "@/lib/notify/email-ses";
import { sendPush } from "@/lib/notify/push-expo";

const TYPE_LABEL: Record<string, string> = {
  order_plan: "발주계획",
  prior_spec: "사전규격",
  bid_notice: "입찰공고",
};
const TABLE_BY_TYPE: Record<NotifyBidType, string> = {
  order_plan: "public_order_plans",
  prior_spec: "public_prior_specs",
  bid_notice: "public_bid_notices",
};
/** 1회 발송에 담는 최대 건수 — 초과분은 건수만 표기(웹에서 확인 유도). */
const MAX_LINES = 30;
/** 프로파일당 검색 상한(분류·종류 합산). */
const MATCH_LIMIT = 500;

interface MatchedBid {
  bidType: NotifyBidType;
  bidId: string;
  categoryName: string;
  title: string | null;
  orgName: string | null;
  deadline: string | null;
  url: string | null;
  /** 표준 컬럼 + raw_json 병합 — 발송 항목 값 조회용. */
  merged: Record<string, unknown>;
}

/** KST(UTC+9) 기준 날짜/시각 문자열. */
function kstParts(now = new Date()): { date: string; hm: string } {
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  const iso = kst.toISOString();
  return { date: iso.slice(0, 10), hm: iso.slice(11, 16) };
}

/** KST 기준 date 문자열에 일수를 더한다. */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 매칭 범위 내 게시분에서 프로파일 조건에 맞는 건을 검색한다.
 * 게시일(posted_at)이 비어 있으면 수집시각(created_at)으로 대체 판정.
 */
async function searchMatches(
  db: PgDatabase,
  profile: BidNotifyProfile,
  fromDate: string
): Promise<MatchedBid[]> {
  const cats = (await listCategories())
    .filter((c) => c.enabled)
    .filter((c) => !profile.categoryIds.length || profile.categoryIds.includes(c.categoryId))
    .map((c) => ({ name: c.name, groups: ruleFromCategory(c) }))
    .filter((c) => c.groups.length);
  if (!cats.length) return [];

  const regionKeys = profile.regionGroups.flatMap((g) => REGION_GROUPS[g] ?? []);
  const seen = new Set<string>();
  const out: MatchedBid[] = [];

  for (const type of profile.bidTypes) {
    const table = TABLE_BY_TYPE[type];
    if (!table) continue;
    for (const cat of cats) {
      if (out.length >= MATCH_LIMIT) break;
      const params: unknown[] = [];
      const add = (v: unknown) => {
        params.push(v);
        return `$${params.length}`;
      };
      const where: string[] = [
        `COALESCE(NULLIF(substring(posted_at, 1, 10), ''), substring(created_at, 1, 10)) >= ${add(fromDate)}`,
      ];
      const ruleSql = buildRuleWhere(cat.groups, add, "title");
      if (!ruleSql) continue;
      where.push(ruleSql);
      if (regionKeys.length) {
        const ors = regionKeys.map((k) => {
          const like = add(`%${k}%`);
          return `(org_name LIKE ${like} OR COALESCE(raw_json->>'cnstwkRgnNm','') LIKE ${like})`;
        });
        where.push(`(${ors.join(" OR ")})`);
      }
      const rows = rowsToObjects(
        await db.exec(
          `SELECT * FROM ${table} WHERE ${where.join(" AND ")}
            ORDER BY COALESCE(NULLIF(posted_at,''), created_at) DESC LIMIT ${MATCH_LIMIT}`,
          params
        )
      );
      for (const r of rows) {
        const bidId = String(r.bid_id);
        const key = `${type}:${bidId}`;
        if (seen.has(key)) continue; // 여러 분류에 걸리면 먼저 매칭된 분류로 1건만
        seen.add(key);
        let raw: Record<string, unknown> = {};
        try {
          const v = typeof r.raw_json === "string" ? JSON.parse(r.raw_json) : r.raw_json;
          if (v && typeof v === "object") raw = v as Record<string, unknown>;
        } catch {
          // raw 파싱 실패 시 표준 컬럼만
        }
        out.push({
          bidType: type,
          bidId,
          categoryName: cat.name,
          title: r.title != null ? String(r.title) : null,
          orgName: r.org_name != null ? String(r.org_name) : null,
          deadline: r.deadline != null ? String(r.deadline) : null,
          url: r.url != null ? String(r.url) : null,
          merged: {
            ...raw,
            org_name: r.org_name, title: r.title, budget: r.budget, posted_at: r.posted_at,
            deadline: r.deadline, method: r.method, work_type: r.work_type, category: r.category,
            url: r.url, external_id: r.external_id,
          },
        });
      }
    }
  }
  return out;
}

/** 발송 항목 1개의 표시값 — 금액은 천단위 구분, 빈 값은 ""(호출측에서 생략). */
export function fieldValue(merged: Record<string, unknown> | undefined, name: string): string {
  const v = merged?.[name];
  if (v == null || v === "") return "";
  if (name === "budget" || name === "presmptPrce" || name === "asignBdgtAmt") {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return `${n.toLocaleString("ko-KR")}원`;
  }
  return String(v);
}

function buildMessage(matches: MatchedBid[], profile: BidNotifyProfile): { subject: string; text: string } {
  const byType = new Map<string, MatchedBid[]>();
  for (const m of matches) {
    const arr = byType.get(m.bidType) ?? [];
    arr.push(m);
    byType.set(m.bidType, arr);
  }
  const lines: string[] = [];
  let listed = 0;
  for (const [type, arr] of byType) {
    lines.push(`■ ${TYPE_LABEL[type] ?? type} ${arr.length}건`);
    // 구성이 없으면 종류별 기본 프리셋(10항목)으로 발송한다.
    const fields = profile.contentFields[type as NotifyBidType]?.length
      ? profile.contentFields[type as NotifyBidType]!
      : DEFAULT_CONTENT_FIELDS[type as NotifyBidType];
    for (const m of arr) {
      if (listed >= MAX_LINES) break;
      listed++;
      lines.push(` · [${m.categoryName}]`);
      for (const f of fields) {
        const v = fieldValue(m.merged, f.name);
        if (v) lines.push(`   ${f.label}: ${v}`);
      }
      if (m.url && !fields.some((f) => f.name === "url")) lines.push(`   ${m.url}`);
    }
  }
  if (matches.length > listed) lines.push(`… 외 ${matches.length - listed}건 (웹 공공입찰 화면에서 확인)`);
  return {
    subject: `[공공입찰] ${profile.name} 매칭 ${matches.length}건`,
    text: `${profile.name} 조건에 매칭된 공고 ${matches.length}건입니다.\n\n${lines.join("\n")}`,
  };
}

/** 푸시 본문 — 알림 한 줄에 들어갈 요약(대표 1건 + 나머지 건수). */
function pushSummary(matches: MatchedBid[]): string {
  const head = matches[0]?.title?.trim() || matches[0]?.categoryName || "신규 공고";
  const rest = matches.length - 1;
  const line = rest > 0 ? `${head} 외 ${rest}건` : head;
  return line.length > 90 ? `${line.slice(0, 89)}…` : line;
}

interface RecipientContact {
  email: string;
  /** 앱 푸시 대상 — 직원 프로필에 연결된 로그인 계정. 미연결이면 앱 채널 발송 불가. */
  userId: string;
}

async function loadRecipientContacts(
  db: PgDatabase,
  profile: BidNotifyProfile
): Promise<Map<string, RecipientContact>> {
  const ids = profile.recipients.map((r) => r.employeeId);
  if (!ids.length) return new Map();
  const ph = ids.map((_, i) => `$${i + 1}`).join(",");
  const rows = rowsToObjects(
    await db.exec(`SELECT employee_id, email, user_id FROM employee_profiles WHERE employee_id IN (${ph})`, ids)
  );
  return new Map(
    rows.map((r) => [
      String(r.employee_id),
      {
        email: r.email != null ? String(r.email) : "",
        userId: r.user_id != null ? String(r.user_id) : "",
      },
    ])
  );
}

export interface DispatchResult {
  dispatched: number;
  skipped?: string;
  channels?: Record<string, ChannelSendResult>;
  /** 프로파일별 결과 요약(복수 프로파일). */
  profiles?: { name: string; dispatched: number; skipped?: string }[];
}

/** 발송분을 큐에 sent 로 마킹 — 웹의 '발송 대기' 건수와 어긋나지 않도록. */
async function markQueueSent(matches: MatchedBid[], nowIso: string): Promise<void> {
  if (!matches.length) return;
  await withDbWrite(async (wdb) => {
    for (const m of matches) {
      await wdb.run(
        `UPDATE bid_match_notices SET status = 'sent', sent_at = $1
          WHERE bid_type = $2 AND bid_id = $3 AND status = 'pending'`,
        [nowIso, m.bidType, m.bidId]
      );
    }
  });
}

/** 어떤 프로파일의 매칭 범위에도 들지 않는 오래된 pending 정리 — 큐가 무한히 쌓이지 않게. */
async function expireStalePending(maxRangeDays: number, today: string, nowIso: string): Promise<void> {
  const cutoff = addDays(today, -maxRangeDays);
  await withDbWrite(async (wdb) => {
    await wdb.run(
      `UPDATE bid_match_notices
          SET status = 'skipped', sent_at = $1,
              channel_results = '{"reason":"out-of-range"}'::jsonb
        WHERE status = 'pending' AND substring(matched_at, 1, 10) < $2`,
      [nowIso, cutoff]
    );
  });
}

async function dispatchProfile(
  db: PgDatabase,
  profile: BidNotifyProfile,
  today: string,
  hm: string,
  nowIso: string
): Promise<{ dispatched: number; skipped?: string; channels?: Record<string, ChannelSendResult> }> {
  if (!profile.enabled || !profile.recipients.length) return { dispatched: 0, skipped: "disabled" };
  if (hm < profile.sendTime) return { dispatched: 0, skipped: "before-send-time" };
  if (profile.lastDispatchDate === today) return { dispatched: 0, skipped: "already-dispatched" };
  if (!profile.bidTypes.length) return { dispatched: 0, skipped: "no-bid-type" };

  const fromDate = addDays(today, -profile.rangeDays);
  const matches = await searchMatches(db, profile, fromDate);
  if (!matches.length) {
    // 대상이 없어도 오늘 체크는 완료 처리 — 매 주기 재검색 방지.
    await patchBidNotifyProfile(profile.profileId, { lastDispatchDate: today });
    return { dispatched: 0, skipped: "no-match" };
  }

  const contacts = await loadRecipientContacts(db, profile);
  const emailTo: string[] = [];
  const appUserIds: string[] = [];
  for (const rcpt of profile.recipients) {
    const c = contacts.get(rcpt.employeeId);
    if (rcpt.channels.includes("email") && c?.email) emailTo.push(c.email);
    if (rcpt.channels.includes("app") && c?.userId) appUserIds.push(c.userId);
  }

  const msg = buildMessage(matches, profile);
  const channels: Record<string, ChannelSendResult> = {};
  if (emailTo.length) channels.email = await sendNotifyEmail({ to: emailTo, subject: msg.subject, text: msg.text });
  if (appUserIds.length) {
    // 푸시는 요약만 — 목록 전체는 앱의 공공입찰 화면에서 본다(M6-C).
    channels.app = await sendPush(appUserIds, {
      event: "bid.match",
      title: `${profile.name} 매칭 ${matches.length}건`,
      body: pushSummary(matches),
      link: "/bids",
      targetRef: today,
      dedupKey: `bid.match:${profile.profileId}:${today}`,
    });
  }

  await markQueueSent(matches, nowIso);
  await patchBidNotifyProfile(profile.profileId, { lastDispatchDate: today });
  console.log(
    `[bid-notify] "${profile.name}" dispatched ${matches.length} matches (range ${profile.rangeDays}d)`,
    JSON.stringify(channels)
  );
  return { dispatched: matches.length, channels };
}

export async function dispatchDueBidNotices(now = new Date()): Promise<DispatchResult> {
  const { profiles } = await loadBidNotifyConfig();
  const active = profiles.filter((p) => p.enabled && p.recipients.length);
  if (!active.length) return { dispatched: 0, skipped: "disabled" };

  const { date: today, hm } = kstParts(now);
  const nowIso = now.toISOString();
  const db = await getDb();

  let total = 0;
  const results: { name: string; dispatched: number; skipped?: string }[] = [];
  const channels: Record<string, ChannelSendResult> = {};
  for (const p of active) {
    const r = await dispatchProfile(db, p, today, hm, nowIso);
    total += r.dispatched;
    results.push({ name: p.name, dispatched: r.dispatched, ...(r.skipped ? { skipped: r.skipped } : {}) });
    for (const [k, v] of Object.entries(r.channels ?? {})) channels[`${p.name}:${k}`] = v;
  }
  await expireStalePending(Math.max(...active.map((p) => p.rangeDays)), today, nowIso);

  return {
    dispatched: total,
    ...(total ? { channels } : { skipped: "no-match" }),
    profiles: results,
  };
}

/**
 * 테스트 전송 — 지금 편집 중인 조건 그대로 즉시 1회 발송한다.
 * 발송 시각·활성화·일1회 멱등을 모두 무시하고, 큐 마킹과 lastDispatchDate 기록도 하지 않는다.
 * 매칭이 0건이어도 채널 점검이 되도록 "0건" 본문으로 발송한다.
 */
export async function sendTestNotification(
  profile: BidNotifyProfile
): Promise<{ matched: number; channels: Record<string, ChannelSendResult>; recipients: number }> {
  const { date: today } = kstParts();
  const db = await getDb();
  const fromDate = addDays(today, -profile.rangeDays);
  const matches = profile.bidTypes.length ? await searchMatches(db, profile, fromDate) : [];

  const contacts = await loadRecipientContacts(db, profile);
  const emailTo: string[] = [];
  const appUserIds: string[] = [];
  for (const rcpt of profile.recipients) {
    const c = contacts.get(rcpt.employeeId);
    if (rcpt.channels.includes("email") && c?.email) emailTo.push(c.email);
    if (rcpt.channels.includes("app") && c?.userId) appUserIds.push(c.userId);
  }

  const base = matches.length
    ? buildMessage(matches, profile)
    : {
        subject: `[공공입찰] ${profile.name} 매칭 0건`,
        text: `${profile.name} 조건(최근 ${profile.rangeDays}일)에 매칭된 공고가 없습니다.`,
      };
  const channels: Record<string, ChannelSendResult> = {};
  if (emailTo.length) {
    channels.email = await sendNotifyEmail({
      to: emailTo,
      subject: `[테스트] ${base.subject}`,
      text: `※ 테스트 전송입니다.\n\n${base.text}`,
    });
  }
  if (appUserIds.length) {
    channels.app = await sendPush(appUserIds, {
      event: "bid.match",
      title: `[테스트] ${profile.name} 매칭 ${matches.length}건`,
      body: matches.length ? pushSummary(matches) : "조건에 맞는 공고가 없습니다.",
      link: "/bids",
      targetRef: today,
      // 테스트는 같은 날 여러 번 눌러도 매번 도착해야 하므로 dedup 키에 시각을 넣는다.
      dedupKey: `bid.match.test:${profile.profileId}:${new Date().toISOString()}`,
    });
  }
  console.log(`[bid-notify] TEST "${profile.name}" matched=${matches.length}`, JSON.stringify(channels));
  return { matched: matches.length, channels, recipients: emailTo.length + appUserIds.length };
}

/**
 * 입찰 마감 임박 알림 — 입찰 서류 생성 진행 중(bid_packages.status='draft') 건이 대상.
 *
 * 프로파일의 deadlineDays(D-N) 안에 마감이 오는 진행 건을, 수신자 중 '마감 알림'을 체크한
 * 사람에게만 보낸다. 같은 건을 마감까지 매일 상기시켜야 하므로 큐를 소비하지 않고
 * 멱등은 푸시 로그의 dedup_key(`bid.deadline:{프로파일}:{날짜}`)에 의존한다.
 */
export async function dispatchBidDeadlineReminders(now = new Date()): Promise<DispatchResult> {
  const { profiles } = await loadBidNotifyConfig();
  const active = profiles.filter(
    (p) => p.enabled && p.deadlineDays > 0 && p.recipients.some((r) => r.deadlineAlert)
  );
  if (!active.length) return { dispatched: 0, skipped: "disabled" };

  const { date: today, hm } = kstParts(now);
  const db = await getDb();
  const packages = await listActivePackages(50);
  if (!packages.length) return { dispatched: 0, skipped: "no-package" };

  let total = 0;
  const channels: Record<string, ChannelSendResult> = {};
  const results: { name: string; dispatched: number; skipped?: string }[] = [];

  for (const p of active) {
    if (hm < p.sendTime) {
      results.push({ name: p.name, dispatched: 0, skipped: "before-send-time" });
      continue;
    }
    const until = addDays(today, p.deadlineDays);
    const soon = packages
      .filter((pkg) => {
        const d = (pkg.deadline ?? "").slice(0, 10);
        return d && d >= today && d <= until;
      })
      .sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? ""));
    if (!soon.length) {
      results.push({ name: p.name, dispatched: 0, skipped: "no-upcoming" });
      continue;
    }

    const contacts = await loadRecipientContacts(db, p);
    const targets = p.recipients.filter((r) => r.deadlineAlert);
    const emailTo: string[] = [];
    const appUserIds: string[] = [];
    for (const rcpt of targets) {
      const c = contacts.get(rcpt.employeeId);
      if (rcpt.channels.includes("email") && c?.email) emailTo.push(c.email);
      if (rcpt.channels.includes("app") && c?.userId) appUserIds.push(c.userId);
    }
    if (!emailTo.length && !appUserIds.length) {
      results.push({ name: p.name, dispatched: 0, skipped: "no-contact" });
      continue;
    }

    const lines = soon.map(
      (pkg) => ` · ${pkg.title || "제목 없음"} | ${pkg.orgName || "기관 미상"} | 마감 ${(pkg.deadline ?? "").slice(0, 16)}`
    );
    const head = soon[0];
    const headLine = `${head.title || "진행 건"} (마감 ${(head.deadline ?? "").slice(0, 10)})`;
    const body = soon.length > 1 ? `${headLine} 외 ${soon.length - 1}건` : headLine;

    if (emailTo.length) {
      channels[`${p.name}:email`] = await sendNotifyEmail({
        to: emailTo,
        subject: `[공공입찰] 입찰 서류 진행 건 마감 임박 ${soon.length}건`,
        text: `서류 생성 진행 중인 입찰 건 중 ${p.deadlineDays}일 내 마감이 ${soon.length}건 있습니다.\n\n${lines.join("\n")}`,
      });
    }
    if (appUserIds.length) {
      channels[`${p.name}:app`] = await sendPush(appUserIds, {
        event: "bid.deadline",
        title: `입찰 마감 임박 ${soon.length}건`,
        body: body.length > 90 ? `${body.slice(0, 89)}…` : body,
        link: "/bids?filter=deadline",
        targetRef: today,
        dedupKey: `bid.deadline:${p.profileId}:${today}`,
      });
    }
    total += soon.length;
    results.push({ name: p.name, dispatched: soon.length });
    console.log(`[bid-notify] "${p.name}" deadline reminder ${soon.length}건(D-${p.deadlineDays})`);
  }

  return { dispatched: total, ...(total ? { channels } : { skipped: "no-upcoming" }), profiles: results };
}
