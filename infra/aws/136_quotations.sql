-- 136: 견적서 작성·발송 시스템 — 기준 데이터·발송 대장·채번 시드·전자결재 양식 시드.
-- 설계: docs/quotation-blueprint.md (2026-08-05 확정: 견적가 입력→MD 역산·0.5 스냅·
--       합계-견적가 초과폭 상한, 발송 모드(mail|direct) 작성 시 선택, PDF만 외부 발송,
--       견적번호 {연도}-{용역종류}-{NNNN} 5종 시퀀스, 과거 견적 백필 없음).
-- 견적 원본 데이터는 approval_docs.field_values 가 단일 소스이고, quotations 는 발송·산출물
-- 메타 + 산정 스냅샷 대장이다(공문 official_letters 와 동일 원칙).
-- 관례: text 타임스탬프, integer boolean, 멱등(IF NOT EXISTS / ON CONFLICT).

-- 1) 노임단가 (엔지니어링 기술자 노임단가, 환경분야, 원/일) — 별첨2와 산정 엔진의 공용 원천.
CREATE TABLE IF NOT EXISTS quote_labor_rates (
  year        text NOT NULL,               -- 적용 연도 '2026'
  grade       text NOT NULL,               -- 기술사|특급|고급|중급|초급
  daily_rate  integer NOT NULL,            -- 원/일
  source_note text,                        -- 근거 (공표 출처·적용일)
  PRIMARY KEY (year, grade)
);

INSERT INTO quote_labor_rates (year, grade, daily_rate, source_note) VALUES
  ('2022', '기술사', 379482, '한국엔지니어링협회 공표 환경분야, 2022-01-01 적용'),
  ('2022', '특급',   290502, '한국엔지니어링협회 공표 환경분야, 2022-01-01 적용'),
  ('2022', '고급',   262115, '한국엔지니어링협회 공표 환경분야, 2022-01-01 적용'),
  ('2022', '중급',   221815, '한국엔지니어링협회 공표 환경분야, 2022-01-01 적용'),
  ('2022', '초급',   199370, '한국엔지니어링협회 공표 환경분야, 2022-01-01 적용'),
  ('2026', '기술사', 456273, '한국엔지니어링협회 공표 환경분야, 2026-01-01 적용'),
  ('2026', '특급',   362012, '한국엔지니어링협회 공표 환경분야, 2026-01-01 적용'),
  ('2026', '고급',   323993, '한국엔지니어링협회 공표 환경분야, 2026-01-01 적용'),
  ('2026', '중급',   272129, '한국엔지니어링협회 공표 환경분야, 2026-01-01 적용'),
  ('2026', '초급',   246584, '한국엔지니어링협회 공표 환경분야, 2026-01-01 적용')
ON CONFLICT (year, grade) DO NOTHING;

-- 1-1) 노임단가 자동 갱신 시도 로그 — 매년 1/1 이후 당해 연도 단가 확보까지 하루 1회
--      자동 탐색(lib/quote/labor-sync.ts, rate-set API 진입 시 트리거). 성공/실패 이력.
CREATE TABLE IF NOT EXISTS quote_labor_rate_sync_log (
  year       text NOT NULL,
  tried_date text NOT NULL,            -- YYYY-MM-DD (하루 1회 가드 키)
  ok         integer NOT NULL DEFAULT 0,
  source_url text,
  detail     text,
  PRIMARY KEY (year, tried_date)
);

-- 2) 견적 기준 세트 — 용역 세분류별 1개 활성 버전. 견적서에는 산정 당시 세트가 스냅샷으로
--    박제되므로(quotation_sites.rates) 세트 수정이 기존 견적을 훼손하지 않는다.
--    기준 세트가 없는 세분류는 자유 입력형(T3)으로 동작한다.
CREATE TABLE IF NOT EXISTS quote_rate_sets (
  set_id              text PRIMARY KEY,            -- 'qrs-' + slug
  service_type        text NOT NULL,               -- 계약관리 대분류 (통합허가 등)
  service_subtype     text NOT NULL,               -- 계약관리 세분류 (최초허가 등)
  version             integer NOT NULL DEFAULT 1,
  status              text NOT NULL DEFAULT 'active',  -- active | draft | archived
  overhead_rate       double precision NOT NULL DEFAULT 1.10,  -- 제경비율(직접인건비 대비) 기본값
  tech_fee_rate       double precision NOT NULL DEFAULT 0.20,  -- 기술료율((직접인건비+제경비) 대비) 기본값
  direct_expense_rate double precision NOT NULL DEFAULT 0,     -- 직접경비율(상주 시, 상주 인건비 대비) 기본값
  market_adjust       double precision NOT NULL DEFAULT 1.0,   -- 시장 보정계수(정방향 표준가에 적용)
  remarks_template    text,                        -- 특이사항 기본 문구
  created_at          text NOT NULL,
  updated_at          text NOT NULL,
  updated_by          text REFERENCES users(user_id) ON DELETE SET NULL,
  UNIQUE (service_type, service_subtype, version)
);

