# 급여·근로계약 관리 블루프린트 (PL: Payroll & Labor-contract)

> 작성: 2026-08-13 · 상태: **확정(2026-08-13 사용자 답변 반영)** — §8 확정 결정 참조
> 범위: ① 과거 급여대장 엑셀 전체 DB화 ② 급여대장 조회·생성 ③ 근로계약서 스캔본 데이터화(재직자) ④ 근로계약서 작성·결재·발송·전자서명 ⑤ 급여 연계 초과근무수당 금액 산정(ADT "3차")
> 후속(이번 범위 아님): 급여명세서 개인 발송, 성과급 BS-P4(반기×직원 급여 그릇), 4대보험·원천세 자동 계산

---

## 1. 원천 자료 실사 결과

### 1-1. 급여대장 (`V:\업무자료\경리업무\급상여대장`)
- 연도 폴더 `2016년`~`2026년`, xlsx 127개 중 **119개 파싱 성공** (헤더 자동 인식 검증 완료).
- **공통 3단 구조**: 헤더 3행(사원번호/성명 행, 입사일/직급 행, 퇴사일/부서 행) ↔ 직원당 3행 블록이 1:1 대응.
  한 열이 최대 3개 항목을 가짐(예: C열 = 기본급 / 주거비지원 / ―). 열 수는 16~20으로 연도별 상이.
- 시트는 항상 1개(`Table 1`). 지급합계·공제합계·차인지급액이 항상 존재 → **파싱 자체 검증에 사용**.
- 항목 전수조사(119파일) 결과:
  - 지급 약 30종: 기본급, 상여, 전월미지급금, 식대, 초과근무수당, 연차수당, 성과급, 자격증수당, 연구수당, 통신비, 출장숙박수당, 전문가활동비, 주거비지원, 차량유지비, 기타수당, 출장수당, 육아수당, 숙박수당, 지방파견비(=지방파견수당), 초과근무 식대, 정산 경비, 핵심인력성과보상금_일반, 양육수당(계약서상) 등
  - 공제 17종: 국민연금, 건강보험, 고용보험, 장기요양보험료, 소득세, 지방소득세, 정산-국민연금/건강보험/고용보험/장기요양/근로소득세/지방소득세, 연말정산소득세/지방소득세/농특세, 선지급분공제, 기타공제(=그외공제), 공제_학자금상환, 농특세, 비과세계 등
  - 동일 항목의 표기 변형 존재(예: `건강보험정산`↔`정산-건강보험`, `기타공제`↔`그외공제`, `지방파견비`↔`지방파견수당`) → **별칭(aliases) 정규화 필요**
- **문제 파일 8개** (처리 확정):
  | 파일 | 상태 | 처리 |
  |---|---|---|
  | 2016년 3~7월 대장 (5개) | 암호화 → **암호 `1234` 복호화 검증 완료**, 구조 동일·신규 항목 없음 | 복호화 후 동일 파서로 적재 |
  | 8월급여지급결의서 (내용상 7월 지급결의서) | 암호 `1234` 열림 | **제외**(지급결의서류 제외 확정) |
  | 16'설상여금명세.xlsx | 헤더 상이(설 상여 전용 양식) | 개별 파서 or 수기 등록 |
  | 2025년 직원별 연봉.xlsx | 급여대장 아님(연봉 요약) | 마이그레이션 제외, 검증 대조용 |
- **누락 월**: 2016년 2월·9월·11월 xlsx 부재, 10월은 PDF만 존재 → **자료 없는 달은 건너뜀 확정**(초창기 소인원, PDF 파싱 보충도 하지 않음).
- 별도 상여대장 존재: `17년08월 상여대장`, `19년07월 상여(하계휴가)대장`, `19년09월 상여(추석)대장` → 같은 3단 구조이면 동일 파서로 적재(월 내 복수 대장 허용 필요).

