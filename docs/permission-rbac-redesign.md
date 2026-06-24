# 계정·권한 관리 재구축 설계 (RBAC 완전 전환)

> 상태: **설계 확정 전 초안 (v1)** · 작성 목적: 권한 템플릿을 "컨셉"에서 "실제 동작하는 RBAC"로 재구축하기 위한 기준 문서.
> 결정사항(2026-06): **레거시 3단계 role을 RBAC로 완전 전환**한다. 1차 산출물은 본 설계 문서.

---

## 0. 한눈에 보는 결정

- **권한 모델**: `admin/editor/viewer` 3단계 role → **atomic 권한키 × scope** RBAC로 전환.
- **role의 잔여 역할**: `admin`만 **부트스트랩(최초 관리자) 안전장치**로 남긴다. `editor/viewer`는 의미를 폐기하고, 모든 실질 통제는 권한 템플릿이 한다.
- **가드 전환**: 142개 API 라우트의 `requireEditor/requireAuthenticated/requireRole`을 `requirePermission(key, target)`으로 교체한다.
- **scope 강제**: 현재 코드에서 무시되는 부서 범위(self_dept 등)를 실제 평가에 반영한다.

---

## 1. 현황 진단 (왜 재구축인가)

이 앱에는 권한 체계가 **두 개 공존**하나 하나만 동작한다.

| 체계 | 동작 | 근거 |
|---|---|---|
| (A) 레거시 3단계 role | ✅ 실제 전부 통제 | `menu.ts`의 `minRole`, 142개 라우트의 `requireAdmin/requireEditor/requireSession` |
| (B) RBAC 권한 템플릿 | ❌ 완전 미연결(dead) | `permissions/permission_templates/grants/assignments` 테이블·평가함수·UI는 있으나 **`requirePermission()` 호출 라우트가 0개** |

구조적 문제 3가지:
1. **RBAC 미연결** — 템플릿을 만들어 부여해도 앱 동작에 영향 없음 (`guards.ts:88` `requirePermission`이 `guards.ts` 밖에서 import되지 않음).
2. **scope 미강제** — 예) `staffing/evaluations` GET은 `requireEditor()`만 → editor면 **타 부서 평점도 저장 가능**. seed의 "부서장=self_dept" 의도가 코드에 없음.
3. **카탈로그 누락** — 현재 권한키 18개는 work_plan/staffing/contract/bonus/data/rbac/audit 한정. facilities·billing·certificate·trash·org/account·data.collect 등은 권한키 없음.

### 현재 권한키 18개 (재사용/정리 대상)
`rbac.template.manage`, `rbac.assignment.manage`, `staffing.view`, `staffing.edit`, `staffing.documents.manage`, `contract.view`, `contract.edit`, `data.review`, `audit.read`, `work_plan.view`, `work_plan.edit`, `work_plan.edit.locked`, `work_plan.merge`, `work_plan.lock_release`, `staffing.changes.record`, `staffing.evaluation.write`, `staffing.evaluation.read`, `bonus.view`

---

## 2. 설계 원칙

**두 축으로 정규화한다.**

- **축1 — 행위(action) 단계**: `view`(조회) → `edit`(작성·수정) → `approve`/`lock`(승인·확정·잠금) → `delete`(삭제) → `manage`(관리, 위험).
- **축2 — 범위(scope)**: `self`(본인) → **`participant`(본인이 수행하는 용역)** → `self_dept`(소속 부서) → `specific_dept`(지정 부서) → `all`(전사).
  - `self`/`self_dept`/`specific_dept`/`all` 4종은 스키마에 이미 존재.
  - **`participant`는 신규** — "본인이 참여자로 등록된 계약" 단위. 부서가 아니라 **계약 참여(service_participants)** 로 가시성을 결정한다. 계약/수금 가시성(§3.5)의 핵심.

핵심 제한 기준: **수평 분리는 scope(부서/참여), 수직 분리는 action(직급 단계).**

평가 규칙(기존 `rbac.ts` 유지):
- `admin` role → 항상 ALLOW (부트스트랩).
- **deny-overrides**: 같은 키에 deny가 하나라도 매칭되면 거부.
- scope 매칭은 `target(userId/deptId)` 기준. (현재 함수 그대로 사용 가능)

---

## 3. 권한 카탈로그 (재설계 전체안)

> ★ = 신규 추가, (기존) = 현재 seed 유지. `D` = is_dangerous=1.

