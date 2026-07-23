# 직원별 휴가 관리 개편 블루프린트 (계획 — 확인 대기)

작성 2026-07-23. E-P3(전자결재) 이후 연차 대장을 "직원별 휴가 관리"로 대개편하고, 휴가신청
입력 UX(날짜·기간 자동화)를 개선한다. 사용자 요구(2026-07-23) 6건 기반.

## 1. 요구사항 (사용자)

1. **휴가 기간 휴먼에러 차단**: 휴가 종류의 부여일수를 초과하는 기간 입력 시 안내 + 자동
   보정. 두 방식 제시 — (a) 시작·종료일 입력 → 사용일수 자동 카운팅 → 부여일수 초과 시
   안내 + 종료일을 상한 날짜로 자동 변경 / (b) 시작일만 입력 → 부여일수만큼 종료일 자동 입력.
2. **날짜 입력 방식 통일**: 모든 전자결재 양식의 날짜 입력을 계약 신규 모달처럼 **8자리 숫자
   연속 입력 → 날짜 자동완성**(`AutoDateInput`)으로. 현재 네이티브 date picker는 불편.
3. **연차 대장 → "직원별 휴가 관리"로 개편**:
   - 메뉴명 변경.
   - 연차뿐 아니라 **연차 외 모든 휴가 사용 현황**도 표시.
   - 초기값을 "누계 O일"이 아니라 **날짜별로 "언제 어떤 휴가를 썼다"가 전부 입력된 상태**로 관리.
   - 초기 입력값 **수정 가능**(연차·연차 외 누락 대응).
4. **연차 발생 기준 옵션**: 현재는 매년 **1월 1일** 발생. 별개로 **입사일 기준** 발생 옵션도
   만들어 기준 변경에 대응.
5. **KPI + 인포그래픽**: 화면 상단에 KPI(평균 연차 부여일수·평균 연차 사용일수·평균 연차
   소진율·평균 연차 외 휴가 부여일수), 하단에 월별 연차 사용일수 막대·월별 연차 소진율 물결선·
   연도별 연차 외 휴가 사용일수 막대 그래프.
6. **직원 사진 아이콘**: 직원 리스트 성명 왼쪽에 사진 아바타(영업 타임라인 방식).

## 2. 재사용 자산 (조사 완료, 2026-07-23)

| 자산 | 위치 | 용도 |
|---|---|---|
| `AutoDateInput` | `components/ui/AutoDateInput.tsx` | 8자리→ISO 날짜 입력(완성 시에만 onChange). 전 양식 date/period 교체 |
| 계약 모달 `DateInput`(달력 오버레이판) | `contracts/page.tsx:2832` | 달력 picker까지 원하면 `components/ui`로 승격 후 공유 |
| `ApexChart` 래퍼 | `components/contracts/dashboard/ApexChart.tsx` | dynamic import(SSR 회피). 모든 차트 필수 경유 |
| `chartPalette(theme)`·`fmtCompact`·`fmtFull` | `components/contracts/dashboard/types.ts` | 차트 색·포맷 |
| `MonthlyTrendCard`(bar) / `YearlyTrendCard`(area·line %) | 동 dashboard | 월별 막대·소진율 라인 옵션 참고 |
| `KpiCard` | `components/dashboard/KpiCard.tsx` | KPI 타일(label/value/unit/hint/emphasis) |
| 직원 사진 | `employee_profiles.photo_public_path` = `/api/admin/employees/{id}/photo`(GET=requireAuthenticated) | 아바타 src. 폴백 lucide UserRound |
| `ProjectDetail.tsx:369` `Avatar` 패턴 | sales | → 공용 `EmployeeAvatar` 추출 |

⚠ 차트 주의(조사): 필터/연도 변경 시 `key` prop 리마운트, 라인/area는 `animations.enabled:false`,
cdash.css 와 dashboard.css 동시 import 금지.

## 3. 데이터 모델 개편 (087~)

현재 `annual_leave_ledger`(grant/use/adjust 누계 엔트리)를 **날짜별 이력 기반**으로 확장한다.

### 3-1. annual_leave_ledger 확장 (087)
- 컬럼 추가: `used_on text`(사용일, YYYY-MM-DD — grant/adjust 는 NULL), `leave_type_key text`
  (leave_types.key — 사용 엔트리의 휴가 종류).
- **사용(use) 엔트리를 날짜 1건 = 1행**으로 관리. 연차·반차뿐 아니라 **연차 외 휴가(경조·공가·
  병가)도 use 엔트리로 기록**하되, 차감 여부는 leave_types.deduct 로 판정(비차감 항목은 잔여에
  영향 없음, 현황 표시·집계용).
- 잔여 = Σ(grant+adjust) − Σ(use where 해당 leave_type.deduct 존재 시 days).
- 연차 외 휴가 부여일수 집계 = Σ(use where deduct 없음 & days 있음)…는 규정 부여일수 기준.

### 3-2. 초기 데이터 재임포트
- 기존 임포트분(2026 use 합계 29건)을 **삭제**하고, 개인시트 **날짜별 272건**(연차 174·반차 82·
  연차 외 16)을 use 엔트리로 재적재. grant(보유연차)는 유지.
