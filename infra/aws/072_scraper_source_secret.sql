-- 072_scraper_source_secret.sql
-- 범용 스크래퍼 소스의 인증키를 앱에서 입력받아 DB에 암호화 저장한다(매 소스마다 ENV+재배포하던 불편 해소).
-- 값은 AES-256-GCM(키 = AUTH_SECRET 파생 sha256)으로 암호화한 "iv:tag:ciphertext"(base64) 문자열.
-- 복호화는 실행 시점(수집/미리보기)에만 하며, 소스 조회 API 응답에는 키를 절대 포함하지 않는다.
-- 기존 ENV:SCRAPER_<SLUG>_KEY 참조는 폴백으로 유지. 071 위에 적용. 멱등.

ALTER TABLE scraper_sources ADD COLUMN IF NOT EXISTS auth_secret_enc text; -- 암호화된 인증키(iv:tag:ct base64)