| permission_key | module | action | 설명 | scopes_supported | D |
|---|---|---|---|---|:--:|
| `facility.view` ★ | facility | view | 사업장 조회 | all | |
| `facility.edit` ★ | facility | edit | 사업장 등록·수정 | all | |
| `facility.merge` ★ | facility | merge | 사업장 병합 | all | D |
| `facility.delete` ★ | facility | delete | 사업장 삭제(휴지통 이동) | all | D |
| `contract.view` (기존) | contract | view | 계약 조회 | participant,self_dept,specific_dept,all | |
| `contract.edit` (기존) | contract | edit | 계약 등록·수정 | participant,self_dept,specific_dept,all | |
| `contract.delete` ★ | contract | delete | 계약 삭제 | self_dept,all | D |
| `billing.view` ★ | billing | view | 수주/수금/발행 현황 조회 | participant,self_dept,all | |
| `billing.edit` ★ | billing | edit | 수주·수금·마일스톤 입력 | participant,self_dept,all | |
| `billing.receivable.manage` ★ | billing | receivable.manage | 채권 조치 기록·관리 | self_dept,all | D |
| `billing.export` ★ | billing | export | 청구/수금 내역 내보내기 | self_dept,all | |
| `certificate.issue` ★ | certificate | issue | 실적/거래 증명서 발급 | self_dept,all | D |
| `work_plan.view` (기존) | work_plan | view | 업무추진계획 조회 | self,self_dept,specific_dept,all | |
| `work_plan.edit` (기존) | work_plan | edit | 업무추진계획 작성·수정 | self,self_dept | |
| `work_plan.merge` (기존) | work_plan | merge | 부서장 1차보고 머지 | self_dept | |
| `work_plan.edit.locked` (기존) | work_plan | edit.locked | 잠금 보고 수정(사유 강제) | self_dept,all | D |
| `work_plan.lock_release` (기존) | work_plan | lock_release | 잠금 해제 | all | D |
| `work_plan.directive` ★ | work_plan | directive | 임원 검토·지시 작성 | all | |
| `staffing.view` (기존) | staffing | view | 인사 정보 조회 | self,self_dept,specific_dept,all | |
| `staffing.edit` (기존) | staffing | edit | 인사 정보 등록·수정 | self_dept,specific_dept,all | D |
| `staffing.documents.manage` (기존) | staffing | documents.manage | 인사 증빙 업로드·삭제 | self_dept,specific_dept,all | D |
| `staffing.changes.record` (기존) | staffing | changes.record | 수행인력 변동 기록 | self_dept,all | D |
| `staffing.evaluation.read` (기존) | staffing | evaluation.read | 반기 평점 열람 | self_dept,all | |
| `staffing.evaluation.write` (기존) | staffing | evaluation.write | 반기 참여도·평점 입력 | self_dept | D |
| `bonus.view` (기존) | bonus | view | 성과급 산정 내역 열람 | self_dept,all | |
| `data.view` ★ | data | view | 수집 현황·대시보드 조회 | all | |
| `data.review` (기존) | data | review | 수집 데이터 검수 | all | |
| `data.collect` ★ | data | collect | 수집/파싱 작업 실행·설정 | all | D |
| `trash.view` ★ | trash | view | 휴지통 조회 | self_dept,all | |
| `trash.restore` ★ | trash | restore | 휴지통 복원 | self_dept,all | D |
| `trash.purge` ★ | trash | purge | 영구 삭제 | all | D |
| `org.view` ★ | org | view | 조직도·직급 조회 | all | |
| `org.edit` ★ | org | edit | 조직·직급·부서 편집 | all | D |
| `account.manage` ★ | account | manage | 계정 등록·삭제·비번 리셋 | all | D |
| `rbac.template.manage` (기존) | rbac | template.manage | 권한 템플릿 관리 | all | D |
| `rbac.assignment.manage` (기존) | rbac | assignment.manage | 권한 부여·취소 | all,specific_dept,self_dept | D |
| `audit.read` (기존) | audit | read | 감사 로그 조회 | all | D |

총 **37개** (기존 18 + 신규 19).

> **사업장(facility) 가시성 — 영업관리본부 전속(확정)**: 사업장은 계약처럼 부서별로 쪼개지 않는다. 사업장 마스터의 등록·수정·병합·삭제는 **영업관리본부(`sales-management`) 전속**으로, `facility.*` 권한은 `tpl-sales`에만 부여하고 scope는 `all`(전 사업장)로 둔다. 즉 **scope가 아니라 "어느 템플릿에 부여하느냐"로 통제**한다. 타 부서 실무자에게는 `facility.*`를 부여하지 않으며, 계약 화면에서 필요한 사업장 정보는 계약 가시성(§3.5)을 통해 간접 노출된다.

---

## 3.5 계약·수금 가시성(Contract Visibility) 상세 설계 ★

> 임원 의견(사내 회의): **계약 관리·대시보드·수주/수금/발행 현황을 전 직원에게 공개하지 않는다.**
> - **실무자**: 자신이 **수행하는 용역(계약)** 의 수주/수금/발행만 본다.
> - **부서장**: 자신의 **부서가 수행하는 용역**의 수주/수금/발행만 본다.
> - **임원/관리자**: 전사.

이 요구는 기존 부서 단위 scope만으로는 표현 불가하다. 아래 3가지를 추가·정의한다.

### (1) 가시성 단위 정의