### 1-2. 근로계약서 (`V:\업무자료\경리업무\근로계약서`)
- 연도 폴더 `2018년`~`2026년` + 잡폴더(`근로계약`, `인턴계약서`, `171101 최상보부사장…`). PDF 스캔본 약 300개(하위 폴더 사본 중복 다수 → **sha256 dedup 필수**).
- 파일명 패턴 일관: `이름 직급 근로계약서(YYYY.MM.DD.).pdf` + 변형(`임원계약서`, `고문계약서`, `승진`, 기간형 `(2025.03.01.~2026.02.28.)`, 오타 `근로게약서`) → 1차 메타데이터 소스.
- 스캔 품질 양호(정형 서식+표) → **Claude 멀티모달 파싱 가능**(사업자등록증/명함 추출과 동일 주경로, [doc-extraction-architecture] 패턴).
- 계약서 내용 구조(2026 양식 기준): 갑/을 인적사항 → 13개 조문 → 서명부.
  추출 대상 필드: **작성일, 근로자명, 최초입사일, 연봉계약기간(from~to), 담당업무, 직위, 근로시간(§4), 연봉총액, 월 임금 구성표**(기본급/식대/차량유지비/양육수당/연구수당/업무수당/자격수당/고정연장·휴일·야간수당/연차수당/월급여), 수습 여부.
- 양식 4종(2026 폴더): 정규직(연봉제) / 연구원 / 승진·단기 계약직 / 아르바이트. 임원·고문 계약서는 별도 서식.
- **재직자만 데이터화**(사용자 확정). 퇴사자 스캔본은 수집하지 않음 — 트리뷰 '퇴사자' 노드는 앱 구축 이후 퇴사하는 인원용.

### 1-3. UI 컨셉 PDF 요지 (`급여, 근로계약 UI.pdf`)
"직원별 연봉/근로 계약 현황" 단일 화면 2모드:
- 좌: **트리뷰**(조직도, `☑ 퇴사자도 표시` → '퇴사자' 부모노드 별도 표기)
- 우 상단: 선택 직원의 **근로계약 카드 목록**(계약 건마다 카드) — 작성/갱신일·연봉총액(기본급)·연봉계약 기간·당시 직급 표시, 좌상단 `일반`/`승진` 태그, 우측 다운로드 버튼(스캔본=원본 PDF, 앱 생성분=생성 PDF). 영역 높이 고정+세로 스크롤(스크롤바 숨김).
  - 일반/승진 판정 규칙: 입사일에 작성된 것이 아니고, 직전 계약서상 직급보다 승진했으면 `승진`, 아니면 `일반`.
- 우 하단: **근로계약서 작성/갱신 패널** — 탭 2개
  - `일괄`: 작성/갱신 기준일(기본 매년 1/1), 전년도 물가상승률 %, 추가 보정 비율 %, 5개년 물가상승률·추가보정 추이 그래프, 대상 범위(`임원 제외`(기본)/`전체`), [일괄 작성]
  - `개별(승진)`: 작성/갱신 기준일, 승진 직급 선택(목록박스 — **현 직급 바로 위, 그 다음 위 직급만 표시**), 승진 이력(직급·승진일자 목록, 세로 스크롤), 기존 급여액, 급여 승급액, [계약서 작성]

---

## 2. DB 설계 (신규 마이그레이션 `155_`부터)

기존 관례 준수: text PK, timestamp는 text(ISO), 멱등 SQL, 파일 상단 한글 주석. 직원 참조는 `employee_profiles`(+`users` 양방향 LEFT JOIN 방어 패턴).

### 2-1. `155_payroll_core.sql` — 급여대장

