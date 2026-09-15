-- 225: 채용공고 구분 메타 — 제목만으로는 공고를 구별하기 어려워(사용자 요청 2026-09-15)
--   공고부문(통합허가(본사)·통합허가(울산)·화관법·HAPs·ESG·기술진단 …), 공고 구분(신입·경력직),
--   공고 플랫폼(사람인·잡코리아 …), 공고기간(시작·종료, YYYY-MM-DD)을 공고에 기록한다.
--   목록에서 부문·구분·플랫폼으로 검색하고, 종료일이 지난 공고는 "만료" 로 표시한다.
--   값은 프리셋 + 자유 입력이라 text 로 둔다(코드 테이블 없음). 멱등.

ALTER TABLE recruit_postings ADD COLUMN IF NOT EXISTS division     text;  -- 공고부문
ALTER TABLE recruit_postings ADD COLUMN IF NOT EXISTS hire_type    text;  -- 공고 구분(신입/경력직/신입·경력)
ALTER TABLE recruit_postings ADD COLUMN IF NOT EXISTS platform     text;  -- 공고 플랫폼
ALTER TABLE recruit_postings ADD COLUMN IF NOT EXISTS period_start text;  -- 공고 시작일 YYYY-MM-DD
ALTER TABLE recruit_postings ADD COLUMN IF NOT EXISTS period_end   text;  -- 공고 종료일 YYYY-MM-DD (NULL = 상시/미정)

CREATE INDEX IF NOT EXISTS idx_recruit_postings_division ON recruit_postings(division)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_recruit_postings_hire     ON recruit_postings(hire_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_recruit_postings_platform ON recruit_postings(platform)  WHERE deleted_at IS NULL;