| 대상 | scope | 가시 계약 집합 정의 |
|---|---|---|
| 실무자 | `participant` | 본인(`users.employee_id`)이 `service_participants`에 등록된 `contract_id` 집합. **종료된 참여(`participated_to` 경과) 포함** |
| 부서장 | `self_dept` | `contracts.owning_dept_id = 본인 부서` **OR 본인 부서원이 참여한 계약**(타 부서 주도 대형 계약에 부서원이 일부 참여하는 경우 포함) |
| 임원/관리자 | `all` | 전체 |

- **수행 부서 기준은 `contracts.owning_dept_id`** (026에서 추가)이되, **단독 기준이 아니다.** 결정사항: 타 부서가 주도(`owning_dept`)하는 대형 계약이라도 **본인 부서원이 참여**하면 부서장은 그 계약을 열람한다.
- 참여 기반은 **계정→직원 연결**(`users.employee_id`)을 거쳐 `service_participants`로 해석한다. → `loadUserAccess`에 `employeeId` 로드 추가.
- **종료 용역도 계속 노출**(결정사항) — `participated_to` 조건을 걸지 않는다. 이력 열람 목적.

### (2) 두 가지 강제 메커니즘 (중요)

권한 강제에는 **성격이 다른 두 경로**가 있고, 계약 가시성은 둘 다 손봐야 한다.

| 경로 | 대상 | 방식 |
|---|---|---|
| **A. 단건 가드** | 계약 상세 진입, 단건 수정/삭제 (`/contracts/[id]`, billing actions) | `requirePermission("contract.view", { contractId })` — 해당 계약의 `owning_dept_id`/참여자를 평가해 403 |
| **B. 목록·집계 필터** | 목록·대시보드·billing 집계 (`listContracts`, `getContractOrdersStatus` 등) | scope를 **WHERE 절로 변환**해 애초에 안 보이게. 403이 아니라 **결과에서 제외** |

> 현재 `rbac.ts`의 `checkPermission`은 단건(A)만 처리한다. **목록(B)을 위한 별도 헬퍼가 필요**하다.

### (3) 가시 계약 범위 헬퍼 (신규)

```ts
// frontend/lib/auth/contract-scope.ts (신규 제안)
export type ContractScope =
  | { kind: "all" }                                    // 전사 — 필터 없음
  | { kind: "dept"; deptIds: string[] }                // 부서장: owning_dept ∈ depts OR 부서원 참여
  | { kind: "participant"; employeeId: string }        // 실무자: 본인 참여(종료 포함)
  | { kind: "none" };                                  // 가시 계약 없음 — 빈 결과

/** permissionKey(contract.view|billing.view)에 대해 사용자가 볼 수 있는 계약 범위를 해석 */
export async function resolveContractScope(
  userId: string,
  permissionKey: string
): Promise<ContractScope>;
```

해석 규칙(가장 넓은 grant 우선, deny 반영):
- grant에 `all` allow 존재 → `{ all }`
- `self_dept`/`specific_dept` → `{ dept, deptIds: [...] }`
- `participant`(또는 `self`) → `{ participant, employeeId }`
- 매칭 grant 없음 → `{ none }` (전 직원 공개 차단의 기본값)

이 헬퍼 결과를 **서브쿼리 EXISTS**로 쿼리에 주입한다(부서장의 "부서원 참여" OR 조건 때문에 단순 IN으로는 부족):

```ts
// listContracts / getContractOrdersStatus 등에 ContractScope 인자 추가
switch (scope.kind) {
  case "all":
    break;                                                       // 필터 없음
  case "dept": {
    const d = addParam(scope.deptIds);
    where.push(`(
      c.owning_dept_id = ANY(${d})
      OR EXISTS (
        SELECT 1 FROM service_participants sp
        JOIN employee_profiles ep ON ep.employee_id = sp.employee_id
        WHERE sp.contract_id = c.contract_id AND ep.dept_id = ANY(${d})
      ))`);                                                      // 종료 참여 포함(조건 없음)
    break;
  }
  case "participant": {
    const e = addParam(scope.employeeId);
    where.push(`EXISTS (
      SELECT 1 FROM service_participants sp
      WHERE sp.contract_id = c.contract_id AND sp.employee_id = ${e}
    )`);                                                         // 종료 참여 포함
    break;
  }
  case "none":
    where.push("FALSE");
    break;
}
```

`listContracts`는 이미 `where[]`/`addParam` 빌더가 있어 주입이 깔끔하다([contracts.ts:111](frontend/lib/ieps/contracts.ts:111)). billing 계열(`getContractOrdersStatus` 등 [contracts.ts:1185](frontend/lib/ieps/contracts.ts:1185))은 현재 필터 인자가 없으므로 **`scope` 인자를 추가**해 각 집계 CTE/쿼리의 `WHERE`에 동일 조건을 합류시킨다. (집계가 여러 쿼리로 쪼개져 있으면 공통 `contractScopeWhere(scope)` 헬퍼로 SQL 조각을 재사용)

### (4) 단건 평가 함수 보강 (`rbac.ts`)

