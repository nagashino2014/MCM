-- 200: ADT캡스 근태 이벤트 로그(태그 단위) 수신 — 시간별 자동 근태 갱신.
-- 배경: 캡스 근태 매니저가 매시 28분에 인원별 태그 기록 txt 를
--   C:\Caps\ACServer\UniWorkProService\export 에 저장하도록 설정됨(ADT 기술지원).
--   사내 수집기(frontend/scripts/collect-caps-local.mjs, 매시 35분)가 이 파일을
--   /api/internal/adt-events-ingest 로 올리면 서버가 파싱해 이 테이블에 적재하고,
--   (사번, 일자) 단위로 출근/퇴근을 집계해 adt_attendance_raw(089) 스테이징에 수렴시킨다.
--   이후는 기존 파이프라인(ingestStaging → attendance_daily → attendance_weekly) 공용.
-- 파싱·집계 로직: frontend/lib/adt/events.ts
--
-- 원본 txt 필드(구분자 없음, "필드 선택" 순서): 시간(6)·사원번호·이름·근태내역(1)·
--   카드번호(13)·단말기ID(4)·고정값(없음)·일자+시간(14). 근태내역 1=출근 2=퇴근 5=출입.
-- 단말기ID 명칭(2026-08 실측): 0003 소회의실 · 0004 대회의실 · 0005 1208호 ·
--   0006 1206호 외부 · 0007 1206호 내부 · 0008 고문실 · 0009 대표실.

-- ── 이벤트 원본(태그 1건 = 1행, 무손실) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS adt_event_raw (
  e_idno      varchar(30) NOT NULL,            -- 사원번호(089 e_idno 와 동일 체계)
  event_at    timestamptz NOT NULL,            -- 태그 시각(KST 해석)
  event_code  text        NOT NULL,            -- 근태내역: '1' 출근 · '2' 퇴근 · '5' 출입 (기타 코드도 보존)
  terminal_id text        NOT NULL DEFAULT '', -- 단말기ID(위 명칭 주석 참조)
  d_date      varchar(8)  NOT NULL,            -- 일자 YYYYMMDD(원본 "일자+시간" 필드 앞 8자리)
  t_time      varchar(6)  NOT NULL,            -- 시간 HHMMSS(원본 그대로)
  e_name      text,                            -- 성명(원본 그대로)
  card_no     text,                            -- 카드번호(원본 그대로)
  source_file text,                            -- 수신 파일명(추적용)
  raw_line    text,                            -- 원문 라인(무손실·재파싱 대비)
  ingested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (e_idno, event_at, event_code, terminal_id)
);

-- 일별 집계(사번+일자 이벤트 재조회) 용
CREATE INDEX IF NOT EXISTS idx_adt_event_emp_date
  ON adt_event_raw (e_idno, d_date);
CREATE INDEX IF NOT EXISTS idx_adt_event_date
  ON adt_event_raw (d_date);
