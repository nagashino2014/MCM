/**
 * 공공입찰 매칭 알림 설정 — 발송 조건을 여러 개(프로파일) 등록해 각각 독립 발송한다.
 * 프로파일마다 발송 시각·매칭 범위(N일)·대상 종류·용역 분류/지역권 필터·수신자·발송 항목을 갖는다.
 * intel_settings(key-value jsonb) 테이블에 setting_key='bid_notify' 로 저장한다.
 * 구형(단일 설정) 저장본은 로드 시 프로파일 1개로 승격한다(하위호환).
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { TICK_CACHE_BID_NOTIFY, invalidateTickCache } from "@/lib/tick-cache";

/** 카카오 알림톡은 앱 푸시로 대체돼 발송 수단에서 제외됐다(구형 저장값은 로드 시 제거). */
export type NotifyChannel = "email" | "app";
export type NotifyBidType = "order_plan" | "prior_spec" | "bid_notice";

export interface NotifyRecipient {
  employeeId: string;
  name: string;
  channels: NotifyChannel[];
  /** 마감 임박 알림(입찰 서류 생성 진행 건) 수신 여부 — 체크한 사람에게만 보낸다. */
  deadlineAlert?: boolean;
}

/** 발송 본문에 포함할 항목(종류별, 위→아래 순서) — name 은 표준 컬럼 또는 raw_json 필드명. */
export interface NotifyContentField {
  name: string;
  label: string;
}

export interface BidNotifyProfile {
  profileId: string;
  /** 태그에 표시되는 이름. */
  name: string;
  enabled: boolean;
  /** 발송 시각(KST, "HH:MM") — 이 시각 이후 첫 체크에서 발송(일 1회). UI 입력은 HHMM 4자리. */
  sendTime: string;
  /** 매칭 범위(일) — 발송일 기준 N일 전 00:00(KST) 이후 게시분에서 조건을 검색한다. */
  rangeDays: number;
  /** 발송 대상 종류. */
  bidTypes: NotifyBidType[];
  /** 용역 분류 필터(bid_categories.category_id) — 비어 있으면 활성 분류 전체. */
  categoryIds: string[];
  /** 지역권 필터(REGION_GROUPS 키) — 비어 있으면 전 지역. */
  regionGroups: string[];
  /** 마감 임박 알림 기준일(D-N). 0 이면 사용하지 않는다. */
  deadlineDays: number;
  recipients: NotifyRecipient[];
  /** 종류별 발송 항목 구성(순서 보존). 없으면 기본 구성(DEFAULT_CONTENT_FIELDS). */
  contentFields: Partial<Record<NotifyBidType, NotifyContentField[]>>;
  /** 마지막 발송 처리일(KST YYYY-MM-DD) — 일 1회 멱등 가드. */
  lastDispatchDate?: string;
}

export interface BidNotifyConfig {
  profiles: BidNotifyProfile[];
}

const SETTINGS_KEY = "bid_notify";
const CHANNELS: NotifyChannel[] = ["email", "app"];
const BID_TYPES: NotifyBidType[] = ["order_plan", "prior_spec", "bid_notice"];
const MAX_PROFILES = 10;

/**
 * 종류별 기본 발송 항목 — 수집 파라미터가 종류당 23~113개라 실무에 필요한 것만 추린 프리셋.
 * 값이 비어 있는 항목은 발송 본문에서 자동 생략된다(buildMessage).
 */
export const DEFAULT_CONTENT_FIELDS: Record<NotifyBidType, NotifyContentField[]> = {
  bid_notice: [
    { name: "title", label: "사업명" },
    { name: "org_name", label: "발주기관" },
    { name: "budget", label: "배정예산" },
    { name: "presmptPrce", label: "추정가격" },
    { name: "posted_at", label: "공고일" },
    { name: "deadline", label: "입찰마감" },
    { name: "opengDt", label: "개찰일시" },
    { name: "bidQlfctRgstDt", label: "참가자격등록마감" },
    { name: "sucsfbidMthdNm", label: "낙찰방법" },
    { name: "cmmnSpldmdAgrmntRcptdocMethd", label: "공동수급협정서접수방식" },
    { name: "ntceInsttOfclNm", label: "공고기관담당자" },
    // 담당자 이메일(ntceInsttOfclEmailAdrs)은 나라장터가 전건 빈 값으로 내려줘 연락처로 대체.
    { name: "ntceInsttOfclTelNo", label: "담당자연락처" },
    { name: "url", label: "원문" },
  ],
  prior_spec: [
    { name: "title", label: "사업명" },
    { name: "org_name", label: "발주기관" },
    { name: "rlDminsttNm", label: "실수요기관" },
    { name: "budget", label: "배정예산" },
    // 사전규격 API 는 조달방식을 제공하지 않는 경우가 많다 — 값이 있을 때만 표기.
    { name: "method", label: "조달방식" },
    { name: "posted_at", label: "등록일" },
    { name: "deadline", label: "의견등록마감" },
    { name: "bsnsDivNm", label: "업무구분" },
    { name: "ofclNm", label: "담당자" },
    { name: "url", label: "원문" },
  ],
  order_plan: [
    { name: "title", label: "사업명" },
    { name: "org_name", label: "발주기관" },
    { name: "totlmngInsttNm", label: "총괄기관" },
    { name: "budget", label: "발주금액" },
    { name: "posted_at", label: "공고일" },
    { name: "orderYear", label: "발주년도" },
    { name: "orderMnth", label: "발주월" },
    { name: "method", label: "계약방법" },
    { name: "ofclNm", label: "담당자" },
    { name: "orderPlanDtlUrl", label: "원문" },
  ],
};

