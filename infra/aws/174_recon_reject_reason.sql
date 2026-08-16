-- 174: 수금 자동대조 — 제외(미매칭) 사유 기록
-- 배경: 고용노동부 청년고용장려금 180만원이 세광 준공금(계산서 198만원)과 매칭되는 등
--       구조적으로 성립할 수 없는 제안이 나온다. 이런 건은 "제외"로 끝내지 말고
--       왜 들어온 돈인지를 남겨야 나중에 결산·분개에서 계정과목을 붙일 수 있다.
-- 정식 분개(결산 원장)는 별도 기능이므로, 여기서는 사유 코드 + 메모만 남긴다.

ALTER TABLE recon_matches ADD COLUMN IF NOT EXISTS reject_reason text;  -- mismatch / subsidy / interest / tax_refund / transfer / other
ALTER TABLE recon_matches ADD COLUMN IF NOT EXISTS reject_note   text;  -- 사용자가 적는 실제 입금 사유
ALTER TABLE recon_matches ADD COLUMN IF NOT EXISTS rejected_by   text;
ALTER TABLE recon_matches ADD COLUMN IF NOT EXISTS rejected_at   text;

CREATE INDEX IF NOT EXISTS idx_recon_matches_reject ON recon_matches(reject_reason) WHERE reject_reason IS NOT NULL;
