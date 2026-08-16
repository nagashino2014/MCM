-- 172: bank_accounts.bank_code 한글 은행명 → 바로빌 은행코드 교정 (2026-08-15)
--
-- 배경: GetBankAccountEx2 응답에 Bank(코드) 필드가 없고 BankName(한글)만 온다는 실측 이후
--       커넥터에 이름→코드 변환을 넣었으나(lib/barobill/bank.ts), 그 이전에 적재된 행은
--       bank_code 에 한글명이 그대로 남아 로고 매핑 키가 깨졌다(로고 API 코드 형식 불일치).
-- 쓰임: 기존 행 일괄 교정. 이후 수집분은 커넥터가 코드로 저장한다.
-- 관련: 170_barobill_finance.sql · 171_finance_logos.sql

UPDATE bank_accounts SET bank_code = CASE bank_name
  WHEN '국민은행' THEN 'KB'      WHEN '신한은행' THEN 'SHINHAN'  WHEN '농협은행' THEN 'NH'
  WHEN '하나은행' THEN 'HANA'    WHEN '제일은행' THEN 'SC'       WHEN '우리은행' THEN 'WOORI'
  WHEN '기업은행' THEN 'IBK'     WHEN '산업은행' THEN 'KDB'      WHEN '새마을금고' THEN 'KFCC'
  WHEN '씨티은행' THEN 'CITI'    WHEN '수협은행' THEN 'SUHYUP'   WHEN '신협은행' THEN 'CU'
  WHEN '신협' THEN 'CU'          WHEN '우체국' THEN 'EPOST'      WHEN '광주은행' THEN 'KJBANK'
  WHEN '전북은행' THEN 'JBBANK'  WHEN '대구은행' THEN 'DGB'      WHEN '부산은행' THEN 'BUSANBANK'
  WHEN '경남은행' THEN 'KNBANK'  WHEN '제주은행' THEN 'EJEJUBANK' WHEN '케이뱅크' THEN 'KBANK'
  WHEN '토스뱅크' THEN 'TOSS'
  ELSE bank_code END
WHERE bank_code !~ '^[A-Z]+$';
