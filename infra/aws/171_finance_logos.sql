-- 171: 재무 은행·카드사 로고 사용자 등록 (2026-08-15)
--
-- 배경: 번들 정적 로고(public/finance/logos)는 일부 기관이 미확보(제주은행·삼성카드)이거나
--       저해상도라, 사용자가 연결 관리 화면에서 직접 로고를 등록/교체할 수 있게 한다.
-- 쓰임: 업로드본은 재배포에도 유지되도록 DB 에 저장(수십 KB 수준). /api/finance/logos/img/{code} 가
--       DB 우선 → 번들 정적 파일 순으로 서빙. 설계: docs/barobill-finance-blueprint.md F0.
-- 관련: 170_barobill_finance.sql

CREATE TABLE IF NOT EXISTS finance_logos (
  logo_code    text PRIMARY KEY,   -- 은행코드(KB·IBK…) 또는 'CARD_' + 카드사코드(CARD_BC…)
  mime         text NOT NULL,      -- image/png · image/jpeg · image/webp · image/svg+xml
  data_base64  text NOT NULL,      -- 이미지 원본 base64 (≤1MB 제한은 API 계층)
  uploaded_by  text,
  updated_at   text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS')
);