```sql
-- 급여 항목 사전 (전수조사 결과 시딩)
payroll_item_defs (
  item_id text PK,                -- 예: 'base', 'meal', 'overtime', 'ded-nps'...
  name text UNIQUE,               -- 정규화 명칭 (예: '기본급')
  kind text CHECK ('pay'|'deduction'),
  aliases jsonb DEFAULT '[]',     -- 표기 변형 흡수 (예: ["그외공제"] → 기타공제)
  in_ordinary_wage boolean DEFAULT false,  -- 통상임금 산입 여부 (P4 초과근무 시급 산정용)
  taxable boolean,                -- 과세 여부 (후속 명세서용, nullable)
  display_order integer, is_active boolean DEFAULT true
)

-- 월별 대장 (한 달에 급여대장+상여대장 복수 허용)
payroll_ledgers (
  ledger_id text PK,
  pay_year integer, pay_month integer,
  ledger_kind text DEFAULT 'salary',   -- 'salary'|'bonus'(별도 상여대장)|'holiday'(명절)
  title text,                          -- 원본 제목 (예: '2026년 3월분 급상여대장')
  source text CHECK ('excel'|'app'),   -- 마이그레이션 / 앱 생성
  source_file text,                    -- 원본 상대경로
  status text DEFAULT 'confirmed',     -- 'draft'|'confirmed' (엑셀분은 confirmed)
  note text, created_at text,
  UNIQUE (pay_year, pay_month, ledger_kind)
)

-- 직원×대장 1행 (퇴사자 = employee_id NULL + 스냅샷만)
payroll_entries (
  entry_id text PK, ledger_id FK,
  employee_id text NULL,               -- employee_profiles 매칭 (사번+성명, 실패 시 NULL)
  emp_no text, name text,              -- 원본 스냅샷
  dept_name text, position_name text,  -- 원본 스냅샷 (당시 부서·직급)
  hired_at text, resigned_at text,     -- 원본 스냅샷 (퇴사일 컬럼은 대장이 유일한 소스인 경우 有)
  pay_total numeric, deduction_total numeric, net_pay numeric,  -- 원본 합계(검증 기준값)
  row_order integer, note text
)

payroll_entry_lines (
  line_id text PK, entry_id FK,
  item_id FK → payroll_item_defs,
  amount numeric                        -- 0/공란은 행 미생성
)
```

- **검증 규칙(파서 내장)**: Σ지급라인=pay_total, Σ공제라인=deduction_total, pay_total−deduction_total=net_pay. 불일치 시 해당 entry에 `note` 기록 + 리포트 출력(silent pass 금지).
- 직원 매칭: `employee_profiles.employee_no` 및 성명으로 매칭, 동명이인·사번 변경은 리포트 확인. 미매칭(퇴사자)은 employee_id NULL 유지 — 이후 스냅샷 성명 기준 그룹핑으로 "퇴사자 연간 뷰"도 제공 가능.

### 2-2. `156_labor_contracts.sql` — 근로계약

```sql
labor_contracts (
  contract_id text PK,
  employee_id text FK,                  -- 재직자 데이터화이므로 NOT NULL 기본
  kind text,                            -- 'regular'|'promotion'|'executive'|'fixed_term'|'advisor'|'intern'|'parttime'
  tag text,                             -- '일반'|'승진' (카드 태그, 자동판정 후 수정 가능)
  contract_date text,                   -- 작성일
  effective_from text, effective_to text,  -- 연봉계약 기간 (무기한 계약이라도 연봉기간은 1년)
  position_name text,                   -- 계약서상 직위 (스냅샷)
  duty text,                            -- 담당 업무
  first_hired_at text,                  -- 계약서상 최초입사일
  annual_salary numeric,                -- 연봉총액
  monthly_salary numeric,               -- 월 급여
  wage_components jsonb,                -- {"기본급":3971667, "식대":..., ...} 월 임금 구성표
  work_hours jsonb,                     -- §4 근로시간 (시업/종업/휴게, 주간·야간 등 변형 수용)
  probation boolean DEFAULT false,
  source text CHECK ('imported'|'generated'),
  file_storage_provider/bucket/key text, file_sha256 text,  -- 스캔 원본 or 생성 PDF (S3)
  status text,                          -- imported | draft | pending_approval | approved | sent | signed | void
  approval_doc_id text,                 -- 결재 문서 연결 (일괄 기안 시 라운드의 doc 공유)
  round_id text NULL,                   -- 일괄 작성 라운드 참조
  sent_at text, signed_at text,
  signatures jsonb,                     -- 전자서명 5종 기록 (서버 생성 문자열, §5-4)
  extraction_meta jsonb,                -- 멀티모달 파싱 원본 응답·신뢰도 (imported 전용)
  created_at text, updated_at text
)

-- 일괄 작성 라운드 (연 1회 갱신 + 수시 승진)
labor_contract_rounds (
  round_id text PK,
  base_date text,                       -- 작성/갱신 기준일 (기본 YYYY-01-01)
  round_kind text CHECK ('annual'|'promotion'),
  cpi_rate numeric,                     -- 전년도 물가상승률 %
  extra_rate numeric,                   -- 추가 보정 비율 %
  scope text CHECK ('exclude_exec'|'all'),
  status text,                          -- draft | pending_approval | approved | sent | closed
  approval_doc_id text, created_by text, created_at text
)
```

