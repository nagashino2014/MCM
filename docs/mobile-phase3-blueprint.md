# 모바일 3차 개편 블루프린트 — 담당자 카테고리 · 사내 메신저 · 데스크탑 위젯 (2026-08-09)

2차 개편(P0~P6, [mobile-phase2-blueprint.md](mobile-phase2-blueprint.md)) 완료에 이어지는 계획.
다우오피스 메신저(현 사용 중)를 참고 모델로 하되, 기존 앱 디자인(소프트 플랫 + CTA 그라데이션)과 자산 위에서 구축한다.

## 사용자 확정 방향

1. **담당자 메뉴**: 나열식 → 데스크탑 `/directory` 외부 연락처 탭과 같은 **7개 카테고리 구분**. 카테고리 아이콘을 메뉴 상단에 배치, 아이콘 탭 → 해당 카테고리 목록 표시.
2. **대화(메신저) 구현**: 현재 플레이스홀더인 대화 탭을 실기능으로. 다우오피스 UX 준거 —
   - 새 대화 = 우하단 **+ 버튼 → 조직도**에서 부서 전체/특정 인원 선택.
   - 입력바 도구는 **파일 첨부(0순위) + 이모티콘**만 확정. 투표·맨션·서식·예약·화면캡처는 불요 판정.
   - **일반 파일은 입력란 드래그 앤 드롭이 기본**, 클립(첨부) 버튼은 50MB+ 대용량용 보조 경로.
3. **데스크탑 위젯 앱 신설**: 위하고·아마란스10·비즈메카처럼 브라우저와 별개의 상주형 메신저 위젯. **명함 촬영 제외, 모바일 앱과 동일 기능.**

---

## 조사 결과 요약 (2026-08-09 실측)

| 영역 | 결론 |
|---|---|
| 채팅 자산 | **완전 그린필드** — 테이블·라우트·컴포넌트 0건. 마이그 다음 번호 **145_** |
| 외부 연락처 카테고리 | `frontend/lib/directory-categories.ts` 상수 6종 + UI 전용 "미지정" = 7. 값은 **`facilities.org_category`**(105_)에 저장(담당자 아님, 사업장 단위) |
| 모바일 담당자 | `/api/sales/contacts` 응답에 `orgCategory` **이미 포함** — 모바일이 버리고 있을 뿐. **서버 무변경으로 구현 가능** |
| 조직도 | `GET /api/directory`(전 직원 열람 가능, flat+parentDeptId 트리) + 모바일에 `OrgPickerSheet` **이미 존재**(결재선용) — 새 대화 선택 UI 재사용 |
| 푸시 | **완비** — `lib/notify/push-expo.ts`(dedup·prefs·방해금지·토큰 자동폐기) + 모바일 `push.ts`/`deeplink.ts`. 이벤트 키·딥링크 매핑만 추가하면 됨 |
| 첨부 | S3 래퍼 패턴 확립(`board-attachment-storage.ts` 17줄 표준) + 인증 프록시 다운로드(`api/mail/attachments` 복사) + RN 업로드는 `new File(uri)` 패턴(card.tsx) |
| 실시간 | WebSocket 전례 없음. SSE 선례 2건(수집/파싱, fetch+reader 수동 파싱). **인앱 표준은 60초 폴링**(`useNavBadges`). ECS 태스크 현재 1개 |
| AI | 공용 JSON 헬퍼 `lib/ai/llm-json.ts` + 결재 요약의 "생성 1회+컬럼 캐시" 모범(`lib/approval/summarize.ts`) |

---

## CT. 담당자 카테고리 개편 (모바일) — 서버 무변경

### 화면 구성 (`apps/mobile/src/app/contacts.tsx` 개조)

```
[검색바]
[카테고리 아이콘 행]  전체 | 공공기관 | 공기업 | 민간기업 | 금융기관 | 협력업체 | 협회·조합 | 미지정
[선택 카테고리 담당자 목록]  (건수 배지 포함)
```

