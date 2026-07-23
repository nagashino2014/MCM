# ADT캡스(SK쉴더스) 근태 데이터 연동 — 개발 핸드오프

> 이 문서는 MCM 그룹웨어(Next.js)에서 **초과근무(연장근무) 산정 자동화**를 위해
> ADT캡스(SK쉴더스) 출입/근태 시스템의 데이터를 자체 DB로 받아오는 작업의 배경·설계·할 일을 정리한 것입니다.
> Claude Code 세션에서 이 문서를 먼저 읽고 작업을 시작하세요.

## 0. Claude Code 시작 프롬프트 (복붙용)

```
이 레포(MCM, Next.js 그룹웨어)에 ADT캡스(SK쉴더스) 근태 데이터를 받아 초과근무를
자동 산정하는 기능을 붙이려고 한다. docs/ADT_attendance_integration_handoff.md 를
먼저 읽고, 아래를 순서대로 진행해줘.
1) 현재 프로젝트의 DB 종류/ORM/디렉터리 구조를 파악해 요약
2) ADT 근태 데이터를 받는 "스테이징 테이블" 스키마 제안 및 마이그레이션 작성
3) 스테이징 → 정식 테이블로 옮기며 초과근무를 산정하는 인제스트(ingest) 모듈 작성
4) 파일(txt) 수신 방식과 DB 직접 수신 방식 둘 다를 고려해 인터페이스를 추상화
아직 확정 안 된 항목(문서 6장)은 나에게 질문으로 남겨줘.
```

## 1. 배경 / 목표