- 5개년 추이 그래프는 `labor_contract_rounds`의 annual 라운드 이력에서 조회(초기엔 데이터 없음 → 수기 백필 입력 UI 또는 공공 CPI 참고 표기).
- 승진 직급 선택 목록: `positions.rank_order` 기준 현 직급 바로 위 2단계만 노출.
- 임원 판정: `positions.rank_order >= EXEC_RANK_CUTOFF(82)` — bonus 모듈 상수 재사용.

### 2-3. `157_labor_contract_form.sql` — 전자결재 양식 시딩
`frm-labor-contract-batch`(연간 일괄)·개별 승진 겸용 1양식. bonus `152_bonus_p3.sql` 패턴: `approval_forms` INSERT + table 필드(대상자/직급/현재연봉/갱신연봉/인상률). 대표이사 1단계 직결(`findCeoUserId()` 재사용).

---

## 3. 마이그레이션 파이프라인 (scripts/)

### 3-1. 급여대장 엑셀 → DB (`scripts/payroll_import/`)
1. **inventory**: 대상 파일 수집(연도 폴더 xlsx), sha256, 연/월/종류(급여·상여·명절) 파일명 파싱.
2. **parse**: openpyxl. 헤더 자동 탐지('사원번호' 행) → 3단 헤더맵[(행offset, 열)→항목명] 구성 → 직원 3행 블록 순회. 합계 열(지급합계 등)은 항목이 아니라 검증값으로 분리.
3. **normalize**: 항목명 → `payroll_item_defs` 별칭 매칭(신규 항목 발견 시 사전에 자동 추가 + 리포트 표기).
4. **match**: 사번+성명 → employee_profiles. 미매칭은 NULL(퇴사자).
5. **validate**: 3중 합계 대조(§2-1). 파일 단위 통과율 리포트(md) 생성 → **사용자 검수 후 적재 확정**.
6. **load**: staging DB에 멱등 UPSERT(ledger 단위 재실행 가능 — 기존 entries 삭제 후 재삽입).
- 암호화 5파일(2016년 3~7월): 암호 `1234`, `msoffcrypto`로 복호화 후 동일 파이프라인(검증 완료).
- 실행 환경: 로컬 → staging DB(SSM 터널, [ieps-dart-access-patterns] 경로).

