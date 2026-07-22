/*
 * 휴가 종류 규정 카탈로그(086 leave_types) — 사규 [별표 5. 경조금 지급 규정] 기반.
 * ★규정이 바뀔 수 있으므로 코드 상수가 아니라 DB 로 관리하고 관리자가 화면에서 편집한다.
 * 연차/반차만 연차 대장에서 차감(deduct), 경조·출산·조의는 규정상 부여일수(days) 고정,
 * 공가·병가는 실사용 기간만큼(가변, 비차감). leave_type 필드가 이 카탈로그로 렌더된다.
 * ⚠ 이 파일은 클라이언트 안전(타입·시드·순수 조회만) — DB 접근은 leave-types-store.ts(서버).
 */

export interface LeaveTypeItem {
  key: string;
  label: string;
  group: string;
  /** 규정상 고정 부여일수(경조·출산·조의·건강검진). null = 실사용 기간만큼(공가·병가·기타) */
  days: number | null;
  /** 연차 대장 차감 방식 — full=1일, half=0.5일. null = 비차감 */
  deduct: "full" | "half" | null;
  sortOrder: number;
  active: boolean;
}

/** 초기 시드(사규 개정안 기준) — 086 마이그레이션과 이 목록이 일치해야 한다. */
export const DEFAULT_LEAVE_TYPES: Omit<LeaveTypeItem, "sortOrder" | "active">[] = [
  { key: "annual", label: "연차", group: "연차·반차", days: null, deduct: "full" },
  { key: "half_am", label: "반차(오전)", group: "연차·반차", days: null, deduct: "half" },
  { key: "half_pm", label: "반차(오후)", group: "연차·반차", days: null, deduct: "half" },
  { key: "wed_self", label: "결혼(본인)", group: "경조 · 결혼", days: 5, deduct: null },
  { key: "wed_child", label: "결혼(자녀)", group: "경조 · 결혼", days: 1, deduct: null },
  { key: "wed_sibling", label: "결혼(형제·자매)", group: "경조 · 결혼", days: 1, deduct: null },
  { key: "longevity_parent", label: "수연(부모)", group: "경조 · 수연", days: 1, deduct: null },
  { key: "longevity_parent_in_law", label: "수연(처·시부모)", group: "경조 · 수연", days: 1, deduct: null },
  { key: "longevity_self", label: "수연(본인)", group: "경조 · 수연", days: 1, deduct: null },
  { key: "longevity_spouse", label: "수연(배우자)", group: "경조 · 수연", days: 1, deduct: null },
  { key: "childbirth_self", label: "출산(여성 본인)", group: "경조 · 출산", days: 90, deduct: null },
  { key: "childbirth_spouse", label: "출산(배우자)", group: "경조 · 출산", days: 20, deduct: null },
  { key: "death_spouse", label: "조의(배우자)", group: "경조 · 조의", days: 5, deduct: null },
  { key: "death_parent", label: "조의(부모)", group: "경조 · 조의", days: 5, deduct: null },
  { key: "death_child", label: "조의(자녀)", group: "경조 · 조의", days: 3, deduct: null },
  { key: "death_grandparent", label: "조의(조부모)", group: "경조 · 조의", days: 2, deduct: null },
  { key: "death_parent_in_law", label: "조의(처·시부모)", group: "경조 · 조의", days: 3, deduct: null },
  { key: "death_sibling", label: "조의(형제·자매)", group: "경조 · 조의", days: 1, deduct: null },
  { key: "official_reserve", label: "공가(예비군)", group: "공가", days: null, deduct: null },
  { key: "official_civil", label: "공가(민방위)", group: "공가", days: null, deduct: null },
  { key: "official_checkup", label: "공가(건강검진)", group: "공가", days: 1, deduct: null },
  { key: "sick_paid", label: "병가(유급)", group: "병가", days: null, deduct: null },
  { key: "sick_injury", label: "병가(산재요양)", group: "병가", days: null, deduct: null },
  { key: "etc", label: "기타", group: "기타", days: null, deduct: null },
];

/**
 * 카탈로그에서 휴가 종류 조회(순수) — key 또는 구버전 label 문자열 모두 매칭.
 * 카탈로그가 비어 있으면(DB 미적용 등) DEFAULT 로 폴백한다.
 */
export function findInCatalog(catalog: LeaveTypeItem[], value: unknown): LeaveTypeItem | null {
  const v = String(value ?? "").trim();
  if (!v) return null;
  const list: Pick<LeaveTypeItem, "key" | "label" | "days" | "deduct" | "group">[] = catalog.length ? catalog : (DEFAULT_LEAVE_TYPES as LeaveTypeItem[]);
  const hit =
    list.find((x) => x.key === v) ??
    list.find((x) => x.label === v) ??
    (v === "반차" ? list.find((x) => x.key === "half_am") : undefined);
  if (!hit) return null;
  return {
    key: hit.key,
    label: hit.label,
    group: hit.group,
    days: hit.days,
    deduct: hit.deduct,
    sortOrder: 0,
    active: true,
  };
}