- **카테고리 8버튼**(전체 + 6종 + 미지정)을 상단에 배치. 형태는 두 안 중 택일(§결정 4):
  - **A안(추천): `ActionTile` 4열×2행 그리드** — 홈 "빠른 실행"과 같은 룩, 아이콘+라벨+건수. "아이콘을 누르면 하단에 목록" 요구에 부합.
  - B안: 가로 스크롤 아이콘 칩 행(bids.tsx 필터 칩 패턴) — 화면 절약형.
- 아이콘(Ionicons 매핑, 데스크탑 lucide 대응): 전체 `people` / 공공기관 `business`(Landmark 대응 없음→`library`) / 공기업 `flash` / 민간기업 `business-outline` / 금융기관 `card` / 협력업체 `flask`(Beaker 대응) / 협회·조합 `people-circle` / 미지정 `help-circle-outline`.
- 필터는 **클라이언트 전용**: `contact.orgCategory` 비교(전량 LIMIT 2000 이미 수신 중). 데스크탑과 동일하게 미지정 = `orgCategory` null/빈값.
- 검색은 선택 카테고리 내에서 동작(기존 로직 유지).

### 구현 항목

1. `Contact` 인터페이스에 `orgCategory: string | null` 추가 (+ 겸사겸사 `keyExtractor` 타입 불일치 `String(c.id)` 수정 — 조사에서 발견된 잠재 버그).
2. `ORG_CATEGORIES` 상수는 `apps/mobile/src/lib/org-categories.ts` 로 **복제**(frontend/lib은 import 불가). 파일 주석에 원본 경로 명시 — 양쪽 동기화 규칙은 웹 규칙과 동일(변경 시 같이 고침). ⚠ `협회·조합`의 가운뎃점 문자 그대로 복사(문자열 비교 매칭).
3. 목록 화면을 공용 부품(`SearchBar`·`ListRow`·`EmptyState`)으로 이관(현재 인라인 구현 — 2차 개편 P0-0 규칙 적용).

**규모**: 0.5일. **네이티브 모듈 무추가 → OTA 배포.**

---

## MSG. 사내 메신저 — 그린필드 구축

### MSG-0. 설계 원칙

- **참여자 키는 `users.user_id`**, 표시 정보(이름·부서·직급·사진)는 `employee_profiles` 조인 — mail·approval과 동일 관례.
- **네이티브 모듈 무추가**(첨부는 기설치 `expo-document-picker`·`expo-image-picker`/카메라 불요) → **모바일 전 단계 OTA 배포 가능.**
- 다우의 4탭(전체/개인/그룹/업무) 중 **"업무" 탭은 미채택**(§결정 2) — 전체/개인/그룹 3세그먼트. 우리의 "업무 맥락"은 도메인 카드 공유(MSG-P3)로 대체하는 편이 낫다.
- 삭제는 소프트(`deleted_at`) — "삭제된 메시지입니다" 표시. 수정은 미지원(사내 메신저 관례상 불필요, 단순화).

### MSG-1. DB 스키마 (`infra/aws/145_chat_core.sql`)

