# 모바일 전용 UI 블루프린트 (확정 v2)

> 2026-07-14 작성, 같은 날 결정 논점 확정. 영업 담당자의 외근 시나리오(일정 확인·명함 촬영·
> 사업장/담당자 열람)를 휴대폰에서 처리할 수 있는 **모바일 전용 화면 세트**의 설계.
> 명함 OCR(P2)의 실사용 진입점이 모바일이므로, 모바일 골격을 먼저 세우고 그 위에 명함 촬영을 얹는다.
>
> **확정된 결정(2026-07-14)**: ①기능 범위 = M1+M2 기본만(후보 기능은 M3 재판단)
> ②모바일 UA 자동 리다이렉트(+데스크톱 버전 탈출 링크) ③일정 뷰 = **월 미니 캘린더 + 일 리스트**
> ④PWA(manifest+아이콘) 1차 포함 ⑤사업장 상세 = 요약 카드만.

## 1. 문제 정의

- 현재 앱은 **4K 데스크톱 기준**으로 설계돼 FHD에서도 표시가 깨지는 화면이 있고,
  휴대폰에서는 사실상 사용 불가(사이드바+탑바 셸, 고정 px 폭 다수 — 예: 영업 탭패널 616px,
  캘린더 그리드, 4천 줄 FacilityDetailPanel의 다열 모달 등).
- 기존 화면 전체를 반응형으로 개조하는 것은 **비용 대비 효과가 낮고 회귀 위험이 큼**
  (데스크톱 UI는 이미 검증·배포된 상태, 화면당 고정폭 의존이 깊음).
- 모바일에서 실제로 필요한 것은 전체 메뉴가 아니라 **외근 중 쓰는 소수 기능**이다.

## 2. 설계 원칙

1. **기존 화면을 건드리지 않는다**: 데스크톱 UI는 그대로 두고, 모바일 전용 라우트를 신설.
   회귀 위험 0, 점진 확장 가능.
2. **화면만 새로, 데이터는 재사용**: 기존 API 라우트(/api/...)와 RBAC 가드를 그대로 호출.
   모바일용 API를 따로 만들지 않는다(필요 시 파라미터만 추가).
3. **모바일 우선 패턴**: 하단 탭 내비게이션, 카드 리스트, 풀스크린 시트(모달 대신),
   전화/문자/지도는 OS 연동(`tel:` `sms:` 지도앱 링크), 큰 터치 타깃(44px+).
4. **cdash 토큰 유지**: `--cd-*` 변수·라이트/다크 그대로 — 모바일 셸도 같은 디자인 언어.
5. **네이티브 이식 대비**: 로직은 전부 API 계층에 있으므로, 추후 네이티브 앱은
   같은 API를 소비하는 클라이언트로 추가하면 된다(이번 설계가 그 계약을 검증하는 역할).

## 3. 구현 형태 (제안)

### 3-1. 라우트 구조 — 별도 라우트 그룹 `/m`

```
frontend/app/m/
  layout.tsx        ← 모바일 전용 셸(MobileShell): 상단 미니 헤더 + 하단 탭바. AppShell 미사용
  page.tsx          ← 홈(오늘): 오늘/이번 주 일정 + 빠른 액션
  schedule/         ← 일정: 주간 리스트 뷰(월 그리드 대신), 일정 상세·경과 입력
  facilities/       ← 사업장: 검색 → 카드 리스트 → 상세(요약 카드: 일반현황·주요 연락처)
  contacts/         ← 담당자: 검색 → 카드 리스트 → 상세(전화/문자 바로가기) + 명함 촬영
  card/             ← 명함 촬영 플로우(촬영→파싱 미리보기→사업장 확인→저장)
```

- 인증: 기존 next-auth 세션·middleware 가드 그대로(`/m`도 matcher에 포함).
  로그인 페이지는 공용(모바일에서 렌더 확인·소폭 보정만).
- 데스크톱 접속 시: `/m`은 모바일 폭(max-width ~480px 중앙 정렬)으로 렌더 —
  데스크톱에서도 테스트 가능하게.
- 진입 유도: 로그인 후 UA가 모바일이면 `/m`으로 리다이렉트(middleware), 모바일에서
  데스크톱 화면을 원하면 하단 "데스크톱 버전" 링크로 탈출(쿠키로 기억).

### 3-2. 모바일 셸(MobileShell)

- 상단: 로고 + 페이지 제목 + 테마 토글(간소).
- 하단 탭바 4개: **홈 / 일정 / 사업장 / 담당자** (+ 명함 촬영은 담당자 탭 상단 버튼
  또는 홈의 빠른 액션 — FAB 남용 지양).