-- 2-1) 산정 인자 정의 (정방향 표준가 가이드용 — 세분류마다 자유 정의, 없으면 T2/T3)
CREATE TABLE IF NOT EXISTS quote_rate_factors (
  set_id     text NOT NULL REFERENCES quote_rate_sets(set_id) ON DELETE CASCADE,
  factor_key text NOT NULL,                -- emission_facility | outlet | process | chemical ...
  label      text NOT NULL,
  unit       text,                         -- '개' 등
  sort       integer NOT NULL DEFAULT 0,
  PRIMARY KEY (set_id, factor_key)
);

-- 2-2) 업무 항목 트리 (별첨1의 행) — base_md 가 표준 MD이자 역산 분배 가중치의 원천.
--      역산 시 각 셀 가중치 = base_md(셀) / Σ base_md(전체).
CREATE TABLE IF NOT EXISTS quote_rate_items (
  item_id   text PRIMARY KEY,              -- 'qri-' + slug
  set_id    text NOT NULL REFERENCES quote_rate_sets(set_id) ON DELETE CASCADE,
  parent_id text REFERENCES quote_rate_items(item_id) ON DELETE CASCADE,  -- NULL=대항목
  label     text NOT NULL,
  sort      integer NOT NULL DEFAULT 0,
  base_md   jsonb NOT NULL DEFAULT '{}'::jsonb   -- {"특급":4,"고급":10,"중급":18,"초급":18}
);
CREATE INDEX IF NOT EXISTS idx_quote_rate_items_set ON quote_rate_items(set_id, sort);

-- 2-3) 인자×등급별 단위 MD (정방향 산정용 — 환경부 가이드라인 구조 차용, 값은 자사 보정)
CREATE TABLE IF NOT EXISTS quote_rate_item_factors (
  item_id    text NOT NULL REFERENCES quote_rate_items(item_id) ON DELETE CASCADE,
  factor_key text NOT NULL,
  unit_md    jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {"특급":0.4,...} 인자 1단위당 MD
  PRIMARY KEY (item_id, factor_key)
);

-- 2-4) 규모 구간표 — 기준 인자 값 구간별 계수(환경부 연속함수 y=75/x+0.5 를 운영 조정이
--      쉬운 구간표로 대체). max_val NULL = 상한 없음.
CREATE TABLE IF NOT EXISTS quote_rate_bands (
  set_id     text NOT NULL REFERENCES quote_rate_sets(set_id) ON DELETE CASCADE,
  factor_key text NOT NULL,
  min_val    integer NOT NULL,
  max_val    integer,
  coef       double precision NOT NULL,
  PRIMARY KEY (set_id, factor_key, min_val)
);

-- 2-5) 업종 계수 — 통합허가 대상 20개 업종 태그(lib/ieps/integrated-permit-industries.ts)
--      라벨 기준. 시드는 기본 1.0 미등록(=1.0 폴백), 관리 화면에서 업종별 상향/하향 등록.
CREATE TABLE IF NOT EXISTS quote_rate_industry_coefs (
  set_id         text NOT NULL REFERENCES quote_rate_sets(set_id) ON DELETE CASCADE,
  industry_label text NOT NULL,
  coef           double precision NOT NULL DEFAULT 1.0,
  PRIMARY KEY (set_id, industry_label)
);

-- 2-6) 상황 변수 사유 코드 (건별 상황 조정 레이어 — 2026-08-05 초기 6종 확정)
CREATE TABLE IF NOT EXISTS quote_situation_codes (
  code    text PRIMARY KEY,
  label   text NOT NULL,
  sort    integer NOT NULL DEFAULT 0,
  enabled integer NOT NULL DEFAULT 1
);

