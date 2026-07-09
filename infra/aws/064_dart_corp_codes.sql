-- DART corpCode.xml(기업 고유번호 전체 목록) 캐시.
-- 사업장 자동 보완(누락 점검 화면)에서 회사명 → corp_code 역조회에 사용한다.
-- DART 에는 회사명/사업자번호 → corp_code 조회 API 가 없어 전체 목록을 주기 적재한다.
CREATE TABLE IF NOT EXISTS dart_corp_codes (
  corp_code       text PRIMARY KEY,
  corp_name       text NOT NULL,
  normalized_name text NOT NULL,
  stock_code      text,
  refreshed_at    text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dart_corp_codes_norm ON dart_corp_codes (normalized_name);
