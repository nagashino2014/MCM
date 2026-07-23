-- 090: 연차촉진 고지 서면 통지 사후 등록(LP-P2.1).
-- 이미 서면으로 진행한 1차 고지에 대해, 받은 사용계획서 스캔본을 업로드하고
-- 인원별 제출 처리를 사후 등록할 수 있도록 leave_notices 를 확장한다. 관례: 멱등.

-- 서면 통지·사후 등록 여부(온라인 발송 = false).
ALTER TABLE leave_notices ADD COLUMN IF NOT EXISTS paper boolean NOT NULL DEFAULT false;

-- 첨부 스캔본 메타 배열: [{ "key": "...", "name": "...", "size": 123, "contentType": "..." }]
ALTER TABLE leave_notices ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;
