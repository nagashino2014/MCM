# 전자 업무보고 체계 + 자체 그룹웨어 블루프린트

> 작성일: 2026-05-27
> 대상 시스템: MCM (계약·영업·실적 관리 웹앱) → 전사 그룹웨어로 확장
> 본 문서는 “업무추진계획 표준화 → 전자결재(자체 그룹웨어) → 용역별 비용/수당 DB화 → 사업참여수행인력 현황 자동 갱신” 까지를 하나의 블루프린트로 묶은 설계 초안이다.

---

## 0. 큰 그림 한 장

```
[전 직원 계정 / RBAC]
        │
        ├─▶ 업무추진계획 (주간보고)  ─┐
        │     - 부서별 표준 양식 입력            │
        │     - 회의실 TV 발표 모드               │
        │                                                       │
        ├─▶ 전자결재 (출장/초과근무/지출/휴가) ┤
        │     - 결재선 자동 라우팅                 │
        │     - 비용 항목 = 용역 단위로 태깅 ─┐
        │                                                                │
        ├─▶ 계약/영업 (기존 MCM)                  ┤
        │     - 용역(Contract) 마스터              │
        │                                                                ▼
        ▼                                                        [용역별 비용·수당 DB]
[사업참여 수행인력 현황 (자동 갱신)]   ↑       │
   - 업무추진계획의 정·부담당 + 결재의 ─┘       │
     출장·근무 인원 추출                                          │
   - 실적증명서 자동 생성 (HWPX → PDF) ◀── 계약·계산서 PDF 병합
```

핵심 원칙 (전 모듈 공통):

1. **단일 진실원(Single Source of Truth)** — 사람/조직/용역(계약)은 각각 한 군데만 갱신하고 모든 화면이 그것을 참조한다.
2. **이벤트 기반 자동 갱신** — “업무추진계획에 누가 ‘참여자’로 입력됐다” → `service_participants` 테이블에 자동 누적. 수기 갱신 0회.
3. **표준 + 적응(Adapter)** — 부서별 기존 양식의 *시각적* 차이는 어댑터로 흡수하고, *데이터 모델*은 단 하나로 통일.
4. **읽기 전용 발표 모드** — 회의실 TV에 띄우는 화면은 별도 라우트(`/meeting/...`)로 두고 키보드/마우스 없이 자동 캐러셀.
5. **권한·감사로그 100% 적용** — RBAC + `audit_log`(MCM 라운드 2A 기존 인프라 그대로 확장).

---

## 1. 사용자 요구사항 매핑

| 사용자 요청 | 본 블루프린트 모듈 |
| --- | --- |
| 전 직원 계정 + 편집/접근 권한 차등 | §3 인증·조직·RBAC |
| 업무추진계획 양식 통일 + 온라인 작성/기록 | §4 업무추진계획 모듈 |
| 회의/간담회 시 작성된 보고 열람 (대회의실 TV) | §4.7 발표(Presentation) 모드 |
| 자동 DB화 (용역별 추진경과, 수행인력) | §4.5 정규화 파이프라인 + §6 사업참여수행인력 |
| 자체 그룹웨어 (전자결재) | §5 전자결재 모듈 |
| 용역별 소요비용·수당 DB화 (출장/초과근무) | §5.4 비용 정산 + §7 용역원가 집계 |
| 실적증명서·수행인력 명단 + 계약서·계산서 병합 | §6 (기존 “수행인력 자동입력” 앱 웹 마이그레이션) |
| 사업참여수행인력 현황을 계약관리와 “별개의” 메뉴로 | §6.1 — 별도 사이드바 메뉴 `/staffing`으로 분리 |
| **수행인력 변동 시점·이력 정밀 기록** (반기 성과급 산정 근거) | §6.6 인력 변동 이력 (본부장 권한) |
| **성과급 산정 (반기별, 본부별)** — 별도 앱이지만 본 DB와 밀접 | §6.7 성과급 산정 모듈 (블루프린트 별책) |
| **영업 파트의 영업활동·견적·입찰·낙찰 구조화 입력** + 사업장 담당자 마스터(명함 자동 인식 연동) | §3.4 / §4.10 |
| **관리 파트의 Task 단위 관리** (업무명/업무구분/추진기간/진행경과/상세) | §4.11 |
| **통합1·2본부, 울산지사, 화학안전본부의 용역 진행단계 enum + 진행률 + 주요일정** | §4.9 |
| **1차 보고(용역 담당자) → 부서장 머지 → 본부장/대표 보고**의 2단계 워크플로우 | §4.8 |

---

## 2. 사전 결정 사항 (Decision Log)

| # | 결정 | 근거 |
| --- | --- | --- |
| D-01 | 백엔드 DB는 기존 PostgreSQL(Aurora) 단일 인스턴스 그대로 — 신규 모듈 모두 같은 DB에 스키마만 추가 | 라운드 2A 이후 전사 표준. RBAC/audit_log 자산을 즉시 재사용 가능 |
| D-02 | 프론트는 Next.js 15 App Router 그대로 — 사이드바에 4개 신규 메뉴(`/staffing`, `/work-plan`, `/approval`, `/expense`) 추가 | 기존 `(app)/layout.tsx` + AlertBell/Drawer/sidebar 자산 재사용 |
| D-03 | 업무추진계획 양식은 “표준 핵심 필드”를 강제하고, 그 위에 부서별 “섹션 템플릿”을 얹는다 (양식 = 표준 + 어댑터) | 부서별 양식이 너무 다르므로 완전 통일은 거부감↑. 핵심 필드만 표준화하면 통계/수집/DB화 가능 |
| D-04 | 결재선은 “템플릿” 기반 — 문서 종류별로 미리 정의된 결재선을 부서·직급으로 자동 매핑 | 사용자 매뉴얼 결재선 지정은 운영 사고 다발. 템플릿화로 일관성 확보 |
| D-05 | 출장·초과근무 등 비용성 결재는 작성 시점에 **계약 여부**를 명시해야 결재 진행: (a) 기 계약 건 → `contract_id` 1개 선택 / (b) 미 계약 건 → 사업장명 + 용역명(가칭 허용) + (선택) 영업활동/입찰 마스터 link. 둘 중 하나는 반드시 채워야 하며 결재 후에도 잠금 해제 불가. (수정안 2026-05-27) | 영업활동·현장설명회·제안서 준비 등 계약 ID가 아직 없는 비용도 기록되어야 함. 다만 미계약 비용은 별도 후보(prospect)로 격리되어 `service_costs` 본 라인이 아닌 `prospect_costs`에 적재되고, 추후 계약 체결 시 일괄 재태깅 |
| D-06 | 기존 데스크톱 “수행인력 자동입력” 앱(Flask)은 단계적으로 deprecate. **HWPX 생성·필드 치환·PDF 병합은 AWS(Linux)에서 직접 처리. *HWPX→PDF 변환만* 사내 Windows 워커로 분리** (잡 큐 polling 모델 — 워커 24/7 가동 불필요) | HWPX는 ZIP+XML(OWPML) 표준이라 `zipfile`/`lxml`로 OS 독립 처리 가능. 한컴 COM이 필요한 건 PDF 변환 한 단계뿐이므로 그 단계만 사내 워커로 격리. fallback으로 LibreOffice + h2orestart 검토 가능 |
| D-07 | TV 회의 발표 모드는 인증 우회가 아니라 “미리 발급된 발표 토큰”으로 진입 | 보안: 같은 네트워크라도 익명 접근은 허용하지 않음 |
| D-08 | 그룹웨어 메뉴 구조는 “계약/영업 = 일하는 화면”, “업무·결재 = 보고하는 화면” 두 축으로 사이드바를 분리 | 사이드바 항목 과다 시 UX↓. 두 축으로 카테고리화 |

---

## 3. 인증·조직·RBAC

### 3.1 조직 모델

기존 `users` 테이블(라운드 2A: `user_id / email / name / role / status`)에 다음을 추가하여 회사 조직을 표현한다.

```sql
CREATE TABLE departments (
  dept_id        VARCHAR(32) PRIMARY KEY,            -- 'div1', 'div2', 'chemsafe', 'ulsan', 'design', 'sales-mgmt', 'carbon-future' …
  dept_name      VARCHAR(80) NOT NULL,
  dept_kind      VARCHAR(24) NOT NULL,               -- 'division'(본부) | 'team'(팀/지사) | 'lab'(연구소) | 'support'
  parent_dept_id VARCHAR(32) REFERENCES departments(dept_id),
  display_order  INT NOT NULL DEFAULT 100,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE positions (
  position_id   VARCHAR(32) PRIMARY KEY,             -- 'staff', 'asst-mgr', 'mgr', 'dep-head', 'div-head', 'exec', 'ceo'
  position_name VARCHAR(40) NOT NULL,                -- '사원', '대리', '과장', …
  rank_order    INT NOT NULL                          -- 결재선 자동 라우팅의 기준 (낮을수록 하급자)
);

ALTER TABLE users
  ADD COLUMN dept_id      VARCHAR(32) REFERENCES departments(dept_id),
  ADD COLUMN position_id  VARCHAR(32) REFERENCES positions(position_id),
  ADD COLUMN employee_no  VARCHAR(20),                -- 사번 (선택)
  ADD COLUMN hired_at     DATE,                       -- 입사일 → 명단 ‘수행기간’ 자동계산용
  ADD COLUMN cost_center  VARCHAR(32),                -- 회계 코드 (선택)
  ADD COLUMN signature_image_path TEXT;               -- 결재 도장/사인 이미지 (선택)
```

### 3.2 RBAC: 시스템 역할 + 권한 템플릿(옵션) 모델

> 사용자가 admin 한 명에게 모든 권한을 두고, admin이 화면에서 “부서/직급별 권한 옵션(=템플릿)”을 만들어 인원에게 적용하는 운영 모델을 요구.
> 따라서 RBAC은 다음 3개 층으로 구성한다.
>
> 1. **시스템 기본 역할** (`users.role` = `admin` | `editor` | `viewer`) — 코드 레벨의 최소 가드. 변경 거의 없음.
> 2. **권한 카탈로그** (`permissions`) — 시스템이 제공하는 atomic 권한 키 목록. 코드 변경 없이 admin이 화면에서 발견·조합 가능.
> 3. **권한 템플릿** (`permission_templates` + `permission_template_grants`) + **인원 적용** (`user_permission_assignments`) — admin이 만든 “옵션”을 인원에 적용. 직급별 default 자동 부여 가능.
>
> `admin` 역할 보유자는 카탈로그·템플릿·적용 자체를 우회하여 항상 ALLOW (단, 모든 변경은 audit_log).

#### 3.2.1 시스템 기본 역할

| role | 의미 | 카탈로그/템플릿 무시 여부 |
| --- | --- | --- |
| `admin` | 운영 책임자. 모든 데이터/모든 모듈/모든 부서. 권한 템플릿 생성·적용·해제 권한도 전속. | **YES (항상 ALLOW)** |
| `editor` | 일반 직원. 카탈로그·템플릿 합산이 본인 권한. 템플릿 미적용 시 “자기 데이터”만. | NO |
| `viewer` | 외부/임시 계정 또는 read-only 동행 인원. 명시 read 권한 외 거부. | NO |

> 기본값: 모든 신규 직원은 `editor`. `admin` 부여는 admin UI에서 수동.

#### 3.2.2 권한 카탈로그 (`permissions`)

코드(시드)로 관리되는 atomic 권한 키 마스터. admin이 화면에서 “이 옵션에 어떤 권한을 넣을지” 고를 후보 목록.

