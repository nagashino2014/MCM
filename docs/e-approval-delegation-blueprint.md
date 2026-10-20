# 전자결재 대결·전결(부재 결재) 구현 계획

작성 2026-10-20 · 상태: **결정 D-1~D-5 확정(2026-10-20) · DA-0~DA-2 구현(브랜치 `claude/approval-absence`, 마이그 301 미적용 — DA-1 코드는 301 필수)** · 상위 문서: [e-approval-blueprint.md](e-approval-blueprint.md) §8-4

## 1. 요구(2026-10-20 사용자)

결재자가 해외여행 등으로 결재할 수 없을 때 **미리 지정**해 두면
- (대결) 지정한 대리 결재자가 대신 결재하거나,
- (건너뛰기·전결) 결재가 다음 결재자로 넘어가도록 한다.

> 기존 블루프린트 §8-4 결정(“대결은 승인된 **휴가** 기간에만, 출장 제외 / 전결은 기능만”)을
> 이 요구가 대체한다. 휴가 연동 자동 대결은 하위 호환으로 유지하고, **기간·방식을 직접 지정하는
> 부재 설정**을 주 경로로 추가한다.

## 2. 현황(코드 확인 결과)

| 항목 | 현재 상태 | 위치 |
|---|---|---|
| 대결자 표 | `approval_delegates(user_id PK, delegate_user_id, enabled)` — 1인 1대결자, 기간 없음 | `084_e_approval_core.sql:117` |
| 대결 판정 | 결재 차례 도래 시 **본인이 기안·승인된 휴가신청서 기간**이면 대결자로 교체 | `lib/approval/docs.ts:266` `resolveDelegate` |
| 교체 방식 | `assignee_*`를 대결자로 바꾸고 `delegated_from`에 원결재자 기록 | `docs.ts:525` `activateOrder` |
| 알림 | `delegated_from` 이 있으면 “대결 결재 요청” 이벤트 | `lib/approval/notify.ts:281` |
| 열람 권한 | 원결재자는 `delegated_from` 으로 열람 가능 | `lib/approval/access.ts:18` |
| 표시 | 웹 스텝퍼 “(대결)”, 모바일 StepTimeline “대결 처리” | `ApprovalDocModal.tsx:403`, `apps/mobile/.../StepTimeline.tsx:79` |
| **등록 화면·API** | **없음** → 실제로는 대결이 한 번도 동작할 수 없음 | — |
| 전결 | 컬럼·로직 없음(`skipped` 는 반려 경로에서만 사용) | `docs.ts:632` |

현재 구조의 결함:
1. `today` 가 UTC(`toISOString`) — KST 00~09시에 하루 어긋난다.
2. 판정이 **단계 활성화 시점 1회**뿐 — 이미 내 차례로 대기 중인 문서는 부재가 시작돼도 넘어가지 않는다.
3. 원결재자의 “내가 결재한 문서”·도장란·PDF에 대결 사실이 남지 않는다(`assignee` 교체 방식이라 처리자=대결자).
4. 최종 승인 후크(연차 차감·공문/견적 발송 대장·계약서·양식 액션)가 `actOnDoc` 안에 직접 있어 전결·건너뛰기 경로에서 재사용할 수 없다.

## 3. 용어·동작 정의

| 구분 | 의미 | 결재선 결과 | 문서 표기 |
|---|---|---|---|
| **대결(代決)** | 부재 결재자 대신 지정 대리인이 결재 | 해당 단계 처리자=대리인, `delegated_from`=원결재자 | 원결재자 칸에 “대결” + 대리인 이름 |
| **부재 건너뛰기** | 부재 결재자 단계를 생략하고 다음 결재자에게 이관 | 해당 단계 `skipped`(사유 absence) | 해당 칸 “부재” |
| **전결(專決)** | 결재자가 상위 단계를 생략하고 최종 승인 | 이후 단계 전부 `skipped`(사유 final), 문서 approved | 전결자 칸 “전결”, 생략된 칸 “전결” 사선 |

