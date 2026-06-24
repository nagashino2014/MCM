# 구현 플랜 A — 계정-조직 통합 & 사번 자동 발급

> 상위 설계: [permission-rbac-redesign.md](permission-rbac-redesign.md) §7.5.
> 본 문서는 그 §7.5를 **실제 코드로 옮기기 위한 단계별 실행 플랜**이다. RBAC 가드 교체(B/C)는 범위 밖.

## 0. 목표 / 범위

**목표**: 별도 "계정 생성"을 폐지하고, 조직도 인원(`employee_profiles`)을 곧 계정(`users`)으로 본다. 인원에게 **사번(=로그인 ID)** 을 자동 발급하고, 초기 비번=사번 + 강제 변경, 로그인 식별자는 사번 또는 이메일 로컬파트.

**범위(이 PR 묶음)**:
1. 스키마: `users`에 `login_id`/`email_local`/`must_change_password`, `employee_profiles.employee_no`=사번.
2. 사번 생성 코어 + 계정 발급 서비스/API.
3. 인증 흐름: 식별자 확장 + 비번 강제 변경 게이트.
4. UI: registry에서 계정 생성 패널 제거, 발급 전 입력 강제 게이트 + 발급 버튼/상태 배지.

**범위 밖**: 권한 카탈로그(`041`), 마법사 재구축, 라우트 가드 교체. (단 `account.manage` 권한키는 본 묶음에서 함께 시드)

## 0.1 현황(확인된 사실)
- `users`: `user_id` PK, `email NOT NULL UNIQUE`, `password_hash`, `name`, `role CHECK`, `status`, (+012) `dept_id`/`position_id`/`employee_id`. ([001_initial_schema.sql:255](../infra/aws/001_initial_schema.sql))
- `employee_profiles`: `employee_no`, `user_id`(FK→users), `hired_at`, `gender(male|female)`, `birth_date`, `email`, `status`. ([012:119](../infra/aws/012_user_org_rbac_hr_records.sql))
- 조직 스냅샷이 인원별 `user_id`를 이미 반환 → 계정 연결 여부 판별 가능. ([organization.ts:79](../frontend/lib/admin/organization.ts))
- `authorize`는 `findUserByEmail(email)` 단일 경로. ([config.ts:39](../frontend/lib/auth/config.ts))
- `EmployeeRegistryPanel`에 `hiredAt`/`gender`/`birthDate` 입력 UI 이미 존재. ([EmployeeRegistryPanel.tsx:37](../frontend/components/admin/users/EmployeeRegistryPanel.tsx))

---

## 1. 단계별 작업

### Step 1 — 마이그레이션 `042_account_org_unify.sql` ✅ 작성됨
> 멱등. 012 위에 적용. (041은 `041_login_attempts.sql`로 점유됨 → 042 사용)

```sql
-- users: 로그인 식별자 & 강제 변경 플래그
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS login_id text,
  ADD COLUMN IF NOT EXISTS email_local text,
  ADD COLUMN IF NOT EXISTS must_change_password integer NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_login_id    ON users(login_id)    WHERE login_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_local ON users(email_local) WHERE email_local IS NOT NULL;

-- employee_profiles.employee_no = 사번(로그인 ID). 이미 컬럼 존재 → UNIQUE 인덱스만.
CREATE UNIQUE INDEX IF NOT EXISTS idx_emp_employee_no ON employee_profiles(employee_no) WHERE employee_no IS NOT NULL;

-- account.manage 권한키 시드 (가드 교체 전 미리 등록; tpl-hr 부여는 §5 확정 후)
INSERT INTO permissions (permission_key, module, action, description, scopes_supported, is_dangerous, created_at)
VALUES ('account.manage','account','manage','계정(사번) 발급·비밀번호 리셋','all',1, now()::text)
ON CONFLICT (permission_key) DO UPDATE SET description = EXCLUDED.description, is_dangerous = EXCLUDED.is_dangerous;
```
- **기존 email 계정 백필**: 운영 데이터에 이미 email 로그인 계정이 있으면, 일회성 backfill로 `email_local = split_part(email,'@',1)` 채우되 충돌 시 NULL 유지. (마이그레이션 말미 UPDATE … WHERE email_local IS NULL + 충돌 회피 서브쿼리)

