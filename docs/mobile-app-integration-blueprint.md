# 모바일 앱 기능 연동·고도화 블루프린트 (MCM Mobile — 데스크탑 그룹웨어 전면 연동)

> 작성 2026-07-28. 권위 문서. 선행 문서 = [mobile-native-blueprint.md](mobile-native-blueprint.md)(Expo 마이그레이션 N0~N3·배포), [mobile-ui-blueprint.md](mobile-ui-blueprint.md)(웹 `/m` M1~M3), [groupware-ux-overhaul-blueprint.md](groupware-ux-overhaul-blueprint.md)(웹 G0~G6-B).
>
> 이 문서의 범위 = **"데스크탑 앱에 있는 기능 중 무엇을 모바일에 이식/연동하고, 어떤 순서로 어떻게 만들 것인가"**. 착수 전 §12 논점 확정 필요.

---

## 1. 현황 진단 (코드 실사 2026-07-28)

### 1.1 데스크탑(웹) 앱 — 기능 포화 상태
- 화면 **62개 page.tsx** / API **282개 route.ts**. 메뉴(`frontend/config/menu.ts`) 기준 5개 섹션(홈·협업·업무·사업운영·관리).
- 그룹웨어 UX 개편(G0~G6-B) 완료: 메일 3-pane·전자결재 3-pane·주소록/조직도·공지게시판·홈 위젯 13종.
- 사업운영(IEPS 원 도메인: 사업장·계약·영업·데이터)은 성숙 단계.

### 1.2 모바일 앱 — 껍데기 + 영업 4화면
- `apps/mobile/` Expo SDK 57 / expo-router / NativeWind. 탭 4개(홈·일정·사업장·담당자) + 명함 촬영 모달.
- 홈은 `upcoming-activities`/`pending-reports` **카운트 2개 + 로그아웃 버튼**이 전부.
- 배포 경로 확립: iOS = TestFlight(ASC 앱 `MCM (2c281d)`, ascAppId 6793355848) / Android = preview APK 배포. JS 변경은 `eas update` OTA, 네이티브 모듈 추가 시에만 재빌드+`eas submit`.
- **그룹웨어 기능은 0개** — 메일·결재·게시판·주소록·근태·휴가 전부 미이식.

### 1.3 재사용 가능한 자산 (★ 이번 계획의 전제)
| 자산 | 실측 근거 | 함의 |
|---|---|---|
| **인증 단일 관문** | `lib/auth/guards.ts` `requireSession()` 이 `Authorization: Bearer` 우선 분기 → 없으면 쿠키 세션 | **282개 API 전부 모바일에서 그대로 호출 가능. 신규 모바일 전용 API 불요** |
| 권한 가드 | `requireRole`/`requireEditor`/`requirePermission` 전부 `requireSession()` 경유 | RBAC 그대로 상속 |
| 토큰 인프라 | `lib/auth/mobile-token.ts`(jose HS256, access 60m·refresh 30d), `/api/mobile/auth/{login,refresh}` | 로그인·자동갱신 완료 |
| 앱 측 인프라 | `src/lib/{config,tokens,api,auth-context,use-api,format}` — apiFetch(Bearer + 401 싱글플라이트 refresh) | 데이터 계층 재사용 |
| 배포 인프라 | EAS(OTA 채널 production, `EXPO_PUBLIC_API_URL=https://koensain.app`) | 반영 루프 확립 |

### 1.4 갭 (이번 계획이 메우는 것)
1. **푸시 알림 인프라 전무** — `expo-notifications`·서버 SDK·토큰 테이블 전부 없음. 소비처는 이미 대기(`board_posts.notify_push` 는 저장만 되고 발송 미구현, UI에 "준비 중" 표기).
2. **그룹웨어 기능 미이식** — 외근 중 결재/메일/공지가 불가 = 앱을 켤 이유가 약함.
3. **모바일 디자인 시스템 없음** — 웹 `cdash` 토큰(`--cd-*`)의 RN 대응물 부재, 화면마다 색 하드코딩(`bg-neutral-*`, `#5D87FF` 산발).
4. **HTML 렌더/작성 수단 없음** — 메일 본문·결재 `multitext`·게시판 본문이 전부 HTML인데 앱에 WebView가 없다.
5. **보안 마감재 없음** — 앱 잠금(생체인증) 없음, refresh 토큰 화이트리스트/폐기 경로 없음.

---

## 2. 설계 원칙

1. **백엔드 무변경 우선.** 신규 API는 ①푸시 토큰 등록/설정 ②모바일 전용 집계(홈 요약 1콜) 정도로 최소화. 나머지는 기존 API 재사용.
2. **모바일은 "완결"이 아니라 "이동 중 처리".** 데스크탑 기능의 1:1 복제가 목표가 아니다. 판정 기준 = *외근·이동·퇴근 후에 발생하는가*.
3. **읽기는 넓게, 쓰기는 좁고 깊게.** 조회는 폭넓게 열되, 입력은 "결재 승인/반려", "메일 답장", "휴가 신청", "일정 경과", "명함" 등 짧은 액션에 집중.
4. **비회귀.** 웹 화면·API 동작 변경 금지. 공용 코드 수정 시 웹 회귀 검증 동반(예: `send.ts`, `docs.ts` 훅에 푸시 추가 시 fire-and-forget).
5. **네이티브 모듈 도입은 묶어서 1회 재빌드.** OTA로 못 가는 변경(WebView·notifications·local-authentication 등)은 M0에 몰아 넣는다.
6. **디자인은 cdash 토큰 계승.** 색·타이포·라운드·간격 값은 웹과 동일 값으로 RN 상수화(`src/theme/tokens.ts`). 레이아웃만 모바일 재설계.
7. **작은 화면 원칙(웹 §3.0의 모바일판).** 축소로 밀도 해결 금지 — 본문 15px·메타 12px 하한, 터치 타깃 44pt.

---

## 3. 기능 인벤토리 & 모바일 이식 판정 ★ 핵심

**판정 등급**
- **A — 네이티브 완전 이식**: 모바일에서 조회+주요 쓰기까지. 앱의 존재 이유.
- **B — 조회 + 경량 액션**: 목록/상세는 네이티브, 무거운 편집은 웹으로 유도.
- **C — WebView 임베드**: 재구현 비용 대비 사용빈도가 낮아 앱 안에서 웹 화면을 띄움(인증은 토큰→세션 브리지 필요, §9.2).
- **D — 제외**: 데스크탑 전용(대형 표·다중 패널·관리자 배치 작업).

