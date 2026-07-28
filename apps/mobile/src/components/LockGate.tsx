import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Button } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { GRACE_MS, authenticate, canAuthenticate, isLockEnabled } from "@/lib/lock";
import { useTheme } from "@/theme/useTheme";

/**
 * 앱 잠금 게이트 — 로그인 상태에서 백그라운드로 나갔다가 유예시간을 넘겨 돌아오면
 * 생체/기기암호를 요구한다. 잠금 중에는 내용 위에 불투명 오버레이를 덮는다(내용 노출 차단).
 */
export function LockGate({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const { c } = useTheme();
  const [locked, setLocked] = useState(false);
  const [checking, setChecking] = useState(false);
  const bgAt = useRef<number | null>(null);

  const unlock = useCallback(async () => {
    setChecking(true);
    const ok = await authenticate();
    setChecking(false);
    if (ok) setLocked(false);
  }, []);

  useEffect(() => {
    if (status !== "authed") {
      setLocked(false);
      return;
    }
    const onChange = (s: AppStateStatus) => {
      if (s === "background" || s === "inactive") {
        // inactive 는 알림 센터·앱 전환기에서도 오므로 시각만 기록한다.
        if (bgAt.current === null) bgAt.current = Date.now();
        return;
      }
      if (s === "active") {
        const at = bgAt.current;
        bgAt.current = null;
        if (at === null || Date.now() - at < GRACE_MS) return;
        void (async () => {
          if ((await isLockEnabled()) && (await canAuthenticate())) setLocked(true);
        })();
      }
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [status]);

  // 잠금이 걸리면 즉시 인증을 띄운다(사용자가 버튼을 누르지 않아도 되게).
  useEffect(() => {
    if (locked) void unlock();
  }, [locked, unlock]);

  return (
    <View className="flex-1">
      {children}
      {locked ? (
        <View className="absolute inset-0 z-50 items-center justify-center gap-4 bg-cd-bg px-8">
          <Ionicons name="lock-closed" size={44} color={c.primary} />
          <Text className="text-[17px] font-extrabold text-cd-text">잠금 상태입니다</Text>
          <Text className="text-center text-[13px] leading-5 text-cd-faint">
            생체 인증 또는 기기 암호로 잠금을 해제해 주세요.
          </Text>
          <Button label="잠금 해제" icon="finger-print" onPress={unlock} loading={checking} />
        </View>
      ) : null}
    </View>
  );
}
