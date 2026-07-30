/**
 * 공공입찰 매칭 알림 발송 디스패처 — 설정된 발송 시각(KST) 이후 첫 체크에서
 * pending 큐(bid_match_notices)를 요약 메시지로 묶어 수신자 채널별(카카오 알림톡/메일)로 발송한다.
 * 발송 대상 종류(settings.bidTypes)만 발송하고, 종류별 발송 항목(contentFields)이 있으면
 * 해당 bid 테이블의 원문(raw_json)에서 값을 뽑아 지정 순서대로 본문을 구성한다.
 * 일 1회 멱등(lastDispatchDate). 트리거는 instrumentation.ts 의 주기 타이머(next 서버 상주).
 * 앱(app) 채널은 모바일 푸시로 나간다(M6-C) — 요약 1건만 보내고 목록은 앱 화면에서 본다.
 * 같은 틱에서 마감 임박(deadlineDays) 알림도 함께 발송한다.
 */
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import {
  loadBidNotifySettings,
  saveBidNotifySettings,
  type BidNotifySettings,
  type NotifyBidType,
} from "@/lib/bid/notify-settings";
import { sendNotifyEmail, type ChannelSendResult } from "@/lib/notify/email-ses";
import { sendAlimtalk } from "@/lib/notify/kakao-solapi";
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
const DISPATCH_LIMIT = 500;

interface PendingNotice {
  noticeId: string;
  bidType: string;
  bidId: string;
  categoryName: string | null;
  title: string | null;
  orgName: string | null;
  deadline: string | null;
  url: string | null;
}

/** KST(UTC+9) 기준 날짜/시각 문자열. */
function kstParts(now = new Date()): { date: string; hm: string } {
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  const iso = kst.toISOString();
  return { date: iso.slice(0, 10), hm: iso.slice(11, 16) };
}

/** contentFields 값 조회용 — 원문(raw_json) + 표준 컬럼 병합 맵(bid_id 키). */
async function loadDetailMaps(
  db: PgDatabase,
  byType: Map<string, PendingNotice[]>,
  settings: BidNotifySettings
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const [type, arr] of byType) {
    const fields = settings.contentFields[type as NotifyBidType];
    const table = TABLE_BY_TYPE[type as NotifyBidType];
    if (!fields?.length || !table || !arr.length) continue;
    const ids = arr.map((n) => n.bidId);
    const ph = ids.map((_, i) => `$${i + 1}`).join(",");
    const rows = rowsToObjects(await db.exec(`SELECT * FROM ${table} WHERE bid_id IN (${ph})`, ids));
    for (const r of rows) {
      let raw: Record<string, unknown> = {};
      try {
        const v = typeof r.raw_json === "string" ? JSON.parse(r.raw_json) : r.raw_json;
        if (v && typeof v === "object") raw = v as Record<string, unknown>;
      } catch {
        // raw 파싱 실패 시 표준 컬럼만
      }
      out.set(String(r.bid_id), {
        ...raw,
        org_name: r.org_name, title: r.title, budget: r.budget, posted_at: r.posted_at,
        deadline: r.deadline, method: r.method, work_type: r.work_type, category: r.category,
        url: r.url, external_id: r.external_id,
      });
    }
  }
  return out;
}

function fieldValue(merged: Record<string, unknown> | undefined, name: string): string {
  const v = merged?.[name];
  if (v == null || v === "") return "";
  if (name === "budget") {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return `${n.toLocaleString("ko-KR")}원`;
  }
  return String(v);
}

