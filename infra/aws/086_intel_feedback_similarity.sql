-- 086_intel_feedback_similarity.sql
-- '중복 기사' 사유 삭제 시 해당 신호와 가장 유사한 생존 신호의 코사인 유사도를 기록 —
-- 뉴스 dedup 병합 임계(현재 0.90)를 데이터 기반으로 튜닝하기 위한 근거.
-- (신호 삭제 시 임베딩은 FK CASCADE 로 함께 지워지므로 삭제 전에 측정해 스냅샷으로 남긴다)
-- 085 위에 적용. 멱등.
ALTER TABLE intel_signal_feedback ADD COLUMN IF NOT EXISTS max_similarity real;
ALTER TABLE intel_signal_feedback ADD COLUMN IF NOT EXISTS similar_signal_id text;
