# To-do · Kanban 블루프린트 (초안 v1)

> 2026-10-13 작성. 사용자 요청: "전자결재로 기안하는 출장·휴가·초과근무 외에 개인적으로 챙겨야 하는 업무 스케줄·미팅 약속을
> 체계적으로 기록·수정하고, 모바일·데스크탑 위젯으로 알림을 받고, 필요하면 팀원·부서원·임원에게 공유하는 To-do 기능.
> 자주 쓰는 기능이므로 가독성과 UI 심미성을 꼼꼼히."
>
> 1부 = 조사 결과 요약(외부 앱 7+9종·기술 패턴), 2부 = 설계(정보 모델·화면·UI·알림·공유·연계),
> 3부 = 구현 계획(마이그 274·API·단계 P0~P4)과 **사용자 결정 논점(§13)**. §13 확정 후 개발에 착수한다.

---

## 1부. 조사 요약

### 1. 개인용 할 일 앱 (Todoist · TickTick · Things 3 · MS To Do · Apple Reminders · Google Tasks · Any.do)

| 기능 | Todoist | TickTick | Things 3 | MS To Do | Apple Reminders | Google Tasks | Any.do |
|---|---|---|---|---|---|---|---|
| 시작일/마감 분리 | ○ Date/Deadline | △ 기간 | ○ When/Deadline | × | × | △ | × |
| 우선순위 단계 | 4 | 4 | ×(태그) | 1(별) | 3+없음 | ×(별) | △ |
| 섹션/헤딩 | ○ | ○ | ○ | × | ○ | × | ○ |
| 하위 작업 깊이 | 다단 | 다단 | 체크리스트 1단 | 1단 | 다단 | 1단 | 다단 |
| 자연어 날짜 | ○ +프로젝트·라벨·우선순위 토큰 | ○ | ○ 날짜만 | ○ 영어 | ○ | × | △ |
| 전역 퀵애드 | ○ Ctrl+Space | ○ | ○ +Autofill | × | △ | × | △ |
| 리스트/보드/캘린더 | ○/○/○ | ○/○/○+타임라인 | ○/×/× | ○/×/× | ○/○(열)/△ | ○/△/○ | ○/○/○ |
| 데일리 요약 알림 | ○ 아침·저녁+메일 | ○ | × | ×(My Day) | × | × | ○ Moment |
| 상호작용 위젯 | ○ | ○ +Live Activity | ○ | ○ | ○ | ○ | ○ |
| 공유·배정 | ○ 1명 | ○ | × | ○ | ○ | △ | ○ |
| 댓글·활동 로그 | ○/○ | ○/△ | × | × | × | × | △ |

**차용 패턴**
1. **"언제 할지(do)"와 "언제까지(due)" 2중 날짜** (Things 3·Todoist) — Today 뷰는 do 날짜로, 긴급 표시는 due로 구동해 "오늘 손댈 일"과 "기한"을 섞지 않는다.
2. **레이아웃(리스트/보드/캘린더) × 정렬 × 그룹을 독립 옵션으로 모든 컬렉션에 공통 적용** (Todoist) — 칸반은 별도 기능이 아니라 같은 데이터의 표시 옵션.
3. **한 줄 퀵애드 토큰 파싱 + 인식 토큰 하이라이트·백스페이스 취소** (Todoist·TickTick·MS To Do). 한국어 날짜 파서는 자체 구현 필요(chrono-node에 ko 로케일 없음).
4. **전역 퀵 엔트리 + Autofill(현재 화면 링크 자동 첨부)** (Things 3) — 계약·사업장 상세에서 호출하면 그 링크를 자동 첨부.
5. **My Day형 오늘 큐레이션 + 전구 제안(기한 도래·초과·어제 미완료·배정됨)** (MS To Do). 자정 리셋 불만이 많으므로 미완료 자동 이월.
6. **아침 요약 푸시(오늘 N건) + 저녁 리뷰(선택)** (Todoist·TickTick).
7. **섹션을 열로 전환하는 경량 칸반** (Apple Reminders·Things 3 헤딩) — 리스트와 보드가 같은 섹션 모델을 공유.
8. **색은 의미에만**(우선순위·마감 초과·완료), 나머지는 중립색 불투명도 위계 (Things 3·Todoist) — 사내 Precision 기준과 합치.
9. **완료 피드백: 원 채움→체크→행 슬라이드 아웃(~0.5s) + Undo 토스트, 완료는 기본 숨김** (Things 3·Todoist).
10. **협업 최소 세트: 담당자 1명·댓글(@멘션)·활동 로그·"나에게 배정됨" 스마트 리스트** (Todoist·TickTick·Reminders).

### 2. 팀 칸반·프로젝트 앱 (Trello · Asana · Linear · Notion · ClickUp · monday · Jira · Planner · GitHub Projects · Flow · Dooray · JANDI)

| 항목 | Trello | Asana | Linear | Notion | ClickUp | monday | Jira | Planner | GitHub |
|---|---|---|---|---|---|---|---|---|---|
| 열 모델 | 자유 리스트 | 섹션(리스트=보드) | 상태 | Group by | Group by | Status 라벨 | 상태 매핑 | 버킷 | 단일선택 |
| WIP 제한 | × | × | × | × | ○ | × | ○ 색 경고 | × | ○ |
| 스윔레인 | × | × | ○ | ○ | ○ | ○ | ○ | × | ○ |
| 상세 UI | 중앙 모달 | 우측 패널 | 전체/피크 | Side peek | Full/Sidebar | 우측 카드 | 모달+전체 | 중앙 모달 | 우측 패널 |
| 작업 단위 공유 | × | ○ 협업자 | Ent. | ○ | ○ | × | 보안레벨 | × | 리포 권한 |
| 팔로워 | Watch | Collaborator | Subscriber | — | Watcher | Subscriber | Watcher | — | Subscribe |
| 이메일 묶음 | 시간당 | Daily summary | 다이제스트 | 비활성 시 | 프리셋 | 전부 | 3~10분 배칭 | 이벤트별 | — |
| 키보드 | 중 | 중 | 최상 | 하 | 중 | 하 | 중 | 하 | 중 |

**30명 규모 권고(조사 결론)**
1. **개인 보드가 기본, 공유는 작업 단위** (Asana 협업자 모델) — 모든 작업은 작성자 전용으로 시작하고, 담당자·참조자를 붙이는 순간 그 작업만 상대에게 보인다. 두레이식 담당자(편집)/참조자(열람) 2단.
2. **상태는 전사 공통 고정 + 보드 열은 자유** (Linear/Jira + Trello) — 상태는 할 일·진행·검토·완료·보류로 고정해 내 작업·통계·완료 숨김을 일관되게 하고, 열은 자유 리스트("이번 주/다음 주")로 두되 열↔상태 매핑을 선택 허용. 30명 규모에 팀별 워크플로우 편집기는 과함.
3. **뷰는 리스트·보드·캘린더 3종 + 내 작업(날짜 묶음)**. 간트·대시보드는 2차.
4. **알림은 배정·멘션·마감·내가 구독한 작업의 댓글/상태만 기본 ON, 메일은 하루 1회 요약** — Asana·monday "새 작업 전부 알림" 과다 알림 교훈.
5. **공유 보드는 프로젝트(용역)·부서 단위만, 게스트 없음** — 권한 3단(개인/멤버/관리자).

**차용 패턴**: 열 제한은 경고 색만(Jira), 접힌 열은 이름+개수(Trello), 카드 노출 속성 선택(Notion), 상세는 우측 피크(Notion·Asana), 구독 자동 가입+해제(Linear), 읽은 알림은 메일 생략(Trello·Linear·Jira), 내 작업 날짜 묶음(monday My Work), 빠른 캡처 인박스(Trello Inbox), 체류일 점(Jira Days in column).

### 3. 알림·위젯·입력 기술 패턴

