# role 일원화 구현 계획 — 옛 role(admin/editor/viewer) 폐기, 권한 템플릿 단일화

작성 2026-09-02. 선행 문서 `docs/permission-rbac-redesign.md`(설계 권위)·`docs/account-org-unify-plan.md`.
이 문서는 **남은 작업의 대상 목록**이다. 새 세션에서 "role 일원화 시작"으로 착수할 때 이 문서와 메모리
`rbac-role-unification-plan`을 출발점으로 삼는다.

> **진행 기록(2026-10-19)** — WP0·1·2·4·5·6·9(검증)를 브랜치 `claude/rbac-role-unification`(origin/main `9ce4d0f` 분기, 워크트리 `.claude/worktrees/rbac-role-unification`)에서 구현했다. 마이그는 **291**(급여·성과급 권한키+배분)·**292**(users.role → admin|member)이며 213(tpl-view-all)은 재실행 대상이다. 결정(테스트 계획서 §6, 사용자 확정): 임원 `payroll.view`·`finance.view` 조회 부여 / 급여·성과급 키 `tpl-hr` 배분 / 근태 관리 6화면 `staffing.edit` / `users.role` 2값 유지. **남은 것 = WP3(fallbackRoles 제거)·WP7(모바일 OTA)·WP8(자산)** — 오픈 후 후속. 구현 요약과 lock-out 점검 쿼리는 §5.

## 0. 목표와 원칙

- **판정·노출·데이터 스코프의 근거를 권한 템플릿(grant) 하나로** 통일한다. `users.role`의 `editor`/`viewer`는 의미를 폐기한다.
- `admin` role은 **삭제하지 않고 부트스트랩 플래그로 축소**한다. 남기는 용도 3가지뿐: ① 비상 우회 `RBAC_ADMIN_BYPASS=true`(권한 배분 실수로 관리자가 잠겼을 때) ② `seed.ts` 최초 관리자 생성 ③ "마지막 관리자 보호" 로직. 그 외 어떤 코드도 role을 읽지 않는다.
- 새 기능 개발 규칙(재확인): **권한 키 신설 = 카탈로그 시드 + `tpl-system-admin` grant 보충 + 해당 업무 템플릿 배분**까지 한 마이그레이션에서. (7-29 마이그 110 사고, 8-01 reports.nlq 403 사고의 교훈)

## 1. 현황 스냅샷 (2026-09-02 조사)

이미 끝난 것: `RBAC_ENFORCE=true` 강제 모드(기본값), `checkPermission`의 admin 우회 제거(마이그 111, 7-29), 전 모듈 API `requirePermission` 교체(7월). **API 판정은 이미 템플릿 기준**이다.

남은 잔재 — 전부 파일 단위로 식별됨:

| # | 잔재 | 규모 | 성격 |
|---|---|---|---|
| A | `requireAdmin()` 사용 라우트 | **26개** (payroll 19 + bonus 7) | 8월 급여·성과급 개발이 deprecated 헬퍼로 만들어진 **회귀**. 권한 키 자체가 카탈로그에 없음 |
| B | `fallbackRoles` 인자 | **192개** 라우트 파일 | 호환 모드(`RBAC_ENFORCE=false`) 전용 죽은 코드. 삭제만 |
| C | 화면 진입/버튼 게이트 `role === 'admin'` 등 | **29개** 파일 | 실제 동작 중. 권한 키 판정으로 교체 필요 |
| D | 사이드바 메뉴 노출 `config/menu.ts` `minRole` | 7개 메뉴 항목 + `isMenuVisibleForRole` 사용처 2곳 | role 기반 노출 |
| E | 미들웨어 `/admin` 경로 role 차단 | `lib/auth/edge-config.ts` 1곳 | edge runtime이라 DB 조회 불가 → JWT에 권한 요약 필요 |
| F | lib 데이터 스코프 role 분기 | `lib/quote/perm.ts`, `lib/deliverable/scope.ts` (+ `lib/ieps/queries.ts`, `lib/bid/package-store.ts` 확인) | "admin이면 전체" 분기 → `hasGlobalScope` |
| G | 계정 관리 UI/API의 role 편집 | `app/(app)/admin/users/page.tsx`, `app/api/admin/users/[id]/route.ts` | editor/viewer 선택지 제거, 마지막 관리자 보호는 `tpl-system-admin` 보유자 기준으로 |
| H | 모바일 앱 role 참조 | `bids.tsx`·`sales.tsx`(`canEdit`), `more.tsx`(ROLE_LABEL), `/api/mobile/auth/{login,refresh,me}` 응답 | role 대신 권한 요약 전달 |
| I | 로그인만으로 열린 라우트 중 재검토 대상 | `assets` 6개 중 3개 | 자산 관리는 권한 키(`asset.manage` 존재) 적용 여부 결정 |