### Step 2 — 사번 생성 코어 `frontend/lib/admin/employee-no.ts` (신규)
```ts
/** YYYYMMDD + GG(남01/여02) + NN(생년월일 오름차순 순번). 12자리. */
export function buildEmployeeNo(p: {
  hiredAt: string;      // 'YYYY-MM-DD'
  gender: "male" | "female";
  seq: number;          // 1-base
}): string;             // 예: '201903040102'

/** (입사일, 성별) 그룹에서 birthDate 오름차순 순번을 계산해 사번 발급.
 *  이미 사번을 가진 동일 그룹 인원 + 대상 인원을 함께 정렬해 NN 결정. */
export async function issueEmployeeNo(employeeId: string): Promise<string>;
```
- 알고리즘: `hired_at`→YYYYMMDD, `gender`→GG, 동일 `(YYYYMMDD,GG)` 그룹에서 **birth_date 오름차순** 정렬 후 1-base 순번. 그룹 1명이면 01.
- **레이스 차단**: `withDbWrite`(트랜잭션) 안에서 그룹 조회→발급. 동일 그룹 동시 발급 직렬화.
- 입력 가드: `hired_at`/`gender`/`birth_date` 중 하나라도 NULL이면 `throw new Error("MISSING_REQUIRED_FOR_NO")`.

### Step 3 — 계정 발급 서비스 `frontend/lib/auth/account-provisioning.ts` (신규)
```ts
export interface ProvisionResult { loginId: string; tempPassword: string; emailLocal: string | null; }

/** 조직 인원에게 사번 계정 발급. 멱등(이미 user 연결 시 재발급 금지, 사번만 없으면 채움). */
export async function provisionAccountForEmployee(employeeId: string, actorUserId: string): Promise<ProvisionResult>;
```
처리 순서(단일 트랜잭션):
1. employee 로드 → 필수 3필드 검증(없으면 400 `MISSING_REQUIRED_FOR_NO`).
2. `issueEmployeeNo` → 사번. `employee_profiles.employee_no` 저장.
3. `email_local` 계산 = `email`의 @앞. **충돌 시 NULL**(= 사번 전용, §7.5-3 확정).
4. `users` upsert: `login_id=사번`, `email_local`, `password_hash = hash(사번)`, `must_change_password=1`, `name`, `role='viewer'`(부트스트랩 최소), `employee_id` 연결. `email`은 NOT NULL UNIQUE 제약 때문에 placeholder(`<사번>@local`) 또는 기존 email 사용.
5. `employee_profiles.user_id` 연결.
6. `recordAuditLog(action:"account_provision")`.
7. 반환 `{loginId, tempPassword:사번, emailLocal}`.

> **email NOT NULL 제약 처리**: 인원에 email이 없을 수 있으므로, `users.email`은 유지하되 발급 시 email 없으면 `"<사번>@noemail.local"` 채움(로그인엔 안 씀). 차후 email 컬럼 nullable 전환은 별도.

### Step 4 — API
- **신규** `POST /api/admin/employees/[id]/provision-account` → `requireRole("admin")` (B 단계에서 `requirePermission("account.manage")`로 교체). body 없음. `provisionAccountForEmployee`. 응답 `{loginId, tempPassword}`.
- **수정** `POST /api/admin/users`([route.ts:27](../frontend/app/api/admin/users/route.ts)) → **제거 또는 410 Gone**. 계정은 인원 발급으로만.
- **신규** `POST /api/account/change-password` → 세션 사용자 본인. body `{currentPassword,newPassword}`. 검증 후 `password_hash` 갱신 + `must_change_password=0`. (`resetUserPassword` 재사용 + 플래그 해제)
- **수정** `users.ts`: `findUserByLoginIdentifier(identifier)` 추가 — `login_id = $1 OR email_local = $1` 조회. `createUser`는 내부 발급 전용으로 시그니처 확장(`loginId`, `mustChange`, `emailLocal`).

### Step 5 — 인증 흐름 `config.ts` / `edge-config.ts`
- `authorize`: credentials 필드 `email` → **`identifier`**(사번 또는 로컬파트)로. `findUserByLoginIdentifier(identifier.trim())` 사용. (하위호환: 입력에 `@` 포함 시 로컬파트만 추출)
- 반환 user에 `mustChangePassword` 추가 → jwt/session 토큰에 전파(`config.ts` jwt 콜백, `edge-config` session 타입 확장).
- **강제 변경 게이트**: `edge-config.ts`의 `authorized` 콜백(미들웨어)에서 `token.mustChangePassword === 1`이면 `/account/change-password` 외 모든 경로를 그 페이지로 리다이렉트.
- 로그인 폼 라벨 "이메일" → "사번 또는 아이디"로(클라이언트 텍스트만).

### Step 6 — UI `admin/users/registry`
- **계정 생성 패널 제거**: `UserRoundPlus` 진입/패널 삭제. (registry 페이지에서 계정 생성 관련 상태·핸들러 제거)
- **계정 상태 배지**: 인원 행/우측 패널 헤더에 `OrganizationEmployeeRow.userId` 기준 —
  - `userId != null` → **발급됨**(사번 표시).
  - `userId == null` && 3필드 충족 → **미발급**(발급 버튼 활성).
  - `userId == null` && 3필드 결손 → **정보부족**(발급 버튼 비활성).