- **최종 결재자 규칙(D-2 확정)**: 결재선의 마지막 순번(최대 `step_order`) 단계에는 부재 설정을 **적용하지 않는다** —
  대결·건너뛰기·전결 전환 모두 없음. 최종 결재자 **본인이 결재해야만** 결재라인이 종료된다.
  부재 중이면 문서는 최종 결재자 차례에서 대기하고, 기안자에게 “최종 결재자 부재(~복귀일) — 복귀 후 결재” 안내를 보낸다.
- 부재 처리(대결·건너뛰기)는 최종 단계를 **제외한** 중간 단계(합의·승인)에만 적용한다.
- 결재자가 스스로 누르는 [전결](§5-4, D-3 권한자 한정)은 위임전결규정에 따른 별도 행위로 유지한다.
  부재 설정이 전결을 자동으로 일으키는 경로는 없다.

## 4. 데이터 모델 — 마이그레이션 301(번호는 착수 직전 `git fetch` 후 원격 전 브랜치 재확인)

```sql
-- 부재 설정(기간·방식). 한 사람이 여러 기간을 등록할 수 있고, 겹치면 최근 등록분이 우선.
CREATE TABLE IF NOT EXISTS approval_absences (
  absence_id       text PRIMARY KEY,
  user_id          text NOT NULL,          -- 부재 결재자
  start_date       text NOT NULL,          -- YYYY-MM-DD (KST)
  end_date         text NOT NULL,          -- YYYY-MM-DD (KST, 포함)
  mode             text NOT NULL CHECK (mode IN ('delegate','skip')),
  delegate_user_id text,                   -- mode=delegate 일 때 필수
  reason           text,                   -- 해외출장·휴가·교육·기타 등 자유 입력
  allow_self_act   integer NOT NULL DEFAULT 1, -- 부재 중에도 원결재자 본인 처리 허용(조기 복귀 대비)
  created_by       text NOT NULL,          -- 본인 또는 관리자 대리 등록
  created_at       text NOT NULL,
  canceled_at      text
);
CREATE INDEX IF NOT EXISTS idx_approval_absences_user ON approval_absences(user_id, start_date, end_date) WHERE canceled_at IS NULL;

-- 단계 처리 유형·생략 사유
ALTER TABLE approval_steps ADD COLUMN IF NOT EXISTS act_type text;     -- normal | proxy(대결) | final(전결)
ALTER TABLE approval_steps ADD COLUMN IF NOT EXISTS skip_reason text;  -- rejected | absence | final
ALTER TABLE approval_steps ADD COLUMN IF NOT EXISTS absence_id text;   -- 어떤 부재 설정으로 대결/생략됐는지

-- 전결 권한(양식별). 행이 없으면 전결 불가. min_position_rank 등 금액 조건은 2단계.
CREATE TABLE IF NOT EXISTS approval_final_rules (
  rule_id     text PRIMARY KEY,
  form_id     text NOT NULL,               -- '*' = 전 양식
  user_id     text,                        -- 특정 사람(예: 본부장)
  dept_head   integer NOT NULL DEFAULT 0,  -- 1이면 기안 부서장에게 전결 허용
  max_amount  numeric                      -- (2단계) 금액 상한
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_final_rules ON approval_final_rules(form_id, COALESCE(user_id, ''), dept_head);
```
- `approval_delegates` 는 유지(“휴가 승인 시 자동 대결자” 기본값). 판정 순서: ①유효한 `approval_absences` → ②기존 휴가 연동 `approval_delegates`.
- 알림 이벤트 시드 추가: `absence_skipped`(기안자에게 “○○ 부재로 다음 결재자에게 넘어감”), `proxy_done`(원결재자 후열 통지), `final_absent`(기안자에게 “최종 결재자 부재 — 복귀 후 결재”), `final_approved`([전결] 종결 통지).
- 기존 파일은 수정하지 않는다. 멱등(`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`).

## 5. 서버 로직(`lib/approval/`)