INSERT INTO quote_situation_codes (code, label, sort, enabled) VALUES
  ('nego',        '발주처 네고 요구', 1, 1),
  ('competition', '경쟁 격화(경쟁사 저가)', 2, 1),
  ('strategic',   '전략적 수주(레퍼런스 확보)', 3, 1),
  ('loyalty',     '장기 고객 관계', 4, 1),
  ('urgent',      '긴급 일정 할증', 5, 1),
  ('etc',         '기타', 9, 1)
ON CONFLICT (code) DO NOTHING;

-- 3) 견적 발송 대장 (official_letters 미러 + 견적 고유 필드. 백필 없음 → source/imported 없음)
CREATE TABLE IF NOT EXISTS quotations (
  quote_id        text PRIMARY KEY,                -- 'qt-' + nanoid
  doc_id          text UNIQUE NOT NULL,            -- approval_docs.doc_id
  quote_no        text UNIQUE,                     -- '2026-통합허가-0001' (승인·채번 후 기록)
  year            text,
  title           text,
  service_type    text,                            -- 대분류 (채번 시퀀스 분기 키)
  service_subtype text,
  recipients      jsonb,                           -- [{name,deptName,title,email,facilityName,facilityId}]
  cc_refs         jsonb,
  drafter_name    text,
  issue_date      text,                            -- 견적일 YYYY-MM-DD
  valid_until     text,                            -- 유효기간 만료일(견적일+1개월 고정 정책의 계산값)
  total_amount    bigint,                          -- 제출 견적가 합계(전 사업장, VAT 별도)
  xlsx_key        text,                            -- 내부 보관용 원본 (외부 발송은 PDF만)
  pdf_key         text,
  attach_keys     jsonb,
  send_mode       text NOT NULL DEFAULT 'mail',    -- mail(메일 발송) | direct(직접 제출용 다운로드)
  situation       jsonb,                           -- 상황 변수 [{code,rate,amount,scope,memo}]
  send_status     text NOT NULL DEFAULT 'pending', -- pending|generating|generated|sending|sent|failed
  send_error      text,
  send_attempts   integer NOT NULL DEFAULT 0,
  sent_at         text,
  sent_message_id text,
  sales_project_id text,                           -- 영업 프로젝트 연결(선택)
  result          text NOT NULL DEFAULT 'pending', -- pending|won|lost|dropped (수주 결과 — 후속 분석용)
  result_note     text,
  created_at      text NOT NULL,
  updated_at      text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quotations_status ON quotations(send_status);
CREATE INDEX IF NOT EXISTS idx_quotations_year ON quotations(year, quote_no);

-- 3-1) 사업장별 라인 — 산정 인자·MD·요율·금액 스냅샷 (재현 가능성 보장)
CREATE TABLE IF NOT EXISTS quotation_sites (
  quote_id    text NOT NULL REFERENCES quotations(quote_id) ON DELETE CASCADE,
  site_seq    integer NOT NULL,                    -- 1부터. 4개 이상이면 총괄 시트 자동 생성
  facility_id text,                                -- facilities 연결(선택 — 미등록 사업장 허용)
  site_label  text NOT NULL,                       -- 시트명·총괄 행 라벨 (예: '광양양극재')
  factors     jsonb,                               -- 입력 인자값 {"emission_facility":150,...}
  md_matrix   jsonb,                               -- 항목×등급 MD 최종본 [{itemId,label,md:{특급..},overridden}]
  rates       jsonb,                               -- {setId,setVersion,overheadRate,techFeeRate,directExpenseRate,laborRates:{특급..}}
  amounts     jsonb,                               -- {standard,laborCost,overhead,techFee,directExpense,sum,final} (표준가/합계/제출가)
  remarks     text,                                -- 특이사항 (시트별)
  PRIMARY KEY (quote_id, site_seq)
);

-- 4) 채번 시드 — 용역 종류 5종별 독립 시퀀스. 포맷 {연도}-{종류}-{NNNN}, 신규 연도 1 시작
--    (과거 견적 백필 없음 — 2026-08-05 확정). rule_key 분기는 lib/approval/docs.ts.
INSERT INTO doc_no_sequences (rule_key, year, last_seq) VALUES
  ('견적:통합허가', '2026', 0),
  ('견적:화관법',   '2026', 0),
  ('견적:HAPs',     '2026', 0),
  ('견적:ESG',      '2026', 0),
  ('견적:기타',     '2026', 0)
ON CONFLICT (rule_key, year) DO NOTHING;