### 3.1 협업 (그룹웨어 코어)
| 웹 기능 | 화면/API | 판정 | 모바일에서의 형태 |
|---|---|---|---|
| **전자결재 — 결재함** | `/approval`, `/api/approval/docs?box=pending\|upcoming\|acted\|draft\|in_progress\|completed` | **A** | 탭 최상위. 대기/예정/내 기안 리스트 + AI 요약 카드 |
| **전자결재 — 상세·승인/반려** | `ApprovalDocViewer`, `/api/approval/docs/[docId]`, `/act` | **A** | 문서 상세 화면(결재선 타임라인·본문·첨부) + 하단 고정 승인/반려 바(반려 사유 필수) |
| **전자결재 — 기안 작성** | `/approval/draft`, `ApprovalFormRenderer`(동적 양식·`multitext` HTML) | **B→A(단계적)** | 1차 = 휴가/지출 등 **단순 양식만** 네이티브 폼. 복합 양식은 "웹에서 작성" 안내. 2차에 렌더러 RN 포팅 |
| 전자결재 — 문서함/양식별 조회 | `/approval/archive`, `/records` | **B** | 문서함(내 문서·참조/열람) 리스트 + 검색. 양식별 조회는 제외 |
| 전자결재 — 사전검토/AI검토 | `/precheck` | **A(표시)** | 상세 화면에서 경고 배지·AI 요약 노출(생성은 웹/서버) |
| 결재 인사이트(병목 대시보드) | `/approval/insights` | **D** | 데스크탑 전용(차트 다수, admin) |
| 결재 운영 설정(양식·정책·알림) | `/approval/forms\|policies\|settings` | **D** | 관리자 배치 작업 |
| **메일 — 폴더/목록/읽기** | `/mail`, `/api/mail/{folders,messages,messages/[id]}` | **A** | 폴더 드로어 + 목록(무한스크롤·스와이프 액션) + 뷰어(WebView 본문) |
| **메일 — 답장/전달/새 메일** | `/mail/compose`, `/api/mail/send`(multipart) | **A(경량)** | 수신자 자동완성(`/api/directory/suggest`)·제목·본문. 본문은 §9.1 결정에 따름. 인용은 서버 원문 참조 |
| 메일 — 첨부 | `/api/mail/attachments` | **A** | 다운로드→미리보기/공유, 업로드=사진/파일 선택 |
| 메일 — 카테고리/스팸/수신확인/설정/별칭/용량 | `MailSettingsPane` 등 | **D** | 관리·설정 계열은 웹 |
| **공지·게시판** | `/board`, `/api/board`, `/[postId]` | **A** | 목록(전사/부서·미읽음)·상세(WebView 본문·첨부)·**작성은 B**(간단 텍스트만) |
| **주소록·조직도** | `/directory`, `/api/directory` | **A** | 임직원 검색·카드(전화/문자/메일 원터치)·부서 트리·조직도(가로 스크롤). 외부 연락처 탭 포함 |
| 일정·캘린더(웹 G6-C 미구현) | `/calendar` | **A(동시 설계)** | §8.7 — 웹 구현 전이라 **모바일이 먼저 나갈 수 있음**. 스키마는 웹과 공유 |

### 3.2 업무 (HR·업무보고)
| 웹 기능 | 화면/API | 판정 | 모바일에서의 형태 |
|---|---|---|---|
| **휴가 신청·잔여 확인** | 전자결재 양식 + `/api/approval/leave` | **A** | "내 휴가" 화면: 잔여 연차·사용 이력·신청(기간 선택→결재 상신) |
| **연차촉진 고지 수신·전자서명** | `/api/home/leave-notices`, `/api/approval/leave-notices/[id]/submit` | **A** | 홈 수신문서함 카드 → 고지 본문 → **클릭 전자서명**(모바일 적합도 최상) |
| 직원별 휴가 관리(대장·KPI) | `/approval/leave` | **B** | 본인 것만 조회. 관리자 대장은 웹 |
| **근태 — 내 근태 조회** | `/api/approval/attendance` | **A** | 주간 근무시간·초과근무·주52h 게이지(본인 한정) |
| 근태 — 엑셀 업로드·매핑·정책 | `/approval/attendance` 관리 탭 | **D** | 관리자 데스크탑 |
| 근태 — **출퇴근 체크인(신규 후보)** | 없음 | **논점 §12-4** | GPS/사업장 지오펜스 기반 출퇴근 기록. ADT 엑셀의 보완재 |
| 업무추진계획 — 내 할 일/주간보고 | `/work-plan`, `/api/work-plan/my-tasks` | **B** | 조회 + **간단 경과·이슈 입력**. 보고서 편집기(`ReportEditor`)는 웹 |
| 업무추진계획 — 부서장 감독/임원 지시 | `/work-plan/oversight\|exec` | **B** | 지시 확인·코멘트 정도. 대량 검토는 웹 |
| 수행인력 현황·평점 | `/staffing` | **D** | 표 중심 |

### 3.3 사업 운영 (기존 이식분 + 확장)
| 웹 기능 | 판정 | 비고 |
|---|---|---|
| 사업장 탐색·상세 요약 | **A(기존)** | 현행 유지 + 지도·길찾기·연혁 보강 |
| 담당자(연락처)·명함 촬영 | **A(기존)** | 유지. 명함은 앱 킬러 기능 |
| 영업 일정·경과 입력 | **A(기존)** | 유지 + 캘린더 통합(§8.7) |
| 영업 프로젝트(Salesboard) | **B** | 내 프로젝트 요약·활동 등록 |
| 계약 조회 | **B** | 검색·요약 카드(금액·기성·담당) |
| **수금/발행 요청 처리** | **A** | 홈 위젯 `InvoiceRequestCard`/`InvoiceInboxCard` 대응 — 요청·접수 처리가 짧은 액션 |
| 계약 대시보드/빌링 표·다운로드 | **D** | 대형 표·엑셀 |
| 공공입찰 — 마감 임박·상세 | **B** | 알림 + 조회. 증빙 패키지 생성은 웹 |
| 인텔(신호)·RAG 발굴 | **B** | 매칭 알림 + 신호 카드 조회 |
| 데이터(수집 현황·검수·설정) | **D** | 운영자 데스크탑 |

### 3.4 관리·인증
| 기능 | 판정 | 비고 |
|---|---|---|
| 로그인/자동로그인 | **A(기존)** | + 생체인증 잠금(§9.3) |
| 아이디 찾기·비밀번호 재설정 | **B** | 앱에서 웹 페이지 열기(`/login/find`, `/login/reset`) |
| 비밀번호 변경 | **A** | 계정 화면 |
| 사용자·권한·회사 프로필·휴지통 | **D** | 관리자 데스크탑 |