1. **`absence-routing.ts` 신설**(기존 `absence.ts` 는 결근사유서 모듈)
   - `kstToday()` — KST 기준 날짜(기존 UTC 버그 수정).
   - `resolveAbsence(db, userId, date)` → `{ mode:'delegate', delegateUserId, absenceId } | { mode:'skip', absenceId } | null`.
   - 대리인 연쇄: 대리인도 부재(delegate)면 최대 3단계까지 따라가고, 순환·미해결이면 원결재자 유지 + 관리자 알림.
   - 대리인이 기안자 본인이면 지정 불가(자기 결재 방지, `094` self_approval 정책과 일치).
2. **`finalizeApprovedDoc(txn, docId, now)` 추출** — `actOnDoc` 의 최종 승인 블록(문서 approved + 연차 차감·공문/견적 대장·계약서 마킹)을 함수로 분리. 일반 최종 승인과 [전결]이 이 함수를 쓴다(동작 변경 없음 리팩터, 회귀 확인 필수). 부재 처리 경로는 이 함수를 호출하지 않는다(D-2).
3. **`activateOrder` 확장**
   - **최종 단계 판정**: 문서의 최대 `step_order` 에 속한 단계 = 최종 단계. 최종 단계에는 부재 판정을 하지 않고 원결재자에게 그대로 활성화한다(기존 휴가 연동 `resolveDelegate` 도 최종 단계에서는 적용 중지).
     최종 결재자가 부재 중이면 기안자에게 `final_absent` 안내(부재 기간·복귀일)를 보내고, 리마인드(`dispatchDueReminders`)는 부재 종료 다음 날부터 재개한다.
   - (중간 단계) delegate → 기존처럼 `assignee` 교체 + `delegated_from`·`act_type='proxy'`·`absence_id` 기록.
   - (중간 단계) skip → 해당 단계 `skipped`(`skip_reason='absence'`) 후 같은 order 잔여가 없으면 다음 order 활성화를 **반복**. 반복은 최종 단계에서 반드시 멈추므로 부재로 문서가 종결되는 경로는 없다.
4. **`actOnDoc` 확장**
   - 권한: `assignee == actor` **또는** (`delegated_from == actor` 이고 해당 부재의 `allow_self_act=1`) — 원결재자가 일찍 복귀해 직접 처리 가능. 이때 `act_type='normal'`, 처리자는 원결재자로 되돌려 기록.
   - `action: 'final'`(전결) 신설 — 승인 단계 + `approval_final_rules` 충족 시에만. 이후 단계 전부 `skipped`(`skip_reason='final'`) → `finalizeApprovedDoc`.
   - `/api/approval/docs/[docId]/act` 의 action 검증에 `final` 추가, 감사 로그 `approval_doc_act` 에 act_type 포함.
5. **이미 대기 중인 문서 재라우팅** — `rerouteForAbsence(userId)`
   - 부재 등록·수정 시 시작일이 오늘 이전이면 즉시 실행.
   - 미래 시작분은 기존 주기 작업 `/api/internal/approval-remind-tick` 에서 “오늘 시작하는 부재”를 찾아 실행(새 스케줄 리소스 불필요 — Terraform 변경 없음).
   - 대상: 해당 사용자가 `assignee` 인 `pending` **중간** 단계(그리고 `in_progress` 문서). delegate 면 교체, skip 이면 생략 후 다음 활성화. 최종 단계는 대상에서 제외하고 기안자 `final_absent` 안내만 보낸다.
   - 부재 종료·취소 시 이미 넘어간 단계는 **되돌리지 않는다**(대리인이 처리 중일 수 있음). 원결재자는 `allow_self_act` 로 직접 처리 가능.
6. **결재함·배지** — `listActedDocs` 에 `delegated_from = me` 문서를 “대결 처리됨” 표시로 포함(후열). 대기·예정·내비 배지·To-do 이벤트는 `assignee` 기준이라 변경 없음.

## 6. 화면