### 3-2. 근로계약서 PDF → DB (`scripts/labor_contract_import/`)
1. **inventory**: 전 폴더 재귀 수집 → sha256 dedup → 파일명에서 성명·직급·날짜 파싱.
2. **filter**: 현 재직자(`employee_profiles.status='active'`) 성명 매칭 건만 대상(동명이인 확인 리포트). 퇴사자·인턴 스캔본 제외.
3. **extract**: 파일별 Claude 멀티모달 호출(Haiku 기본, 실패·저신뢰 시 상위 모델 재시도 — 명함 추출과 동일 기조). 프롬프트는 §1-2 필드 스키마 고정(JSON). 응답 원문은 `extraction_meta`에 보존.
4. **verify**: 파일명 메타(성명·직급·날짜) vs 추출값 교차 검증, 연봉총액 vs 월급여×12 대조. 불일치·저신뢰 건은 **검수 큐**로.
5. **load**: `labor_contracts(source='imported', status='imported')` + 원본 PDF S3 업로드(`employee_documents` 연결). 사람별 시간순 정렬 후 `일반/승진` 태그 자동판정(§1-3 규칙, `employee_hr_events` promotion 이력 참조 보강).
6. **검수 UI**(P2에 포함): 현황 화면에서 카드별 "추출값 검토" — 원본 PDF 뷰어와 나란히 수정·확정.

---

## 4. 화면 설계 (메뉴·UI)

메뉴: `config/menu.ts` `group:"work"`, 성과급과 근태·휴가 사이. `minRole:"admin"`(성과급과 동일 기조 — 급여는 민감 데이터, 모바일 미노출 원칙 유지).

```
급여·근로계약  (href: /payroll, icon: Wallet)
 ├ 급여대장            /payroll
 ├ 직원별 연봉·근로계약  /payroll/contracts
 └ 급여 항목·설정       /payroll/settings
```

모든 화면 cdash 컨셉(`.cursor/rules/ui-modernize.mdc` 준수), 실질 UI는 `components/payroll/XxxBoard.tsx` 클라이언트 컴포넌트.

### 4-1. 급여대장 (`/payroll`) — `PayrollLedgerBoard`
- 상단: 연·월 셀렉터 + 대장 종류 탭(급여/상여) + KPI 4종(지급합계/공제합계/차인지급액/인원수).
- 본문: **플랫 그리드**(직원 1행 — 3단 구조는 원본 재현이 아니라 열=항목으로 펼침). 값 있는 항목 열만 표시, 가로 스크롤. 열 고정: 사번·성명·부서·직급.
- 행 클릭 → 상세 패널(해당 직원 당월 지급/공제 전체 항목 + 원본 스냅샷).
- 부가 뷰: **직원별 연간 추이**(직원 선택 → 12개월 항목별 표+차트), 원본 엑셀 출처 표기.
- 신규 대장 생성(P4): [새 대장] → 전월 복사(뼈대) → **항목별 설정 메뉴 자동 반영 + 4대보험·세금 자동 산출**(§6-2) → 초과근무수당 자동 채움(§6) → 편집 → 확정(`status='confirmed'`).
  단순 전월 복사가 아님 — 상세 요건·조사 과제는 §6-2 참조(2026-08-14 사용자 확정).

### 4-2. 직원별 연봉·근로계약 현황 (`/payroll/contracts`) — `LaborContractBoard` (UI PDF 컨셉 구현)
- 좌: 조직 트리뷰(departments→직원). `☑ 퇴사자도 표시` 시 '퇴사자' 부모노드(앱 구축 후 퇴사자만 누적).
- 우상: 계약 카드 목록(시간 역순, 고정 높이+내부 스크롤). 카드: `일반|승진` 태그, 작성/갱신일, 직급, 연봉총액·기본급, 연봉계약 기간, [다운로드]. imported 건은 "추출값 검토" 진입점.
- 우하: 작성/갱신 패널 — `일괄` / `개별(승진)` 탭(§1-3 그대로). 일괄 산식: **갱신 연봉 = 현행 연봉 × (1 + 물가상승률% + 추가보정%)**, 반올림은 **월급여 기준 천원 단위 미만 절사**(확정) 후 ×12. 미리보기 표(전원 현행→갱신) 확인 후 draft 일괄 생성.

### 4-3. 급여 항목·설정 (`/payroll/settings`)
- 항목 사전 CRUD(별칭 관리·통상임금 산입 토글·정렬), 물가상승률 라운드 이력 관리(5개년 그래프 데이터), 마이그레이션 리포트 열람.

---