| 영역 | 조사 결론 | 이 스택에서의 선택 |
|---|---|---|
| 리마인더 발송 주체 | iOS 로컬 예약 알림은 앱당 64개 한도, 다기기 완료 동기화 불가 | **서버 발송**(`sendPush` + tick) 단일화 |
| 기본 시각 | 종일 09:00(Apple·TickTick), 시간 작업 30분 전(Todoist), 아침 요약 | 종일 **09:00** / 시간 **30분 전** / 아침 요약 **08:30**, 사용자 설정 가능 |
| 알림 액션 | expo-notifications `setNotificationCategoryAsync`로 완료/스누즈 버튼 가능 | 2차(네이티브 빌드 동반) |
| 모바일 홈 화면 위젯 | 네이티브 타겟 → **OTA 불가, 스토어 재배포 필요**. Android `react-native-android-widget`(30분 갱신), iOS `@bacons/apple-targets` | **P4로 분리**(스토어 배포 일정과 묶음) |
| 데스크탑 위젯 | Tauri notification 플러그인은 데스크탑에서 표시 전용(클릭 액션 없음), 전역 단축키 플러그인 가능 | 기존 postMessage 브릿지에 `mcm:todo-due` 추가, 전역 단축키는 2차 |
| 웹 알림 | Web Push는 데스크탑 Chrome/Edge 옵트인 가치만 | 2차. 1차는 상단 벨과 분리된 **할 일 뱃지**(메뉴·홈 카드) |
| 자연어 날짜 | 한국어 파서 오픈소스 없음(datecapture 소규모) | 자체 규칙 파서(어휘 ~30종), 서버·앱·위젯 공용 TS 모듈 |
| 반복 | RRULE에 "완료 후 N일" 없음, Todoist는 지난 반복 완료 시 다음 미래 발생으로 | 프리셋 6종 + `after_completion` 모드. 라이브러리 없이 자체 계산 |
| DnD(웹) | `@hello-pangea/dnd` 18(React 19 peer, 키보드·터치 내장) vs 기존 HTML5 네이티브 패턴 | §13 결정 |
| 순서 저장 | fractional indexing 문자열 키(LexoRank는 리밸런싱 비용) | `position text COLLATE "C"` |
| 캘린더 | 할 일을 종일/시간 블록으로 캘린더 그리드에, ICS 피드는 토큰 URL | 기존 `/calendar`에 태그 추가, ICS는 2차 |

### 4. 기존 코드베이스 연계점 (탐색 결과)

- **일정 모델**: `lib/calendar/types.ts` `CalendarEvent`(tag·kind·startDate·endDate·people·status)와 `TAG_COLOR`가 홈·일정·자산 공용. `/api/calendar`가 휴가·출장·교육·영업·차량·회의·면접을 합친다. **초과근무는 어느 캘린더에도 없다.**
- **전자결재**: `approval_docs.field_values`에 `leave_period`·`trip_period`·`edu_period`·`work_period`({from,to}). 승인 후 훅 `runFormActionsForDoc` + `ACTION_CONNECTORS` 화이트리스트(`lib/approval/actions.ts:483`)에 커넥터를 추가하면 "승인되면 To-do 자동 생성"이 가능.
- **알림**: `alerts` 테이블은 수신자 없는 전사 운영 알람(ack 권한 `data.review`) → 개인 알림함으로 부적합. 푸시는 `lib/notify/push-expo.ts` `sendPush(userIds, {event,title,body,link,dedupKey})` + `mobile_push_tokens`·`mobile_notify_prefs`·방해금지·`mobile_push_log` dedup이 완비. `PushEventKey`에 키 추가만 필요. 주기 작업은 `instrumentation.ts` → `/api/internal/*-tick`(cron-key).
- **모바일 앱**: `apps/mobile`(Expo 57·expo-router·NativeWind). 더보기 탭 '업무' 섹션이 진입점. 딥링크 `src/lib/deeplink.ts` `routeForLink`에 `/todo` 분기 추가 필요(없으면 푸시 탭해도 이동 안 함). OTA는 `eas update --branch production --environment production`.
- **데스크탑 위젯**: `apps/desktop` Tauri가 `https://koensain.app/m-app`(모바일 앱 웹 export) iframe. **모바일 앱에 To-do 화면을 만들면 m-app 재export + next 배포만으로 위젯에도 반영.** 브릿지 `apps/mobile/src/lib/use-widget-bridge.ts`(`mcm:unread` 15초 폴링)에 메시지 타입 추가 시 셸 HTML 변경 → 인스톨러 재배포.
- **메신저**: `chat_messages.kind` CHECK(text/file/image/system). 카드 공유는 제약 변경 필요 → 1차는 텍스트+링크.
- **사용자**: 계정 `users.user_id`(푸시·메신저·결재선), 조직 `employee_profiles.employee_id`(user_id로 매핑). 임원 전용 컬럼 없음 → 템플릿 `tpl-exec`, 부서장 `tpl-dept-lead`, `departments.parent_dept_id` 트리.
- **관례**: id text(`crypto.randomUUID`), 시각 ISO text, 날짜 `YYYY-MM-DD` text, 시간 `HH:mm`, 불리언 int 0/1, `created_by`=user_id. 응답 `{ items }` / `{ error }`. 검증은 lib 수작업. 페이지는 `page.tsx` 얇은 래퍼 + `components/<도메인>/*Board.tsx`. 새 테이블 GRANT는 265 default privileges가 자동 처리.
- **이름 충돌**: `work_tasks`·`/api/work-tasks`·`lib/work-plan/tasks.ts`가 업무추진계획 도메인에 존재 → 신규는 **`todo_*`**.
- **유사 기능**: H9 업무보고 할 일(집계만), `work_plan_directives`(지시, issued_by/issued_to), `work_plan_issues`. 중복 구현하지 않고 **To-do의 연결 대상·제안 소스**로 쓴다.
- **라이브러리**: DnD·날짜·캘린더 라이브러리 없음. 기존 DnD는 HTML5 네이티브(`ApprovalFormsBoard`·contracts 재정렬)와 pointer(`HomeEditGrid`).
- **메뉴**: `config/menu.ts` + `tests/menu-route.test.ts`의 개수 하드코딩(25/74) 동반 수정. 상단바 "새로 작성" 드롭다운(`TopBar.tsx:115`)과 Ctrl+K `GlobalSearch`가 퀵애드 진입점.

---

## 2부. 설계

### 5. 목표와 원칙

- **대상 사용자**: 전 직원(30명). 직원 플로우는 3탭 이내, 설정 없이 바로 쓰기([[ux-simplicity-first]] 원칙). 복잡한 옵션(열 매핑·반복 상세·알림 세부)은 상세 패널 하단·설정 뒤편으로.
- **한 데이터, 세 뷰**: 리스트(내 할 일) · 보드(칸반) · 캘린더. 뷰는 표시 옵션이며 데이터는 하나.
- **개인이 기본, 공유는 선택**: 작성자 전용으로 시작 → 담당자·참조자 지정 또는 공유 보드로 이동할 때만 남에게 보인다.
- **결재 일정과의 관계**: 출장·휴가·교육·초과근무 등 결재 문서 일정은 **읽기 전용 참조**로 함께 보여 주고(별도 입력 없음), To-do는 그 사이의 개인 업무·미팅·약속을 담는다. 승인 후 후속 할 일(출장보고서 등) 자동 생성은 선택 기능(§13).
- **기존 모듈 재사용**: 푸시(`sendPush`)·캘린더 이벤트 타입·조직 선택기(`AttendeePicker`/`OrgPickerSheet`)·홈 위젯 레지스트리·결재 액션 커넥터·tick 주기 작업·cdash 컴포넌트.
- **UI**: `docs/ui-precision-standard.md` 준수. 8px 반경·불투명 면·1px 중립 경계·카드 그림자 없음·밑줄형 탭. 색은 의미에만.

### 6. 정보 모델

#### 6.1 할 일(`todo_items`)

