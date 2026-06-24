-- 사용자(직원) 등록정보에 기술등급/전문분야/대행인력등록일 항목 추가.
-- 029(service_participants) 위에 적용. 029 수행인력 명단(HWPX/PDF) 자동생성의 인력 속성 소스.
-- 수행기간 시작일 산정의 법적 하한이 되는 '대행인력등록일'을 직원 단위로 보관(환경부 통합허가 대행업 등록 준수).

ALTER TABLE employee_profiles
  ADD COLUMN IF NOT EXISTS agent_registered_at text,  -- 대행인력등록일 (YYYY-MM-DD). 수행기간 시작일의 하한.
  ADD COLUMN IF NOT EXISTS eng_grade text,            -- 엔지니어링협회 기술등급: 기술사 | 특급 | 고급 | 중급 | 초급
  ADD COLUMN IF NOT EXISTS env_grade text,            -- 환경부 대행업 등급 base: 고급인력 | 일반인력 (전문분야=대기관리면 표시 시 '(대기)' 부착)
  ADD COLUMN IF NOT EXISTS specialty_field text;      -- 전문분야: 대기관리 | 수질관리
