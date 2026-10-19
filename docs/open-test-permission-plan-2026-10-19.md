# 사내 오픈 테스트 사전 — 역할별 권한 정합성 테스트 계획

작성 2026-10-19. 대상 = 스테이징 `https://koensain.app` (main 최신 배포본). 오픈 테스트(10-20 또는 10-21) 전에 **일반 사원 · 부서장 · 임원 · 관리자** 4개 역할 계정으로 실제 접속하여 메뉴 진입 통제와 정보 접근 범위가 설계대로 동작하는지 확인한다.

관련 문서: `docs/permission-rbac-redesign.md`(설계 권위) · `docs/rbac-role-unification-plan.md`(미착수 잔재 목록). 이 문서는 **테스트 실행 지침**이며, 결과 기록 양식은 §8 체크리스트를 복사해 쓴다.

> **결정(2026-10-19, 사용자):** 레거시 role(admin/editor/viewer) 기반 통제는 불필요하면 **완전히 걷어내고 권한 템플릿으로 통일**한다. 기대값은 전부 템플릿 grant 기준으로 적고, §1.4의 불일치 목록은 "테스트에서 확인할 결함"이 아니라 **일원화에서 제거할 대상**이다. **오픈 테스트는 예정일(10-20/21)에 현재 구조로 시작하고 일원화는 병행**(안 B)한다 — 오픈 전에는 §7.1 정보 유출 사전 점검만, 본 테스트(§4 전체)는 일원화 배포 직후(10-22)에 한다.

---

## 0. 한눈에 보기

| 항목 | 내용 |
|---|---|
| 테스트 계정 | 역할당 1개, **테스트 전용 신규 직원 4명을 조직도에 등록해 발급** (§3). 실제 직원 계정 비밀번호 초기화는 하지 않는다. |
| 검증 3층 | ① 사이드바 메뉴 노출 → ② URL 직접 진입 시 화면 반응 → ③ API 직접 호출 HTTP 코드. **세 층이 모두 기대값과 맞아야 PASS** |
| 핵심 위험 | 현재 권한 구조가 **2계층(권한 템플릿 + 레거시 role)** 이라 "메뉴는 보이는데 내용은 403" 또는 "메뉴는 숨겨졌는데 URL은 열림"이 구조적으로 존재한다(§1.4). **결정: 레거시 계층을 제거하고 템플릿으로 통일한다(배분 결정 §6 확정). 오픈은 예정일에 시작하고 일원화는 병행(안 B)** — 오픈 전 §7.1 정보 유출 점검, 본 테스트는 배포 직후. |
| 소요 | 오픈 전 사전 점검 반나절(계정·픽스처 포함) → 일원화 병행 2일 → 배포 직후 본 테스트 1일(역할당 약 1.5시간 × 4 + 교차 시나리오) → 수정·재검증 반나절 |
| 결함 등급 | **Blocker** 타 역할 정보 노출·관리자 기능 차단 / **Major** 허용돼야 할 기능이 403 / **Minor** 메뉴·버튼 노출 불일치(UX) |

---

## 1. 현재 권한 구조 (테스트 설계의 전제)

### 1.1 판정 주체가 둘이다

| 계층 | 근거 데이터 | 적용 위치 | 반영 시점 |
|---|---|---|---|
| **A. 권한 템플릿(RBAC)** | `user_permission_assignments` → `permission_template_grants`(권한키 × scope) | API 라우트 `requirePermission` **442개**, `/api/nav/badges`의 `menuPermissions`(permissionKey 메뉴), 도메인 스코프 함수(`hasGlobalScope`, 계약 가시성 등) | 매 요청 DB 조회 → **부여·회수 즉시 반영** |
| **B. 레거시 role** (`users.role` = admin / editor / viewer) | 로그인 시 JWT에 탑재 | 사이드바 `config/menu.ts`의 `minRole`(20여 항목), 미들웨어 `/admin`·`/api/admin` 1차 차단, **급여·성과급 API 33개 `requireAdmin`**, 화면 버튼 게이트 약 22개 파일, 전역 검색 메뉴 후보, 모바일 `canEdit` | JWT → **재로그인해야 반영** |

`RBAC_ENFORCE`는 기본 켜짐, admin role 우회(`RBAC_ADMIN_BYPASS`)는 꺼져 있다. 즉 **관리자도 권한의 근거는 `tpl-system-admin` 템플릿**이고, role=admin은 메뉴·미들웨어·급여 API에만 쓰인다.

### 1.2 역할 ↔ 템플릿 ↔ role 매핑

계정 발급(`/admin/users/registry`)은 직급 기본 템플릿(`position_default_templates`)을 자동 부여하고 `users.role`은 **항상 `viewer`** 로 만든다.

| 테스트 역할 | 템플릿 | 자동 부여 직급(position_id) | users.role | 비고 |
|---|---|---|---|---|
| 일반 사원 | `tpl-staff-basic` (일반 직원) | staff · assistant-manager · manager · deputy-general-manager · advisor · senior-researcher · associate-researcher | viewer | |
| 부서장 | `tpl-dept-lead` (부서장) | general-manager(부장) · ulsan-branch-head · lab-director | viewer | scope 대부분 `self_dept` |
| 임원 | `tpl-exec` (임원) | ceo · executive-director · senior-managing-director · general-director · director · 부사장(058) | viewer | scope `all`, **조회 위주** |
| 관리자 | `tpl-system-admin` (전 권한 scope=all) | 자동 부여 없음 — 수동 부여 | (현재) **admin** 으로 변경 필요 | 현재는 role=admin이 아니면 관리 메뉴·`/admin`·급여 API 불가. **일원화 후에는 템플릿 부여만으로 충분** |

업무 템플릿(`tpl-sales` 영업관리, `tpl-hr` 인사/회계, `tpl-data-review` 데이터 검수, `tpl-interview-manager`, `tpl-view-all` 검수용)은 역할 위에 **추가 부여**되는 것이므로, 테스트 계정은 **정확히 1개 템플릿만** 가진 상태로 만든다(§3.3 점검 SQL).

### 1.3 템플릿별 권한키와 범위(scope)

scope 의미: `all` 전사 / `self` 본인 / `self_dept` 본인 소속 부서 / `participant` 본인이 참여인력으로 등록된 계약·영업건만.