| 필드 | 타입 | 설명 |
|---|---|---|
| `item_id` | text PK | `td_` + uuid 16자 |
| `board_id` | text FK | 소속 보드(개인 기본 보드 포함, NOT NULL) |
| `column_id` | text FK null | 보드 열. null = 열 미배정(리스트 전용 보드) |
| `parent_item_id` | text FK null | 하위 작업(1단계만 허용, 체크리스트 대체) |
| `title` | text | 필수, 200자 |
| `note` | text | 본문(일반 텍스트 + 줄바꿈, 링크 자동 인식) |
| `status` | text | `todo` · `doing` · `review` · `done` · `hold` (CHECK) |
| `priority` | int | 0 없음 · 1 낮음 · 2 보통 · 3 높음 |
| `do_date` | text null | 언제 할지 `YYYY-MM-DD` (Today 뷰·캘린더 배치 기준) |
| `do_time` | text null | `HH:mm` (있으면 시간 블록, 미팅·약속) |
| `duration_min` | int null | 소요 분(시간 블록 길이, 기본 30) |
| `due_date` | text null | 언제까지(마감). 초과 시 error 색 |
| `all_day` | int | do_time 없음 = 1 |
| `remind_at` | text null | 알림 예정 시각 ISO(서버 tick이 발송). 기본값 §9 규칙으로 자동 계산, 사용자 override |
| `remind_sent_at` | text null | 발송 기록(중복 방지) |
| `snoozed_until` | text null | 스누즈 |
| `recurrence` | text null | 프리셋 문자열 `daily` · `weekdays` · `weekly:MO,WE` · `monthly:15` · `monthly:last` · `yearly:MM-DD` · `after:N`(완료 후 N일). RRULE 호환 확장 여지 |
| `recurrence_parent_id` | text null | 반복 원본(이력 추적) |
| `position` | text | fractional index(`COLLATE "C"`), 열·리스트 내 수동 순서 |
| `link_kind` / `link_id` / `link_label` | text null | 연결 대상: `contract` · `facility` · `sales_project` · `approval_doc` · `work_task` · `directive` · `url` |
| `color` | text null | 카드 색 띠(보드 공유 시 분류용, 선택) |
| `owner_user_id` | text | 작성자(users.user_id) — 삭제·공유 범위 변경 권한 |
| `assignee_user_id` | text null | 담당자 1명(기본 = owner) |
| `completed_at` / `completed_by` | text null | 완료 |
| `archived_at` | text null | 보관(완료 후 30일 자동) |
| `created_at`/`created_by`/`updated_at`/`updated_by` | text | 관례 |

- `status='done'` ⇔ `completed_at` 존재. 체크 = done 전환. 열↔상태 매핑이 있는 보드에서는 열 이동이 상태를 바꾼다.
- 반복 완료 시 **현재 행을 done 처리하고 다음 발생 행을 새로 생성**(Todoist 방식, 지난 반복은 다음 미래 발생으로 건너뜀).

#### 6.2 보드·열(`todo_boards`, `todo_columns`)

| 테이블 | 핵심 필드 |
|---|---|
| `todo_boards` | `board_id`, `name`, `kind`(`personal` · `project` · `dept` · `shared`), `owner_user_id`, `scope_ref`(project: `contract_id`/`sales_project_id`, dept: `dept_id`), `is_default`(개인 기본 보드 1), `layout`(`list` · `board`), `column_status_map`(int, 열↔상태 매핑 사용 여부), `archived_at` |
| `todo_columns` | `column_id`, `board_id`, `name`, `position`, `status_map`(text null: 이 열에 놓이면 바뀔 status), `wip_limit`(int null, 초과 시 헤더 경고색만), `collapsed`(int, 사용자별 아님 → 1차는 보드 공통) |

- 개인 기본 보드는 첫 접근 시 자동 생성(열: 할 일 · 진행 중 · 완료, 상태 매핑 on). 사용자는 열을 추가·이름 변경·삭제할 수 있다.
- 프로젝트 보드는 계약·영업 프로젝트에 1:1. 멤버 = 기존 수행인력(`service_participants`)+수동 추가.

#### 6.3 공유·협업

| 테이블 | 핵심 필드 |
|---|---|
| `todo_board_members` | `board_id`, `user_id`, `role`(`admin` · `member` · `viewer`), `added_by`, `created_at` |
| `todo_item_shares` | `item_id`, `user_id`, `role`(`assignee` · `collaborator`(편집) · `watcher`(열람·알림)), `added_by`, `created_at`. 개인 보드의 작업을 특정인에게 공유 |
| `todo_comments` | `comment_id`, `item_id`, `user_id`, `body`, `mentions jsonb`, `created_at`, `deleted_at` |
| `todo_activity` | `activity_id`, `item_id`, `user_id`, `action`(`create` · `status` · `assign` · `due` · `move` · `share` · `comment` · `complete` · `reopen`), `detail jsonb`, `created_at` |
| `todo_checklist` | 체크리스트는 **하위 작업(parent_item_id)으로 통일** — 별도 테이블 없음 |

**가시성 규칙**(서버 단일 함수 `canSeeItem(userId, item)`):
1. 보드 멤버(admin/member/viewer)는 보드의 모든 작업을 본다.
2. 개인 보드 작업은 owner + `todo_item_shares`에 있는 사람만.
3. 관리자(`todo.admin` 권한)는 보드 목록·멤버 관리만 가능하고 **개인 작업 본문은 보지 못한다**(개인 메모 성격 보호).
4. 부서장·임원 공유는 "부서 보드로 이동" 또는 "작업을 그 사람에게 공유"로만 — 자동 상향 공개 없음.

#### 6.4 알림·설정

| 테이블 | 핵심 필드 |
|---|---|
| `todo_user_prefs` | `user_id`, `default_remind_all_day_time`(기본 `09:00`), `default_remind_before_min`(기본 30), `digest_time`(기본 `08:30`, null=끔), `evening_review_time`(null), `quick_add_parse`(1), `week_start`(1=월), `card_density`(`comfortable` · `compact`), `show_done_days`(7) |
| `todo_notifications` | 인앱 알림함(2차). 1차는 푸시 + 홈 카드 + 메뉴 뱃지로 대체 |

푸시 이벤트 키(`PushEventKey` 추가): `todo.remind`(마감·예정 알림), `todo.digest`(아침 요약), `todo.assigned`, `todo.comment`(멘션·댓글), `todo.status`(내가 구독한 작업의 완료/검토 요청). 수신 설정 화면은 기존 `/api/mobile/push/prefs` 목록을 따라 **앱 수정 없이** 노출된다.

### 7. 화면 설계 — 웹

#### 7.1 진입점
- **사이드바 메뉴 1개**: `collab` 그룹 "할 일"(`/todo`), 아이콘 `ListChecks`, 뱃지 = 오늘+지연 건수(`MenuBadgeKey` 추가). 권한 키 없음(전 직원), 관리자 화면만 `todo.admin`.
- **상단바 "새로 작성" 드롭다운**에 "새 할 일" 추가 → 퀵애드 모달. 현재 경로가 계약·사업장·영업·결재 상세면 그 링크를 자동 첨부(Autofill).
- **홈 위젯** `TodoTodayCard`(H12): 오늘·지연·이번 주 상위 5건 + 체크 + 퀵애드 한 줄. `HOME_WIDGETS` 등록.
- **Ctrl+K** 전역 검색에 "할 일: <제목>" 생성 명령 추가(2차).

#### 7.2 `/todo` 페이지 구조 (단일 페이지, `CdTabs` 밑줄형)

```
CdPageHeader  제목 "할 일"  · meta "오늘 3 · 지연 1 · 이번 주 8"  · actions [새 할 일] [보드 ▾]
탭: 내 할 일 | 보드 | 캘린더 | 공유받음          (우측: 표시 ▾ 정렬·그룹·완료 표시·밀도)
──────────────────────────────────────────────────────────────────────
[퀵애드 입력줄]  "내일 오후 3시 ○○사 미팅 !높음 #영업 @홍길동"   → 토큰 칩 미리보기
──────────────────────────────────────────────────────────────────────
(탭 본문)                                              │ (우측 상세 드로어, 선택 시)
```

- **내 할 일(리스트)**: monday My Work식 날짜 묶음 섹션 — **지연 · 오늘 · 내일 · 이번 주 · 다음 주 · 이후 · 날짜 없음**. 각 섹션 헤더에 건수, 접기. 행 = 체크 원 · 우선순위 색 점 · 제목 · (하위 n/m) · 연결 아이콘 · 마감 배지 · 담당 아바타. 결재 일정(출장·휴가·교육·초과근무)은 같은 날짜 섹션에 **회색 읽기 전용 행**으로 끼워 넣어 하루 그림이 한 화면에 보인다(토글로 숨김).
- **보드(칸반)**: 보드 선택기(개인 기본 · 내 프로젝트 보드 · 부서 보드). 열은 가로 스크롤, 열 폭 **280px**, 열 헤더 = 이름 · 건수(/WIP) · ⋯(이름 변경·상태 매핑·접기·삭제). 접힌 열은 폭 40px 세로 이름+건수. 카드 DnD(열 간·열 내). 열 하단 "+ 할 일 추가" 인라인 입력. 빈 열은 점선 영역 + "여기로 끌어오세요".
- **캘린더**: 기존 `CalendarBoard` 재사용 — `/api/calendar`에 태그 `todo`(색 `TAG_COLOR` 신규) 추가. 종일(do_time 없음)은 종일 영역, 시간 있는 건 시각 위치. 월 격자에서 날짜 드래그로 `do_date` 변경(기존 격자가 DnD 미지원이면 2차). "날짜 없음" 사이드 목록 → 그리드 드롭(2차).
- **공유받음**: `todo_item_shares`에 내가 있는 작업 + 내가 멤버인 보드의 "나에게 배정됨". 섹션: 나에게 배정 · 참조 · 보드별.

