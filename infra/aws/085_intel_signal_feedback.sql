-- 085_intel_signal_feedback.sql
-- 신호 개별 삭제 시 사유를 남기는 피드백 테이블(성장형 수집 로직의 학습 데이터).
-- 084 위에 적용. 멱등.
-- 용도: ①삭제 사유·신호 스냅샷 축적(오인 수집 패턴 분석) ②수집기 재수집 차단
--       ((source, external_id)가 여기 있으면 upsert 전에 skip — ON CONFLICT DO NOTHING 만으로는
--        삭제된 신호가 다음 수집 때 되살아나는 문제를 막을 수 없음).
CREATE TABLE IF NOT EXISTS intel_signal_feedback (
  feedback_id        text PRIMARY KEY,
  source             text NOT NULL,               -- intel_signals.source (커스텀 소스 포함)
  external_id        text NOT NULL,
  reason             text NOT NULL,               -- irrelevant_industry | mere_goal | duplicate | lacks_specifics
  -- 삭제 시점 신호 스냅샷(신호 본체는 삭제되므로 분석용으로 보존)
  company_name       text,
  report_name        text,
  signal_type        text,
  signal_grade       text,
  industry_relevance text,
  summary            text,
  url                text,
  deleted_by         text,
  created_at         text NOT NULL
);

-- 같은 신호 재삭제 시 사유 갱신(upsert 키) + 수집기 차단목록 조회 키
CREATE UNIQUE INDEX IF NOT EXISTS ux_intel_feedback_source_external
  ON intel_signal_feedback (source, external_id);
CREATE INDEX IF NOT EXISTS ix_intel_feedback_reason ON intel_signal_feedback (reason);

ALTER TABLE intel_signal_feedback DROP CONSTRAINT IF EXISTS intel_signal_feedback_reason_check;
ALTER TABLE intel_signal_feedback ADD CONSTRAINT intel_signal_feedback_reason_check
  CHECK (reason IN ('irrelevant_industry', 'mere_goal', 'duplicate', 'lacks_specifics'));