| 영역(권한키) | 일반 사원 | 부서장 | 임원 | 관리자 |
|---|---|---|---|---|
| 계약 `contract.view` / `.edit` / `.delete` | participant / – / – | self_dept / self_dept / – | all / – / – | all |
| 수주·수금 `billing.view` (edit·export·receivable.manage) | participant | self_dept | all | all |
| 영업 `sales.view` / `.edit` / `.delete` | participant / – / – | self_dept / – / – | all / – / – | all |
| 담당자 `contact.view` (edit·export) | all | all | all | all |
| 사업장 `facility.view` (edit·merge·delete) | **없음** | **없음** | all(view) | all |
| 데이터 `data.view` / `.review` / `.collect` | 없음 | 없음 | 없음 | all |
| 업무추진계획 `work_plan.view` / `.edit` / `.merge` / `.directive` / `.lock_release` | self_dept / self / – / – / – | self_dept / self_dept / self_dept / – / self_dept | all / – / – / all / all | all |
| 성과급 `bonus.view` | 없음 | self_dept | all | all |
| 인사 `staffing.view` / `.edit` / `.evaluation.read` / `.evaluation.write` / `.changes.record` | self / – / – / – / – | self_dept / – / self_dept / self_dept / self_dept | all / – / all / – / – | all |
| 수행인력 실적 `staffing.record.view` (메뉴 permissionKey) | 없음 | self_dept | all | all |
| 전자결재 `approval.view` / `.act` / `.manage` | O / O / – | O / O / – | O / O / – | all |
| 게시판 `board.view` / `.write` / `.manage` | O / O / – | O / O / – | O / O / – | all |
| 휴지통 `trash.view` / `.restore` / `.purge` | 없음 | O / O / – | 없음 | all |
| 할 일 `todo.admin` | 없음 | 없음 | all | all |
| 일정 `calendar.meeting.manage` / `.interview.manage` | 없음 | 없음 | all / – | all |
| 재무 `finance.view` / `.manage` 등 | 없음 | 없음 | 없음 | all |
| 급여 (권한키 **없음** — role=admin 판정) | 본인분만 | 본인분만 | 본인분만 | 전부 |
| 인사 관리(`account.manage`·`org.edit`·`rbac.*`), 보안(`security.*`), AI(`ai.usage.*`), 채용(`recruit.*`), 사규 `rules.manage`, 설문 `survey.manage`, 파일함 `files.manage`, 신고 `filing.*`, 자산 `asset.manage` | 없음 | 없음 | 없음 | all |
| 세션만 요구(권한키 없음) | 메일·채팅·일정 조회·주소록·조직도·개인문서함·홈 위젯·알림·대시보드 집계·내 급여/연말정산/휴가/근태·설문 응답 | ← 전 역할 동일 | | |

### 1.4 사이드바 노출 규칙과 구조적 불일치 (= 일원화에서 제거할 대상)

`config/menu.ts` 기준. `minRole` 없고 `permissionKey` 없는 메뉴는 **전 역할에 노출**된다. 발급 계정은 모두 role=viewer 이므로 부서장·임원도 `minRole: editor/admin` 메뉴는 보지 못한다.

| 노출 규칙 | 메뉴 |
|---|---|
| 전원 노출 | 홈 · 메일 · 전자결재(6 서브) · 파일·문서함(3) · 주소록·조직도 · 공지·게시판 · 사규·내규(4 — **원문 임포트·검수, 내부 규정 작성 포함**) · 일정 · 할 일 · 자산 예약(2) · 설문 > 사내 설문 · **업무추진계획(4 — 부서장 감독·임원 검토·발표 모드 포함)** · **성과급 산정(3)** · 급여 > 내 급여명세서·내 연말정산 · 근태 > 내 휴가·근태 · **사업장** · **계약(7)** · **영업/마케팅(6)** · **데이터(3)** |
| `permissionKey` | 수행인력 실적 (`staffing.record.view` → 부서장·임원·관리자) |
| `minRole: editor` | 휴지통 · 설문 > 외부 설문 |
| `minRole: admin` | 급여 > 급여대장·직원별 연봉·연말정산·급여 설정 · 근태 > 직원별 휴가 관리·근태·초과근무·증명서 발급·연차촉진·휴무일·휴가 종류 · 재무(8) · 사용자 관리(5) · 회사 프로필 · 홍보·채용공고(2) · 결재 운영 설정(6) |

`(app)` 페이지 중 서버에서 권한을 검사해 리다이렉트하는 것은 `/approval/my-attendance`, `/approval/my-leave`, `/work-plan/merge` 세 곳뿐이다. 나머지는 **페이지는 열리고 안의 API가 403을 돌려주는 구조**라, 진입 통제의 실질은 "403을 받은 화면이 무엇을 보여주는가"에 달려 있다. 따라서 **진한 글씨 메뉴는 일반 사원·부서장에게 '보이지만 내용 없음' 또는 오류 화면이 예상**되는 지점이다 — §4.2에서 역할별로 실제 반응을 기록한다.

---

## 2. 범위와 판정 기준

### 2.1 검증 3층

| 층 | 방법 | PASS 조건 |
|---|---|---|
| ① 메뉴 노출 | 로그인 후 사이드바(248px 확장·76px 레일 모두)·전역 검색(Ctrl+K) 후보·홈 위젯 바로가기 | §4.1 기대값과 일치 |
| ② URL 직접 진입 | 주소창에 경로 입력 | 허용 역할: 정상 렌더. 비허용 역할: 리다이렉트 또는 "권한 없음" 안내가 **화면에 남아야** 함(UI 기준: 오류·실행 영향은 화면에 표시). 빈 표·무한 스피너·콘솔 에러만 있는 상태는 Minor 결함 |
| ③ API 직접 호출 | 브라우저 개발자도구 Network에서 해당 요청의 상태 코드 확인, 또는 §5.2 스크립트 | 허용: 200(+데이터 범위 §4.3), 비허용: **403** (401은 세션 문제 → 별도 결함) |

### 2.2 정보 접근(데이터 범위) 판정

- 목록 API는 **행 수와 식별자**를 역할별로 비교한다(관리자 결과를 기준 집합으로 삼아 부분집합 관계 확인).
- 단건 API는 **허용 집합 밖의 ID를 직접 호출**해 403/404를 확인한다(목록에 없다고 안전한 것이 아니다).
- 파일(계약서 PDF·급여명세서·증빙·첨부)은 **다운로드 URL을 다른 역할 세션에 붙여넣어** 열리는지 확인한다.
- 내보내기(`*/export`, xlsx·CSV) 엔드포인트는 목록보다 넓은 데이터를 담는 경우가 많아 별도로 호출한다.

### 2.3 쓰기 권한