## 5. 근로계약서 작성 → 결재 → 발송 → 전자서명

### 5-1. 생성
- 서식: 현행 2026 양식(§1-2 13개 조문)을 pdf-lib 직접 렌더(`lib/payroll/contract-pdf.ts`, `bonus/statement-pdf.ts` 이식 — 맑은고딕+직인 `public/letter/stamp.png`). 조문 텍스트는 DB 템플릿(`labor_contract_templates`, `leave_notice_templates` jsonb 문단+치환 토큰 패턴)으로 두어 연도별 개정 대응(버전 컬럼).
- 값 주입: 갑 고정정보 + 을(employee_profiles: 성명·생년월일·주소·연락처) + §3(담당업무·직위) + §6(연봉·임금구성표 — 직전 계약 wage_components에 인상률 적용) + §4 근로시간(직전 계약 승계, 예외자는 개별 수정).

### 5-2. 결재 게이트 (신규 구현)
- 일괄 작성 시 라운드 생성(`labor_contract_rounds.draft`) → [기안] 버튼 → `frm-labor-contract-batch` 기안 자동 생성(대상자 표 포함, 대표이사 1단계) → 사용자 상신.
- **결재 완료 웹훅/조회 시점에 라운드 `approved` 전환 — 발송 버튼은 approved 전까지 비활성**(bonus와 달리 시스템 게이트 강제. `approval_docs.status` 조회로 판정).
- 개별(승진) 건도 동일 흐름(1인 라운드).

### 5-3. 발송
- 앱 내 수신: 홈 "수신 문서함" 위젯(`LeaveNoticeInboxCard` 패턴 확장 or 별도 `ContractInboxCard`) — 근로자가 본인 계약서 PDF 열람.
- 메일 통지 병행(`lib/mail/send`, 열람 링크 — 계약서 PDF 자체는 메일 첨부하지 않고 앱 내 열람 권장: 임금 기밀).
- 발송 이력: `sent_at` + 라운드별 발송 결과 3분류(sent/skipped/failed — bonus `send.ts` 패턴).

### 5-4. 전자서명
- 서명 5종: 본서명 + 부속 4종(교부 확인·시간외근로 동의·취업규칙 열람·개인정보 동의) — 각각 체크 동의 필수 후 [서명] 1회 클릭.
- 서명 문자열은 **서버 생성**: `성명(사번) · ISO시각` (`leave-promotion.ts` 방식) + **`CONSENT_VERSION` 고정**(`overtime-consent.ts` 방식 — 조문 템플릿 버전과 연동). 전자서명법 §3 문구 명시.
- 서명 완료 시 `status='signed'`, 서명 텍스트를 PDF 서명란에 각인한 **확정본 PDF 재생성** 후 S3 보관(원본 draft PDF와 별도) → 카드 다운로드는 확정본.
- 미서명자 리마인드: 라운드 화면에서 미서명 목록 + 재통지 버튼.

---

## 6. 초과근무수당 금액 산정 (ADT "3차" 완결)

- **통상시급 = 통상임금 월액 ÷ 209** (`attendance_settings.wage_divisor_hours`).
  통상임금 월액 = 해당 월 유효한 `labor_contracts.wage_components` 중 `payroll_item_defs.in_ordinary_wage=true` 항목 합(확정: 기본급+식대+자격증수당+연구수당 등 **고정성 수당 산입** — 항목 사전 시딩 시 in_ordinary_wage 초기값 부여, 설정 화면에서 토글 가능).
- 금액 = 통상시급 × (1.5 × `attendance_weekly.overtime_day_minutes`/60 + 2.0 × `overtime_night_minutes`/60) — 배수는 `attendance_settings` 값 사용.
- **귀속 구간(확정): 전월 26일 ~ 금월 25일** (급여 말일 지급 관행). 주 단위 산정값이 구간 경계에 걸치는 주는 **주 내 초과근무 발생일 기준 일할 배분**으로 구간에 귀속(`attendance_daily` 참조, 세부 배분식은 구현 시 실데이터로 검증).
- 반영처:
  1. 근태·초과근무 관리 화면(`/approval/attendance`) 주별 그리드에 **예상 수당 금액 열** 추가.
  2. 급여대장 신규 생성 시(§4-1) 귀속 구간(전월 26~금월 25) 합산액을 `초과근무수당` 항목으로 자동 채움(수기 조정 가능).
