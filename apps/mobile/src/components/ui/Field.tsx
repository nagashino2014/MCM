import { forwardRef } from "react";
import { Pressable, Text, TextInput, type TextInputProps, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/theme/useTheme";

/**
 * 폼 필드(Field) — 레이블은 입력 위 12/500 ink-muted, 입력과 8px. 입력은 카드 면 + border-strong 1px + 반경 10,
 * 높이 44(터치 하한), 가로 패딩 12, 글자 15 ink, placeholder ink-muted. 오류는 테두리 danger + 아래 12 danger 문장.
 */
export const Input = forwardRef<TextInput, TextInputProps & { label?: string; error?: string; hint?: string }>(
  function Input({ label, error, hint, className, style, ...props }, ref) {
    const { c } = useTheme();
    return (
      <View className="gap-2">
        {label ? <Text className="text-[12px] font-medium text-cd-muted">{label}</Text> : null}
        <TextInput
          ref={ref}
          placeholderTextColor={c.muted}
          style={[{ borderColor: error ? c.error : c.borderStrong }, style]}
          className={["h-11 rounded-lg border bg-cd-card px-3 text-[15px] text-cd-text", className ?? ""].join(" ")}
          {...props}
        />
        {error ? (
          <Text className="text-[12px] text-cd-error">{error}</Text>
        ) : hint ? (
          <Text className="text-[12px] text-cd-muted">{hint}</Text>
        ) : null}
      </View>
    );
  }
);

/** 여러 줄 입력(본문 작성 — 평문 + 최소 서식 원칙, 블루프린트 §9.1). */
export function Textarea({
  label,
  minHeight = 160,
  className,
  style,
  ...props
}: TextInputProps & { label?: string; minHeight?: number }) {
  const { c } = useTheme();
  return (
    <View className="gap-2">
      {label ? <Text className="text-[12px] font-medium text-cd-muted">{label}</Text> : null}
      <TextInput
        multiline
        textAlignVertical="top"
        placeholderTextColor={c.muted}
        style={[{ minHeight, borderColor: c.borderStrong }, style]}
        className={["rounded-lg border bg-cd-card px-3 py-3 text-[15px] leading-[22px] text-cd-text", className ?? ""].join(" ")}
        {...props}
      />
    </View>
  );
}

/** 검색 바 — 목록 화면 상단 공통. 입력과 같은 규격(44 · 반경 10 · border-strong). */
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
    <View style={{ borderColor: c.borderStrong }} className="h-11 flex-row items-center gap-2 rounded-lg border bg-cd-card px-3">
      <Ionicons name="search" size={18} color={c.muted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        placeholder={placeholder}
        placeholderTextColor={c.muted}
        returnKeyType="search"
        accessibilityLabel={placeholder}
        className="h-11 flex-1 text-[15px] text-cd-text"
      />
      {value.length > 0 ? (
        <Pressable onPress={() => onChangeText("")} hitSlop={8} accessibilityRole="button" accessibilityLabel="지우기">
          <Ionicons name="close-circle" size={18} color={c.faint} />
        </Pressable>
      ) : null}
    </View>
  );
}
