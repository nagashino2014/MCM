-- 087_intel_feedback_note.sql
-- 삭제 사유의 상세 이유(자유 텍스트) — 사유 코드만으로는 분류기에 잘못된 신호를 줄 수 있어 보강.
-- 예: 풍력발전 기사를 '무관한 업종'으로 삭제할 때 "풍력발전이라 제외(발전 업종 자체는 대상)"를
--     남기면, few-shot 주입 시 "발전 업종 전체 배제"로 과일반화되는 것을 막는다.
-- 086 위에 적용. 멱등.
ALTER TABLE intel_signal_feedback ADD COLUMN IF NOT EXISTS detail_note text;