```sql
CREATE TABLE permissions (
  permission_key   VARCHAR(80) PRIMARY KEY,
  -- 'work_plan.view' | 'work_plan.edit' | 'work_plan.edit.locked'
  -- | 'work_plan.merge' (부서장 머지 §4.8)
  -- | 'work_plan.lock_release' (잠금 해제)
  -- | 'work_plan.template.manage'
  -- | 'approval.draft' | 'approval.approve' | 'approval.delegate'
  -- | 'expense.tag.contract' | 'expense.tag.prospect' | 'expense.export'
  -- | 'expense.prospect.absorb' | 'expense.prospect.writeoff' | 'expense.edit.locked'
  -- | 'staffing.view' | 'staffing.edit'
  -- | 'staffing.changes.record' | 'staffing.evaluation.write' | 'staffing.evaluation.read'
  -- | 'contract.view' | 'contract.edit' | 'contract.create' | 'contract.delete'
  -- | 'business_contact.view' | 'business_contact.edit'
  -- | 'sales.activity.view' | 'sales.activity.edit'
  -- | 'sales.bid.view' | 'sales.bid.edit' | 'sales.bid.spawn_contract'
  -- | 'admin_task.view' | 'admin_task.edit'
  -- | 'bonus.view'  -- 본부 성과급 산정 내역 열람
  -- | 'bonus.calc.run'
  -- | 'audit.read'
  -- | 'rbac.template.manage' | 'rbac.assignment.manage'
  module           VARCHAR(32) NOT NULL,           -- 'work_plan' | 'approval' | 'staffing' | 'contract' | 'sales' | 'admin_task' | 'bonus' | 'audit' | 'rbac' | …
  action           VARCHAR(32) NOT NULL,           -- 'view' | 'edit' | 'edit.locked' | 'merge' | 'approve' | 'spawn' | …
  description      TEXT NOT NULL,                  -- UI 표시용 한글 설명
  scopes_supported VARCHAR(80) NOT NULL,
  -- 이 권한이 받을 수 있는 scope 종류 (콤마): 'self,self_dept,specific_dept,all'
  -- (특정 권한은 'all' 만 의미가 있고 어떤 권한은 self/self_dept만 의미가 있음 → UI 검증)
  is_dangerous     BOOLEAN NOT NULL DEFAULT FALSE, -- true 면 적용 시 admin 재확인 모달 (예: lock_release, contract.delete, bonus.calc.run)
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

> 카탈로그는 시드 스크립트(`scripts/seed_permissions.py`)로 코드와 동기화. 새 모듈 추가 시 PR로 row 추가.

#### 3.2.3 권한 템플릿 (= “권한 옵션”)

```sql
CREATE TABLE permission_templates (
  template_id   VARCHAR(32) PRIMARY KEY,
  template_name VARCHAR(80) NOT NULL,                 -- '임원' | '부서장' | '영업담당' | '도면담당' | …
  description   TEXT,
  is_system     BOOLEAN NOT NULL DEFAULT FALSE,       -- 시스템 시드 템플릿(편집은 가능, 삭제는 admin도 불가)
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by    VARCHAR(32) NOT NULL REFERENCES users(user_id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE permission_template_grants (
  grant_id        VARCHAR(32) PRIMARY KEY,
  template_id     VARCHAR(32) NOT NULL REFERENCES permission_templates(template_id) ON DELETE CASCADE,
  permission_key  VARCHAR(80) NOT NULL REFERENCES permissions(permission_key),
  scope_kind      VARCHAR(24) NOT NULL,
  -- 'self'           : 본인 데이터
  -- 'self_dept'      : 본인이 소속된 부서 (런타임에 users.dept_id 로 평가)
  -- 'specific_dept'  : 특정 부서 (scope_dept_id 로 고정)
  -- 'all'            : 전사
  scope_dept_id   VARCHAR(32) REFERENCES departments(dept_id),  -- scope_kind='specific_dept' 일 때만 NOT NULL
  effect          VARCHAR(8) NOT NULL DEFAULT 'allow',           -- 'allow' | 'deny'
  -- deny 는 명시적 거부 (예: '부서장' 템플릿이지만 'staffing.evaluation.write' 만 deny)
  conditions_json JSONB,
  -- 옵션. 추후 확장: {"contract_status_in":["active"]}, {"max_amount_krw":10000000} 등 필요시
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (template_id, permission_key, scope_kind, COALESCE(scope_dept_id, '__null__'))
);

CREATE INDEX idx_ptg_template ON permission_template_grants(template_id);
```

설계 포인트:
- `effect='deny'` 가 같은 user에 대한 다른 템플릿의 `'allow'`보다 **우선** (deny-overrides). 사고 방지.
- `scope_kind='self_dept'` 는 user의 dept_id를 런타임에 평가 → 같은 “부서장” 템플릿을 통합1본부장과 통합2본부장에게 똑같이 적용해도 각자 자기 부서로 작동.
- `scope_kind='specific_dept'` 는 “부서장이 다른 부서까지 봐야 하는 특수 케이스”에 사용 (예: 총괄본부장에게 “모든 본부 부서 R”).

#### 3.2.4 인원 적용 (`user_permission_assignments`)

```sql
CREATE TABLE user_permission_assignments (
  assignment_id   VARCHAR(32) PRIMARY KEY,
  user_id         VARCHAR(32) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  template_id     VARCHAR(32) NOT NULL REFERENCES permission_templates(template_id) ON DELETE CASCADE,
  -- 적용 시점에 scope override (선택) — 템플릿의 self_dept 를 specific_dept 로 강제
  scope_override_kind     VARCHAR(24),                                                    -- NULL = 템플릿 기본
  scope_override_dept_id  VARCHAR(32) REFERENCES departments(dept_id),
  -- 유효기간
  effective_from  DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to    DATE,                                  -- NULL = 무기한
  reason          TEXT,
  assigned_by     VARCHAR(32) NOT NULL REFERENCES users(user_id),
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at      TIMESTAMPTZ,
  revoked_by      VARCHAR(32) REFERENCES users(user_id),
  UNIQUE (user_id, template_id, effective_from)
);

CREATE INDEX idx_upa_user ON user_permission_assignments(user_id) WHERE revoked_at IS NULL;
```

- 한 user에 N개 템플릿 동시 적용 가능 (예: `부서장` + `영업담당` 같이).
- `effective_from/to` 로 “7월부터 부서장 직무대리”도 표현 가능.
- `revoked_at` 채워지면 즉시 비활성. 삭제 대신 revoke 사용 (이력 보존).

#### 3.2.5 직급별 기본 템플릿 (`position_default_templates`)

신규 입사자 등록 시 직급(`positions`) 기준으로 자동 부여될 템플릿.

```sql
CREATE TABLE position_default_templates (
  position_id   VARCHAR(32) NOT NULL REFERENCES positions(position_id) ON DELETE CASCADE,
  template_id   VARCHAR(32) NOT NULL REFERENCES permission_templates(template_id) ON DELETE CASCADE,
  scope_kind_default     VARCHAR(24),                            -- NULL = 템플릿 그대로
  scope_dept_default     VARCHAR(32) REFERENCES departments(dept_id),
  -- (예: '본부장' 직급이면 → '부서장' 템플릿 + scope_kind='self_dept')
  PRIMARY KEY (position_id, template_id)
);
```

- 직급 변경(승진/이동) 시 트리거: 이전 직급의 default 템플릿은 자동 revoke 후보, 새 직급의 default 는 자동 신규 assign 후보 (admin 1-click 확인).

#### 3.2.6 권한 해석 알고리즘 (`hasPermission(user, key, target)`)

런타임 검사 함수의 의사코드 (`frontend/lib/rbac.ts` 또는 백엔드 미들웨어):

```ts
function hasPermission(
  user: User,
  permissionKey: string,        // e.g. 'work_plan.edit.locked'
  target: { dept_id?: string; user_id?: string; contract_id?: string }
): boolean {
  // 1) 시스템 admin 우회
  if (user.role === 'admin') return true;

  // 2) 활성 assignments 로드 (캐시: user + revoked_at IS NULL + effective_from<=today<=effective_to)
  const grants = loadActiveGrantsForUser(user.user_id);
  // grants: [{ permission_key, scope_kind, scope_dept_id, effect }]

  // 3) deny-overrides
  const denied = grants.find(g =>
    g.permission_key === permissionKey &&
    scopeMatches(g, user, target) &&
    g.effect === 'deny'
  );
  if (denied) return false;

  // 4) allow 매칭
  return grants.some(g =>
    g.permission_key === permissionKey &&
    g.scope_kind && scopeMatches(g, user, target) &&
    g.effect === 'allow'
  );
}

function scopeMatches(grant, user, target): boolean {
  switch (grant.scope_kind) {
    case 'all':           return true;
    case 'self':          return !target.user_id || target.user_id === user.user_id;
    case 'self_dept':     return !target.dept_id || target.dept_id === user.dept_id;
    case 'specific_dept': return !target.dept_id || target.dept_id === grant.scope_dept_id;
    default: return false;
  }
}
```

- 모든 API/페이지는 `target` (예: 어떤 보고서가 어느 부서 소속인지) 정보를 같이 넘겨야 함. work_plan_reports.dept_id, contracts.owning_dept_id 등 기존 컬럼 활용.
- 캐싱: 1분 단위 in-memory + assignment 변경 시 invalidate (admin이 바꾸면 즉시 반영).

#### 3.2.7 보고 완료 후 수정 정책 (잠금 + 수정사유 + audit_log)

> 사용자 요구: “보고 완료된 보고의 경우 수정 시 수정 이력이 반드시 남도록.”

다음 3-요소를 함께 강제한다.

(a) **잠금 메타** — `work_plan_reports.status='submitted'` 또는 `merge_locked_at IS NOT NULL` 인 보고서는 “잠금 상태”로 간주.

(b) **잠금 상태 수정 권한** — 별도 권한 키 `work_plan.edit.locked` 가 있어야만 가능. 일반 `work_plan.edit` 만 있는 인원은 거부.

(c) **수정 사유 강제 + audit_log** — 잠금 상태 수정 API는 다음을 강제:

```sql
ALTER TABLE work_plan_items
  ADD COLUMN last_locked_edit_at      TIMESTAMPTZ,
  ADD COLUMN last_locked_edit_by      VARCHAR(32) REFERENCES users(user_id),
  ADD COLUMN last_locked_edit_reason  TEXT;
```

API `PATCH /api/work-plan/items/[itemId]` 가 잠금 행을 수정하려 할 때:
1. `hasPermission(user, 'work_plan.edit.locked', {dept_id})` 검사. 거부면 403.
2. 요청 body에 `reason` 필드 필수 (≥ 10자). 누락이면 400.
3. UPDATE 실행 + 위 3개 컬럼 갱신.
4. `audit_log` 에 `WORKPLAN_LOCKED_EDIT` 이벤트 + 변경 전/후 JSON + reason.
5. 같은 보고서의 작성자/부서장에게 알림 (`alerts.code='wp.locked-edit'`).

같은 패턴을 다른 도메인에도 적용 (admin이 “부서장” 템플릿에 어떤 도메인의 `*.edit.locked` 권한을 넣을지 선택):

| 잠금 도메인 | 잠금 조건 | edit.locked 권한 키 | reason 필수 컬럼 |
| --- | --- | --- | --- |
| 업무추진계획 | `merge_locked_at IS NOT NULL` 또는 `status='submitted'` | `work_plan.edit.locked` | `work_plan_items.last_locked_edit_*` |
| 전자결재 (기안 후) | `approval_documents.status` ≠ `draft` | `approval.edit.locked` | `approval_documents.last_locked_edit_*` |
| service_costs (정산서 결재 후 변경) | 결재 완료 상태 | `expense.edit.locked` | `service_costs.last_locked_edit_*` |
| service_evaluations (반기 마감 후) | `bonus_periods.status='locked'` | `staffing.evaluation.edit.locked` | `service_evaluations.last_locked_edit_*` |

> 잠금 해제(`*.lock_release`)는 위와 별도 권한. admin이 `is_dangerous=true` 권한이라 실제로 부여 시 재확인 모달.

#### 3.2.8 예시 시드 템플릿 3종

블루프린트 시드 스크립트(`scripts/seed_permission_templates.py`)에 들어갈 기본 3종. 변경은 admin UI에서 자유.

```yaml
- template_id: tpl-임원
  template_name: 임원
  is_system: true
  description: 대표이사·총괄본부장 등 전사 모든 보고/DB/결재 접근
  grants:
    - { permission_key: work_plan.view,                 scope_kind: all }
    - { permission_key: work_plan.edit.locked,          scope_kind: all }   # 단, 사유 강제는 동일 적용
    - { permission_key: approval.approve,               scope_kind: all }
    - { permission_key: approval.delegate,              scope_kind: all }
    - { permission_key: contract.view,                  scope_kind: all }
    - { permission_key: contract.edit,                  scope_kind: all }
    - { permission_key: staffing.view,                  scope_kind: all }
    - { permission_key: staffing.evaluation.read,       scope_kind: all }
    - { permission_key: bonus.view,                     scope_kind: all }
    - { permission_key: audit.read,                     scope_kind: all }

- template_id: tpl-부서장
  template_name: 부서장
  is_system: true
  description: 본인 소속 부서의 계약·보고·담당자·성과급 산정 내역 관리
  grants:
    - { permission_key: contract.view,                  scope_kind: self_dept }
    - { permission_key: business_contact.view,          scope_kind: self_dept }
    - { permission_key: business_contact.edit,          scope_kind: self_dept }   # 담당자 정보 수정 가능
    - { permission_key: work_plan.view,                 scope_kind: self_dept }
    - { permission_key: work_plan.edit,                 scope_kind: self_dept }
    - { permission_key: work_plan.merge,                scope_kind: self_dept }
    - { permission_key: work_plan.edit.locked,          scope_kind: self_dept }   # 사유 강제 + audit 자동
    - { permission_key: approval.approve,               scope_kind: self_dept }
    - { permission_key: staffing.view,                  scope_kind: self_dept }
    - { permission_key: staffing.changes.record,        scope_kind: self_dept }   # §6.6 인력 변동 기록
    - { permission_key: staffing.evaluation.write,      scope_kind: self_dept }   # §6.6 평점/참여도
    - { permission_key: bonus.view,                     scope_kind: self_dept }   # 부서 성과급 산정 내역 열람

- template_id: tpl-영업담당
  template_name: 영업담당
  is_system: false
  description: 영업관리본부 영업파트 일반 직원
  grants:
    - { permission_key: business_contact.view,          scope_kind: self_dept }
    - { permission_key: business_contact.edit,          scope_kind: self }
    - { permission_key: sales.activity.view,            scope_kind: self_dept }
    - { permission_key: sales.activity.edit,            scope_kind: self }
    - { permission_key: sales.bid.view,                 scope_kind: self_dept }
    - { permission_key: sales.bid.edit,                 scope_kind: self }
    - { permission_key: contract.view,                  scope_kind: self_dept }
    - { permission_key: work_plan.view,                 scope_kind: self_dept }
    - { permission_key: work_plan.edit,                 scope_kind: self }
```

> 위는 “권장 디폴트”이며, 실제 운영에서 admin 화면(§3.2.10)에서 항목을 자유롭게 가감.

#### 3.2.9 결재선 자동 라우팅과의 분리

- **결재선** = `positions.rank_order` + 부서 트리 + 금액 임계값 기반 (§5.3). RBAC 템플릿과 **독립**.
- 즉 “부서장 템플릿이 있어야 결재 가능”이 아니라, “직급 = 부서장이면 자동으로 결재선에 포함”. 권한 템플릿은 데이터 R/W만 통제.
- 단, `approval.approve` 권한이 없는 인원은 결재선에 포함되어도 실제 승인 액션 거부 (UI에서 [승인] 버튼 비활성).

#### 3.2.10 admin UI 라우트

| 라우트 | 화면 | 권한 |
| --- | --- | --- |
| `/admin/permissions` | 카탈로그 — module별 그룹, 검색, 시드 동기화 상태 | `rbac.template.manage` 또는 admin |
| `/admin/permissions/templates` | 템플릿 목록 (시스템/커스텀, is_active 토글) | `rbac.template.manage` |
| `/admin/permissions/templates/[id]` | 템플릿 편집기 — 권한 칩 추가/삭제, scope 선택 (라디오: self/self_dept/specific_dept/all), effect 토글, 미리보기(“이 템플릿이 부여하는 권한 N개”) | `rbac.template.manage` |
| `/admin/permissions/positions` | 직급-템플릿 매핑 — 신입 등록 시 자동 부여될 default | `rbac.template.manage` |
| `/admin/users/[id]/permissions` | 인원 권한 패널 — 활성 assignments 목록, [추가/취소/연장], scope override, “이 사람이 실제로 가진 atomic 권한 N개” 미리보기 | `rbac.assignment.manage` |
| `/admin/audit/permissions` | 모든 권한 변경 이력 (audit_log filter) | `audit.read` |

UI 동작 규칙:
- 템플릿 편집은 항상 “draft → 검토 → 적용” 2단계: 변경 전·후 diff 표시 후 admin 확인.
- `is_dangerous=true` 권한이 추가된 템플릿이 누구에게라도 적용되어 있으면 헤더에 경고 배지.
- 인원 패널의 [실제 권한 미리보기]는 §3.2.6 알고리즘을 시뮬레이션해서 atomic 키 + 결과 scope를 표로 보여줌 (디버깅/감사 핵심).

#### 3.2.11 audit_log 보강

`audit_log`(라운드 2A) 에 다음 이벤트 코드를 추가한다.

| event_code | 발생 조건 | 보존 정보 |
| --- | --- | --- |
| `RBAC_TEMPLATE_CREATE` / `_UPDATE` / `_DELETE` | 템플릿 변경 | template_id, before/after grants |
| `RBAC_ASSIGN` / `RBAC_REVOKE` | 인원 적용/해제 | user_id, template_id, scope, reason |
| `RBAC_CHECK_DENY` | 권한 검사 결과 명시적 deny (보안 모니터링) | user_id, permission_key, target, matching_grant |
| `WORKPLAN_LOCKED_EDIT` / `APPROVAL_LOCKED_EDIT` / `EXPENSE_LOCKED_EDIT` / `EVAL_LOCKED_EDIT` | 잠금 상태 수정 | reason, before/after JSON |
| `RBAC_LOCK_RELEASE` | 잠금 해제 권한 행사 | who, target, reason |

→ §3.2.10 의 `/admin/audit/permissions` 화면에서 위 코드 그룹을 필터.

#### 3.2.12 마이그레이션 노트

기존 §3.2 의 `role_grants` 테이블은 본 모델로 흡수된다. 1회성 마이그레이션 SQL 초안:

```sql
-- 1) 기존 role_grants 의 (module, scope, permissions) 조합별로 임시 템플릿 생성
-- 2) 동일 조합을 가진 user들을 같은 템플릿에 묶어 user_permission_assignments INSERT
-- 3) role_grants 는 1주 유예 후 DROP (백업용 export 1회)
```

스크립트 위치: `scripts/migrate_role_grants_to_templates.py`. 실행은 R-A 라운드 끝에서 1회. (자세한 단계별 수도 R-A 산출물에 포함.)

### 3.3 발표 모드 토큰

```sql
CREATE TABLE presentation_tokens (
  token        VARCHAR(64) PRIMARY KEY,             -- 32바이트 랜덤
  scope        VARCHAR(24) NOT NULL,                -- 'meeting:weekly' | 'meeting:exec'
  dept_id      VARCHAR(32),                         -- 부서 한정 토큰일 때
  expires_at   TIMESTAMPTZ NOT NULL,
  created_by   VARCHAR(32) NOT NULL REFERENCES users(user_id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at   TIMESTAMPTZ
);
```

`/meeting/{token}` 라우트는 미들웨어에서 토큰만 검증 후 read-only UI를 띄움. 마우스/키보드 미사용 자동 캐러셀.

### 3.4 사업장 담당자 마스터 (`business_contacts`)

영업활동·견적·입찰의 핵심 “누구를 만났는가”를 한 곳에 모은 마스터. 모바일 앱의 명함 자동 인식 결과가 들어오는 종착점이며, §4.10 영업활동 입력에서 검색·선택해서 재사용한다.

```sql
CREATE TABLE business_contacts (
  contact_id            VARCHAR(32) PRIMARY KEY,
  legal_entity_id       VARCHAR(32) REFERENCES legal_entities(entity_id),  -- 소속 법인 (없으면 NULL — 추후 매칭)
  facility_id           VARCHAR(32) REFERENCES facilities(facility_id),     -- 소속 사업장 (선택)
  full_name             VARCHAR(40) NOT NULL,
  job_title             VARCHAR(40),                                         -- '과장' | '팀장' | '환경안전팀장' …
  department            VARCHAR(60),                                         -- '환경안전팀' | '구매팀' …
  responsibility        TEXT,                                                -- 담당 업무 (자유)
  phone                 VARCHAR(40),
  mobile                VARCHAR(40),
  fax                   VARCHAR(40),
  email                 VARCHAR(120),
  address               TEXT,                                                -- 사무실 주소 (선택)
  -- 명함 인식
  card_image_storage_key TEXT,                                               -- 원본 명함 이미지 S3 키 (선택)
  ocr_raw_json          JSONB,                                                -- OCR 결과 원본 (필드 매핑 검수용)
  -- 메타
  preferred_lang        VARCHAR(8) DEFAULT 'ko',
  notes                 TEXT,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_by            VARCHAR(32) NOT NULL REFERENCES users(user_id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bc_entity   ON business_contacts(legal_entity_id);
CREATE INDEX idx_bc_facility ON business_contacts(facility_id);
CREATE INDEX idx_bc_name     ON business_contacts(full_name);
CREATE INDEX idx_bc_email    ON business_contacts(LOWER(email));
```

**중복 방지 전략**:
- 이메일/휴대폰이 모두 있는 경우 `(LOWER(email))` 또는 `(mobile)` 단독 매칭으로 dedup 후보 검출.
- 이름+법인 동일 시 “이미 등록된 담당자입니다 — 갱신하시겠습니까?” 모달.
- 모바일 명함 인식 시 `ocr_raw_json` 그대로 보관 → 추후 OCR 보정 학습 데이터로 사용.

**영업활동에서의 흐름**:

```
모바일 앱: 명함 촬영
  ↓ (OCR + 필드 매핑)
임시 저장 → 사용자 확인/수정 → POST /api/business-contacts (생성 또는 갱신)
  ↓
영업활동 입력 화면 (§4.10) 의 "담당자" 필드는 business_contacts 검색·선택형
  ↓
업무추진계획 작성 시 동일 담당자 재선택 가능 (입력 0회 추가)
```

권한:
- `editor+` 가 본인 부서/영업관리본부 한정 R/W.
- `viewer` 는 자기가 만난 담당자(자기가 created_by인 행)만 R, 그 외 행은 비공개.
- admin은 전사 R/W.

---

## 4. 업무추진계획 모듈 (전자보고)

### 4.1 현재 양식 진단 (참조파일 분석 결과)

| 양식 / 부서 | 데이터 형태 | 주 컬럼 | 표준화 난이도 |
| --- | --- | --- | --- |
| 통합2본부, 울산지사 | 사업장×용역 매트릭스 + 추진내역/추진계획 + 정·부담당 + 월별 마일스톤 | `사업장명 / 구분 / 계약기간 / 진행상황 / 추진내역(기간) / 추진계획(기간) / 관리자 / 정 / 부 / N년 N월(마일스톤)` | 낮음 (이미 구조화) |
| 화학안전본부 | 사업장×용역 + 참여자(총괄/메인) + 월별 마일스톤 | `사업장명 / 용역명 / 진행상황 / 총괄 / 메인 / N년 N월` | 낮음 |
| 도면관리 | 작업 단위 표 (`구분(완료/실행/보완) / 사업장명 / 지역 / 작업내용 / 담당자 / 진행현황 / 비고`) | 작업 단위 + 본부 매핑 | 중 |
| 영업·관리본부 | 자유 서술형 (`추진내용` / `예정사항` 카테고리) | 카테고리(영업/관리/총무/회계 등) + bullet | 중-상 |
| 탄소중립미래연구소 | 자유 서술형 (`추진실적` / `향후계획` bullet) | 부서 단일 + bullet | 상 |

진단:
- 모든 양식이 “**기간 보고 = (실적 + 계획)** + **누가** + **어디서/어느 용역**” 의 4요소로 환원 가능.
- 부서별 차이는 “행이 사업장 단위인가, 작업 단위인가, 영업 활동 단위인가, 자유 서술인가”의 **단위(unit) 선택** 차이일 뿐.
- → 표준 데이터 모델은 단 하나 (`work_plan_item`) + 부서별 기본 단위 선택 + 기본 컬럼 구성 (`form template`) 만 다르게.

### 4.2 표준 데이터 모델

```sql
CREATE TABLE work_plan_reports (
  report_id        VARCHAR(32) PRIMARY KEY,
  dept_id          VARCHAR(32) NOT NULL REFERENCES departments(dept_id),
  report_period    VARCHAR(24) NOT NULL,            -- 'weekly' | 'biweekly' | 'monthly'
  period_start     DATE NOT NULL,
  period_end       DATE NOT NULL,                   -- e.g. 2026-05-11 ~ 2026-05-22
  report_date      DATE NOT NULL,                   -- 보고 회의 일자 (e.g. 2026-05-18)
  meeting_type     VARCHAR(24) NOT NULL,            -- 'weekly' | 'exec_briefing'(간부간담회)
  template_id      VARCHAR(32) NOT NULL REFERENCES work_plan_templates(template_id),
  status           VARCHAR(16) NOT NULL DEFAULT 'draft',  -- 'draft' | 'submitted' | 'reviewed' | 'finalized'
  author_user_id   VARCHAR(32) NOT NULL REFERENCES users(user_id),
  reviewed_by      VARCHAR(32) REFERENCES users(user_id),
  finalized_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE work_plan_templates (
  template_id      VARCHAR(32) PRIMARY KEY,
  template_name    VARCHAR(80) NOT NULL,             -- '사업장×용역 (통합본부)', '작업 단위 (도면관리)', '영업·관리 카테고리', '자유 서술 (R&D)'
  unit_type        VARCHAR(24) NOT NULL,             -- 'service' | 'task' | 'category' | 'narrative'
  schema_json      JSONB NOT NULL,                   -- 항목별 필수/선택 컬럼 정의
  default_for_dept_id VARCHAR(32) REFERENCES departments(dept_id),
  is_active        BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE work_plan_items (
  item_id          VARCHAR(32) PRIMARY KEY,
  report_id        VARCHAR(32) NOT NULL REFERENCES work_plan_reports(report_id) ON DELETE CASCADE,
  display_order    INT NOT NULL,
  -- ▼ 4요소 (모든 어댑터 공통)
  category         VARCHAR(40),                      -- '영업' | '관리' | '실적' | '추진실적' | '향후계획' | '완료' | '실행' …
  subject_kind     VARCHAR(24) NOT NULL,             -- 'contract' | 'facility' | 'task' | 'sales' | 'bid' | 'admin_task' | 'free'
  contract_id      VARCHAR(32) REFERENCES contracts(contract_id),
  facility_id      VARCHAR(32) REFERENCES facilities(facility_id),
  subject_label    TEXT,                             -- 자유 서술 또는 캡션 (예: '단석산업 군산2공장 방문')
  -- ▼ 본문
  progress_text    TEXT,                             -- 추진내역(이번 주)
  plan_text        TEXT,                             -- 추진계획(다음 주)
  status_text      TEXT,                             -- 진행상황 (e.g. '계약완료', '용역완료')
  -- ▼ 용역 진행단계 (§4.9) — service-matrix 류 보고서에서 채움
  progress_stage     VARCHAR(40),                    -- '착수단계'|'자료수집'|'현장진단'|'계획서작성'|'사전협의'|'본협의'|'검토결과서작성'|'허가취득'|'사후관리'
  progress_pct       NUMERIC(5,2),                   -- 0~100, 단계 내 진행률
  key_dates_json     JSONB,                          -- [{label:'사전협의 제출', kind:'planned'|'confirmed', date:'2026-05-28', note:'…'}]
  -- ▼ 메타데이터 (참여 인력)
  manager_user_id      VARCHAR(32) REFERENCES users(user_id),  -- 관리자/총괄
  primary_user_id      VARCHAR(32) REFERENCES users(user_id),  -- 정 담당
  secondary_user_id    VARCHAR(32) REFERENCES users(user_id),  -- 부 담당
  participants_json    JSONB,                                  -- 자유롭게 추가된 참여자 [{userId, role}]
  milestones_json      JSONB,                                  -- [{period:'2026-05', label:'계약완료'}, …]
  remarks              TEXT,
  -- ▼ 외부 마스터 링크 (§4.10/§4.11) — 영업·관리 구조화 입력 시 사용
  linked_sales_activity_id VARCHAR(32) REFERENCES sales_activities(activity_id) ON DELETE SET NULL,
  linked_bid_record_id     VARCHAR(32) REFERENCES bid_records(bid_id) ON DELETE SET NULL,
  linked_admin_task_id     VARCHAR(32) REFERENCES admin_tasks(task_id) ON DELETE SET NULL,
  -- ▼ 1차/머지 워크플로우 (§4.8)
  author_user_id           VARCHAR(32) NOT NULL REFERENCES users(user_id),
  -- 항목을 직접 입력한 사람 (= 1차 보고에서는 용역 담당자)
  source_item_id           VARCHAR(32) REFERENCES work_plan_items(item_id) ON DELETE SET NULL,
  -- 부서장 머지 보고서의 경우 어느 1차 보고서 항목에서 복사·편집되었는지 추적
  item_status              VARCHAR(16) NOT NULL DEFAULT 'draft',
  -- 'draft' | 'submitted' | 'merged' | 'edited_by_dept_head'
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wpi_report ON work_plan_items(report_id);
CREATE INDEX idx_wpi_contract ON work_plan_items(contract_id);
CREATE INDEX idx_wpi_facility ON work_plan_items(facility_id);
CREATE INDEX idx_wpi_primary ON work_plan_items(primary_user_id);
CREATE INDEX idx_wpi_secondary ON work_plan_items(secondary_user_id);
CREATE INDEX idx_wpi_author ON work_plan_items(author_user_id);
CREATE INDEX idx_wpi_source ON work_plan_items(source_item_id);
CREATE INDEX idx_wpi_stage ON work_plan_items(progress_stage);
```

핵심 설계 포인트:

- **`subject_kind`로 단위 분기** — 한 보고서에 다른 단위 행이 섞일 수 있음 (예: 영업 카테고리 + 사업장 단위가 같이).
- **`contract_id` / `facility_id`는 강한 외래키** — 입력 시 자동완성 검색(MCM 기존 계약·사업장 마스터). 수기 자유 입력은 `subject_label`만 채움.
- **`milestones_json`** — 양식의 “25년 7월/8월” 같은 월별 칸은 자유 슬롯이 아니라 표준 milestone 객체로 저장. 통계 집계가 가능해짐.
- **`progress_stage` / `progress_pct` / `key_dates_json`** — 통합1·2본부, 울산지사, 화학안전본부 통합허가 진행단계 9종을 enum으로 표준화. 단계별 진행률과 단계별 주요일정(확정/예상)을 분리 입력. 자세한 내용 §4.9.
- **참여자(`primary_user_id` / `secondary_user_id` / `participants_json`)** — 이 컬럼이 §6 “사업참여수행인력 현황” 자동 갱신의 트리거.
- **외부 마스터 링크 (`linked_sales_activity_id` / `linked_bid_record_id` / `linked_admin_task_id`)** — 영업·관리 파트는 *행 자체*는 work_plan_items에 두되, 본문 데이터(견적 금액, 입찰 일정 등)는 별도 마스터 테이블에 두고 link만 함. 같은 영업 활동/입찰을 여러 주차에 걸쳐 진척 보고할 때 마스터는 1건이고 보고서 행은 N건이 되는 정상 모델.
- **1차/머지 (`author_user_id` / `source_item_id` / `item_status`)** — 용역 담당자가 자기 항목을 1차로 채워 `submitted` 하면, 부서장이 자기 보고서에서 그것을 import하면서 `source_item_id`를 채우고 필요 시 `item_status='edited_by_dept_head'`로 수정. 자세한 내용 §4.8.

### 4.2.1 영업활동 / 견적·입찰 / 관리 Task 마스터 (4종)

work_plan_items에서 link만 거는 4개 마스터 테이블.

```sql
-- (a) 영업활동 (텔마/방문/미팅 단위) ─ §4.10
CREATE TABLE sales_activities (
  activity_id          VARCHAR(32) PRIMARY KEY,
  legal_entity_id      VARCHAR(32) REFERENCES legal_entities(entity_id),    -- 영업 대상 법인
  facility_id          VARCHAR(32) REFERENCES facilities(facility_id),       -- 사업장 (선택)
  service_kind         VARCHAR(40) NOT NULL,
  -- '통합허가' | '화관법' | 'ESG·탄소중립' | '기타인허가' | …
  activity_kind        VARCHAR(24) NOT NULL,
  -- 'telemarketing' | 'site_visit' | 'meeting' | 'follow_up' | 'proposal_send'
  occurred_at          TIMESTAMPTZ NOT NULL,                                  -- 활동 일시
  duration_minutes     INT,                                                   -- 소요 시간 (선택)
  location             TEXT,                                                  -- 방문 장소 (선택)
  -- 주요 컨택 1명 + 추가 컨택 N명
  primary_contact_id   VARCHAR(32) REFERENCES business_contacts(contact_id),
  additional_contacts_json JSONB,                                              -- [{contactId, role}]
  -- 본문 (자유 서술)
  summary              TEXT NOT NULL,                                          -- 요지 (1~2줄)
  details              TEXT,                                                   -- 상세 내역
  -- 후속 조치
  next_action          TEXT,                                                   -- 다음 단계 메모
  next_action_due      DATE,
  outcome              VARCHAR(24) DEFAULT 'in_progress',
  -- 'in_progress' | 'quoted' | 'bidding' | 'won' | 'lost' | 'no_interest'
  -- 메타
  created_by           VARCHAR(32) NOT NULL REFERENCES users(user_id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sa_entity     ON sales_activities(legal_entity_id);
CREATE INDEX idx_sa_facility   ON sales_activities(facility_id);
CREATE INDEX idx_sa_occurred   ON sales_activities(occurred_at);
CREATE INDEX idx_sa_outcome    ON sales_activities(outcome);
CREATE INDEX idx_sa_kind       ON sales_activities(service_kind, activity_kind);

-- (b) 견적·입찰·낙찰 단위 (한 입찰 1행) ─ §4.10
CREATE TABLE bid_records (
  bid_id               VARCHAR(32) PRIMARY KEY,
  legal_entity_id      VARCHAR(32) REFERENCES legal_entities(entity_id),    -- 발주처
  facility_id          VARCHAR(32) REFERENCES facilities(facility_id),       -- (선택)
  service_kind         VARCHAR(40) NOT NULL,
  service_title        VARCHAR(200) NOT NULL,                                 -- 용역명 (공고문 그대로)
  -- 진행 단계
  bid_kind             VARCHAR(24) NOT NULL,
  -- 'quote_only' (단순 견적 제출) | 'bid' (입찰 응찰) | 'awarded' (낙찰) | 'lost' (탈락) | 'cancelled'
  -- 견적 단계
  quote_submitted_at   DATE,
  quote_amount_krw     BIGINT,
  -- 입찰 공고/일정 (bid_kind in ['bid','awarded','lost'])
  bid_notice_date      DATE,                                                  -- 입찰공고일
  bid_estimate_amount_krw BIGINT,                                             -- 공고상 용역 금액
  bid_classification   VARCHAR(40),                                           -- '수의계약' | '적격심사' | '일반경쟁' | '제한경쟁' | '협상에의한계약' …
  bid_open_at          TIMESTAMPTZ,                                           -- 입찰개시일시
  bid_close_at         TIMESTAMPTZ,                                           -- 입찰마감일시
  bid_unseal_at        TIMESTAMPTZ,                                           -- 개찰일시
  award_floor_pct      NUMERIC(5,2),                                          -- 낙찰하한선 (% — 활성화된 경우만)
  qualification_json   JSONB,
  -- 자격제한 요건 (자유 다중) [{kind:'license', label:'통합허가 대행업 등록'},
  --                          {kind:'company_size', label:'소기업/소상공인'},
  --                          {kind:'region', label:'경상북도 소재 기업 제한'}, …]
  -- 결과 (낙찰 / 탈락)
  awarded_at           DATE,
  award_amount_krw     BIGINT,                                                -- 낙찰 금액
  awarded_to_self      BOOLEAN,                                               -- 우리가 낙찰? true / 타사? false
  awarded_to_other     VARCHAR(120),                                          -- 타사 낙찰 시 회사명
  lost_reason          TEXT,                                                   -- 탈락 사유 (자유)
  -- 후속 계약 (낙찰 → contract 자동 생성 시 링크)
  resulting_contract_id VARCHAR(32) REFERENCES contracts(contract_id),
  -- 첨부
  notice_storage_key   TEXT,                                                   -- 공고문 PDF
  proposal_storage_key TEXT,                                                   -- 제출 제안서/견적서 PDF
  -- 담당
  primary_user_id      VARCHAR(32) REFERENCES users(user_id),                 -- 사내 담당
  primary_contact_id   VARCHAR(32) REFERENCES business_contacts(contact_id),  -- 발주처 담당
  -- 메타
  notes                TEXT,
  created_by           VARCHAR(32) NOT NULL REFERENCES users(user_id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_br_entity      ON bid_records(legal_entity_id);
CREATE INDEX idx_br_kind        ON bid_records(bid_kind);
CREATE INDEX idx_br_notice_date ON bid_records(bid_notice_date);
CREATE INDEX idx_br_award       ON bid_records(awarded_at);
CREATE INDEX idx_br_contract    ON bid_records(resulting_contract_id);

-- (c) 관리 Task ─ §4.11
CREATE TABLE admin_tasks (
  task_id              VARCHAR(32) PRIMARY KEY,
  task_name            VARCHAR(200) NOT NULL,                                 -- 업무명/프로젝트명
  task_category        VARCHAR(32) NOT NULL,
  -- '회계업무' | '용역입찰' | '인사업무' | '시스템개발' | '관리업무' | '총무' | '감사' | '기타'
  expected_from        DATE,
  expected_to          DATE,
  progress_stage       VARCHAR(24) NOT NULL DEFAULT 'planning',
  -- 'planning'(계획구상) | 'kickoff'(착수단계) | 'in_progress'(수행중) | 'rework'(보완단계) | 'completed'(완료단계) | 'reporting'(경과보고)
  progress_pct         NUMERIC(5,2),
  details              TEXT,                                                   -- 진행 상세 내역
  -- 담당
  owner_user_id        VARCHAR(32) NOT NULL REFERENCES users(user_id),
  collaborators_json   JSONB,                                                   -- [{userId, role}]
  -- 메타
  status               VARCHAR(16) NOT NULL DEFAULT 'open',
  -- 'open' | 'on_hold' | 'closed' | 'cancelled'
  closed_at            TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_at_owner    ON admin_tasks(owner_user_id);
CREATE INDEX idx_at_category ON admin_tasks(task_category);
CREATE INDEX idx_at_stage    ON admin_tasks(progress_stage);
CREATE INDEX idx_at_status   ON admin_tasks(status);
```

> **주의**: `work_plan_items`의 `linked_*` 외래키는 위 3개 테이블이 *먼저* 정의되어 있어야 한다. 마이그레이션은 “3개 마스터 → work_plan_items 컬럼 추가” 순서로 적용.

### 4.3 표준 양식 템플릿 (6종)

| template_id | unit_type | 대상 부서 (default_for_dept_id) | 컬럼 구성 |
| --- | --- | --- | --- |
| `tpl-service-matrix` | service | 통합1·2본부, 울산지사 | 사업장명* / 용역명(구분)* / 계약기간 / **진행단계 enum*** / **진행률(%)** / **주요일정(확정/예상)** / 추진내역* / 추진계획* / 관리자 / 정* / 부 / 월별 milestone |
| `tpl-chemsafe-matrix` | service | 화학안전본부 | 사업장명* / 용역명* / **진행단계 enum*** / **진행률(%)** / **주요일정** / 총괄 / 메인* / 월별 milestone |
| `tpl-task-matrix` | task | 도면관리 | 구분(완료/실행/보완)* / 사업장명* / 지역 / 작업내용* / 담당자* / 진행현황* / 비고 |
| **`tpl-sales-structured`** ★신규 | sales+bid | 영업·관리본부 (영업 파트) | 카테고리(영업활동/영업계획/견적제출/입찰응찰/낙찰결과)* + (영업활동·영업계획) 영업활동 마스터 link* + (견적/입찰/낙찰) 입찰 마스터 link* / 부속 메모 |
| **`tpl-admin-task`** ★신규 | admin_task | 영업·관리본부 (관리 파트) | 관리Task 마스터 link* / 보고시점의 진행단계 보충 / 부속 메모 |
| `tpl-category-bullets` | category | 탄소중립미래연구소 등 R&D | 카테고리(자유)* / bullet 항목 (`progress_text` / `plan_text` / `subject_label` 자유 입력) |

`*` = 필수.

> **구조화 강제 정도**:
> - `tpl-sales-structured`, `tpl-admin-task` 는 **마스터 link 없이는 행을 저장할 수 없음**. (작성자가 마법사에서 “신규 영업활동 등록” → 마스터 row 생성 → 보고서에 link 가 강제되는 흐름).
> - `tpl-service-matrix`, `tpl-chemsafe-matrix` 는 **`contract_id` + `progress_stage` 가 필수**. 자유텍스트만으로는 저장 불가.
> - `tpl-category-bullets` 는 R&D 특성상 자유서술 허용하되, 카테고리 enum과 `subject_label`은 필수.

`schema_json`은 컬럼 메타(라벨/타입/필수/UI hint/검증규칙)를 보관. 프론트는 이 스키마로 JIT 폼을 렌더하므로, 향후 신규 부서 양식이 추가돼도 코드 변경 없이 운영 화면에서 추가 가능.

#### 4.3.1 영업·관리 파트 카테고리 (tpl-sales-structured / tpl-admin-task)

| 부서/파트 | category enum (작성 시 선택) | 본문 입력 방식 |
| --- | --- | --- |
| 영업·관리본부 / 영업 | `영업활동`, `영업계획` | `linked_sales_activity_id` 필수 (§4.10 흐름) |
| 영업·관리본부 / 영업 | `견적제출`, `입찰응찰`, `낙찰결과` | `linked_bid_record_id` 필수 (§4.10 흐름) |
| 영업·관리본부 / 관리 | `회계업무`, `용역입찰`, `인사업무`, `시스템개발`, `관리업무`, `총무`, `감사`, `기타` | `linked_admin_task_id` 필수 (§4.11 흐름) |

이 4개 카테고리는 “이번 주 행” 자체를 자유텍스트로 새로 쓰는 게 아니라, **마스터에서 골라 진행분만 추가**하는 UX. 같은 영업활동/입찰/Task가 여러 주차에 걸쳐 보고되면, 보고서별 행은 늘어나지만 마스터는 1건만 유지된다 → 시계열 추적·과거 이력 검색이 자동으로 가능.

### 4.4 화면 / 라우트

> 권한 컬럼은 §3.2 권한 카탈로그의 atomic 키로 표기. “부서장” 등의 표현은 §3.2.8 시드 템플릿에 그 키들이 들어가 있다는 의미.

| 라우트 | 화면 | 필요 권한 (atomic key + scope) |
| --- | --- | --- |
| `/work-plan` | 부서별 최신 보고 목록 (필터: 부서/주차/상태/보고종류) | `work_plan.view` (self_dept 이상) |
| `/work-plan/new` | 신규 작성 마법사 (1) 부서·주차·템플릿·보고종류 자동 선택 → (2) 직전 보고 자동 복사 → (3) 항목 편집 | `work_plan.edit` (self) |
| `/work-plan/[reportId]` | 보고서 상세 (탭: 본문 / 변경이력 / 결재 / 첨부) | `work_plan.view` (self_dept) |
| `/work-plan/[reportId]/edit` | 인라인 편집 (잠금 미상태 행만) | `work_plan.edit` (작성자 self / 부서장 self_dept) |
| `/work-plan/[reportId]/edit?locked=1` | 잠금된 행 편집 — 사유 입력 모달 + audit_log (§3.2.7) | `work_plan.edit.locked` (self_dept 이상) |
| `/work-plan/[reportId]/merge` ★ | **부서장 머지 화면** — 같은 부서·주차의 1차 보고서들을 좌측 패널에 모아 우측 부서장 보고서로 import/편집 (§4.8) | `work_plan.merge` (self_dept) |
| `/work-plan/dashboard` | 부서별 진척률 / 미제출 / 지연 항목 KPI | `work_plan.view` (self_dept 이상) |
| `/meeting/[token]` | 발표 모드 (자동 캐러셀, 부서별 슬라이드, 큰 글씨) | 발표 토큰 (§3.3) |
| `/sales/contacts` ★ | 사업장 담당자 마스터 목록·검색·등록 (§3.4) | `business_contact.view` (self_dept) |
| `/sales/contacts/[id]` ★ | 담당자 상세·수정·이력 | `business_contact.edit` (self_dept) |
| `/sales/activities` ★ | 영업활동 목록 (필터: 법인/사업장/유형/기간/outcome) | `sales.activity.view` (self_dept) |
| `/sales/activities/new` ★ | 영업활동 신규 등록 — §4.10 | `sales.activity.edit` (self) |
| `/sales/activities/[id]` ★ | 영업활동 상세·수정 | `sales.activity.edit` (self / self_dept) |
| `/sales/bids` ★ | 견적·입찰·낙찰 목록 | `sales.bid.view` (self_dept) |
| `/sales/bids/new` ★ | 견적/입찰 신규 등록 마법사 — §4.10 | `sales.bid.edit` (self) |
| `/sales/bids/[id]` ★ | 입찰 상세 (공고문/제안서 첨부, 결과, 후속 contract 링크) | `sales.bid.edit` (self / self_dept) |
| `/admin-tasks` ★ | 관리 Task 목록 — §4.11 | `admin_task.view` (self_dept) |
| `/admin-tasks/new` ★ | Task 신규 등록 | `admin_task.edit` (self) |
| `/admin-tasks/[id]` ★ | Task 상세·진행 업데이트 | `admin_task.edit` (담당자 self / 부서장 self_dept) |

### 4.5 정규화 파이프라인 (자동 DB화)

`work_plan_reports.status`가 `submitted`로 바뀌는 순간 다음 잡이 트리거됨 (`POST /api/work-plan/[reportId]/normalize`).

1. `work_plan_items.contract_id`가 채워진 행 → `contract_progress_log`에 1건 INSERT.
   ```sql
   CREATE TABLE contract_progress_log (
     log_id          VARCHAR(32) PRIMARY KEY,
     contract_id     VARCHAR(32) NOT NULL REFERENCES contracts(contract_id),
     report_id       VARCHAR(32) NOT NULL REFERENCES work_plan_reports(report_id),
     item_id         VARCHAR(32) REFERENCES work_plan_items(item_id),
     period_start    DATE,
     period_end      DATE,
     progress_stage  VARCHAR(40),                                              -- 항목 시점 단계
     progress_pct    NUMERIC(5,2),
     key_dates_json  JSONB,
     progress_text   TEXT,
     plan_text       TEXT,
     status_text     TEXT,
     created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );
   ```
   → `/contracts/[id]` 상세에 “주간 추진경과 타임라인” + “단계별 진행률 차트” 자동 채움.
2. 참여자(`primary/secondary/participants_json`) → `service_participants` UPSERT (§6).
3. `milestones_json` → `contract_milestones_observed` UPSERT (관측치 집계용 — 기존 `contract_payment_milestones`와는 다른 “업무 마일스톤” 테이블).
4. `linked_sales_activity_id` 가 채워진 행 → `sales_activities.outcome` 자동 갱신 후보 (예: 영업활동에서 “quoted” 카테고리 행 처음 등장 시 outcome `quoted`로 제안).
5. `linked_bid_record_id` 가 채워진 행 + 카테고리 `낙찰결과` + `awarded_to_self=true` → 해당 `bid_records.resulting_contract_id` 채움 후보 알림 → 영업관리 admin이 `contracts`에 신규 row 생성 시 자동 연결 추천 (사람 검토 필요. §12-17 정책 결정 후 자동/수동 분기 확정).
6. `progress_stage = '허가취득'` 으로 처음 진입한 행 → `contracts.status` 를 `closed`(또는 `delivered`) 로 전환할지 admin 검토 큐에 적재.

정규화 잡은 멱등 (`(report_id, contract_id)` 복합키로 중복 방지) — 동일 보고서가 수정 후 재제출돼도 진행이력은 한 건만 유지·갱신.

### 4.6 미제출 / 알림

기존 `alerts`(라운드 3) 인프라 재사용:

| code | severity | 조건 |
| --- | --- | --- |
| `wp.missing` | warn | 보고일 D-day 18:00까지 부서 보고서 미제출 |
| `wp.no-progress` | info | 동일 contract_id가 3주 연속 `progress_text` 비어있음 |
| `wp.unassigned` | warn | 활성 계약(`contract_status='active'`) 중 어느 보고서에도 등장하지 않은 항목 ≥ 1건 |

`AlertBell` 사이드바 봉지에 합산 카운트 그대로 표시.

### 4.7 발표(Presentation) 모드

- 화면 비율 16:9 고정, 폰트 base 32pt, 헤딩 56pt.
- 좌상단 부서명 + 주차, 우상단 시계, 하단 페이지 N/M.
- 키보드 ←/→ 또는 30초 자동 전환 (옵션).
- “용역 클릭 → 우측 패널에 진행 타임라인” 같은 드릴다운은 발표 모드 *off*. 회의 중 산만 방지.
- TV가 인터넷 연결되지 않아도 동작하도록 PWA Cache 워밍 → 회의 시작 30분 전 한 번 전체 보고서 fetch & cache.

### 4.8 1차 보고 → 부서장 머지 워크플로우 (통합1·2본부, 울산지사, 화학안전본부)

> 통합1·2본부, 울산지사의 실제 운영 패턴을 모델링한다.
> 매주 금요일 부서 회의에서 **각 용역 담당자가 자기 용역의 1차 진행보고**를 발표하고, 부서장이 이를 취합·편집해 주간회의/간부간담회용 최종 보고를 만든다. 화학안전본부도 동일 모델로 운영(총괄·메인 구분 매트릭스 기반).

#### 4.8.1 보고서 종류 (`work_plan_reports.report_kind`)

`work_plan_reports`에 컬럼 1개 추가:

```sql
ALTER TABLE work_plan_reports
  ADD COLUMN report_kind        VARCHAR(24) NOT NULL DEFAULT 'dept_consolidated',
  -- 'staff_input'        : 용역 담당자 1차 보고 (개인 단위, 자기 용역만)
  -- 'dept_consolidated'  : 부서장 통합 보고 (부서 1건, 1차 보고들을 머지)
  -- 'meeting_briefing'   : 회의용 발표본 (옵션, 통합본을 가공)
  ADD COLUMN parent_report_id   VARCHAR(32) REFERENCES work_plan_reports(report_id) ON DELETE SET NULL,
  -- staff_input 행이 어느 dept_consolidated 로 머지되었는지 역추적용 (선택, 그 외에는 NULL)
  ADD COLUMN merge_locked_at    TIMESTAMPTZ;
  -- 부서장이 “머지 완료” 누르는 순간 staff_input 들의 추가 편집을 잠금 (이후 변경은 별도 사유 필요)
```

#### 4.8.2 워크플로우 5단계

```
[용역 담당자] (월~금)                    [부서장]                          [본부장/대표]
─────────────────                        ────────                            ───────────────

1) /work-plan/new
   report_kind=staff_input
   본인 contract_id의 행만 작성
   (progress_stage / progress_pct /
    key_dates / progress_text / plan_text)
   status=draft → submitted
        │
        ▼ (정규화 잡 발동, 대시보드 갱신)
2) 부서 회의 화면(/work-plan/dashboard?dept=…&kind=staff_input)
                                          ─────────────────
                                          금요일 회의 후
                                          /work-plan/[deptReportId]/merge
                                          좌: 부서원 staff_input 행 목록
                                          우: 부서장 dept_consolidated 보고
                                          [Import] / [Edit] / [Override]
                                          편집된 행은 item_status='edited_by_dept_head'
                                                │
                                                ▼
                                          status=submitted + merge_locked_at=now
                                                │
                                                ▼ (정규화 잡 → contract_progress_log)
                                                                              ──────────────
                                                                              주간회의/간부간담회
                                                                              /meeting/{token} 발표
```

#### 4.8.3 머지 화면 동작 규칙

- 좌측 패널: 같은 부서·주차의 `staff_input` 보고서 N건을 하나의 통합 리스트로 표시 (행 단위로 보임).
- 행을 [Import] 하면 `work_plan_items` 행이 **복제 INSERT** 되며 `source_item_id`가 원 행을 가리킴.
- 부서장이 우측에서 진행률·일정·서술을 수정 → `item_status` 가 자동으로 `edited_by_dept_head` 로 전이. UI에서 변경된 필드는 노란 배지로 시각화.
- 1차 보고에서 누락된 용역(부서장이 보기에 “이 용역은 있어야 하는데 빠졌다”)은 우측에서 직접 행 추가 — 이 경우 `source_item_id=NULL`, `author_user_id=부서장`.
- [머지 완료] 버튼 누르면:
  - dept 보고서 status `draft`→`submitted`
  - dept 보고서 `merge_locked_at` = now()
  - 머지된 staff_input 보고서들의 `item_status` 가 `merged` 로 일괄 갱신.
  - staff_input 들도 `merge_locked_at` 채움 — 이후 추가 편집은 *부서장 동의* 필요(워크플로우상).
- audit_log에 `WORKPLAN_MERGE` 이벤트 + 변경된 필드 diff 보존.

#### 4.8.4 권한·시야 (§3.2 권한 카탈로그 매핑)

| 역할 / 템플릿 | 필요 권한 키 (예시) | 동작 가능 범위 |
| --- | --- | --- |
| 용역 담당자 (일반 editor) | `work_plan.view` (self), `work_plan.edit` (self) | 자기 staff_input 보고서만 R/W. 같은 부서 동료의 staff_input은 dashboard 화면에서 read-only. |
| 부서장 (시드 템플릿 `tpl-부서장`) | `work_plan.view` (self_dept), `work_plan.edit` (self_dept), `work_plan.merge` (self_dept), `work_plan.edit.locked` (self_dept) | 같은 부서 staff_input 전체 R, dept_consolidated R/W, 머지 실행, 잠금 행 사유 첨부 후 편집. |
| 임원 (시드 템플릿 `tpl-임원`) | `work_plan.view` (all), `work_plan.edit.locked` (all, audit) | 전사 모든 보고서 R, 잠금 행도 사유 첨부 후 편집. |
| admin | `work_plan.lock_release` 등 전권 | 전부 R/W + 머지 잠금 해제. `is_dangerous` 권한이라 행사 시 audit_log + 재확인 모달. |
| 발표 모드 토큰 | (토큰 검증) | dept_consolidated 만 시청, staff_input 비노출. |

#### 4.8.5 도면관리·영업관리·R&D는?

- **도면관리**: 작업 단위가 작고 담당자 1명이 자기 표를 그대로 보고하는 패턴이라 1차/머지 분리 불필요. report_kind는 항상 `dept_consolidated`로 고정.
- **영업·관리본부**: 영업 파트의 영업활동·입찰 행은 *마스터 입력 시점에 이미 담당자가 직접 입력*하므로 1차 보고 단계가 자연스럽게 합쳐짐. report_kind=`dept_consolidated`로 부서장이 “이번 주 보고할 항목”을 마스터에서 골라 import. 별도 staff_input 보고서는 만들지 않음.
- **탄소중립미래연구소**: 인원이 작고 자유서술이라 동일하게 dept_consolidated 단일.

### 4.9 용역 진행단계 enum 및 주요일정 모델

#### 4.9.1 진행단계 enum (통합허가 9단계)

통합1·2본부, 울산지사 (`tpl-service-matrix`) 와 화학안전본부 (`tpl-chemsafe-matrix`) 의 `progress_stage` 가 가질 수 있는 9개 값:

| 코드 (DB) | 라벨 | 일반 진행률 가이드 | 비고 |
| --- | --- | --- | --- |
| `kickoff` | 착수단계 | 0~5% | 계약 발주처 컨택, 킥오프 미팅 |
| `data_collect` | 자료수집 | 5~25% | 사업장 도면·인허가·운전자료 수집 |
| `site_diagnosis` | 현장진단 | 25~40% | 현장 실측, 환경기초 진단 |
| `plan_drafting` | 계획서작성 | 40~60% | 통합환경계획서 초안 |
| `pre_consult` | 사전협의 | 60~75% | 인허가청 사전협의서 제출·답변 |
| `main_consult` | 본협의 | 75~85% | 본협의 신청 후 보완·답변 |
| `review_report` | 검토결과서작성 | 85~92% | 검토결과서 보완·확정 |
| `permit_acquired` | 허가취득 | 95~100% | 허가증 수령 — 사실상 완료 |
| `post_mgmt` | 사후관리 | 100% (continuing) | 허가 후 모니터링·연차보고 |

> 진행률은 **단계 절대값이 아닌, 단계 내 백분율**. UI는 “단계 칩 + 단계 내 진행바” 두 단으로 시각화. (예: `pre_consult` 칩 + 50% 바 ⇒ 사전협의 절반 진행)
>
> 화학안전본부는 화관법 업무가 추가될 수 있어 별도 enum 후보 검토 — 현재 양식상 같은 9단계로 표현 가능하나, 나중에 ‘위해관리계획서 작성’ 같은 단계가 필요하면 `progress_stage` enum을 부서별로 분기할 수 있도록 `template_id` 별 허용 enum 리스트를 `work_plan_templates.schema_json` 에 보관 (UI 검증).

#### 4.9.2 주요일정 모델 (`key_dates_json`)

`work_plan_items.key_dates_json` 에 다음 형태로 저장:

```json
[
  { "label": "사전협의 제출",          "stage": "pre_consult",   "kind": "confirmed", "date": "2026-05-28" },
  { "label": "본협의 답변 예상",        "stage": "main_consult",  "kind": "planned",   "date": "2026-06-15", "note": "6월 중순" },
  { "label": "허가취득 예정",          "stage": "permit_acquired", "kind": "planned", "date": "2026-08-31" }
]
```

필드 의미:
- `kind` = `'confirmed'`(확정) | `'planned'`(예상) | `'overdue'`(연체 자동 마킹) | `'achieved'`(이미 달성).
- `stage` 가 채워지면 그 단계의 마일스톤으로 묶이며, dashboard·발표 모드에서 단계별 그룹핑 표시.
- 날짜 정밀도는 “일” 단위 권장. “6월 중순” 같은 모호한 표현은 `date` 필드를 그 달 15일로 두고 `note` 에 원문 보존.

#### 4.9.3 dashboard·집계

- `/contracts/[id]` 상세에 “단계 칩 + 진행바” + “주요일정 타임라인” 섹션을 자동 채움 (위 `contract_progress_log` 사용).
- `/work-plan/dashboard` 에서 부서별 `progress_stage` 분포(파이 차트) + 평균 progress_pct.
- `key_dates_json` 의 `kind='planned'` 이면서 date < today 인 항목 → 자동 `wp.overdue` 알림 (§4.6 보강 — 추가 코드).

추가 alert 코드:

| code | severity | 조건 |
| --- | --- | --- |
| `wp.overdue` | warn | `key_dates_json` 의 `planned` 일정이 today 를 넘김에도 stage 미진입 |
| `wp.stage-stale` | info | 동일 contract_id 의 `progress_stage` 가 4주 이상 같은 값으로 고정 |
| `wp.staff-missing` | warn | (1차/머지 운영 부서) 금요일 12:00까지 staff_input 미제출 |

### 4.10 영업 파트 구조화 입력 (영업·관리본부 영업)

#### 4.10.1 영업활동·영업계획 (sales_activities)

작성 마법사 4단계:

1. **업체 선택** — `legal_entities` 검색 (한글명/사업자번호/별칭). 없으면 [+ 신규 업체 등록] 모달 (이름, 사업자번호, 사업장주소, 영업담당자 메모) → `legal_entities` 신규 row.
2. **사업장 선택** *(선택)* — 해당 법인 산하 `facilities` 목록에서 선택, 없으면 [+ 신규 사업장 등록].
3. **활동 정보** — `service_kind` (통합허가/화관법/ESG·탄소중립/기타인허가/etc), `activity_kind` (telemarketing/site_visit/meeting/follow_up/proposal_send), `occurred_at`, `duration_minutes`, `location`.
4. **담당자 + 본문** — `business_contacts` 검색·선택·신규등록(§3.4). 추가 컨택 N명. `summary`(필수), `details`, `next_action`, `next_action_due`, `outcome`.

영업계획(`category='영업계획'`)은 미래 시점의 sales_activities 행. `occurred_at`을 미래 시각으로 두고 `outcome='in_progress'` 상태로 저장. 실제 발생 후 “실시 보고로 전환” 버튼 누르면 outcome 갱신.

#### 4.10.2 견적·입찰·낙찰 (bid_records)

작성 마법사는 `bid_kind` 에 따라 분기:

- **`quote_only` (단순 견적 제출)** — 발주처/사업장/용역명/제출일/견적금액/제출 PDF/담당자.
- **`bid` (입찰 응찰)** — 위 + 입찰공고일/공고 용역금액/`bid_classification`/`bid_open_at`/`bid_close_at`/`bid_unseal_at`/`award_floor_pct` (체크박스로 활성화)/`qualification_json` (다중 칩 선택형: ‘통합허가 대행업 등록’, ‘소기업/소상공인’, ‘지역제한: 경상북도 소재 기업’ 등 — 자유 추가도 가능).
- **`awarded` / `lost`** — 결과 입력. `awarded`이면 `awarded_to_self` 토글 + `award_amount_krw` + (자사일 경우) `resulting_contract_id` 추후 링크 후보 자동 생성. `lost`이면 `awarded_to_other`(타사명, 자유) + `lost_reason`.
- **`cancelled`** — 발주처가 입찰 취소/유찰. 사유는 `notes`에 자유.

#### 4.10.3 업무추진계획 보고서에서의 활용

업무추진계획 작성 시 `tpl-sales-structured` 템플릿이 선택되면, 항목 추가 모달은 다음 두 단계로 동작:

1. 카테고리 선택 (`영업활동/영업계획/견적제출/입찰응찰/낙찰결과`).
2. 마스터 검색 — 영업활동 또는 입찰 마스터에서 “이번 주 보고할 항목”을 멀티선택. 선택된 마스터 행마다 `work_plan_items` 1행이 자동 생성되며 link 컬럼만 채움.
3. 행별 ‘이번 주 진척 메모’ 자유텍스트(progress_text/plan_text)만 추가 입력.

이 흐름으로 “견적 제출했던 건이 다음 주 입찰 응찰 → 다음 주 낙찰”로 진행될 때, 매주 동일 마스터를 골라 단계만 갱신하면 자동으로 시계열 이력이 쌓인다 (`bid_records` 1건 + 보고서 행 N건).

#### 4.10.4 검색·재사용

- `/sales/activities?facility_id=…&service_kind=통합허가` 로 “이 사업장에 우리가 통합허가 영업한 이력” 한번에 조회.
- `/sales/bids?legal_entity_id=…&bid_kind=awarded` 로 “이 회사 발주처에서 우리가 낙찰받은 입찰” 조회 → 향후 영업제안서 작성 시 자료원.
- `/sales/contacts?legal_entity_id=…` 로 “이 회사 우리쪽 컨택 풀” 조회 → 신규 영업활동 작성 시 담당자 후보 자동 노출.

#### 4.10.5 모바일 명함 자동인식 연동 (향후)

- 모바일 앱: 명함 촬영 → OCR → 임시 폼 → 사용자 확인/수정 → `POST /api/business-contacts`.
- OCR 후보 보정에 `ocr_raw_json` 보존 → 동일 사용자 명함 재촬영 시 `email`/`mobile` 매칭으로 dedup.
- 영업활동 작성 시 “최근 인식 명함” 섹션이 `business_contacts` 검색 결과 상단에 노출.

### 4.11 관리 파트 Task 관리 (영업·관리본부 관리)

#### 4.11.1 admin_tasks 운영

- `/admin-tasks` 칸반 보드 (열: `planning / kickoff / in_progress / rework / completed / reporting`) 또는 표 토글.
- Task 생성 시 필수: `task_name`, `task_category`, `owner_user_id`. 권장: `expected_from`, `expected_to`, `details`.
- `progress_stage` 변경은 자체 audit_log 이벤트 + `admin_task_progress_log` 시계열 기록(아래) 자동 생성.

```sql
CREATE TABLE admin_task_progress_log (
  log_id          VARCHAR(32) PRIMARY KEY,
  task_id         VARCHAR(32) NOT NULL REFERENCES admin_tasks(task_id) ON DELETE CASCADE,
  changed_by      VARCHAR(32) NOT NULL REFERENCES users(user_id),
  prev_stage      VARCHAR(24),
  new_stage       VARCHAR(24) NOT NULL,
  prev_pct        NUMERIC(5,2),
  new_pct         NUMERIC(5,2),
  comment         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_atpl_task ON admin_task_progress_log(task_id);
```

#### 4.11.2 업무추진계획 보고서에서의 활용

`tpl-admin-task` 템플릿:
- 항목 추가 모달 = `admin_tasks` 마스터 멀티선택.
- 선택된 Task 별로 `work_plan_items` 행 1건 자동 생성, `linked_admin_task_id` 채움.
- 행별 보고시점 진척 메모(progress_text/plan_text)만 추가 입력. Task 마스터의 `progress_stage` 와 보고서 시점 stage가 다르면 “마스터 갱신할까요?” 인라인 제안.

#### 4.11.3 재사용·통계

- 같은 Task가 여러 주차에 걸쳐 보고되면 `admin_task_progress_log` 와 `work_plan_items` 양쪽으로 시계열 추적 가능.
- `/admin-tasks/dashboard`: 카테고리별 진행단계 분포, owner별 부하, 평균 stale 일수.

---

## 5. 전자결재 (자체 그룹웨어) 모듈

### 5.1 문서 종류 (Document Kinds)

| document_kind | 약어 | 설명 | 비용성 | 용역 태깅 |
| --- | --- | --- | --- | --- |
| `business-trip` | 출장 | 국내·해외 출장 신청 + 결과보고 | O | 필수 (기 계약 / 미 계약 택1, §5.1.1) |
| `overtime` | 초과근무 | 평일/휴일 초과근무 신청 | O | 필수 (기 계약 / 미 계약 택1) |
| `leave` | 휴가 | 연차/반차/병가/공가 | △ (대체비용만) | 선택 |
| `expense-claim` | 지출결의 | 영수증/카드/현금 정산 | O | 필수 (기 계약 / 미 계약 택1) |
| `purchase-request` | 구매요청 | 자재·소모품·외주 발주 요청 | O | 필수 (기 계약 / 미 계약 택1) |
| `outsourcing-contract` | 외주계약 | 협력사 외주 신청 | O | **필수 (기 계약만)** — 외주는 계약 체결 후 발생 가정 |
| `general-approval` | 일반품의 | 위 분류에 안 맞는 자유 결재 | △ | 선택 |
| `report-finalize` | 보고서 결재 | 업무추진계획 / 용역 결과보고서 등 | X | 선택 |

#### 5.1.1 “기 계약 건” vs “미 계약 건” 양식 분기

비용성 문서의 기안 폼 첫 번째 필드는 **계약 여부 토글**이다. 둘 중 정확히 하나만 활성화된 상태로 결재 진행이 가능하다.

| 토글 값 | 입력 필드 | DB 매핑 |
| --- | --- | --- |
| `contracted` (기 계약 건) | `contract_id` 검색·선택 (필수) | `approval_documents.contract_link_kind='contract'` + `contract_id` |
| `prospect` (미 계약 건) | `prospect_facility_label`(사업장명, 필수, facility 검색 후 자동완성 가능) + `prospect_service_title`(용역명, 가칭 허용, 필수) + `prospect_legal_entity_id`(발주처 법인, 선택) + `linked_sales_activity_id`(있으면 link) + `linked_bid_record_id`(있으면 link) + `prospect_kind`(`sales_visit` / `presentation` / `proposal_prep` / `bid_prep` / `etc`, 필수) | `approval_documents.contract_link_kind='prospect'` + 위 컬럼들 |

> 영업활동/입찰 마스터(§4.10)가 있다면 link 권장 — 영업활동 발생 → 출장 신청 시 “기존 영업활동에서 가져오기” 단축버튼 노출 → `prospect_facility_label`/`prospect_service_title`/`prospect_legal_entity_id`가 자동 prefill.

**미 계약 비용의 격리 원칙**:
- 결재 완료 시점에 자동 적재되는 행은 `service_costs`(기 계약)와 `prospect_costs`(미 계약) **두 곳으로 갈라진다** (§5.4.2).
- 원가 집계(§7)에서 “계약별 손익”에는 `service_costs`만 합산. `prospect_costs`는 별도 “영업·제안 비용 풀” 대시보드로 노출.
- 추후 미 계약 건이 실제 계약으로 전환되면 admin이 매칭 화면에서 “이 prospect 묶음 → 신규 contract”를 1-click 흡수 (§5.4.3).

### 5.2 데이터 모델

```sql
CREATE TABLE approval_documents (
  document_id              VARCHAR(32) PRIMARY KEY,
  document_kind            VARCHAR(32) NOT NULL,             -- 위 표의 kind
  doc_no                   VARCHAR(32) UNIQUE NOT NULL,      -- 'BT-2026-00123' 식 자동 채번
  title                    VARCHAR(200) NOT NULL,
  body_json                JSONB NOT NULL,                   -- kind별 폼 데이터
  drafter_user_id          VARCHAR(32) NOT NULL REFERENCES users(user_id),
  drafter_dept_id          VARCHAR(32) NOT NULL REFERENCES departments(dept_id),
  status                   VARCHAR(16) NOT NULL DEFAULT 'draft',
  -- draft | submitted | in_progress | approved | rejected | withdrawn
  current_step_no          INT NOT NULL DEFAULT 0,
  -- ▼ 용역 태깅 (D-05 수정안)
  contract_link_kind       VARCHAR(16),                       -- 'contract' | 'prospect' | NULL(비용성 아님)
  contract_id              VARCHAR(32) REFERENCES contracts(contract_id),
  -- (link_kind='prospect' 일 때 채워지는 필드)
  prospect_kind            VARCHAR(24),                       -- 'sales_visit' | 'presentation' | 'proposal_prep' | 'bid_prep' | 'etc'
  prospect_facility_label  VARCHAR(200),                      -- 사업장명 (자유 입력 또는 facility 매칭 캡션)
  prospect_facility_id     VARCHAR(32) REFERENCES facilities(facility_id),  -- 매칭되면 link
  prospect_service_title   VARCHAR(200),                      -- 용역명 (가칭 허용)
  prospect_legal_entity_id VARCHAR(32) REFERENCES legal_entities(entity_id),
  linked_sales_activity_id VARCHAR(32) REFERENCES sales_activities(activity_id) ON DELETE SET NULL,
  linked_bid_record_id     VARCHAR(32) REFERENCES bid_records(bid_id) ON DELETE SET NULL,
  -- prospect → contract 전환 추적
  prospect_resolution_state VARCHAR(16),
  -- NULL(미해결) | 'won' (계약 체결 후 흡수 완료) | 'lost' (실패) | 'cancelled' (자체 철회)
  resolved_contract_id     VARCHAR(32) REFERENCES contracts(contract_id),
  resolved_at              TIMESTAMPTZ,
  resolved_by              VARCHAR(32) REFERENCES users(user_id),
  -- ▼ 일관성 보장 CHECK
  CONSTRAINT chk_contract_link CHECK (
    contract_link_kind IS NULL
    OR (contract_link_kind = 'contract'
        AND contract_id IS NOT NULL
        AND prospect_facility_label IS NULL
        AND prospect_service_title IS NULL)
    OR (contract_link_kind = 'prospect'
        AND contract_id IS NULL
        AND prospect_facility_label IS NOT NULL
        AND prospect_service_title IS NOT NULL
        AND prospect_kind IS NOT NULL)
  ),
  -- ▼ 기존 메타
  total_cost_krw           BIGINT,                            -- 비용 합계 (집계 캐시)
  effective_from           DATE,
  effective_to             DATE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at             TIMESTAMPTZ,
  finalized_at             TIMESTAMPTZ
);

CREATE INDEX idx_ad_contract       ON approval_documents(contract_id) WHERE contract_id IS NOT NULL;
CREATE INDEX idx_ad_prospect_state ON approval_documents(prospect_resolution_state) WHERE contract_link_kind = 'prospect';
CREATE INDEX idx_ad_prospect_fkey  ON approval_documents(prospect_facility_id)
  WHERE prospect_facility_id IS NOT NULL;

CREATE TABLE approval_lines (
  line_id          VARCHAR(32) PRIMARY KEY,
  document_id      VARCHAR(32) NOT NULL REFERENCES approval_documents(document_id) ON DELETE CASCADE,
  step_no          INT NOT NULL,                     -- 1, 2, 3 …
  approver_user_id VARCHAR(32) NOT NULL REFERENCES users(user_id),
  role_label       VARCHAR(24) NOT NULL,             -- 'reviewer' | 'approver' | 'final'
  required         BOOLEAN NOT NULL DEFAULT TRUE,
  state            VARCHAR(16) NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | skipped
  comment          TEXT,
  acted_at         TIMESTAMPTZ,
  UNIQUE (document_id, step_no, approver_user_id)
);

CREATE TABLE approval_attachments (
  attach_id        VARCHAR(32) PRIMARY KEY,
  document_id      VARCHAR(32) NOT NULL REFERENCES approval_documents(document_id) ON DELETE CASCADE,
  display_name     VARCHAR(200) NOT NULL,
  storage_key      TEXT NOT NULL,                    -- S3 또는 로컬 storage 경로 (기존 contract_documents 와 같은 storage 추상화 사용)
  byte_size        BIGINT NOT NULL,
  mime             VARCHAR(80),
  uploaded_by      VARCHAR(32) REFERENCES users(user_id),
  uploaded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE approval_routes (
  route_id         VARCHAR(32) PRIMARY KEY,
  route_name       VARCHAR(80) NOT NULL,
  document_kind    VARCHAR(32) NOT NULL,
  dept_scope       VARCHAR(32),                      -- NULL = 전사
  amount_min       BIGINT,
  amount_max       BIGINT,                           -- 금액별 결재선 분기
  steps_json       JSONB NOT NULL,                   -- [{stepNo:1, role:'직속상사'}, {stepNo:2, role:'본부장'}, …]
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 5.3 결재선 자동 라우팅

기안자가 “문서 종류 + 부서 + 금액(있을 때)” 입력 → 시스템이 `approval_routes`에서 매칭되는 1건 선택 → `steps_json`을 부서 트리로 해석해 실제 사용자(`approver_user_id`)로 펼침.

펼치는 규칙(예시):

| steps_json[].role | 해석 |
| --- | --- |
| `직속상사` | 기안자 부서의 `position.rank_order`가 한 단계 위인 사람 |
| `팀장` | 기안자 부서가 `team`이면 그 부서 head |
| `본부장` | 부서 트리 거슬러 올라가 `dept_kind='division'` 부서의 head |
| `대표이사` | 전사 한정 단일 사용자 |
| `대표이사*` | 별표가 있으면 “금액 ≥ X일 때만 추가”의 조건부 단계 |

기안자가 결재선을 임의 수정하려면 `dept_head` 이상 권한 + “결재선 수정 사유” 필수.

### 5.4 비용 정산 (용역 태깅)

비용성 문서(`business-trip`, `overtime`, `expense-claim`, `purchase-request`, `outsourcing-contract`)는 **결재 완료 시점**에 `contract_link_kind`에 따라 **두 갈래로 적재**된다.

#### 5.4.1 기 계약 비용 — `service_costs`

```sql
CREATE TABLE service_costs (
  cost_id          VARCHAR(32) PRIMARY KEY,
  contract_id      VARCHAR(32) NOT NULL REFERENCES contracts(contract_id),
  source_kind      VARCHAR(32) NOT NULL,             -- 'business-trip' | 'overtime' | 'expense-claim' | 'purchase' | 'outsourcing' | 'manual'
  source_doc_id    VARCHAR(32),                      -- approval_documents.document_id (manual 입력 시 NULL)
  user_id          VARCHAR(32) REFERENCES users(user_id),  -- 비용 귀속 인원 (출장자/근무자/지출자)
  occurred_on      DATE NOT NULL,                     -- 발생일 (출장일자/근무일자 등)
  category         VARCHAR(40) NOT NULL,             -- '교통비' | '숙박비' | '식대' | '수당-주말' | '수당-야간' | '용역수수료' | '소모품' | …
  amount_krw       BIGINT NOT NULL,
  memo             TEXT,
  -- (D-05 수정안) prospect → contract 흡수 추적
  absorbed_from_prospect_cost_id VARCHAR(32),         -- prospect_costs.prospect_cost_id (있으면 흡수 출처)
  absorbed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- audit
  posted_by        VARCHAR(32) NOT NULL REFERENCES users(user_id)  -- 결재 최종 승인자 또는 수기 입력자
);

CREATE INDEX idx_sc_contract ON service_costs(contract_id);
CREATE INDEX idx_sc_user_date ON service_costs(user_id, occurred_on);
CREATE INDEX idx_sc_source ON service_costs(source_kind, source_doc_id);
CREATE INDEX idx_sc_absorbed ON service_costs(absorbed_from_prospect_cost_id) WHERE absorbed_from_prospect_cost_id IS NOT NULL;
```

#### 5.4.2 미 계약 비용 — `prospect_costs`

`approval_documents.contract_link_kind='prospect'` 인 결재가 완료되면 cost 행은 본 테이블로 들어간다. 컬럼 구성은 `service_costs`와 거의 동일하되 contract_id 대신 prospect 식별자.

```sql
CREATE TABLE prospect_costs (
  prospect_cost_id        VARCHAR(32) PRIMARY KEY,
  -- prospect 식별 (approval_documents 와 동일 의미)
  prospect_facility_label VARCHAR(200) NOT NULL,
  prospect_facility_id    VARCHAR(32) REFERENCES facilities(facility_id),
  prospect_service_title  VARCHAR(200) NOT NULL,
  prospect_legal_entity_id VARCHAR(32) REFERENCES legal_entities(entity_id),
  prospect_kind           VARCHAR(24) NOT NULL,
  -- 'sales_visit' | 'presentation' | 'proposal_prep' | 'bid_prep' | 'etc'
  linked_sales_activity_id VARCHAR(32) REFERENCES sales_activities(activity_id) ON DELETE SET NULL,
  linked_bid_record_id     VARCHAR(32) REFERENCES bid_records(bid_id) ON DELETE SET NULL,
  -- (이하 service_costs와 동일)
  source_kind     VARCHAR(32) NOT NULL,
  source_doc_id   VARCHAR(32) NOT NULL REFERENCES approval_documents(document_id),
  user_id         VARCHAR(32) REFERENCES users(user_id),
  occurred_on     DATE NOT NULL,
  category        VARCHAR(40) NOT NULL,
  amount_krw      BIGINT NOT NULL,
  memo            TEXT,
  -- 흡수 / 손실 추적
  resolution_state VARCHAR(16) NOT NULL DEFAULT 'pending',
  -- 'pending'(아직 contract 미결정) | 'absorbed'(특정 contract로 흡수됨) | 'written_off'(영업비용 처리, 해당 prospect_kind=lost) | 'cancelled'
  absorbed_to_contract_id  VARCHAR(32) REFERENCES contracts(contract_id),
  absorbed_to_cost_id      VARCHAR(32) REFERENCES service_costs(cost_id),
  resolved_at              TIMESTAMPTZ,
  resolved_by              VARCHAR(32) REFERENCES users(user_id),
  -- audit
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  posted_by       VARCHAR(32) NOT NULL REFERENCES users(user_id)
);

CREATE INDEX idx_pc_facility ON prospect_costs(prospect_facility_id) WHERE prospect_facility_id IS NOT NULL;
CREATE INDEX idx_pc_legal_entity ON prospect_costs(prospect_legal_entity_id) WHERE prospect_legal_entity_id IS NOT NULL;
CREATE INDEX idx_pc_state ON prospect_costs(resolution_state);
CREATE INDEX idx_pc_sales_activity ON prospect_costs(linked_sales_activity_id) WHERE linked_sales_activity_id IS NOT NULL;
CREATE INDEX idx_pc_bid ON prospect_costs(linked_bid_record_id) WHERE linked_bid_record_id IS NOT NULL;
```

#### 5.4.3 핵심 흐름

(a) **기 계약 출장**:
1. 출장 신청서 — 토글 `contracted` + `contract_id` 선택 + 출장자 N명 + 일자/지역/예상비용 → 기안.
2. 결재 완료 → 출장자별로 `service_costs`에 (교통비/숙박비/식대 또는 출장수당) 자동 분할 적재.
3. 출장 후 “정산서” 결재(`expense-claim`)가 같은 `body_json.parent_doc_id`로 들어오면 `service_costs` 예상비용 행을 실비로 갱신 (`*.edit.locked` 권한 적용 + audit).

(b) **미 계약 출장** (예: 영업 사업장 방문, 현장설명회 참석):
1. 출장 신청서 — 토글 `prospect` + `prospect_facility_label` + `prospect_service_title` + `prospect_kind='sales_visit'` (선택: `linked_sales_activity_id`) → 기안.
2. 결재 완료 → `prospect_costs` 에 행 적재 (`resolution_state='pending'`).
3. `service_costs` 에는 들어가지 않음 → 계약별 손익 KPI 미오염.
4. 같은 prospect로 후속 결재(예: 제안서 준비 초과근무)가 추가되면 같은 `(prospect_facility_label, prospect_service_title)` 키로 묶여 dashboard에 누적 표시.

(c) **미 계약 → 계약 전환 (흡수)**:
1. 영업이 실제로 계약 체결되어 `contracts`에 신규 row 생성.
   - 자동 추천: `bid_records.bid_kind='awarded' AND awarded_to_self=true` 인 입찰의 `resulting_contract_id` 채움 시 (§4.5 정규화) — 같은 facility/legal_entity의 `prospect_costs` 후보 묶음을 함께 추천.
2. admin/부서장이 `/expense/prospects/[bucket]` 화면에서 “이 prospect 묶음 → 신규 contract” 1-click 흡수.
3. 시스템 동작:
   - 각 `prospect_costs` 행에 대해 `service_costs` 신규 행 INSERT (contract_id = 신규 계약, `absorbed_from_prospect_cost_id` 채움).
   - `prospect_costs.resolution_state='absorbed'` + `absorbed_to_contract_id` + `absorbed_to_cost_id` + `resolved_at`/`_by` 갱신.
   - `approval_documents.prospect_resolution_state='won'` + `resolved_contract_id` 갱신.
   - 모든 변경은 `audit_log` `EXPENSE_PROSPECT_ABSORB` 이벤트 1행 + before/after JSON.

(d) **미 계약 → 손실 처리 (write-off)**:
1. 입찰 탈락(`bid_records.bid_kind='lost'`) 또는 영업 무산이 확정되면 admin이 `/expense/prospects` 에서 “손실 처리”.
2. `prospect_costs.resolution_state='written_off'` + `resolved_at`/`_by` + 사유.
3. 회계 매핑: `cost_center='SALES_LOSS'` 또는 회사 회계 규정상 “영업비용” 코드로 month-end export. (§7.3 회계 코드 매핑 참조)
4. 성과급 산정 시 `service_costs.source_kind='sales'` 의 “영업비용 차감”으로 **포함** 가능 — §6.7 의 `bonus_applicable_amounts` 산식에 반영 (§13.1 매핑 참조). 단 회사 정책에 따라 “부서별 풀”에서만 차감하는 옵션 (§12-#27).

(e) **수당 계산** — `compensation_rules` 테이블에 회사 규정 보관 (직급별 일당, 야근수당 시급, 휴일수당 배율 등). 규정 변경 이력도 함께. 기 계약/미 계약 무관하게 동일 적용.

#### 5.4.4 권한 / 잠금

- 일반 결재 완료 행은 `*.edit.locked` 권한 + 사유 강제로만 수정 (§3.2.7).
- 흡수(absorb) 액션은 `expense.prospect.absorb` 권한 (시드 템플릿 `tpl-부서장`/`tpl-임원`에 self_dept/all 포함). admin은 항상 가능.
- 손실 처리(`write_off`)는 `expense.prospect.writeoff` 권한 — 회계/관리 담당 별도 템플릿(`tpl-회계담당`)에 부여 권장. `is_dangerous=true`.

### 5.5 화면 / 라우트

| 라우트 | 화면 |
| --- | --- |
| `/approval` | 내 결재함 (탭: 결재대기/기안중/완료/반려) |
| `/approval/new/[kind]` | 종류별 기안 폼 (`business-trip`, `overtime`, …). 비용성 kind는 첫 단계에서 **계약 여부 토글** (기 계약 / 미 계약) — §5.1.1 |
| `/approval/[id]` | 상세 + 결재선 + 첨부 + 댓글 + (prospect 인 경우) 미흡수 상태 배너 |
| `/approval/[id]/act` | 결재 승인/반려 모달 |
| `/expense` | 비용 대시보드 (개인) — 내 출장/근무/지출 누적, 용역별 분포 + “미 계약 비용” 카드 |
| `/expense/by-contract/[id]` | 용역별 비용 내역 (관리자 전용) |
| `/expense/prospects` ★ | 미 계약 비용 풀 — facility/legal_entity/(linked_sales_activity\|linked_bid_record) 단위로 자동 그룹핑 (bucket), 합계·기간·관련 영업활동 |
| `/expense/prospects/[bucket]` ★ | 단일 prospect 묶음 상세 — 포함된 prospect_costs 행 list, 관련 sales_activities/bid_records, [신규 contract로 흡수] / [기존 contract로 흡수] / [손실 처리] 액션 |
| `/expense/dashboard` | 전사 비용 KPI (월별·부서별·용역별·카테고리별) + “영업·제안 비용 풀(prospect)” 별도 카드 (계약별 손익과 합산되지 않음) |

bucket 자동 그룹핑 규칙 (`/expense/prospects`):
1. `linked_bid_record_id` 가 같은 행끼리 묶음 (입찰 단위).
2. 1번이 없고 `linked_sales_activity_id` 가 같은 행끼리 묶음.
3. 둘 다 없으면 `(prospect_legal_entity_id, prospect_service_title)` 정규화 문자열로 묶음.
4. 위 키가 모두 NULL/모호하면 `(prospect_facility_label, prospect_service_title)` 로 묶음.

### 5.6 외부 그룹웨어와의 차별 포인트

본 자체 그룹웨어는 시중 SW와 달리 다음 4가지를 1급 시민으로 다룬다.

1. **모든 비용성 결재의 “계약 여부 양식 분기 + 용역 태깅” 강제** (§5.1.1) — 기 계약은 `contract_id`, 미 계약은 사업장명+용역명+(영업활동/입찰 link). 단순 결재 SaaS가 못 따라가는 핵심.
2. **출장·근무 인원 → 자동으로 §6 사업참여수행인력 currnt 갱신** — 별도 양식 입력 불필요.
3. **결재 완료 = 회계 코드 + 용역 코드 동시 태깅** — 추후 ERP/회계 연동의 변환비용 0.
4. **결재선이 부서 트리 기반 동적 routing** — 인사이동 즉시 반영, 결재선 수기 관리 0.

---

## 6. 사업참여 수행인력 모듈 (`/staffing`)

> 기존 `사업참여수행인력 현황(수행인력 업데이트).xlsx` + 데스크톱 “수행인력 자동입력” 앱을 웹으로 흡수.
> 메뉴는 “계약관리와는 별개”이지만 데이터는 100% 계약(`contracts`) + 사용자(`users`) 마스터 참조.

### 6.1 메뉴 위치

사이드바 (`(app)/layout.tsx`) 카테고리:

```
업무 보고
├─ 업무추진계획
├─ 결재함
└─ 비용 결재
사업 운영
├─ 계약 / 영업    (기존)
├─ 사업장        (기존)
├─ 사업참여 수행인력  ★ 신규
└─ 다운로드/증명서
```

→ 메뉴 아이콘은 “사람×계약” 모티프 (예: Lucide `users-cog`).

### 6.2 데이터 모델

```sql
CREATE TABLE service_participants (
  participation_id    VARCHAR(32) PRIMARY KEY,
  contract_id         VARCHAR(32) NOT NULL REFERENCES contracts(contract_id),
  user_id             VARCHAR(32) NOT NULL REFERENCES users(user_id),
  role_label          VARCHAR(40) NOT NULL,         -- '관리자' | '정' | '부' | '실무' | '품질검토' | …
  task_label          TEXT,                          -- '담당업무' (자유)
  field_label         VARCHAR(40),                  -- '대기' | '수질' | '폐기물' | '소음진동' | '비산배출' | '화관법' …
  participated_from   DATE,                          -- 수행기간 시작
  participated_to     DATE,                          -- 수행기간 종료 (NULL = 진행중)
  contribution_pct    NUMERIC(5,2),                 -- 인력 투입률 (선택)
  source              VARCHAR(24) NOT NULL DEFAULT 'manual',
  -- 'manual' | 'work_plan' | 'approval'  → §4.5 / §5.4 자동 갱신 출처 추적
  source_ref          VARCHAR(64),                  -- 출처 ID (work_plan_items.item_id 또는 approval_documents.document_id)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (contract_id, user_id, role_label)
);

CREATE INDEX idx_sp_user ON service_participants(user_id);
CREATE INDEX idx_sp_contract ON service_participants(contract_id);
```

### 6.3 자동 갱신 로직

| 트리거 | 동작 |
| --- | --- |
| 업무추진계획 항목의 `primary_user_id` 채워짐 | `(contract_id, user_id, '정')` UPSERT, `source='work_plan'` |
| 업무추진계획 항목의 `secondary_user_id` 채워짐 | `(contract_id, user_id, '부')` UPSERT |
| 업무추진계획 항목의 `manager_user_id` 채워짐 | `(contract_id, user_id, '관리자')` UPSERT |
| 출장 결재 승인 (`business-trip` + `contract_id` + 출장자 N명) | 출장자 각각에 대해 `(contract_id, user_id, '실무')` UPSERT (이미 다른 role로 존재하면 skip) |
| 외주계약 결재 승인 | (외부인력은 별도 테이블 `external_participants` — 동일 스키마 + `entity_id` 외부 회사) |

`participated_from`은 첫 등장한 보고서의 `period_start`, `participated_to`는 가장 최근 등장한 보고서의 `period_end`. 행이 90일 동안 등장하지 않으면 시스템이 자동 “종료 후보”로 마크 (수기 확정 필요).

### 6.4 화면 / 라우트

| 라우트 | 화면 |
| --- | --- |
| `/staffing` | 용역×사람 매트릭스 (행: 활성 계약, 열: 정/부/관리자/실무) |
| `/staffing/by-person/[userId]` | 한 사람의 참여 이력 (계약별 기간/역할/담당업무) → 실적증명서 자동입력 소스 |
| `/staffing/by-contract/[contractId]` | 한 계약의 참여 이력 (역할별 인원, 기간 차트) |
| `/staffing/import` | 기존 엑셀 한 번 import (관리자 1회성) — 마이그레이션용 |

### 6.5 다운로드 / 증명서 (HWPX→PDF→병합)

기존 `roster_generator_app.py` + `pdf_merger.py` + `generate_roster_pdfs.py`를 backend(Python) 워커로 이식.

`/contracts/[id]/downloads` 또는 `/staffing/by-contract/[id]` 화면에서 “실적증명자료 ZIP” 버튼 → 다음 스택을 묶어서 다운로드:

1. **수행인력 명단 HWPX → PDF** (참여자 6명 슬롯 기준, `service_participants` 자동 fill).
2. **실적증명서 HWPX → PDF** (계약명/금액/기간/발주처 자동 fill).
3. **계약서 PDF** (`contract_documents.document_type='contract'` 최신본).
4. **계산서 PDF** (`contract_invoices.document_id` 의 PDF 모두).

병합 순서는 사용자 토글 가능. 기본값: 실적증명서 → 명단 → 계약서 → 계산서.

#### 6.5.1 처리 분리: AWS 직접 처리 vs 사내 Windows 워커

HWPX 표준(OWPML)은 ZIP + XML 컨테이너이므로 한컴 COM은 “HWPX→PDF 변환” 단 한 단계에만 필요하다. 따라서 처리 단계를 다음과 같이 명확히 분리한다.

| 단계 | 처리 위치 | 구현 |
| --- | --- | --- |
| ① HWPX 템플릿 로드 + 필드 토큰 치환 | **AWS Linux** | 기존 `_replace_hwpx_tokens()` 로직을 `backend/app/staffing/hwpx_renderer.py` 로 포팅. `zipfile` + `lxml`/`xml.etree.ElementTree` 만 사용. |
| ② 명단·실적증명서 HWPX 생성 | **AWS Linux** | `service_participants` / `contracts` / `legal_entities` 데이터로 토큰 채움. |
| ③ HWPX → PDF 변환 | **사내 Windows 워커** (잡 큐 pull) | 한컴 COM `hwp.SaveAs(..., 'PDF')` 호출. |
| ④ 계약서 PDF + 계산서 PDF 병합 | **AWS Linux** | 기존 `pdf_merger.py` 로직을 `backend/app/staffing/pdf_merger.py` 로 포팅. `pypdf` 사용. |
| ⑤ 최종 ZIP 패키징 + 다운로드 URL 발급 | **AWS Linux** | S3(또는 사내 storage) 업로드 후 presigned URL 발급. |

**핵심**: 사용자가 “실적증명자료 ZIP” 클릭 시 AWS는 ①②④⑤를 즉시 동기로 처리하고, ③만 잡 큐에 넣은 뒤 “PDF 변환 대기 중” 상태로 응답. 워커가 켜져 있는 시점에 변환되며, 완료 시 알림(라운드 3 `alerts` 인프라)으로 사용자에게 통지.

#### 6.5.2 잡 큐 (HWPX→PDF 전용)

기존 `aws-job-queue.ts` 패턴 그대로 재사용 + 다음 테이블 추가.

```sql
CREATE TABLE roster_render_jobs (
  job_id            VARCHAR(32) PRIMARY KEY,
  contract_id       VARCHAR(32) NOT NULL REFERENCES contracts(contract_id),
  document_kind     VARCHAR(24) NOT NULL,            -- 'roster' | 'performance_certificate' | 'roster+cert'
  hwpx_storage_key  TEXT NOT NULL,                   -- 입력 HWPX (AWS가 ①②에서 만들어 업로드한 객체)
  pdf_storage_key   TEXT,                            -- 결과 PDF (워커가 ③ 후 업로드)
  status            VARCHAR(16) NOT NULL DEFAULT 'queued',
  -- 'queued' | 'picked_up' | 'rendering' | 'done' | 'failed'
  attempts          INT NOT NULL DEFAULT 0,
  last_error        TEXT,
  requested_by      VARCHAR(32) NOT NULL REFERENCES users(user_id),
  requested_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  picked_up_at      TIMESTAMPTZ,
  picked_up_by      VARCHAR(80),                     -- 워커 호스트네임
  completed_at      TIMESTAMPTZ
);

CREATE INDEX idx_rrj_status_req ON roster_render_jobs(status, requested_at);
```

**워커(사내 Windows PC) 동작**:

1. 5~30초 주기로 `SELECT ... WHERE status='queued' ORDER BY requested_at LIMIT 1 FOR UPDATE SKIP LOCKED`.
2. 잡 가져오면 `status='picked_up'`, `picked_up_by=<hostname>`, `picked_up_at=NOW()` UPDATE.
3. S3에서 입력 HWPX 다운로드 → `hwp.Open()` → `hwp.SaveAs(pdf_path, 'PDF')` → S3 업로드.
4. 성공: `pdf_storage_key`, `status='done'`, `completed_at=NOW()` UPDATE.
5. 실패: `attempts += 1`, `last_error=...`, `status='failed'` (3회 초과 시) UPDATE.
6. 완료 알림은 AWS 측에서 `roster_render_jobs.status` 변화를 polling 또는 트리거로 감지해 `alerts` 테이블에 INSERT (severity `info` for done, `error` for failed).

**워커 24/7 가동 불필요**:
- 잡은 영속(persisted)되어 워커가 꺼져 있는 동안 큐에 누적될 뿐 손실되지 않음.
- 사용자는 “PDF 준비 완료” 알림을 받은 시점에 다운로드. 즉시 다운로드가 필요한 경우 워커 트레이만 켜면 즉시 처리됨.
- 권장: Windows 시작 프로그램에 워커 등록(부팅 시 자동 시작) → 절전 시 자연 정지, 깰 때 자동 재개.

#### 6.5.3 fallback: 클라우드 단독 변환 (선택, 후순위)

사내 워커가 장기 부재(휴가·점검) 시를 대비해 AWS Linux에서 다음 fallback을 시도할 수 있다.

```
HWPX → (h2orestart 확장 + LibreOffice headless) → ODT/PDF
또는
HWPX → (h2orestart) → DOCX → (LibreOffice headless) → PDF
```

명단처럼 단순한 표는 충분히 변환 품질이 나오는 경우가 많지만 — 복잡한 한글 도장/필드/표 구조에서는 레이아웃이 깨질 수 있어 **검수 후 수동 재처리** 정책 필요. 본 라운드(R-F)에서는 워커 우선, fallback은 후속 라운드 후보로 보류.

#### 6.5.4 보안 / 운영 메모

- 사내 워커는 IAM 사용자 1개 발급 → S3 read/write + Aurora `roster_render_jobs` 전용 권한만 부여 (least privilege).
- 워커 PC가 회사 내부망이면 AWS와의 연결은 NAT Gateway / Outbound HTTPS만 허용.
- 입력 HWPX, 출력 PDF는 S3 SSE-KMS 암호화. presigned URL TTL은 15분.
- 같은 잡을 여러 워커가 가져가지 않도록 `FOR UPDATE SKIP LOCKED` 패턴 사용 (PostgreSQL 9.5+).

#### 6.5.5 마감일/완료 판정 — 미완료 용역 제외 로직

기존 데스크톱 앱이 “수행인력 현황 시트 G열(용역 마감일)이 빈값/'진행중'이면 병합에서 제외”하던 로직은 웹에서는 다음으로 대체:

```
완료 판정 = contract_status = 'completed'
            OR (ended_at IS NOT NULL AND ended_at <= today)
            OR contract_payment_milestones 마지막 단계가 collected
```

이 중 어느 것도 만족 못 하면 `merge_skipped` 사유 “용역 미완료”로 결과 리포트(`merge_results`) 에 남김.

### 6.6 인력 변동 이력 + 평점·참여도 (본부장 권한)

> **배경**: 한 용역의 참여 인원이 수행기간 동안 그대로 유지되는 경우는 드물고, 중간에 교체·이탈·합류가 발생함. 회사의 성과급은 *반기 단위*로 산정되므로 “해당 반기 동안 누가 얼마의 비율로 참여했는가”가 정확히 기록돼야 한다. 이 기록은 본부장(통합환경1·2본부장, 울산지사장, 화학안전본부장 등)의 권한으로만 확정 가능하며, admin도 수정 가능.

#### 6.6.1 데이터 모델

§6.2의 `service_participants`는 “현재 누가 참여 중인가”의 *스냅샷*만 들고 있다. 변동·평점·참여도는 다음 3개 테이블로 분리한다.

```sql
-- 1) 변동 이벤트 로그 (불변 append-only)
CREATE TABLE service_participation_changes (
  change_id           VARCHAR(32) PRIMARY KEY,
  contract_id         VARCHAR(32) NOT NULL REFERENCES contracts(contract_id),
  user_id             VARCHAR(32) NOT NULL REFERENCES users(user_id),
  change_kind         VARCHAR(16) NOT NULL,
  -- 'join'(합류) | 'leave'(이탈) | 'role_change' | 'replace'(교체)
  effective_on        DATE NOT NULL,                    -- 변동 발효일 (본부장이 직접 입력)
  role_label_before   VARCHAR(40),                      -- 'role_change'/'replace' 시 직전 역할
  role_label_after    VARCHAR(40),                      -- 'join'/'role_change'/'replace' 시 신규 역할
  replaced_user_id    VARCHAR(32) REFERENCES users(user_id),
  -- 'replace'의 짝: A가 B로 교체될 때 A의 leave 이벤트의 replaced_user_id = B,
  --               B의 join 이벤트의 replaced_user_id = A (양방향 링크)
  reason              TEXT,                             -- 변경 사유 (자유 입력, 예: '담당업무 재조정', '퇴사', '부서이동')
  -- audit
  recorded_by         VARCHAR(32) NOT NULL REFERENCES users(user_id),
  -- 본부장 또는 admin (RBAC §6.6.3)
  recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_spc_contract_eff ON service_participation_changes(contract_id, effective_on);
CREATE INDEX idx_spc_user_eff     ON service_participation_changes(user_id, effective_on);

-- 2) 기간(스팬)별 참여 비율 (반기 평가용)
CREATE TABLE service_participation_spans (
  span_id             VARCHAR(32) PRIMARY KEY,
  contract_id         VARCHAR(32) NOT NULL REFERENCES contracts(contract_id),
  user_id             VARCHAR(32) NOT NULL REFERENCES users(user_id),
  role_label          VARCHAR(40) NOT NULL,             -- 정/부/관리자/실무 …
  span_from           DATE NOT NULL,                    -- 변동 효력일에서 산출
  span_to             DATE,                             -- NULL = 현재까지
  participation_pct   NUMERIC(5,2) NOT NULL,            -- 0~100, 같은 (contract_id, span_from~to) 안에서 합 100% 권장 (강제는 아님 — 본부장이 의도적으로 110% 등 설정 가능)
  recorded_by         VARCHAR(32) NOT NULL REFERENCES users(user_id),
  recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- generated: changes 이벤트로부터 자동 빌드되며, 본부장이 수동 보정 가능
  is_auto_built       BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (contract_id, user_id, role_label, span_from)
);

CREATE INDEX idx_sps_contract_span ON service_participation_spans(contract_id, span_from, span_to);
CREATE INDEX idx_sps_user_span     ON service_participation_spans(user_id, span_from, span_to);

-- 3) 반기별 평점 (본부장 직접 입력)
CREATE TABLE service_evaluations (
  evaluation_id       VARCHAR(32) PRIMARY KEY,
  contract_id         VARCHAR(32) NOT NULL REFERENCES contracts(contract_id),
  user_id             VARCHAR(32) NOT NULL REFERENCES users(user_id),
  period_year         INT NOT NULL,                     -- 2025
  period_half         VARCHAR(2) NOT NULL,              -- 'H1' | 'H2'
  participation_pct   NUMERIC(5,2) NOT NULL,            -- 반기 평균 참여도 (보통 spans에서 가중평균 자동 계산되지만 본부장 override 가능)
  rating              NUMERIC(4,2) NOT NULL,            -- 평점 (0.0 ~ 5.0 또는 회사 규정에 맞춰 0~10/0~100)
  rating_memo         TEXT,                             -- 평가 코멘트 (선택)
  -- audit
  rated_by            VARCHAR(32) NOT NULL REFERENCES users(user_id),
  rated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_at        TIMESTAMPTZ,                      -- 반기 마감 후 잠금
  UNIQUE (contract_id, user_id, period_year, period_half)
);

CREATE INDEX idx_se_period   ON service_evaluations(period_year, period_half);
CREATE INDEX idx_se_user     ON service_evaluations(user_id, period_year, period_half);
CREATE INDEX idx_se_contract ON service_evaluations(contract_id, period_year, period_half);
```

#### 6.6.2 자동 빌드 vs 수동 보정

`service_participation_spans`는 두 가지 입력원으로 채워진다.

| 입력원 | 동작 | 본부장 보정 가능? |
| --- | --- | --- |
| 자동 — `service_participation_changes` 이벤트 시퀀스 | 사건이 추가/수정될 때마다 해당 contract의 span 행을 재계산하여 `is_auto_built=true`로 갱신 | O — 본부장이 수동 편집하면 `is_auto_built=false`로 잠금되어 자동 재계산에서 제외 |
| 자동 — §4.5 업무추진계획 제출 | `(contract_id, user_id, role_label)`이 *이미 존재하는 자동 span* 안에 들어오면 span_to를 미래로 연장 | O |

본부장이 수동 보정한 span은 `is_auto_built=false`로 표시되어 추후 변동 이벤트가 추가돼도 그 행은 건드리지 않는다 (자동/수동 충돌 방지).

#### 6.6.3 권한 매트릭스 (변동·평점·참여도)

§3.2 권한 카탈로그(permissions)에 다음 키를 시드한다. 그리고 “부서장” 권한 템플릿(§3.2.8)에 기본 포함.

| 동작 | 필요 atomic 권한 | scope_kind |
| --- | --- | --- |
| 본인 참여 이력 조회 | `staffing.view` | `self` |
| 같은 부서 다른 사람 참여 이력 조회 | `staffing.view` | `self_dept` |
| **`service_participation_changes` INSERT/UPDATE** (인력 변동 기록) | `staffing.changes.record` | `self_dept` (대상 contract.owning_dept_id 매칭) |
| **`service_participation_spans` 수동 보정** | `staffing.changes.record` | `self_dept` |
| **`service_evaluations` 평점·참여도 입력** | `staffing.evaluation.write` | `self_dept` |
| 평점 열람 (반기 마감 후) | `staffing.evaluation.read` | `self_dept` (부서장) / `all` (임원) |
| `service_evaluations.finalized_at` 설정 (반기 마감) | `bonus.calc.run` | `all` (admin only — `is_dangerous=true`) |
| 마감된 평점 수정 (잠금 상태) | `staffing.evaluation.edit.locked` (사유 강제, audit_log 자동, §3.2.7) | `all` (admin) |

권한 검사 시 “자기 부서 contract 인지”는 §3.2.6 알고리즘이 `target.dept_id = contracts.owning_dept_id` 로 평가. 따라서 통합1본부장 템플릿이 통합1본부 contract만 자동으로 허용된다.

자기 부서 판정 기준: `contracts.facility.region_*`이 아니라 `contracts.contract_id`가 어느 본부의 “담당 본부”인지를 결정해야 한다 (한 계약은 본부장 평가 시 단 1명의 본부장에게 귀속). 이를 위해:

```sql
ALTER TABLE contracts
  ADD COLUMN owning_dept_id VARCHAR(32) REFERENCES departments(dept_id);
-- 통합환경허가 1본부 / 통합환경허가 2본부 / 울산지사 / 화학안전본부 / 탄소중립미래연구소 / 영업관리본부 …
```

`owning_dept_id`는 다음 우선순위로 자동 추정 + admin 보정 가능:

1. 업무추진계획 보고서에서 가장 자주 등장하는 부서 (`work_plan_reports.dept_id`).
2. 1번이 비어 있으면 매니저(`manager_user_id`)의 `users.dept_id`.
3. 2번도 없으면 admin이 수동 지정 (검수 큐에 노출).

#### 6.6.4 화면 / 라우트

| 라우트 | 화면 | 권한 (atomic key — §3.2 템플릿에 부여) |
| --- | --- | --- |
| `/staffing/by-contract/[id]` | 우측 패널에 “수행인력 변동 타임라인” 추가 (가로 시간축, 인원별 색띠로 span 시각화) | `staffing.view` (self_dept 이상) |
| `/staffing/by-contract/[id]/changes` | 변동 이벤트 등록 모달 (`change_kind` + `effective_on` + `replaced_user_id` + `reason`) | `staffing.changes.record` (self_dept) |
| `/staffing/by-contract/[id]/spans` | 자동 빌드된 span 목록 + 셀 인라인 편집 (수동 보정) | `staffing.changes.record` (self_dept) |
| `/staffing/evaluations/[year]/[half]` | 본부장 평가 입력 보드 (행: 자기 부서 활성 계약 × 참여자, 열: 참여도 / 평점 / 코멘트) | `staffing.evaluation.write` (self_dept) |
| `/staffing/evaluations/[year]/[half]/lock` | 반기 마감 (`finalized_at` 설정) | `bonus.calc.run` (admin only) |

타임라인 시각화는 D3 SVG 직접 렌더 (라운드 3 OperationsPanel 패턴 재사용). 추가 차트 라이브러리 도입 X.

#### 6.6.5 자동/수동 동작 규칙 요약

- 업무추진계획 또는 출장 결재로 등장한 신규 인원 → `change_kind='join'` 이벤트 자동 생성 (`recorded_by='system'`, 본부장이 사후 검토).
- 같은 자동 흐름에서 인원 N주 이상 미등장 → `change_kind='leave'` 후보 생성 (`status='proposed'`) 검수 큐 노출, 본부장이 효력일을 확정해야만 `service_participation_spans`에 반영.
- 본부장이 수동으로 입력한 변동은 즉시 효력.
- 모든 변경은 `audit_log`에 1행 INSERT (`action='participation_change' | 'participation_span_edit' | 'evaluation_set'`).

---

### 6.7 성과급 산정 모듈 (블루프린트 별책)

> **위치**: 본 메뉴는 *계약·영업 관리 앱(MCM)에는 직접 노출되지 않는다*. 사용자 요구대로 별도 앱(자체 그룹웨어 + 회계관리)에 구현되며, 본 MCM의 DB(`contracts`, `contract_payment_milestones`, `contract_invoices`, `service_participation_*`, `service_evaluations`, `service_costs`)를 read-only로 참조한다.
> 별도 앱이지만 데이터 계약(스키마 / API / 권한)은 본 블루프린트에서 함께 결정해야 일관성이 깨지지 않으므로 본 절에서 정의한다.

#### 6.7.1 현행 엑셀(`성과급 산정.xlsm`) 구조 분석 결과

| 시트 그룹 | 시트 | 핵심 컬럼 |
| --- | --- | --- |
| **(A) 대상액 산정** | `성과급 대상액 산정(통합)` (83 cols) / `(기타)` / `(화관법)` / `(HAPs)` / `(연구소)` | 용역명, 발주처, 계약일, 시작일, 마감일 / 단계별 금액(선급금·중도금1~7·준공금) / 용역금액·외주금액·도면작성·영업비용(공제) / 단계별 금액(제비용 반영) / 발행일자 / 금기 발행금액 / 경과기간(반기) / 보정비율 적용 / 본부구분 / 적용금액 |
| **(B) 용역별 개인 평점** | `용역별 개인 평점(통합허가)` (21 cols) / `(기타)` (18) / `(화관법)` (21) / `(HAPs)` (21) | 용역명·발주처·계약일·기간 / 적용여부 / 본부 / 관리자 / **참여자1~4 + 비율 + 평점** / 적용대상액 |
| **(C) 개인별 산정 결과** | `25년 하반기 개인별 성과급.xlsx` 의 `통합허가 개인별 성과산정액` 등 | 매출 기여총액 / (참고) 기간 내 급여액 / **성과산정액1 (기존, 차감 없음)** ← *유일하게 사용* / (이하 시나리오는 사용 안 함) |
| **(D) 본부장 별 산정** | `통합허가 개인별 성과산정액` 우측 영역 / `성과급 총괄표` | 본부장 본부 매출 합계 × **본부 비율** (통합1 13% / 통합2 15% / 울산지사 5% / 화학안전 별도 …) |
| **(E) 도면팀 산정** | `성과급산정(도면팀)` | 용역별 “도면부문 지분(원)” × 4% 기준 — 별도 산식 |
| **(F) 개인별 상세 시트** | `한도경` / `한상순` / `배민경` … (직원당 1시트) | 부문별(통합허가/화학안전/HAPs/도면) 참여 용역 + 산정액, 매출 기여금액·참여도·평점 + 산정액 |

> **사용자 명시 결정**: 이 중 “급여 차감액 시나리오(차감액1=급여×1, 차감액2=급여×1.5)”는 산정액이 너무 낮아져 실제로 적용하지 않으므로 **블루프린트에서 제외**. 산정액은 **차감 없는 단일 산식**으로 한정.

#### 6.7.2 산정 공식 (단일 시나리오)

```
[용역 적용대상액]
  applicable_amount =
      Σ (단계별 발행금액(t)
            × 보정비율(t, 반기))
        - 외주금액 - 도면작성공제 - 영업비용공제
  단, t = 해당 반기 기간(period_from ~ period_to) 안에 발행일자가 속한 단계만 합산
        보정비율(t, 반기) = 경과기간 보정 (단계가 반기 내내 완료되지 않으면 비례 차감)
                             — 기존 엑셀의 BR(보정비율적용) 컬럼 로직 그대로 이식

[용역별 개인 매출기여금액]
  user_contribution(c, u, period) =
      applicable_amount(c, period)
        × Σ (span.participation_pct × evaluation.rating_norm)
            for spans in span_overlap(c, u, period)
  rating_norm = rating / max_rating   (0~1 정규화)

[개인 매출기여 총액]
  total_contribution(u, period) = Σ user_contribution(c, u, period)  for all contracts c

[성과산정액 — 팀원]
  bonus(u, period) = total_contribution(u, period) × team_member_rate
  -- team_member_rate는 회사 규정 (예: 5% 또는 4.5%) — bonus_rules 테이블

[성과산정액 — 본부장]
  bonus(div_head, period) = Σ applicable_amount(c, period) for c.owning_dept_id = his_dept
                              × division_head_rate(his_dept)
  -- 통합환경1본부장 13%, 통합환경2본부장 15%, 울산지사장 5%, 화학안전본부장 별도

[성과산정액 — 도면팀]
  bonus_drawing(u, period) = Σ (drawing_share_amount(c, period) × 0.04)
                                × user_share(u, c, period)
  -- drawing_share_amount는 “도면부문 지분(원)” 별도 입력 (계약별 도면 비중)
```

#### 6.7.3 데이터 모델 (별도 앱이 read-only로 참조 + 자기 테이블 추가)

읽기 전용으로 참조하는 본 MCM 테이블:
- `contracts` — 용역명, 발주처, 일자, 금액
- `contract_payment_milestones` — 단계별 금액, `invoice_issued_at`(발행일자), `invoice_amount`(금기 발행금액), `payment_collected_at`
- `contract_invoices` — 발행 인보이스 상세 (보정비율 산정 근거)
- `service_costs` (§5.4) — 외주·도면·영업 공제비용
- `service_participation_spans` (§6.6) — 기간별 참여 비율
- `service_evaluations` (§6.6) — 평점

별도 앱이 자체적으로 들고 있어야 하는 테이블:

```sql
CREATE TABLE bonus_periods (
  period_id          VARCHAR(32) PRIMARY KEY,
  period_year        INT NOT NULL,
  period_half        VARCHAR(2) NOT NULL,            -- 'H1' | 'H2'
  period_from        DATE NOT NULL,                  -- 통상 1/1 또는 7/1
  period_to          DATE NOT NULL,                  -- 통상 6/30 또는 12/31
  status             VARCHAR(16) NOT NULL DEFAULT 'open',
  -- 'open' | 'evaluating' | 'calculated' | 'finalized'
  finalized_at       TIMESTAMPTZ,
  finalized_by       VARCHAR(32),
  UNIQUE (period_year, period_half)
);

CREATE TABLE bonus_rules (
  rule_id            VARCHAR(32) PRIMARY KEY,
  effective_from     DATE NOT NULL,
  effective_to       DATE,
  team_member_rate   NUMERIC(6,4) NOT NULL,          -- 예: 0.0500 = 5%
  drawing_team_rate  NUMERIC(6,4) NOT NULL,          -- 도면팀 4%
  division_rates_json JSONB NOT NULL,                -- {"통합환경1본부": 0.13, "통합환경2본부": 0.15, "울산지사": 0.05, "화학안전본부": 0.x}
  cost_deduction_kinds JSONB NOT NULL,               -- ["outsourcing","drawing","sales"] 등 공제 대상 source_kind 화이트리스트
  notes              TEXT
);

CREATE TABLE bonus_applicable_amounts (
  row_id             VARCHAR(32) PRIMARY KEY,
  period_id          VARCHAR(32) NOT NULL REFERENCES bonus_periods(period_id),
  contract_id        VARCHAR(32) NOT NULL,           -- 본 MCM contracts.contract_id
  bucket             VARCHAR(24) NOT NULL,           -- '통합' | '기타' | '화관법' | 'HAPs' | '연구소'
  raw_issued_amount  BIGINT NOT NULL,                -- 반기 내 단계별 발행금액 합
  issued_breakdown   JSONB NOT NULL,                 -- 단계별 상세 [{stageLabel, issuedAt, amount, correctionRate, adjustedAmount}]
  deduction_breakdown JSONB NOT NULL,                -- {outsourcing:..., drawing:..., sales:...}
  applicable_amount  BIGINT NOT NULL,                -- 최종 적용대상액
  -- snapshot
  recalculated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (period_id, contract_id, bucket)
);

CREATE TABLE bonus_user_calculations (
  calc_id            VARCHAR(32) PRIMARY KEY,
  period_id          VARCHAR(32) NOT NULL REFERENCES bonus_periods(period_id),
  user_id            VARCHAR(32) NOT NULL,
  user_track         VARCHAR(24) NOT NULL,            -- 'team_member' | 'division_head' | 'drawing_team' | 'researcher'
  total_contribution BIGINT NOT NULL,                -- 매출 기여총액
  contributions_json JSONB NOT NULL,                 -- per-contract breakdown
  bonus_amount       BIGINT NOT NULL,                -- 최종 성과산정액
  formula_version    VARCHAR(16) NOT NULL,           -- 산식 버전 (감사용)
  recalculated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 본부장 / 회계 검토
  approved_at        TIMESTAMPTZ,
  approved_by        VARCHAR(32),
  UNIQUE (period_id, user_id, user_track)
);
```

#### 6.7.4 API 계약 (별도 앱 ↔ MCM)

별도 앱은 본 MCM에 다음 read-only 엔드포인트를 호출한다 (`/api/bonus-source/...`, `viewer+` 또는 전용 토큰):

| 엔드포인트 | 응답 |
| --- | --- |
| `GET /api/bonus-source/contracts?period=2025-H2` | `[{contractId, contractTitle, owningDeptId, bucket, contractAmount, issuedInPeriod, deductionsInPeriod}]` |
| `GET /api/bonus-source/milestones?contractId&period=2025-H2` | 단계별 발행 상세 |
| `GET /api/bonus-source/spans?contractId&period=2025-H2` | 해당 반기와 겹치는 모든 span (user_id, role, span_from, span_to, participation_pct) |
| `GET /api/bonus-source/evaluations?period=2025-H2` | 본부장 평점 일괄 |
| `GET /api/bonus-source/costs?contractId&period=2025-H2` | 공제비용 (외주/도면/영업) |

별도 앱은 이 응답을 받아 자기 DB에 스냅샷(`bonus_applicable_amounts`, `bonus_user_calculations`)을 적재한다 — *MCM의 역사적 데이터가 추후 보정돼도 이미 확정된 반기 산정은 영향 받지 않도록 스냅샷 분리*가 핵심.

#### 6.7.5 반기 운영 사이클

| 시점 | 동작 | 담당 |
| --- | --- | --- |
| 반기 시작 | `bonus_periods` 1행 INSERT (`status='open'`) | admin |
| 반기 진행 중 | 본부장이 변동(§6.6.1)을 발생 시점에 수시 입력 | dept_head |
| 반기 종료 D-30 | `status='evaluating'`로 전환 → 본부장 평점 입력 보드 활성화 | admin → dept_head |
| 반기 종료 D-7 | 본부장 평점 입력 마감 | dept_head |
| 반기 종료 후 | 별도 앱에서 “재계산” 버튼 → `bonus_applicable_amounts` + `bonus_user_calculations` 일괄 적재 | 회계 / admin |
| 검토·승인 후 | `bonus_periods.status='finalized'`, `service_evaluations.finalized_at` 설정 → 모든 관련 테이블 잠금 | admin |

#### 6.7.6 명시적 비범위

- **급여 차감액 시나리오(급여×1, ×1.5) 적용 안 함** — 사용자 결정. 산식은 차감 없는 단일 시나리오로 고정. 추후 시나리오 비교가 필요해지면 `bonus_user_calculations.formula_version`을 새 버전으로 발행하면 됨.
- 본부장·지원부서 기여도, 영업 도면 외주 차감의 *세부 가중치*는 회사 규정(`bonus_rules`)으로 관리. 본 블루프린트에서는 데이터 모델만 정의하고 *가중치 값 자체*는 시드 단계에서 인사·회계와 협의.
- 별도 앱(그룹웨어+회계)의 UI / 권한은 본 블루프린트 외. 단 데이터 계약(테이블·API)은 본 절에 *고정* — 추후 별도 앱 구현 시 그대로 따라야 한다.

---

## 7. 용역 원가 집계 (Cost Roll-up)

### 7.1 집계 뷰

```sql
CREATE OR REPLACE VIEW v_contract_cost_summary AS
SELECT
  c.contract_id,
  c.contract_title,
  c.contract_amount,
  c.current_amount,
  COALESCE(SUM(sc.amount_krw), 0)                                      AS total_cost,
  COALESCE(SUM(sc.amount_krw) FILTER (WHERE sc.category LIKE '수당%'), 0) AS total_compensation,
  COALESCE(SUM(sc.amount_krw) FILTER (WHERE sc.category IN ('교통비','숙박비','식대')), 0) AS total_travel,
  COALESCE(SUM(sc.amount_krw) FILTER (WHERE sc.source_kind = 'outsourcing'), 0) AS total_outsourcing,
  COALESCE(SUM(sc.amount_krw) FILTER (WHERE sc.source_kind = 'purchase'), 0)    AS total_purchase,
  -- 마진율 = (수금액 - 비용) / 수금액
  CASE WHEN COALESCE(c.current_amount, c.contract_amount, 0) > 0
       THEN ROUND(((COALESCE(c.current_amount, c.contract_amount, 0) - COALESCE(SUM(sc.amount_krw), 0)) * 100.0)
                  / COALESCE(c.current_amount, c.contract_amount, 1), 2)
       ELSE NULL END                                                      AS margin_pct
FROM contracts c
LEFT JOIN service_costs sc ON sc.contract_id = c.contract_id
GROUP BY c.contract_id, c.contract_title, c.contract_amount, c.current_amount;
```

> 본 뷰는 `service_costs`(기 계약 비용)만 합산한다. `prospect_costs`는 의도적으로 **제외** — 미 계약 비용이 계약별 손익 KPI를 오염시키지 않도록. prospect_costs가 흡수되면 자동으로 `service_costs`에 행이 INSERT되므로 전환된 시점부터 본 뷰에 자연스럽게 반영된다.

추가 뷰 — 미 계약 비용 풀 집계:

```sql
CREATE OR REPLACE VIEW v_prospect_cost_summary AS
SELECT
  COALESCE(linked_bid_record_id, '__no_bid__')               AS bid_bucket,
  COALESCE(linked_sales_activity_id, '__no_sa__')            AS sales_bucket,
  prospect_legal_entity_id,
  prospect_facility_id,
  prospect_facility_label,
  prospect_service_title,
  resolution_state,
  COUNT(*)                                                   AS row_count,
  COALESCE(SUM(amount_krw), 0)                               AS total_amount,
  MIN(occurred_on)                                           AS first_occurred_on,
  MAX(occurred_on)                                           AS last_occurred_on
FROM prospect_costs
GROUP BY 1,2,3,4,5,6,7;
```

### 7.2 화면

- `/contracts/[id]` 우측 패널에 **“용역 손익”** 카드 추가:
  - 수금액 / 누적비용 / 잔여 / 마진율 / 인건비 비중 / 외주 비중
  - 흡수된 prospect 출처가 있으면 누적비용 우측에 “← prospect 흡수 N건 (₩XXX)” 작은 라벨로 노출.
- `/expense/dashboard` 에 부서×용역 stacked bar (이번 달 / YTD) **+ 별도 “영업·제안 비용 풀(prospect)” 카드** — 합산 X.
- `/expense/prospects` (§5.5) 에서 위 `v_prospect_cost_summary` 뷰를 그대로 그룹핑 표시.
- viewer는 본인이 참여한 용역의 손익만 열람 (`expense.view` (self)). prospect_costs도 본인 source_doc인 행만 self.

### 7.3 회계 코드 매핑

`service_costs.category`는 회사 내부 분류, `cost_center`는 ERP/회계 코드. 매핑 테이블 한 장으로 ERP export 호환.

```sql
CREATE TABLE cost_category_mapping (
  category       VARCHAR(40) PRIMARY KEY,
  account_code   VARCHAR(16) NOT NULL,
  account_name   VARCHAR(80) NOT NULL,
  is_taxable     BOOLEAN NOT NULL DEFAULT TRUE
);
```

---

## 8. 단계별 구현 로드맵

| 라운드 | 주요 산출물 | 의존성 | 예상 기간 |
| --- | --- | --- | --- |
| **R-A** 인프라 | `departments` / `positions` / `users` 컬럼 보강 / 사이드바 재배치 (업무 보고 vs 사업 운영) | — | 1주 |
| **R-A2** RBAC 템플릿 시스템 | `permissions` 카탈로그 시드 + `permission_templates` / `..._grants` / `user_permission_assignments` / `position_default_templates` 스키마 + `hasPermission()` 미들웨어 + `/admin/permissions/*` UI + 시드 템플릿 3종(임원/부서장/영업담당) + 잠금 도메인 4종 (`*.edit.locked`) + audit_log 이벤트 5종 + `role_grants` → 신규 모델 마이그레이션 스크립트 | R-A | 2주 |
| **R-B** 업무추진계획 (M1) | `work_plan_*` 스키마 + **6종 템플릿** + `/work-plan` CRUD + 직전 보고 복사 + 결재 없이 “저장만” | R-A | 2주 |
| **R-B2** 진행단계 enum + 주요일정 | `work_plan_items.progress_stage` / `progress_pct` / `key_dates_json` 컬럼 + service-matrix·chemsafe-matrix 템플릿 UI 보강 + dashboard 단계 분포 + `wp.overdue` / `wp.stage-stale` 알림 | R-B | 1주 |
| **R-B3** 1차 보고 → 부서장 머지 | `work_plan_reports.report_kind`/`parent_report_id`/`merge_locked_at` + `/work-plan/[reportId]/merge` 화면 + `source_item_id`/`item_status` 컬럼 + RBAC(dept_head 한정) + `wp.staff-missing` 알림 | R-B2 | 1.5주 |
| **R-B4** 영업·관리 마스터 | `business_contacts` / `sales_activities` / `bid_records` / `admin_tasks` (+ `admin_task_progress_log`) 4개 마스터 + `/sales/contacts`·`/sales/activities`·`/sales/bids`·`/admin-tasks` CRUD + `tpl-sales-structured`·`tpl-admin-task` 템플릿 마법사 + 영업·관리 보고서에서 마스터 link 강제 | R-B | 2.5주 |
| **R-C** 업무추진계획 (M3) | 정규화 파이프라인 (→ `contract_progress_log`, `service_participants`, `bid_records.resulting_contract_id` 추천) + 알림(`alerts`) + 미제출 KPI | R-B2, R-B3, R-B4 | 1.5주 |
| **R-D** 발표 모드 | `/meeting/[token]` + 자동 캐러셀 + PWA 캐시 + 발표 토큰 발급 | R-B | 1주 |
| **R-E** 사업참여 수행인력 (M1) | `service_participants` 보강 + `/staffing` 매트릭스 + 인원/계약 드릴다운 + 엑셀 import 1회 | R-C | 1.5주 |
| **R-E2** 인력 변동 이력 + 평점/참여도 | `service_participation_changes` / `..._spans` / `service_evaluations` + `/staffing/by-contract/[id]` 변동 타임라인 + `/staffing/evaluations/[year]/[half]` 본부장 평가 보드 + RBAC (dept_head 한정) | R-E | 1.5주 |
| **R-F** 다운로드/증명서 통합 | HWPX 워커 + 명단/실적증명서 자동 생성 + 계약·계산서 PDF 병합 + ZIP | R-E | 2주 |
| **R-G** 전자결재 (M1) | `approval_*` 스키마 + 8종 문서 + 결재선 자동 라우팅 + 출장/초과근무/지출 폼 + **계약 여부 토글 (기 계약/미 계약)** UI + `contract_link_kind` / `prospect_*` 컬럼 + CHECK 제약 (§5.1.1, §5.2) | R-A2, R-B4 | 3주 |
| **R-H** 비용 정산 (M2) | 결재 승인 → `service_costs` / **`prospect_costs` 분기 적재** + `compensation_rules` + 정산서 결재 변경 흡수 + `*.edit.locked` 사유강제 | R-G | 1.5주 |
| **R-H2** 미 계약 비용 흡수/손실 처리 | `/expense/prospects` + `/expense/prospects/[bucket]` 화면 + 자동 그룹핑 4단 규칙 + `EXPENSE_PROSPECT_ABSORB`/`_WRITEOFF` audit 이벤트 + `expense.prospect.absorb`/`.writeoff` 권한 + `bid_records.resulting_contract_id` 채울 때 prospect 흡수 추천 흐름 | R-H, R-B4 | 1.5주 |
| **R-I** 원가 집계 / 손익 | `v_contract_cost_summary` + `v_prospect_cost_summary` + `/expense/dashboard` + `/contracts/[id]` 손익 카드 + 회계 코드 매핑 | R-H2 | 1주 |
| **R-K** 성과급 데이터 계약 (별도 앱 연동) | `/api/bonus-source/*` 5개 read-only 엔드포인트 + `contracts.owning_dept_id` 추가 + 별도 앱 측 `bonus_periods/bonus_rules/bonus_applicable_amounts/bonus_user_calculations` 스키마 + 산식 v1 PoC | R-E2, R-H | 2.5주 |
| **R-J** 그룹웨어 추가 모듈 (선택) | 휴가, 게시판, 일정, 메일, 사내 알림 통합 | R-G | 별도 |

총 **R-A + R-A2 + R-B/B2/B3/B4 + R-C ~ R-I + R-E2 + R-H2 + R-K = 약 26.5주** (1인 풀타임 환산). 병렬화 가능 구간:
- `R-A2` (RBAC 템플릿) 는 R-A 직후 단독 진행. 그 다음 라운드부터는 모든 권한 검사가 새 모델 위에서 동작.
- `R-B2` (진행단계 enum) ↔ `R-B4` (영업·관리 마스터) 동시 진행 가능 (R-B 완료 후).
- `R-D` ↔ `R-E` ↔ `R-G` 동시 진행 가능 (R-A2 머지 + R-C 완료 후). 단 `R-G`는 prospect 토글 UI 때문에 R-B4(영업·관리 마스터)도 의존.
- HWPX 워커(R-F)는 백엔드 별도 트랙.
- 성과급 데이터 계약(R-K)는 R-E2(평점/참여도)와 R-H2(prospect 흡수)가 모두 머지된 후가 안전.

---

## 9. 마이그레이션 / 데이터 이행 계획

### 9.1 기존 엑셀 → DB

| 자산 | 도구 | 비고 |
| --- | --- | --- |
| `사업참여수행인력 현황.xlsx` | `/staffing/import` 1회성 import 화면 | 시트 “수행인력 현황” B열(용역명) ↔ `contracts.contract_title` fuzzy 매칭, 매칭 실패 행은 사용자 검수 큐 |
| `26.05.18 울산지사.xlsx` 등 부서 양식들 | `scripts/import_workplan_xlsx.py` (관리자 CLI) | 부서별 어댑터 함수 (`adapt_service_matrix()`, `adapt_chemsafe()`, `adapt_task_matrix()`, `adapt_sales_structured()`, `adapt_admin_task()`, `adapt_category_bullets()`) **6종** |
| 영업·관리본부 영업 파트 과거 양식 | `adapt_sales_structured()` 어댑터 | 자유서술 → `sales_activities` / `bid_records` / `business_contacts` 분리 인서트. 미매칭 행은 사용자 검수 큐 (`/migration/sales/review`). |
| 영업·관리본부 관리 파트 과거 양식 | `adapt_admin_task()` 어댑터 | 자유서술 → `admin_tasks` 후보 추출 → 관리자가 task_category·progress_stage 1차 라벨링. |
| `용역수행 기술인력 명단(연동).hwpx` 등 템플릿 | `data/staffing/templates/` 에 그대로 복사 | 토큰 매핑 JSON(`roster-field-settings.json`)도 동봉 |

### 9.2 사용자/조직 시드

- `users` 테이블에 임직원 N명을 `seed-users.csv`로 한 번에 등록 (admin 1회 실행).
- 부서/직급은 회사 조직도 한 장으로부터 시드.

### 9.3 기존 “수행인력 자동입력” 데스크톱 앱 deprecation

- 1단계: 데스크톱 앱은 readonly 모드(엑셀 직접 수정 금지)로 두고 신규 입력은 모두 웹.
- 2단계: 웹 R-F 안정화 후 데스크톱 앱 archive (`tools/legacy/roster-generator/`로 이동).
- 3단계: 한컴 COM 워커는 사내 PC 1대에서 docker-less Windows Service로 상시 운용.

---

## 10. 보안 / 운영 / 규정 고려사항

| 영역 | 고려사항 |
| --- | --- |
| 개인정보 | 직원 생년월일, 사번, 이메일 등 PII는 `users` + `service_participants`에서 최소만 보유. PDF 명단 출력에 들어가는 생년월일은 `users.hired_at` 등과 별도 컬럼 분리 후 view-time 조립. |
| 발표 모드 | TV 화면 캡처/촬영 가능성 → 발표 토큰은 회의실 단위·일자 단위로 단명, revoked_at 설정 가능. |
| 첨부 보안 | `approval_attachments`는 기존 `lib/storage` 추상화 사용 — S3 presigned URL 또는 nginx X-Accel-Redirect 둘 다 호환. |
| 감사로그 | 모든 결재 액션, 보고서 finalize, `service_costs` UPSERT은 `audit_log`(라운드 2A)에 1행 INSERT. 변경 전/후 JSON 보관. |
| 결재선 위임 | 본부장 부재 시 위임자 자동 라우팅 — `position_delegations` 테이블 (선택, R-J에서 도입 검토). |
| 백업 | Aurora 자동 스냅샷 + S3 첨부 버전닝 + `data/staffing/templates/` git track. |
| 네트워크 | 그룹웨어 모듈은 사내망/VPN 우선. 발표 모드 토큰만 무선 회의실 게스트망 허용 (정책 결정 필요). |
| 회계 호환 | `cost_center` + `account_code` 두 코드를 같이 보관해 ERP 변경 시 어댑터만 교체. |
| 시각 / UX | UI 디자인은 사용자 룰(미니멀/맥시멀/레트로퓨처/브루탈리즘 중 택1) 적용. 기존 라운드 2A의 글래스모피즘 톤은 “사업 운영” 메뉴군에만 한정하고 “업무 보고/결재”는 별도 미적 방향성을 검토. |

---

## 11. UX / 디자인 방향 (사전 결정 권장)

업무 보고·결재 메뉴는 사용 빈도가 높고 “회의실 TV에 띄우는” 활용이 있으므로 시각적 일관성·가독성이 결정적이다. 디자인 의사결정 옵션:

### A. 모노톤 + 단일 강조색 (브루탈리즘 영향)

- 본문 무채색 + 한 가지 강한 포인트 컬러 (예: 사프란 옐로우 또는 블러드 오렌지).
- 헤딩에 디스플레이 폰트 (예: `Noto Serif KR` 또는 `Pretendard` 굵은 호환), 본문은 `IBM Plex Sans KR`.
- 표는 격자 두께 변화로 위계 표현, 그라데이션 X.
- TV 발표 모드에서 인지 부하 최저.

### B. 페이퍼 + 잉크 (레트로 사무실)

- 베이지 배경 + 짙은 잉크 색 + 빨간 도장 모티프 = 결재 메타포 강조.
- 헤딩 `Nanum Myeongjo` 등 명조계, 본문 `Pretendard`.
- 결재 도장(approver signature_image)이 시각적 주인공.

### C. 데이터 + 글래스 (기존 라운드 2A 연장)

- 기존 글래스모피즘 톤을 그대로 확장. 통일감 최고이지만 차별성은 약함.

권장: **A** (브루탈리즘) 메인 + 결재 모듈에 한해 **B** (페이퍼 잉크) 액센트.
- “회의실에 띄우는 보고” = 인지 부하 최소화 우선
- “결재” = 메타포 친숙도 우선
- 두 톤을 하나의 디자인 토큰 시스템(`--brand-primary`, `--brand-paper`, `--ink-black`)으로 통합 관리.

---

## 12. 미해결 / 사용자 의사결정 필요 항목

1. **부서 트리 정의** — 1본부/2본부/화학안전본부/울산지사/탄소중립미래연구소/도면관리/영업관리본부 외 누락된 조직? 임원·CEO 직속 라인 어떻게?
2. **결재선 정책** — 금액 임계값(예: 100만원/500만원/1천만원)에 따른 본부장·대표이사 결재 승급 기준?
3. **출장수당/야근수당 규정** — `compensation_rules` 시드 값은 회사 인사팀 자료가 필요. 제출 가능한지?
4. **발표 모드 보안 정책** — 무선 게스트망에서의 토큰 접근을 허용할지, VPN 강제할지.
5. ~~**HWPX 변환 워커 호스팅** — 사내 Windows PC 한 대를 24/7 서비스로? 또는 사용자가 요청 시점에만 본인 PC에서 한컴 띄울지?~~ → **결정됨 (2026-05-27)**: HWPX 생성·치환·병합은 AWS Linux에서 직접 처리, HWPX→PDF 변환만 사내 Windows 워커가 잡 큐 polling 방식으로 분리 (워커 24/7 가동 불필요, 부팅 시 자동 시작 권장). LibreOffice + h2orestart fallback은 후속 라운드 후보. 상세는 §6.5.1~§6.5.4.
6. **외주 인력(외부 회사) 처리** — 외주 협력사의 인원을 `service_participants`에 같이 표시할 것인지, 별도 테이블로 분리할 것인지(현재안: `external_participants`).
7. **메일/캘린더/게시판** — 그룹웨어로 들어가는 모듈을 어디까지 확대할 것인가? (R-J 범위 결정 필요)
8. **모바일 우선순위** — 출장·외근이 많은 영업·관리본부 결재가 모바일에서 가장 많이 일어남. 모바일 PWA 우선 vs 데스크톱 우선?
9. **데이터 보존 기간** — 업무추진계획·결재 문서·`service_costs`의 회사 정책상 보관 기간(보통 5/10년)?
10. **권한 위임 / 부재 처리** — 결재자가 휴가/출장으로 부재 중일 때 자동 위임 정책?
11. **평점 척도** — `service_evaluations.rating` 의 max_rating 값(0~5? 0~10? 0~100?). 현행 엑셀의 “평점” 컬럼은 본부장이 자유 숫자 입력으로 보임 — 기준값이 필요.
12. **계약별 “담당 본부” 매핑 검증** — `contracts.owning_dept_id` 자동 추정 결과를 admin이 1회 일괄 검수. 모호한 케이스(예: 통합 1·2본부 합동 작업)의 정책?
13. **성과급 본부 비율 표** — 통합1본부 13% / 통합2본부 15% / 울산지사 5% / 화학안전본부 ?% / 연구소 ?% / 영업관리본부 ?%. 현행 엑셀에 명시되지 않은 본부 비율의 확정값 필요.
14. **도면팀 “도면부문 지분(원)” 산정** — 현행 엑셀은 계약별로 수기 입력. 자동화 가능한 추정 규칙(예: 계약금액 × 도면 비중 N%)이 있는지, 아니면 본부장 수기 입력 유지인지.
15. **별도 앱 호스팅** — 성과급 산정 모듈을 두는 “별도 앱(그룹웨어 + 회계관리)”의 호스팅 위치(같은 Aurora 인스턴스의 별도 스키마? 별도 DB? 다른 EC2/ECS?). 현실적으로는 *같은 DB의 별도 schema(`bonus.*`)* 가 운영 부담 최저.
16. **영업·관리 마스터 신규등록 권한** — `legal_entities` / `business_contacts` / `bid_records` / `admin_tasks` 신규등록 권한을 영업관리본부 editor 전체에 풀어줄지, 부서장만 풀어줄지. 부서별 분리(예: 통합본부 직원이 자기 사업장 컨택을 직접 등록 가능?) 정책.
17. **bid_records → contracts 자동 생성 규칙** — `bid_records.bid_kind='awarded' AND awarded_to_self=true` 시 자동으로 `contracts` row를 만들어줄지, 단순 추천만 띄울지. 자동 생성하면 어떤 필드를 미리 채울지(계약기간·계약금액·발주처).
18. **service_kind enum 확장** — sales_activities/bid_records의 `service_kind` 가 `통합허가/화관법/ESG·탄소중립/기타인허가` 외에 추가로 필요한 값(예: `대기·수질 모니터링`, `환경경영시스템 인증`)이 있는지.
19. **admin_tasks task_category enum 확장** — 현재 `회계업무/용역입찰/인사업무/시스템개발/관리업무/총무/감사/기타` 외에 회사에서 실제 사용 중인 task_category가 있는지 확정 필요.
20. **자격제한 요건 칩(qualification_json) 표준화** — 자유 추가를 허용하되, 자주 쓰는 값을 master enum으로 두면 통계 가능. 회사가 가진 등록·자격증 카탈로그(예: 통합허가 대행업, 화학물질 안전관리자, 토양환경평가업…) 1회 시드 필요.
21. **1차 보고 잠금 정책** — 부서장이 [머지 완료] 누른 뒤 staff_input의 사후 수정 허용 범위. 옵션: (a) 완전 잠금, (b) audit_log 남기고 가능, (c) admin/dept_head 만 가능.
22. **권한 템플릿 디폴트 시드** — §3.2.8 의 3종(임원/부서장/영업담당) 외에 회사가 “바로 쓰도록” 시드해두면 좋을 추가 템플릿(예: 도면담당/관리담당/회계담당/외주협력사 보기전용)이 있는지. 각 템플릿이 가져야 할 atomic 권한 키 목록 확정 필요.
23. **직급-템플릿 자동 매핑** (`position_default_templates`) — 직급별 신규 등록 시 자동 부여 규칙. 예: `dep-head` → `tpl-부서장(self_dept)`, `exec` → `tpl-임원`, 사원 → 부서별 기본 템플릿 1개.
24. **잠금 도메인 4종 사유 최소 길이** — `*.edit.locked` 사유 입력의 최소 글자수(현 안: ≥ 10자), 사유 분류(자유 vs 미리 정의된 enum)도 정책 결정.
25. **`is_dangerous` 권한 추가 안전장치** — `work_plan.lock_release`, `contract.delete`, `bonus.calc.run`, `staffing.evaluation.edit.locked` 등 위험 권한 행사 시 (a) admin 본인 비밀번호 재입력 / (b) 2단계 인증 / (c) 단순 모달 확인 중 어느 강도까지 적용할지.
26. **권한 캐시 TTL** — `hasPermission()` 의 in-memory 캐시 유효시간(현 안: 60초). admin이 권한 적용 후 “언제 반영되는가”의 사용자 기대치 결정.
27. **미 계약 비용(prospect) 손실 처리 회계 매핑** — write_off 된 prospect_costs가 (a) 회계상 “영업비용” 단순 계상으로 끝낼지, (b) 부서별 영업비용 풀에 누적되어 §6.7 성과급 산정의 “부서장 풀” 차감 항목으로 들어갈지. 후자라면 부서별로 누가 낙찰 못 받았는지가 본부장 비율에 영향.
28. **미 계약 비용 묶음 자동 흡수 정도** — `bid_records.bid_kind='awarded' AND awarded_to_self=true` 시 같은 facility/legal_entity 의 prospect 묶음을 (a) 자동 흡수, (b) 추천만 + admin 1-click 확인, (c) 항상 수동. 현 권장: (b).
29. **prospect_kind enum 확장** — 현재 `sales_visit / presentation / proposal_prep / bid_prep / etc` 5종. 회사가 실제 자주 쓰는 값(예: `tender_consultation`, `customer_complaint_visit`) 확정 필요.
30. **미 계약 비용의 사용자 시야** — 본인이 기안한 prospect_costs 만 self R로 둘지, 같은 부서 prospect_costs를 self_dept 로 풀지. 영업파트는 후자가 협업에 유리.

---

## 13. 부록 — 참조 양식 매핑 표

| 기존 양식 행 | 표준 모델 매핑 |
| --- | --- |
| `구분` (No.) | `work_plan_items.display_order` |
| `사업장명` | `subject_label` (+ facility 매칭 시 `facility_id`) |
| `구분` (용역명) | `subject_label` (+ contract 매칭 시 `contract_id`) |
| `계약기간` | `contracts.started_at` / `contracts.ended_at` 참조 (자동 fill) |
| `진행상황` (텍스트) | `status_text` (자유) **+** `progress_stage` (enum, §4.9) **+** `progress_pct` |
| `추진내역(기간)` | `progress_text` (+ `period_start`/`period_end`) |
| `추진계획(기간)` | `plan_text` (+ 다음 보고서의 `period_start`/`period_end`) |
| `관리자` | `manager_user_id` |
| `정` / `메인` | `primary_user_id` |
| `부` | `secondary_user_id` |
| `25년 7월` 같은 월별 칸 | `milestones_json` 항목 `{period:'2025-07', label:'…'}` |
| **양식 본문 내 “사전협의 제출 26.05.28” / “허가취득 예정 6월 중순”** 같은 자유서술 | `key_dates_json` 의 `[{label, stage, kind:'confirmed'\|'planned', date, note}]` 항목 (§4.9.2) |
| (도면) `구분(완료/실행/보완)` | `category` |
| (도면) `지역` | `subject_label` 보조 또는 별도 `region` 슬롯 (template_schema에서 정의) |
| (도면) `작업내용` | `progress_text` |
| (도면) `담당자` | `primary_user_id` |
| (도면) `진행 현황` | `status_text` |
| (영업) `사업장 방문 현황 / 미팅 계획 / 텔레마케팅` | **구조화** — `linked_sales_activity_id` 로 `sales_activities` 1행 참조. 카테고리는 `영업활동` |
| (영업) `예정사항` | **구조화** — 미래 시점 `sales_activities` 행 (outcome=`in_progress`), 카테고리 `영업계획`. `plan_text` 는 보조 메모만 |
| (영업) `견적 제출 / 입찰 응찰 / 낙찰 결과` | **구조화** — `linked_bid_record_id` 로 `bid_records` 1행 참조 (`bid_kind` 별로 quote_only/bid/awarded/lost) |
| (영업) `사업장 담당자 정보 (성명·직함·부서·연락처·이메일)` | `business_contacts` 마스터 (sales_activities.primary_contact_id 로 link) |
| (관리) `회계/입찰/인사/시스템개발/관리` 항목 | **구조화** — `linked_admin_task_id` 로 `admin_tasks` 1행 참조. `task_category` enum 5+종 |
| (관리) `진행 경과` 자유서술 | `admin_tasks.progress_stage` enum (`planning/kickoff/in_progress/rework/completed/reporting`) + 보고서 행의 progress_text 보조 메모 |
| (R&D 탄소중립연구소) `추진실적` / `향후계획` | `progress_text` / `plan_text`, `subject_kind='free'` (자유서술 유지 — 인원·범위 작아 구조화 비용 > 효익) |
| **(통합1·2/울산/화학안전) 1차 보고와 부서장 머지본의 관계** | 같은 부서·주차에 `report_kind='staff_input'` N건 → `report_kind='dept_consolidated'` 1건이 머지 (§4.8). 각 머지 행은 `source_item_id` 로 1차 행을 가리킴 |

### 13.1 성과급 엑셀 → 표준 모델 매핑

| 엑셀 시트·컬럼 | 표준 모델 매핑 |
| --- | --- |
| `성과급 대상액 산정(통합/기타/화관법/HAPs/연구소)` 시트 = 5종 bucket | `bonus_applicable_amounts.bucket` enum 5종 |
| 단계별 발행금액 (선급금~준공금) | `contract_payment_milestones.invoice_amount` (반기 필터 시점 적용) |
| 발행일자(AF~AN) | `contract_payment_milestones.invoice_issued_at` |
| 보정비율적용(BR) | 별도 앱 산식 — `correctionRate` (issued_breakdown JSONB의 단계별 항목) |
| 외주금액·도면작성·영업비용 | `service_costs` (source_kind in ['outsourcing','drawing','sales']) — `deduction_breakdown`. 단 “영업비용” 중 미 계약 단계에서 발생한 분은 `prospect_costs` → write_off 또는 absorb로 흡수된 후 `service_costs`로 들어옴 (§5.4.3). 정책에 따라 §12-#27 결정. |
| 본부구분(BS) / 본부(BV) | `contracts.owning_dept_id` |
| 적용금액(BP) | `bonus_applicable_amounts.applicable_amount` |
| `용역별 개인 평점(*)` 시트 — 참여자1~4 / 비율1~4 / 평점1~4 | `service_participation_spans.user_id`/`participation_pct` + `service_evaluations.rating` (반기 단위로 평가 입력 보드에서 한 번에) |
| `25년 하반기 개인별 성과급.xlsx` → `통합허가 개인별 성과산정액` 의 “매출 기여총액” | `bonus_user_calculations.total_contribution` |
| “성과산정액1(기존)” | `bonus_user_calculations.bonus_amount` (단일 시나리오 — 차감 없음) |
| “성과산정액2(급여1 차감)” / “성과산정액3(급여1.5 차감)” | **사용 안 함** (사용자 결정) |
| `성과급 총괄표` 우측 “본부장 비율” 0.13 / 0.15 / 0.05 | `bonus_rules.division_rates_json` |
| `성과급산정(도면팀)` — “도면부문 지분(원)” / “4%” | `bonus_applicable_amounts.bucket='drawing'` (또는 별도 컬럼) + `bonus_rules.drawing_team_rate` |
| 직원별 시트(`한도경`, `한상순` …) | DB로 옮기면 시트 자체가 **불필요** — `bonus_user_calculations.contributions_json` 한 행이 부문별 breakdown을 모두 보관 |

---

## 14. 다음 액션

1. **§12의 의사결정 항목**에 대한 답을 사용자가 한 번에 정리.
2. **R-A (인프라)** 부터 착수: `departments` / `positions` / 사이드바 재배치 PR 1개 → 체감 변화 작지만 모든 후속 라운드의 빌딩블록.
   직후 **R-A2 (RBAC 템플릿 시스템)** 1개 PR — 권한 카탈로그 시드 + 템플릿/적용 스키마 + `hasPermission()` 미들웨어 + admin UI 4화면 + 시드 템플릿 3종.
3. R-A 머지 직후 **R-E의 “엑셀 1회성 import”** 를 먼저 구현해 “기존 자료가 그대로 검색되는 상태”를 빨리 만들고, 그 위에서 R-B(업무추진계획 신규 작성)를 시작하는 것이 사용자 체감 가치가 가장 큼.

> 이 블루프린트는 검토 후 §12 결정사항을 채워넣고, R-A 부터 PR 단위로 쪼개 실행 계획을 다시 한번 좁힐 예정입니다.