#### 7.3 상세 패널(우측 `CdDrawer`, `widthClass="max-w-xl"`)

```
[✓] 제목(인라인 편집, 16px/600)                      [⋯ 복제·이동·보관·삭제] [×]
상태 세그먼트: 할 일 | 진행 중 | 검토 | 완료 | 보류          우선순위: ○ 없음 ● 낮 ● 보통 ● 높
────────────────────────────────
언제 할지  [CdDateInput] [HH:mm] [30분 ▾]      언제까지  [CdDateInput]
알림       [기본(09:00) ▾] 반복 [없음 ▾]
담당       [아바타 + 이름 ▾]   공유  [+ 참조자]    보드/열  [개인 › 진행 중 ▾]
연결       [계약 ○○ 사업장 ▸]  (+ 연결 추가)
────────────────────────────────
메모 (textarea, 자동 저장)
하위 작업  ☐ ○○○   ☐ ○○○   [+ 추가]            (n/m 진행 막대)
댓글 (@멘션)  …                                    활동 로그(접기)
```
- 자동 저장(디바운스 600ms) + 저장 상태 문구("저장됨 · 방금"), 실패 시 입력 보존·재시도.
- 키보드: `Esc` 닫기, `Ctrl+Enter` 댓글 전송, `Alt+1~5` 상태.

#### 7.4 퀵애드 파서(공용 TS 모듈 `lib/todo/quick-parse.ts`)

| 입력 | 해석 |
|---|---|
| 오늘 / 내일 / 모레 / 글피 | do_date |
| 이번 주 금 / 다음 주 월 / 다다음 주 수 | do_date(주 시작 월) |
| 3일 뒤 / 2주 뒤 / 10/21 / 10월 21일 / 21일 | do_date |
| 오후 3시 / 15:00 / 15시 반 / 오전 9시 | do_time |
| ~까지 / 마감 10/30 | due_date |
| 매일 / 평일 / 매주 월·수 / 매월 15일 / 매월 말일 / 완료 후 7일 | recurrence |
| `!높음` `!보통` `!낮음` 또는 `!1~3` | priority |
| `#보드명` 또는 `#열이름` | board/column |
| `@이름` | assignee/share(조직 스냅샷에서 이름 매칭, 동명이면 선택 팝업) |
| `//메모` | note |

- 인식 토큰은 입력줄 아래 **칩**으로 미리보기(날짜·시간·마감·반복·우선순위·보드·담당). 칩 `×`로 해제하면 해당 텍스트는 제목에 남는다. 설정에서 파싱 끄기.
- IME 조합 중에는 파싱하지 않고 `compositionend` 후 실행.

#### 7.5 완료·되돌리기
- 체크 클릭: 원 테두리 → 채움(120ms) → 체크 아이콘 → 행 `opacity 0 + height 0`(240ms) → 섹션에서 제거. 토스트 "완료 · 되돌리기"(5초). `prefers-reduced-motion`이면 즉시 제거.
- 완료 항목은 기본 숨김, "완료 표시(7일)" 토글로 회색 취소선 표시. 30일 후 자동 보관.

#### 7.6 접근성·키보드
- 리스트: `↑/↓` 이동, `Space` 체크, `Enter` 상세, `N` 새 할 일, `D` 날짜 팝오버, `1~3` 우선순위, `X` 다중 선택 → 하단 일괄 바(날짜·상태·보드 이동·삭제).
- 보드 DnD에는 **키보드 대체 경로**(카드 ⋯ 메뉴 "이동: 왼쪽 열/오른쪽 열/맨 위/맨 아래") + `aria-live` 공지.
- 모든 아이콘 버튼에 `label`, 포커스는 2px outline offset -2px(Precision 규칙).

### 8. UI 디자인 규칙 (Precision 적용)

| 항목 | 값 |
|---|---|
| 면·경계 | 카드 `--cd-card` 불투명, 1px `--cd-border`, 반경 8px, 그림자 없음. 보드 열 바탕 `--cd-surface`(카드와 1단계 대비), 열 안 카드는 흰 면 |
| 글자 | 제목 22px, 섹션/열 헤더 14px/600, 카드 제목 14px/500, 메타 12px `--cd-muted`, 날짜 배지 12px tabular-nums |
| 간격 | 카드 패딩 12px, 카드 간 8px, 열 간 12px, 리스트 행 높이 44px(hover `--cd-hover`) |
| 카드 구성 | (색 띠 3px 좌측, 선택) · 1행 제목(2줄 말줄임) · 2행 메타: 마감 배지 · 하위 n/m · 연결 아이콘 · 댓글 수 · 우측 담당 아바타 xs(20px) |
| 색 — 의미에만 | 우선순위 점: 높음 `--cd-error`, 보통 `--cd-warning`, 낮음 `--cd-primary`, 없음 `--cd-faint` 테두리. 마감: 초과 `--cd-error-soft` 배경+error 글자, 오늘 `--cd-warning-soft`, 이후 중립. 완료 `--cd-muted` 취소선. 보드 열 색 없음(WIP 초과 헤더만 error 글자) |
| 결재 일정 행 | 기존 `TAG_COLOR`의 휴가·출장·교육 색 점 + 회색 글자, 체크 없음, 클릭 시 문서 열기 |
| 상태 세그먼트 | `.cd-choice` 세그먼트(기존 공용), 선택은 옅은 그라데이션 7→14% |
| 탭 | `CdTabs` underline |
| 밀도 | 설정 `comfortable`(기본) / `compact`(행 36px·카드 패딩 8px) |
| 다크 | 동일 토큰, 색 띠·배지 soft 색은 다크 변형 사용 |
| 빈 상태 | `CdEmptyState` 아이콘+한 문장+"새 할 일" 버튼. 검색 0건과 구분 |
| 반응형 | <1024px: 상세 드로어 전폭, 보드 열 폭 260px 가로 스크롤 + 스냅. <768px: 리스트 탭 기본, 보드는 세로 리스트 전환(열 = 접이식 섹션) |

### 9. 알림 설계

| 트리거 | 채널 | 기본값 | 중복 방지 키 |
|---|---|---|---|
| 예정/마감 알림 | 푸시(`todo.remind`) + 데스크탑 위젯 OS 알림 | 종일 → do_date(또는 due_date) 09:00 · 시간 있음 → 30분 전 · 둘 다 있으면 각각 | `todo-remind:<item_id>:<remind_at>` |
| 아침 요약 | 푸시(`todo.digest`) | 08:30 "오늘 할 일 3건 · 지연 1건", 0건이면 발송 안 함 | `todo-digest:<user>:<date>` |
| 저녁 리뷰 | 푸시 | 꺼짐(설정에서 시각 지정) | `todo-review:<user>:<date>` |
| 배정됨 | 푸시(`todo.assigned`) | 켜짐 | `todo-assign:<item>:<user>` |
| 댓글·멘션 | 푸시(`todo.comment`) | 켜짐(멘션은 항상, 댓글은 구독자만) | `todo-comment:<comment_id>:<user>` |
| 상태 변경 | 푸시(`todo.status`) | 내가 owner/assignee/watcher인 작업의 완료·검토 요청만 | `todo-status:<item>:<status>:<user>` |
| 메일 | `sendNotifyEmail` | 꺼짐. 켜면 하루 1회 요약만(아침) | — |

- 발송기: `app/api/internal/todo-remind-tick/route.ts`(5분 주기, `instrumentation.ts` 등록). `remind_at <= now AND remind_sent_at IS NULL AND status NOT IN (done)` → `sendPush` → `remind_sent_at` 기록. 기존 `mobile_notify_prefs`·방해금지·`mobile_push_log` dedup 그대로 적용.
- 스누즈(앱·웹 상세): 10분 · 1시간 · 3시간 · 내일 09:00 → `snoozed_until`에 새 `remind_at` 재설정.
- 데스크탑 위젯: `use-widget-bridge.ts`가 15초 폴링에 `/api/todo/due-soon`을 추가하고 `mcm:todo-due {count, items}` 전송 → 셸이 `sendNotification` + 배지 합산. 셸 HTML 변경 → 인스톨러 재배포(WID-P3). 전역 단축키 퀵애드는 그 다음.
- 모바일 딥링크: `routeForLink`에 `/todo?item=` → `/todo/[itemId]` 매핑 추가.
- 인앱 알림함(벨)은 2차. 1차는 메뉴 뱃지(오늘+지연)와 "공유받음" 탭의 미확인 점으로 대신한다.