-- 5) 견적 양식 시드 — 전용 작성 화면(/approval/quote) 사용. fields 는 양식별 문서 조회
--    표시용 최소 선언만(공문 135 관례). 실제 값 스키마는 lib/quote/types.ts field_values 규약.
INSERT INTO approval_forms
  (form_id, folder_id, name, description, fields, doc_no_rule, retention_years, org_folder, dept_folder, mobile_allowed, sort_order, created_at, updated_at)
VALUES
  ('frm-quotation', 'fld-biz', '견적서(대외제출)', '대외 제출 견적서 — 전용 작성 화면(/approval/quote) 사용. 승인 완료 시 자동 채번·xlsx/PDF 생성, 발송 모드에 따라 메일 발송 또는 다운로드 제공.',
   '[
     {"key":"recipients_display","label":"수신처","type":"text","row":1,"span":2},
     {"key":"quote_summary_display","label":"견적 요약","type":"text","row":1,"span":1}
   ]'::jsonb,
   '견적', 10, '견적 문서', '견적 문서', 0, 10, now()::text, now()::text)
ON CONFLICT (form_id) DO NOTHING;

INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
SELECT form_id, 1, fields, NULL, now()::text FROM approval_forms
WHERE form_id = 'frm-quotation'
ON CONFLICT (form_id, version) DO NOTHING;

-- 6) 기준 세트 시드 — 통합허가 3종(최초허가·변경허가·재검토). 업무 항목 트리와 base_md 는
--    실물 견적서 실측값 그대로(캘리브레이션 원본):
--    최초허가 = MD산정 샘플(2.0억, 350MD) / 변경허가 = 케이지스틸(920만, 15MD) /
--    재검토 = 삼양사(3,800만, 73MD). 정방향 인자·규모구간은 초기 추정(관리 화면에서 보정).

INSERT INTO quote_rate_sets
  (set_id, service_type, service_subtype, version, status, overhead_rate, tech_fee_rate, direct_expense_rate, market_adjust, remarks_template, created_at, updated_at)
VALUES
  ('qrs-ip-first-v1', '통합허가', '최초허가', 1, 'active', 1.10, 0.20, 0, 1.0,
   E'1. 상기 견적금액은 통합환경계획서 작성 시 필요 도서류를 사업장에서 제공하는 조건임.\n2. 오염물질 항목별 측정 필요시 측정 비용은 별도임.(사업주와 협의 후 별도 추진)\n3. 기존 매체별(대기, 폐수 등) 인허가의 변경 허가 및 신고 필요시 비용은 별도임.(사업주와 협의 후 별도 추진)',
   now()::text, now()::text),
  ('qrs-ip-change-v1', '통합허가', '변경허가', 1, 'active', 1.10, 0.20, 0, 1.0,
   E'1. 용역의 범위는 변경된 통합환경계획서 작성 및 변경허가 취득에 한함.\n2. 편집 가능한 최신 통합환경계획서 및 작성에 필요한 자료(증빙자료, 설계자료 등)은 사업장에서 제공함.',
   now()::text, now()::text),
  ('qrs-ip-review-v1', '통합허가', '재검토', 1, 'active', 1.10, 0.20, 0, 1.0,
   E'1. 위 견적은 통합환경인허가 이후 5년간 활동도, 정기검사 결과 수정/시정 요청사항, 통합공정도 검토 등 기존 허가서류 검토, 수정/보완을 포함한 통합허가 재검토 신청서 작성 및 관련 업무에 한함.\n2. 통합허가 재검토 서류 작성에 필요한 도·서류는 발주사에서 제공함.\n3. 통합환경허가 사후관리 법률적, 기술적 자문, 담당자 교육.',
   now()::text, now()::text)
ON CONFLICT (set_id) DO NOTHING;

-- 6-1) 최초허가 — 산정 인자(정방향 가이드용) + 규모 구간표(대기배출시설수 기준, 초기 추정)
INSERT INTO quote_rate_factors (set_id, factor_key, label, unit, sort) VALUES
  ('qrs-ip-first-v1', 'emission_facility', '대기배출시설 수', '개', 1),
  ('qrs-ip-first-v1', 'outlet',            '배출·방류구 수', '개', 2),
  ('qrs-ip-first-v1', 'process',           '단위공정 수', '개', 3),
  ('qrs-ip-first-v1', 'chemical',          '취급물질 수', '개', 4)