function buildMessage(
  notices: PendingNotice[],
  settings: BidNotifySettings,
  detailMaps: Map<string, Record<string, unknown>>
): { subject: string; text: string } {
  const byType = new Map<string, PendingNotice[]>();
  for (const n of notices) {
    const arr = byType.get(n.bidType) ?? [];
    arr.push(n);
    byType.set(n.bidType, arr);
  }
  const lines: string[] = [];
  let listed = 0;
  for (const [type, arr] of byType) {
    lines.push(`■ ${TYPE_LABEL[type] ?? type} ${arr.length}건`);
    const fields = settings.contentFields[type as NotifyBidType];
    for (const n of arr) {
      if (listed >= MAX_LINES) break;
      listed++;
      if (fields?.length) {
        // 사용자 구성 항목 — 지정 순서대로 "라벨: 값"
        lines.push(` · [${n.categoryName ?? "분류"}]`);
        const merged = detailMaps.get(n.bidId);
        for (const f of fields) {
          const v = fieldValue(merged, f.name);
          if (v) lines.push(`   ${f.label}: ${v}`);
        }
        if (n.url && !fields.some((f) => f.name === "url")) lines.push(`   ${n.url}`);
      } else {
        // 기본 구성 — 분류·사업명·기관·마감·링크
        const parts = [
          `[${n.categoryName ?? "분류"}] ${n.title ?? "제목 없음"}`,
          n.orgName ?? "",
          n.deadline ? `마감 ${String(n.deadline).slice(0, 10)}` : "",
        ].filter(Boolean);
        lines.push(` · ${parts.join(" | ")}`);
        if (n.url) lines.push(`   ${n.url}`);
      }
    }
  }
  if (notices.length > listed) lines.push(`… 외 ${notices.length - listed}건 (웹 공공입찰 화면에서 확인)`);
  return {
    subject: `[공공입찰] 사업분야 매칭 ${notices.length}건`,
    text: `사업분야 매칭 공고 ${notices.length}건이 수집되었습니다.\n\n${lines.join("\n")}`,
  };
}

/** 푸시 본문 — 알림 한 줄에 들어갈 요약(대표 1건 + 나머지 건수). */
function pushSummary(notices: PendingNotice[]): string {
  const head = notices[0]?.title?.trim() || notices[0]?.categoryName || "신규 공고";
  const rest = notices.length - 1;
  const line = rest > 0 ? `${head} 외 ${rest}건` : head;
  return line.length > 90 ? `${line.slice(0, 89)}…` : line;
}

interface RecipientContact {
  phone: string;
  email: string;
  /** 앱 푸시 대상 — 직원 프로필에 연결된 로그인 계정. 미연결이면 앱 채널 발송 불가. */
  userId: string;
}

