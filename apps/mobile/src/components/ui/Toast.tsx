import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Animated, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/theme/useTheme";
import { SHADOW_POPOVER } from "@/theme/tokens";

type ToastTone = "info" | "success" | "error";

interface ToastState {
  show: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastState | null>(null);

const TONE_ICON: Record<ToastTone, keyof typeof Ionicons.glyphMap> = {
  info: "information-circle",
  success: "checkmark-circle",
  error: "alert-circle",
};

/** 전역 토스트 — 짧은 결과 알림. 떠 있는 면이므로 카드 면 + 테두리 + popover 그림자, 아이콘만 상태색. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<{ text: string; tone: ToastTone } | null>(null);
  const { c, dark } = useTheme();
  const toneHex: Record<ToastTone, string> = { info: c.primary, success: c.success, error: c.error };
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (text: string, tone: ToastTone = "info") => {
      if (timer.current) clearTimeout(timer.current);
      setMsg({ text, tone });
      Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
      timer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(
          () => setMsg(null)
        );
      }, 2600);
    },
    [opacity]
  );

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {msg ? (
        <Animated.View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          style={{ opacity }}
          className="absolute inset-x-4 bottom-24 z-50">
          <View
            style={[{ borderColor: c.cardBorder }, dark ? SHADOW_POPOVER.dark : SHADOW_POPOVER.light]}
            className="flex-row items-center gap-2 rounded-lg border bg-cd-card px-4 py-3">
            <Ionicons name={TONE_ICON[msg.tone]} size={18} color={toneHex[msg.tone]} />
            <Text className="flex-1 text-[14px] font-medium text-cd-text">{msg.text}</Text>
          </View>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastState {
  const ctx = useContext(ToastContext);
  // Provider 밖에서도 터지지 않도록(개발 편의) 무해한 폴백을 준다.
  return ctx ?? { show: () => {} };
}