의도적으로 **남기는** 것: 채팅·메일·캘린더·홈 위젯·개인문서함·주소록·대시보드 집계의 세션-only 라우트(본인 데이터/전직원 공용 조회). `mail.manage` 같은 관리 기능만 키 보유.

## 2. 작업 패키지 (WP) — 순서대로

### WP0. 준비 (반나절) — ✅ 2026-10-19
- [x] `git fetch origin` 후 **최신 main에서 브랜치 분기** (`claude/rbac-role-unification`, origin/main 9ce4d0f). 공유 체크아웃에 다른 세션의 미커밋 변경(todo)이 있어 별도 워크트리에서 작업.
- [x] 마이그레이션 번호 확보: 원격 전 브랜치 `infra/aws/` 확인(최대 286, 로컬 untracked 287) → **291·292**.
- [x] lock-out 사전 점검 쿼리 기록(§5.3) — 실행은 배포 전 bastion 에서 사용자가 수행(이 세션은 DB 접근 없음).
- [x] 롤백 경로 확인: task def에 `RBAC_ADMIN_BYPASS=true` 추가 후 재배포하면 admin role 우회 부활(`lib/auth/rbac.ts` 분기 유지).

### WP1. 급여·성과급 권한 키 신설 + 템플릿 배분 (마이그 **291**) — ✅
- [x] 권한 키(라우트 기준으로 확정):
  - `payroll.view` (대장·명세서·근로계약·세율표·연말정산 조회), `payroll.edit` (대장 생성·항목·규칙·세액 프로필·근로계약·상여 계획 수정), `payroll.close` (대장 확정·명세서 발송·차수 발송·EDI 등록·연말정산 확정 — is_dangerous=1), `payroll.export` (명세서·근로계약서 파일·연말정산 바인딩 다운로드)
  - `bonus.calculate` (산정·배분·비용·초안), `bonus.confirm` (설정·확정, is_dangerous=1), `bonus.send` (명세서 PDF·발송, is_dangerous=1) — 기존 `bonus.view` 유지
- [x] 배분: `tpl-system-admin` 전부 / `tpl-hr` payroll.* + bonus.* / `tpl-exec` payroll.view·finance.view(+기존 bonus.view) / `tpl-view-all` payroll.view / `tpl-staff-basic`·`tpl-dept-lead` 미부여(본인 명세서는 세션 라우트 `/api/payroll/my-*` 그대로).
- [x] 111·120·271 패턴(멱등 `WHERE NOT EXISTS`, 결정적 grant_id `grant-<prefix>-<md5>`). 213 재실행 시 같은 결과(tpl-view-all 은 291 에서 먼저 채움).

