import { Pressable, Text, View } from "react-native";

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
  primary: "text-cd-primary",
  success: "text-cd-success",
  warning: "text-cd-warning",
  error: "text-cd-error",
  secondary: "text-cd-secondary",
};

/** 상태 배지(읽기 전용 라벨). 웹 cd-pill 대응. */
export function Badge({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  return (
    <View className={`rounded-full px-2 py-0.5 ${TONE_SOFT[tone]}`}>
      <Text className={`text-[11px] font-bold ${TONE_TEXT[tone]}`}>{label}</Text>
    </View>
  );
}

/** 카운트 뱃지(미결재·안읽음). 0 이면 렌더하지 않는다. */
export function Count({ value, tone = "primary" }: { value?: number | null; tone?: Tone }) {
  if (!value) return null;
  return (
    <View className={`min-w-[20px] items-center rounded-full px-1.5 py-0.5 ${TONE_SOFT[tone]}`}>
      <Text className={`text-[11px] font-extrabold ${TONE_TEXT[tone]}`}>
        {value > 99 ? "99+" : value}
      </Text>
    </View>
  );
}

/** 선택 가능한 칩(필터·탭). 웹 cd-chip[data-active] 대응. */
export function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={[
        "min-h-[36px] justify-center rounded-full border px-3.5 py-1.5 active:opacity-70",
        active ? "border-cd-primary bg-cd-primary-soft" : "border-cd-border bg-cd-card",
      ].join(" ")}>
      <Text
        className={`text-[13px] font-bold ${active ? "text-cd-primary" : "text-cd-muted"}`}>
        {label}
      </Text>
    </Pressable>
  );
}