생성·수정·삭제 버튼의 **노출**과 API의 **거부**를 각각 기록한다. 버튼이 보이고 눌렀을 때 403 토스트가 뜨면 Minor, 버튼이 없어도 API가 200이면 Blocker.

---

## 3. 테스트 계정·데이터 준비 (D-0)

### 3.1 계정 전략

실제 직원 계정을 빌리면 비밀번호 초기화가 필요하고 급여·인사 실데이터가 노출된다. **테스트 전용 직원 4명을 조직도에 등록해 발급**한다. 단, 데이터 범위 시나리오(§4.3)를 위해 소속 부서는 **실제 계약·보고서가 있는 부서**로 둔다.

| 계정 | 이름(제안) | 직급 | 소속 부서 | 자동 템플릿 | 추가 조치 |
|---|---|---|---|---|---|
| T-STAFF | 테스트사원 | 사원(staff) | 부서 A (예: 기술부서 중 계약 多) | tpl-staff-basic | 계약 X·영업건 P의 **참여인력으로 등록**(participant 검증용) |
| T-LEAD | 테스트부장 | 부장(general-manager) | 부서 A (T-STAFF와 같은 부서) | tpl-dept-lead | 없음 |
| T-EXEC | 테스트이사 | 이사(director) | 임원실/경영지원 | tpl-exec | 없음 |
| T-ADMIN | 테스트관리자 | 아무 직급 | 경영지원 | (직급 기본) → **회수** | `/admin/users` 계정 상세에서 `tpl-system-admin` 부여 + **역할을 admin으로 변경** |

관리자는 기존 관리자 계정(본인)으로 대신해도 되지만, 테스트 결과를 "순수 관리자 템플릿 1개"로 남기려면 T-ADMIN을 권한다. 테스트 후 4명은 **퇴사 처리**(`employee_profiles.status=inactive` + `users.status=disabled`)하거나 삭제한다.

### 3.2 발급 절차

1. 관리자로 `/admin/users/registry` → 인원 등록(이름·직급·부서) → **계정 발급**. 로그인 ID = 사번, 초기 비밀번호 = 사번, 첫 로그인 시 비밀번호 변경 강제.
2. `/admin/users` → 조직도에서 해당 인원 클릭 → **부여 템플릿이 정확히 1개**인지 확인. T-ADMIN은 기본 템플릿 회수 후 `tpl-system-admin` 부여, 역할 admin.
3. 각 계정으로 1회 로그인해 비밀번호 변경을 끝낸다(변경 전에는 `/change-password` 외 모든 경로가 차단되므로 테스트 불가).
4. 브라우저 **프로필 4개(또는 시크릿 창 4개)** 를 역할별로 고정해 세션이 섞이지 않게 한다. 세션 정책: 로그인 유지 미체크 시 12시간.

### 3.3 사전 점검 SQL (bastion 경유, 읽기 전용)

```sql
-- 테스트 계정 4개의 role·상태·유효 템플릿
SELECT u.login_id, u.name, u.role, u.status, u.must_change_password,
       string_agg(a.template_id, ',' ORDER BY a.template_id) AS templates,
       ep.department_id, ep.position_id
  FROM users u
  LEFT JOIN user_permission_assignments a ON a.user_id = u.user_id AND a.revoked_at IS NULL
  LEFT JOIN employee_profiles ep ON ep.user_id = u.user_id
 WHERE u.name LIKE '테스트%'
 GROUP BY u.user_id, ep.department_id, ep.position_id;

-- 각 템플릿의 유효 grant (기대표 §1.3 과 대조)
SELECT template_id, permission_key, scope_kind, effect
  FROM permission_template_grants
 WHERE template_id IN ('tpl-staff-basic','tpl-dept-lead','tpl-exec','tpl-system-admin')
 ORDER BY 1,2;

-- 카탈로그에 있으나 어느 템플릿에도 없는 고아 권한키(0행이어야 정상 — 마이그 110 사고 재발 점검)
SELECT p.permission_key FROM permissions p
 WHERE NOT EXISTS (SELECT 1 FROM permission_template_grants g WHERE g.permission_key = p.permission_key);
```

### 3.4 데이터 픽스처(테스트 전에 ID를 적어 둔다)

| 식별자 | 조건 | 쓰임 |
|---|---|---|
| 계약 X | 부서 A 소유(`owning_dept_id`), T-STAFF 참여인력 | 사원 O · 부장 O · 임원 O |
| 계약 Y | 부서 A 소유, T-STAFF 비참여 | 사원 **X** · 부장 O · 임원 O |
| 계약 Z | 부서 B 소유 | 사원 X · 부장 **X** · 임원 O |
| 영업건 P / Q | P는 T-STAFF 멤버, Q는 부서 B | sales participant/self_dept 검증 |
| 업무추진계획 보고서 R1(T-STAFF 작성)·R2(부서 A 타인)·R3(부서 B) | 테스트 중 T-STAFF·T-LEAD가 직접 작성 | view self_dept · edit self · 부서장 감독 · 임원 지시 |
| 결재 문서 D1(T-STAFF 기안, 결재선 T-LEAD)·D2(타인 기안, 테스트 계정 무관) | 테스트 중 작성 | approval.view 범위·approval.manage 열람 |
| 게시글 B1(T-STAFF 작성)·B2(타인) | 테스트 중 작성 | board.manage(타인 글 수정·삭제) |
| 사업장 F1 | 아무 사업장 | facility.view 역할 차이 |
| 급여 명세서 | 테스트 계정은 급여 데이터가 없음 | "내 급여명세서"는 **실제 직원 1명 협조**(본인 로그인·화면 확인)로 대체, 테스트 계정은 빈 상태·타인 ID 호출 403만 확인 |
| 파일 URL 3종 | 계약서 PDF(계약 Z)·결재 첨부(D2)·인사 서류 | 다른 역할 세션에 붙여넣기 |

---

## 4. 테스트 매트릭스

케이스 ID 규칙: `M-`(메뉴) `U-`(URL 진입) `A-`(API) `D-`(데이터 범위) `W-`(쓰기) `B-`(우회) + 일련번호. 기대값에서 **`?`는 §6 결정 후 확정**한다.

### 4.1 메뉴 노출 기대값 (M-01 ~ M-40) — 일원화 후 기준

O = 보임, X = 숨김. **원칙: 메뉴 노출 = 해당 화면의 조회 권한키 보유**(`permissionKey`, 복수 키는 하나라도). 세션만 요구하는 화면은 전원 노출. 각 역할 로그인 직후 사이드바 전체를 캡처해 이 표와 대조한다. "메뉴 권한키" 열은 일원화 구현 시 `config/menu.ts`에 넣을 값이다.

