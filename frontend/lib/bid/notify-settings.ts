/**
 * 공공입찰 매칭 알림 설정 — 수신자(영업 담당자)·채널(카카오/메일/앱)·발송 시각.
 * intel_settings(key-value jsonb) 테이블에 setting_key='bid_notify' 로 저장한다.
 */
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";

export type NotifyChannel = "kakao" | "email" | "app";
export type NotifyBidType = "order_plan" | "prior_spec" | "bid_notice";

export interface NotifyRecipient {
  employeeId: string;
  name: string;
  channels: NotifyChannel[];
}

/** 발송 본문에 포함할 항목(종류별, 위→아래 순서) — name 은 표준 컬럼 또는 raw_json 필드명. */
export interface NotifyContentField {
  name: string;
  label: string;
}

export interface BidNotifySettings {
  enabled: boolean;
  /** 발송 시각(KST, "HH:MM") — 이 시각 이후 첫 체크에서 그동안 쌓인 매칭 건을 발송(일 1회). */
  sendTime: string;
  recipients: NotifyRecipient[];
  /** 발송 대상 종류 — 미포함 종류의 매칭 건은 발송하지 않는다(웹 알림만). */
  bidTypes: NotifyBidType[];
  /** 종류별 발송 항목 구성(순서 보존). 없으면 기본(분류·사업명·기관·마감·링크). */
  contentFields: Partial<Record<NotifyBidType, NotifyContentField[]>>;
  /** 마지막 발송 처리일(KST YYYY-MM-DD) — 일 1회 멱등 가드. */
  lastDispatchDate?: string;
}

const SETTINGS_KEY = "bid_notify";
const CHANNELS: NotifyChannel[] = ["kakao", "email", "app"];
const BID_TYPES: NotifyBidType[] = ["order_plan", "prior_spec", "bid_notice"];

export const BID_NOTIFY_DEFAULTS: BidNotifySettings = {
  enabled: false,
  sendTime: "08:30",
  recipients: [],
  bidTypes: [...BID_TYPES],
  contentFields: {},
};

function sanitize(raw: unknown): BidNotifySettings {
  const r = (raw ?? {}) as Partial<BidNotifySettings>;
  const sendTime = /^\d{2}:\d{2}$/.test(String(r.sendTime ?? "")) ? String(r.sendTime) : BID_NOTIFY_DEFAULTS.sendTime;
  const recipients: NotifyRecipient[] = Array.isArray(r.recipients)
    ? r.recipients
        .map((p) => ({
          employeeId: String((p as NotifyRecipient)?.employeeId ?? "").trim(),
          name: String((p as NotifyRecipient)?.name ?? "").trim(),
          channels: (Array.isArray((p as NotifyRecipient)?.channels) ? (p as NotifyRecipient).channels : [])
            .map((c) => String(c) as NotifyChannel)
            .filter((c) => CHANNELS.includes(c)),
        }))
        .filter((p) => p.employeeId)
        .slice(0, 50)
    : [];
  const bidTypes = Array.isArray(r.bidTypes)
    ? BID_TYPES.filter((t) => (r.bidTypes as string[]).includes(t))
    : [...BID_TYPES];
  const contentFields: BidNotifySettings["contentFields"] = {};
  if (r.contentFields && typeof r.contentFields === "object") {
    for (const t of BID_TYPES) {
      const arr = (r.contentFields as Record<string, unknown>)[t];
      if (!Array.isArray(arr)) continue;
      const fields = arr
        .map((f) => ({
          name: String((f as NotifyContentField)?.name ?? "").trim(),
          label: String((f as NotifyContentField)?.label ?? "").trim(),
        }))
        .filter((f) => /^[A-Za-z0-9_.]{1,60}$/.test(f.name))
        .map((f) => ({ ...f, label: f.label || f.name }))
        .slice(0, 20);
      if (fields.length) contentFields[t] = fields;
    }
  }
  return {
    enabled: r.enabled === true,
    sendTime,
    recipients,
    bidTypes,
    contentFields,
    ...(typeof r.lastDispatchDate === "string" ? { lastDispatchDate: r.lastDispatchDate } : {}),
  };
}

export async function loadBidNotifySettings(): Promise<BidNotifySettings> {
  try {
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(`SELECT setting_json FROM intel_settings WHERE setting_key = $1`, [SETTINGS_KEY])
    );
    if (!rows.length) return BID_NOTIFY_DEFAULTS;
    const raw = rows[0].setting_json;
    return sanitize(typeof raw === "string" ? JSON.parse(raw) : raw);
  } catch {
    // 테이블 부재·파싱 오류 시에도 기본값으로 계속(발송 비활성)
    return BID_NOTIFY_DEFAULTS;
  }
}

export async function saveBidNotifySettings(
  patch: Partial<BidNotifySettings>,
  updatedBy: string | null
): Promise<BidNotifySettings> {
  const current = await loadBidNotifySettings();
  const merged = sanitize({ ...current, ...patch });
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO intel_settings (setting_key, setting_json, updated_at, updated_by)
       VALUES ($1, $2::jsonb, $3, $4)
       ON CONFLICT (setting_key) DO UPDATE
         SET setting_json = EXCLUDED.setting_json,
             updated_at = EXCLUDED.updated_at,
             updated_by = EXCLUDED.updated_by`,
      [SETTINGS_KEY, JSON.stringify(merged), now, updatedBy]
    );
  });
  return merged;
}