### WP2. `requireAdmin` → `requirePermission` 교체 — 잔재 A — ✅
- [x] payroll **26** 라우트(9월 조사 19개 + bonus-plan·longevity·trip-allowance·yearend/{bundle,uploads,uploads/[id],withholding}): GET→`payroll.view`, 변경→`payroll.edit`, `rounds/[roundId]`(차수 기안·발송)·`statements` POST(명세서 발송)·`edi` POST(EDI 등록)→`payroll.close`, `generate` action=confirm·`yearend` action=confirm/unconfirm 은 `payroll.edit` 통과 뒤 `payroll.close` 추가 판정, 파일·바인딩 GET→`payroll.export`.
- [ ] payroll 세션-only 라우트(`my-contracts`·`my-statements`·`my-yearend`)는 **그대로 세션 판정**(본인 데이터 — 이번 범위 밖, 테스트 계획서 §1.3 "세션만 요구"와 일치).
- [x] bonus 7 라우트: `allocations` PUT·`calculate`·`costs`·`draft` POST→`bonus.calculate`, `settings` PUT→`bonus.confirm`, `statements/pdf`·`statements/send`→`bonus.send`. 응답의 `canEdit`/`isAdmin` 필드는 이름을 유지한 채 각각 `bonus.calculate`/`bonus.confirm` 보유로 계산(화면 무변경).
- [x] `lib/auth/guards.ts`: `requireAdmin`·`requireRole`·`requireEditor` 삭제. `fallbackRoles` 타입은 `LegacyRole`(admin|member|editor|viewer)로 넓혀 192개 호출부를 그대로 둠(WP3).
- [ ] 검증(스테이징 배포 후): `tpl-hr`만 가진 계정으로 급여 대장 조회·생성, `tpl-staff-basic` 계정 403 — 테스트 계획서 D-27.

### WP3. `fallbackRoles` 일괄 제거 — 잔재 B
- [ ] `requirePermission` 시그니처에서 `opts.fallbackRoles`를 **제거**하고 `RBAC_ENFORCE=false` 호환 분기를 삭제(비상 우회는 `RBAC_ADMIN_BYPASS` 하나로 일원화). → `npx tsc --noEmit | grep fallbackRoles`로 192개 사용처가 타입 에러로 전부 드러남.
- [ ] 모듈별 정리(파일 수): sales 28 · contracts 28 · approval 25 · facilities 24 · admin 23 · work-plan 14 · bonus 8 · scraper 7 · work-tasks 6 · facility-groups 6 · recruit 4 · bonus-source 4 · parsed-fields 3 · trash 2 · staffing 2 · collection-configs 2 · 기타 6. 인자만 지우는 기계적 작업 — 정규식 일괄 치환 후 tsc.
- [ ] `docs/privacy-compliance-blueprint.md` G7 항목의 `RBAC_ENFORCE` 언급 갱신.

### WP4. lib 데이터 스코프 role 분기 교체 — 잔재 F — ✅
- [x] `lib/quote/perm.ts` `role==='admin'` → `hasGlobalScope(userId, 'sales.edit')`(견적 권한 키 신설 없이 영업 편집 전사 범위로 대체). 시그니처 `(userId)` — 호출처 0.
- [x] `lib/deliverable/scope.ts` `role==='admin'→null(전체)` → `hasGlobalScope(userId,'contract.view')`. 호출처 `api/contracts/deliverables/tree` 갱신.
- [x] `lib/ieps/queries.ts`, `lib/bid/package-store.ts`의 role 은 사용자 role 이 아님(인력 역할·회사 역할) — 교체 대상 아님 확인.
- [x] `loadUserAccess`가 role을 계속 로드하는 것은 `ADMIN_BYPASS` 때문 — 유지.