목록(B)은 위 헬퍼가 처리하고, 단건(A) 진입·수정 검사는 `rbac.ts`를 보강한다.

- `loadUserAccess`: `SELECT role, dept_id, employee_id ...`로 `employeeId` 추가 로드.
- `PermissionTarget`에 `contractId?: string` 추가.
- `scopeMatches`에 `case "participant"`: `target.contractId`가 **본인이 참여한 계약**인지 검사 (`service_participants WHERE contract_id = ? AND employee_id = 본인`, 종료 포함).
- `case "self_dept"`(계약 대상일 때): 해당 계약의 `owning_dept_id`가 본인 부서이거나, **본인 부서원이 그 계약에 참여**하면 통과. → 단건 검사 시 `target`에 계약의 `owning_dept_id`를 채워 넘기고, 부서원 참여 여부는 보조 쿼리로 확인.

### (5) 마법사에서의 노출

Step2(기본 범위) 및 Step3 그리드의 contract/billing 행에서 scope 선택지를 다음으로 노출:

| 라벨 | scope_kind |
|---|---|
| 본인 수행 용역만 | `participant` |
| 소속 부서 수행 용역 | `self_dept` |
| 지정 부서 | `specific_dept` |
| 전사 | `all` |

시스템 템플릿 기본값(§5 갱신): 팀원=`participant`, 부서장=`self_dept`, 임원/영업관리=`all`.

### (6) 마이그레이션 영향 — scope CHECK 제약 확장

`participant`를 쓰려면 `scope_kind` CHECK 제약(3개 테이블)을 확장해야 한다. (멱등 처리)

```sql
-- permission_template_grants / user_permission_assignments / position_default_templates
ALTER TABLE permission_template_grants  DROP CONSTRAINT IF EXISTS permission_template_grants_scope_kind_check;
ALTER TABLE permission_template_grants  ADD  CONSTRAINT permission_template_grants_scope_kind_check
  CHECK (scope_kind IN ('self','participant','self_dept','specific_dept','all'));
-- assignments.scope_override_kind, position_default_templates.scope_kind_default 도 동일 패턴
```
`permissions.scopes_supported` 문자열에도 contract/billing 키에 `participant`를 포함한다(예: `'participant,self_dept,all'`).

---

## 4. 라우트 → 권한키 매핑

### 전환 규칙 (기본 매핑 원칙)
현재 가드 패턴이 일관적이라 기계적으로 변환 가능하다.

| 현재 가드 | HTTP | → 신규 |
|---|---|---|
| `requireAuthenticated()` (조회) | GET | `requirePermission("<module>.view", target)` |
| `requireEditor()` (변경) | POST/PUT/PATCH/DELETE | `requirePermission("<module>.edit"\|".manage"\|".delete", target)` |
| `requireAdmin()` | 전부 | 해당 위험 권한키 (`account.manage`, `org.edit`, `rbac.*`, `audit.read`) |

`target`은 라우트 컨텍스트에서 결정: 계약/사업장 라우트는 `owning_dept_id`를, 인사/평가 라우트는 대상 직원의 `dept_id`를 `target.deptId`로 넘겨 scope를 강제한다.

### 모듈별 매핑 (대표)
| 라우트 그룹 | 조회(GET) | 변경 |
|---|---|---|
| `/api/facilities/**` | `facility.view` | `facility.edit` / merge→`facility.merge` |
| `/api/facility-groups/**` | `facility.view` | `facility.edit` |
| `/api/contracts/**` (billing 제외) | `contract.view` ※목록은 scope 필터(§3.5-B) | `contract.edit` |
| `/api/contracts/tree`, `/api/contracts/dashboard/**` | `contract.view`/`billing.view` **+ scope 필터 필수** | — |
| `/api/contracts/billing/**` | `billing.view` **+ scope 필터 필수** | `billing.edit` / actions→`billing.receivable.manage` / export→`billing.export` |
| `/api/contracts/certificate*` | `contract.view` | `certificate.issue` |
| `/api/work-plan/**` | `work_plan.view` | `work_plan.edit` / merge→`work_plan.merge` / directive→`work_plan.directive` |
| `/api/staffing/**`, `/api/admin/employees/**` | `staffing.view` | `staffing.edit` / 평가→`staffing.evaluation.write` / 증빙→`staffing.documents.manage` |
| `/api/bonus-source/**` | `bonus.view` | — |
| `/api/data/**`, `/api/collect`, `/api/parse`, `/api/parsed-fields/**` | `data.view` | review→`data.review` / 실행→`data.collect` |
| `/api/trash/**` | `trash.view` | restore→`trash.restore` / purge→`trash.purge` |
| `/api/admin/organization/**`, `/api/departments` | `org.view` | `org.edit` |
| `/api/admin/users/**` | `account.manage` | `account.manage` |
| `/api/admin/permissions/**` | `rbac.template.manage` | `rbac.template.manage` / assignments→`rbac.assignment.manage` |
| `/api/dashboard/**`, `/api/alerts/**` | (로그인만, `requireSession`) | — |