```sql
chat_rooms (
  room_id bigserial PK,
  room_type text CHECK (room_type IN ('dm','group')),
  name text,                    -- 그룹 전용(DM은 상대 이름을 클라가 표시)
  dm_key text UNIQUE,           -- DM 중복 방지: 'dm:{작은uid}:{큰uid}' (group은 NULL)
  created_by text NOT NULL,     -- users.user_id
  created_at timestamptz, last_message_at timestamptz,
  last_message_preview text     -- 목록 성능용 비정규화(발송 트랜잭션에서 갱신)
)
chat_room_members (
  room_id FK, user_id text, PRIMARY KEY(room_id, user_id),
  member_role text CHECK IN ('owner','member') DEFAULT 'member',
  joined_at, left_at timestamptz,          -- 나가기 = left_at (재초대 시 NULL 복귀)
  last_read_message_id bigint DEFAULT 0,   -- 읽음 커서
  notify_muted boolean DEFAULT false       -- 방별 푸시 음소거
)
chat_messages (
  message_id bigserial PK, room_id FK, sender_id text,
  kind text CHECK IN ('text','file','image','system'),  -- system = 입장/퇴장/방이름 변경 안내
  body text,                    -- text/system 본문, file은 캡션(옵션)
  reply_to_message_id bigint,   -- MSG-P2 답장(인용)
  created_at timestamptz, deleted_at timestamptz
)
chat_attachments (               -- board_attachments 스키마 복제
  attachment_id bigserial PK, message_id FK,
  file_name, content_type, byte_size, sha256,
  storage_provider, storage_bucket, storage_key, public_path, created_at
)
-- 인덱스: chat_messages(room_id, message_id DESC) / chat_room_members(user_id) / chat_rooms(last_message_at DESC)
```

안읽음 수 = `room 최신 message_id − last_read_message_id` 범위의 메시지 count(본인 발신 제외). 목록 쿼리 한 방에 계산.

### MSG-2. API (`frontend/app/api/chat/*`, 전부 `requireSession` + 멤버십 검증)

| 라우트 | 동작 |
|---|---|
| `GET /api/chat/rooms` | 내 방 목록(left_at IS NULL) + 마지막 메시지 미리보기·시각·안읽음 수·멤버 요약. `?type=dm\|group` 필터 |
| `POST /api/chat/rooms` | `{userIds[], name?}`. 1명 → dm_key upsert(기존 방 반환), 2명+ → group 생성 + system 메시지 |
| `GET /api/chat/rooms/[id]/messages` | `?before=<messageId>&limit=50` 과거 페이징 / `?after=<messageId>` 증분 폴링용. 발신자 표시 정보 조인 포함 |
| `POST /api/chat/rooms/[id]/messages` | JSON `{body, replyTo?}` 또는 multipart(file+캡션). 트랜잭션: 메시지 insert + room preview 갱신 → 커밋 후 푸시 fire-and-forget |
| `POST /api/chat/rooms/[id]/read` | `{messageId}` — 읽음 커서 전진(뒤로 이동 방지 GREATEST) |
| `PATCH /api/chat/rooms/[id]` | 그룹명 변경 · `notify_muted` 토글 |
| `POST /api/chat/rooms/[id]/members` | 초대(그룹). `DELETE` = 나가기(left_at). 각각 system 메시지 |
| `GET /api/chat/attachments?key=` | 인증 프록시 다운로드 — `api/mail/attachments` 패턴 복사(멤버십 검증 포함) |