### 10. 공유 설계

| 방식 | 사용 장면 | 동작 |
|---|---|---|
| **작업 공유**(담당/참조) | "이 건 ○○씨가 해 주세요", "부장님 참고" | 상세 패널 담당/공유 칸에서 사람 선택(`AttendeePicker` 재사용). 상대의 "공유받음" 탭 + 푸시. 참조자는 열람·댓글만 |
| **프로젝트 보드** | 용역 수행 팀의 공동 보드 | 계약·영업 프로젝트에서 "할 일 보드 만들기" → 수행인력 자동 멤버. 보드 탭에 노출 |
| **부서 보드** | 부서장이 부서 과제 관리 | 부서장(`tpl-dept-lead`)·임원이 생성, 부서원 자동 member. 열 기본 = 할 일·진행·완료 |
| **메신저로 보내기** | 대화 중 할 일 언급 | 상세 ⋯ "메신저로 공유" → 대화방 선택 → `postTextMessage("📌 할 일: 제목 · 마감 10/30\nhttps://koensain.app/todo?item=…")`. 카드형은 2차(kind 제약 변경) |
| **개인 보드 작업을 보드로 이동** | 개인 메모였던 건을 팀 보드로 승격 | 상세 보드/열 선택. 이동 시 활동 로그 기록, 공유 대상 안내 문구 상시 표시("이동하면 보드 멤버 N명에게 보입니다") |

- 공유 해제·삭제는 owner만. 담당자는 상태·날짜·메모 편집 가능, 참조자는 댓글만.
- 임원 공유: 별도 "임원 보기" 기능은 두지 않고(개인 작업 보호), 작업 공유·부서 보드 멤버로만.

### 11. 전자결재·기존 기능 연계

| 연계 | 1차 범위 | 방법 |
|---|---|---|
| 결재 일정 읽기 표시 | ○ | `listCalendarEvents` 결과(휴가·출장·교육) + **초과근무(`work_period`) 추가 조회**를 "내 할 일" 날짜 섹션과 캘린더에 회색 행으로. 문서 클릭 → `/approval?docId=` |
| 승인 후 후속 할 일 자동 생성 | §13 결정 | `ACTION_CONNECTORS`에 `todo.create` 커넥터 추가. 양식별 템플릿: 출장 승인 → "출장보고서 작성"(due = 종료일+3일), 교육 → "교육결과 보고", 초과근무 → 없음. 사용자가 양식 빌더에서 켜고 끔 |
| 홈 H9 업무보고 할 일 | 연결만 | H9는 유지, To-do 상세 "연결"에 `work_task`·`directive` 선택 가능. 지시(`work_plan_directives`) 수신자가 "할 일로 추가" 버튼(2차) |
| 영업 활동 | 연결 | `sales_project` 연결 + 상세에서 "영업 상세 열기". 영업 일정(`sales_activities`)은 캘린더에 이미 표시 |
| 계약·사업장 | 연결 + Autofill | 상세 페이지에서 "새 할 일" 호출 시 자동 연결 |

### 12. 모바일 앱 · 데스크탑 위젯

- **Expo 앱**(`apps/mobile`): 
  - 진입: 더보기 '업무' 섹션 "할 일" + **홈 위젯 카드**(`src/components/home/widgets.tsx`에 오늘 N건·상위 3건·체크·"+" ).
  - 화면: `src/app/todo/index.tsx`(`SegmentedTabs`: 오늘 · 예정 · 보드 · 공유받음), `todo/[itemId].tsx`(상세 = `Sheet` 풀높이), 퀵애드 = 하단 고정 입력줄(`Input` + 파서 칩).
  - 보드는 세로 리스트(열 = 접이식 섹션, 이동은 카드 길게 누름 → 열 선택 시트). 가로 칸반 DnD는 2차(reanimated·gesture-handler 활용).
  - 체크 애니메이션은 reanimated로 동일 타이밍.
  - 딥링크·푸시 설정 항목 자동 노출. OTA로 배포(네이티브 모듈 추가 없음 → `eas update --branch production --environment production`).
- **데스크탑 위젯**: m-app 재export(`frontend/public/m-app`)로 "할 일" 탭이 그대로 뜬다. 세로 탭바 `material` 변형 유지. OS 알림·배지 브릿지 확장은 WID-P3(인스톨러 재배포).
- **모바일 홈 화면(OS) 위젯**: P4. Android `react-native-android-widget`, iOS `@bacons/apple-targets`. 스토어 재배포 필요([[store-distribution-progress]]와 연동).

---

## 3부. 구현 계획

### 13. 사용자 결정 논점 ★

| # | 논점 | 선택지 | 권고 |
|---|---|---|---|
| 1 | 웹 칸반 DnD 구현 | (a) `@hello-pangea/dnd` 18 도입(React 19 peer·키보드·터치 내장, +1.26MB unpacked) (b) 기존 HTML5 네이티브 패턴 직접 구현(라이브러리 0, 터치·키보드는 수작업) | **(a)**. 칸반은 DnD 품질이 체감 품질이고 접근성 대체 경로까지 직접 짜는 비용이 더 큼 |
| 2 | 상태 체계 | (a) 5단계 고정(할 일·진행·검토·완료·보류) (b) 3단계(할 일·진행·완료) | **(a)**. 검토(상사 확인 요청)와 보류가 공유 시나리오에 필요. 개인 보드 기본 열은 3개만 노출 |
| 3 | 결재 승인 후 후속 할 일 자동 생성 | (a) P2에 포함(출장→출장보고서, 교육→결과보고) (b) 제외 | **(a)**, 단 양식별 on/off. 출장보고 누락이 실제 반복 이슈라면 효과 큼 |
| 4 | 메뉴 위치 | (a) `collab` 그룹 "할 일" 1개 신설 (b) 홈 위젯+상단 "새로 작성"만(메뉴 없음) | **(a)**. 자주 쓰는 기능은 1클릭 진입이 필요. 메뉴 1개 추가로 제한 |
| 5 | 우선순위 단계 | (a) 3단계+없음 (b) 4단계(Todoist) | **(a)**. 색 3개면 충분, 의미색 매핑이 깔끔 |
| 6 | 부서 보드 생성 권한 | (a) 부서장·임원·관리자 (b) 누구나 | **(a)** |
| 7 | 캘린더 통합 방식 | (a) 기존 `/calendar`에 `todo` 태그 추가(+`/todo` 캘린더 탭은 같은 컴포넌트 재사용) (b) `/todo` 전용 캘린더 별도 구현 | **(a)**. 일정 화면이 하나여야 혼란 없음 |
| 8 | 아침 요약 푸시 기본값 | (a) 켜짐 08:30 (b) 꺼짐(옵트인) | **(a)**. 0건이면 미발송이라 소음 적음 |
| 9 | 1차 배포 범위 | P0+P1(웹 리스트·보드·상세·퀵애드·알림) vs P0~P2(모바일까지) | **P0~P2를 한 배포 묶음**으로. 알림은 모바일 앱이 있어야 체감됨 |

### 14. 데이터 마이그레이션 (`infra/aws/274_todo_kanban.sql`, 번호는 착수 직전 `git fetch` 재확인)

- 테이블 8개: `todo_boards`, `todo_columns`, `todo_items`, `todo_board_members`, `todo_item_shares`, `todo_comments`, `todo_activity`, `todo_user_prefs`. 모두 `CREATE TABLE IF NOT EXISTS`, id text, 시각 ISO text, 불리언 int.
- 인덱스: `todo_items(assignee_user_id, status, do_date)`, `(owner_user_id, status)`, `(board_id, column_id, position)`, `(remind_at) WHERE remind_sent_at IS NULL AND status <> 'done'`, `(due_date)`, `todo_item_shares(user_id)`, `todo_activity(item_id, created_at)`.
- CHECK: `status IN ('todo','doing','review','done','hold')`, `priority BETWEEN 0 AND 3`, `kind`, `role`.
- 권한 키 1개: `todo.admin`(보드·멤버 관리, 전사 보드 목록) — `tpl-system-admin`(all)·`tpl-exec`(all) grant. 일반 사용은 권한 키 없이 `requireSession` + 가시성 함수.
- 푸시 이벤트: `PUSH_EVENTS`에 5종 추가(코드, `mobile_notify_prefs`는 기본 enabled).
- `work_tasks`와 무관(이름 충돌 회피 확인).