async function loadRecipientContacts(
  db: PgDatabase,
  settings: BidNotifySettings
): Promise<Map<string, RecipientContact>> {
  const ids = settings.recipients.map((r) => r.employeeId);
  if (!ids.length) return new Map();
  const ph = ids.map((_, i) => `$${i + 1}`).join(",");
  const rows = rowsToObjects(
    await db.exec(
      `SELECT employee_id, mobile_phone, email, user_id FROM employee_profiles WHERE employee_id IN (${ph})`,
      ids
    )
  );
  return new Map(
    rows.map((r) => [
      String(r.employee_id),
      {
        phone: r.mobile_phone != null ? String(r.mobile_phone) : "",
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
}

export async function dispatchDueBidNotices(now = new Date()): Promise<DispatchResult> {
  const settings = await loadBidNotifySettings();
  if (!settings.enabled || !settings.recipients.length) return { dispatched: 0, skipped: "disabled" };

  const { date: today, hm } = kstParts(now);
  if (hm < settings.sendTime) return { dispatched: 0, skipped: "before-send-time" };
  if (settings.lastDispatchDate === today) return { dispatched: 0, skipped: "already-dispatched" };

  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT notice_id, bid_type, bid_id, category_name, title, org_name, deadline, url
         FROM bid_match_notices WHERE status = 'pending'
        ORDER BY matched_at ASC LIMIT ${DISPATCH_LIMIT}`
    )
  );
  const all: PendingNotice[] = rows.map((r) => ({
    noticeId: String(r.notice_id),
    bidType: String(r.bid_type),
    bidId: String(r.bid_id),
    categoryName: r.category_name != null ? String(r.category_name) : null,
    title: r.title != null ? String(r.title) : null,
    orgName: r.org_name != null ? String(r.org_name) : null,
    deadline: r.deadline != null ? String(r.deadline) : null,
    url: r.url != null ? String(r.url) : null,
  }));
  // 발송 대상 종류만 발송 — 미대상 종류는 skipped(웹 벨 알림은 매칭 시점에 이미 발행됨).
  const pending = all.filter((n) => settings.bidTypes.includes(n.bidType as NotifyBidType));
  const offTypeIds = all.filter((n) => !settings.bidTypes.includes(n.bidType as NotifyBidType)).map((n) => n.noticeId);
  const nowIso = now.toISOString();
  if (offTypeIds.length) {
    await withDbWrite(async (wdb) => {
      const ph = offTypeIds.map((_, i) => `$${i + 2}`).join(",");
      await wdb.run(
        `UPDATE bid_match_notices SET status = 'skipped', channel_results = '{"reason":"bid-type-off"}'::jsonb, sent_at = $1
          WHERE notice_id IN (${ph})`,
        [nowIso, ...offTypeIds]
      );
    });
  }
  if (!pending.length) {
    // 발송할 게 없어도 오늘 체크는 완료 처리 — 매 주기 재확인 방지.
    await saveBidNotifySettings({ lastDispatchDate: today }, null);
    return { dispatched: 0, skipped: "no-pending" };
  }

  // 수신자 연락처 — employee_profiles(mobile_phone/email/user_id)에서 발송 시점에 조회.
  const contacts = await loadRecipientContacts(db, settings);
  const kakaoTo: string[] = [];
  const emailTo: string[] = [];
  const appUserIds: string[] = [];
  for (const rcpt of settings.recipients) {
    const c = contacts.get(rcpt.employeeId);
    if (rcpt.channels.includes("kakao") && c?.phone) kakaoTo.push(c.phone);
    if (rcpt.channels.includes("email") && c?.email) emailTo.push(c.email);
    if (rcpt.channels.includes("app") && c?.userId) appUserIds.push(c.userId);
  }

  // 발송 항목 구성이 있는 종류는 원문에서 값을 뽑는다.
  const byType = new Map<string, PendingNotice[]>();
  for (const n of pending) {
    const arr = byType.get(n.bidType) ?? [];
    arr.push(n);
    byType.set(n.bidType, arr);
  }
  const detailMaps = await loadDetailMaps(db, byType, settings);

  const msg = buildMessage(pending, settings, detailMaps);
  const channels: Record<string, ChannelSendResult> = {};
  if (kakaoTo.length) channels.kakao = await sendAlimtalk({ to: kakaoTo, text: msg.text });
  if (emailTo.length) channels.email = await sendNotifyEmail({ to: emailTo, subject: msg.subject, text: msg.text });
  if (appUserIds.length) {
    // 푸시는 요약만 — 목록 전체는 앱의 공공입찰 화면에서 본다(M6-C).
    channels.app = await sendPush(appUserIds, {
      event: "bid.match",
      title: `공공입찰 매칭 ${pending.length}건`,
      body: pushSummary(pending),
      link: "/bids",
      targetRef: today,
      dedupKey: `bid.match:${today}`,
    });
  }

  const anySent = Object.values(channels).some((c) => c.ok);
  const anyTried = Object.values(channels).some((c) => c.ok || c.error);
  // 하나라도 성공 → sent. 시도했으나 전부 실패 → failed. 채널/자격증명 미비로 시도 자체가 없음 → skipped.
  const status = anySent ? "sent" : anyTried ? "failed" : "skipped";

  await withDbWrite(async (wdb) => {
    const idPh = pending.map((_, i) => `$${i + 4}`).join(",");
    await wdb.run(
      `UPDATE bid_match_notices SET status = $1, sent_at = $2, channel_results = $3::jsonb
        WHERE notice_id IN (${idPh})`,
      [status, nowIso, JSON.stringify(channels), ...pending.map((p) => p.noticeId)]
    );
  });
  await saveBidNotifySettings({ lastDispatchDate: today }, null);
  console.log(`[bid-notify] dispatched ${pending.length} notices status=${status}`, JSON.stringify(channels));
  return { dispatched: pending.length, channels };
}

/** KST 기준 date 문자열에 일수를 더한다. */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 입찰 마감 임박 알림(M6-C) — 앱 푸시 전용.
 *
 * 매칭 이력이 있는 공고(bid_match_notices) 중 마감이 오늘~D-N 인 건을 하루 1회 요약해 보낸다.
 * 매칭 알림과 달리 큐 상태를 소비하지 않으므로(같은 공고를 마감까지 매일 상기시켜야 한다),
 * 멱등은 mobile_push_log 의 dedup_key(`bid.deadline:{날짜}`)에만 의존한다.
 */
export async function dispatchBidDeadlineReminders(now = new Date()): Promise<DispatchResult> {
  const settings = await loadBidNotifySettings();
  if (!settings.enabled || settings.deadlineDays <= 0) return { dispatched: 0, skipped: "disabled" };

  const { date: today, hm } = kstParts(now);
  if (hm < settings.sendTime) return { dispatched: 0, skipped: "before-send-time" };

  const db = await getDb();
  const contacts = await loadRecipientContacts(db, settings);
  const appUserIds = settings.recipients
    .filter((r) => r.channels.includes("app"))
    .map((r) => contacts.get(r.employeeId)?.userId ?? "")
    .filter(Boolean);
  if (!appUserIds.length) return { dispatched: 0, skipped: "no-app-recipient" };

  const until = addDays(today, settings.deadlineDays);
  const types = settings.bidTypes.length ? settings.bidTypes : [];
  if (!types.length) return { dispatched: 0, skipped: "no-bid-type" };
  const typePh = types.map((_, i) => `$${i + 3}`).join(",");
  const rows = rowsToObjects(
    await db.exec(
      `SELECT DISTINCT ON (bid_type, bid_id) bid_type, bid_id, category_name, title, org_name, deadline
         FROM bid_match_notices
        WHERE deadline IS NOT NULL AND deadline <> ''
          AND substring(deadline, 1, 10) >= $1
          AND substring(deadline, 1, 10) <= $2
          AND bid_type IN (${typePh})
        ORDER BY bid_type, bid_id, matched_at DESC`,
      [today, until, ...types]
    )
  );
  if (!rows.length) return { dispatched: 0, skipped: "no-upcoming" };

  const soon = rows
    .map((r) => ({
      title: r.title != null ? String(r.title) : "",
      categoryName: r.category_name != null ? String(r.category_name) : null,
      deadline: String(r.deadline).slice(0, 10),
    }))
    .sort((a, b) => a.deadline.localeCompare(b.deadline));

  const head = soon[0];
  const rest = soon.length - 1;
  const headLine = `${head.title || head.categoryName || "공고"} (마감 ${head.deadline})`;
  const body = rest > 0 ? `${headLine} 외 ${rest}건` : headLine;

  const result = await sendPush(appUserIds, {
    event: "bid.deadline",
    title: `입찰 마감 임박 ${soon.length}건`,
    body: body.length > 90 ? `${body.slice(0, 89)}…` : body,
    link: "/bids?filter=deadline",
    targetRef: today,
    dedupKey: `bid.deadline:${today}`,
  });
  console.log(`[bid-notify] deadline reminder ${soon.length}건(D-${settings.deadlineDays})`, JSON.stringify(result));
  return { dispatched: result.ok ? soon.length : 0, channels: { app: result } };
}
