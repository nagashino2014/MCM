// 홈 화면 위젯 카탈로그(HC-B) — 서버/클라이언트 공용 순수 데이터.
// 고정 영역(KPI 4종·결재 대기·안읽은 메일·캘린더)은 배치/숨김 대상이 아니라 여기에 없다.
// permission 이 null 이면 로그인만으로 열람 가능(각 API 가 requireSession).

export interface HomeWidgetDef {
  key: string;
  label: string;
  /** 필요한 권한 키. null = 세션만 필요. */
  permission: string | null;
  /** 기본 배치 — 12열 그리드 기준 폭(w)과 행 높이 배수(h). */
  defaultW: number;
  defaultH: number;
}

/** 홈 그리드 열 수. 고정 영역(결재·메일·캘린더)과 사용자 배치 영역이 **같은 열 체계**를 쓴다.
 *  24열이라 좌 14 / 우 10 으로 나누면 고정 영역과 배치 카드의 좌우 경계가 정확히 맞물리고,
 *  12열 대비 스냅 간격이 절반이라 폭을 더 잘게 조절할 수 있다. */
export const HOME_COLS = 24;
/** 고정 영역 좌(날씨·연차) / 중(결재·메일) 열 배분 — 우(캘린더)는 나머지 10. 배치 영역에서 폭을 맞출 때 기준. */
export const HOME_FIXED_LEFT_COLS = 7;
/** 카드 최소 폭(열). */
export const HOME_MIN_W = 6;

export const HOME_WIDGETS: HomeWidgetDef[] = [
  { key: "leaveNotice", label: "수신 문서", permission: null, defaultW: 24, defaultH: 1 },
  { key: "pendingProgress", label: "경과 미입력", permission: "sales.view", defaultW: 14, defaultH: 1 },
  { key: "upcomingBids", label: "투찰 마감 임박", permission: "sales.view", defaultW: 10, defaultH: 1 },
  { key: "workPlan", label: "업무보고 할 일", permission: null, defaultW: 8, defaultH: 1 },
  { key: "invoiceRequest", label: "세금계산서 발행 요청", permission: null, defaultW: 8, defaultH: 1 },
  { key: "invoiceInbox", label: "발행 요청 수신함", permission: "billing.receivable.manage", defaultW: 8, defaultH: 1 },
  { key: "billingSummary", label: "수금/발행 요약", permission: "billing.view", defaultW: 8, defaultH: 1 },
  { key: "myServices", label: "내 참여 용역 진행", permission: null, defaultW: 8, defaultH: 1 },
  // 목록이 긴 카드는 기본 2행 — 사용자가 편집 모드에서 다시 조절할 수 있다.
  { key: "intel", label: "인텔 신호 하이라이트", permission: "sales.view", defaultW: 8, defaultH: 2 },
  { key: "quickFacilities", label: "임시 등록 사업장 완성", permission: "facility.view", defaultW: 8, defaultH: 2 },
  // 데이터 지표(SW-P3 이월분) — 표시할 지표는 카드에서 선택(공개범위는 analytics API 가 필터).
  { key: "metrics", label: "데이터 지표", permission: "approval.view", defaultW: 8, defaultH: 2 },
  // 본인 반기별 성과급(BS-P3) — API 가 본인 것만 반환.
  { key: "bonusMe", label: "내 성과급 지급내역", permission: null, defaultW: 8, defaultH: 1 },
];

export const HOME_WIDGET_KEYS = HOME_WIDGETS.map((w) => w.key);

/** 캘린더 태그 — 'vehicle' 은 출장신청서 상신 건·직접 예약(자산 이용 현황, G6-C)에서 온다. */
export const CALENDAR_TAGS = [
  { key: "self", label: "본인" },
  { key: "sales", label: "영업" },
  { key: "dept", label: "부서" },
  { key: "refs", label: "선택" },
  { key: "vehicle", label: "차량" },
] as const;

export type CalendarTagKey = (typeof CALENDAR_TAGS)[number]["key"];

/** 카드 1칸(h=1) 픽셀 높이 — 편집 모드 리사이즈의 스냅 단위. */
export const HOME_ROW_H = 220;

/** 고정 영역 높이 — 캘린더는 항상 6주 격자(셀에 일정 태그 2건) + 오늘 일정 3건 기준으로 일정하다.
 *  결재 대기·안읽은 메일은 캘린더 높이를 정확히 절반씩 나눠 가진다(사이 간격 16px). */
export const HOME_CALENDAR_H = 712;
export const HOME_HALF_H = (HOME_CALENDAR_H - 16) / 2;
/** '오늘 일정' 타임라인 표시 건수 — 초과분은 "외 N건"으로 접는다(높이 고정). */
export const HOME_TODAY_LIMIT = 3;

export interface HomeLayoutItem {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HomeLayout {
  /** 숨긴 위젯 키 목록. */
  hidden: string[];
  /** 위젯별 배치. 없으면 기본 배치로 흐른다. */
  items: Record<string, HomeLayoutItem>;
  /** 저장 당시의 열 수 — 열 체계가 바뀌어도 옛 배치를 환산해 살린다(없으면 12열 시절). */
  cols?: number;
  /** 위젯별 부가 설정(HC-B 서버 저장 — 기기와 무관). 현재 metrics.metricKey 만 쓴다. */
  widgetConfig?: { metrics?: { metricKey?: string } };
}

export const EMPTY_HOME_LAYOUT: HomeLayout = { hidden: [], items: {}, cols: HOME_COLS };

/** 저장값 정규화 — 알 수 없는 키/범위 밖 값은 버리고, 옛 열 체계는 현재 열 수로 환산한다. */
export function normalizeLayout(raw: unknown): HomeLayout {
  const src = (raw ?? {}) as Partial<HomeLayout>;
  const hidden = Array.isArray(src.hidden)
    ? src.hidden.filter((k): k is string => typeof k === "string" && HOME_WIDGET_KEYS.includes(k))
    : [];
  // cols 가 없던 시절 저장분은 12열 기준이므로 배율로 환산한다.
  const savedCols = Number(src.cols) > 0 ? Number(src.cols) : 12;
  const scale = HOME_COLS / savedCols;

  const items: Record<string, HomeLayoutItem> = {};
  if (src.items && typeof src.items === "object") {
    for (const [key, v] of Object.entries(src.items)) {
      if (!HOME_WIDGET_KEYS.includes(key) || !v || typeof v !== "object") continue;
      const it = v as Partial<HomeLayoutItem>;
      const w = Math.min(HOME_COLS, Math.max(HOME_MIN_W, Math.round((Number(it.w) || 8) * scale)));
      const x = Math.min(HOME_COLS - w, Math.max(0, Math.round((Number(it.x) || 0) * scale)));
      items[key] = {
        x,
        w,
        y: Math.max(0, Number(it.y) || 0),
        h: Math.min(4, Math.max(1, Number(it.h) || 1)),
      };
    }
  }
  // 위젯 부가 설정 — 알려진 키만 통과(자유 JSON 적재 방지)
  const cfgSrc = (src.widgetConfig ?? {}) as { metrics?: { metricKey?: unknown } };
  const metricKey = typeof cfgSrc.metrics?.metricKey === "string" ? cfgSrc.metrics.metricKey : undefined;
  const widgetConfig = metricKey ? { metrics: { metricKey } } : undefined;

  return { hidden, items, cols: HOME_COLS, ...(widgetConfig ? { widgetConfig } : {}) };
}