- **발급 전 입력 강제 모달**(EmployeeRegistryPanel 'basic' 탭 재활용 또는 경량 모달): `정보부족`에서 "계정 발급" 클릭 시, 결손 필드(`hiredAt`/`gender`/`birthDate`)만 빨갛게 노출 → 저장 시 employee 갱신 → 상태 `미발급` 전환.
- **발급 액션**: `미발급`에서 클릭 → `provision-account` 호출 → 성공 토스트/모달로 **사번 + 초기 비번(=사번) + "최초 로그인 시 변경" 안내**.
- **change-password 페이지** 신규 `app/(auth)/account/change-password/page.tsx`(또는 app 루트 외 인증 레이아웃): 현재 비번/새 비번 입력 → `/api/account/change-password`.

---

## 2. 적용·배포 순서
1. `042_account_org_unify.sql` staging 적용(멱등, 무중단). 동작 변화 없음.
2. lib(Step2~3) + API(Step4) 배포. (UI 미연결이라 표면 변화 없음)
3. 인증 흐름(Step5) 배포 — **여기서부터 로그인 식별자 확장**. 기존 email 계정은 `email_local` 백필로 계속 로그인 가능해야 함(회귀 주의).
4. UI(Step6) 배포 — 계정 생성 패널 제거 + 발급 게이트 노출.
5. 운영: 조직 인원 일괄 발급(또는 인사담당이 순차 발급).
- 배포 대상 이미지: **next 만**(프론트 전용). 백엔드 OCR 이미지 무관.

## 3. 검증 체크리스트
- [ ] `npx tsc --noEmit` — 수정 파일 필터로 신규 타입 에러 0.
- [ ] 사번 규칙: 입사일 같고 성별 다른 2명 → 둘 다 `…01`. 같은 입사일 남 3명 → 생년월일 순 `01/02/03`. (단위 테스트 `buildEmployeeNo`/`issueEmployeeNo`)
- [ ] 이메일 로컬파트 충돌 인원 → `email_local` NULL, 사번으로만 로그인.
- [ ] 발급 후 사번으로 로그인 → 강제 변경 페이지로 이동 → 변경 후 정상 진입.
- [ ] 기존 email 계정 로그인 회귀 없음(email_local 또는 사번).
- [ ] `정보부족` 인원 발급 버튼 비활성 + 모달 입력 후 발급 가능.

## 4. 리스크 / 롤백
- **잠금(lock-out) 위험**: 인증 흐름 변경(Step5)이 가장 민감. → email_local 백필을 Step1에서 끝내고, authorize는 `login_id OR email_local`을 **둘 다** 받아 기존 로그인 보존. 문제 시 Step5만 직전 리비전으로 롤백(태스크 정의 image 되돌림).
- **email NOT NULL/UNIQUE 충돌**: placeholder email 규칙으로 회피. 동일 placeholder 충돌 없도록 사번 기반 생성.
- **must_change_password 무한 리다이렉트**: 게이트 예외 경로에 `/account/change-password`와 `/api/account/change-password`, 정적 자원 포함.
- **감사 로그**: 발급/리셋/강제변경 모두 `recordAuditLog`.

## 5. 작업 분해 (PR 단위 제안)
| PR | 내용 | 의존 | 상태 |
|---|---|---|---|
| PR-A1 | `042` 마이그레이션 + email_local 백필 | — | ✅ `042_account_org_unify.sql` |
| PR-A2 | 사번 코어 + 발급 서비스 | A1 | ✅ `employee-no.ts`·`account-provisioning.ts`·audit 액션 |
| PR-A3 | API 추가(provision / change-password / `findUserByLoginIdentifier`) | A2 | ✅ 추가분 완료(계정 생성 API 제거는 A5로 이동) |
| PR-A4 | 인증 흐름(authorize·게이트·세션 타입) **+ change-password 페이지**(게이트와 짝) | A3 | ✅ config·edge-config·users·login·change-password 페이지 |
| PR-A5 | registry 발급 바·상태 배지, `/admin/users` 계정 생성 폼 제거, `POST /api/admin/users` 410, 조직 스냅샷에 발급 판정 필드 | A4 | ✅ 완료 |

**A 단계 전체 코드 작성 완료.** 남은 것은 staging 적용·검증뿐(아래 §2 순서).

> 단위 테스트: 프론트엔드에 테스트 러너가 없어(`next lint`만 존재) 신규 도입 보류. 순수 함수(`buildEmployeeNo`/`computeSeq`)는 요구 케이스 대입 수동 검증, DB 로직은 §3 staging 체크리스트로 대체.

## 6. 미결(상위 §11과 연동)
- `users.email` 컬럼을 장기적으로 nullable로 바꿀지(placeholder 제거).
- `role` 기본값: 발급 시 `viewer`로 두되, B 단계에서 RBAC 템플릿으로 실제 권한 부여(직급 기본 매핑 1-click).