### 3.5 요약
- **A(네이티브 이식) 14개 영역** — 결재(3)·메일(3)·게시판·주소록·휴가(2)·근태 조회·수금 요청·일정·기존 영업 4화면.
- **B 10개 · C 소수 · D 나머지.**
- 판정의 실질 = *앱의 홈 화면에 무엇이 뜨는가* → §5 IA로 이어진다.

---

## 4. 푸시 알림 아키텍처 (0부터 구축) ★ 최우선 인프라

앱을 "가끔 여는 도구"에서 "알림으로 불려오는 도구"로 바꾸는 유일한 장치. **M1에 단독 배치.**

### 4.1 스택 결정
- **Expo Push Service** (앱: `expo-notifications` / 서버: `expo-server-sdk`). FCM/APNs 직접 연동 대비 인증서 관리·크로스 플랫폼 비용이 압도적으로 낮고, 이미 EAS 위에 있다.
- iOS는 APNs 키를 EAS가 관리(빌드 시 자동), Android는 FCM v1 서비스 계정 키를 EAS에 등록(사용자 1회 작업).

### 4.2 스키마 (신규 마이그레이션 `NNN_mobile_push.sql`)
```
mobile_push_tokens(
  id, user_id FK, expo_token UNIQUE, platform('ios'|'android'),
  device_id, app_version, locale,
  created_at, last_seen_at, revoked_at, revoke_reason)

mobile_notify_prefs(
  user_id, event_key, enabled bool, DEFAULT true,
  quiet_from time, quiet_to time)      -- 방해금지(사용자별 1행 + 이벤트별 토글)

mobile_push_log(
  id, user_id, event_key, dedup_key UNIQUE, target_ref,
  sent_at, ticket_id, receipt_status, error)
```
> `approval_notify_log` 의 dedup UNIQUE 패턴을 그대로 따른다(`lib/approval/notify.ts` 참조 모델).

