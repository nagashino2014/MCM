-- 089: ADT캡스(SK쉴더스) 근태 연동 — 출퇴근 수신 → 초과근무 자체 산정 파이프라인.
-- 설계: docs/ADT_attendance_integration_handoff.md §3~§4 + 사규(주 52h제). 관례: 멱등.
--
-- 사규 요약(산정 근거)
--   · 주 52h제: 주 소정 40h + 연장 12h 인정, 주 시작(카운팅 초기화) = 일요일.
--   · 주 12h(연장 한도) 초과분 → 특별휴가 보상 대상(1차는 감지·리포트만, 자동적립 X).
--   · 연장 가산배수: 기본 1.5, 야간(22:00~06:00) 근무분 2.0.
--   · 기준시급 = (비정기수당 제외 월평균임금) ÷ 209 × 배수 → 금액 산정은 급여데이터 확보 후(후속).
--
-- 구성
--   ① adt_attendance_raw   : 컨트롤러/파일이 밀어넣는 무손실 스테이징(문자열 원본). PK (e_idno,d_date).
--   ② attendance_daily     : 일별 정규화 원천(재실·휴게·실근무·야간분·자정보정). PK (adt_emp_no, work_date).
--   ③ attendance_weekly    : 주(일요일 시작) 단위 초과근무 산정(인정연장·1.5/2.0 배분·12h 초과). PK (adt_emp_no, week_start).
--   ④ employee_profiles.adt_emp_no : ADT 사원번호(e_idno) ↔ 직원 매핑 컬럼(앱 employee_no 와 다를 수 있어 별도 관리).
--   ⑤ attendance_settings  : 자체 산정 정책(주 소정·연장한도·야간구간·배수·라운딩). 단일 행 'default'.
--
-- 수신 계층은 lib/adt/source.ts 의 AttendanceSource 추상화(DbStagingSource / FileSource)가 ①에 수렴시키고,
-- lib/adt/ingest.ts 가 ①→②(일별)→③(주별)로 정규화·산정한다(멱등 upsert, processed 플래그).

-- ── ① 스테이징(무손실 원본) ─────────────────────────────────────────────
-- 컨트롤러 "근태결과 DB 전송"이 직접 INSERT 하는 테이블. 컬럼명은 컨트롤러 "열 선택"에서 이 이름으로 매핑한다.
-- 예약어(leave/return/late/early/over/night/total/allow) 회피용 _time 접미사(문서 §4-1 주석 참조).
CREATE TABLE IF NOT EXISTS adt_attendance_raw (
  fpid        bigint,                 -- 컨트롤러 내부 ID
  c_dept      varchar(20),            -- 부서
  c_pos       varchar(8),             -- 직급
  e_group     smallint,               -- 그룹ID
  e_idno      varchar(30) NOT NULL,   -- 사원번호 (키)
  e_name      varchar(30),            -- 성명
  d_date      varchar(8)  NOT NULL,   -- 근무일자 YYYYMMDD (키)
  n_date      varchar(31),            -- 근무일 명칭
  in_time     varchar(6),             -- 출근 HHMMSS
  out_time    varchar(6),             -- 퇴근 HHMMSS
  leave_time  varchar(6),             -- 외출
  return_time varchar(6),             -- 복귀
  late_time   varchar(4),             -- 지각
  early_time  varchar(4),             -- 조기
  over_time   varchar(4),             -- 연장(컨트롤러 산정치)
  night_time  varchar(4),             -- 심야
  total_time  varchar(4),             -- 총합
  allow_time  varchar(4),             -- 인정
  source      text        NOT NULL DEFAULT 'db',   -- 'db'(컨트롤러 직접) | 'file'(txt 취식)
  ingested_at timestamptz NOT NULL DEFAULT now(),
  processed   boolean     NOT NULL DEFAULT false,   -- ingest(②로 이관) 처리 여부
  PRIMARY KEY (e_idno, d_date)
);

