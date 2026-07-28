-- 104_mail_signature_subject_prefix.sql
-- 메일 서명에 "제목 접두어(사명 표시)" 추가 — [한국환경안전연구원], [에코씨앤엠] 처럼
-- 서명 서식별로 제목 앞에 붙일 사명을 함께 저장한다(서명 선택 시 제목에 자동 반영).
-- 설계: docs/company-email-blueprint.md §4. 멱등.

ALTER TABLE mail_signatures ADD COLUMN IF NOT EXISTS subject_prefix text;