### 4.3 서버 모듈
- `lib/notify/push-expo.ts` — `sendPush(userIds, {title, body, data, eventKey, dedupKey})`. 토큰 조회 → 설정/방해금지 필터 → 100건 청크 → 티켓 저장 → **영수증 폴링으로 `DeviceNotRegistered` 토큰 자동 폐기**.
- `lib/notify/dispatch.ts`(기존 `email-ses`·`kakao-solapi` 와 나란히) — 이벤트 → 채널(email/알림톡/**push**) 팬아웃. 기존 `dispatchApprovalEvent` 의 fire-and-forget·dedup 구조 답습.
- API: `POST /api/mobile/push/register`(토큰 등록·갱신), `DELETE`(로그아웃 시 폐기), `GET/PUT /api/mobile/push/prefs`.

### 4.4 이벤트 카탈로그 (초기)
| event_key | 트리거 | 딥링크 | 기본값 |
|---|---|---|---|
| `approval.step_pending` | 내 결재 차례 도착 | `/approval?docId=` | ON |
| `approval.result` | 내 기안 승인/반려 | `/approval?docId=` | ON |
| `approval.remind` | 체류 리마인드(30분 tick) | 〃 | ON |
| `approval.delegated` | 대결 위임 | 〃 | ON |
| `mail.received` | 새 메일 수신(inbound tick) | `/mail/{messageId}` | ON |
| `board.posted` | 공지 등록 시 `notify_push=true` **(이미 대기 중인 소비처)** | `/board/{postId}` | ON |
| `leave.notice` | 연차촉진 1·2차 고지 | `/leave/notices/{id}` | ON |
| `invoice.request` | 세금계산서 발행 요청/처리 | `/billing/requests` | ON |
| `schedule.reminder` | 영업 일정 당일 아침 | `/schedule?date=` | ON |
| `bid.deadline` | 입찰 마감 임박 | `/bids/{id}` | OFF |
| `intel.match` | 사업분야 매칭 신호 | `/intel/{signalId}` | OFF |
| `attendance.week52` | 주 52h 임박 경고(AX-P4) | `/attendance` | ON |

### 4.5 앱 측
- 권한 요청 시점 = **로그인 직후가 아니라 첫 알림 가치 노출 시점**(결재/게시판 첫 진입)에 사전 설명 후 요청.
- 포그라운드 핸들러(인앱 배너), 백그라운드 탭 → 딥링크 라우팅, 앱 아이콘 뱃지 = `/api/nav/badges`(미결재+안읽은메일) 재사용.
- 설정 화면: 이벤트별 토글 + 방해금지 시간.

---

## 5. 모바일 IA 재설계

현행 4탭(홈·일정·사업장·담당자)은 **영업 전용 IA** — 그룹웨어를 담을 수 없다.

### 5.1 권장안 (탭 5 + 더보기)
```
[홈]  [결재]  [메일]  [소통]  [더보기]
 │      │      │      │        │
 │      │      │      │        ├ 근태·휴가(내 근태·휴가신청·잔여)
 │      │      │      │        ├ 사업장 / 담당자 / 명함 촬영
 │      │      │      │        ├ 일정(캘린더)
 │      │      │      │        ├ 업무추진(내 할 일)
 │      │      │      │        ├ 계약·수금 요청
 │      │      │      │        └ 설정(알림·잠금·테마·계정)
 │      │      │      └ 공지·게시판 + 주소록·조직도(상단 세그먼트)
 │      │      └ 폴더 드로어 + 목록/뷰어
 │      └ 대기·예정·내 기안 세그먼트
 └ 요약 위젯(미결재·안읽은메일·오늘 일정·수신 고지·미입력 경과) + 빠른 실행(명함/휴가/메일쓰기)
```
- 탭 뱃지: 결재=미결재, 메일=안읽음, 소통=미읽은 공지.
- **명함 촬영은 홈 빠른 실행 + 더보기 양쪽에 배치**(현행 진입점 유지).

### 5.2 ✅ 확정 (2026-07-28)
**§5.1 5탭안 채택.** 대안이었던 4탭(소통을 더보기로)·3탭 런처형은 폐기.
- 영업 4화면(사업장·담당자·일정·명함)은 그룹웨어 코어에 자리를 내주고 **더보기 + 홈 빠른 실행**으로 이동한다. 기존 사용자(영업)의 동선이 1단계 깊어지므로, 홈 빠른 실행에 **명함 촬영·일정**을 반드시 노출한다.

---

## 6. 공통 기반 (M0)

### 6.1 디자인 시스템 — cdash의 RN 포팅
- `src/theme/tokens.ts` — 웹 `cdash.css` 의 `--cd-*` 값을 **동일 hex 로** 상수화(라이트/다크 2세트). primary `#5D87FF`, danger `#FA896B`, success `#13DEB9`, surface/card/border/text/faint.
- `tailwind.config.js` extend 에 주입 → NativeWind `className="bg-cd-card text-cd-text"` 로 사용. 하드코딩 색 제거.
- 폰트: **시스템 기본 유지**(iOS Apple SD Gothic Neo / Android Noto Sans KR). 웹은 Pretendard CDN 이지만 앱 임베드는 폰트 파일 번들(웨이트당 ~1MB)이 필요해 효용 대비 비용이 커 보류 — 필요하면 후속 과제.
- **공통 컴포넌트 `src/components/ui/`**: `Screen`(SafeArea+배경), `Card`, `Button`(primary/ghost/danger), `Chip`, `Badge/Count`, `Avatar`, `Field`(Input/Select/Textarea/Date), `ListRow`, `EmptyState`, `Sheet`(바텀시트), `Toast`, `SegmentedTabs`, `SearchBar`, `SkeletonList`, `HtmlView`(§9.1), `Attachment`.
- 목록은 전부 `FlatList` + `getItemLayout`/`keyExtractor` 표준(메일·결재는 수천 건 가능).

### 6.2 데이터 계층
- `use-api.ts` 확장: 페이지네이션(`useInfiniteApi`), 낙관적 갱신, **stale-while-revalidate 캐시**(메모리 + `expo-sqlite` 영속). 외부 라이브러리(TanStack Query) 도입 여부는 논점 §12-7.
- 화면 진입 시 캐시 즉시 렌더 → 백그라운드 갱신 → 실패 시 "오프라인" 배너(마지막 갱신 시각 표시).

### 6.3 네비게이션·딥링크
- `scheme: mcm` 기존. 라우트 매핑 테이블 1곳(`src/lib/deeplink.ts`)에서 푸시 `data.link` → expo-router path 변환.
- **Universal/App Links**(`https://koensain.app/...` 로 앱 열기)는 M4 이후(도메인 연결 파일 배포 필요).

### 6.4 네이티브 모듈 일괄 도입 (★ M0에 몰아서 1회 재빌드)
| 모듈 | 용도 |
|---|---|
| `expo-notifications` | 푸시 |
| `react-native-webview` | HTML 본문 렌더(메일·결재·게시판) |
| `expo-local-authentication` | 앱 잠금(Face ID/지문) |
| `expo-document-picker` | 첨부 업로드 |
| `expo-sharing` | 첨부 열기/공유 |
| `expo-sqlite` | 오프라인 캐시 |
| `expo-clipboard` | 주소·번호 복사 |
> `expo-location` 은 출퇴근 체크인 제외 확정(§7.6)에 따라 **도입하지 않는다**.
> 이후 M1~M6은 원칙적으로 **OTA 만으로** 반영 가능해진다.

---

## 7. 화면별 상세 설계 (A 등급)

### 7.1 홈
- 상단: 사용자 카드(이름·부서·직급, 아바타) + 오늘 날짜.
- **요약 타일 4**: 미결재 / 안읽은 메일 / 오늘 일정 / 미입력 경과 — 탭 시 해당 화면.
- **수신 문서함**: 연차촉진 고지 등 서명 대기(있을 때만).
- **빠른 실행**: 명함 촬영 · 휴가 신청 · 메일 쓰기 · 일정 등록.
- **최근 공지 3건**.
- 신규 API 1개 권장: `GET /api/mobile/home` — 위 항목을 1콜로(현재 개별 위젯 API 8개를 모바일에서 병렬 호출하면 왕복·배터리 낭비). 내부는 기존 위젯 쿼리 재사용.

### 7.2 전자결재
- 세그먼트: 대기 / 예정 / 내 기안(작성중·진행·반려·완료 필터).
- 카드: 긴급 배지·양식명·제목·기안자·일시·**AI 요약 3줄**(`ai_summary` 기존 필드).
- 상세: 헤더(문서번호·상태) → **결재선 타임라인**(승인/대기/반려 아이콘+시각) → 본문(양식 필드 렌더, `multitext` 는 HtmlView) → 첨부 → 의견 목록.
- 액션 바(하단 고정): **승인** / **반려**(사유 필수 시트) / 의견. 사전검토 경고가 있으면 액션 위에 경고 배너.
- 기안: 1차는 **휴가 신청서 등 단순 양식 전용 폼**. 양식 목록에서 미지원 양식은 "웹에서 작성" 안내 + 링크.

### 7.3 메일
- 폴더: 좌측 드로어(받은/보낸/임시/보관/스팸/휴지통 + 사용자 폴더·카테고리) + 안읽음 카운트.
- 목록: 발신자·제목·미리보기·시각·별표·첨부 아이콘, 미읽음 볼드. **스와이프 = 읽음/보관/삭제**, 롱프레스 = 다중 선택 → `PATCH /api/mail/messages` 일괄.
- 뷰어: 헤더(발신자 아바타·수신자 펼침) + `HtmlView`(원격 이미지 차단 기본, "이미지 표시" 버튼) + 첨부 칩(다운로드→공유) + 답장/전체답장/전달 버튼.
- 작성: 수신자 칩 입력(`/api/directory/suggest` 자동완성) + 제목 + 본문(§9.1) + 첨부(사진/파일) + 서명 자동 삽입. 발송은 기존 `/api/mail/send`(multipart) 그대로.
- 검색: 상단 검색 → `q` 파라미터(기존 지원).

### 7.4 공지·게시판
- 세그먼트: 전사 공지 / 부서 게시판. 미읽음 점·상단고정 배지.
- 상세: 제목·작성자·일시 → HtmlView 본문 → 첨부 → 읽음 처리(`board_post_reads`).
- 작성: **간단 텍스트 + 사진 첨부**(리치 편집은 웹). `notify_push` 체크 시 §4 발송과 연결 = 푸시 첫 소비처.

### 7.5 주소록·조직도
- 세그먼트: 임직원 / 외부 연락처 / 조직도.
- 임직원: 검색(이름·부서·직급) → 카드 → **전화·문자·메일·복사** 원터치(`Linking`, 기존 `callPhone/sendSms` 재사용).
- 조직도: 부서 트리(아코디언) — 웹의 수평 조직도는 모바일에서 세로 트리로 재해석.
- 외부 연락처: 구분(기관유형) 필터 + 사업장 연결.

### 7.6 근태·휴가 ("내 정보" 성격)
- **내 근태**: 이번 주 근무시간 게이지(주 40h/52h 기준선)·일별 출퇴근·초과근무 시간·12h 초과 특별휴가 대상 표시(본인 한정).
- **내 휴가**: 잔여 연차(발생/사용/잔여)·사용 이력·촉진 고지 서명 이력.
- **휴가 신청**: 종류 선택(휴가 종류 규정 DB) → 기간(반차 옵션) → 사유 → **잔여 검증(기존 precheck `leave_balance` 규칙)** → 결재 상신.
- **출퇴근 체크인 — ✅ 이번 범위에서 제외(2026-07-28 확정).** 근태 정식 소스는 ADT 실측(엑셀 업로드) 유지. 모바일은 **조회 전용**(내 근태·초과근무·52h 게이지). 위치 수집이 없으므로 `expo-location` 도 §6.4 도입 목록에서 뺀다. 향후 외근 기록 수요가 생기면 별도 과제로 노무 검토와 함께 재기동.

### 7.7 일정·캘린더
- 웹 G6-C 미구현 → **모바일이 선행 가능**. 단, 스키마·API는 웹과 공유하도록 이 단계에서 함께 설계(개인/부서/회사 일정, 결재·휴가 연동).
- 1차 = 기존 영업 일정(`/api/sales/schedule`) 월 캘린더 + 일 리스트 + 경과 입력(현행 유지·개선).
- 2차 = 통합 캘린더(휴가·결재 마감·입찰 마감 오버레이).

### 7.8 사업장·담당자·명함 (기존 유지·보강)
- 사업장: 탐색 C안(최근 본·관계·업종) 유지 + **지도 앱 길찾기**·연락처 바로가기.
- 명함: 현행 expo-camera 경로 유지(iOS image-picker 버그 회피 상태 그대로). 앨범 선택은 Android만 노출.

---

## 8. 신규/변경 서버 작업 목록 (최소)

| 항목 | 종류 | 비고 |
|---|---|---|
| `NNN_mobile_push.sql` | 마이그레이션 | §4.2 3테이블 |
| `/api/mobile/push/{register,prefs}` | 신규 API | 토큰·설정 |
| `lib/notify/push-expo.ts` + 디스패처 | 신규 lib | 영수증 처리 포함 |
| 기존 훅에 푸시 팬아웃 연결 | 수정 | `lib/approval/notify.ts`, board 작성, mail inbound tick, leave-notice 발송, invoice request — **전부 fire-and-forget, 웹 회귀 없음** |
| `/api/mobile/home` | 신규 API | 홈 1콜 집계(기존 쿼리 재사용) |
| 첨부 다운로드 인증 | 점검 | 현재 쿠키 전제 경로가 있으면 Bearer 지원 확인 필요(메일/게시판/결재 첨부) |
| refresh 토큰 화이트리스트·폐기 | 보강 | 로그아웃/기기분실 시 무효화(§9.3) |

---

## 9. 기술 난제와 해법

### 9.1 HTML 본문 — 렌더는 확정, 작성은 논점
- **렌더**: `react-native-webview` 로 `HtmlView` 공통 컴포넌트. 원격 이미지 기본 차단·JS 비활성·링크 탭은 외부 브라우저. 메일/결재 multitext/게시판 3곳 공용.
- **작성** — ✅ **확정(2026-07-28): (a) 평문 + 최소 서식으로 시작.**
  - 입력은 RN `TextInput`(멀티라인). 서식은 **줄바꿈·굵게** 수준만. 전송 직전 서버/클라에서 `<p>`·`<br>`·`<strong>` 로 변환(XSS 이스케이프 후 화이트리스트 태그만).
  - **답장 인용은 서버가 붙인다** — 모바일에서 원문 HTML을 편집기에 싣지 않는다(깨짐·용량 문제 회피). `POST /api/mail/send` 에 `inReplyTo` + `quoteMode='server'` 를 넘기면 서버가 기존 인용 blockquote 조립. 서명도 서버측 기본 서명 자동 삽입.
  - 게시판 작성도 동일 규칙 + 사진 첨부.
  - 확장 여지(미채택): WebView 에 웹 `MailEditor` 임베드 = 서식 풀세트를 얻지만 키보드·툴바·브리지 비용. **수요가 실제로 확인되면 재검토**(2차).

### 9.2 WebView 임베드 화면의 인증 (C 등급용)
- 앱은 Bearer, 웹 화면은 쿠키 세션 → 그대로는 로그인 화면이 뜬다.
- 해법: **일회용 교환 토큰**(`/api/mobile/auth/web-session?ticket=` → 쿠키 심고 리다이렉트) 신설. C 등급을 실제로 쓸 때만 구현(§12-3에서 채택 여부 결정).

### 9.3 보안
- **앱 잠금**: `expo-local-authentication` — 백그라운드 5분 이상 후 복귀 시 생체/PIN. 기본 ON(설정에서 해제 가능).
- **토큰**: access 60m / refresh 30d 유지 + **refresh 화이트리스트 테이블**(현재 없음) → 로그아웃·기기 분실 시 서버 폐기. 푸시 토큰도 동시 폐기.
- 민감 화면(급여·인사) 미노출 원칙 유지. 스크린샷 차단은 하지 않음(사내 앱).

### 9.4 첨부 업/다운로드
- 업로드: **SDK 57 `fetch` 는 `{uri,name,type}` FormData 파트를 거부** → `expo-file-system` 의 `File` 클래스 사용(명함에서 이미 확립된 패턴, 그대로 재사용).
- 다운로드: `File.downloadFileAsync` → `expo-sharing` 으로 시스템 뷰어. 이미지·PDF는 인앱 미리보기.

### 9.5 성능·배터리
- 목록 페이지네이션 기본 30건, 이미지 `expo-image` 캐시.
- 폴링 금지 — 갱신은 푸시 + pull-to-refresh + 포그라운드 복귀 시 1회.

### 9.6 OTA vs 재빌드 경계
- M0에서 네이티브 모듈을 전부 넣고 재빌드/제출 → 이후 기능은 OTA(`eas update --channel production --environment production --non-interactive`, `EXPO_PUBLIC_API_URL` 명시 주입).
- 화면에 버전 표식 유지(OTA 적용 판별에 유용했던 패턴).

---

## 10. 로드맵 (게이트식) — ✅ 순서 확정(2026-07-28)

**M0 기반 → M1 푸시 → M2 결재 → M3 메일 → M4 소통 → M5 근태·휴가 → M6 확장.**
근거: 네이티브 모듈을 M0에 몰아 재빌드를 1회로 끝내면 이후 전 단계가 OTA로 반영되고, 푸시가 먼저 서야 "앱을 여는 계기"가 생겨 M2 이후 기능의 실사용률이 붙는다.


| 단계 | 내용 | 완료 게이트 |
|---|---|---|
| **M0 기반** ✅구현완료 | 디자인 토큰·공통 컴포넌트 16종·IA(탭 재편)·데이터 계층 확장·**네이티브 모듈 일괄 도입 후 재빌드/제출**·앱 잠금 | 새 탭 구조가 실기기(iOS TestFlight)에서 뜨고, 기존 4화면 무회귀 → **재빌드 후 실기기 검증 대기** |
| **M1 푸시** ✅배포완료 | 스키마·서버 디스패처·토큰 등록·설정 화면·딥링크·뱃지 + **게시판/결재 2개 이벤트 연결** | 실기기에서 공지 등록 → 푸시 수신 → 탭 시 해당 글 열림 → **실기기 검증 대기** |
| **M2 전자결재** ✅완료·검증 | 결재함·상세·승인/반려·AI요약 (기안·문서함은 미포함) | **실기기 결재 완주 확인(2026-07-29)** |
| **M3 메일** ✅배포완료 | 폴더·목록·뷰어(HtmlView)·첨부·작성/답장 | 실기기에서 수신 확인→답장 발송 완주 → **실기기 검증 대기** |
| **M4 소통** ✅배포완료 | 공지·게시판(조회·작성·읽음) + 주소록·조직도 | 부서 게시판 작성→푸시→읽음 처리, 임직원 전화/메일 원터치 → **실기기 검증 대기** |
| **M5 근태·휴가** ✅배포완료 | 내 근태·내 휴가·휴가 신청(결재 연동) | 휴가 신청→결재 승인→잔여 반영 완주 → **실기기 검증 대기** |
| **M6 확장** | 홈 통합 위젯·일정 캘린더·수금 요청·업무추진 내 할 일·입찰/인텔 알림 | 홈에서 3탭 이내로 주요 업무 도달 |

각 단계 종료 시: `npx tsc --noEmit`(모바일) → `expo export` 번들 검증 → **아이폰 TestFlight 실기기 완주** → 메모리·문서 갱신.

---

### 10.1 M0 구현 결과 (2026-07-28, tsc 0 · android 번들 성공, **실기기 미검증**)
| 항목 | 산출물 |
|---|---|
| 네이티브 모듈 | `expo-notifications`·`react-native-webview`·`expo-local-authentication`·`expo-document-picker`·`expo-sharing`·`expo-sqlite`·`expo-clipboard` 설치 + app.json 플러그인(notifications color/defaultChannel, local-authentication faceIDPermission). RECORD_AUDIO 중복 권한 정리. **version 1.0.1 → 1.1.0**(runtimeVersion=appVersion 이라 구 빌드에 새 JS 가 내려가지 않게 분리) |
| 디자인 토큰 | `src/global.css` 에 `--cd-*` 22종(라이트/다크, 웹 cdash.css 와 동일 hex), `tailwind.config.js` 에 `cd.*` 매핑(`rgb(var(--x) / <alpha-value>)`), `src/theme/tokens.ts`(style prop 용 hex 상수)·`useTheme()` |
| 공통 컴포넌트 | `src/components/ui/` — Screen·Card·Button/IconButton/ActionBar·Badge/Count/Chip·Avatar·Input/Textarea/SearchBar·ListRow/EmptyState/SkeletonList/ListFooter/StaleBanner·SegmentedTabs/SectionTitle·Sheet·ConfirmSheet·ToastProvider/useToast·HtmlView(WebView) |
| 데이터 계층 | `src/lib/kv.ts`(expo-sqlite KV), `useApi(path, {cache})` SWR + `staleAt`, `useInfiniteApi`, 로그아웃 시 캐시 전체 삭제 |
| IA | 5탭(홈·결재·메일·소통·더보기). 일정·사업장·담당자는 `(tabs)` 밖 스택으로 이동(`git mv`), 더보기·홈 빠른실행에서 진입. 결재·메일·소통은 M2~M4 전까지 "준비 중" |
| 홈 | 사용자 카드 + 요약 타일 4(미결재·안읽은메일·다가오는일정·미입력경과) + 빠른실행 4 + 최근 공지 3 + 다가오는 일정 3 |
| 보안 | `LockGate`(백그라운드 5분 초과 복귀 시 생체/기기암호, 기본 ON) + `/settings`(잠금 토글·계정·로그아웃·버전) |
| 기존 화면 정리 | schedule·facilities·contacts·card·홈의 하드코딩 색(`neutral-*`/`white`/`red-*`) 전부 `cd-*` 토큰으로 치환 |

**M0 에서 세운 규칙(이후 단계에서 지킬 것)**
- 헤더 옵션은 **네비게이터 레이아웃에서만 정적으로** 정의. 화면 파일 안에서 `Stack.Screen options` 인라인 렌더 금지(iOS 헤더 갱신 루프 이력).
- 파괴적 액션 확인은 `Alert.alert` 대신 `ConfirmSheet`(웹 `window.confirm` 차단 사고의 모바일 대응).
- 뱃지·목록은 폴링하지 않는다. 갱신은 포그라운드 복귀·화면 포커스·pull-to-refresh, 실시간성은 M1 푸시.

**남은 확인(실기기 게이트)**: NativeWind CSS 변수(`rgb(var(--cd-*))`)의 런타임 해석과 `prefers-color-scheme` 다크 전환은 번들에 변수명이 실린 것까지만 확인했고 **실기기 화면 확인 전이다**. 어긋나도 배경이 투명해지지 않도록 `Screen` 에 style 폴백을 넣어 두었다.

### 10.2 M1 구현 결과 (2026-07-28, 커밋 5962125·65e84fe, staging 배포 next:287, OTA e1dc0210)
| 항목 | 산출물 |
|---|---|
| 스키마 | `109_mobile_push.sql` — mobile_push_tokens / mobile_notify_prefs / mobile_notify_quiet_hours / mobile_push_log(dedup UNIQUE). staging 적용 완료 |
| 발송 | `lib/notify/push-expo.ts` — 수신자 필터(개인 토글·방해금지 KST) → dedup 선점 → 청크 발송 → `DeviceNotRegistered` 토큰 자동 폐기. 예외를 밖으로 던지지 않는다 |
| API | `/api/mobile/push/register`(POST·DELETE), `/api/mobile/push/prefs`(GET·PUT) |
| 이벤트 연결 | 게시판 POST(`notify_push` → 실제 발송, 작성자 제외) / 결재 `deliver()` 에 push 채널(기존 dedup 안에서) |
| 앱 | `lib/push.ts`(권한·토큰·채널·뱃지·로그아웃 폐기), `lib/use-push.ts`+`deeplink.ts`(리스너+콜드스타트, 중복 이동 방지), `/board/[postId]` 상세(첨부 다운로드·공유), `/notifications` 설정(이벤트 8종·방해금지) |

**M1 에서 드러난 사실**
- `approval_notify_settings`(마이그 091, AX-P0)가 **staging 에 없다.** 109 의 ALTER 를 조건부로 바꾸고 `getNotifySetting` 을 기본값 폴백으로 만들어, 091 미적용 상태에서도 결재 푸시가 나가게 했다. 091 적용 후 109 를 재실행하면 컬럼이 붙는다.
- **`FileSystem.downloadAsync` 는 SDK 57 에서 런타임 throw**(deprecated) → 첨부 다운로드는 `File.createDownloadTask` + Bearer 헤더.
- **안드로이드 푸시는 FCM 서비스 계정 키를 EAS 에 등록해야 동작한다**(미등록 = iOS 만 수신). 팀 배포 확대 시점에 처리.
- 게시글 상세 화면은 원래 M4 였으나 **푸시 도착지가 없으면 M1 게이트를 만족할 수 없어** 앞당겨 구현했다.

### 10.3 M2 구현 결과 (2026-07-28, 커밋 4bf5873, OTA 7678263d — **서버 변경 없음**)
| 항목 | 산출물 |
|---|---|
| 결재함 | `(tabs)/approval.tsx` — 대기/예정/내 기안 세그먼트(대기 카운트 뱃지), 카드=긴급·양식·기안자·일시·AI요약 3줄, 화면 복귀 시 목록·뱃지 자동 갱신 |
| 상세 | `/approval/[docId]` — 헤더·AI요약 패널·결재선 세로 타임라인(아이콘·시각·의견·대결)·양식 본문·하단 액션 바 |
| 액션 | 승인/반려 — `myStepId` 가 있을 때만 노출, 반려 사유 필수(시트). 처리 후 뒤로가기 → 목록 focus 갱신 |
| 필드 렌더 | `components/approval/FieldValue.tsx` — 17종 읽기 전용. multitext=HtmlView, **table 은 행별 "열: 값" 세로 목록으로 리플로우**(좁은 화면 축소 금지 원칙), 인원·업체·계약 선택은 객체에서 이름 추출 |
| 딥링크 | `/approval?docId=` → 문서 상세 직행(M1 에서는 탭까지만) |

**범위 밖으로 둔 것**: 기안 작성·수정(양식 편집은 웹), 문서함·양식별 조회, 결재선 변경. 블루프린트 §3.1 의 B/D 등급 그대로다.

**★M2 검증 과정에서 드러난 서버 결함 2건(모바일과 무관, 웹도 같이 막혀 있었음)**
1. **AX 마이그 091~094 미적용** — 코드만 배포되고 스키마가 없어 `activated_at` 부재로 **웹 전자결재 상신 자체가 실패**하고 있었다. 적용 후 정상화(+109 재실행으로 `push_enabled` 부착).
2. **권한 배분 누락 12종**(마이그 110) — `approval.*`·`board.*` 등이 어느 템플릿에도 없어 **admin 3명 외 전 직원이 전자결재·게시판 차단** 상태. `checkPermission` 의 admin 우회 때문에 관리자로만 테스트하면 보이지 않았다.

> 교훈: 새 기능의 권한 키를 만들면 **템플릿 배분까지가 한 세트**다. 그리고 코드 배포와 마이그 적용이 갈라지면 기능 전체가 조용히 죽는다.
**확인된 사실**: `(tabs)/approval.tsx`(=/approval)와 `approval/[docId].tsx` 는 **라우트 충돌 없이 공존**한다(typedRoutes 생성 결과로 확인).

### 10.4 M3 구현 결과 (2026-07-29, 커밋 0c6e2f7, staging next:291, OTA 33f03dae)
| 항목 | 산출물 |
|---|---|
| 목록 | 폴더 시트(안읽음 카운트)·무한스크롤·검색(q)·별표 토글·**롱프레스 단건 액션**(읽음/안읽음·보관·휴지통·복원). 낙관적 갱신 후 실패 시 롤백 |
| 뷰어 | `/mail/[messageId]` — 발신자·수신자 펼침·첨부 다운로드/공유·답장/전달. 외부 이미지 기본 차단 + 표시 버튼 |
| 작성 | `/mail/compose` — 수신자 자동완성(`/api/directory/suggest`)·참조·제목·**평문 본문**·파일 첨부(document-picker) |
| 서버 | `lib/mail/compose-assemble.ts` — 평문→HTML·기본 서명·원문 인용 조립. `/api/mail/send` 가 `plainBody` 를 받으면 이 경로를 탄다(웹 `bodyHtml` 경로 무변경) |
| 공용 | `lib/download.ts` — 인증 첨부 다운로드(게시판·메일 공용), base64 → data URL |

**M3 에서 확인한 제약**
- **WebView 는 요청에 Bearer 를 붙일 수 없다.** 그래서 `cid:` 인라인 이미지를 서버 URL 로 두면 깨진다 → 앱이 첨부를 미리 받아 **data URL 로 치환**(최대 5장). 외부 이미지 차단 정책은 그대로.
- 스와이프 제스처 대신 **롱프레스 액션 시트**를 택했다(gesture-handler·reanimated 설정 리스크 회피). 다중 선택 일괄 처리는 후속.

### 10.5 M4 구현 결과 (2026-07-29, 커밋 8d2d971, staging next:292, OTA 8b4893ef)
| 항목 | 산출물 |
|---|---|
| 소통 탭 | `[전사 공지][부서 게시판][주소록][조직도]` 세그먼트. 게시판 탭에서만 글쓰기 버튼, 탭 복귀 시 목록 재조회 |
| 게시판 | `BoardList`(미읽음 볼드·점, 고정/종료 배지, 첨부 아이콘) → M1 에서 만든 `/board/[postId]` 상세로 |
| 작성 | `/board/write` — 전사/부서 선택·제목·평문 본문·첨부·상단고정·메일/푸시 알림. 공지 기간 등 세부 설정은 웹 |
| 주소록 | `DirectoryPane` — 검색(이름·부서·직급·메일)+부서 필터, 카드에서 전화·문자·사내전화·메일(compose 딥링크)·주소 복사 |
| 조직도 | `OrgChartPane` — 웹의 **수평 조직도를 세로 아코디언 트리로 재해석**(좁은 화면에서 가로 트리는 읽을 수 없다), 부서별 인원수 |
| 서버 | `lib/text-html.ts` 로 평문→HTML 공용화, `/api/board` POST 가 `plainBody` 지원(웹 경로 무변경) |

**M4 에서 겪은 것**: 로컬 `npm run build` 가 `.next` 를 다른 세션 dev 서버와 공유해 계속 깨졌다(`Cannot find module for page` 류). **도커 빌드는 컨테이너 안에서 깨끗하게 돌아가므로 그것으로 검증**했다 — 어차피 배포에 필요한 단계라 낭비도 아니다.

### 10.6 M5 구현 결과 (2026-07-29, 커밋 74a7310, staging next:293, OTA 225ad00a)
| 항목 | 산출물 |
|---|---|
| 서버 | `listMyWeekly(userId)` + `/api/approval/attendance/me` — 본인 것만 주므로 `approval.manage` 가 아닌 `approval.view`. 기준선(소정 40h·한도 52h)은 `attendance_settings` 에서 읽는다 |
| 내 휴가 | `/leave` — 잔여 연차(발생·사용·잔여)·신청 이력(결재 상태 배지)·촉진 고지 대기 표시 |
| 휴가 신청 | `/leave/request` — 휴가 종류(규정 카탈로그)·기간(8자리)·사유 → **결재선 프리셋 선택 → 상신**. 사유 필드 키는 양식 정의에서 찾아 쓴다 |
| 내 근태 | `/attendance` — 주 선택·근무시간 게이지(소정/한도 눈금)·연장/야간/근무일·일별 출퇴근. 한도 초과분은 사규상 특별휴가 대상임을 명시 |

**설계 판단**
- **기안 전반은 여전히 웹**이지만(§3.1 B등급), 휴가 신청만은 빈도가 높아 전용 폼을 뒀다. 결재선은 **웹에서 저장한 프리셋을 재사용**한다 — 모바일에서 조직도로 결재선을 짜게 하면 화면이 무거워지고, 실제로도 휴가 결재선은 거의 고정이다. 프리셋이 없으면 웹에서 한 번 저장하도록 안내한다.
- **연차촉진 전자서명은 이번 범위에서 조회까지만** 넣었다(대기 여부 표시). 서명 자체는 법적 의미가 있는 행위라 웹의 기존 화면에서 하도록 두었다.

---

## 11. 리스크 · 비회귀 원칙

1. **웹 회귀 0.** 공용 서버 코드 수정은 푸시 팬아웃(예외 삼킴) 한정. 배포 전 웹 주요 플로우(로그인·메일 발송·결재 상신) 스모크.
2. **세션 정책 변경 금지 학습.** 과거 자동로그인 배포가 전직원 강제 로그아웃을 유발했다(레거시 토큰 유예 마이그레이션으로 수습). 토큰 스키마 변경 시 **유예 경로 필수**.
3. **푸시 오발송**은 신뢰를 즉시 잃는다 → dedup UNIQUE + 스테이징 전용 채널로 실증 후 프로덕션 연결.
4. **iOS 특이 버그 이력**: `expo-image-picker` iOS 무응답, 화면 내 인라인 `Stack.Screen options` 갱신 루프, SDK57 FormData 파트 거부 — 세 가지 회피책을 신규 화면에서도 지킨다.
5. **TestFlight 빌드 90일 만료** — 재빌드 주기 관리. Android는 APK 링크 배포(스토어 미등록).
6. **배포 대상 확대 시** 개인정보(주소록·근태) 노출 범위를 RBAC로 재확인.

---

## 12. 확정 논점 · 잔여 논점

### ✅ 확정 (2026-07-28, 사용자)
| # | 논점 | 결정 |
|---|---|---|
| 1 | 탭 IA | **5탭 = 홈·결재·메일·소통·더보기**(§5.1). 영업 4화면은 더보기+홈 빠른 실행으로 이동 |
| 2 | 본문 작성 범위 | **평문 + 최소 서식으로 시작**(§9.1). 답장 인용·서명은 서버가 조립. WebView 리치에디터는 수요 확인 후 2차 |
| 4 | 모바일 출퇴근 체크인 | **이번 범위 제외**(§7.6). 근태는 ADT 실측 유지, 모바일은 조회 전용. `expo-location` 미도입 |
| — | 착수 순서 | **M0 → M1 푸시 → M2 결재 → M3 메일 → M4 소통 → M5 근태·휴가 → M6 확장**(§10) |

### ⏳ 잔여 논점 (해당 단계 착수 전 확인)
| # | 논점 | 필요 시점 | 기본 가정(회신 없을 시) |
|---|---|---|---|
| 3 | WebView 임베드(C 등급) 사용 여부 — 쓰면 §9.2 웹 세션 브리지 필요 | M0 | **미사용.** 웹 유도는 외부 브라우저로(재로그인 감수) |
| 5 | 배포 범위·시점 — 전 직원(약 32명) 확대 시기, iOS TestFlight 유지 vs 비공개 배포 | M1 종료 후 | TestFlight + APK 링크 유지, 확대는 M2 완료 후 |
| 6 | 웹 `/m` 유지 여부 (UA 자동 리다이렉트 포함) | M4 | 앱 미설치자용으로 **유지**, 신규 개발은 중단 |
| 7 | 데이터 계층 — TanStack Query 도입 vs 자체 `use-api` 확장 | M0 | 자체 `use-api` 확장(의존성 최소 원칙) |
| 8 | 푸시 기본 정책 — 방해금지 시간대, 이벤트별 ON/OFF | M1 | 방해금지 22:00~07:00, §4.4 표의 기본값 |
| 9 | 일정·캘린더 — 웹 G6-C보다 모바일 선행 가능한가 | M6 | 모바일 선행하되 스키마·API는 웹과 공유 설계 |

---

## 부록 A. 참고 파일 인덱스
- 인증: `frontend/lib/auth/{guards,mobile-token,verify-credentials}.ts`, `frontend/app/api/mobile/auth/*`
- 결재: `frontend/lib/approval/{docs,notify,summarize,precheck}.ts`, `frontend/app/api/approval/docs/*`, `components/approval/ApprovalDocViewer`
- 메일: `frontend/lib/mail/*`, `frontend/app/api/mail/*`, `components/mail/*`
- 게시판: `frontend/lib/board.ts`, `frontend/app/api/board/*`
- 주소록: `frontend/lib/directory.ts`, `/api/directory{,/suggest,/contacts}`
- 근태·휴가: `frontend/lib/adt/*`, `/api/approval/{attendance,leave,leave-promotion}`
- 알림 자산: `frontend/lib/notify/{email-ses,kakao-solapi}.ts`, `frontend/lib/approval/notify.ts`(dedup·fire-and-forget 모델)
- 모바일 앱: `apps/mobile/src/{lib,app,components}`, `apps/mobile/{app.json,eas.json}`