### WP5. 세션에 권한 요약 탑재 → 화면 게이트·메뉴 교체 — 잔재 C·D·E — ✅
- [x] **JWT 권한 요약**: `lib/auth/rbac.ts` `summarizePermissions()`/`loadPermissionSummary()` → `perms: string[]`("key" / 전사 범위는 "key@all"). `lib/auth/config.ts` jwt 콜백이 로그인·`trigger==='update'`·**구 토큰 1회 보강**(perms 없는 토큰)에서 채우고, `edge-config.ts` session 콜백이 `session.user.perms`로 노출. 변경 반영 = 재로그인 또는 `update()`(계정 화면에 안내 문구). 순수 판정 함수는 `lib/auth/perms.ts`(edge·클라이언트 공용: `hasPerm`·`hasAnyPerm`·`isSystemAdminPerms`·`permsOf`).
- [x] 클라이언트 훅 `usePermission()`(`can`·`canAny`·`isSystemAdmin`·`ready`) 신설 `lib/auth/use-permission.ts`. 기존 화면은 `useSession()`을 이미 쓰고 있어 `hasPerm(permsOf(session?.user), key)`로 교체.
- [x] 화면 게이트 교체: `data/{review→data.review, settings·status→data.collect}` / `facilities/{new→facility.edit, merge→facility.merge}`(권한 없음 안내 공통화) / `trash`(영구삭제→trash.purge) / `sales/{SalesBoard,ProjectDetail,bid/BidBoard,intel/IntelBoard,intel/RagBoard}`→sales.edit / `board/BoardWriteBoard`(전사 공지→board.manage) / `home/HomeBoard`(날씨 씬 토글→시스템 관리자 표식)·`QuickFacilitiesCard`(승격→facility.edit) / `layout/TopBar`(AlertBell canAck→data.collect, 계정 라벨=관리자/직원) / `admin/users`·`registry`→`ACCOUNT_ADMIN_KEYS` / `app/(app)/layout.tsx`·`home/page.tsx`→perms 전달. `bonus/*Board`·`work-plan/{Exec,Oversight}Workspace`는 API 응답(`isAdmin`=hasGlobalScope·권한키)만 보므로 컴포넌트 무변경.
- [x] `config/menu-permissions.ts` **신설** — 경로 ↔ 권한키 표(테스트 계획서 §4.1·§4.2 그대로). `config/menu.ts`는 `minRole` 전부 제거, `permissionKey?: string | string[]`(명시 override) + 미지정 시 표에서 href 로 조회, `isMenuVisible(item, perms)`·`visibleSubmenu(item, perms)`(상위 항목은 보이는 서브가 하나라도 있으면 노출). 사용처 `Sidebar`·`GlobalSearch`(M-41 숨김 메뉴 검색 제외)·`AppShell`. `/api/nav/badges`의 `menuPermissions` 제거(근거 단일화).
- [x] `edge-config.ts`: `/api/admin` → `ADMIN_AREA_KEYS` 중 하나 없으면 403 JSON, **모든 페이지 경로** → 같은 표(`requiredPermissionsForPath`)로 판정해 미보유 시 `/forbidden?from=&keys=`로 **rewrite**(주소 유지, 공통 안내 `components/auth/AccessDenied.tsx` 렌더). perms 없는 구 토큰은 1차 차단을 건너뛰고 라우트·화면 판정에 맡김(일제 차단 방지).

### WP6. 계정 관리 UI/API — 잔재 G — ✅
- [x] `admin/users/page.tsx`·`PermissionManagementPanel`: 역할 선택(editor/viewer) 제거, "권한 변경은 재로그인 후 메뉴에 반영" 안내. 조직도 Master 그룹 = `tpl-system-admin` 유효 assignment 보유 계정.
- [x] `api/admin/users/[id]/route.ts`: `body.role` 무시. 마지막 관리자 보호 = "유효한 `tpl-system-admin` 보유 활성 계정이 1명 이하로 떨어지는 비활성화·삭제 금지"(`countSystemAdmins`·`isSystemAdminUser`). `lib/admin/permissions.ts` `revokePermissionAssignment`도 같은 기준으로 **마지막 tpl-system-admin 회수 거부**(테스트 계획서 R-03).
- [x] `lib/auth/users.ts` Role 타입 `'admin' | 'member'`, 검증 목록 갱신. DB 는 마이그 **292**(CHECK 재설정 + editor/viewer→member). `edge-config.ts`·`mobile-token.ts` 기본값 `member`.