1. **부재·대결 설정**(`/approval/absence`, 전자결재 메뉴 하위 — 구현 시 변경: 기존 `/approval/settings` 는 approval.manage 전용이라 전 직원용 화면을 따로 둠)
   - 기간(`CdDateInput` YYYYMMDD)·사유·방식(대결자 지정 / 다음 결재자로 넘기기)·대결자(기존 `OrgPickerModal`)·“부재 중 본인 처리 허용”.
   - 현재·예정 부재 목록, 취소. 저장 시 “지금 대기 중인 결재 N건이 ○○에게 넘어갑니다” 영향 안내.
   - 고정 안내 문구: “최종 결재자로 지정된 문서는 대결·건너뛰기 없이 복귀 후 직접 결재해야 합니다.” 저장 시 최종 단계로 대기 중인 문서 수도 함께 표시.
   - 휴가 연동 자동 대결자(기존 `approval_delegates`)도 같은 화면에서 지정.
2. **관리자 대리 등록** — 결재 관리(approval.manage) 권한자가 갑작스러운 부재자 대신 등록(`created_by` 기록, 본인에게 통지).
3. **기안 화면 결재선** — 부재 예정 결재자에 “부재 10/21~10/30 · 대결 김○○” 배지(차단 없음, 안내만). 최종 결재자가 부재면 “최종 결재자 부재 — 10/30 복귀 후 결재 완료” 경고.
4. **문서 뷰어 결재선 스텝퍼·도장란(`ApprovalDocHead`)·PDF(`doc-pdf.ts`)** — 대결/부재/전결 표기(§3 표).
5. **결재 처리 바** — 전결 권한이 있으면 [승인] 옆에 [전결] 버튼(확인 모달: “이후 결재자 N명을 생략하고 최종 승인합니다”).
6. **모바일** — Expo 앱 `StepTimeline` 라벨(부재·전결), 상세 화면 [전결] 버튼(OTA). 웹 `/m` 결재 화면 동일.
- UI는 Precision 기준(8px 반경·`--cd-*` 토큰), 라이트/다크·좁은 화면·키보드로 검증.

### DA-1 구현 메모(2026-10-20)
- 결재 대기함(`listInbox` pending)에 대결 중인 내 원 단계(`delegated_from = 나`, 본인 처리 허용)를 함께 보인다(D-4). 내비 배지·To-do 건수는 기존대로 처리자 기준.
- 대결 알림 dedup 키에 수신자를 넣었다(`delegated:<step>:<user>`) — 연쇄 재라우팅 시 새 대결자에게도 발송.
- 재기안 화면은 대결로 바뀐 단계를 원결재자로 복원하고, 재상신 시 서버도 `restoreDelegatedAssignees` 로 복원한다.
- ⚠ 대결자 선택에 쓰는 공용 `OrgPickerModal` 의 `/api/sales/org` 가 `sales.view` 를 요구한다 — 298 이후 일반 직원은 403(기안 결재선 조직도 선택도 동일 영향 추정). 별도 수정 필요.

### DA-2 구현 메모(2026-10-20)
- 표기 공용 규칙 `lib/approval/step-display.ts` — 스텝퍼·도장란(`ApprovalDocHead`)·PDF·결재 의견 목록이 함께 쓴다. 대결 = 원결재자 직위 칸에 '대결' 도장 + 대결자 이름 + '원결재자 대결' 병기, 부재 건너뛰기 = '부재', 전결 = '전결'(DA-3).
- 알림: `absence_skipped`·`final_absent`(기안자, notifyPendingSteps 끝에서 단계별 1회), `proxy_done`(원결재자, 대결 처리 직후), `final_approved`는 이벤트·설정만(발송은 DA-3 전결). 부재 등록 기간 중인 결재자는 리마인드 보류.
- 기안 화면 결재선 행 배지 — `/api/approval/absences/lookup`(진행 중·30일 내 예정, 직접 등록 우선 → 승인 휴가, 사유 비노출). 최종 결재자는 경고색.
- 관리자 대리 등록 — `/approval/absence` 에서 approval.manage 보유자에게 '설정 대상' 선택. API 는 `userId` 지정 시 approval.manage 확인, 등록·취소 시 본인에게 이메일·푸시(문서 무관 알림이라 발송 로그 없음).

