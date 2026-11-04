import { Pressable, Text, View } from "react-native";

import { useTheme } from "@/theme/useTheme";

type Tone = "neutral" | "primary" | "success" | "warning" | "error" | "secondary";

const TONE_SOFT: Record<Tone, string> = {
  neutral: "bg-cd-surface",
  primary: "bg-cd-primary-soft",
  success: "bg-cd-success-soft",
  warning: "bg-cd-warning-soft",
  error: "bg-cd-error-soft",
  secondary: "bg-cd-secondary-soft",
};

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-cd-muted",
  primary: "text-cd-primary-strong",
  success: "text-cd-success",
  warning: "text-cd-warning",
  error: "text-cd-error",
  secondary: "text-cd-secondary",
};

/**
 * 상태 필(StatusPill) — 높이 20, pill, 글자 12/500, soft 바탕 + 상태색 글자. 테두리·점·아이콘 없음.
 * 한 행에 하나만. 글자는 상태명 한 단어("승인"·"반려"·"긴급").
 */
export function Badge({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  return (
    <View className={`h-5 justify-center rounded-full px-2 ${TONE_SOFT[tone]}`}>
      <Text className={`text-[12px] font-medium ${TONE_TEXT[tone]}`}>{label}</Text>
    </View>
  );
}

/**
 * 숫자 배지(Count) — surface-sunken 바탕 + ink-muted 글자. 빨강(error 채움 + 흰 글자)은 "미처리·내가 해야 할 것"에만.
 * 0 이면 렌더하지 않는다.
 */
export function Count({ value, tone = "neutral" }: { value?: number | null; tone?: Tone }) {
  if (!value) return null;
  const danger = tone === "error";
  return (
    <View className={`h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 ${danger ? "bg-cd-error" : "bg-cd-surface"}`}>
      <Text style={{ fontVariant: ["tabular-nums"] }} className={`text-[12px] font-medium ${danger ? "text-cd-on-error" : "text-cd-muted"}`}>
        {value > 99 ? "99+" : value}
      </Text>
    </View>
  );
}

/**
 * 필터 필(Tabs pill) — 같은 목록을 **좁히는** 컨트롤. 반경 10, `md` 높이 32·글자 13 / `sm` 높이 28·글자 11(한 줄에 7~8개를 놓는 줄).
 *
 * 선택 상태(2026-11-04 사용자 결정): 색 점이 없는 필은 **옅은 회색 바탕(pillSelected) + 글자 굵게(600)**, 글자색은 그대로 —
 * 남색 틴트는 그라데이션 바탕과 구분되지 않았다. `tint` 를 준 필(분류색)은 그 색의 연한 바탕 + 컬러 글자.
 * 비선택 = 카드 바탕 + 테두리 + ink-muted 400. `dot` 은 왼쪽 색 점(캘린더 태그·용역 분류처럼 색으로 구분되는 축).
 */
export function FilterPill({
  label,
  active,
  onPress,
  dot,
  tint,
  disabled,
  count,
  grow,
  icon,
  size = "md",
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  /** 왼쪽 색 점(없으면 점 없음). */
  dot?: string;
  /** 선택 상태 바탕·글자색(분류색). 없으면 회색 선택. */
  tint?: { bg: string; text: string };
  disabled?: boolean;
  count?: number | null;
  /** 균등 폭 행(flex-1)에서 쓸 때 — 글자를 가운데 둔다. */
  grow?: boolean;
  /** 글자 앞 작은 아이콘 슬롯(꺼진 알림 조건의 종 등). */
  icon?: React.ReactNode;
  size?: "md" | "sm";
}) {
  const { c } = useTheme();
  const on = !!active && !disabled;
  const sm = size === "sm";
  const bg = on ? (tint?.bg ?? c.pillSelected) : c.card;
  const fg = disabled ? c.faint : on ? (tint?.text ?? c.text) : c.muted;
  const weight = on ? (tint ? "font-medium" : "font-semibold") : "font-normal";
  const px = grow ? (sm ? 2 : 8) : sm ? 7 : 12;
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: on, disabled: !!disabled }}
      style={{
        backgroundColor: bg,
        // 분류색 필(tint)은 늘 그 글자색의 얇은 테두리(11-04 사용자 요청); 회색 선택은 바탕과 같은 색, 비선택은 hairline.
        borderColor: tint && !disabled ? tint.text : on ? bg : c.border,
        borderWidth: 1,
        height: sm ? 28 : 32,
        paddingHorizontal: px,
        minWidth: 0,
      }}
      className={`flex-row items-center rounded-lg active:opacity-80 ${sm ? "gap-1" : "gap-1.5"} ${grow ? "flex-1 justify-center" : ""}`}>
      {dot ? <View style={{ backgroundColor: disabled ? c.faint : dot, width: sm ? 5 : 6, height: sm ? 5 : 6, borderRadius: 3 }} /> : null}
      {icon}
      <Text numberOfLines={1} style={{ color: fg }} className={`${sm ? "text-[11px]" : "text-[13px]"} ${weight} ${grow ? "shrink" : ""}`}>
        {label}
      </Text>
      {count ? (
        <Text style={{ color: fg, fontVariant: ["tabular-nums"] }} className={sm ? "text-[11px]" : "text-[12px]"}>
          {count}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** 선택 가능한 칩 — FilterPill 의 호환 이름(옛 호출처). */
export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  return <FilterPill label={label} active={active} onPress={onPress} />;
}
