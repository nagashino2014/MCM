import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshControl, type RefreshControlProps } from "react-native";

/**
 * 당겨서 새로고침 — 사용자가 **직접 당겼을 때만** 스피너를 보인다(RefreshControl 대체).
 *
 * 화면 진입 시 useFocusEffect 가 reload() 를 부르면 refreshing 이 프로그램적으로 켜졌다 꺼지는데,
 * iOS 에서는 화면 전환 중(레이아웃 전)에 이 토글이 일어나면 UIRefreshControl 이 endRefreshing 을
 * 놓쳐 상단 스피너가 그대로 남고, 화면을 끌어야 사라진다(2026-10-19 사용자 리포트 — 메일 등 다수 메뉴).
 * 배경 재조회는 스피너 없이 조용히 돌게 하고, 당김 → 완료까지만 refreshing 을 그대로 전달한다.
 *
 * ScrollView 가 iOS 에선 자식으로, Android 에선 cloneElement 로 감싸 쓰므로 나머지 props(children·style)를
 * RefreshControl 에 그대로 넘긴다.
 */
export function PullRefresh({ refreshing, onRefresh, ...rest }: RefreshControlProps) {
  const [pulled, setPulled] = useState(false);
  const wasRefreshing = useRef(false);

  // 당긴 뒤 refreshing 이 true → false 로 끝나면 당김 상태를 푼다(Promise 를 돌려주지 않는 핸들러 대비).
  useEffect(() => {
    if (wasRefreshing.current && !refreshing) setPulled(false);
    wasRefreshing.current = !!refreshing;
  }, [refreshing]);

  const handleRefresh = useCallback(() => {
    setPulled(true);
    const r = (onRefresh as (() => unknown) | undefined)?.();
    if (r && typeof (r as Promise<unknown>).finally === "function") {
      void (r as Promise<unknown>).finally(() => setPulled(false));
    }
  }, [onRefresh]);

  return <RefreshControl {...rest} refreshing={pulled && !!refreshing} onRefresh={handleRefresh} />;
}