### 15. API (`frontend/app/api/todo/**`, 로직 `frontend/lib/todo/`)

| 경로 | 메서드 | 내용 |
|---|---|---|
| `/api/todo/items` | GET | `?view=my\|board\|shared&board=&from=&to=&done=` 가시성 적용 목록 + 결재 일정(옵션 `withApproval=1`) |
| `/api/todo/items` | POST | 생성(퀵애드 파싱은 클라이언트, 서버는 정규화·검증) |
| `/api/todo/items/[id]` | GET/PATCH/DELETE | 상세(하위·댓글·활동 포함), 부분 수정(상태·날짜·열·position·공유), 삭제(owner) |
| `/api/todo/items/[id]/complete` | POST | 완료/되돌리기, 반복이면 다음 발생 생성 |
| `/api/todo/items/[id]/snooze` | POST | 스누즈 |
| `/api/todo/items/[id]/comments` | GET/POST | 댓글(@멘션 푸시) |
| `/api/todo/items/[id]/share` | POST/DELETE | 담당·참조 |
| `/api/todo/items/[id]/send-chat` | POST | 메신저 텍스트 공유 |
| `/api/todo/boards` | GET/POST | 내 보드 목록·생성(개인 기본 자동) |
| `/api/todo/boards/[id]` | PATCH/DELETE | 이름·레이아웃·보관 |
| `/api/todo/boards/[id]/columns` | POST/PATCH/DELETE | 열 CRUD·순서·상태 매핑·WIP |
| `/api/todo/boards/[id]/members` | GET/POST/DELETE | 멤버 |
| `/api/todo/prefs` | GET/PATCH | 사용자 설정 |
| `/api/todo/due-soon` | GET | 위젯 브릿지용(다음 24h) |
| `/api/home/todo-today` | GET | 홈 위젯 |
| `/api/internal/todo-remind-tick` | POST | 알림 발송(cron-key) |
| `/api/calendar` | GET | 기존 라우트에 `todo` 태그 소스 추가 |
| `/api/nav/badges` | GET | `todo` 뱃지 추가 |

- 모든 쓰기 응답은 갱신된 항목을 돌려준다(`{ item }`), 목록은 `{ items, boards }`. 오류 `{ error }`.
- 활동 로그는 PATCH 안에서 diff 기반 자동 기록. 푸시는 커밋 후 fire-and-forget + dedupKey.

### 16. 단계별 구현 계획

| 단계 | 범위 | 산출물 | 검증 |
|---|---|---|---|
| **P0 기반** | 마이그 274 · `lib/todo/{store,types,visibility,quick-parse,recurrence}.ts` · API 전부 · 푸시 이벤트 키 · tick | 서버 완결 | `node:test`로 quick-parse·recurrence·visibility 단위 테스트(기존 `frontend/tests` 관례) |
| **P1 웹 화면** | `/todo` 페이지(내 할 일·보드·공유받음 탭, 상세 드로어, 퀵애드, 완료 애니메이션, DnD, 키보드) · 메뉴+뱃지 · 상단 "새 할 일" · 홈 위젯 · `/calendar` todo 태그 | 데스크탑 사용 가능 | tsc 필터, 메뉴 테스트 개수 수정, 라이트/다크·1440/1024/390·키보드 실측 스크린샷 |
| **P2 모바일 앱 + 위젯 콘텐츠** | `apps/mobile` todo 화면 4종 · 홈 위젯 카드 · 딥링크 · 푸시 설정 노출 · m-app 재export | 알림 체감 완성 | OTA 발행 후 `.hbc` 호스트 확인, 푸시 실기기 1건, 위젯 iframe 확인 |
| **P3 연계·협업 심화** | 결재 승인 커넥터(§13-3) · 프로젝트/부서 보드 생성 UI · 메신저 공유 · 캘린더 드래그 재일정 · 데스크탑 위젯 OS 알림 브릿지(인스톨러 재배포) · 인앱 알림함 | 공유 시나리오 완성 | 결재 승인→할 일 생성 E2E, 위젯 설치본 알림 실측 |
| **P4 확장(선택)** | OS 홈 화면 위젯(Android/iOS, 스토어 재배포) · 전역 단축키 퀵애드(Tauri) · ICS 피드 · 알림 액션 버튼(네이티브 빌드) · 메신저 카드형 공유 | — | 스토어 배포 일정과 결합 |

- 브랜치: `claude/todo-kanban`(최신 `origin/main`에서 분기). 배포는 `staging-deploy-next.ps1 -AcknowledgePinnedScheduleLag -Wait`(ADT·intel 표 스키마 변경 없음).
- 예상 규모: P0 ≈ 1,800줄(SQL 250·lib 900·API 650), P1 ≈ 2,500줄, P2 ≈ 1,500줄.

### 17. 위험·주의

- **개인 작업 보호**: 관리자도 개인 보드 본문을 보지 못하게 가시성 함수를 단일 진입점으로 두고 모든 조회가 통과하게 한다(권한 우회 경로 금지).
- **날짜 판정 KST**: 서버 tick은 UTC이므로 `+9h` 보정(`lib/home/work-plan-todo.ts:9` 패턴). 아침 요약·종일 알림 시각 계산 모두 KST.
- **반복 폭주 방지**: 완료 시에만 다음 발생 1건 생성(미리 생성 금지). `after:N`은 완료일 기준.
- **알림 과다**: 기본 ON은 §9 표만. "보드에 새 작업" 알림은 두지 않는다.
- **DnD와 필터 불일치**: 필터 중 열 이동으로 카드가 사라지는 Asana 함정 → 이동 직후 토스트 "필터 때문에 숨겨짐 · 보기".
- **메뉴 테스트**: `tests/menu-route.test.ts` 개수(25→26, submenu 74) 수정 동반.
- **OTA 범위**: P2는 네이티브 모듈 추가 없이 설계(위젯·알림 액션은 P4).

### 18. 확정·진행 기록

- **2026-10-13 사용자 확정**: §13 9건 전부 권고안대로. 브랜치 `claude/todo-kanban`(origin/main `cfe2e6e` 분기). 마이그 274 번호 원격 전 브랜치 확인 완료.
- **UI 시안(Claude Design)**: 사용자 요청으로 Design 캔버스에 아트보드 8종 작성 — https://claude.ai/artifact/HQKjoAcZiSvm6V6eFZsaxD
  (내 할 일 리스트 · 보드 칸반 · 상세 드로어 · 다크 보드 · 모바일 오늘 · 모바일 보드+열 이동 시트 · 홈 위젯 카드 · 퀵애드 토큰 인식). P1 구현은 이 시안의 치수·색·배치를 기준으로 하고, 시안 수정 요청은 캔버스에서 받는다.
- **시안 v2(2026-10-13)**: 사용자 피드백("AI 양산형")으로 리스트·보드·상세를 재설계 — 섹션 카드 제거·흰 캔버스 1장·좌측 날짜 레일(22px 숫자)·배지 대신 muted 텍스트 메타·고스트 행 퀵애드·열 배경 없는 칸반·속성 표 드로어. 다크·모바일·위젯·퀵애드 아트보드는 방향 확정 후 동일 언어로 교체 예정.
- **구현 현황(2026-10-13, 브랜치 `claude/todo-kanban` 미커밋)**: P0 서버(274·`lib/todo/*`·API 16종·tick·테스트 27건) / 결재 승인 후속 할 일 커넥터 `todo.create_followup` + 275 배선(출장→출장보고서 작성 +3일, 교육→교육결과 보고 +5일) / P1 `/todo` 페이지(v2 스타일, `components/todo/*`, `@hello-pangea/dnd` 18) + 메뉴·뱃지·상단 "새 할 일"(Autofill)·홈 위젯·통합 일정 `todo` 태그 / P2 모바일(`apps/mobile/src/app/todo/*`, 퀵애드 파서 복제, 홈 위젯, 딥링크). 웹·모바일 tsc 0건, 테스트 33건 통과. **미완**: 스테이징 274·275 적용·실측(승인 대기), 보드 생성·멤버 관리 UI(P3), 모바일 v2 스타일 반영, m-app 재export·OTA, 데스크탑 위젯 알림 브릿지(P3).
- 진행: P0(서버) → P1(웹) → P2(모바일) 순. 단계마다 실측 스크린샷과 함께 보고.