| 메뉴 | 메뉴 권한키 | 사원 | 부서장 | 임원 | 관리자 |
|---|---|---|---|---|---|
| 홈·메일·전자결재(6)·파일·문서함(3)·주소록·게시판·일정·할 일·자산 예약(2)·사내 설문·사규 열람·내부 규정 일람 | (세션) | O | O | O | O |
| 사규 원문 임포트·검수 / 내부 규정 작성 | `rules.manage` | X | X | X | O |
| 외부 설문 | `survey.manage` | X | X | X | O (§6-3) |
| 업무추진계획 > 보고 작성/목록 | `work_plan.view` | O | O | O | O |
| 업무추진계획 > 부서장 감독 | `work_plan.merge` 또는 `.lock_release` | X | O | O | O |
| 업무추진계획 > 임원 검토·지시 / 발표 모드 | `work_plan.directive` | X | X | O | O |
| 성과급 산정(3) | `bonus.view` | X | O | O | O |
| 수행인력 실적 | `staffing.record.view` | X | O | O | O |
| 급여 > 내 급여명세서·내 연말정산 | (세션, 본인) | O | O | O | O |
| 급여 > 급여대장·연봉·연말정산·설정 | `payroll.view`(신설) | X | X | §6-1 | O |
| 근태 > 내 휴가·근태 | (세션, 본인) | O | O | O | O |
| 근태 > 관리 6종 | `staffing.edit` 또는 `hr.attendance.manage`(신설 여부 §6-1) | X | X | §6-1 | O |
| 사업장 | `facility.view` | X | X | O | O |
| 계약(7) | `contract.view` (대외 신고 대기열은 `filing.view`) | O | O | O | O (신고 대기열은 관리자만) |
| 재무(8) | `finance.view` | X | X | §6-1 | O |
| 영업/마케팅(6) | `sales.view` (담당자 정보는 `contact.view`) | O | O | O | O |
| 데이터(3) | `data.view` | X | X | X | O |
| 사용자 관리 > 계정·권한 / 등록·삭제 | `account.manage`·`rbac.*` | X | X | X | O |
| 사용자 관리 > 접속기록 / AI 사용량 / 첨부 정책 | `security.access_log` / `ai.usage.view` / `security.attachment_policy` | X | X | X | O |
| 회사 프로필 · 홍보·채용공고(2) | `org.edit` · `recruit.view` | X | X | X | O |
| 결재 운영 설정(6) | `approval.manage` | X | X | X | O |
| 휴지통 | `trash.view` | X | **O** | X | O |

일원화 전 현재 동작과의 차이(제거되는 불일치): 사원·부서장에게 보이던 사업장·데이터·성과급·부서장 감독·임원 검토·사규 임포트 메뉴가 숨겨지고, 부서장 휴지통이 보이며, 관리 메뉴의 근거가 role=admin에서 각 권한키로 바뀐다. 미들웨어의 `/admin` 차단은 JWT에 실은 권한 요약으로 대체된다.

추가 확인: 76px 레일(접힌 상태)에서도 같은 집합인지, 전역 검색(Ctrl+K) 후보에 숨겨진 메뉴가 나오지 않는지(M-41), 홈 위젯의 바로가기 버튼이 비허용 화면으로 이끌지 않는지(M-42).

### 4.2 URL 직접 진입 (U-01 ~ U-30)

비노출 메뉴를 **직접 입력**해 반응을 기록한다. "차단"의 합격 기준은 **권한 없음 안내가 화면에 남는 것**(공통 안내 컴포넌트, WP5에서 도입)이며, 빈 표·스피너·콘솔 에러만 있으면 Minor다. 가드 키 열은 일원화 후 해당 화면·API가 요구하는 권한키다.

| 경로 | 가드 키 | 사원 | 부서장 | 임원 | 관리자 |
|---|---|---|---|---|---|
| `/admin/users` `/admin/users/registry` | `account.manage`·`rbac.*` | 차단 | 차단 | 차단 | O |
| `/admin/access-log` `/admin/ai-usage` `/admin/attachment-policy` `/admin/company-profile` `/admin/recruit` | `security.access_log` / `ai.usage.view` / `security.attachment_policy` / `org.edit` / `recruit.view` | 차단 | 차단 | 차단 | O |
| `/payroll` `/payroll/contracts` `/payroll/yearend` `/payroll/settings` | `payroll.view`(신설) | 차단 | 차단 | 조회 O(§6-1) | O |
| `/approval/leave` `/approval/attendance` `/approval/certificates` `/approval/leave-promotion` `/approval/holidays` `/approval/leave-types` | `staffing.edit`(§6-4) | 차단 | 차단 | 차단 | O |
| `/finance` (탭 8종) | `finance.view` | 차단 | 차단 | 조회 O(§6-1) | O |
| `/approval/forms` `/approval/semantic-concepts` `/approval/semantics` `/approval/metrics` `/approval/policies` `/approval/settings` | `approval.manage` | 차단 | 차단 | 차단 | O |
| `/trash` | `trash.view` | 차단 | **O** | 차단 | O |
| `/facilities` `/facilities/new` `/facilities/merge` `/facilities/missing` | `facility.view` / 편집 `facility.edit`·`.merge` | 차단 | 차단 | 조회 O·편집 X | O |
| `/data/status` `/data/review` `/data/settings` | `data.view` / `data.review` / `data.collect` | 차단 | 차단 | 차단 | O |
| `/staffing` `/staffing/evaluations` `/staffing/statements` | `bonus.view`·`staffing.evaluation.read` | 차단 | 부서 범위 | 전사 조회 | O |
| `/staffing/records` | `staffing.record.view` | 차단 | 부서 범위 | 전사 | O |
| `/work-plan/oversight` | `work_plan.merge`·`.lock_release` | 차단 | O(부서) | O | O |
| `/work-plan/exec` `/work-plan/present` | `work_plan.directive` | 차단 | 차단 | O | O |
| `/survey/external` | `survey.manage` | 차단 | 차단 | 차단 | O |
| `/rules/admin` `/rules/internal/edit` | `rules.manage` | 차단 | 차단 | 차단 | O |
| `/approval/my-attendance` `/approval/my-leave` | 세션(본인) — 서버 가드 있음 | O | O | O | O — 타인 ID 파라미터는 403(U-29) |
| `/contracts/*` `/sales/*` `/approval/*`(기안·열람) `/board` `/todo` `/calendar` `/files` `/assets` `/directory` | 세션 또는 view 키 | O | O | O | O — 내용은 §4.3 |