### WP7. 모바일 앱 — 잔재 H
- [ ] `/api/mobile/auth/login`·`refresh`·`me` 응답에 `perms` 요약 추가(role 필드는 호환 위해 당분간 병행 후 제거).
- [ ] `apps/mobile/src/app/bids.tsx:129`, `sales.tsx:55` `canEdit` → `perms.includes('sales.edit')` 등. `(tabs)/more.tsx:124` 역할 라벨 표시 → 템플릿명 표시로 교체(또는 제거).
- [ ] OTA 발행: `eas update --branch production --environment production` — **1.1.0·1.2.0 두 런타임** 모두.

### WP8. 자산 라우트 정리 — 잔재 I (선택)
- [ ] `app/api/assets/*` 세션-only 3개에 `asset.manage`(변경) / 조회는 세션 유지 여부 결정.

### WP9. 검증·배포
- [x] 코드 검증: `npx tsc --noEmit`(수정 파일 필터) 에러 0, 메뉴 라우팅 단위 테스트(`npm run test:menu-route`, 역할별 perms 픽스처 추가) 7/7 통과, 잔재 grep(`requireAdmin`·`minRole`·`role === "admin|editor|viewer"`) = 허용 예외(seed.ts·RBAC_ADMIN_BYPASS·RBAC_ENFORCE=false 호환 모드·todo 보드 role)만 남음.
- [ ] lock-out 재점검(§5.3 쿼리) — 마이그 적용 직후 bastion 에서.
- [ ] 역할별 실계정 시나리오(테스트 계획서 §4) — 스테이징 배포 후 10-22.
- [ ] 적용·배포 **순서(R-3)**: ① lock-out 점검 쿼리(§5.3 (1)~(3)) 실행 → ② `staging-apply-migrations.ps1 -Files 291_payroll_bonus_permissions.sql 293_assignment_effective_date.sql 294_view_all_template.sql`(권한키·날짜 정규화·view-all — 구 코드와 호환) → ③ `staging-deploy-next.ps1 -AcknowledgePinnedScheduleLag -Wait`(ADT·intel 배치는 고정 revision 618 에 남고 서비스만 새 revision 으로 이동) → ④ 배포 직후 `staging-apply-migrations.ps1 -Files 292_users_role_member.sql`(role=member — **먼저 적용하면 구 코드의 ROLE_RANK[member] 가 undefined 라 minRole 메뉴가 숨고 users.ts role 검증이 깨진다**) → ⑤ §5.3 (4) 고아 키 점검·관리자 계정 스모크. 모바일 OTA 는 WP7.
- [x] 문서 갱신: 이 문서 체크 처리, 테스트 계획서 §7.2 진행 갱신. `permission-rbac-redesign.md` §10 표기·메모리 갱신은 배포 후.

## 3. 착수 전 결정 필요 항목 — ✅ 2026-10-19 사용자 확정(테스트 계획서 §6)

1. **권한 변경 반영 시점** — JWT 요약 + 계정 관리 화면 안내("변경은 재로그인 후 메뉴에 반영", API 는 즉시). `update()` 호출로도 갱신 가능.
2. **`users.role` 컬럼 최종 형태** — `admin|member` 2값 유지(마이그 292).
3. **급여 권한 세분화 수준** — 4키(view/edit/close/export) + 성과급 3키. 임원은 `payroll.view`·`finance.view` 조회만, `tpl-hr` 에 급여·성과급 전부 배분, 근태 관리 6화면은 기존 `staffing.edit`.

## 5. 구현 메모 (2026-10-19)