- 자체 개발 중인 그룹웨어(MCM, Next.js 추정)에서 직원 초과근무를 자동 산정하고 싶다.
- 외부 유료 근태 SaaS(flex, 샤플 등)는 비용·자체개발 취지 훼손 때문에 배제.
- 사내에 **ADT캡스 리모트 컨트롤러(ADT UniWork Pro 계열)** 가 이미 설치·운영 중이며,
  출입/근태 데이터가 구내 PC(`C:\Caps\ACServer\UniWorkProService\`)에 쌓이고 있다.
- 은행/카드 오픈API처럼 벤더 승인이 필요한 구조가 **아니다.** 데이터는 이미 우리 구내에 있고,
  컨트롤러의 내장 "외부전송" 기능을 관리자가 직접 켜서 우리 시스템으로 밀어넣으면 된다.

## 2. 확인된 외부전송 경로 (컨트롤러 "근태처리옵션" 스크린샷 3장 기준)

컨트롤러는 아래 3가지 자동 외부전송을 내장하고 있음 (관리자 설정만으로 활성화 가능).

### 2-1. 근태결과 DB 전송  ← 1순위 후보
- 컨트롤러가 **외부 DB 테이블에 직접 INSERT**.
- 설정 항목: 계정/암호, 대상 테이블(예: `hOutput`), "DB 접속" 테스트, 열(컬럼) 매핑.
- 매핑 가능한 원본 필드(=컨트롤러가 내보낼 수 있는 데이터):
  | 원본 필드 | 컬럼(예시) | 타입 | 의미 |
  |---|---|---|---|
  | ID | fpid | LONG | 내부 ID |
  | 부서 | c_dept | VARCHAR(20) | 부서 |
  | 직급 | c_pos | VARCHAR(8) | 직급 |
  | 그룹ID | e_group | SHORT | 그룹 |
  | 사원번호 | e_idno | VARCHAR(30) | 사번 (키) |
  | 이름 | e_name | VARCHAR(30) | 성명 |
  | 근무일자 | d_date | VARCHAR(8) | YYYYMMDD (키) |
  | 근무일명칭 | n_date | VARCHAR(31) | 근무일 명칭 |
  | 출근 | in_time | VARCHAR(6) | HHMMSS |
  | 퇴근 | out_time | VARCHAR(6) | HHMMSS |
  | 외출 | leave | VARCHAR(6) | |
  | 복귀 | return | VARCHAR(6) | |
  | 지각 | late | VARCHAR(4) | |
  | 조기 | early | VARCHAR(4) | |
  | **연장** | over | VARCHAR(4) | **초과근무(컨트롤러 산정치)** |
  | 심야 | night | VARCHAR(4) | 야간 |
  | 총합 | total | VARCHAR(4) | 총 근무 |
  | 인정 | allow | VARCHAR(4) | 인정시간 |
- "자동 근태처리시 전송 → 미전송 자료" 옵션으로 **증분 전송** 가능(새 기록만 전송) = 준실시간.
- "중복일 경우 데이터 덮어쓰기" 옵션 있음.
- ⚠️ 주의: 컨트롤러가 우리 DB에 직접 쓰므로, **전용 스테이징 테이블 + 최소권한 계정**으로 격리할 것.

### 2-2. 근태결과 파일생성  ← 2순위 후보(가장 안전/저결합)
- `ovrwrk_YYYYMMDD.txt` 형태로 날짜별 텍스트 파일 생성.
- 저장 경로: 로컬 또는 UNC 네트워크 공유(`\\192.168.0.1\export`), 서비스 계정 지정 가능.
- 필드 구분자(없음/공백0x20/탭0x09/기호), 컬럼 순서·자리수 커스터마이즈.
- Next.js 백엔드가 이 파일을 주기적으로 읽어 취식(ingest).

### 2-3. 웹 전송 / 다우오피스 연동  ← 참고(파트너 전용으로 보임)
- 이카운트 연동: `http://api.ecounterp.com/ECAPI/Groupware/CommuteTransfer/InsertWork...` 로 HTTP POST(+ 인증키).
- 다우오피스 연동: 도메인/사이트URL/관리자ID/파트너코드(ADTCAPS)/타입(ATTND).
- → 컨트롤러가 HTTP POST를 할 수 있다는 **증거**이지만, 특정 파트너 URL에 고정된 형태.
  우리 커스텀 엔드포인트로 바꿀 수 있는지는 **미확인**(6장 참조).

### 2-4. 주간 근태처리 옵션 (참고: 컨트롤러의 초과근무 산정 규칙)
- 주간근무 시작요일(월), 주 단위 근무제한 52시간.
- 기본 근무제한 40h / 연장 근무제한 12h, "인정시간으로 제한시간 계산" 옵션.
- 즉 위 `연장(over)` 필드는 이 규칙으로 이미 계산된 값. 우리 사규가 다르면 원본(출근/퇴근)으로 재계산.

## 3. 권장 아키텍처

```
[ADT 컨트롤러]
   ├─(A) DB 직접 INSERT ──▶ [MCM DB: 스테이징 테이블 adt_attendance_raw] ──┐
   └─(B) txt 파일 생성   ──▶ [네트워크 공유 폴더] ──(Next.js 파일 watcher)──┘
                                                                          │
                                                          [ingest 모듈] 정규화 + 초과근무 산정
                                                                          │
                                                                   [정식 근태/초과근무 테이블]
                                                                          │
                                                                   [그룹웨어 UI/리포트]
```

- **수신 계층을 추상화**: `AttendanceSource` 인터페이스 밑에 `DbStagingSource` / `FileSource` 두 구현.
  벤더 설정이 DB냐 파일이냐에 따라 스위칭. 나머지 파이프라인은 공통.
- **원본 보존**: 출근/퇴근 원본 시각 + 컨트롤러 산정 연장/심야/인정을 **둘 다 저장**.
  자체 산정값과 컨트롤러값을 교차검증(감사) 가능하게.
- **멱등성(idempotency)**: (사번 `e_idno` + 근무일자 `d_date`)를 자연키로 upsert. 재전송/중복 안전.

## 4. 데이터 계약(가정, 확정 필요)

- **대상 DB: PostgreSQL** (확인됨). flex 연동 사례가 PostgreSQL **ODBC**로 ADT 컨트롤러와
  붙는 방식이므로, 2-1 "DB 직접 전송" 경로는 실제로 검증된 조합.
  → 컨트롤러 쪽 "DB 접속"에는 **psqlODBC(PostgreSQL ODBC 드라이버)** 를 컨트롤러 PC에 설치해야 함.
- 자연키: `e_idno` + `d_date`
- 시각 포맷: `in_time`/`out_time` = `HHMMSS` 문자열 (자정 넘김/철야 처리 로직 필요)
- 시간 필드(연장/심야/총합/인정): 단위·포맷 확인 필요(분? 시:분? 소수시간?) → 6장
- 결번/미태그(퇴근 누락 등) 케이스 처리 규칙 필요

### 4-1. 스테이징 테이블 DDL (PostgreSQL, 제안)

> 컨트롤러가 문자열로 밀어넣을 수 있으므로 원본은 **문자열 그대로 받고**(무손실),
> 파싱/형변환은 ingest 단계에서 수행. 컨트롤러는 이 테이블에만 INSERT 하도록 격리.

```sql
CREATE SCHEMA IF NOT EXISTS adt;

CREATE TABLE IF NOT EXISTS adt.attendance_raw (
    fpid        bigint,               -- 컨트롤러 내부 ID
    c_dept      varchar(20),          -- 부서
    c_pos       varchar(8),           -- 직급
    e_group     smallint,             -- 그룹ID
    e_idno      varchar(30) NOT NULL, -- 사번 (키)
    e_name      varchar(30),          -- 성명
    d_date      varchar(8)  NOT NULL, -- 근무일자 YYYYMMDD (키)
    n_date      varchar(31),          -- 근무일 명칭
    in_time     varchar(6),           -- 출근 HHMMSS
    out_time    varchar(6),           -- 퇴근 HHMMSS
    leave_time  varchar(6),           -- 외출  (leave/return/late/early: 예약어·혼동 피해 별칭)
    return_time varchar(6),           -- 복귀
    late_time   varchar(4),           -- 지각
    early_time  varchar(4),           -- 조기
    over_time   varchar(4),           -- 연장(컨트롤러 산정 초과근무)
    night_time  varchar(4),           -- 심야
    total_time  varchar(4),           -- 총합
    allow_time  varchar(4),           -- 인정
    ingested_at timestamptz NOT NULL DEFAULT now(),
    processed   boolean     NOT NULL DEFAULT false,  -- ingest 처리 여부
    PRIMARY KEY (e_idno, d_date)
);

CREATE INDEX IF NOT EXISTS idx_att_raw_unprocessed
    ON adt.attendance_raw (processed) WHERE processed = false;
```

> 참고: 컨트롤러 매핑 UI의 원본 컬럼명(leave/return/late/early/over/night/total/allow)은
> PostgreSQL 예약어와 겹칠 수 있어 위처럼 `_time` 접미사로 매핑하는 것을 권장.
> 컨트롤러 "열 선택"에서 대상 컬럼명을 위 이름에 맞춰 지정하면 됨.

### 4-2. 최소권한 계정 (컨트롤러 전용)

```sql
CREATE ROLE adt_writer LOGIN PASSWORD '***';
GRANT USAGE ON SCHEMA adt TO adt_writer;
GRANT INSERT, SELECT, UPDATE ON adt.attendance_raw TO adt_writer;
-- 코어 스키마 접근 권한은 주지 않음. 컨트롤러는 adt 스키마에만 접근.
```

### 4-3. 스테이징 → 정식 테이블 upsert (멱등, 예시)

```sql
INSERT INTO attendance_daily (emp_no, work_date, in_at, out_at,
                              overtime_min_vendor, night_min_vendor, source)
SELECT e_idno,
       to_date(d_date, 'YYYYMMDD'),
       -- HHMMSS → time (NULL/빈문자 방어)
       CASE WHEN in_time  ~ '^\d{6}$' THEN to_timestamp(d_date||in_time,  'YYYYMMDDHH24MISS') END,
       CASE WHEN out_time ~ '^\d{6}$' THEN to_timestamp(d_date||out_time, 'YYYYMMDDHH24MISS') END,
       NULLIF(over_time,  '')::numeric,   -- 단위 확정 후 조정
       NULLIF(night_time, '')::numeric,
       'adt'
FROM adt.attendance_raw
WHERE processed = false
ON CONFLICT (emp_no, work_date) DO UPDATE
   SET in_at = EXCLUDED.in_at,
       out_at = EXCLUDED.out_at,
       overtime_min_vendor = EXCLUDED.overtime_min_vendor,
       night_min_vendor = EXCLUDED.night_min_vendor,
       updated_at = now();
-- 처리 완료 표시
-- UPDATE adt.attendance_raw SET processed = true WHERE processed = false;  (동일 트랜잭션 내)
```

> 퇴근이 자정을 넘기면 `out_at < in_at`이 되므로, 이 경우 `out_at`에 +1일 보정하는 로직을 ingest에 둘 것.
> `overtime_min_vendor`는 **컨트롤러 산정치(감사용)**, 자체 사규 산정치는 별도 컬럼에 저장해 교차검증.

## 5. 개발 태스크(제안 순서)

1. 레포 파악: DB 종류(MySQL/PostgreSQL/MSSQL 등), ORM(Prisma/Drizzle/기타), 디렉터리 구조 요약.
2. `adt_attendance_raw` 스테이징 테이블 스키마 + 마이그레이션.
3. 파서: txt 파일 포맷(구분자/컬럼순서) → 레코드 파싱 (FileSource).
4. DB 수신: 스테이징 테이블 read (DbStagingSource). (컨트롤러가 여기에 INSERT)
5. 정규화 + upsert(멱등) → 정식 테이블.
6. 초과근무 산정기: 사규 반영(주 52h/일 규칙 등). 컨트롤러 `over`값과 비교 로그.
7. 스케줄러(cron/Next.js route handler + 작업큐)로 주기 실행.
8. 관리자 화면: 수신 현황/미처리/불일치 리포트.
9. 테스트: 샘플 txt/샘플 레코드로 유닛테스트(자정 넘김·중복·누락 케이스 포함).

## 6. SK쉴더스/대리점에 확인해야 할 미확정 사항

1. `근태결과 DB 전송`이 **PostgreSQL ODBC(psqlODBC)** 를 지원하는지, 컨트롤러 PC에 드라이버 설치가 필요한지. (flex는 이 조합으로 연동됨 — 지원 가능성 높음)
2. 대상 테이블 스키마를 우리가 정의 가능한가, 아니면 고정 형식(`hOutput`)에 맞춰야 하나?
3. "자동 전송"이 근태처리 실행마다 도는가, 스케줄 주기는?
4. 시간 필드(연장/심야/총합/인정)의 단위·포맷.
5. `웹 전송` URL/인증키를 우리 커스텀 엔드포인트로 지정 가능한가?
6. 컨트롤러 소프트웨어 정확한 제품명/버전.

## 7-1. 구현 현황 (1차 — 데이터 파이프라인)

> 아래는 이 레포에 실제 구현된 내용. 관례에 맞춰 스키마는 `public` + `NNN_*.sql`(문서 §4 의 `adt` 스키마 제안 대신), DB 접근은 `@/lib/db`(`getDb`/`withDbWrite`).

**우리 측 확정 사항(6장 미확정과 별개로 결정)**
- 직원 매칭: `employee_profiles.adt_emp_no` 매핑 컬럼 신설. ingest 는 이 값 우선, 없으면 `employee_no` fallback. 미매칭 행은 `attendance_daily.employee_id = NULL` + 로그 경고.
- 수신 방식: `DbStagingSource`·`FileSource` 둘 다 추상화(`AttendanceSource`). 스테이징 `adt_attendance_raw` 로 수렴 후 공통 정규화.
- 초과근무: **자체 재산정 우선**(사규 반영), 컨트롤러 `over/night/total/allow` 는 `vendor_*_raw` 로 무손실 병행 보존(감사).
- 사규 산정 모델: **주(일요일 시작) 단위**. 주 소정 40h 초과분이 연장, 인정 한도 12h(초과분 `excess` = 특별휴가 대상, **1차는 감지·리포트만**). 연장 중 **야간(22:00~06:00)** 몫 2.0배(`overtime_night`), 나머지 1.5배(`overtime_day`).
- 수당 **금액**(월평균임금÷209×배수)은 앱에 급여 데이터가 없어 **후속**. 1차는 시간·배수 대상시간까지 산정. 정책에 `wage_divisor_hours=209`, 배수는 보관.

**파일 구성**
- `infra/aws/089_adt_attendance.sql` — ① `adt_attendance_raw`(스테이징) ② `attendance_daily`(일별) ③ `attendance_weekly`(주별 산정) ④ `employee_profiles.adt_emp_no` ⑤ `attendance_settings`(정책, 사규 기본값 시드) + 컨트롤러 전용 최소권한 계정 SQL(주석, 수동 실행).
- `frontend/lib/adt/{types,settings,overtime,source,ingest}.ts` — 타입·정책·순수 산정기·수신 추상화·인제스트 파이프라인.
- `frontend/scripts/adt-ingest.ts` + `build-batch.mjs`(엔트리 추가) — 배치 엔트리(`.next/adt-ingest.cjs`).
- `infra/aws/adt-ingest.tf` — EventBridge `rate(30 minutes)` → ECS RunTask(next 이미지, `ADT_INGEST_MODE=db`).
- 산정기 검증: 순수함수 25 케이스(자정 넘김·야간 겹침·주 초과·배분·휴가일 제외·라운딩) 통과.

**아키텍처 유의점**
- 클라우드 배치(EventBridge→Fargate)는 **DB 모드**용. **file 모드는 사내 UNC 공유에 접근해야 하므로 사내 러너에서** `node .next/adt-ingest.cjs`(`ADT_INGEST_MODE=file ADT_FILE_DIR=... `)로 실행.
- 파일 포맷(구분자/컬럼순서/인코딩)은 벤더 설정 후 실측 필요 — `FileSourceOptions`/env(`ADT_FILE_DELIMITER` 등)로 조정. 한글이 EUC-KR 이면 iconv 추가(후속).

**배포 시 수동 절차(사용자 몫)**
1. Aurora(및 로컬 DB)에 `089_adt_attendance.sql` psql 적용.
2. 컨트롤러 전용 계정 생성(089 하단 주석의 `CREATE ROLE adt_writer ...`, 비밀번호 지정).
3. `next` 이미지 재배포(배치 번들 포함) 후 `terraform apply`(adt-ingest 스케줄 생성).
4. 컨트롤러 "근태결과 DB 전송" 설정: psqlODBC 설치, 대상 `adt_attendance_raw`, 열 매핑(§4-1 컬럼명), 미전송 자료만 증분 전송.

## 7-2. 구현 현황 (2차 — 관리자 UI)

- 화면 `/approval/attendance`([app/(app)/approval/attendance/page.tsx](../frontend/app/(app)/approval/attendance/page.tsx) → [AttendanceBoard.tsx](../frontend/components/approval/AttendanceBoard.tsx)) — cdash 스타일, 탭 3종:
  - **주별 초과근무**: 주(일요일 시작) 선택·KPI(인정연장/야간/12h초과 인원)·직원별 연장(1.5)/야간(2.0)/12h초과, 행 펼침 → 일별 상세(출퇴근·야간·벤더연장·휴가일).
  - **미매칭 매핑**: `employee_id` NULL 인 ADT 사번 → 직원 지정(즉시 rebind + 스테이징 재처리 예약). 탭 배지로 미매칭 수 표시.
  - **산정 정책**: `attendance_settings` 편집(주 소정/연장한도/휴게/야간구간/배수/제수/라운딩/휴가일 제외).
- API [app/api/approval/attendance/route.ts](../frontend/app/api/approval/attendance/route.ts) — `requirePermission("approval.manage", { fallbackRoles:["admin"] })` + `recordAuditLog`. lib [lib/adt/queries.ts](../frontend/lib/adt/queries.ts)(조회·매핑·정책).
- 메뉴: 전자결재 서브메뉴에 "근태·초과근무 관리" 추가([config/menu.ts](../frontend/config/menu.ts)). 감사액션 `adt_attendance_map`·`adt_attendance_settings`.
- 시각 확인은 089 적용·데이터 수신 후 배포에서(Ctrl+Shift+R).

**남은 후속(3차)**
- 급여 데이터 연동 → 수당 금액 산정(월평균임금÷209×배수). 특별휴가 자동 적립(선택).
- 파일(txt) 포맷 실측 반영(구분자/컬럼/인코딩), 컨트롤러 실제 전송 실증.

## 7. 참고 자료

- 세콤/SK쉴더스/KT텔레캅 연동 유의사항(샤플): https://www.shoplworks.com/help-center/help-center-admin/security-attendance-integration-cautions
- ADT캡스 연동 가이드(flex, 외부전송 DB/ODBC): https://guide.flex.team/ko/articles/10293435
- ADT캡스×하이웍스 연동 사례: https://developers.hiworks.com/case-studies/adt
- SK쉴더스 출입/근태 보안: https://www.skshieldus.com/kor/service/physical/access/attendance.do