> 주1: **전사 KPI 대시보드(`/api/dashboard/**`)·알림(`/api/alerts/**`)** 등 개인/공통 조회는 권한키 없이 `requireSession()` 유지.
> 주2: **계약 대시보드·트리·billing(`/api/contracts/dashboard`, `/contracts/tree`, `/contracts/billing/**`)은 위와 다르다** — 임원 요구에 따라 `requireSession`이 아니라 **`billing.view`/`contract.view` + scope 필터(§3.5)** 로 막아 전 직원 공개를 차단한다.

---

## 5. 시스템 템플릿 (출고 기본 7종)

마법사는 이 시스템 템플릿을 **복제·수정**하는 흐름을 기본으로 한다. (`is_system=1`, 삭제 불가, 비활성만 가능)

| template_id | 이름 | 기본 scope | 핵심 권한 |
|---|---|---|---|
| `tpl-admin-rbac` | 시스템 관리자 | all | `rbac.*`, `account.manage`, `org.edit`, `audit.read`, 전 모듈 manage |
| `tpl-exec` | 임원 | all | 전 모듈 `*.view` + `work_plan.directive` + `bonus.view` + `staffing.evaluation.read` |
| `tpl-dept-lead` | 본부장/부서장 | self_dept | `*.view` + work_plan(edit/merge/edit.locked) + staffing(changes/evaluation.write) + **contract.view/edit·billing.view(self_dept)** |
| `tpl-staff-basic` | 팀원 | self / **participant** | `work_plan.view(self_dept)/edit(self)`, `staffing.view(self)`, **`contract.view`·`billing.view`(participant — 본인 수행 용역만)** |
| `tpl-sales` ★ | 영업관리 | all | `contract.*`, `billing.*`, `certificate.issue`, **`facility.*`(view/edit/merge/delete — 사업장 전속 관리)** |
| `tpl-data-review` ★ | 데이터 검수 | all | `data.view/review/collect`, `facility.view` |
| `tpl-hr` ★ | 인사/회계 담당 | all | `staffing.*`(전사 인사정보 입력·관리·증빙), `org.view`, **`account.manage`(사번 계정 발급·리셋)** |

---

## 6. 직급별 기본 템플릿 매핑 (`position_default_templates`)

마법사 밖에서 신규 계정 생성 시 **1-click 추천**으로 쓴다. (자동 강제 아님, 관리자 확인)

| 직급군 | 추천 템플릿 |
|---|---|
| 대표이사·전무·상무·총괄본부장·이사 | `tpl-exec` |
| 부장·울산지사장·연구소장 (부서장) | `tpl-dept-lead` |
| 차장·과장·대리·사원·전문위원·연구원 | `tpl-staff-basic` |
| (영업관리본부 소속) | + `tpl-sales` 병행 추천 |

> **`tpl-hr`(인사/회계 담당)는 직급 자동매핑 대상이 아니다.** 직급이 낮아도(예: 이도희 대리) 인사·회계 업무를 맡으면 관리자가 **수동 부여**한다. 향후 인사/회계 담당 충원 시 동일하게 수동 부여. `tpl-hr`는 인사정보 관리 + 계정 발급(`account.manage`)까지 포함하되, **권한 템플릿 부여(`rbac.assignment.manage`)는 포함하지 않는다**(권한 위임은 시스템 관리자 전속).

---

## 7. 권한 템플릿 설정 마법사 UX 명세

현재 UI(`PermissionManagementPanel.tsx`)는 "권한1+scope1"을 드롭다운으로 하나씩 추가하는 평면 방식 → 본부장 템플릿 1개에 10클릭. 마법사로 단계화한다.

- **Step 1 — 시작점**: 빈 템플릿 / 시스템 템플릿 복제 / 직급 프리셋에서 가져오기.
- **Step 2 — 기본 범위**: 본인/소속부서/지정부서/전사 중 1택 → 이후 선택 권한에 기본 적용(개별 override 가능).
- **Step 3 — 모듈×액션 토글 그리드**: §3 카탈로그를 행(모듈)×열(액션) 체크박스로. 행 단위 "조회만/편집까지/전체" 프리셋 버튼. `is_dangerous`는 빨간 뱃지+확인.
- **Step 4 — 범위 예외 & deny**: 특정 권한만 scope override, deny 명시(예: "특정 부서 제외").
- **Step 5 — 미리보기 & 영향 분석**: 허용되는 화면/버튼 요약 + 적용 대상 미리보기 → 저장.

UI는 cdash 디자인 시스템(포털 모달이면 `cdash-vars`+`data-theme`)으로 구현한다.

---

## 7.5 계정-조직 통합 및 사번(로그인 ID) 자동 생성 ★

> 결정사항: **별도 "계정 생성" 항목을 폐지한다.** 조직도의 구성원 하나하나가 곧 하나의 계정이다.
> 현재는 `users`(email/password 직접 입력)와 `employee_profiles`(조직 인원)가 분리돼 이중 관리 → 통합한다.

