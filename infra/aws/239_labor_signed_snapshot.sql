-- G-00A A3: 신규 전자서명의 치환 완료 본문/인적사항/임금 입력 보존.
-- 기존 서명 행은 현재 정보를 과거 원본으로 오인하지 않도록 소급 채우지 않는다.
-- PDF 바이트/폰트/직인 파일의 영구 보존은 G-02에서 별도 구현한다.
ALTER TABLE labor_contracts ADD COLUMN IF NOT EXISTS signed_render_snapshot jsonb;
COMMENT ON COLUMN labor_contracts.signed_render_snapshot IS
  'Versioned PDF render input captured atomically at signing; NULL legacy rows require original document verification.';
