"use client";

// 작성 화면 자동 저장(2026-10-01 사용자 요청) — 공문·견적서·계약서·착수계/준공계 공용.
// 5분마다 입력 요소가 마지막 저장 이후 바뀌었을 때만 save() 를 부르고, 변화가 없으면 건너뛴다.
// 저장 대상은 getSnapshot() 이 돌려주는 직렬화 문자열로 비교한다(contentEditable 본문처럼 state 가
// 아닌 값도 호출 시점에 읽히도록 문자열이 아니라 함수로 받는다).

import { useCallback, useEffect, useRef, useState } from "react";

export const AUTOSAVE_INTERVAL_MS = 5 * 60 * 1000;

export function useAutosave(opts: {
  /** 재편집 로드가 끝나고 저장 가능한 상태(로드 중·저장 중이면 false). true 가 된 첫 시점의 스냅샷이 기준선 */
  ready: boolean;
  /** 입력된 요소가 있는지 — 빈 화면은 저장하지 않는다 */
  hasContent: () => boolean;
  getSnapshot: () => string;
  save: () => Promise<unknown>;
  intervalMs?: number;
}) {
  const { ready, hasContent, getSnapshot, save, intervalMs = AUTOSAVE_INTERVAL_MS } = opts;
  const latest = useRef({ ready, hasContent, getSnapshot, save });
  latest.current = { ready, hasContent, getSnapshot, save };
  const baseline = useRef<string | null>(null);
  const saving = useRef(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  // 기준선 — 로드 완료 직후 상태. 이 뒤로 바뀐 것만 '변화'로 본다(로드 직후 불필요한 저장 방지)
  useEffect(() => {
    if (ready && baseline.current == null) baseline.current = getSnapshot();
  }, [ready, getSnapshot]);

  /** 수동 저장 성공 뒤 호출 — 현재 상태를 기준선으로 */
  const markSaved = useCallback(() => {
    baseline.current = latest.current.getSnapshot();
    setLastSavedAt(new Date());
    setLastError(null);
  }, []);

  useEffect(() => {
    const timer = setInterval(async () => {
      const cur = latest.current;
      if (!cur.ready || saving.current || !cur.hasContent()) return;
      const snap = cur.getSnapshot();
      if (baseline.current === snap) return;
      saving.current = true;
      try {
        await cur.save();
        baseline.current = snap;
        setLastSavedAt(new Date());
        setLastError(null);
      } catch (err) {
        setLastError((err as Error)?.message ?? String(err));
      } finally {
        saving.current = false;
      }
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return { lastSavedAt, lastError, markSaved };
}

/** 저장 버튼 옆 상태 문구 — 마지막 저장 시각 또는 자동 저장 실패 사유 */
export function AutosaveStatus({ lastSavedAt, lastError }: { lastSavedAt: Date | null; lastError: string | null }) {
  if (lastError) {
    return (
      <span className="text-[10.5px] whitespace-nowrap" style={{ color: "var(--cd-danger, #FA896B)" }} title={lastError}>
        자동 저장 실패
      </span>
    );
  }
  if (!lastSavedAt) return <span className="text-[10.5px] cd-text-faint whitespace-nowrap">5분마다 자동 저장</span>;
  const hh = String(lastSavedAt.getHours()).padStart(2, "0");
  const mm = String(lastSavedAt.getMinutes()).padStart(2, "0");
  return <span className="text-[10.5px] cd-text-faint whitespace-nowrap">마지막 저장 {hh}:{mm}</span>;
}
