import { useCallback, useEffect, useRef, useState } from 'react';

import { apiJson } from './api';
import { kvGet, kvSet } from './kv';

/**
 * GET API 데이터 훅. path 가 바뀌면 자동 재요청(검색어·월 등 동적 path 지원).
 * reload() 는 당겨서 새로고침(refreshing 플래그)용.
 *
 * `cache: true` 를 주면 stale-while-revalidate 로 동작한다 —
 * 마지막 응답을 SQLite 에 저장했다가 화면 진입 즉시 렌더하고, 뒤에서 새로 받아 갈아끼운다.
 * 네트워크가 실패해도 캐시가 있으면 화면은 유지되고 `staleAt` 이 채워진다(오프라인 배너용).
 */
export function useApi<T>(path: string, opts?: { cache?: boolean; skip?: boolean }) {
  const useCache = !!opts?.cache;
  const skip = !!opts?.skip;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!skip);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 캐시를 보여주는 중이면 그 저장 시각(ms), 최신 응답을 받았으면 null. */
  const [staleAt, setStaleAt] = useState<number | null>(null);

  // path 가 바뀌었을 때 늦게 도착한 이전 응답이 새 데이터를 덮지 않도록 한다.
  const reqId = useRef(0);

  const load = useCallback(
    async (refresh = false) => {
      if (skip) {
        setLoading(false);
        return;
      }
      const id = ++reqId.current;
      if (refresh) setRefreshing(true);
      setError(null);

      if (useCache && !refresh) {
        const cached = await kvGet<T>(`api:${path}`);
        if (cached && reqId.current === id) {
          setData(cached.value);
          setStaleAt(cached.at);
          setLoading(false);
        }
      }

      try {
        const d = await apiJson<T>(path);
        if (reqId.current !== id) return;
        setData(d);
        setStaleAt(null);
        if (useCache) void kvSet(`api:${path}`, d);
      } catch (e) {
        if (reqId.current !== id) return;
        setError((e as Error).message);
      } finally {
        if (reqId.current === id) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [path, useCache, skip]
  );

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, refreshing, error, staleAt, reload: () => load(true) };
}

/**
 * 무한 스크롤 목록 훅. API 마다 페이징 파라미터가 달라 path 를 함수로 받는다.
 *   useInfiniteApi(off => `/api/mail/messages?folder=inbox&limit=30&offset=${off}`, r => r.messages)
 */
export function useInfiniteApi<TItem, TRes>(
  makePath: (offset: number) => string,
  select: (res: TRes) => TItem[],
  pageSize = 30
) {
  const [items, setItems] = useState<TItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [end, setEnd] = useState(false);

  // makePath/select 는 화면에서 인라인 함수로 넘기는 경우가 많아 참조가 매번 바뀐다.
  // 실제 의존은 "첫 페이지 경로"뿐이므로 그것만 의존성으로 쓰고, 함수는 ref 로 최신값을 본다.
  const firstPath = makePath(0);
  const fns = useRef({ makePath, select });
  fns.current = { makePath, select };
  const reqId = useRef(0);

  const loadFirst = useCallback(
    async (refresh = false) => {
      const id = ++reqId.current;
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      setEnd(false);
      try {
        const res = await apiJson<TRes>(fns.current.makePath(0));
        if (reqId.current !== id) return;
        const list = fns.current.select(res);
        setItems(list);
        setEnd(list.length < pageSize);
      } catch (e) {
        if (reqId.current === id) setError((e as Error).message);
      } finally {
        if (reqId.current === id) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [firstPath, pageSize] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || end) return;
    setLoadingMore(true);
    try {
      const res = await apiJson<TRes>(fns.current.makePath(items.length));
      const list = fns.current.select(res);
      setItems((prev) => [...prev, ...list]);
      if (list.length < pageSize) setEnd(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }, [loading, loadingMore, end, items.length, pageSize]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  return {
    items,
    setItems,
    loading,
    loadingMore,
    refreshing,
    error,
    end,
    reload: () => loadFirst(true),
    loadMore,
  };
}