ON CONFLICT (set_id, factor_key) DO NOTHING;

INSERT INTO quote_rate_bands (set_id, factor_key, min_val, max_val, coef) VALUES
  ('qrs-ip-first-v1', 'emission_facility', 0,   30,   1.60),
  ('qrs-ip-first-v1', 'emission_facility', 31,  150,  1.00),
  ('qrs-ip-first-v1', 'emission_facility', 151, 600,  0.75),
  ('qrs-ip-first-v1', 'emission_facility', 601, NULL, 0.55)
ON CONFLICT (set_id, factor_key, min_val) DO NOTHING;

-- 6-2) 최초허가 — 업무 항목 트리 (샘플 2.0억 실측: 총 350MD = 특34/고62/중130/초124)
INSERT INTO quote_rate_items (item_id, set_id, parent_id, label, sort, base_md) VALUES
  ('qri-ipf-1',   'qrs-ip-first-v1', NULL,        '1. 환경진단 수준 및 대응기반 마련', 10, '{"특급":4,"고급":10,"중급":18,"초급":18}'),
  ('qri-ipf-2',   'qrs-ip-first-v1', NULL,        '2. 사전협의 신청(사업장 통합환경관리계획서 작성)', 20, '{}'),
  ('qri-ipf-2-1', 'qrs-ip-first-v1', 'qri-ipf-2', '1장 일반현황', 21, '{"특급":2,"고급":4,"중급":6,"초급":6}'),
  ('qri-ipf-2-2', 'qrs-ip-first-v1', 'qri-ipf-2', '2장 배출영향분석 결과', 22, '{"특급":2,"고급":4,"중급":6,"초급":6}'),
  ('qri-ipf-2-3', 'qrs-ip-first-v1', 'qri-ipf-2', '3장 허가배출기준(안) 설정', 23, '{"특급":2,"고급":4,"중급":6,"초급":6}'),
  ('qri-ipf-2-4', 'qrs-ip-first-v1', 'qri-ipf-2', '4장 배출시설등 및 방지시설 현황, 설치 계획', 24, '{"특급":6,"고급":10,"중급":30,"초급":30}'),
  ('qri-ipf-2-5', 'qrs-ip-first-v1', 'qri-ipf-2', '5장 연료, 원료 등 사용물질', 25, '{"특급":4,"고급":6,"중급":16,"초급":10}'),
  ('qri-ipf-2-6', 'qrs-ip-first-v1', 'qri-ipf-2', '6장 사후환경관리계획', 26, '{"특급":2,"고급":4,"중급":6,"초급":6}'),
  ('qri-ipf-2-7', 'qrs-ip-first-v1', 'qri-ipf-2', '7장 최적가용기법 적용 내역', 27, '{"특급":2,"고급":4,"중급":6,"초급":6}'),
  ('qri-ipf-2-8', 'qrs-ip-first-v1', 'qri-ipf-2', '8장 제출 · 첨부 서류', 28, '{"특급":2,"고급":6,"중급":12,"초급":12}'),
  ('qri-ipf-3',   'qrs-ip-first-v1', NULL,        '3. 본 협의 신청/대응 완료', 30, '{"특급":8,"고급":10,"중급":24,"초급":24}')
ON CONFLICT (item_id) DO NOTHING;

