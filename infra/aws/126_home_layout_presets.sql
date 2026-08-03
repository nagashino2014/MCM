-- 126: 홈 위젯 배치 프리셋 — 사용자별 3개 슬롯에 배치(표시 카드+위치·크기)를 저장해 두고
-- 필요할 때 바로 전환한다(설정을 매번 다시 만들지 않게 — 사용자 요청 2026-08-02).
-- presets = {"1": HomeLayout, "2": ..., "3": ...} (빈 슬롯은 키 없음). 멱등.

ALTER TABLE home_layouts ADD COLUMN IF NOT EXISTS presets jsonb NOT NULL DEFAULT '{}'::jsonb;