- PWA manifest + 아이콘 추가 → 홈 화면에 "앱처럼" 설치 가능(선택 항목, 비용 소).

## 4. 기능 범위 (제안 — 결정 필요)

| 우선 | 기능 | 내용 | 데이터 소스(기존 API) |
|---|---|---|---|
| **M1** | 홈(오늘) | 오늘·이번 주 내 일정, 경과 미입력 알림 배지 | /api/sales/upcoming-activities, pending-reports |
| **M1** | 일정 열람 | 주간 리스트(날짜별 그룹), 일정 상세 | /api/sales/projects/.../activities |
| **M1** | 사업장 열람 | 검색 → 기본정보(주소·대표번호·업종·종규모) + 지도앱 열기 | /api/facilities (검색·detail) |
| **M1** | 담당자 열람 | 검색 → 연락처 카드, `tel:`/`sms:`/메일 바로가기 | /api/sales/contacts |
| **M2** | **명함 촬영** | 촬영→Claude vision 파싱→미리보기·수정→담당자 upsert(+S3 원본) | 신규 /api/facilities/business-card/* |
| **M2** | 일정 경과 입력 | 종료된 일정에 경과(progress_note) 입력 — 외근 직후 기록 | 기존 activities PUT |
| 후보 | 영업 프로젝트 요약 | 내 프로젝트 목록·단계 pill(읽기 전용) | /api/sales/projects |
| 후보 | 운영 알림 | alerts 리스트(인텔 신호 고지 확인) | /api/alerts |
| 제외 | 업무보고·계약·데이터·관리 | 데스크톱 전용 유지 | — |

- **일정 신규 등록은 1차 제외** 제안: ScheduleModal은 견적/투찰 다차 행 등 입력이 무거워
  모바일 축약형을 따로 설계해야 함 — 경과 입력(가벼움)만 먼저, 등록은 2차.

## 5. 명함 OCR과의 순서 (통합 로드맵)

명함 OCR 파이프라인(파서·API·S3 저장)은 **화면과 무관한 공용 계층**이므로 병행 개발한다.

- **M1 — 모바일 골격**(셸+탭바+로그인 확인) + 열람 4종(홈/일정/사업장/담당자). 배포 후 휴대폰 실사용 검증.
- **M2 — 명함 촬영 E2E**: business-card-parser(Claude vision) + parse/저장 API + 촬영 플로우
  (모바일 `/m/card` + 데스크톱 연락처 모달 "명함 촬영" 버튼 동시 제공) + 일정 경과 입력.
- **M3 — 확장(선택)**: 프로젝트 요약·알림·일정 등록 축약형·PWA 설치 유도.

## 6. 결정 사항 (2026-07-14 확정)

| # | 논점 | 결정 |
|---|---|---|
| 1 | 기능 범위 | **M1+M2 기본만** — 프로젝트 요약·운영 알림 등 후보 기능은 M3에서 재판단 |
| 2 | 진입 방식 | **모바일 UA 자동 리다이렉트**(middleware) + 하단 "데스크톱 버전" 링크로 탈출(쿠키 기억) |
| 3 | 일정 뷰 | **월 미니 캘린더 + 일 리스트** — 상단 소형 월 그리드(점 마커)+하단 선택일 일정 리스트 |
| 4 | PWA | **1차 포함** — manifest+아이콘, 홈 화면 설치 지원(오프라인·푸시는 범위 외) |
| 5 | 사업장 상세 범위 | **요약 카드만** — 일반현황+주요 담당자 연락처+지도앱 열기 |

## 7. 상세 구현 계획 (확정)

### M1 — 모바일 골격 + 열람 4종

1. **모바일 셸**: `app/m/layout.tsx` + `components/mobile/MobileShell.tsx`
   - `.cdash` 루트 + `useCdashTheme` 공유, max-width 480px 중앙 정렬(데스크톱 테스트 겸용)
   - 상단 미니 헤더(제목+테마 토글), 하단 고정 탭바 4개(홈/일정/사업장/담당자, lucide 아이콘)
   - 인증: 기존 middleware matcher에 `/m` 포함 확인(전역 matcher면 무변경)
2. **UA 리다이렉트**: middleware에서 모바일 UA + 루트/데스크톱 경로 진입 시 `/m`으로 redirect.
   `mcm-prefer-desktop` 쿠키가 있으면 미적용. 탭바 하단 "데스크톱 버전" 링크가 쿠키 세팅.
3. **PWA**: `app/manifest.ts`(name/short_name/icons/display: standalone/theme_color cdash 연동)
   + 아이콘 2종(192/512). 오프라인 service worker는 범위 외.
4. **홈**(`/m`): 오늘·이번 주 일정 카드(upcoming-activities), 경과 미입력 배지(pending-reports),
   빠른 액션(명함 촬영·사업장 검색 — M2 전까지 명함은 비활성 표시).
5. **일정**(`/m/schedule`): 상단 월 미니 캘린더(일정 있는 날 점 마커, 월 이동) + 하단 선택일
   일정 리스트(활동유형 색점·시간·사업장명). 항목 탭 → 풀스크린 시트 상세(읽기 전용).
   ※ 월 범위 일정 조회 API 필요 — 기존 activities 쿼리에 월 파라미터 추가(또는 신규 경량 라우트).
6. **사업장**(`/m/facilities`): 검색 인풋(서버 검색) → 카드 리스트(사업장명·주소·업종) →
   상세 요약 카드(일반현황 + 주요 담당자 tel:/sms: + 주소 지도앱 열기).
7. **담당자**(`/m/contacts`): 검색 → 카드 리스트(/api/sales/contacts 재사용) →
   상세 시트(전화·문자·메일 원터치, 사업장으로 이동 링크).
8. **검증**: tsc + 데스크톱 480px 렌더 + 스테이징 배포 후 실기기(iOS Safari·Android Chrome)
   확인 → 사용자 확인 후 M2.

### M2 — 명함 촬영 E2E + 경과 입력

1. **파서**: `lib/sales/business-card-parser.ts` — Claude vision(이미지 base64 →
   구조화 JSON: 이름/직급/회사명/부서/휴대폰/사무실/팩스/이메일/주소). Anthropic 직접 fetch
   패턴(news-classifier와 동일), 키 미설정 시 명확한 에러 반환.
2. **API**: `/api/facilities/business-card/parse` POST(이미지 → 파싱 JSON, 저장 없음) +
   `/api/facilities/[id]/contacts/card` POST(확정 데이터 + 원본 이미지 → S3 저장
   [employee-document-storage 패턴, card_storage_*] + facility_contact_people upsert
   [이름+휴대폰 매칭 시 갱신, 없으면 신규] + card_parsed_json/card_captured_at 기록).
3. **모바일 플로우**(`/m/card`): `<input capture="environment">` 촬영/앨범 선택 →
   파싱 스피너 → 필드 미리보기·수정 폼 → 사업장 검색·선택(회사명으로 후보 추천) → 저장.
4. **데스크톱 진입점**: FacilityDetailPanel 연락처 모달 "담당자 추가" 옆 "명함 촬영" 버튼 —
   같은 parse API 재사용, facility는 모달 컨텍스트로 확정돼 있음.
5. **경과 입력**: 일정 상세 시트에서 종료된 일정에 경과(progress_note) 입력 →
   기존 activities PUT 재사용(단계 자동 재계산 포함).
6. **검증**: 실기기 명함 3~5종 촬영 파싱 정확도 확인 → 커밋·배포.

### 작업 순서·검증 게이트

M1(1~7) → tsc·로컬 검증 → 스테이징 배포·실기기 확인 → **사용자 확인** →
M2(1~5) → 실기기 명함 검증 → **사용자 확인** → 커밋·배포. 각 단계 커밋 분리(셸·열람 / 명함·경과).

## 8. M3 — 실기기 피드백 반영 (2026-07-14 확정)

> M2 실기기 검증 피드백 4건: ①직급/부서 분리 오류 ②현장에서 미등록 사업장의 명함을 저장할 수
> 없음(간이 등록 필요) ③사업장 리스트가 2,000건 평면 나열이라 탐색 불가(C안 하이브리드 확정)
> ④진행 중 용역/영업 기준 필터(사업장·담당자 공통).

### M3-1. 명함 파서 직급/부서 분리 보정

- business-card-parser 프롬프트에 분리 규칙 명시: title=직급·직책만(부장/이사/팀장/책임 등),
  부서·본부·팀·실 명칭은 department 로. "부장 / 환경사업본부"처럼 붙은 표기는 분해(예시 포함).

### M3-2. 명함 촬영 내 간이 사업장 등록

- **API**: 기존 `/api/facilities/manual` POST 재사용 + `source` 파라미터 허용
  (`"manual"`(기본) | `"mobile-quick"` — 임시 등록 식별용. 추후 데스크톱 홈 UI 의
  관리자용 "임시 등록 사업장" 리스트가 `source='mobile-quick'` 조회로 정보 완성 → 승격).
- **UI**(MobileCard 사업장 선택 섹션): 검색 결과 하단 "+ 신규 사업장 간이 등록" → 인라인 폼
  (사업장명*, 소재지*, 대표전화 — **명함 파싱의 companyName/address/officePhone 프리필**).
  등록 성공 시 그 사업장을 즉시 선택 상태로. manual API 의 중복 응답(회사명+주소)이 오면
  "이미 등록된 사업장" 안내 + 해당 사업장 바로 선택.

### M3-3. 사업장 탐색 개편 (C안 하이브리드)

- **서버 확장**(lib/ieps/queries.ts):
  - `FacilityListFilter.industryCategories?: string[]` — 기존 단일 industryCategory 의
    EXISTS(regexp_split) 조건을 카테고리별 OR 로 확장(기존 파라미터는 호환 유지).
  - `FacilityListFilter.engagement?: ("contract"|"sales")[]` — OR 판정 EXISTS:
    - contract(용역 진행 중): `contracts.counterparty_facility_id = f.facility_id` +
      미삭제·미해지 + **미완료 = NULLIF(permit_issued_at,'') IS NULL AND 최종 대금지급단위
      (stage_order 최대) 미발행** — billing 완료 현황(completions-status.ts)과 동일 판정.
      실측 103건/85곳(2026-07-14).
    - sales(영업 진행 중): `sales_projects.facility_id = f.facility_id AND stage NOT IN
      ('won','lost','hold')`.
  - 신규 `/api/facilities/browse-stats`: 초기 그리드용 카운트 — 통합허가 20업종별
    (COUNT FILTER + regexp_split EXISTS 단일 쿼리) + 용역 중/영업 중 사업장 수.
- **MobileFacilities 전면 개편**:
  - 초기 화면(검색어·필터 없음): 검색창 + **최근 본 사업장**(localStorage `mcm-recent-facilities`
    최대 5, 상세 시트 열람 시 기록) + **관계 카드 2개**(용역 진행 중 N / 영업 진행 중 N — 탭 시
    해당 필터 리스트) + **업종별 카운트 그리드**(0건 업종 숨김, 탭 시 업종 필터 리스트).
  - 필터/검색 모드: 필터 칩 행 `[업종 ▾][지역 ▾][관계 ▾]` — 탭 시 **바텀시트**(멀티선택,
    업종 20종·시도별 카운트 표시, 관계는 용역 중/영업 중 2항목) + 적용 필터 요약 칩.
    결과 헤더 "N곳" + 리스트 + **더보기**(offset 30건씩, total 은 기존 응답 재사용).
  - 정렬 토글(이름순 기본 / 최근 등록순). 규모별 필터는 데이터 축적 후(칩 1개 추가로 대응).
- **바텀시트 컴포넌트**는 mobile-shared 의 MobileSheet 재사용(멀티선택 리스트+적용 버튼).

### M3-4. 담당자 메뉴 관계 필터

- `listSalesContacts(filter?: { engagement?: ("contract"|"sales")[] })` — M3-3 과 동일 EXISTS 를
  소속 사업장(facility_id) 기준으로 적용. `/api/sales/contacts?engagement=` 파라미터.
- MobileContacts 상단에 관계 칩(전체/용역 중/영업 중) — 기존 검색과 조합.
- 데스크톱 ContactsBoard 에도 동일 필터 select 추가(같은 API 파라미터 재사용, 소폭).

### M3-5. 일정 상세 시트에 사업장 담당자 표시

- 일정에 연결된 사업장 담당자(sales_activity_contacts → facility_contact_people)를
  일정 상세 시트에 카드로 표시 — 이름·직급·부서 + **전화(tel:)·문자(sms:) 원터치**
  (미팅 전 담당자 확인·즉시 통화 시나리오).
- `listActivitiesByMonth` 응답에 contacts 배열 포함(json_agg 조인 — 추가 fetch 없음).
  연결 담당자가 없는 일정은 섹션 숨김.

### 작업 순서·검증

1. M3-1+M3-2(명함 계열) → tsc·dev 실증(간이 등록→명함 저장→중복 케이스) 
2. M3-3 서버(필터 확장+browse-stats) → 쿼리 실측(카운트·engagement 85곳 일치 확인)
3. M3-3 화면 + M3-4 + M3-5 → dev 렌더·조합 필터 검증 → **사용자 확인** → 커밋·배포 → 실기기 확인