### (1) 모델 전환

- **조직 인원(`employee_profiles`) ↔ 계정(`users`)을 1:1**로 본다. 조직도에 인원을 두는 것이 곧 계정 생성이다.
- `/admin/users/registry`의 **계정 생성 패널(`UserRoundPlus`) 제거**. 조직도 인원 선택 → 우측 패널에서 **계정 상태(활성/미발급)** 표시, 미발급이면 "계정 발급" 버튼으로 사번 자동 발급.
- 기존 `POST /api/admin/users`(email/password/role 직접 입력)는 **폐지**(또는 내부 마이그레이션 전용으로만). 대신 **조직 인원 기준 계정 발급 API**를 둔다.
- 로그인 식별자 = **사번(아래 규칙으로 생성)**. (현재 email 로그인 → 사번을 로그인 ID로. `users`에 `login_id` 또는 `employee_no` 식별자 컬럼 사용)

### (2) 사번 = 로그인 ID 생성 규칙

형식(12자리): **`YYYYMMDD`(입사일) + `GG`(성별) + `NN`(넘버링)**

| 구간 | 자릿수 | 규칙 |
|---|---|---|
| 입사일 | 8 | `employee_profiles.hired_at` → `YYYYMMDD` |
| 성별 | 2 | 남성 `01`, 여성 `02` (`employee_profiles.gender`) |
| 넘버링 | 2 | **같은 (입사일 + 성별) 그룹** 내에서만 부여. 그룹이 1명이면 `01`. 2명 이상이면 **생년월일이 빠른(이른) 사람 순**으로 `01`, `02`, `03`… |

**핵심**: 넘버링은 "입사일 중복"을 풀기 위한 것이고, 성별 코드가 이미 키에 들어가므로 **(입사일·성별) 조합이 유일하면 항상 `01`**.

예시:
- 입사일이 같은 2명, **성별이 다름** → 성별 코드로 이미 구분 → 각각 `…0101`(남), `…0201`(여). 넘버링은 둘 다 `01`.
- 입사일이 같은 3명, **모두 남성** → 성별 코드 동일(`01`) → **생년월일 빠른 순** `…0101`, `…0102`, `…0103`.

```
2019-03-04 입사 / 남 / (단독)            → 20190304 01 01  = 201903040101
2019-03-04 입사 / 남(1985-02-10)         → 20190304 01 01
2019-03-04 입사 / 남(1990-07-22)         → 20190304 01 02   (생년월일 늦음)
2019-03-04 입사 / 여                      → 20190304 02 01
```

발급 알고리즘(서버):
1. 대상 인원의 `hired_at`→`YYYYMMDD`, `gender`→`GG` 계산.
2. **이미 사번을 가진** 동일 `(YYYYMMDD, GG)` 인원들을 조회.
3. 신규 인원을 포함해 **생년월일 오름차순** 정렬 → 순번을 `NN`(2자리, 1부터)으로 부여.
4. 충돌 방지를 위해 발급은 **트랜잭션 + (입사일,성별) 단위 직렬화**로 처리(동시 발급 레이스 차단).

> 전제: 사번 생성에는 `hired_at`·`gender`·`birth_date`가 필요. 세 값은 `employee_profiles`에 이미 존재(012). **누락 인원은 발급 전에 입력 강제**.

### (3) 로그인 식별자 & 초기 비밀번호 (확정)

- **로그인 식별자 — 사번 또는 이메일 앞자리 둘 다 허용**:
  - 1순위: 사번(`login_id`, 12자리).
  - 2순위: **이메일 로컬파트**(= `@` 앞 텍스트). **전체 이메일 주소는 식별자로 쓰지 않는다.** 예) `hong@permitiq.co.kr` → 로그인 ID `hong`.
  - 로그인 폼 입력값으로 **사번·이메일 로컬파트 어느 쪽이 와도** 같은 계정을 찾는다(둘 다 `users`에서 조회).
  - **로컬파트 충돌 처리(확정)**: 실무상 이메일 앞자리 중복은 거의 없으나, 만약 이미 같은 `email_local`을 가진 계정이 있으면 **해당 신규 인원은 `email_local`을 비워두고 사번 전용으로 발급**한다(기존 계정은 그대로 로컬파트 유지). 즉 충돌나는 쪽만 사번으로만 로그인.
- **초기 비밀번호 — 사번과 동일 + 강제 변경**:
  - 발급 시 비밀번호 = **사번 문자열 그대로**(해시 저장).
  - `users.must_change_password = 1` 플래그를 세팅. **최초 로그인 시 비밀번호 변경 화면으로 강제 이동**, 변경 전까지 다른 화면 접근 차단.

### (4) 사번 발급 전 입력 강제 게이트 (UI)

사번 생성에는 `hired_at`·`gender`·`birth_date`가 모두 필요(넘버링은 생년월일 정렬에 의존). **하나라도 누락이면 발급 불가.**