export function newProfileId(): string {
  return "bnp_" + crypto.randomBytes(6).toString("hex");
}

export function defaultProfile(name = "기본 알림"): BidNotifyProfile {
  return {
    profileId: newProfileId(),
    name,
    enabled: false,
    sendTime: "08:30",
    rangeDays: 1,
    bidTypes: [...BID_TYPES],
    categoryIds: [],
    regionGroups: [],
    deadlineDays: 3,
    recipients: [],
    contentFields: {},
  };
}

/** 외부 입력(테스트 전송 등) 프로파일 1건 정제. */
export function normalizeProfile(raw: unknown): BidNotifyProfile {
  return sanitizeProfile(raw, 0);
}

function sanitizeProfile(raw: unknown, index: number): BidNotifyProfile {
  const r = (raw ?? {}) as Partial<BidNotifyProfile>;
  const base = defaultProfile();
  const sendTime = /^\d{2}:\d{2}$/.test(String(r.sendTime ?? "")) ? String(r.sendTime) : base.sendTime;
  const recipients: NotifyRecipient[] = Array.isArray(r.recipients)
    ? r.recipients
        .map((p) => ({
          employeeId: String((p as NotifyRecipient)?.employeeId ?? "").trim(),
          name: String((p as NotifyRecipient)?.name ?? "").trim(),
          channels: (Array.isArray((p as NotifyRecipient)?.channels) ? (p as NotifyRecipient).channels : [])
            .map((c) => String(c) as NotifyChannel)
            .filter((c) => CHANNELS.includes(c)),
          deadlineAlert: (p as NotifyRecipient)?.deadlineAlert === true,
        }))
        .filter((p) => p.employeeId)
        .slice(0, 50)
    : [];
  const bidTypes = Array.isArray(r.bidTypes)
    ? BID_TYPES.filter((t) => (r.bidTypes as string[]).includes(t))
    : [...BID_TYPES];
  const contentFields: BidNotifyProfile["contentFields"] = {};
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
  const dd = Number(r.deadlineDays);
  const rd = Number(r.rangeDays);
  return {
    profileId: String(r.profileId ?? "").trim() || newProfileId(),
    name: String(r.name ?? "").trim().slice(0, 40) || `알림 ${index + 1}`,
    enabled: r.enabled === true,
    sendTime,
    rangeDays: Number.isFinite(rd) && rd >= 1 ? Math.min(Math.trunc(rd), 30) : base.rangeDays,
    bidTypes,
    categoryIds: Array.isArray(r.categoryIds)
      ? r.categoryIds.map((c) => String(c).trim()).filter(Boolean).slice(0, 30)
      : [],
    regionGroups: Array.isArray(r.regionGroups)
      ? r.regionGroups.map((g) => String(g).trim()).filter(Boolean).slice(0, 10)
      : [],
    deadlineDays: Number.isFinite(dd) && dd >= 0 ? Math.min(Math.trunc(dd), 30) : base.deadlineDays,
    recipients,
    contentFields,
    ...(typeof r.lastDispatchDate === "string" ? { lastDispatchDate: r.lastDispatchDate } : {}),
  };
}

/** 저장본 → 설정. 구형(프로파일 배열이 아닌 단일 객체)은 프로파일 1개로 승격한다. */
function sanitize(raw: unknown): BidNotifyConfig {
  const r = (raw ?? {}) as { profiles?: unknown };
  const arr = Array.isArray(r.profiles) ? r.profiles : raw && typeof raw === "object" ? [raw] : [];
  const profiles = arr.slice(0, MAX_PROFILES).map((p, i) => sanitizeProfile(p, i));
  return { profiles };
}

export async function loadBidNotifyConfig(): Promise<BidNotifyConfig> {
  try {
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(`SELECT setting_json FROM intel_settings WHERE setting_key = $1`, [SETTINGS_KEY])
    );
    if (!rows.length) return { profiles: [] };
    const raw = rows[0].setting_json;
    return sanitize(typeof raw === "string" ? JSON.parse(raw) : raw);
  } catch {
    // 테이블 부재·파싱 오류 시에도 빈 설정으로 계속(발송 비활성)
    return { profiles: [] };
  }
}

/** 프로파일 목록 전체를 교체 저장(UI 저장 경로). */
export async function saveBidNotifyConfig(
  profiles: unknown,
  updatedBy: string | null
): Promise<BidNotifyConfig> {
  const merged = sanitize({ profiles });
  await persist(merged, updatedBy);
  return merged;
}

/** 프로파일 1개의 일부 필드만 갱신(발송기의 lastDispatchDate 기록용). */
export async function patchBidNotifyProfile(
  profileId: string,
  patch: Partial<BidNotifyProfile>
): Promise<void> {
  const current = await loadBidNotifyConfig();
  const profiles = current.profiles.map((p) => (p.profileId === profileId ? { ...p, ...patch } : p));
  await persist(sanitize({ profiles }), null);
}

async function persist(config: BidNotifyConfig, updatedBy: string | null): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO intel_settings (setting_key, setting_json, updated_at, updated_by)
       VALUES ($1, $2::jsonb, $3, $4)
       ON CONFLICT (setting_key) DO UPDATE
         SET setting_json = EXCLUDED.setting_json,
             updated_at = EXCLUDED.updated_at,
             updated_by = EXCLUDED.updated_by`,
      [SETTINGS_KEY, JSON.stringify(config), now, updatedBy]
    );
  });
  // UI 저장·발송 후 lastDispatchDate 기록 모두 이 경로를 지난다 — 발송 틱의 사전 판정 캐시를 버린다.
  invalidateTickCache(TICK_CACHE_BID_NOTIFY);
}