CREATE INDEX IF NOT EXISTS idx_adt_raw_unprocessed
  ON adt_attendance_raw (processed) WHERE processed = false;

-- ── ④ 직원 매핑 컬럼 ────────────────────────────────────────────────────
-- ADT 컨트롤러의 e_idno 는 앱 자체 발급 employee_no(입사일+성별+순번 12자리)와 일치하지 않을 수 있다.
-- 관리자가 이 컬럼에 ADT 사번을 매핑하고, 비어 있으면 ingest 가 employee_no 로 fallback.
ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS adt_emp_no text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_emp_adt_emp_no
  ON employee_profiles (adt_emp_no) WHERE adt_emp_no IS NOT NULL;

-- ── ② 일별 근태(정규화 원천) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_daily (
  adt_emp_no       text NOT NULL,            -- ADT 사원번호(무손실 자연키)
  work_date        date NOT NULL,            -- 근무일자
  employee_id      text REFERENCES employee_profiles(employee_id) ON DELETE SET NULL, -- 매핑 결과(미매칭 NULL)
  emp_name         text,                     -- 수신 시점 성명 스냅샷
  dept_snapshot    text,                     -- 수신 시점 부서 스냅샷
  pos_snapshot     text,                     -- 수신 시점 직급 스냅샷
  in_at            timestamptz,              -- 출근(KST)
  out_at           timestamptz,              -- 퇴근(out<in 이면 +1일 보정)
  present_minutes  integer,                  -- 재실(out - in)
  break_minutes    integer,                  -- 공제 휴게
  worked_minutes   integer,                  -- 실근무(재실 - 휴게)
  night_minutes    integer,                  -- 야간(22:00~06:00) 재실 겹침분 → 주별 2.0배 배분 원천
  late_minutes     integer,                  -- 지각(참고)
  early_minutes    integer,                  -- 조기퇴근(참고)
  is_leave_day     boolean NOT NULL DEFAULT false, -- 해당일 휴가(연차 대장) 여부 → 연장 산정 제외
  -- 벤더(컨트롤러) 산정 원본 — 무손실 문자열 보존(단위 미확정), 교차검증·감사용
  vendor_over_raw  text,
  vendor_night_raw text,
  vendor_total_raw text,
  vendor_allow_raw text,
  source           text NOT NULL DEFAULT 'db',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (adt_emp_no, work_date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_daily_emp
  ON attendance_daily (employee_id, work_date);
CREATE INDEX IF NOT EXISTS idx_attendance_daily_date
  ON attendance_daily (work_date);
-- 미매칭(직원 조인 실패) 조회용 — 관리자 매핑 리포트
CREATE INDEX IF NOT EXISTS idx_attendance_daily_unmatched
  ON attendance_daily (work_date) WHERE employee_id IS NULL;

-- ── ③ 주별 초과근무 산정(일요일 시작) ───────────────────────────────────
-- 주 실근무 합에서 소정(40h) 초과분이 연장. 인정연장은 주 12h 한도, 초과분(excess)은 특별휴가 대상(리포트).
-- 인정연장 중 야간(night_minutes 합) 몫은 2.0배(overtime_night), 나머지는 1.5배(overtime_day).
CREATE TABLE IF NOT EXISTS attendance_weekly (
  adt_emp_no             text NOT NULL,
  week_start             date NOT NULL,      -- 그 주 일요일(KST)
  employee_id            text REFERENCES employee_profiles(employee_id) ON DELETE SET NULL,
  emp_name               text,
  worked_minutes         integer NOT NULL DEFAULT 0,  -- 주 실근무 합(휴가일 제외 정책 반영)
  standard_minutes       integer NOT NULL DEFAULT 0,  -- 적용 소정(정보성, 기본 2400)
  overtime_minutes       integer NOT NULL DEFAULT 0,  -- 인정 연장(= min(주연장, 12h 한도))
  overtime_night_minutes integer NOT NULL DEFAULT 0,  -- 인정연장 중 2.0배 대상(야간)
  overtime_day_minutes   integer NOT NULL DEFAULT 0,  -- 인정연장 중 1.5배 대상(주간)
  excess_minutes         integer NOT NULL DEFAULT 0,  -- 12h 초과분(특별휴가 보상 대상, 리포트)
  night_minutes          integer NOT NULL DEFAULT 0,  -- 주 야간 재실 합(참고)
  days_worked            integer NOT NULL DEFAULT 0,
  over_limit             boolean NOT NULL DEFAULT false, -- excess_minutes > 0
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (adt_emp_no, week_start)
);

CREATE INDEX IF NOT EXISTS idx_attendance_weekly_emp
  ON attendance_weekly (employee_id, week_start);
CREATE INDEX IF NOT EXISTS idx_attendance_weekly_week
  ON attendance_weekly (week_start);
-- 주 한도 초과(특별휴가 보상 대상) 조회용
CREATE INDEX IF NOT EXISTS idx_attendance_weekly_over
  ON attendance_weekly (week_start) WHERE over_limit = true;

-- ── ⑤ 자체 초과근무 산정 정책(단일 행 'default') ────────────────────────
-- 사규 기본값. 관리자가 화면에서 조정한다.
CREATE TABLE IF NOT EXISTS attendance_settings (
  id                            text    PRIMARY KEY DEFAULT 'default',
  week_start_dow                integer NOT NULL DEFAULT 0,     -- 주 시작 요일(0=일요일)
  weekly_standard_minutes       integer NOT NULL DEFAULT 2400,  -- 주 소정근로(40h)
  weekly_overtime_limit_minutes integer NOT NULL DEFAULT 720,   -- 주 연장 인정 한도(12h)
  daily_standard_minutes        integer NOT NULL DEFAULT 480,   -- 1일 소정(참고/휴게판정)
  break_minutes                 integer NOT NULL DEFAULT 60,    -- 재실에서 공제할 휴게(고정)
  night_start_hhmm              text    NOT NULL DEFAULT '2200',-- 야간(2.0배) 시작(HHMM)
  night_end_hhmm                text    NOT NULL DEFAULT '0600',-- 야간 종료(HHMM, 익일)
  overtime_rate_day             numeric NOT NULL DEFAULT 1.5,   -- 주간 연장 가산배수
  overtime_rate_night           numeric NOT NULL DEFAULT 2.0,   -- 야간 연장 가산배수
  wage_divisor_hours            integer NOT NULL DEFAULT 209,   -- 통상시급 산정 제수(월 소정근로시간)
  round_unit_minutes            integer NOT NULL DEFAULT 10,    -- 연장/야간 산정 라운딩 단위(내림), 0=미적용
  min_overtime_minutes          integer NOT NULL DEFAULT 0,     -- 연장 인정 최소(주 단위, 이 미만은 0)
  exclude_leave_days            boolean NOT NULL DEFAULT true,  -- 휴가일은 실근무 합산·연장 산정에서 제외
  updated_at                    text    NOT NULL DEFAULT now()::text
);
INSERT INTO attendance_settings (id, updated_at)
VALUES ('default', now()::text)
ON CONFLICT (id) DO NOTHING;

-- ── ⑥ (수동) 컨트롤러 전용 최소권한 계정 — 자동 마이그 대상 아님 ─────────
-- 컨트롤러 PC의 "근태결과 DB 전송"이 접속할 격리 계정. 비밀번호를 넣어 운영자가 psql 로 직접 1회 실행.
-- (CREATE ROLE 은 멱등 처리가 번거로워 마이그에서 자동 실행하지 않는다.)
--   CREATE ROLE adt_writer LOGIN PASSWORD '***';
--   GRANT INSERT, SELECT, UPDATE ON adt_attendance_raw TO adt_writer;   -- 스테이징에만 접근, 코어 스키마 접근 불가