- 급여 데이터 소스 우선순위: signed 근로계약(wage_components) → 없으면 최근 확정 급여대장의 통상임금 항목 합(폴백).

---

## 6-2. 신규 급여대장 생성 상세 (P4 — 2026-08-14 요건 확정)

> 현행 실무: EDI(4대보험 포털)에서 받은 자료를 세무사에 전달 → 세무사가 급여대장을 작성해 회신.
> 목표: 이 과정을 앱 내재화 — EDI 자료 입력만으로 대장이 자동 완성되는 구조.

### A. 지급 항목 — 항목별 설정 메뉴 (전월 복사와 별도)
아래 6종은 직원별 **지급 규칙을 설정 메뉴에 등록**해 두면 대장 생성 시 자동 반영(수기 조정 가능):

| 설정 메뉴 | 규칙 형태(안) |
|---|---|
| 자격증 수당 | 직원별 보유 자격증·수당액 등록(복수 합산), 취득/만료일로 기간 제어 |
| 주거비 지원 | 직원별 금액 + 지원 기간(시작~종료) |
| 숙박수당 | 직원별 금액 + 지급 기간(지방 파견 등) |
| 육아수당 | 직원별 금액 + 자녀 기준 지급 기간 |
| 장기근속수당 | 근속연수 구간별 금액 테이블(입사일 기준 자동 판정) 또는 직원별 지정 |
| 상여금(명절) | 지급월(설·추석) + 산정 규칙(정률/정액) — 해당 월 대장에만 반영 |

- 저장 구조(안): `payroll_pay_rules(rule_id, employee_id, item_key, amount, valid_from, valid_to, meta jsonb)` 단일 테이블 + 항목별 meta(자격증명·자녀명 등). 초과근무수당(§6)과 함께 "자동 채움 소스" 계층을 이룸.

### B. 공제 항목 — EDI 입력 → 자동 산출
- **EDI 데이터 입력**: 국민연금·건강보험·고용보험·장기요양보험 고지 자료(직원별 월 보험료)를 업로드/입력하는 화면. 1차는 **수동 다운로드 파일 업로드**(엑셀/CSV 파싱), 자동화 여부는 조사 과제(아래 D-1).
- **자동 산출 대상 8종**: 국민연금, 건강보험, 고용보험, 장기요양보험료, 소득세, 지방소득세(=소득세×10%), 정산-건강보험, 정산-장기요양.
- **학자금상환공제**: 직원별 상환 정보(총액·월 공제액·상환 기간) 등록 → 상환 기간 동안 자동 공제, 잔액 추적(완제 시 자동 종료). 저장 구조(안): `payroll_deduction_rules` 또는 A의 rules 테이블 통합(item_key='학자금상환공제').

### C. 생성 플로우(개정)
[새 대장] → 전월 복사(직원 구성·기본급 뼈대) → A 규칙 자동 반영 → 초과근무수당 자동 채움(§6) → EDI 자료 입력 → B 자동 산출 → 편집(수기 조정) → 확정.