### 4.3 데이터 범위 시나리오 (D-01 ~ D-40) — 가장 중요

각 행은 **네 역할 모두 수행**하고, 목록의 행 수/식별자와 단건 호출 코드를 적는다.

| ID | 시나리오 | 사원 | 부서장 | 임원 | 관리자 |
|---|---|---|---|---|---|
| D-01 | `/contracts` 목록에 계약 X·Y·Z 중 보이는 것 | X만 | X·Y | X·Y·Z | X·Y·Z |
| D-02 | `GET /api/contracts/{Y}`·`{Z}` 직접 호출 | 403·403 | 200·403 | 200·200 | 200·200 |
| D-03 | 계약 트리·Dashboard(`/contracts/dashboard`) 집계가 D-01 집합과 일치 | 참여분 | 부서분 | 전사 | 전사 |
| D-04 | 수주/수금/발행 현황(`/contracts/billing`) 행 집합 | 참여분 | 부서분 | 전사 | 전사 |
| D-05 | 계약 Z의 계약서 PDF·증명서 URL을 세션에 붙여넣기 | 403 | 403 | 200(조회) | 200 |
| D-06 | 계약 X 수정(제목 변경 저장) | 403 | 200 | 403 | 200 |
| D-07 | 계약 X 삭제 버튼·API | X·403 | X·403 | X·403 | O·200(실행은 하지 말 것 — 미리보기/취소) |
| D-08 | 계약 등록(`POST /api/contracts`) | 403 | 200(owning_dept=부서 A) | 403 | 200 |
| D-09 | 대외 신고 대기열(`/contracts/filings`) — `filing.view`는 관리자만 | 403 | 403 | 403 | 200 |
| D-10 | 영업 Salesboard 목록(P·Q) | P만 | 부서 A 건 | 전사 | 전사 |
| D-11 | 영업건 Q 단건·편집 | 403 | 403 | 200·편집 403 | 200 |
| D-12 | 담당자 정보 관리 목록(`contact.view` all) | 전사 | 전사 | 전사 | 전사 |
| D-13 | 담당자 내보내기(`contact.export`) | 403 | 403 | 403 | 200 |
| D-14 | 공공입찰·intel·RAG 조회 | sales.view 범위 | 범위 | 전사 | 전사 |
| D-15 | 견적서 작성(`/approval/quote`) 목록·작성 — `lib/quote/perm.ts`를 `hasGlobalScope` 기준으로 교체(WP4) 후 범위 | 본인 작성분 | 부서 | 전사 조회 | 전사 |
| D-16 | 업무추진계획 목록에 R1·R2·R3 | R1·R2 | R1·R2 | 전부 | 전부 |
| D-17 | R2(타인 보고서) 수정 | 403 | 200(부서 A) | 403 | 200 |
| D-18 | 부서장 감독 화면에서 부서 B 보고서 노출 | – | **없어야** | 보임 | 보임 |
| D-19 | 임원 검토·지시(directive) 저장 | 403 | 403 | 200 | 200 |
| D-20 | 성과급 지급 대상 LIST·참여도 | 403 | 부서 A 인원만 | 전사 | 전사 |
| D-21 | 참여도·평점 저장(evaluation.write) | 403 | 200(부서 A) | 403 | 200 |
| D-22 | 성과급 산정/배분/명세서 생성·발송 API(`/api/bonus/*` → `bonus.calculate/confirm/send`) | 403 | 403 | 403 | 200 (tpl-hr도 200 — §6-2) |
| D-23 | 수행인력 실적 인원 선택 범위 | – | 부서 A | 전사 | 전사 |
| D-24 | 조직도·주소록에서 타 직원 상세(연락처·사진) | 전원 조회 | 전원 | 전원 | 전원 |
| D-25 | 인사 정보(연봉·근로계약·인사 서류 `staffing.edit`·`staffing.documents.manage`) | 403 | 403 | **403** | 200 |
| D-26 | 내 급여명세서·내 연말정산 — 본인 데이터만, 다른 `employeeId`로 호출 | 본인/403 | 본인/403 | 본인/403 | 본인(관리 화면은 별도) |
| D-27 | 급여대장·EDI·연말정산 관리 API(`/api/payroll/*` → `payroll.view/edit/close/export`) | 403 | 403 | 조회 200·변경 403(§6-1) | 200 |
| D-28 | 내 휴가·근태 — 타 직원 ID 파라미터 | 403 | 403 | 403 | 200(관리 화면) |
| D-29 | 직원별 휴가 관리·근태 관리 API | 403 | 403 | 403 | 200 |
| D-30 | 전자결재: D2(무관 문서) 열람 | 403 | 403 | 403 | 200(approval.manage) |
| D-31 | 전자결재: D1 결재선인 T-LEAD의 승인/반려 | – | 200 | – | – |
| D-32 | 양식별 문서 조회·데이터 분석·인사이트가 본인 관련 문서로 한정되는지 | 한정 | 한정 | 한정(?) | 전사 |
| D-33 | 문서함(`/approval/archive`)·파일함(`/files`) 목록 범위 — `files.manage`는 관리자만 | 본인 관련 | 본인 관련 | 본인 관련 | 전사 |
| D-34 | 게시글 B2 수정·삭제(board.manage) | 403 | 403 | 403 | 200 |
| D-35 | 휴지통 목록·복원·영구삭제 | 403 | 목록·복원 200 / 영구삭제 403 | 403 | 200 |
| D-36 | 할 일: 타인 개인 보드·부서 보드 생성(todo.admin / 부서장 배정) | 불가 | 부서 보드 생성 O | todo.admin | 전부 |
| D-37 | 일정: 회의 일정 생성(calendar.meeting.manage) | 403 | 403 | 200 | 200 |
| D-38 | 재무 탭 API(`finance.view`) | 403 | 403 | 403 | 200 |
| D-39 | 사업장 상세·사업장 편집 | 403 | 403 | 200·편집 403 | 200 |
| D-40 | 데이터 수집 현황·검수 대기열 API | 403 | 403 | 403 | 200 |

### 4.4 우회 경로 (B-01 ~ B-12)