### 5.1 권한 요약(perms) 형식과 반영 시점
- `summarizePermissions(access)`: 유효 grant 의 키마다 `checkPermission`(deny-overrides) 통과분만, 전사 범위(scope=all)면 `key@all`. 관리자 ~75개 × 20자 ≈ 1.5KB — next-auth 가 쿠키를 분할 저장하므로 4KB 한도와 무관.
- 로그인·`update()`·구 토큰 1회 보강에서 채운다. 서버 컴포넌트 경로에서는 쿠키가 다시 쓰이지 않을 수 있어 구 토큰 사용자는 재로그인 전까지 요청마다 보강이 반복될 수 있다(`requirePermission` 과 같은 DB 비용 수준). **배포 공지에 전원 재로그인 권장**.
- 메뉴·미들웨어·화면 게이트는 전부 이 요약 하나를 본다(단일 근거). API 는 종전대로 DB 판정이라 부여·회수가 즉시 반영된다(테스트 계획서 R-01·R-02 기대와 일치).

### 5.2 경로별 권한표(`config/menu-permissions.ts`)
`/admin`(영역 키 8종) · `/admin/users`(account.manage·rbac.*) · `/approval/{forms,semantic-concepts,semantics,metrics,policies,settings}`(approval.manage) · `/approval/{leave,attendance,certificates,leave-promotion,holidays,leave-types}`(staffing.edit) · `/work-plan`(work_plan.view) · `/work-plan/oversight`(merge|lock_release) · `/work-plan/{exec,present}`(directive) · `/staffing`(bonus.view) · `/staffing/records`(staffing.record.view) · `/payroll`(payroll.view, `/payroll/my*`는 세션) · `/rules/admin`·`/rules/internal/edit`(rules.manage) · `/survey/external`(survey.manage) · `/facilities`(facility.view) · `/contracts`(contract.view) · `/contracts/filings`(filing.view) · `/finance`(finance.view) · `/sales`(sales.view) · `/sales/contacts`(contact.view) · `/data`(data.view) · `/trash`(trash.view). 표에 없는 경로는 세션만 요구.

### 5.3 lock-out 점검 쿼리(bastion, 읽기 전용 — 마이그 적용 전·후 각 1회)
```sql
-- (1) 활성 계정 중 유효 템플릿 0개 — 테스트 시드 외 0행이어야 한다
SELECT u.user_id, u.login_id, u.name, u.role FROM users u
 WHERE u.status = 'active'
   AND NOT EXISTS (SELECT 1 FROM user_permission_assignments a
                    WHERE a.user_id = u.user_id AND a.revoked_at IS NULL
                      AND (a.effective_from IS NULL OR a.effective_from <= to_char(now(), 'YYYY-MM-DD'))
                      AND (a.effective_to IS NULL OR a.effective_to >= to_char(now(), 'YYYY-MM-DD')));
-- (2) 시스템 관리자(tpl-system-admin 유효 보유 활성 계정) — 1명 이상, 운영 관리자 전원 포함이어야 한다
SELECT u.login_id, u.name, u.role FROM users u
  JOIN user_permission_assignments a ON a.user_id = u.user_id AND a.template_id = 'tpl-system-admin' AND a.revoked_at IS NULL
 WHERE u.status = 'active' ORDER BY u.login_id;
-- (3) role=admin 인데 tpl-system-admin 이 없는 계정 — 0행이어야 한다(있으면 배포 뒤 관리 메뉴가 사라진다 → 화면에서 템플릿 부여)
SELECT u.login_id, u.name FROM users u
 WHERE u.role = 'admin' AND u.status = 'active'
   AND NOT EXISTS (SELECT 1 FROM user_permission_assignments a
                    WHERE a.user_id = u.user_id AND a.template_id = 'tpl-system-admin' AND a.revoked_at IS NULL);
-- (4) 291 적용 후: 고아 권한키·tpl-system-admin 누락 키 — 둘 다 0행
SELECT p.permission_key FROM permissions p
 WHERE NOT EXISTS (SELECT 1 FROM permission_template_grants g WHERE g.permission_key = p.permission_key);
SELECT p.permission_key FROM permissions p
 WHERE NOT EXISTS (SELECT 1 FROM permission_template_grants g
                    WHERE g.template_id = 'tpl-system-admin' AND g.permission_key = p.permission_key);
```