### 19. v4 디자인·구조 보완 요구(2026-10-13 사용자 피드백 누적 — 구현 시 전부 반영)

**디자인(시안 v4 기준, 캔버스 Main/Board/Detail/Mobile)**
1. 색 구분: 프로젝트(보드)별 파스텔 색을 행·카드 **좌측 4px 띠 + 맥락 줄 앞 점**으로. 결재 일정은 `TAG_COLOR`(출장 살구·휴가 하늘·교육 연두·초과근무 노랑). 카드·행 바탕 그라데이션 **금지**(결재 행만 틴트 12% 단색). 지연·오늘 마감·높음은 파스텔 배경 라벨(`#FBE3E3/#9b2222`, `#FDEBD3/#8a4b06`).
2. 상단 요약(오늘·지연·이번 주·공유받음)은 **태그 버튼**(클릭=필터). 배경 아주 연하게 + 같은 계열의 진한 테두리(오늘 `#EEF4FC/#B9CFEE`, 지연 `#FDF1F1/#EFBFBF`, 이번 주 `#F1F8EC/#BFDDAE`, 공유받음 `#F4F0FB/#CFC2EE`).
3. 범위(내 할 일·공유받음·프로젝트)와 보기(목록·보드·캘린더) 분리. 범위 탭 바 54px, 내용과 간격 확대. 보드 정보 행↔열 헤더 28px, 열 헤더↔카드 14px. 열 이름은 파스텔 칩.
4. 목록은 업무·예정·마감·담당 고정 열. 제목 15px + 둘째 줄 맥락(용역명 · 발주처 · 하위/댓글). 우선순위는 높음(라벨)·낮음(회색 라벨)만 표시, 체크 원은 중립색.
5. 결재 일정 행: 체크 없음, 종류 아이콘(출장 briefcase·휴가 tree-palm·교육 graduation-cap·초과근무 clock)을 파스텔 원 안에, 우측 "문서 열기". **To-do에서 출장·초과근무 생성 불가**(전자결재 기안 링크만).
6. 상세 패널(580px): 섹션마다 **프레임**(핵심 4속성 2×2 → 관련(용역·발주처·계약번호 / 사업장) → 메모 → 하위 작업 → 댓글 → 부가 설정(접힘 한 줄 요약) → 활동(접힘)). 보조 행동(메신저 공유·복제·보관·삭제)은 ⋯ 메뉴. 헤더 좌측 5px 프로젝트 색 띠 + 프로젝트 칩.
7. 하위 작업: 분절 진행바(완료 `#9FD9BA`·진행 중 `#B9CFEE`·대기 회색) + 퍼센트, 행별 상태 칩(완료/진행 중)·기한/담당 보조 텍스트. 목록·카드의 n/m도 미니 분절 바.
8. 아바타: 댓글·담당·공유 칩은 `employee_profiles.photo_*`(052) 사진이 있으면 얼굴 사진(`CdAvatar src`), 없으면 중립 이니셜(사용자별 색 없음). 모바일 MiniAvatar 동일.
9. 모바일 목록: 태그 버튼 가로 스크롤, 날짜 그룹 헤더 고정(sticky 42px), 행 66px 2~3줄(제목/맥락/예정·마감·담당), 행 우측 ⋮로 상태 변경 진입, 퀵애드는 단순 입력 + 인식 결과 칩(해제·수정).
10. 칸반: 열 상자 없음·카드 1px 경계·회전 없음·삽입선(2px primary + 양끝 점), WIP는 "권장 N건 초과" 라벨, 완료·보류는 보드 아래 가로 접힘 행.

**구조**
11. **프로젝트 보드 생성 3방식**: (a) 계약관리 용역 선택 — 계약관리 트리뷰(`app/(app)/contracts` 트리 컴포넌트)를 그대로 띄우는 모달, (b) 프로젝트명·업체 직접 입력(사업장 마스터 불필요), (c) 자체 수행 프로젝트(발주처 없음). `todo_boards`에 `project_name`, `client_name`, `contract_id`(FK contracts, null 허용), `facility_id`(null 허용), `color`(파스텔 키) 추가 — 274 미적용이므로 274에 직접 반영. 할 일은 보드의 용역·발주처·색을 물려받고, 개인 보드 할 일은 `link_kind=contract/facility`로 개별 연결.
12. **결재 연계**: 출장·초과근무(·교육) 문서의 계약/업체 필드(양식 자동채움 필드 키는 `lib/approval/*` 확인)로 `contract_id`를 식별 → 해당 프로젝트 보드 목록·내 할 일에 읽기 전용 행으로 표시하고 용역명·발주처를 맥락 줄에 출력. To-do에는 "출장 기안하기 → 전자결재" 링크만.

### 20. 실측 기록(2026-10-13, frontend-dev-aws → 스테이징 DB, 274·275 사용자 적용)
- 사용자가 274·275를 스테이징에 적용하고 로그인한 뒤 `/todo` 실측: 퀵애드 4건(한국어 날짜·반복·우선순위 토큰) 생성·섹션 배치(지연/내일/날짜 없음), 상세 드로어(프레임 7종), 보드 보기(개인 기본 보드 3열+완료 접힘 행), 다크 모드, 프로젝트 보드 생성 모달(계약 트리 2026년·용역분류 5그룹 표시, 자체 수행 보드 생성→4열+접힘 행→삭제) 확인. 콘솔 오류 0(수정 후).
- 실측 중 수정: ① 페이지 폭·높이를 계약 관리와 같은 전체 작업면으로(`max-width` 제거, `flex h-full`) ② 담당자 기본값=작성자, 반복만 있고 날짜 없으면 오늘 이후 첫 발생일을 할 날로 ③ 마감 라벨 "N일 지남"→**"M/D D+N"**, 오늘 "D-Day"(웹·드로어·홈 위젯·모바일) ④ `?item=` 직접 진입 hydration 오류 → 드로어는 마운트 뒤 렌더 ⑤ 칸반 열 264→316px(좁은 화면 296), 카드 제목 15→14px, 카드 패딩 14/16/13·gap 6·하단 행 margin 8(높이 약 20%↑).
- 남은 테스트 데이터: 관리자 계정의 할 일 4건(검증용, 사용자 판단으로 삭제).
- **후속(사용자 지적 2건, 10-13)**: ① 상세 "관련" 연결을 ID 입력 → **선택기**(`LinkPickerModal`/모바일 `LinkPickerSheet`, 공용 `ContractPicker`): 계약(트리 or 후보 검색)·사업장(`/api/facilities?q=`)·결재 문서(box 4종 병합 후 클라이언트 필터)·영업(`/api/sales/projects?q=`)·업무추진계획(my/dept 합집합)·URL. 지시(directive)는 부서 필수 API라 제외. ② **결재 대기(내가 결재할 차례) 자동 표시**: `listMyPendingApprovals` → `TodoApprovalEvent.kind="pending"`(formName·docNo·submittedAt·drafterPhotoUrl), `view=my`·홈 위젯에만, 오늘 그룹 맨 위·토글 무관·"결재 대기 N" 라벨·D+N(상신 2일↑)·"결재하기". 보드·공유받음엔 미포함. 기존 결함 수정: BoardCreateModal 사업장 자동완성 응답 필드(`{items}` camelCase).
- 실측: 연결 선택기(사업장 검색→선택→저장→관련 프레임 표시), 결재 대기 행(휴가신청서 D+84) 확인. 웹·모바일 tsc 0, 테스트 37 통과.
- **배포(2026-10-14)**: main f2c4ca8(기능)·c972491(m-app 재export) → next:652(사용자)·653(위젯 번들). 모바일 OTA group d4881914(runtime 1.2.0, production). 잔여: 실기기 확인, 위젯 알림 브릿지(P3), OS 위젯(P4), 캘린더 드래그 재일정, 인앱 알림함, 출장 양식 contract_select 전환.