### D. 조사 과제 (P4-R — 구현 착수 전 분석 선행) ★
1. **EDI 데이터 취득 경로**: 4대보험 EDI(국민연금 EDI/건강보험 EDI 등)에서 고지내역을 수동 다운로드하는 현행 절차 실사 + **자동 수집 가능성**(API·스크래핑·공동인증서 로그인 제약) 조사. 불가 시 업로드 파서(엑셀 포맷 역공학)로 확정.
2. **EDI 고지액 vs 실제 대장 반영액 차이 원인 분석**: 과거 대장 데이터(DB화 완료된 3,202행)와 EDI 고지 자료를 대조하여 차이 패턴 규명 — 가설: 고지 기준월 차이(전월 고지분 반영), 보수월액 변경 소급, 상한/하한 적용, 세무사의 수동 보정. **보험료 반영 로직을 규칙화**해야 자동 산출이 실무와 일치.
3. **소득세 산정 로직**: 근로소득 간이세액표(국세청 고시, 매년 개정) 기반 — 월급여×부양가족수 lookup 테이블 내장 + 80/100/120% 선택 비율 확인. 과거 대장의 소득세 실측값과 간이세액표 계산값 대조 검증.
4. **정산-건강보험·정산-장기요양 산정 로직**: 연 1회(4월) 보수총액 신고 후 정산분 분할 공제 관행 확인 — 과거 대장의 정산 항목 발생 월·금액 패턴 분석으로 로직 역산.
- 산출물: 조사 리포트(`scripts/payroll_import/EDI_ANALYSIS.md` 예정) — 사용자 확인 게이트 후 P4 본 구현.

---

## 7. 구현 단계

| 단계 | 내용 | 산출물 |
|---|---|---|
| **PL-P0** | DB(155~157) + 급여대장 엑셀 파이프라인 + 전수 적재·검증 리포트 | scripts/payroll_import, staging 적재 완료 |
| **PL-P1** | 급여대장 UI(조회·연간 추이·항목 사전 관리) + 메뉴 신설 | /payroll, /payroll/settings |
| **PL-P2** | 근로계약 PDF 파싱 파이프라인(재직자) + 현황 화면(트리뷰·카드·검수 UI) | /payroll/contracts (조회+검수) |
| **PL-P3** | 계약서 생성(일괄·개별승진)·결재 게이트·발송·전자서명·확정본 PDF | 작성/갱신 패널 + 수신함 + 서명 플로우 |
| **PL-P4-R** | 조사 선행(§6-2 D): EDI 취득 경로·고지액 차이 원인·소득세/정산 로직 역산 | EDI_ANALYSIS.md + 사용자 확인 게이트 |
| **PL-P4** | 초과근무수당 금액 연계 + 신규 급여대장 생성(§6-2: 수당 설정 6종·EDI 입력·공제 자동 산출·학자금상환) | 근태 금액 열 + 설정 메뉴 + 대장 생성 |

P0 검증 리포트와 P2 추출 검수는 각각 사용자 확인 게이트를 둔다(무검수 일괄 확정 금지).

---

## 8. 확정 결정 (2026-08-13 사용자 답변)

1. 2016년 암호화 파일 암호 = **`1234`** (복호화 검증 완료, 신규 항목 없음).
2. 2016년 누락 월(2·9·10·11월)은 **건너뜀** — 초창기 소인원, PDF 파싱 보충도 하지 않음.
3. **상여대장류(월중 별도 상여·명절)·설상여금명세·인턴급여대장 포함, 지급결의서·경비명세 제외.**
4. 급여 메뉴 접근 권한: **admin 전용**(성과급과 동일 기조). 본인 명세서 셀프 조회는 후속 범위.
5. 일괄 갱신 반올림: **월급여 기준 천원 단위 미만 절사** (과거 실적상 1명 제외 전원 만원 미만 절사였으나, 그 1명이 천원 절사 → 천원 절사로 통일).
6. 초과근무수당 귀속 구간: **전월 26일 ~ 금월 25일** (급여 말일 지급 관행).
7. 계약서 발송 메일에는 **열람 링크만** 넣음(PDF 미첨부 — 임금 기밀).
8. 임원·고문·전문위원(기간제) 계약서도 **데이터화 포함**, 단 일괄 갱신 기본 스코프는 '임원 제외'.
9. 통상임금 산입 항목: 고정성 수당 산입안 채택(§6) — 항목 사전 `in_ordinary_wage` 시딩 + 설정 화면 토글.