| ID | 경로 | 확인 |
|---|---|---|
| B-01 | 전역 검색(Ctrl+K)으로 숨겨진 메뉴 진입 | role 기반 필터와 일치하는지 |
| B-02 | 홈 대시보드 위젯(참여 용역·수금 발행·인텔·빠른 사업장 등)이 역할 범위 밖 데이터를 집계하는지 | 위젯 수치 ↔ D-01·D-04 집합 비교 |
| B-03 | `/api/nav/badges` 응답의 `menuPermissions` | 역할별 기대 키만 포함 |
| B-04 | 파일 프록시(`/api/uploads/...`, 문서 URL)에 타 역할 파일 키 | 403 |
| B-05 | 내보내기 엔드포인트(`*/export`, xlsx) 직접 호출 | 목록 범위와 동일하게 제한 |
| B-06 | 모바일 API(`/api/mobile/auth/login` → Bearer 토큰)로 같은 계정 로그인 후 `/api/contracts` 등 호출 | 웹과 동일 범위 |
| B-07 | 모바일 앱 영업·입찰 편집 버튼(`canEdit` = role 기반) | 사원·부서장·임원 모두 편집 불가 |
| B-08 | 로그아웃 후 뒤로 가기·만료 세션에서 API | 401 JSON·로그인 리다이렉트 |
| B-09 | 비밀번호 변경 강제 상태에서 다른 경로 입력 | `/change-password`로 고정 |
| B-10 | 비활성(퇴사 처리) 계정 로그인 | 거부 |
| B-11 | 설문 응답 결과(`/api/survey/surveys/{id}/responses`)·`survey.manage` 없이 통계 열람 | 403 |
| B-12 | 접속기록(`/admin/access-log`)에 위 시도가 남는지(관리자 확인) | 열람·다운로드 이력 존재 |

### 4.4b 코드 탐색에서 확인된 결함 후보 — 반드시 포함할 케이스 (X-01 ~ X-05)

일원화 세션에 2순위 수정으로 넘겼다. 수정 여부와 무관하게 테스트에서 직접 확인한다.

| ID | 결함 후보 | 재현 | 기대 | 등급 |
|---|---|---|---|---|
| X-01 | `scopeMatches`가 target에 `deptId`/`userId`가 없으면 `self_dept`·`self`를 통과시키는데, 코드 전체에 `target:{deptId}`·`target:{userId}`를 넘기는 호출이 0건 → **부서장 grant가 사실상 전사** | T-LEAD로 `GET /api/staffing/evaluations?dept=<부서 B>`, `GET /api/bonus/statements?employeeId=<부서 B 직원>`, `GET /api/work-plan?dept=<부서 B>` | 403 또는 본인 부서로 고정 | Blocker |
| X-02 | `POST /api/contracts/downloads`·`GET /api/contracts/signed-certificates`가 세션만 확인하고 임의 `contractIds` 증빙 묶음을 내려줌 | T-STAFF로 계약 Z의 ID를 넣어 호출 | 403 또는 가시 계약으로 제한 | Blocker |
| X-03 | `GET /api/sales/projects` 목록에 participant/self_dept 필터 없음(단건만 target 검사) | T-STAFF로 Salesboard 목록 | P만 | Blocker |
| X-04 | `lib/auth/contract-scope.ts`의 목록 필터가 `RBAC_ENFORCE === "true"` opt-in(가드 기본값과 반대). 스테이징 task def에 값이 없으면 계약 목록이 전사로 보임 | 테스트 전 ECS task def env 확인 + D-01 | D-01 기대값 | Blocker(환경) |
| X-05 | 모바일 Bearer 요청은 미들웨어 `/api/admin` 1차 차단을 건너뜀(권한키 판정만 받음) | B-06에서 `/api/admin/employees` 호출 | 403(권한키) — 일원화 후엔 웹과 동일 | Major |

### 4.5 권한 변경 반영 시점 (R-01 ~ R-03)

| ID | 시나리오 | 기대 |
|---|---|---|
| R-01 | 관리자가 T-STAFF에 `tpl-sales` 추가 부여 → T-STAFF 새로고침 | 계약·사업장 API는 즉시 전사(DB 판정). 사이드바(사업장 메뉴)는 JWT 요약이라 **재로그인 후** 노출(§6-6) — 계정 화면 안내 문구 확인 |
| R-02 | 부여 회수 | API 즉시 403, 메뉴는 재로그인 후 숨김 |
| R-03 | T-ADMIN의 `tpl-system-admin` 회수(다른 관리자 1명 이상 남긴 상태) | 재로그인 후 관리 메뉴·`/admin` 전부 차단. 마지막 관리자 템플릿 회수는 API가 거부 |

---

## 5. 실행 방법

### 5.1 수동(기본)

- 역할별 브라우저 프로필에서 §4 순서대로 진행. 한 역할을 끝까지 하기보다 **시나리오 단위로 4역할을 연달아** 수행하면 비교가 정확하다(특히 §4.3).
- 모든 FAIL은 ①URL ②역할 ③기대 ④실제(HTTP 코드 포함) ⑤스크린샷 ⑥Network 탭의 요청 URL을 남긴다. 개발자도구 Network에서 `403`·`500` 필터를 켜 두면 놓치지 않는다.
- 라이트/다크 두 테마 중 하나로 고정하되, 권한 없음 안내 화면은 다크에서도 한 번 확인한다(UI 기준).

### 5.2 반자동(권장 보조)

역할별 세션 쿠키(`authjs.session-token`)를 뽑아 둔 뒤, 라우트 목록 × 역할 × 기대 코드 표를 PowerShell 스크립트로 일괄 호출해 **실제 코드와 기대 코드를 비교**한다. 메뉴·화면 반응은 자동화하지 않고 API 층(③)만 자동화한다. 스크립트는 `scripts/permission-matrix/`에 두고 결과 CSV를 `docs/open-test-permission-result-<날짜>.csv`로 남긴다. (이 문서 승인 후 작성)

호출 대상 1차 후보(역할별 기대값은 §4.3과 동일): `/api/contracts` · `/api/contracts/{id}` · `/api/contracts/billing/*` · `/api/sales/projects` · `/api/facilities` · `/api/work-plan/reports` · `/api/staffing/*` · `/api/bonus/*` · `/api/payroll/ledgers` · `/api/payroll/my-statements` · `/api/approval/documents` · `/api/board/posts` · `/api/trash` · `/api/finance/*` · `/api/admin/users` · `/api/data/*` · `/api/nav/badges`.

### 5.3 결함 처리

| 등급 | 기준 | 처리 |
|---|---|---|
| Blocker | 다른 역할의 정보가 보이거나 쓰기가 됨(D-·B- FAIL), 관리자가 자기 기능에 403 | 오픈 테스트 **전** 수정·재배포·해당 케이스 재검증 |
| Major | 허용돼야 할 조회·쓰기가 403, 비밀번호 변경·로그인 흐름 결함 | 오픈 전 수정 권장 |
| Minor | 메뉴·버튼 노출 불일치, 권한 없음 안내 부재(빈 화면) | 오픈 테스트 공지문에 "알려진 제한"으로 기재하거나 수정 |

