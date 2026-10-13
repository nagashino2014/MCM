-- 272: 채용공고 태그 탐색·요약(2026-10-13 사용자 요청)
--   목록을 채용사이트·게재연도·신입/경력 태그로 고르고 우측에 요약·미리보기를 보이는 화면으로 바꾸면서
--   요약의 "근무지역(본사/울산)"과 "채용사이트 바로 열기"에 쓸 두 칸을 더한다.
--   근무지역은 공고부문("통합허가(울산)")의 괄호에서 파생하던 값을 독립 칸으로 — 화관법·ESG 처럼 괄호가 없는 부문도 지역을 갖게.
--   공고 주소는 채용사이트에 올린 뒤의 공고 URL(http/https) — 비어 있으면 플랫폼 첫 화면으로 연다. 멱등.

ALTER TABLE recruit_postings ADD COLUMN IF NOT EXISTS work_location text;  -- 근무지역(본사/울산 …, 자유 입력)
ALTER TABLE recruit_postings ADD COLUMN IF NOT EXISTS posting_url   text;  -- 채용사이트 공고 주소(http/https)
