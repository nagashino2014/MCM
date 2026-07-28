import { forwardRef } from "react";
import { Pressable, Text, TextInput, type TextInputProps, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/theme/useTheme";

/** 라벨 + 입력. 입력류는 웹 `cd-fields-white` 규칙대로 카드색 배경 + 윤곽선. */
export const Input = forwardRef<TextInput, TextInputProps & { label?: string; error?: string }>(
  function Input({ label, error, className, ...props }, ref) {
    const { c } = useTheme();
    return (
      <View className="gap-1.5">
        {label ? <Text className="text-[13px] font-bold text-cd-muted">{label}</Text> : null}
        <TextInput
          ref={ref}
          placeholderTextColor={c.faint}
          className={[
            "min-h-[46px] rounded-xl border bg-cd-card px-3.5 py-3 text-[15px] text-cd-text",
            error ? "border-cd-error" : "border-cd-border",
            className ?? "",
          ].join(" ")}
          {...props}
        />
        {error ? <Text className="text-[12px] text-cd-error">{error}</Text> : null}
      </View>
    );
  }
);

/** 여러 줄 입력(본문 작성 — 평문 + 최소 서식 원칙, 블루프린트 §9.1). */
export function Textarea({
  label,
  minHeight = 160,
  className,
  ...props
}: TextInputProps & { label?: string; minHeight?: number }) {
  const { c } = useTheme();
  return (
    <View className="gap-1.5">
      {label ? <Text className="text-[13px] font-bold text-cd-muted">{label}</Text> : null}
      <TextInput
        multiline
        textAlignVertical="top"
        placeholderTextColor={c.faint}
        style={{ minHeight }}
        className={[
          "rounded-xl border border-cd-border bg-cd-card px-3.5 py-3 text-[15px] leading-6 text-cd-text",
          className ?? "",
        ].join(" ")}
        {...props}
      />
    </View>
  );
}

/** 검색 바 — 목록 화면 상단 공통. */
export function SearchBar({
  value,
  onChangeText,
  placeholder = "검색",
  onSubmit,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
}) {
  const { c } = useTheme();
  return (
    <View className="flex-row items-center gap-2 rounded-xl border border-cd-border bg-cd-card px-3">
      <Ionicons name="search" size={18} color={c.faint} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        placeholder={placeholder}
        placeholderTextColor={c.faint}
        returnKeyType="search"
        className="min-h-[44px] flex-1 text-[15px] text-cd-text"
      />
      {value.length > 0 ? (
        <Pressable onPress={() => onChangeText("")} hitSlop={8}>
          <Ionicons name="close-circle" size={18} color={c.faint} />
        </Pressable>
      ) : null}
    </View>
  );
}