- 첨부 저장: `lib/storage/chat-attachment-storage.ts` 신설(board 패턴 17줄 복제), 키 `chat/{roomId}/{ts}-{fileName}`.
- 업로드 한도: **API 경유 25MB** (명함 15MB 상향 판박이). **50MB+ 대용량은 MSG-P2에서 presigned PUT 직행 업로드**(§결정 5) — next 컨테이너 메모리를 거치지 않는 유일한 안전 경로.
- 이미지( image/* )는 kind='image'로 저장, 클라가 인라인 미리보기(프록시 URL).

### MSG-3. 실시간 전달 — **폴링 채택** (§결정 1)

| 대상 | 주기 | 방식 |
|---|---|---|
| 열린 대화방 | **3초** | `?after=<마지막 수신 id>` 증분(빈 응답 = 204 수준으로 가볍게). 화면 이탈 시 중지 |
| 대화 목록 | focus 시 + **15초** | rooms 재조회 |
| 탭 배지(안읽음 총계) | 기존 `useNavBadges`/`use-nav-badges` 채널 | `/api/nav/badges`에 `chat` 키 추가(웹·모바일 동시 해결) |

**근거**: 사용자 33명 규모에서 3초 폴링은 초당 수 요청 수준 — SSE/WS의 ECS 멀티태스크 팬아웃 설계(Postgres LISTEN/NOTIFY + ALB idle timeout + RN 스트리밍 제약)를 지금 지불할 이유가 없다. 인터페이스를 `after=` 증분으로 잡아두면 **후일 SSE로 갈아타도 클라 변경 최소**(같은 payload를 스트림으로 밀어주면 됨). SSE 업그레이드는 선택 단계(MSG-P4)로 보류.

### MSG-4. 푸시·뱃지

- `push-expo.ts` 이벤트 카탈로그에 **`chat.message`** 추가(기본 ON). 발송 대상 = 방 멤버 − 발신자 − `notify_muted`. dedup key = `chat:{roomId}:{messageId}`.
- 제목 = 발신자 이름(그룹은 "방이름: 발신자"), 본문 = 미리보기(파일이면 "📎 파일명"), `data.link = /chat/{roomId}`.
- `deeplink.ts`의 `routeForLink()`에 `/chat/[roomId]` 매핑 추가(누락 시 무시됨 — 조사 경고사항).
- 설정 화면(`notifications.tsx`) 이벤트 토글에 자동 노출(카탈로그 driven).

### MSG-5. 모바일 UI

```
(tabs)/chat.tsx        대화 목록: SegmentedTabs[전체|개인|그룹] + 검색 + FAB(+)
 └ /chat/[roomId]      대화방: inverted FlatList + 입력바
 └ 새 대화             FAB → OrgPickerSheet(기존 부품, 다중 선택) → 1명=DM · 2명+=그룹
```

- **대화 목록 행**: `Avatar`(DM=상대 사진/그룹=인원수 스택) + 방이름 + 마지막 메시지 1줄 + 상대시각 + 안읽음 `Count` 배지. 다우 스샷과 같은 정보 구성.
- **대화방**: 말풍선 — 내 메시지 = **CTA 그라데이션**(#6b7cf6→#9b7ef2, 2차 개편 통일 룩), 상대 = `cd-card` 윤곽선. 날짜 구분선, 연속 발신 묶음(아바타 1회), 읽음 처리는 진입 시+새 메시지 수신 시 자동.
- **입력바**: `[📎] [텍스트 입력(자동 높이)] [전송(그라데이션)]` — 확정 구성만. 이모티콘은 모바일에선 **OS 키보드 이모지로 충분**(별도 피커 없음), 위젯/웹에서만 피커 버튼 추가(WID-P1).
- 첨부 플로우: 📎 → `expo-document-picker`(모든 파일)/앨범 → 전송 전 미리보기 행 → multipart 업로드(card.tsx의 `new File(uri)` 패턴 필수).
- 헤더: 방이름 + 멤버 수, 우측 ⋯ → 시트(멤버 보기·초대·방이름 변경·알림 끄기·나가기).
- ⚠ 화면 내 인라인 `Stack.Screen options` 금지(iOS 헤더 루프) — `_layout` 정적 정의.

### MSG-P3 (선택). 입력바 확장 기능 — 제안 (§결정 3)

사용자 질문("배치하면 유용할 기능 소개")에 대한 답. 다우의 7버튼 중 불요 판정(투표·맨션·서식·예약·캡처)에 동의하며 — 특히 **화면 캡처는 위젯에서 `Win+Shift+S` 후 붙여넣기로 완전 대체**되므로 캡처 버튼 자체가 필요 없다. 대신 우리 그룹웨어라서 가능한 것들:

| 제안 | 내용 | 근거 |
|---|---|---|
| ① **답장(인용)** ★추천 | 메시지 길게 눌러 인용 답장(`reply_to_message_id`). 그룹방 대화 맥락 유지의 최소 장치 | 카톡으로 학습된 UX, 스키마에 선반영됨 |
| ② **도메인 카드 공유** ★추천 | 입력바 `#` 버튼 → 사업장/결재문서/일정 검색 시트 → 카드형 메시지로 공유, 탭하면 해당 화면 딥링크 | "OO사업장 건 결재 부탁해요"가 카드 한 장으로. `EntityPickerSheet` 재사용, **다우가 못 하는 그룹웨어 차별화** |
| ③ **안 읽은 대화 AI 요약** | 안읽음 30+ 방 상단에 "요약 보기" — `llm-json.ts` + 결재 요약의 캐시 패턴 | 휴가 복귀 시 유용. 비용 미미(Haiku) |
| ④ 맨션(@) | 그룹방 알림 하이라이트 | 33명 규모에선 후순위 — ①②보다 효용 낮음 |

### 웹(데스크탑 브라우저) 노출

`/m-app`(Expo 웹 빌드)이 이미 staging에서 구동되므로 **메신저는 자동으로 웹에서도 동작**한다. 데스크탑 전용 화면(`frontend/components/chat/*`)을 따로 만들지 않는다 — 위젯(WID)이 그 역할. 브라우저 사용자는 `/m-demo.html` 또는 위젯 설치로 유도.

---

## WID. 데스크탑 메신저 위젯 (`apps/desktop/`)

### 스택 결정(추천): **Tauri v2 + 원격 로드** (§결정 6)

| 후보 | 판단 |
|---|---|
| **Tauri v2 (추천)** | 설치본 수 MB·메모리 소형·Windows WebView2(전 사내 PC Edge 내장). 트레이·알림·자동시작·전역단축키 공식 플러그인 |
| Electron | 기능 동등하나 설치본 150MB+·인스턴스당 메모리 큼. 사내 배포·업데이트 부담 |
| PWA 설치 | 구축비 0이지만 트레이 상주·뱃지·창 제어 불가 — "위젯 앱" 요구 미달 |

**핵심 아키텍처 — 웹뷰가 `https://koensain.app/m-app` 을 원격 로드한다.** 오늘 구축한 웹 데모 파이프라인이 그대로 위젯의 콘텐츠 공급로가 된다:

- **앱 업데이트 = next 배포로 끝.** 위젯 재배포는 셸 기능(트레이 등) 변경 때만.
- 모바일과 기능·화면 100% 동일(같은 번들). 명함 촬영 등 네이티브 전용 기능은 `Platform.OS === 'web'` 분기로 숨김(§WID-P0-3).
- 로그인 유지: 토큰이 웹뷰 localStorage에 저장(기구현 폴백) — 위젯 재시작에도 유지.

### WID-P0. 셸 최소 구성

1. Tauri 프로젝트 스캐폴딩(`apps/desktop/`), 창 **400×760**(다우 위젯 크기감) · 최소 340×560 · 위치 기억.
2. **트레이 아이콘**: 클릭=창 토글, 우클릭 메뉴(열기/로그인 화면/종료). 닫기(X) = 트레이로 최소화(종료 아님). 부팅 시 자동 시작(옵션, 기본 ON).
3. **웹 전용 숨김 정리**: 명함 촬영 진입점(홈 빠른 실행·담당자 화면)을 `Platform.OS==='web'` 분기로 숨김. 그 외 카메라·위치 의존 확인 일제 점검(날씨 위젯은 브라우저 geolocation 폴백 확인).
4. 검증 게이트: 위젯에서 로그인 → 대화 송수신 → 첨부 다운로드.

### WID-P1. 데스크탑 특화 입력 + 알림

1. **드래그 앤 드롭**(사용자 확정 기본 경로): 채팅 입력바의 `.web.tsx` 분기에 DOM `drop`/`dragover` 핸들러 → 기존 업로드 플로우 합류. **클립보드 이미지 붙여넣기**(`paste` 이벤트)도 동시 구현 — 캡처 도구를 대체하는 조각.
2. **이모지 피커**: 웹 분기 입력바에만 버튼 추가(경량 자체 그리드 — 외부 라이브러리 없이 유니코드 카테고리 몇 개면 충분).
3. **새 메시지 OS 알림**: 포그라운드 폴링이 살아 있으므로(트레이 상주) 새 메시지 감지 시 웹 `Notification` API → Tauri가 네이티브 토스트로 표출. 클릭 시 해당 방 포커스. 트레이 아이콘 뱃지(안읽음 도트).
4. **배포**: NSIS 인스톨러 빌드 → S3 사내 배포 링크(+홈 화면 안내 배너는 선택). 자동 업데이트는 콘텐츠가 원격이라 **불요** — 셸 업데이트만 수동(빈도 낮음).

### 대용량 파일(50MB+) — MSG-P2와 연동

클립 버튼 = 대용량 경로(사용자 확정). API 경유 한도(25MB) 초과 파일은:
`POST /api/chat/uploads/presign` → S3 **presigned PUT**으로 브라우저/앱이 직접 업로드 → 완료 후 메시지 확정 API 호출. 한도 상한 **200MB**(공문 첨부와 동일 기준). 25MB 이하는 기존 multipart 경로 그대로(구분은 자동 — 사용자는 의식할 필요 없음).

---

## 로드맵 (게이트식)

| 단계 | 내용 | 배포 | 게이트 |
|---|---|---|---|
| **CT-1** | 담당자 카테고리 8버튼 + 타입 보강 | OTA | 카테고리별 건수가 데스크탑 `/directory`와 일치 |
| **MSG-P0** | 145_ 스키마 · rooms/messages/read API · 대화 목록·대화방·새 대화(조직도)·텍스트 송수신·읽음·3초 폴링 | staging + OTA | 두 계정 간 실대화 성립(왕복·안읽음 수·목록 갱신) |
| **MSG-P1** | 첨부(25MB, 이미지 인라인)·`chat.message` 푸시·딥링크·탭/네비 뱃지 | staging + OTA | 백그라운드 푸시 탭 → 해당 방 진입, 첨부 왕복 |
| **MSG-P2** | 답장(인용)·그룹 관리(초대/나가기/방이름)·presigned 대용량·메시지 검색 | staging + OTA | 200MB 파일 왕복 |
| **WID-P0** | Tauri 셸(원격 로드·트레이·자동시작·명함 숨김) | 인스톨러 | 위젯 단독으로 로그인→대화→첨부 |
| **WID-P1** | 드래그앤드롭·붙여넣기·이모지 피커·OS 알림·사내 배포 | 인스톨러 | 파일 드롭→전송, 알림 클릭→방 포커스 |
| MSG-P3 (선택) | 도메인 카드 공유·AI 요약·맨션 | OTA | — |
| MSG-P4 (선택) | 폴링→SSE 업그레이드(LISTEN/NOTIFY) | staging | — |

권장 순서: **CT-1 → MSG-P0 → MSG-P1 → WID-P0 → MSG-P2 → WID-P1** — 위젯 셸(P0)을 MSG-P2보다 먼저 내리면 사무실 데스크탑에서 조기 실사용 피드백을 받을 수 있다.

---

## 결정 대기 (사용자 확인 필요)

1. **실시간 = 폴링(3초/15초) 채택** — SSE는 MSG-P4 보류. (추천대로면 그대로 진행)
2. **대화 목록 세그먼트 = 전체/개인/그룹 3종** — 다우의 "업무" 탭 미채택.
3. **MSG-P3 채택 범위** — ①답장 ②도메인 카드 공유 ③AI 요약 ④맨션 중 선택(추천 ①②).
4. **카테고리 UI 형태** — A안 `ActionTile` 그리드(4×2, 추천) vs B안 가로 스크롤 칩.
5. **대용량 기준** — API 경유 25MB / presigned 상한 200MB 값 확인.
6. **위젯 = Tauri v2 + 원격 로드(koensain.app/m-app)** 승인. (Rust 툴체인 설치 필요 — 개발 PC 1회)