수정은 main에서 분기한 브랜치로 하고, 배포는 `staging-deploy-next.ps1 -AcknowledgePinnedScheduleLag -Wait`로만 한다(ADT·intel 배치는 고정 revision 618에 남고 서비스만 새 revision으로 이동). 권한 템플릿 배분 변경은 **새 마이그레이션(287 이후, 원격 전 브랜치 번호 확인)** 으로 하고, 새 권한키를 만들면 반드시 `tpl-system-admin` grant 보충을 같은 파일에 넣는다.

---

## 6. 일원화 구현 전에 확정할 결정 항목

"레거시 제거·템플릿 통일"은 확정됐다. 남은 것은 **템플릿에 어떤 권한키를 배분할지**(= 테스트 기대값)다. **2026-10-19 사용자 확정: 6-1~6-4·6-5·6-6 전부 "제안(기본값)" 열대로 진행** — 임원 payroll.view·finance.view 조회 부여, 급여·성과급 키 tpl-hr 배분, 근태 관리 6화면은 staffing.edit, users.role은 admin|member 유지. 일원화 세션은 origin/main 9ce4d0f에서 분기한 워크트리, 마이그 288·289를 쓴다.

| # | 사안 | 제안(기본값) | 대안 |
|---|---|---|---|
| 6-1 | **임원(tpl-exec)에게 열 관리 영역** — 급여 `payroll.view`, 근태·휴가 관리, 재무 `finance.view`, 전자결재 `approval.manage`(타인 문서 열람) | 임원 = **조회만**: `payroll.view`(all)·`finance.view`(all) 부여, 근태·휴가 관리는 조회 전용 키가 없으므로 **비부여**, `approval.manage` 비부여 | 임원에게 관리 기능까지 열려면 해당 `.edit/.manage` 키를 tpl-exec에 추가 — 과허용 주의 |
| 6-2 | **급여·성과급 권한키 신설과 배분**(WP1) — `payroll.view/edit/close/export`, `bonus.calculate/confirm/send` | tpl-system-admin 전부 · **tpl-hr** payroll.* + bonus.* · tpl-exec payroll.view·bonus.view · tpl-staff-basic 본인분은 세션 라우트(`/api/payroll/my-*`) 그대로 | 인사담당이 급여를 처리하지 않는 운영이면 tpl-hr 배분 제외 |
| 6-3 | **외부 설문 작성자** — `survey.manage` 배분 대상 | 관리자만(현행) | 담당 직원이 있으면 개인 추가 부여(템플릿 신설 불필요) |
| 6-4 | **근태·휴가·증명서 관리 6화면의 권한키** | 기존 `staffing.edit`(tpl-hr·관리자)로 가드 | 세분화가 필요하면 `hr.attendance.manage` 신설 — 오픈 전엔 비권장 |
| 6-5 | **`users.role` 컬럼** | `admin \| member` 2값 유지(부트스트랩·`RBAC_ADMIN_BYPASS`·마지막 관리자 보호용). editor/viewer는 데이터 정리 마이그로 member 전환. "관리자 지정"은 `tpl-system-admin` 부여로 통일 | 컬럼 제거는 비권장 |
| 6-6 | **권한 변경 반영 시점** — 메뉴·미들웨어는 JWT 권한 요약을 쓰므로 재로그인 필요 | JWT 요약 + 계정 관리 화면에 "변경은 재로그인 후 반영" 안내. API는 즉시 | 즉시 반영이 필수면 서버 컴포넌트 DB 판정(비용↑) |
| 6-7 | **오픈 전 최소 범위**(§7) — WP3(`fallbackRoles` 192곳 제거)·WP7(모바일 OTA)·WP8(자산)은 오픈 후로 미룰지 | 미룸(동작 영향 없음 / 모바일은 B-06·B-07만 확인) | 전부 포함 시 +1일 |
| 6-8 | **테스트 계정의 사후 처리** | 테스트 후 퇴사 처리(비활성) | 오픈 기간 데모용으로 유지 |

---

## 7. 일정 — 안 B 확정: 예정일 오픈, 일원화 병행 (2026-10-19 사용자 결정)

오픈 테스트는 **예정일(10-20/21)에 현재 구조(2계층)로 시작**하고, 일원화(WP0·1·2·4·5·6·9)는 별도 세션에서 병행해 **주중에 배포**한다. 권한 정합성 본 테스트(§4 전체)는 일원화 배포 직후 수행한다. 이 선택의 비용은 두 가지이며 공지와 결함 접수 규칙으로 흡수한다.

- 오픈 첫 1~2일 동안 테스터가 보는 메뉴·관리 기능이 **배포 시점에 바뀐다**(사업장·데이터·성과급 메뉴 숨김, 부서장 휴지통 노출, 관리 메뉴 근거 변경, 재로그인 필요). → 오픈 공지에 예고하고, 배포 직후 "재로그인·메뉴 변경" 공지를 한 번 더 낸다.
- 오픈 첫 1~2일에 들어오는 **권한·메뉴 관련 결함 보고는 일원화 전 상태**라 배포 후 무효가 될 수 있다. → 결함 접수 시 분류 "권한·메뉴"는 보류 큐에 두고 **10-22 본 테스트 이후 재확인**한다.

### 7.1 오픈 전 긴급 사전 점검 (10-19 ~ 10-20 오전, 현재 구조 기준)

일원화를 기다리지 않고 **정보 유출 여부만** 먼저 확인한다. 범위는 아래 10개 케이스로 제한하며, FAIL은 오픈 전에 핫픽스하거나 해당 기능을 오픈 범위에서 뺀다.

| 케이스 | 내용 | FAIL 시 |
|---|---|---|
| X-04 | 스테이징 next task def에 `RBAC_ENFORCE=true`가 있는지(없으면 계약 목록 필터가 꺼져 전사 노출) | env 추가 후 재배포(코드 변경 없음) |
| D-01·D-02 | 사원·부서장의 계약 목록·단건 범위 | 핫픽스 |
| D-05 | 타 부서 계약서 PDF URL을 사원 세션에서 열기 | 핫픽스 |
| X-02 | `POST /api/contracts/downloads`·`signed-certificates`에 타 계약 ID | 일원화 세션 2순위 항목을 앞당겨 핫픽스 |
| X-03·D-10 | 사원의 Salesboard 목록이 참여건으로 제한되는지 | 핫픽스 또는 영업 메뉴 오픈 범위 제외 |
| X-01 | 부서장이 `?dept=`·`?employeeId=`로 타 부서 평점·성과급 명세 조회 | 핫픽스 또는 성과급 메뉴 오픈 범위 제외 |
| D-25·D-26·D-28 | 인사·급여·근태 타인 데이터 호출 403 | 핫픽스 |
| D-30 | 무관한 결재 문서 열람 403 | 핫픽스 |