### 5.4 커밋 분리 계획(안 B — 오픈 전 핫픽스 대비, 2026-10-19 부모 세션 요청)
오픈 테스트는 예정일에 현재 구조로 시작하므로 §7.1 사전 점검에서 X-01~X-03 이 FAIL 이면 main 핫픽스로 떼어 내야 한다. 커밋 요청 시 두 커밋으로 나눈다.
- **커밋 A(핫픽스 분리 가능, 291 없이도 동작)**: `app/api/staffing/evaluations/route.ts`(X-01 target) · `app/api/work-plan/{oversight,consolidated,directives,merge}/route.ts`(X-01 부서 고정) · `app/api/contracts/{downloads,signed-certificates}/route.ts`(X-02) · `app/api/sales/projects/route.ts`(X-03) · `lib/auth/contract-scope.ts`(X-04) · **F-01**(`lib/auth/account-provisioning.ts` effective_from 날짜 10자리 저장, `lib/auth/rbac.ts`·`lib/ai/budget.ts` 비교 `left(…,10)`, 마이그 `293_assignment_effective_date.sql`) · **F-02**(`lib/auth/rbac.ts` loadUserAccess 의 소속 부서 = `employee_profiles.dept_id` 우선, users.dept_id 는 폴백). ⚠ F-01 의 `lib/auth/rbac.ts` 수정은 같은 파일의 일원화 변경(summarizePermissions)과 섞여 있으므로 핫픽스 시 loadUserAccess 블록만 떼어 낸다. `users.ts`·`admin/permissions.ts`의 left() 는 B 쪽 신규 코드.

### 5.4b 스테이징 실계정 점검 결함(2026-10-19, 부모 세션 보고 F-01·F-02)
- **F-01 발급 당일 권한 0**: 계정 발급이 `effective_from` 에 ISO 타임스탬프를 넣고 `loadUserAccess` 는 오늘 날짜 10자리와 문자열 비교 → 발급 당일 grant 0개(실측: 테스트사원 전 메뉴 403, 다음날 정상). 수정 = 저장을 날짜 10자리로(assigned_at 만 타임스탬프), 비교를 양쪽 `left(…,10)` 으로(rbac·users·admin/permissions·ai/budget), 기존 행 정리 마이그 293. `lib/todo/visibility.ts` 는 이미 substr 비교라 무변경. 발급 INSERT 의 role 'viewer' 도 292 CHECK 에 맞춰 **'member'** 로 변경(안 바꾸면 배포 뒤 계정 발급이 CHECK 위반으로 실패).
- **F-06 부서장 단건 전사 통과(브리프 ⓐ 확정, 커밋 A 이후 추가)**: self_dept·specific_dept grant 가 `target.contractId`/`target.projectId` 만 받으면 부서를 대조하지 않고 통과했다(실측: 테스트부장이 타 부서 계약 X·Y·Z·N 단건·participants 전부 200). `loadUserAccess` 가 부서 범위 grant 가 있을 때 **부서 가시 계약·영업건 집합**(`deptContractIds`·`deptProjectIds`, 목록 필터 contract-scope 와 같은 규칙: 소유 부서 OR 부서원 참여)을 함께 로드하고, `scopeMatches` 의 부서 범위 판정이 target 의 계약·영업건·부서를 모두 대조한다(`deptScopeMatches`). 계약 단건 라우트 34곳이 이미 `target.contractId` 를 넘기므로 자동 교정. target 이 비면 종전대로 통과(목록은 도메인 필터).
- **F-03 로그인 리다이렉트 callbackUrl 이 localhost:3000**: 미인증 페이지 요청에 `false`(next-auth 기본 리다이렉트 = `nextUrl.href` 를 callbackUrl 로)를 돌려주던 것을 `x-forwarded-host/proto` 기준 origin 의 `/login?callbackUrl=<경로>` 직접 리다이렉트로 교체. `/admin` 미보유는 이제 rewrite(`/forbidden`)라 리다이렉트 자체가 없다.
- **F-02 users.dept_id 전원 NULL**: self_dept 판정 기준을 `employee_profiles.dept_id`(users ↔ employee_profiles 조인, 없으면 users.dept_id)로. `contract-scope.ts`·`sales/projects`·`bonus/statements` 의 부서 필터는 모두 `access.deptId` 를 읽으므로 함께 바로잡힌다. `lib/approval/hr-actions.ts` 의 users.dept_id 갱신(부서 이동)은 그대로 두되 진실원은 조직 인원.
- **커밋 B(일원화 본체)**: 나머지 전부. `app/api/bonus/{statements,evaluations}/route.ts`는 X-01 필터와 `isAdmin` 권한키(291 의 bonus.calculate/confirm) 교체가 한 파일에 섞여 B 에 둔다 — 핫픽스가 필요하면 그 두 파일은 X-01 필터 블록만 수동 패치(291 없는 main 에서는 isAdmin 이 false 가 되어 관리자 버튼이 사라지므로 그대로 떼어 내면 안 된다).
- 핫픽스 체크아웃 절차: main 에서 분기 → `git checkout claude/rbac-role-unification -- <커밋 A 파일들>` → tsc → 커밋.

