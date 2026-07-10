-- 발주 신호 수집 설정(API&스크래핑 설정 메뉴). key-value(jsonb) 구조 —
-- 소스별 수집 파라미터(키워드·페이지 수·기간 등)를 코드 하드코딩에서 DB 설정으로 이관한다.
-- 기본값은 코드(lib/intel/intel-settings.ts DEFAULTS)에 있고, 이 테이블에는 오버라이드만 저장된다.
CREATE TABLE IF NOT EXISTS intel_settings (
  setting_key  text PRIMARY KEY,
  setting_json jsonb NOT NULL,
  updated_at   text NOT NULL,
  updated_by   text
);
