# IEPS UI 라운드 2A — 사업장 마스터 + RBAC 인증

## 결정 사항 (사용자 확정)

- **분할**: 3 sub-round. 이번 라운드는 (2A)에 한정. (2B) 지도+컨셉 카드 / (2C) Playwright fallback은 별도 라운드.
- **인증**: 팀용 다중 사용자 + RBAC (admin / editor / viewer).
- **사용자 관리**: admin이 다른 사용자 계정 생성/수정/삭제/역할 변경.

## 합리적 기본값

- **첫 admin 시드**: 환경변수 `ADMIN_EMAIL` / `ADMIN_PASSWORD`. 부팅 시 `users` 테이블에 admin이 0명이면 자동 생성.
- **권한 매트릭스**:
  - admin: 모든 권한 (사용자 관리 포함)
  - editor: 사업장 CRUD / 수동등록 / 병합 / 검수 확정 / 수집 트리거 / 설정
  - viewer: 모든 데이터 read-only
- **검수→마스터 반영 트리거**: 자동. `PATCH /api/parsed-fields/[id]` 에서 `reviewedValue` 저장 + `needs_review=0` 시점에 facility/permit/permit_scale/product_output 마스터로 sync, `audit_log` 기록.
- **인증 라이브러리**: Auth.js (NextAuth v5). credentials provider + JWT 세션. SQLite는 sql.js라 NextAuth adapter 대신 자체 구현 (`users` 테이블 직접 read/write).
- **세션 저장**: JWT (쿠키), DB 세션 테이블 불필요.

## DB 스키마 확장 (scraper/lib/scraper/scraper-db.ts)

기존 `initDatabase()` 마지막에 다음 테이블/컬럼 추가:

```sql
-- users — RBAC
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')),
  status TEXT NOT NULL DEFAULT 'active',  -- active | disabled
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- audit_log — 마스터 변경 이력
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  target_table TEXT NOT NULL,
  target_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL
);

-- facilities 확장 컬럼
ALTER TABLE facilities ADD COLUMN region_sido TEXT;
ALTER TABLE facilities ADD COLUMN region_sigungu TEXT;
ALTER TABLE facilities ADD COLUMN source TEXT NOT NULL DEFAULT 'ieps';
ALTER TABLE facilities ADD COLUMN memo TEXT;
```

`region_sido` / `region_sigungu` 는 라운드 2B 지도용으로 미리 추가. cli-collect 적재 / 수동등록 / 검수 sync 모두에서 `site_address` 텍스트로부터 정규식 추출.

## 페이지 / API 라우트

### 신규 페이지

- `frontend/app/(auth)/login/page.tsx` — 이메일/비번 로그인.
- `frontend/app/(app)/admin/users/page.tsx` — admin 전용. 사용자 CRUD/역할변경/비활성화/비밀번호 재설정.
- `frontend/app/(app)/facilities/page.tsx` — 기존 placeholder 교체. 목록 + 검색/필터 + 상세 패널.
- `frontend/app/(app)/facilities/new/page.tsx` — 수동 등록 폼.
- `frontend/app/(app)/facilities/merge/page.tsx` — 중복 후보 자동 추천 + 필드별 우선순위 마법사.

### 신규/수정 API

- `POST /api/auth/[...nextauth]` (Auth.js handler)
- `GET/POST /api/admin/users`, `PATCH/DELETE /api/admin/users/[id]`, `POST /api/admin/users/[id]/reset-password`
- `GET /api/facilities`
- `GET/PATCH /api/facilities/[id]`
- `POST /api/facilities/manual`
- `POST /api/facilities/merge`
- `PATCH /api/parsed-fields/[id]` 보강 — 마스터 sync + audit_log

## 인증 / 권한 가드

- `frontend/middleware.ts` — 미인증 시 `/login` 리다이렉트. `/admin/*` 는 admin만, write 액션은 editor+.
- `frontend/lib/auth/config.ts` — Auth.js (credentials + JWT, role 주입).
- `frontend/lib/auth/guards.ts` — `requireSession()`, `requireRole()`.
- `frontend/lib/auth/seed.ts` — 부팅 시 admin 0명이면 환경변수로 시드.
- 비밀번호 해시: `bcryptjs`.

## 검수→마스터 반영 (자동 sync)

`PATCH /api/parsed-fields/[id]` 에서 `reviewedValue + needs_review=0` 저장 시 ruleId 별로 매핑:

- `decision_no` → `permits.decision_no`
- `company_name` → `facilities.company_name` (+ normalized)
- `business_registration_no` → `facilities.business_registration_no`
- `site_address` → `facilities.site_address` (+ region_sido/sigungu 재계산)
- `phone_number` → `facilities.phone_number`
- `industry_code_name` → `facilities.industry_code` / `industry_name`
- `permit_date` → `permits.permit_date`
- `permit_scale` → `permit_scales` (regex 재파싱)
- `product_output` → `product_outputs`

사용자 정의 룰은 sync 대상에서 제외.

## 사이드바 / 메뉴

`frontend/config/menu.ts` 에 admin 전용 항목 추가:

- 사이드바 하단 별도 섹션 `시스템` (admin role에만 노출):
  - `사용자 관리` → `/admin/users`
- viewer는 쓰기 액션 버튼 비활성.

## 검증 시나리오

1. 부팅 후 환경변수로 시드된 admin 계정으로 로그인 성공.
2. admin → `/admin/users` 에서 editor / viewer 1명씩 생성.
3. viewer → `/data/status` 진입 가능, 쓰기 버튼 비활성, `/admin/*` 는 403.
4. editor → `/facilities` 검색/상세 OK + `/facilities/new` 수동 등록.
5. editor → `/facilities/merge` 후보 2건 → target 1건 병합.
6. editor → `/data/review` 에서 reviewedValue 저장 → 마스터 자동 반영 + audit_log.
7. admin → editor 비활성화 → 즉시 로그인 차단.

## 의존성 / 마이그레이션

- `frontend/package.json` 신규: `next-auth@beta` (Auth.js v5), `bcryptjs`, `@types/bcryptjs`.
- `scraper-db.ts` `initDatabase()` 에서 컬럼 존재 체크 후 `ALTER TABLE`.
- cli-collect / 수동등록 / 검수 sync 모두에서 `region_sido` / `region_sigungu` 채움.

## 명시적 비범위

- 구글 맵스 광역/시군구 드릴다운 + 4종 파이 차트 모달 → 라운드 2B
- 컨셉 대시보드 요약 카드 → 라운드 2B
- cli-collect Playwright fallback → 라운드 2C
- 계약 / 영업·마케팅 모듈 → 별도 라운드