- 반차는 개인시트에 오전/오후 구분이 없어 `half_am`(0.5) 로 통일 적재(세부는 화면에서 수정 가능).
- 연차 외 16건은 실제 분류(경조휴가(결혼)·공가(민방위)·사망(조부모) 등)를 leave_types.key 로
  매핑해 적재.
- **범위 논점**(§6-2): 2026년만 vs 개인시트 전체 연도.

### 3-3. 연차 발생 기준 설정 (087)
- `leave_settings`(단일행 'default') 또는 company_profile 확장: `accrual_basis text`(jan1|hire_date).
- v1 은 **설정 저장 + 화면 표시/기준 라벨**. 발생일수 자동 계산은 현재 수동 임포트라 후속(§6-4).

## 4. 화면·기능 구현 (단계)

### LM-P1. 날짜 8자리 입력 (전 양식) — 독립·즉효
- `ApprovalFormRenderer` date/period 를 `AutoDateInput` 으로 교체(계약 모달 달력 picker 원하면
  `DateInput` 승격 후 공유). 표 하위열(table)의 date 도 동일.

### LM-P2. 휴가 기간 ↔ 사용일수 ↔ 부여일수 연동 (휴가신청 특화)
- 휴가신청 양식에서 `leave_type` 선택 시 부여일수(days)를 상한으로.
- 방식(§6-1 확정 필요):
  - (a) period(시작·종료) 입력 → **사용일수 자동 카운팅**(달력일/영업일 정책 §6-3) → 부여일수
    초과 시 안내 배지 + **종료일을 상한 날짜로 자동 보정**.
  - (b) 시작일 입력 + 부여일수 → **종료일 자동 계산**.
  - 권고: 둘 다 지원(고정 부여일수 종류=자동 종료일, 연차=카운팅). leave_type 이 days 고정이면
    (b), 가변(연차·공가·병가)이면 (a)에 상한만 없음.
- 렌더러에 휴가신청 전용 연동(leave_type + period + use_days 3필드 상호작용) 추가.

### LM-P3. 직원별 휴가 관리 화면 — 목록·이력 편집
- 메뉴/타이틀 "연차 대장" → **"직원별 휴가 관리"**.
- 직원 행: **사진 아바타**(EmployeeAvatar) + 성명·부서·직급 + 연차 부여/사용/잔여 + **연차 외
  휴가 요약**(종류별 일수).
- 행 펼침 → **날짜별 휴가 이력 테이블**(일자·종류·일수·출처(임포트/승인)·비고) — **추가·수정·삭제**
  가능(누락 보정). 부여/조정 엔트리도 편집.
- 연차 발생 기준 설정 토글(jan1/입사일) 배치.

### LM-P4. KPI + 인포그래픽
- 상단 KPI 4종(`KpiCard`): 평균 연차 부여·평균 연차 사용·평균 연차 소진율(%)·평균 연차 외 부여.
- 차트 3종(`ApexChart`+`chartPalette`): 월별 연차 사용 막대 / 월별 연차 소진율 물결선(area %) /
  연도별 연차 외 휴가 막대.
- 연도 선택 필터(차트 `key` 리마운트).

### LM-P5. 공용 EmployeeAvatar 추출
- `components/ui/EmployeeAvatar.tsx`({employeeId?, photoPath?, size}) — img + onError 폴백(UserRound).
  기존 sales 중복 3곳도 점진 통일(선택).

## 5. API·집계
- `/api/approval/leave` 확장: 직원별 요약에 연차 외 집계·사진경로 추가, 날짜별 이력 CRUD
  (GET 상세·POST 엔트리 추가/수정/삭제). KPI·월별/연도별 차트 집계 엔드포인트.
- 차감 판정·부여일수는 leave_types 카탈로그(기존) 사용.

## 6. 확정 결정 (2026-07-23)

1. **휴가 기간 자동화 = 종류에 따라 둘 다**: leave_type.days 고정(경조·조의 등) → 시작일 입력
   시 종료일 자동(달력일 days-1 가산). 가변(연차·공가·병가) → 시작+종료 입력 시 사용일수
   카운팅, 부여일수(상한 있으면) 초과 시 안내+종료일 자동 보정.
2. **사용일수 = 달력일**(주말 포함). 공휴일 미차감 로직 없음. **재임포트 = 2026년만**.
3. **연차 발생 = 입사일 기준 자동계산까지 구현**. 노동법 기준(1년 미만 매월 1일 최대 11,
   1년 이상 15, 3년 이상 2년마다 +1 최대 25) + 회계연도(1/1) 기준 옵션 병행. `accrual_basis`
   설정으로 전환. 자동계산값과 수동 임포트값 병존(설정이 자동이면 계산, 아니면 임포트/수기).
4. **반차 오전/오후**: 개인시트 미구분 → 일괄 `half_am`(0.5) 적재 후 화면에서 수정 허용.
5. **진행 순서**: LM-P1(날짜입력)+LM-P2(기간 자동화) 먼저 배포, 이후 LM-P3(모델·화면)+
   LM-P4(KPI·차트)+LM-P5(아바타) 배포.