- 조직도 인원 선택 → 우측 패널에 **계정 상태 배지**: `발급됨` / `미발급` / `정보부족`.
- `정보부족`(세 필드 중 결손)일 때 "계정 발급" 버튼을 **비활성**하고, 대신 **"발급 전 필수정보 입력" 모달**을 띄운다:
  - 필드: 입사일(`hired_at`), 성별(`gender`: 남/여), 생년월일(`birth_date`). 결손 항목만 빨간 강조.
  - 저장 시 검증(미래일자/형식) 후 `employee_profiles` 갱신 → 상태가 `미발급`으로 전환되며 발급 버튼 활성화.
- 발급 버튼 클릭 → 사번 생성(§7.5-2 알고리즘) + 계정 생성 + 초기 비번(사번) + `must_change_password=1`. 결과로 **사번·초기 비번 안내**를 토스트/모달로 표시.
- **일괄 발급** 진입 시에도 동일 게이트: `정보부족` 인원은 발급 대상에서 제외하고 목록으로 보여줘 입력을 유도.

### (5) 영향 정리

- **마이그레이션**(신규 `0NN_account_org_unify.sql`):
  - `users.login_id` text + UNIQUE 인덱스(사번).
  - `users.email_local` text + UNIQUE 인덱스(이메일 로컬파트) — 또는 기존 `email`에서 파생 조회.
  - `users.must_change_password integer NOT NULL DEFAULT 0`.
  - `users.employee_id` 백필(조직 인원 연결).
- **인증 흐름(NextAuth)**: authorize 단계에서 입력 식별자를 `login_id` 또는 `email_local`로 조회하도록 변경. 로그인 성공 후 `must_change_password=1`이면 변경 화면으로 리다이렉트.

---

## 8. 데이터 모델 보완

대부분 기존 스키마로 충분하다. 추가 검토 항목:

- **(선택) `permission_template_grants.conditions_json`** — 이미 컬럼 존재. Step4의 조건부 권한에 활용 가능(현재 미사용).
- **scope 강제용 dept 해석** — 계약/사업장의 `owning_dept_id`(026에서 추가됨)를 `target.deptId`로 사용. 사업장 자체엔 dept 귀속이 없으므로, 사업장 모듈 scope는 우선 `all` 위주로 두고 추후 정교화.
- **role 컬럼 유지** — `users.role`은 admin 부트스트랩 용도로 남긴다(스키마 변경 없음).

---

## 9. 마이그레이션 SQL 초안 (`041_rbac_full_catalog.sql`)

> 멱등(`ON CONFLICT ... DO UPDATE`). 신규 번호로 작성, 기존 파일 수정 금지. 아래는 권한 카탈로그 부분 골격(템플릿/grant는 §5 확정 후 동일 패턴으로 추가).

```sql
-- 041_rbac_full_catalog.sql
-- RBAC 완전 전환: 권한 카탈로그 전체 + 신규 시스템 템플릿.
-- 012, 026 위에 적용한다. 멱등.

INSERT INTO permissions (permission_key, module, action, description, scopes_supported, is_dangerous, created_at)
VALUES
  ('facility.view',            'facility','view',             '사업장 조회',            'self_dept,specific_dept,all', 0, now()::text),
  ('facility.edit',            'facility','edit',             '사업장 등록·수정',       'self_dept,specific_dept,all', 0, now()::text),
  ('facility.merge',           'facility','merge',            '사업장 병합',            'all',                         1, now()::text),
  ('facility.delete',          'facility','delete',           '사업장 삭제',            'self_dept,all',               1, now()::text),
  ('contract.delete',          'contract','delete',           '계약 삭제',              'self_dept,all',               1, now()::text),
  ('billing.view',             'billing', 'view',             '수주/수금/발행 조회',    'participant,self_dept,all',   0, now()::text),
  ('billing.edit',             'billing', 'edit',             '수주·수금 입력',         'participant,self_dept,all',   0, now()::text),
  ('billing.receivable.manage','billing', 'receivable.manage','채권 조치 관리',         'self_dept,all',               1, now()::text),
  ('billing.export',           'billing', 'export',           '청구/수금 내보내기',     'self_dept,all',               0, now()::text),
  ('certificate.issue',        'certificate','issue',         '실적/거래 증명서 발급',  'self_dept,all',               1, now()::text),
  ('work_plan.directive',      'work_plan','directive',       '임원 검토·지시 작성',    'all',                         0, now()::text),
  ('data.view',                'data',    'view',             '수집 현황 조회',         'all',                         0, now()::text),
  ('data.collect',             'data',    'collect',          '수집/파싱 실행·설정',    'all',                         1, now()::text),
  ('trash.view',               'trash',   'view',             '휴지통 조회',            'self_dept,all',               0, now()::text),
  ('trash.restore',            'trash',   'restore',          '휴지통 복원',            'self_dept,all',               1, now()::text),
  ('trash.purge',              'trash',   'purge',            '영구 삭제',              'all',                         1, now()::text),
  ('org.view',                 'org',     'view',             '조직도·직급 조회',       'all',                         0, now()::text),
  ('org.edit',                 'org',     'edit',             '조직·직급 편집',         'all',                         1, now()::text),
  ('account.manage',           'account', 'manage',           '계정 등록·삭제·리셋',    'all',                         1, now()::text)
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module, action = EXCLUDED.action, description = EXCLUDED.description,
  scopes_supported = EXCLUDED.scopes_supported, is_dangerous = EXCLUDED.is_dangerous;

-- scope 'participant' 허용을 위한 CHECK 제약 확장 (§3.5-6). 멱등.
ALTER TABLE permission_template_grants  DROP CONSTRAINT IF EXISTS permission_template_grants_scope_kind_check;
ALTER TABLE permission_template_grants  ADD  CONSTRAINT permission_template_grants_scope_kind_check
  CHECK (scope_kind IN ('self','participant','self_dept','specific_dept','all'));
ALTER TABLE user_permission_assignments DROP CONSTRAINT IF EXISTS user_permission_assignments_scope_override_kind_check;
ALTER TABLE user_permission_assignments ADD  CONSTRAINT user_permission_assignments_scope_override_kind_check
  CHECK (scope_override_kind IN ('self','participant','self_dept','specific_dept','all'));
ALTER TABLE position_default_templates  DROP CONSTRAINT IF EXISTS position_default_templates_scope_kind_default_check;
ALTER TABLE position_default_templates  ADD  CONSTRAINT position_default_templates_scope_kind_default_check
  CHECK (scope_kind_default IN ('self','participant','self_dept','specific_dept','all'));

-- 신규 시스템 템플릿 tpl-sales / tpl-data-review / tpl-hr 및 grant 는 §5 확정 후 추가.
-- 팀원 템플릿(tpl-staff-basic) contract/billing grant 는 scope='participant' 로 부여.
```

