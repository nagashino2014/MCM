# MCM — IEPS 통합환경허가 수집/파싱 코어

국립환경과학원 [IEPS 통합환경허가시스템](https://ieps.nier.go.kr/) 정보공개 게시판에서
"최초허가" 검토결과서를 수집·OCR 파싱해 통합허가 대상 사업장 마스터를 구축하는
백엔드/스크래퍼/OCR 코어 모듈입니다. 이 라운드는 CLI 단일 명령으로
**수집 → 다운로드 → OCR → 9 필드 파싱 → SQLite 적재 → summary.json 출력**까지
검증 가능하게 만드는 것을 목표로 합니다. UI 연결은 다음 라운드 작업입니다.

## 디렉터리 구조

```
MCM/
├── backend/                     # FastAPI 기반 OCR/추출 서비스 (Web Scraper Final/backend 분기)
│   ├── app/
│   │   ├── config.py            # PDFSettings.start_page / end_page 추가
│   │   ├── extractors/pdf_extractor.py   # 페이지 범위 슬라이스 지원
│   │   ├── ieps/
│   │   │   ├── models.py        # CollectionConfig / ExtractionRule 등 Pydantic 모델
│   │   │   ├── rule_engine.py   # 9개 빌트인 규칙 + 5가지 locator
│   │   │   └── routes.py        # POST /ieps/parse, /ieps/parse-batch
│   │   ├── services/ieps_field_parser.py # PDF → 필드 파싱 래퍼
│   │   └── main.py              # 기존 라우트 + IEPS 라우터 등록
│   ├── requirements.txt
│   └── .env.example
├── scraper/                     # IEPS 게시판 수집/다운로드 CLI
│   ├── lib/scraper/             # Web Scraper Final 의 스크래핑 엔진 (재사용)
│   │   └── scraper-db.ts        # IEPS 전용 테이블 6종 추가
│   ├── scripts/
│   │   ├── cli-collect.ts       # 통합 파이프라인 CLI
│   │   ├── cli-recon.ts         # 게시판 구조 정찰 스크립트
│   │   ├── cli-scraper.ts       # 원본 GitHub Actions용 CLI (참고)
│   │   └── scraper-runner.ts    # 스크래핑 엔진
│   ├── data/scraper-targets.json
│   ├── package.json
│   └── tsconfig.json
├── data/ieps/                   # 런타임 산출물
│   ├── raw/<year>/<postId>/*.pdf       # 다운로드된 검토결과서
│   ├── extracted/<year>/<postId>/*.json # backend 파싱 결과 JSON
│   ├── recon-ieps-integrated-permit.{html,json} # 정찰 산출물
│   ├── db.sqlite                       # 스크래핑/IEPS 통합 SQLite
│   ├── logs/                            # 향후 사용
│   └── summary.json                    # 마지막 수집 실행 요약
├── docs/ieps-app-design.md
└── prototype/ieps-dashboard.html
```

## 처리 흐름

```
npm run collect (scraper)
   └─ scraper-runner.ts → IEPS 게시판 수집 (documents/attachments)
   └─ "제 ####-01호" 결정번호 패턴으로 최초허가 게시물 필터
   └─ 검토결과서 PDF만 골라 data/ieps/raw/<year>/<postId>/ 로 정리
   └─ POST /ieps/parse  (backend, PDF 1~10p OCR + 9 필드 룰 엔진)
   └─ data/ieps/extracted/<year>/<postId>/<file>.json 저장
   └─ facilities / permits / permit_scales / product_outputs / parsed_fields 적재
   └─ data/ieps/summary.json 출력
```

## 1. 백엔드 실행

```powershell
# 가상환경/의존성 설치
cd C:\CodingProject\MCM\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# IEPS 라운드 1 환경변수 (선택)
copy .env.example .env

# 서버 기동 (포트 8001 권장 — 스크래퍼 기본값과 일치)
uvicorn app.main:app --reload --port 8001
```

기동 후 `GET http://127.0.0.1:8001/ieps/health`가 `{"status":"ok"}`이면 정상입니다.

### IEPS 엔드포인트

- `GET /ieps/health` — 상태 확인
- `GET /ieps/builtin-rules` — 9개 빌트인 규칙 조회
- `POST /ieps/parse`
  ```json
  {
    "pdfPath": "C:/CodingProject/MCM/data/ieps/raw/2026/12345/review.pdf",
    "config": {
      "extractionRange": { "mode": "partial", "startPage": 1, "endPage": 10 },
      "extractionRules": [],
      "activeRuleIds": null
    }
  }
  ```
- `POST /ieps/parse-batch` — `items: [{ pdfPath, postId }]` + 동일한 `config`

`extractionRules`가 비어 있으면 9개 빌트인 규칙이 자동 적용됩니다.

## 2. 스크래퍼 실행

```powershell
cd C:\CodingProject\MCM\scraper
npm install
npx playwright install chromium   # onclick/세션 다운로드 대비

# 게시판 구조 정찰 (선택)
npm run recon

# 1페이지만 다운로드까지 검증 (backend 호출 X)
npm run collect -- --max-pages=1 --skip-parse --dry-run

# 전체 파이프라인 (backend 가동 필요)
npm run collect -- --max-pages=2
```

### CLI 옵션

| 옵션                    | 설명                                                |
| ----------------------- | --------------------------------------------------- |
| `--max-pages=N`         | 게시판 페이지 수 (기본 5)                           |
| `--board=<id>`          | 보드 ID (기본 `ieps-integrated-permit`)             |
| `--config=<path>`       | `CollectionConfig` JSON 경로                        |
| `--backend=<url>`       | backend URL (기본 `http://127.0.0.1:8001`)          |
| `--skip-download`       | PDF 다운로드 생략                                   |
| `--skip-parse`          | backend 파싱 호출 생략                              |
| `--dry-run`             | 사업장 DB 적재 없이 summary만 출력                  |
| `--from-date=YYYY-MM-DD`| 이 날짜 이후 게시물만 수집                          |

### 결과 위치

- `data/ieps/raw/<year>/<postId>/*.pdf`
- `data/ieps/extracted/<year>/<postId>/*.json`
- `data/ieps/db.sqlite` (documents / attachments / facilities / permits / permit_scales / product_outputs / parsed_fields / collection_configs)
- `data/ieps/summary.json`

## 3. CollectionConfig

프로토타입 `prototype/ieps-dashboard.html`의 "수집 옵션" 카드와 동일한 JSON 스키마를
백엔드 Pydantic 모델로 그대로 받습니다. 9개 빌트인 규칙은 다음과 같습니다.

| ruleId | 항목 | locator | 비고 |
| --- | --- | --- | --- |
| `decision_no` | 결정번호 | regex (`제 \d{4}-\d+호`) | 갑지 페이지(3~5p) |
| `company_name` | 상호 | rightOfKeyword | |
| `business_registration_no` | 사업자등록번호 | regex (`\d{3}-\d{2}-\d{5}`) | |
| `site_address` | 사업장소재지 | rightOfKeyword | |
| `phone_number` | 전화번호 | rightOfKeyword | |
| `industry_code_name` | 업종 | rightOfKeyword | 코드 5자리 + 명칭 |
| `permit_date` | 허가일자 | regex (`YYYY[년-./]MM[월-./]DD`) | |
| `permit_scale` | 종 규모 | regex (`(대기|수질) [1-5]종`) | 1~10p |
| `product_output` | 생산품 | sameRowNext | 1~10p |

사용자 정의 항목은 `extractionRules` 배열에 동일한 스키마로 추가하면 자동으로 머지됩니다.

## 4. 검증 시나리오

1. **정찰만**: `npm run recon` → `data/ieps/recon-ieps-integrated-permit.json` 생성, IEPS HTML 구조 확인.
2. **다운로드까지**: `npm run collect -- --max-pages=1 --skip-parse --dry-run` → `data/ieps/raw/<year>/<postId>/` 에 PDF 누적, `summary.json`의 `pdfBundles` 값 확인.
3. **백엔드 단건 파싱**: backend 기동 후 `POST /ieps/parse`에 위 PDF 1건 전송 → 9 필드 추출 결과 JSON 응답 확인.
4. **풀 파이프라인**: `npm run collect -- --max-pages=2` → `db.sqlite`의 `facilities`/`permits` 테이블에 사업장 적재되는지 SQLite 클라이언트로 확인.

## 5. 트러블슈팅

- **PaddleOCR/CUDA 미설치**: `.env`에서 `OCR_USE_GPU=false`로 설정. PyMuPDF 텍스트 레이어로 우선 처리되며, OCR이 필요한 페이지에서만 fall-back.
- **IEPS 첨부가 onclick/세션 다운로드인 경우**: `npm run recon` 결과의 `attachmentHints`에 `fnDownload` 등이 표시되면, `lib/scraper/browser.ts`의 Playwright 다운로드 경로가 자동 사용되도록 향후 cli-collect에서 분기. 기본 정적 GET으로도 동작 확인됨 (2026-05 기준).
- **결정번호 미매칭**: 룰 엔진은 `제 ####-01호`/`제 ####-1호` 형태를 모두 허용. PDF에서 결정번호가 헤더/하단 어디에 있든 1~10페이지 범위 안이면 됨.
- **사업장 중복**: `business_registration_no`(있을 때) 또는 `normalized_company_name`으로 dedup. 동일 회사가 다른 보드/시기에 재등장해도 `facility_id`가 유지됨.
- **SQLite 경로 변경**: `SCRAPER_DB_PATH` 환경 변수로 강제 지정 가능. cli-collect는 기본적으로 `data/ieps/db.sqlite`로 향함.

## 6. 프론트엔드 (UI 라운드 1)

`MCM/frontend`에 Next.js 14 (App Router) 프론트엔드가 추가되어 사이드바
4메뉴(`사업장`/`계약`/`영업·마케팅`/`데이터`)와 데이터 하위 3페이지(`수집 현황`/`검수 대기열`/`설정`)가
동작합니다. 디자인 토큰은 `prototype/ieps-dashboard.html`을 그대로 이식했습니다.

```powershell
cd C:\CodingProject\MCM\frontend
npm install
npm run dev          # 기본 포트 3000
```

### 구성

```
frontend/
├── app/
│   ├── (app)/data/{status,review,settings}/page.tsx   # 데이터 3페이지
│   ├── (app)/{facilities,contracts,sales}/page.tsx    # placeholder
│   └── api/
│       ├── health/route.ts
│       ├── dashboard/{kpi,recent-facilities}/route.ts
│       ├── collection-configs/(route|[id])/route.ts   # CRUD
│       ├── parsed-fields/(route|[id])/route.ts        # 검수 GET / PATCH
│       └── collect/start/route.ts                     # SSE (cli-collect spawn)
├── components/{layout,dashboard,review,ui}/*.tsx
└── lib/
    ├── db.ts                                          # sql.js 래퍼 + write mutex
    └── ieps/{types,defaults,queries,job-runner}.ts
```

### SQLite 공유

- 기본값으로 `frontend/`에서 인접 `../data/ieps/db.sqlite`를 읽고 씁니다.
- 별도 경로를 강제하려면 `IEPS_DB_PATH` 환경변수로 지정.
- 수집 잡(SSE)이 cli-collect를 spawn할 때도 동일한 db 파일을 가리키도록
  `SCRAPER_DB_PATH=$IEPS_DB_PATH`가 자동 전달됩니다.

### 9개 빌트인 룰 단일 소스화

cli-collect와 frontend가 동일한 정의를 사용하도록
[scraper/lib/ieps/builtin-rules.ts](scraper/lib/ieps/builtin-rules.ts)에 9개
규칙을 모았고, frontend의 `@/lib/ieps/defaults`가 이를 그대로 import합니다.

### 수집 트리거 + SSE

`POST /api/collect/start`는 `npx ts-node scripts/cli-collect.ts --json-progress …`를
spawn해 NDJSON stdout을 SSE로 그대로 흘려보냅니다. 단계: `scrape / filter / download / parse / upsert / done`.
ProgressDrawer가 단계별 진행률 바와 라이브 로그를 표시하며, 종료 시 KPI/결과 테이블을 자동 갱신합니다.

### 검증 시나리오

1. `cd frontend && npm install && npm run dev` → `http://localhost:3000` 접속, 사이드바 4메뉴 + 데이터 하위 3페이지 라우팅 OK.
2. `/api/health` 호출 시 `dbExists: true / cliExists: true`로 응답.
3. `/data/status` 진입 시 KPI 5개(`누적 수집 사업장 / 24h 신규 / 다운로드 PDF / 파싱 완료 / 검수 대기`)가 SQLite 값으로 채워짐.
4. "수집 시작" 클릭 → ProgressDrawer가 `started → scrape → filter → download → parse → upsert → done` 진행률을 라이브 표시 → 종료 후 KPI/결과 테이블 자동 refetch.
5. `/data/review`에서 `parsed_fields.needs_review=1` 행을 선택 → 우측 사이드패널에서 reviewed_value 저장 → 목록에서 사라짐.
6. `/data/settings`에서 새 CollectionConfig 저장 → `/data/status`의 옵션 카드 상단 드롭다운에 표시.
7. backend(8001) 미가동 시 ProgressDrawer는 `parse` 단계에서 명확한 에러 메시지 표시, KPI(DB read)는 정상 동작.

## 7. 사업장 마스터 + RBAC 인증 (UI 라운드 2A)

라운드 2A 에서 다음을 추가했습니다 (상세 플랜: [docs/ieps-ui-round-2a.md](docs/ieps-ui-round-2a.md)).

### 7.1 신규 페이지

- `/login` — 이메일/비밀번호 로그인 (Auth.js v5 credentials provider).
- `/admin/users` — admin 전용 사용자 CRUD / 역할 변경 / 비활성화 / 비밀번호 재설정.
- `/facilities` — 사업장 마스터 (검색 / 시도·시군구·업종·종 규모·source 필터 + 상세 패널 + 인라인 편집).
- `/facilities/new` — 사업장 수동 등록 (`source='manual'`).
- `/facilities/merge` — 중복 후보 자동 추천(BRN / normalized name / normalized address) + 필드별 우선순위 마법사.

### 7.2 신규/보강 API

- `POST /api/auth/[...nextauth]` (Auth.js)
- `GET/POST /api/admin/users`, `PATCH/DELETE /api/admin/users/[id]`, `POST /api/admin/users/[id]/reset-password`
- `GET /api/facilities`, `GET/PATCH /api/facilities/[id]`, `POST /api/facilities/manual`
- `GET /api/facilities/merge/candidates`, `POST /api/facilities/merge`
- `PATCH /api/parsed-fields/[id]` 보강 — `reviewedValue` 확정 시 9개 빌트인 룰별로 `facilities/permits/permit_scales/product_outputs` 자동 sync + `audit_log` 기록.
- `GET /api/health` 보강 — `users.adminCount`, `seedTried`, `seedError` 노출.

### 7.3 인증 / 권한 가드

- 미들웨어 ([frontend/middleware.ts](frontend/middleware.ts)) 는 Edge runtime 호환을 위해 [frontend/lib/auth/edge-config.ts](frontend/lib/auth/edge-config.ts) 만 import. JWT 검증 + `authorized` 콜백으로 라우팅 가드.
- credentials 검증·DB 조회·bcrypt 는 Node runtime 의 [frontend/lib/auth/config.ts](frontend/lib/auth/config.ts) 에서 처리.
- API 라우트는 [frontend/lib/auth/guards.ts](frontend/lib/auth/guards.ts) 의 `requireSession()` / `requireRole()` / `requireEditor()` 를 진입에서 호출.
- 권한 매트릭스: admin (모든 권한) / editor (사업장·검수·수집·설정 CRUD) / viewer (read-only).
- viewer 는 `/admin/*` 진입 시 `/login` 으로 리다이렉트, write API 는 `403 forbidden`. UI 도 쓰기 버튼이 자동 비활성.

### 7.4 admin 자동 시드

- 부팅 시 `users` 테이블에 admin 0명이면 환경변수 `ADMIN_EMAIL` / `ADMIN_PASSWORD` (선택 `ADMIN_NAME`) 로 자동 생성.
- 시드는 멱등 (`ensureAdminSeeded`) — `/api/health` GET 시점, 첫 로그인 시도 시점, `(app)` 레이아웃 진입 시점 모두에서 안전하게 호출됨.

### 7.5 DB 스키마 변경 (멱등 마이그레이션)

[scraper/lib/scraper/scraper-db.ts](scraper/lib/scraper/scraper-db.ts) 의 `initDatabase()` 와 [frontend/lib/db.ts](frontend/lib/db.ts) 의 `ensureAuthSchema()` 양쪽에 다음 추가 (CREATE TABLE IF NOT EXISTS / ALTER TABLE 컬럼 존재 검사):

- `users` (RBAC), `audit_log` (마스터 변경 이력)
- `facilities` 컬럼: `region_sido`, `region_sigungu`, `source`, `memo`
- `region_sido` / `region_sigungu` 는 [scraper/lib/ieps/region.ts](scraper/lib/ieps/region.ts) 의 `extractRegion()` 으로 cli-collect / 수동등록 / 검수 sync 모두에서 자동 채움. 라운드 2B 지도 드릴다운 키.

### 7.6 검수 → 마스터 자동 sync

[frontend/lib/ieps/review-sync.ts](frontend/lib/ieps/review-sync.ts) 의 `syncReviewedFieldInline(db, ctx)` 가 `attachment_id → permits` 를 거꾸로 추적해 ruleId 별로 다음에 반영:

| ruleId | sync 대상 |
|---|---|
| `decision_no` | `permits.decision_no` |
| `permit_date` | `permits.permit_date` |
| `company_name` | `facilities.company_name` (+ normalized) |
| `business_registration_no` | `facilities.business_registration_no` |
| `site_address` | `facilities.site_address` (+ normalized + region) |
| `phone_number` | `facilities.phone_number` |
| `industry_code_name` | `facilities.industry_code` / `industry_name` (정규식 분리) |
| `permit_scale` | `permit_scales` (대기/수질 종 + 배출량 regex 재파싱) |
| `product_output` | `product_outputs` |

사용자 정의 룰은 sync 대상에서 제외. 모든 sync 는 `audit_log` 에 `action='review_apply'` 로 기록.

### 7.7 환경변수 (`frontend/.env.local`)

```
AUTH_SECRET=replace-me-with-random-32bytes
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=changeme1234
ADMIN_NAME=관리자
```

`AUTH_SECRET` 미설정 시 Auth.js 가 dev 모드에선 자동 생성하지만 운영 환경에선 반드시 32바이트 이상 무작위 시크릿을 명시.

### 7.8 검증 시나리오 (수동 실행 결과 기준)

1. `/api/health` → `users.adminCount=1` + 환경변수로 시드된 admin 로그인 성공.
2. admin → `/admin/users` 에서 editor / viewer 1명씩 생성, 즉시 로그인 가능.
3. viewer → `/data/status` 진입은 가능하지만 “수집 시작” / “옵션 저장” 버튼 비활성, `/admin/*` 진입 시 `/login` 으로 리다이렉트, write API 는 `403`.
4. editor → `/facilities` 검색·필터·상세 OK + `/facilities/new` 수동 등록 후 `source=manual` 행 노출 + `region_sido`/`region_sigungu` 자동 채움.
5. editor → `/facilities/merge` 후보 그룹(주소/normalized name/BRN) 자동 추천 → target 1건 + 필드별 우선순위 선택 → 병합 실행 시 source facility 의 permits 가 target 으로 재할당, source row 는 삭제(`404`), `audit_log` 에 `facility_merge` 기록.
6. editor → `/data/review` 에서 `reviewedValue` + needs_review=false 로 확정 → facilities/permits 자동 갱신 + `audit_log.action='review_apply'` 1행 추가.
7. admin → editor `status='disabled'` → 해당 계정 즉시 로그인 차단 (`error=CredentialsSignin`).

### 7.9 다음 라운드 연결 포인트

- 라운드 2B: 광역시도 / 시군구 드릴다운 지도, 4종 파이 차트 모달, 컨셉 대시보드 요약 카드 (계약/허가/화관법/HAPs/ESG). `region_sido` / `region_sigungu` 컬럼 활용. ✓
- 라운드 2C: cli-collect onclick / 세션 기반 다운로드 분기를 위한 Playwright fallback + KpiPanel 다운로드 가시성. ✓ (§9 참조)
- 라운드 3: download_events 시계열 + 인앱 알람(`alerts`) + OperationsPanel(stacked bar + 사유 도넛). ✓ (§10 참조)
- 계약 / 영업·마케팅 모듈: 별도 라운드 (사용자 별도 지시 예정).

## 8. 지역 드릴다운 지도 + 컨셉 대시보드 (UI 라운드 2B)

라운드 2B 에서 다음을 추가했습니다 (상세 플랜: [docs/ieps-ui-round-2b.md](docs/ieps-ui-round-2b.md)).

### 8.1 컨셉 / 결정 사항

- 외부 지도 SDK (Google / Mapbox / Naver) 미사용. `d3-geo` + `topojson-client` 로 SVG 정적 렌더링 → API 키 / 결제 계정 불필요.
- 드릴다운: **전국 시도 17 → 시도 클릭 시 시군구 zoom-in → 시군구 클릭 시 분포 모달**.
- 모달 4종 파이 차트 — (1) 대기 종, (2) 수질 종 = 실측 (`permit_scales`), (3) 화관법, (4) ESG = `CONCEPT` 더미.
- 헤더 직하 5장 요약 카드: 통합허가(실측) + 화관법 / HAPs / ESG / 계약 진행(컨셉). 컨셉 카드는 hatched 배경 + `CONCEPT` 배지.

### 8.2 신규 컴포넌트 / 라우트

- [frontend/components/dashboard/ConceptSummaryCards.tsx](frontend/components/dashboard/ConceptSummaryCards.tsx) — 5장 요약 카드 그리드.
- [frontend/components/dashboard/RegionMap.tsx](frontend/components/dashboard/RegionMap.tsx) — SVG choropleth + 시도→시군구 zoom-in + breadcrumb.
- [frontend/components/dashboard/RegionDrillModal.tsx](frontend/components/dashboard/RegionDrillModal.tsx) — 4종 파이 + 사업장 30건 리스트 + `/facilities?focus=<id>` 진입 링크.
- `GET /api/dashboard/regions` — 시도/시군구 카운트 분포 (`viewer+`).
- `GET /api/dashboard/region-stats?sido=&sigungu=` — 종 규모 6슬롯(1~5종 + 미상) + 사업장 30건 (`viewer+`).
- 두 API 는 [frontend/lib/ieps/queries.ts](frontend/lib/ieps/queries.ts) 의 `getRegionDistribution()` / `getRegionStats()` 사용.

### 8.3 정적 자원 / 라이선스

- [frontend/public/geo/sido.topojson.json](frontend/public/geo/sido.topojson.json) (광역 17, ~880 KB) / [frontend/public/geo/sigungu.topojson.json](frontend/public/geo/sigungu.topojson.json) (시군구 250+, ~1.9 MB).
- 출처: `southkorea-maps` (kostat 2018 simplified, [frontend/public/geo/README.md](frontend/public/geo/README.md) 에 명시).
- 미들웨어 매처([frontend/middleware.ts](frontend/middleware.ts))에서 `/geo/` 경로를 인증 우회로 노출 (정적 자원).

### 8.4 키 매칭 규칙

- DB `region_sido` 는 [scraper/lib/ieps/region.ts](scraper/lib/ieps/region.ts) 의 `extractRegion()` 정규화 결과(`서울특별시`, `경기도`, `강원특별자치도` 등).
- 매칭 시 `shortenSido()` 로 약식 키(`서울`, `경기`, `강원`)로 변환 → topojson `name` 도 동일 키로 정규화.
- 시군구는 topojson 의 합성명(`수원시장안구`, `성남시중원구`)을 1차 시 단위(`수원시`, `성남시`)로 split 하여 DB `region_sigungu` 와 매칭.

### 8.5 디자인 가드레일

- 단일 hue green choropleth — 보라/무지개 계열 색상 금지 (`globals.css` 의 `--primary` 만 alpha 변동).
- 컨셉 카드 / 차트는 `concept-hatched` 패턴 + `CONCEPT` 배지로 실측과 명확히 구분.
- 글래스모피즘 톤은 라운드 2A 와 동일 유지.

### 8.6 검증 시나리오 (자동 + 수동)

자동(curl/PowerShell):

1. `npm run build` 통과 (Next.js 15 + Edge middleware).
2. admin 로그인 → `GET /api/dashboard/regions` 200 + `total / bySido / bySigungu` JSON.
3. admin → `GET /api/dashboard/region-stats?sido=경기도&sigungu=수원시` 200 + `airClass[1..5,0] / waterClass[1..5,0]` 6슬롯 + `facilities[]` ≤30건.
4. `GET /geo/sido.topojson.json` / `GET /geo/sigungu.topojson.json` 200 + `application/json` (미들웨어 우회).
5. viewer → `GET /api/dashboard/regions` 200, `POST /api/collect/start` / `POST /api/facilities/manual` 403 (read-only 유지).

수동(브라우저):

6. admin → `/data/status` 진입 시 컨셉 카드 5장(통합허가만 실측, 나머지 4장 CONCEPT 배지) + `RegionMap` SVG + 기존 KpiPanel/RecentResults/CollectionOptions 모두 렌더.
7. 경기도 클릭 → 시군구 zoom-in + breadcrumb 갱신 → 시군구 클릭 → 모달에서 대기/수질 실측 파이, 화관법/ESG CONCEPT 파이 + 사업장 30건 리스트.
8. 사업장 리스트 “열기” 클릭 → `/facilities?focus=<id>` 진입 후 해당 사업장이 자동 선택되어 상세 패널이 채워짐.

### 8.7 명시적 비범위

- 화관법 / HAPs / ESG 의 실측 데이터 연동은 계약 모듈 라운드 이후 (현재는 컨셉 더미).
- 지도 자유 줌·팬, 읍면동 3단계 드릴다운, 모바일 정밀 튜닝은 미포함.
- cli-collect 의 onclick / 세션 기반 다운로드 분기는 라운드 2C 에서.

## 9. Playwright Fallback + 다운로드 가시성 (UI 라운드 2C)

라운드 2C 에서 cli-collect 의 PDF 다운로드 단계를 강화했습니다 (상세 플랜: [docs/ieps-ui-round-2c.md](docs/ieps-ui-round-2c.md)).

### 9.1 트리거 정책 — 자동 폴백

각 첨부에 대해:

1. `download_url` 이 `javascript:` / `onclick` 식별자 / 빈 값이면 HTTP 스킵 → Playwright 직행 (`attempts=1, method='playwright'`).
2. 그 외에는 `fetch()` HTTP GET 우선 시도 → 실패 시 Playwright 폴백 (`attempts=2, method='playwright'`).
3. 폴백도 실패하면 `attachments.status='failed'`, `last_error` 에 사유 기록.

폴백은 기본 ON 입니다. 다음 방법으로 비활성화할 수 있습니다.

- `--no-playwright` CLI 플래그
- `IEPS_PLAYWRIGHT=0` 환경변수

추가 옵션: `--playwright-headless=true|false` (기본 true), `--playwright-timeout=ms` (기본 60000).

### 9.2 신규 모듈 / 변경 사항

- 신규: [scraper/lib/ieps/playwright-downloader.ts](scraper/lib/ieps/playwright-downloader.ts) — chromium 1회 init 후 매 호출마다 새 컨텍스트 → 게시물 페이지 진입 → 첨부 휴리스틱 매칭 (파일명 텍스트, `onclick*='fileDown'/'download'/'atchFile'`, `href*='download'`) → 클릭 → `page.waitForEvent('download')` → `download.saveAs(targetPath)`.
- 수정: [scraper/scripts/cli-collect.ts](scraper/scripts/cli-collect.ts) — `downloadPdfsToRaw()` 가 자동 폴백 / `attachments` UPDATE / NDJSON `event:'download'` 의 `method`/`attempts`/`status`/`reason` 필드 emit.

### 9.3 DB 스키마 (멱등 ALTER)

`attachments` 테이블에 다음 3개 컬럼이 추가됩니다 (cli-collect / frontend 양쪽 `getDb()` 진입 시 멱등 마이그레이션).

| 컬럼 | 타입 | 의미 |
| --- | --- | --- |
| `download_method` | TEXT | `'http'` \| `'playwright'` \| `null` (성공 시 마지막 사용 메소드) |
| `download_attempts` | INTEGER NOT NULL DEFAULT 0 | HTTP + Playwright 누적 시도 횟수 |
| `last_error` | TEXT | 마지막 실패 사유 (성공 시 `NULL`) |

### 9.4 UI 가시성

- [frontend/components/dashboard/ProgressDrawer.tsx](frontend/components/dashboard/ProgressDrawer.tsx) — download 로그 라인에 `HTTP`/`PLAYWRIGHT`/`CACHE`/`SKIPPED` 컬러 배지, `attempts > 1` 시 `↻N` 재시도 배지, 실패 시 빨간색 + reason. 단계 헤더에서도 마지막 처리 파일명 앞에 메소드 태그가 표시됩니다.
- [frontend/components/dashboard/KpiPanel.tsx](frontend/components/dashboard/KpiPanel.tsx) — KPI 6장으로 확장. 신규 카드 “Playwright 폴백” (성공 카운트), 기존 “다운로드 PDF” 카드의 hint 에 “실패 N건” 노출. 데이터는 [frontend/lib/ieps/queries.ts](frontend/lib/ieps/queries.ts) `getKpiSummary()` 의 `playwrightFallbacks` / `failedDownloads` 필드.
- KpiPanel 은 viewer 도 그대로 읽기 가능 (`requireAuthenticated()` 만 체크).

### 9.5 검증 시나리오

1. `cd frontend && npm run build` — 정적 페이지 14/14 생성 통과.
2. `cd scraper && npx ts-node --transpile-only scripts/cli-collect.ts --help` — CLI 옵션 도움말 정상 출력.
3. `await getDbAsync()` 1회 호출 후 `PRAGMA table_info(attachments)` 로 `download_method` / `download_attempts` / `last_error` 컬럼 존재 확인. 동일 명령을 한번 더 실행해도 ALTER 가 다시 시도되지 않는지(멱등성) 확인.
4. 정상 PDF 게시물 cli-collect 실행 → 모든 첨부 `download_method='http'`, KpiPanel “Playwright 폴백”=0.
5. `--no-playwright` 로 javascript: 패턴 첨부 시도 → `status='failed', last_error='javascript-only'`. KpiPanel “다운로드 PDF” hint 에 “실패 +1” 반영.
6. 폴백 ON 으로 동일 게시물 재실행 → Playwright 기동, `download_method='playwright', download_attempts >= 2`. KpiPanel “Playwright 폴백” +1.
7. SSE 스트림에서 `event:'download'` 의 `method`/`attempts` 필드가 ProgressDrawer 의 컬러 배지 + 재시도 배지로 렌더되는지 확인.

### 9.6 명시적 비범위

- 로그인 필요 게시판 / SSO / OTP 자동화는 모두 라운드 외.
- 다운로드 외 동적 렌더 캡처 (스크린샷 / 본문 SPA 렌더링) 는 미포함.
- `download_url` 이 보드별로 충돌하는 케이스는 IEPS 한정 발생 빈도 낮음으로 단일 URL 기준 UPDATE — 향후 도메인 확장 시 (board_id, download_url) 복합키 매칭 고려.

## 10. 운영 관측 보강 (UI 라운드 3)

라운드 3 에서 cli-collect 의 다운로드 흐름은 그대로 두고 (Observe-only), 시도 단위 시계열과 임계값 기반 인앱 알람을 추가했습니다 (상세 플랜: [docs/ieps-ui-round-3.md](docs/ieps-ui-round-3.md)).

### 10.1 정책

- **관측만 (Observe-only)**: 자동 재시도 / 백오프 / 쿨다운 없음. cli-collect 의 시도·재시도·HTTP→Playwright 폴백 로직은 라운드 2C 그대로 유지.
- **알람 채널**: 인앱 + 구조화 로그 (`alerts` 테이블 영속화 + 사이드바 봉지 + `/data/status` 배너). 외부 웹훅·이메일은 라운드 외.
- **시간 윈도우**: OperationsPanel 토글 24h / 7d / 30d. 임계값은 기본값 하드코드(편집 UI 는 후속 라운드).

### 10.2 신규 DB 스키마 (멱등 `CREATE TABLE IF NOT EXISTS`)

- `download_events(id, file_id, download_url, method, status, attempt_no, bytes, error, job_id, occurred_at)` — cli-collect 가 잡 종료 시점에 시도 결과를 일괄 INSERT.
- `alerts(id, severity, source, code, title, body, payload_json, job_id, created_at, acknowledged_at, acknowledged_by)` — 임계값 위반 시 INSERT, ack 시 `acknowledged_at` / `acknowledged_by` 채움.

### 10.3 임계값 룰 (기본값)

| code | severity | 조건 |
| --- | --- | --- |
| `high-failure-rate` | `warn` | `failed >= 5` AND `failed / total >= 0.3` |
| `playwright-spike` | `info` | `playwrightSucceeded >= 5` AND `playwrightSucceeded / total >= 0.5` |
| `persistent-failure` | `error` | 동일 `download_url` 의 최근 7일 실패 누적 ≥ 3회 |

룰 정의는 [scraper/lib/ieps/alert-rules.ts](scraper/lib/ieps/alert-rules.ts) 에 분리되어 있어 후속 라운드에서 외부 설정 주입(`RuleConfig`)으로 확장 가능합니다.

### 10.4 신규 API (Node 런타임, `requireAuthenticated`)

- `GET /api/alerts?status=open|all&limit=50` — 알람 목록 (viewer+)
- `GET /api/alerts/unread-count` — 미확인 카운트 (viewer+)
- `POST /api/alerts/:id/ack` — 확인 처리 (editor+, audit_log `alert.ack` 기록)
- `GET /api/dashboard/download-trend?days=7|30` — 일 단위 method×status 집계
- `GET /api/dashboard/failure-reasons?days=7` — `download_events.error` Top 10

쿼리는 [frontend/lib/ieps/queries.ts](frontend/lib/ieps/queries.ts) 의 `listAlerts`, `getAlertUnreadCount`, `getDownloadTrend`, `getFailureReasons` 헬퍼.

### 10.5 UI

- [frontend/components/dashboard/AlertBell.tsx](frontend/components/dashboard/AlertBell.tsx) — 사이드바 하단(또는 compact 변형) 봉지 아이콘 + 빨간 카운트 배지. 클릭 시 `AlertDrawer` 토글.
- [frontend/components/dashboard/AlertDrawer.tsx](frontend/components/dashboard/AlertDrawer.tsx) — 미확인 / 전체 탭 + 카드형 알람 + ack 버튼 (viewer 는 disabled with `(권한 없음)` 라벨).
- [frontend/components/dashboard/AlertBanner.tsx](frontend/components/dashboard/AlertBanner.tsx) — `/data/status` 상단에 미확인 알람 ≥ 1 일 때 표시. 가장 심각한 severity 색상 사용. 클릭 시 동일 드로어 진입.
- [frontend/components/dashboard/OperationsPanel.tsx](frontend/components/dashboard/OperationsPanel.tsx) — 24h/7d/30d 토글 + 일별 stacked bar (HTTP / Playwright / 캐시 / 실패) + 실패 사유 도넛 + Top 10 리스트. `RegionMap` 아래에 배치. 추가 차트 라이브러리 없이 `d3-shape` SVG 직접 렌더.

### 10.6 권한

| 동작 | viewer | editor | admin |
| --- | --- | --- | --- |
| 알람 조회 / 봉지 카운트 | O | O | O |
| 알람 ack | X | O | O |
| OperationsPanel 조회 | O | O | O |

ack 액션은 `audit_log.action='alert.ack'` 으로 기록되어 추적 가능.

### 10.7 검증 시나리오

1. `cd frontend && npm run build` — 35개 라우트 (신규 5개 포함) 모두 컴파일 통과.
2. `cd scraper && npx ts-node --transpile-only scripts/cli-collect.ts --help` 정상.
3. `getDbAsync()` 1회 호출 후 `PRAGMA table_info(download_events|alerts)` 로 스키마 확인.
4. cli-collect 정상 실행 → 첨부 수만큼 `download_events` row 생성 + 임계값 미초과 시 `alerts` 빈 상태.
5. 의도적 실패율 30% 이상으로 실행 → `alerts.code='high-failure-rate'` 1건. 사이드바 봉지에 빨간 배지(미확인 1) + `/data/status` 상단 `AlertBanner` 표시.
6. editor 로그인 후 ack → `acknowledged_at`/`acknowledged_by` 채워지고 배너 사라짐, `audit_log` 1건. viewer 는 `(권한 없음)` 라벨.
7. 동일 잘못된 URL 7일 내 3회 재실행 → `persistent-failure` 알람 (`severity='error'`) 추가 + 봉지 빨간 배지 +1.

### 10.8 명시적 비범위

- 외부 알람 채널 (Slack / 이메일 / Webhook) — 후속 라운드 후보.
- 자동 재시도 / 백오프 / 쿨다운 — 본 라운드 외 (사용자 결정: Observe-only).
- 임계값 편집 UI — 후속 “설정 페이지” 단계. 현재는 [scraper/lib/ieps/alert-rules.ts](scraper/lib/ieps/alert-rules.ts) 의 `DEFAULT_RULE_CONFIG` 만 적용.
- 화관법 / HAPs / ESG 등 외부 데이터 소스 통합 — 별도 라운드.

## 11. 대외 신고 대기열 (IEPS·ETIS 신고 관리, 마이그 213)

통합환경허가시스템(IEPS)의 **기술인력 변경신고**(선임·해임·등급 변경)·**대행 실적 보고**(체결·변경·이행)와
엔지니어링종합정보시스템(ETIS)의 **기술자 변경신고**(입/퇴사·경력 추가·종료)를 잊지 않도록, MCM 데이터에서 신고 사유를
자동 파생해 대기열로 보여 준다. 제출은 각 사이트에서 사람이 한다(문자인증·공동인증서) — 자동 입력 도구는 2단계.

- 화면: `/contracts/filings`(계약 메뉴 › 대외 신고 대기열) + 홈 카드 "대외 신고 대기". 권한 `filing.view` / `filing.manage`.
- 파생 규칙(`frontend/lib/filings/store.ts` `syncFilings`, 목록·요약 API 호출 시 재계산, 멱등):
  - IEPS 기술인력: `env_grade` 보유 직원. 선임 = 활성 + 대행인력등록일 미기입 + 기준일 이후 입사, 해임 = 인사이벤트 resignation,
    등급 변경 = 직원 저장 시 `env_grade`/`specialty_field` 변경 감지(이력이 없어 저장 시점 기록).
  - IEPS 대행 실적: 용역분류 통합허가 계열 계약. 체결 = 계약일, 변경 = `contract_change_events`, 이행 = **완료일(허가일)** `permit_issued_at`.
  - ETIS 기술자: `eng_grade` 보유 직원. 입사/퇴사, 경력 추가 = 참여인력 시작(참여 시작일 → 계약 착수일 폴백), 경력 종료 = 참여 종료일(전원 기입) → 허가일 폴백.
- 설정(화면 우상단): 기준일(이전 발생분 제외, 마이그레이션 적용일이 초기값)·종류별 기한 일수(기본 30)·기한 임박 알림 일수·앱 푸시 수신자.
  푸시(`filing.due`)는 결재 리마인드 틱에서 하루 1회.
- 데이터 보강: 계약 상세 "대행 실적 보고 정보"(낙찰률·사전협의 통보일자, `award_rate`/`preconsult_notified_at`),
  직원 등록 "엔지니어링협회 회원번호"(`etis_member_no`). 선임 신고를 제출 완료로 표시하면 대행인력등록일이 비어 있을 때 채워진다.