## 7. 단계별 진행

| 단계 | 내용 | 산출 |
|---|---|---|
| **DA-0** | 마이그 301, `absence-routing.ts`(KST·판정·연쇄), `finalizeApprovedDoc` 추출(동작 동일) | 회귀: 기존 승인·반려·연차 차감 그대로 |
| **DA-1** | 부재 설정 API·화면, `activateOrder` delegate/skip, `actOnDoc` 원결재자 처리, 재라우팅(즉시+tick) | 대결·건너뛰기 실동작 |
| **DA-2** | 표기(스텝퍼·도장란·PDF·결재한 문서 후열), 알림 이벤트 4종, 기안 화면 부재 배지, 관리자 대리 등록 | 사후 추적 가능 |
| **DA-3** | 전결 규칙 표·[전결] 버튼·API, 모바일(Expo OTA + /m) | 전결 실동작 |
| **DA-4(선택)** | 금액·직급 기반 위임전결규정, 전결 규정 관리 화면 | 규정 자동화 |

배포: DA-0~3 모두 Next 이미지만 변경 + 마이그. 마이그 표(`approval_*`)는 ADT·intel 배치가 쓰는 표가 아니므로 `staging-deploy-next.ps1 -AcknowledgePinnedScheduleLag -Wait` 경로 사용 가능(착수 시 재확인).

## 8. 검증 시나리오(스테이징)

1. A(1차)·B(2차)·C(최종) 결재선 / B가 대결(→D) 설정 → A 승인 시 D에게 “대결 결재 요청”, D 승인 → C 차례, 문서에 “B 대결 D”.
2. B 건너뛰기 → A 승인 시 C에게 바로 이관, 기안자에게 부재 통지, B 칸 “부재”.
3. C(최종)가 대결·건너뛰기 어느 방식으로 부재여도 → B 승인 후 문서는 C 차례에서 대기(대결자에게 넘어가지 않음), 기안자에게 `final_absent` 안내, 부재 중 리마인드 없음. C 복귀 후 승인 시 종결·최종 후크 1회 실행.
4. B 차례로 대기 중인 문서가 있는 상태에서 B 부재 등록 → 즉시 D에게 이동. 미래 시작 부재는 시작일 tick 후 이동.
5. 대리인 D도 부재(→E) → E에게 연쇄, A→B→A 순환 설정은 원결재자 유지 + 관리자 알림.
6. 부재 중 B가 직접 처리(`allow_self_act`) → 정상 처리로 기록.
7. 전결 권한자가 [전결] → 이후 단계 skipped, 문서 approved, 양식 액션·발송 대장 정상.
8. KST 00~09시 경계에서 부재 시작/종료 판정 정확.

## 9. 사용자 결정(2026-10-20 확정)

| 번호 | 결정 |
|---|---|
| **D-1 부재 판정 범위** | 직접 등록한 부재 + 승인된 휴가신청서 둘 다 인정. 휴가는 기본 대결자(`approval_delegates`)가 지정된 경우에만 대결. |
| **D-2 최종 결재자** | 최종 결재자는 부재여도 **대결·건너뛰기·전결 전환 모두 없음**. 최종 결재자 본인이 결재해야만 결재라인이 종료된다(추가 질의에서 “본인만 종료” 선택). |
| **D-3 전결 권한** | [전결] 버튼은 양식별 지정 인원·부서장(`approval_final_rules`)에게만. |
| **D-4 원결재자 조기 복귀** | 대결자에게 넘어간 문서도 원결재자가 처리 가능(`allow_self_act` 기본 1, 부재 설정에서 끌 수 있음). |
| **D-5 출장 부재** | 직접 등록한 부재는 사유(출장 포함)와 무관하게 적용. |
