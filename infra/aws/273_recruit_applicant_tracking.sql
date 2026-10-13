-- 273: 채용공고 지원 현황 수동 기록(2026-10-13 사용자 결정)
--   사람인·잡코리아는 지원자 API 를 제공하지 않고 자동 수집은 약관·개인정보 위험이 있어, 지원자 수와 면접 예정자는
--   담당자가 손으로 적는다. 일자별 추이를 보려고 기록을 덮어쓰지 않고 입력일별로 남긴다.
--   - recruit_applicant_counts: 날짜별 누적 지원자 수(같은 날 다시 적으면 그날 값만 갱신, 이전 날짜는 보존)
--   - recruit_interviews: 면접 예정자(성명·연락처·이메일·이력서 보관처·면접일시·상태). 개인정보라 채용이 끝나면
--     담당자가 삭제한다(화면에 안내). 입력 시각·입력자를 남긴다. 멱등.

CREATE TABLE IF NOT EXISTS recruit_applicant_counts (
  posting_id  text    NOT NULL REFERENCES recruit_postings(posting_id) ON DELETE CASCADE,
  counted_on  text    NOT NULL,                 -- 기준일 YYYY-MM-DD
  count       integer NOT NULL CHECK (count >= 0), -- 그날까지의 누적 지원자 수
  memo        text,
  created_at  text    NOT NULL,
  created_by  text,
  updated_at  text    NOT NULL,
  updated_by  text,
  PRIMARY KEY (posting_id, counted_on)
);

CREATE TABLE IF NOT EXISTS recruit_interviews (
  interview_id text PRIMARY KEY,
  posting_id   text NOT NULL REFERENCES recruit_postings(posting_id) ON DELETE CASCADE,
  name         text NOT NULL,
  phone        text,
  email        text,
  resume_note  text,                            -- 이력서 보관 위치·메모(파일은 저장하지 않는다)
  interview_at text,                            -- 면접 일시 "YYYY-MM-DD HH:MM" (미정이면 NULL)
  status       text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'done', 'cancelled')),
  memo         text,
  created_at   text NOT NULL,
  created_by   text,
  updated_at   text NOT NULL,
  updated_by   text
);
CREATE INDEX IF NOT EXISTS idx_recruit_interviews_posting ON recruit_interviews(posting_id, interview_at);
