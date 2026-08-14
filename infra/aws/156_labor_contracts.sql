-- 급여·근로계약 PL-P0: 근로계약 (docs/payroll-labor-contract-blueprint.md §2-2)
-- 과거 스캔본 데이터화(재직자, source='imported') + 앱 내 작성·결재·발송·전자서명(source='generated').
-- 일괄 갱신(연 1회, 기준일 1/1)·개별 승진은 labor_contract_rounds 로 라운드 관리.
-- 조문 텍스트는 labor_contract_templates(버전 고정 — 전자서명 시점의 판 보존)에 둔다.

-- 1) 근로계약 (1행 = 계약서 1건)
CREATE TABLE IF NOT EXISTS labor_contracts (
  contract_id text PRIMARY KEY,
  employee_id text NOT NULL REFERENCES employee_profiles(employee_id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'regular',            -- 'regular'|'promotion'|'executive'|'fixed_term'|'advisor'|'intern'|'parttime'
  tag text,                                        -- '일반' | '승진' (카드 태그, 자동판정 후 수정 가능)
  contract_date text,                              -- 작성일 (YYYY-MM-DD)
  effective_from text,                             -- 연봉계약 시작일
  effective_to text,                               -- 연봉계약 종료일
  position_name text,                              -- 계약서상 직위 스냅샷
  duty text,                                       -- 담당 업무
  first_hired_at text,                             -- 계약서상 최초입사일
  annual_salary double precision,                  -- 연봉총액
  monthly_salary double precision,                 -- 월 급여
  wage_components jsonb NOT NULL DEFAULT '{}'::jsonb, -- {"기본급":3971667,"식대":100000,...}
  work_hours jsonb,                                -- §4 근로시간 (시업/종업/휴게, 주간·야간 변형 수용)
  probation integer NOT NULL DEFAULT 0,
  source text NOT NULL,                            -- 'imported'(스캔본) | 'generated'(앱 생성)
  template_version integer,                        -- 생성 시 사용한 조문 템플릿 버전
  file_storage_provider text,                      -- 원본 스캔 or 생성 PDF (S3)
  file_storage_bucket text,
  file_storage_key text,
  file_sha256 text,
  signed_file_storage_key text,                    -- 서명 각인 확정본 PDF (S3, status='signed' 이후)
  status text NOT NULL DEFAULT 'imported',         -- 'imported'|'draft'|'pending_approval'|'approved'|'sent'|'signed'|'void'
  approval_doc_id text,                            -- 결재 문서(라운드 기안 공유)
  round_id text,                                   -- 일괄/승진 라운드 참조
  sent_at text,
  signed_at text,
  signatures jsonb NOT NULL DEFAULT '{}'::jsonb,   -- 전자서명 5종 {main:"성명(사번) · ISO시각", receipt:..., overtime:..., rules:..., privacy:...}
  consent_version text,                            -- 서명 당시 동의 문구 판 (overtime-consent CONSENT_VERSION 패턴)
  extraction_meta jsonb,                           -- 멀티모달 파싱 원본 응답·신뢰도 (imported 전용)
  note text,
  created_by text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_labor_contracts_employee ON labor_contracts(employee_id, contract_date);
CREATE INDEX IF NOT EXISTS idx_labor_contracts_round ON labor_contracts(round_id);
CREATE INDEX IF NOT EXISTS idx_labor_contracts_status ON labor_contracts(status);

-- 2) 작성/갱신 라운드 — 연 1회 일괄 갱신 + 수시 승진(1인 라운드)
--    annual 라운드의 cpi_rate·extra_rate 이력이 5개년 추이 그래프의 데이터 소스(§4-2).
CREATE TABLE IF NOT EXISTS labor_contract_rounds (
  round_id text PRIMARY KEY,
  round_kind text NOT NULL,                        -- 'annual' | 'promotion'
  base_date text NOT NULL,                         -- 작성/갱신 기준일 (기본 YYYY-01-01)
  base_year integer NOT NULL,                      -- 기준 연도 (추이 그래프 축)
  cpi_rate double precision,                       -- 전년도 물가상승률(%)
  extra_rate double precision,                     -- 추가 보정 비율(%)
  scope text NOT NULL DEFAULT 'exclude_exec',      -- 'exclude_exec' | 'all'
  status text NOT NULL DEFAULT 'draft',            -- 'draft'|'pending_approval'|'approved'|'sent'|'closed'
  approval_doc_id text,                            -- 대표이사 결재 문서 — approved 전 발송 불가 게이트(§5-2)
  note text,
  created_by text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_labor_contract_rounds_year ON labor_contract_rounds(base_year, round_kind);

-- 3) 조문 템플릿 — 13개 조문(§1-2)을 문단 jsonb 로 보관, 개정 시 version 증가(기존 행 불변)
--    치환 토큰: {name}{birth}{address}{phone}{position}{duty}{firstHiredAt}{effectiveFrom}{effectiveTo}
--              {annualSalary}{monthlySalary}{probationPct} 등 — 렌더러(lib/payroll/contract-pdf.ts)와 합의
CREATE TABLE IF NOT EXISTS labor_contract_templates (
  template_id text PRIMARY KEY,                    -- 예: 'regular-v1'
  kind text NOT NULL DEFAULT 'regular',            -- 계약 종류별 서식
  version integer NOT NULL DEFAULT 1,
  title text NOT NULL,                             -- 예: '연봉 근로계약서'
  body jsonb NOT NULL,                             -- [{article:"제 1 조 [계약기간]", clauses:[...]}, ...]
  is_active integer NOT NULL DEFAULT 1,
  created_at text NOT NULL,
  UNIQUE (kind, version)
);