계정·픽스처(§3)는 이 점검에서 만들어 두고 10-22 본 테스트에 재사용한다.

### 7.2 일정표

| 시점 | 작업 | 산출물 |
|---|---|---|
| 10-19 (일) | §6 결정 확정(완료) · **일원화 WP0·1·2·4·5·6 구현 완료**(브랜치 `claude/rbac-role-unification`, 마이그 288·289, X-01~X-04 수정 포함 — `docs/rbac-role-unification-plan.md` §5) · 커밋·푸시는 사용자 확인 후 · **테스트 계정 4개 발급·비밀번호 변경·픽스처 ID 확보·§3.3 SQL** · §7.1 사전 점검 시작 | 계정표, 픽스처표, 사전 점검 결과 |
| 10-20 (월) | §7.1 사전 점검 마무리·Blocker 핫픽스 → **오픈 테스트 시작**. 오픈 공지문에 §7.3 "알려진 제한" 기재 | 공지문 1차 |
| 10-20~21 | 일원화 브랜치 검토·main 통합(구현은 10-19 완료, 앞당길 수 있음) | 마이그 288·289, 커밋 |
| 10-21 저녁 (목표) 또는 10-22 아침 | 일원화 배포: `staging-apply-migrations.ps1 -Files 288_*.sql 289_*.sql 290_*.sql 213_view_all_template.sql`(290 = F-01 effective_from 날짜 정규화) → `staging-deploy-next.ps1 -AcknowledgePinnedScheduleLag -Wait` → 관리자 계정 전 메뉴 스모크(lock-out 확인) → **테스터 공지 2차**("재로그인 필요, 메뉴 구성 변경") | 배포 revision 기록, 공지문 2차 |
| 10-22 (수) | **본 테스트 §4 전체**(§4.1 메뉴 → §4.2 URL → §4.3 데이터 범위 → §4.4·4.4b 우회·결함 후보 → §4.5 반영 시점) · 보류 큐의 권한 결함 보고 재확인 · Blocker·Major 수정·재배포 | 체크리스트, 결함 목록 |
| 10-23 (목) | 재검증 · 테스터에게 권한 체계 확정 공지(역할별 할 수 있는 일 요약) | 재검증 기록, 공지문 3차 |
| 오픈 후 | WP3 `fallbackRoles` 제거(기계적) · WP7 모바일 권한 요약 + OTA(1.1.0·1.2.0 두 런타임) · WP8 자산 | 후속 PR |

배포는 `staging-deploy-next.ps1 -AcknowledgePinnedScheduleLag -Wait`로만 한다(ADT·intel 배치는 고정 revision 618에 남고 서비스만 새 revision으로 이동). 일원화 마이그는 권한 표(permissions·template_grants·assignments·users.role)만 건드리므로 ADT·intel 표 스키마 변경이 아니다. 오픈 기간 중 배포이므로 **업무 시간 밖(저녁)** 에 하고, 배포 직후 관리자·사원 계정으로 로그인·홈·전자결재·메일 스모크를 끝낸 뒤 공지한다.

### 7.3 오픈 공지문에 넣을 "알려진 제한" (일원화 배포 전 상태)

- 사업장·데이터·성과급 산정·업무추진계획의 부서장 감독/임원 검토 메뉴는 권한이 없어도 보이며, 들어가면 내용이 비거나 권한 오류가 뜬다. 주중 권한 체계 정비 후 권한 있는 분에게만 보이도록 바뀐다.
- 부서장의 휴지통, 외부 설문 작성, 임원의 급여대장·재무 조회는 정비 후에 열린다.
- 권한 변경은 다시 로그인해야 반영된다. 정비 배포 시 전원 재로그인 안내가 나간다.
- 모바일 앱의 영업·입찰 편집 버튼은 정비 이후 별도 업데이트(OTA)로 맞춘다.
- 권한·메뉴 관련 불편은 보고해 주되, 정비 배포 이후 다시 확인한다는 점을 미리 알린다.

배포는 `staging-deploy-next.ps1 -AcknowledgePinnedScheduleLag -Wait`로만 한다(ADT·intel 배치는 고정 revision 618에 남고 서비스만 새 revision으로 이동). 일원화 마이그는 권한 표(permissions·template_grants·users.role)만 건드리므로 ADT·intel 표 스키마 변경이 아니다.

---

## 8. 체크리스트 양식

| ID | 층 | 역할 | 경로/행위 | 기대 | 실제(HTTP) | 판정 | 등급 | 증빙 | 메모 |
|---|---|---|---|---|---|---|---|---|---|
| M-01 | 메뉴 | 사원 | 사이드바 전체 | §4.1 | | | | 캡처 | |
| U-01 | URL | 사원 | /admin/users | 로그인으로 리다이렉트 | | | | | |
| D-01 | 데이터 | 사원 | /contracts 목록 | 계약 X만 | | | | | |
| … | | | | | | | | | |

판정: PASS / FAIL / N-A(설계로 확정된 항목) / BLOCKED(선행 결함으로 미수행).

---

## 9. 알려진 전제·한계

- 스테이징 배포본이 main 최신(`e9cf5e7` 이후 배포분)과 일치하는지 테스트 전 `/api/health`와 ECS 서비스 revision으로 확인한다. 미배포 커밋이 있으면 테스트 결과가 코드와 어긋난다.
- `fallbackRoles` 인자 192곳은 enforce on에서 무시되는 죽은 코드다 — 테스트 결과 해석에 넣지 않는다.
- 권한 템플릿 변경은 즉시 반영, role 변경은 재로그인 필요(§4.5). 테스트 중 role을 바꿨다면 반드시 로그아웃·재로그인 후 측정한다.
- 테스트 계정은 급여·근태·연차 실데이터가 없으므로 "내 ○○" 화면은 **빈 상태의 정상 렌더**와 **타인 ID 호출 403**만 검증하고, 실데이터 화면은 실제 직원 1명의 자발적 확인으로 보완한다.