### 5.4c 부모 세션 검토 반영(2026-10-19, R-1~R-4)
- **R-1 마이그 재번호**: origin/main 이 9ef75de 로 이동하며 `287_todo_period_milestone`·`288_todo_item_deps` 가 들어와 288·289·290 → **291·292·293** 으로, untracked 였던 `213_view_all_template.sql` 은 **294** 로 재번호(내용 동일·멱등, 스테이징에는 213 으로 이미 적용됨 — 저장소 포함 여부는 사용자 확인). 코드 주석·문서 참조 갱신. origin/main 머지(기반 갱신)는 사용자 지시 후 `sync_with_base_branch` 로.
- **R-2 구 토큰 유예 실동작**: session 콜백이 perms 없는 토큰을 `[]` 로 만들어 authorized 의 유예 분기(`null`)가 절대 타지 않던 결함 → 토큰에 perms 가 없으면 `undefined` 로 둔다(`Session.user.perms?: string[]`, 화면은 `permsOf` 가 [] 로 정규화). 배포 직후 재로그인 전 사용자(관리자 포함)가 전 화면 /forbidden·/api/admin 403 이 되는 사고를 막는다.
- **R-3**: WP9 의 적용·배포 순서(권한키·날짜 → next 배포 → role=member) 명시.
- **R-4**: 292 의 CHECK 제거 조건을 `conname = 'users_role_check' OR 정의가 '(role ' 로 시작` 으로 축소('%role%' 과범위).

### 5.5 완료 기준 대조
- `minRole`·`requireAdmin`·`requireRole`·`requireEditor`: 코드에서 0건.
- `role === "admin"|"editor"|"viewer"` 판정: 남은 곳 = `lib/auth/seed.ts`(부트스트랩), `lib/auth/rbac.ts`(`RBAC_ADMIN_BYPASS`), `lib/auth/guards.ts`(`RBAC_ENFORCE=false` 비상 호환 모드 — admin 만 통과, WP3 에서 제거), `lib/todo/*`(할 일 보드 멤버 role — users.role 아님). 마지막 관리자 보호는 템플릿 보유자 기준으로 대체.
- 모바일(`apps/mobile`, `/api/mobile/auth/*` 응답의 role)은 WP7 — 서버가 `member`를 내려도 앱은 편집 불가(의도)·역할 라벨만 비어 보인다.

## 4. 규모 추정

WP1~2 반나절, WP3 반나절(기계적), WP4 1시간, WP5 1일(가장 큼 — 29파일 + 세션 구조), WP6~7 반나절, WP9 반나절. **총 3~4일**, 단일 브랜치·PR 1건 또는 WP3 분리 PR.
