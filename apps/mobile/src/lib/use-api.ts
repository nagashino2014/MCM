import { useCallback, useEffect, useState } from 'react';

import { apiJson } from './api';

/**
 * GET API 데이터 훅. path 가 바뀌면 자동 재요청(검색어·월 등 동적 path 지원).
 * reload() 는 당겨서 새로고침(refreshing 플래그)용.
 */
export function useApi<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const d = await apiJson<T>(path);
        setData(d);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [path]
  );

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, refreshing, error, reload: () => load(true) };
}