### 21. 배포 후 1차 피드백 반영(2026-10-14)
**UI 다듬기(미커밋 → 커밋 예정)**: 목록 행 58→70px(compact 54)·제목↔맥락 7px, 연결 선택 모달 본문 370px 고정(작은 화면 calc(100vh-240px)), 댓글 입력에 내 아바타+"댓글 쓰기"(멘션 안내 제거·기능 유지), 부가 설정 3열 그리드(우선순위·알림·반복 / 보드·공유·스누즈)·활동 요약 행별, 핵심 2×2 셀을 36px 입력 박스(빈 날짜 "YYYYMMDD"+달력 아이콘, 편집 시 primary 2px outline), 메모 min-height 104px(모바일 96). 모바일 동일 비율.
**완료 처리 보완(마이그 276)**: 사용자 지적 — 완료 목록 메뉴 부재·실수 완료 복구·완료 조건.
- 완료 목록: 모든 목록 맨 아래 "완료 N건 · 펼치기" 상시 섹션(최근 완료순, 메모 1줄) + 상단 태그 "완료 N" + 보관함(30일↑) 보기(`archived=1`). "완료 숨김" 토글 제거.
- 되돌리기: 완료 행 체크 해제=reopen, 체크 직후 2초 유예("완료됨 · 되돌리기") 후 접힘 + 토스트, 드로어 "완료됨 · 시각 · 되돌리기" 줄.
- 완료 조건: `todo_items.complete_rules jsonb {subtasks,note,review}` + `completion_note` + `reviewed_at`, 보드 `default_complete_rules`(생성 시 복사). 체크 시 규칙 있으면 완료 확인 모달(충족 표시·완료 메모·[완료]); 서버 `completeItem` 409 `code:complete_rules {missing, openSubtasks}`. 칸반 완료 열 드롭도 검사. 모바일 동일(CompleteConfirmSheet).
- **배포(10-14, 2차)**: main 19be9ae → next:654, OTA 583e25b8. 실측(dev): 완료 확인 모달이 미완 하위 2건을 차단, 되돌리기 2초 유예 복귀, 연결 모달 6탭 574px 고정.

### 22. 2차 피드백·포커스 강조 전역 교체(2026-10-14, main ec43db8)
- 범위 탭(내 할 일·공유받음·프로젝트) 간격 gap 12/padding 16, 캘린더(`?from=todo`)에 "할 일로 돌아가기" 버튼, 하위 작업 삭제(버튼 상시 .55 + 인라인 2초 확인, 서버는 부모 `canEditItem` 허용, 모바일 삭제 시트).
- 입력란 포커스 강조: 사용자가 "남색 2px outline이 촌스럽다"고 지적 → 시안 3종(A 부드러운 링·B 톤 전환·C 하단 강조선, 캔버스 Focus.dc.html) 제시 → **A안 확정**. cdash 토큰 `--cd-focus-ring-color`(primary 16%, 다크 18%)·`--cd-focus-ring`(0 0 0 3px) 신설, `:focus-visible`·입력·칩·탭·switch 전부 `outline:none; box-shadow:var(--cd-focus-ring)`(입력은 border-color primary)로 치환(cdash.css·globals.css·todo.css, UI 기준 §4 갱신). 표 셀 선택 표시는 outline 유지.
- **배포**: next:655(ec43db8) + OTA 81f6295e. 위젯용 m-app 번들 ec43db8 기준 재export → 후속 커밋·next 재배포(아래 기록).

### 23. 잔여 과제 진행(2026-10-14, P3 묶음)
- **캘린더 드래그 재일정**(§7 2차 → 구현): `ScheduleCalendar` 에 HTML5 DnD(`canDrag`·`onEventDrop`) — 할 일 바만 끌 수 있고 셀이 drop 대상(강조=primary 테두리·soft 배경). `CalendarBoard.onEventDrop` 이 낙관 반영 후 `PATCH /api/todo/items/:id {doDate|dueDate}`(바가 마감일만으로 놓인 건이면 `dueDate`, `CalendarEvent.dateField` 로 구분) → 토스트 "할 날을 M/D로 옮겼습니다", 실패 시 복원. dev 실측: 합성 DnD 로 10/20→10/22 서버 반영·토스트 확인(브라우저 패널 스크린샷은 시간 초과라 좌표 드래그는 미실측).
- **인앱 알림함**(§9 2차 → 구현, 마이그 277 `todo_notifications`): `lib/todo/inbox.ts` record/list/markRead. `notify.ts` 의 5개 푸시(배정·댓글·완료/검토·리마인드·아침 요약)가 sendPush 와 나란히 수신자별 행을 남긴다(푸시는 설정으로 걸러져도 인앱은 항상). API `GET/PATCH /api/todo/notifications`. 웹: 탑바 `TodoNotifyBell`(Inbox 아이콘, 미읽음 배지, 드롭다운 30건, 모두 읽음, 클릭=읽음+이동, 60초 폴링). 모바일: `/todo/inbox` 화면 + 할 일 헤더 벨(미읽음 점). 277 미적용(42P01)이면 빈 결과로 동작(500 없음, dev 실측).
- **데스크탑 위젯 OS 알림·배지(WID-P3)**: `use-widget-bridge.ts` 가 같은 15초 폴링에 `/api/todo/due-soon?hours=24` 를 얹어 오늘까지인 건수를 `mcm:todo-due` 로 올리고, 셸(`apps/desktop/src/index.html`)은 작업표시줄 숫자 = 미읽음 + 오늘 할 일, 알림은 날짜 키로 하루 1회("오늘 할 일 N건 · 제목…"). 셸 1.3.0 인스톨러 빌드(`cargo` 로컬) → `frontend/public/downloads/MCM-widget-setup.exe` 교체. 설치본에서 알림 실측은 미완(설치 필요).
- **출장 양식 contract_select 전환**(§19-12 후속): 마이그 278 초안을 스테이징 실제 스키마에 BEGIN…ROLLBACK 리허설한 결과 **UPDATE 0행** — 출장 양식 v10 은 관리자가 빌더에서 이미 `field_13: contract_select(계약 검색)`·`field_12: company_select(출장지 업체 검색)` 으로 개정해 둔 상태라 전환이 불필요하다(approval-events 는 키와 무관하게 shape 로 탐색 → 연계는 이미 동작). 278 은 폐기(번호 비어 있음). 교육신청서(v2)에는 계약 필드가 없어 보드 연계 대상 아님.
- **리허설(마스터 시크릿·SSM 터널 15432·psql, ROLLBACK)**: 277 은 CREATE TABLE + 인덱스 3(PK 포함) 정상.
- **P4 OS 홈 위젯·전역 단축키·ICS·알림 액션**: 네이티브 빌드·스토어 재배포와 묶여 미착수 — `app.json version` 인상은 기존 설치본 OTA 를 끊으므로([[store-distribution-progress]]) 스토어 배포 일정 결정 뒤 진행.
- 미완: 모바일 캘린더 드래그(웹 전용 설계), 실기기 OTA 수신 확인, 스테이징 테스트 데이터 정리(사용자 판단).

### 24. 상태 표시 강화(2026-10-14, 사용자 선택 = 띠는 보드 색 유지)
- 사용자 지적: 상세에서 상태를 바꿔도 좌측 띠 색이 그대로 → 띠는 §19-1 보드(프로젝트) 색이라 의도된 동작. 두 안(띠를 상태 색으로 / 띠 유지 + 상태 별도 표시) 중 **후자 확정**.
- 웹: `TodoCheck` 에 `status` → 미완료 원의 배경·테두리가 상태 색(진행 `--todo-col-doing`/`--todo-seg-doing`, 검토 `--todo-col-review`/`--todo-seg-review`(#c9b8ec 신설), 보류 `--todo-col-hold`/`--todo-seg-hold`(#b8bec9) 점선). 할 일(todo)은 중립 그대로, 완료는 기존 primary 채움. 목록 행·상세 헤더 적용. 칸반 카드는 체크 원이 없어 제목 앞 8px `StatusDot`(todo 상태는 점 없음, 완료 초록).
- 모바일: `CheckCircle` 에 `status`(진행 primary/primarySoft, 검토 warning/warningSoft, 보류 muted 점선), 보드 카드 제목 앞 `StatusDot`(statusColor).
- dev 실측: 진행·검토·보류 3건 생성 → 목록 체크 원 배경/테두리/점선 상태별 확인, 띠(`--todo-tint`)는 보드 색 유지, 칸반 카드 점 색·8px 확인 → 삭제. ⚠dev 서버는 시작 시점의 RDS 마스터 비밀번호를 캐시 — 시크릿 로테이션 뒤 "password authentication failed" 면 preview 재시작.
