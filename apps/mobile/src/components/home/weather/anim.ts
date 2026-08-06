/**
 * 씬 애니메이션 프리미티브 — 웹 `weather-widget.css` 의 keyframes 를 Reanimated 로 옮긴 것.
 *
 * CSS 는 요소마다 `animation-duration`/`animation-delay` 를 따로 줬지만, RN 에서 요소당
 * SharedValue 를 만들면 파티클 수십 개에 그만큼의 타이머가 붙는다. 그래서 여기서는
 * **주기별로 루프 하나**를 만들고, 각 요소는 위상 오프셋(0~1)만 달리해서 같은 루프를 공유한다.
 *   - useLinearLoop: 0→1 선형 반복(낙하·가로 이동·회전)
 *   - usePingPong:   0→1→0 왕복(ease-in-out — 흔들림·펄스·반짝임)
 */
import { useEffect } from "react";
import {
  Easing,
  cancelAnimation,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

export function useLinearLoop(durationMs: number, delayMs = 0): SharedValue<number> {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = 0;
    v.value = withDelay(
      delayMs,
      withRepeat(withTiming(1, { duration: durationMs, easing: Easing.linear }), -1, false)
    );
    return () => cancelAnimation(v);
  }, [durationMs, delayMs, v]);
  return v;
}

export function usePingPong(durationMs: number, delayMs = 0): SharedValue<number> {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = 0;
    // CSS 의 `0%,100% A / 50% B` 는 왕복 1회에 duration 이 걸린다 → 편도는 절반.
    v.value = withDelay(
      delayMs,
      withRepeat(withTiming(1, { duration: durationMs / 2, easing: Easing.inOut(Easing.sin) }), -1, true)
    );
    return () => cancelAnimation(v);
  }, [durationMs, delayMs, v]);
  return v;
}

/** 루프 진행도 + 위상 오프셋 → 0~1 (worklet). */
export function phase(p: number, offset: number): number {
  "worklet";
  const t = p + offset;
  return t - Math.floor(t);
}