---

## 10. 단계적 전환 전략 (롤아웃)

RBAC 미연결 상태에서 갑자기 전수 교체하면 잠금(lock-out) 위험. 안전 순서:

1. **카탈로그·템플릿 마이그레이션 적용** (041) — 동작 변화 없음(아직 가드 미교체).
2. **`requirePermission`에 fallback 도입** — RBAC grant가 없으면 임시로 기존 role 결과를 따르는 호환 모드. (예: env 플래그 `RBAC_ENFORCE=false`)
3. **계정-조직 통합**(§7.5) — 사번 일괄 발급(`users.login_id` 백필), 계정 생성 패널 제거, 조직 인원 기준 계정 발급 API. 로그인 식별자 전환.
4. **마법사 UI 재구축 + 전 직원 템플릿 부여** — 데이터 정비. (팀원=participant, 부서장=self_dept 일괄 부여)
5. **모듈 단위로 가드 교체** — contracts/billing(가시성 핵심) 우선 → facilities → work_plan → staffing → admin 순, 모듈별 검증.
6. **`RBAC_ENFORCE=true` 전환** + role(editor/viewer) 의미 폐기. admin만 부트스트랩 유지.
7. `menu.ts`의 `minRole` → 권한키 기반 노출(`isMenuVisibleForPermission`)로 교체.

각 단계는 staging(195748745315 / ap-northeast-2)에서 검증 후 진행.

---

## 11. 미해결/확정 필요 항목

- ~~사업장 scope 귀속~~ → **확정**: 영업관리본부 전속. `facility.*`는 `tpl-sales`에만 부여, scope=all(§3 노트).
- ~~부서장 가시성~~ → **확정**: owning_dept OR 부서원 참여(§3.5-1).
- ~~종료 용역 노출~~ → **확정**: 종료 포함(§3.5-1).
- ~~계정↔직원 연결~~ → **확정**: 조직 인원=계정 통합, 사번 자동발급(§7.5).
- ~~초기 비밀번호 정책~~ → **확정**: 초기 비번=사번, `must_change_password`로 최초 변경 강제(§7.5-3).
- ~~로그인 식별자 전환~~ → **확정**: 사번 또는 이메일 로컬파트(@앞) 둘 다 허용, 전체 이메일은 미사용(§7.5-3).
- ~~`hired_at`/`gender`/`birth_date` 누락 인원~~ → **확정**: 발급 전 입력 강제 게이트(§7.5-4).
- ~~이메일 로컬파트 충돌 처리~~ → **확정**: 충돌 시 해당 인원만 사번 전용 발급(§7.5-3).
- ~~`tpl-hr`와 `account.manage`~~ → **확정**: 인사/회계 담당이 계정 발급까지 가능, 직급 무관 수동 부여. 단 권한 위임은 미포함(§5, §6).
- **마법사 Step4 deny/조건부**의 실제 사용 시나리오 수요. (유일한 잔여 항목 — 착수 블로커 아님)