-- 6-3) 변경허가 — 업무 항목 트리 (케이지스틸 실측: 총 15MD = 고5/중10)
INSERT INTO quote_rate_items (item_id, set_id, parent_id, label, sort, base_md) VALUES
  ('qri-ipc-1',   'qrs-ip-change-v1', NULL,        '1. 기존 통합환경계획서 및 변경사항 검토', 10, '{"중급":1}'),
  ('qri-ipc-2',   'qrs-ip-change-v1', NULL,        '2. 변경된 통합환경계획서 작성', 20, '{}'),
  ('qri-ipc-2-1', 'qrs-ip-change-v1', 'qri-ipc-2', '1장 일반현황', 21, '{"고급":0.5,"중급":1}'),
  ('qri-ipc-2-2', 'qrs-ip-change-v1', 'qri-ipc-2', '2장 배출영향분석 결과', 22, '{"고급":0.5,"중급":1}'),
  ('qri-ipc-2-3', 'qrs-ip-change-v1', 'qri-ipc-2', '3장 허가배출기준(안) 설정', 23, '{"고급":0.5,"중급":1}'),
  ('qri-ipc-2-4', 'qrs-ip-change-v1', 'qri-ipc-2', '4장 배출시설등 및 방지시설 현황, 설치 계획', 24, '{"고급":0.5,"중급":1}'),
  ('qri-ipc-2-5', 'qrs-ip-change-v1', 'qri-ipc-2', '5장 연료, 원료 등 사용물질', 25, '{"고급":0.5,"중급":0.5}'),
  ('qri-ipc-2-6', 'qrs-ip-change-v1', 'qri-ipc-2', '6장 사후환경관리계획', 26, '{"고급":0.5,"중급":0.5}'),
  ('qri-ipc-2-7', 'qrs-ip-change-v1', 'qri-ipc-2', '7장 최적가용기법 적용 내역', 27, '{"고급":0.5}'),
  ('qri-ipc-2-8', 'qrs-ip-change-v1', 'qri-ipc-2', '8장 제출 · 첨부 서류', 28, '{"고급":1,"중급":3}'),
  ('qri-ipc-3',   'qrs-ip-change-v1', NULL,        '3. 변경허가/신고 대응(환경부 등)', 30, '{"고급":0.5,"중급":1}')
ON CONFLICT (item_id) DO NOTHING;

-- 6-4) 재검토 — 업무 항목 트리 (삼양사 실측: 총 73MD = 고13/중30/초30)
INSERT INTO quote_rate_items (item_id, set_id, parent_id, label, sort, base_md) VALUES
  ('qri-ipr-1',   'qrs-ip-review-v1', NULL,        '1. 기존 서류 검토 및 현장 시설 확인 등', 10, '{}'),
  ('qri-ipr-1-1', 'qrs-ip-review-v1', 'qri-ipr-1', '1.1 기존 인·허가 사항 등 서류 검토', 11, '{"고급":0.5,"중급":3,"초급":3}'),
  ('qri-ipr-1-2', 'qrs-ip-review-v1', 'qri-ipr-1', '1.2 공정도 적합성 등 현장 일치여부 확인', 12, '{"고급":4,"중급":4,"초급":3}'),
  ('qri-ipr-1-3', 'qrs-ip-review-v1', 'qri-ipr-1', '1.3 물질수지 및 시설 운영관리 검토', 13, '{"고급":0.5,"중급":3,"초급":3}'),
  ('qri-ipr-2',   'qrs-ip-review-v1', NULL,        '2. 허가 재검토 통합환경관리계획서 작성', 20, '{}'),
  ('qri-ipr-2-1', 'qrs-ip-review-v1', 'qri-ipr-2', '1장 일반현황', 21, '{"고급":0.5,"중급":1,"초급":1}'),
  ('qri-ipr-2-2', 'qrs-ip-review-v1', 'qri-ipr-2', '2장 배출영향분석 결과', 22, '{"고급":0.5,"중급":2,"초급":2}'),
  ('qri-ipr-2-3', 'qrs-ip-review-v1', 'qri-ipr-2', '3장 허가배출기준(안) 설정', 23, '{"고급":0.5,"중급":1,"초급":1}'),
  ('qri-ipr-2-4', 'qrs-ip-review-v1', 'qri-ipr-2', '4장 배출시설등 및 방지시설 현황, 설치 계획', 24, '{"고급":2,"중급":5,"초급":5}'),
  ('qri-ipr-2-5', 'qrs-ip-review-v1', 'qri-ipr-2', '5장 연료, 원료 등 사용물질', 25, '{"고급":0.5,"중급":1,"초급":2}'),
  ('qri-ipr-2-6', 'qrs-ip-review-v1', 'qri-ipr-2', '6장 사후환경관리계획', 26, '{"고급":1,"중급":2,"초급":2}'),
  ('qri-ipr-2-7', 'qrs-ip-review-v1', 'qri-ipr-2', '7장 최적가용기법 적용 내역', 27, '{"고급":0.5,"중급":1,"초급":1}'),
  ('qri-ipr-2-8', 'qrs-ip-review-v1', 'qri-ipr-2', '8장 제출 · 첨부 서류', 28, '{"고급":0.5,"중급":3,"초급":3}'),
  ('qri-ipr-3',   'qrs-ip-review-v1', NULL,        '3. 허가 재검토 대응(환경부 등)', 30, '{"고급":2,"중급":4,"초급":4}')
ON CONFLICT (item_id) DO NOTHING;
