import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Animated, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/theme/useTheme";

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

const TONE_BG: Record<ToastTone, string> = {
  info: "bg-cd-primary-soft",
  success: "bg-cd-success-soft",
  error: "bg-cd-error-soft",
};

const TONE_FG: Record<ToastTone, string> = {
  info: "text-cd-primary",
  success: "text-cd-success",
  error: "text-cd-error",
};

/** 전역 토스트 — 짧은 결과 알림. 웹 CdToastProvider 대응. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<{ text: string; tone: ToastTone } | null>(null);
  const { c } = useTheme();
  // 아이콘 색 — 글자 토큰(TONE_FG)과 같은 테마값. 다크 보정(2026-10-18)
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
          style={{ opacity }}
          className="absolute inset-x-4 bottom-24 z-50">
          <View
            className={`flex-row items-center gap-2 rounded-2xl border border-cd-border px-4 py-3 ${TONE_BG[msg.tone]}`}>
            <Ionicons name={TONE_ICON[msg.tone]} size={18} color={toneHex[msg.tone]} />
            <Text className={`flex-1 text-[13px] font-bold ${TONE_FG[msg.tone]}`}>{msg.text}</Text>
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
