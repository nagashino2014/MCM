/**
 * 설문 공통 상수·정규화 — 서버/클라이언트 공용 순수 함수.
 */
import type {
  NoticeFields,
  NoticeTheme,
  QuestionConfig,
  QuestionOption,
  QuestionType,
  SurveyAudience,
} from "./types";

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  single: "객관식(단일 선택)",
  multi: "객관식(복수 선택)",
  scale: "척도(점수)",
  text: "단답형",
  longtext: "서술형",
  section: "설명 블록",
};

/** 보기가 필요한 유형. */
export const CHOICE_TYPES: QuestionType[] = ["single", "multi"];

/** 보기 "기타" 직접 입력의 예약 value. */
export const OTHER_VALUE = "__other__";

export const DEFAULT_SCALE: Required<Pick<QuestionConfig, "min" | "max">> = { min: 1, max: 5 };

export function normalizeOptions(raw: unknown): QuestionOption[] {
  if (!Array.isArray(raw)) return [];
  const out: QuestionOption[] = [];
  for (const o of raw.slice(0, 50)) {
    if (!o || typeof o !== "object") continue;
    const r = o as Record<string, unknown>;
    const label = String(r.label ?? "").trim().slice(0, 300);
    if (!label) continue;
    const value = String(r.value ?? "").trim().slice(0, 60) || "o" + (out.length + 1);
    out.push({ value, label });
  }
  return out;
}

export function normalizeConfig(raw: unknown): QuestionConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const cfg: QuestionConfig = {};
  const min = Number(r.min);
  const max = Number(r.max);
  if (Number.isFinite(min)) cfg.min = Math.min(Math.max(Math.trunc(min), 0), 10);
  if (Number.isFinite(max)) cfg.max = Math.min(Math.max(Math.trunc(max), 2), 10);
  if (cfg.min != null && cfg.max != null && cfg.min >= cfg.max) {
    cfg.min = DEFAULT_SCALE.min;
    cfg.max = DEFAULT_SCALE.max;
  }
  if (typeof r.minLabel === "string") cfg.minLabel = r.minLabel.trim().slice(0, 60);
  if (typeof r.maxLabel === "string") cfg.maxLabel = r.maxLabel.trim().slice(0, 60);
  if (typeof r.allowOther === "boolean") cfg.allowOther = r.allowOther;
  const maxSelect = Number(r.maxSelect);
  if (Number.isFinite(maxSelect) && maxSelect > 0) cfg.maxSelect = Math.min(Math.trunc(maxSelect), 50);
  return cfg;
}

export function normalizeAudience(raw: unknown): SurveyAudience {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (r.scope === "departments") {
    const list = Array.isArray(r.departments) ? r.departments : [];
    const departments = list
      .map((d) => String(d ?? "").trim())
      .filter(Boolean)
      .slice(0, 100);
    if (departments.length > 0) return { scope: "departments", departments };
  }
  return { scope: "all" };
}

// ── QR 배포 이미지 ──────────────────────────────────

/** 핸드오프 시안의 기본 CI 띠(경상북도개발공사). 로고 색상 검출 실패 시 폴백. */
export const DEFAULT_BAND_COLORS = ["#1EA5E0", "#8CC63F", "#FFD400"];

export const NOTICE_LAYOUT_LABELS = { phone: "스마트폰 배포용 (1080×1920)", mail: "메일 첨부용 (1600×900)" } as const;

/** 배포 이미지 캔버스 실제 크기(px). 미리보기는 이 크기를 scale 로 축소해 보여준다. */
export const NOTICE_CANVAS = {
  phone: { width: 1080, height: 1920 },
  mail: { width: 1600, height: 900 },
} as const;

export function defaultNoticeFields(partial: Partial<NoticeFields> = {}): NoticeFields {
  return {
    targetOrg: "",
    badgeText: "내부 이해관계자(임직원) 대상",
    badgeTone: "sky",
    title: "2026 ESG 중대성평가 설문조사",
    description:
      "임직원 여러분이 생각하는 우리 조직의 ESG 중대 이슈는 무엇인가요?\n약 3분, 12개 문항. 응답은 익명으로 처리되어 지속가능경영보고서에 반영됩니다.",
    periodText: "",
    durationText: "약 3분 · 12개 문항",
    hostMain: "",
    hostSub: "(주)한국환경안전연구원",
    hostNote: "탄소중립미래연구소",
    qrCaption: "스마트폰 카메라로 QR을 스캔하면\n설문 페이지로 연결됩니다",
    logoDataUrl: null,
    qrDataUrl: null,
    qrTargetUrl: null,
    ...partial,
  };
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function normalizeNoticeTheme(raw: unknown): NoticeTheme {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const colors = Array.isArray(r.bandColors)
    ? r.bandColors.map((c) => String(c ?? "").trim()).filter((c) => HEX_RE.test(c)).slice(0, 4)
    : [];
  const theme: NoticeTheme = { bandColors: colors.length > 0 ? colors : [...DEFAULT_BAND_COLORS] };
  if (typeof r.ink === "string" && HEX_RE.test(r.ink)) theme.ink = r.ink;
  if (typeof r.body === "string" && HEX_RE.test(r.body)) theme.body = r.body;
  return theme;
}

const DATA_IMAGE_RE = /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_IMAGE_LEN = 2_000_000; // base64 기준 약 1.5MB 원본

function cleanImage(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw : "";
  if (!s || !DATA_IMAGE_RE.test(s) || s.length > MAX_IMAGE_LEN) return null;
  return s;
}

function cleanText(raw: unknown, max: number): string {
  return String(raw ?? "").slice(0, max);
}

export function normalizeNoticeFields(raw: unknown): NoticeFields {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const base = defaultNoticeFields();
  const url = typeof r.qrTargetUrl === "string" && /^https?:\/\//i.test(r.qrTargetUrl)
    ? r.qrTargetUrl.slice(0, 1000)
    : null;
  return {
    targetOrg: cleanText(r.targetOrg ?? base.targetOrg, 120),
    badgeText: cleanText(r.badgeText ?? base.badgeText, 120),
    badgeTone: r.badgeTone === "green" ? "green" : "sky",
    title: cleanText(r.title ?? base.title, 200),
    description: cleanText(r.description ?? base.description, 600),
    periodText: cleanText(r.periodText ?? base.periodText, 120),
    durationText: cleanText(r.durationText ?? base.durationText, 120),
    hostMain: cleanText(r.hostMain ?? base.hostMain, 120),
    hostSub: cleanText(r.hostSub ?? base.hostSub, 120),
    hostNote: cleanText(r.hostNote ?? base.hostNote, 120),
    qrCaption: cleanText(r.qrCaption ?? base.qrCaption, 200),
    logoDataUrl: cleanImage(r.logoDataUrl),
    qrDataUrl: cleanImage(r.qrDataUrl),
    qrTargetUrl: url,
  };
}
