# 모바일 네이티브 앱 블루프린트 (Expo / React Native)

> 작성 2026-07-21. 기존 브라우저 기반 `/m` 프로토타입 → **Expo 네이티브 앱**으로 마이그레이션 후 기능 개선.
> 상위 맥락: [[mobile-ui-blueprint]] (웹 `/m` 확정 결정·구현 이력).

## 0. 확정 스택 (사용자 결정 2026-07-21)

| 항목 | 결정 | 이유 |
|---|---|---|
| 접근 방식 | **Expo (managed) + React Native** | 진짜 네이티브 UX. UI는 전면 재작성하되 백엔드 API·RBAC 전부 재사용 |
| 타겟 | **iOS + Android 동시** | 단일 코드베이스, 영업 외근용 → 안드 사용자 존재 가능성 |
| 빌드 환경 | **Windows only (Mac 없음)** → **EAS Build** | Mac 없이 클라우드에서 iOS 빌드·서명·제출. Expo를 고른 결정적 이유 |
| 배포 | **사내/영업팀 비공개** | iOS=TestFlight(내부 100·외부 10k), Android=Play Internal track. 스토어 심사 부담 최소 |
| 스타일 도구 | **NativeWind** | Tailwind 문법으로 cdash 클래스 감각 계승. 호환 문제 시 StyleSheet 폴백 |
| 테스트 iOS | **실기기 확보됨** | 물리 아이폰 + EAS dev client로 iOS 검증(시뮬레이터 불가) |

### Windows-only의 실무적 함의 (반드시 인지)
- **iOS 시뮬레이터를 못 쓴다.** Mac이 없으므로 iOS 실기기 검증은 **물리 아이폰 1대 + EAS dev client**로만 가능. → **테스트용 아이폰 1대 확보가 전제.**
- 안드로이드는 Windows 에뮬레이터/실기기 모두 가능 → **1차 개발·디버깅은 안드로이드에서 빠르게 돌리고, iOS는 EAS 빌드→실기기 확인** 리듬이 현실적.
- 유료 전제: **Apple Developer Program $99/년**(TestFlight도 필수), **Google Play 개발자 $25 1회**. EAS는 무료 티어로 시작 가능(월 빌드 수 제한, 초기엔 충분).

---

## 1. 아키텍처 원칙

```
 [Expo RN 앱]  ──HTTPS + Bearer JWT──►  [Next.js API 라우트 (기존)]  ──►  RDS / S3 / SQS
   apps/mobile/                          frontend/app/api/**              (무변경)
   - expo-router 화면                     - guards.ts 한 곳만 Bearer 수용
   - expo-secure-store 토큰               - 나머지 라우트 무변경 재사용
   - 네이티브 카메라/푸시/생체인증
```

**핵심 원칙 3가지**
1. **백엔드는 최대 재사용.** 비즈니스 로직이 전부 `frontend/app/api/**` 라우트에 있고 `requireSession()` 단일 관문을 통과한다. 네이티브는 UI 클라이언트만 교체.
2. **UI는 전면 재작성이 불가피.** cdash(Tailwind + CSS 변수)는 웹 전용 → RN 스타일 시스템으로 이식. 단 **디자인 토큰(색·간격·타이포)과 화면 구조·플로우는 `/m`에서 1:1 계승**하여 재설계가 아닌 포팅으로 만든다.
3. **모노레포 유지.** `apps/mobile/`(신규) 을 추가. 공유 타입은 점진적으로 추출하되 초기엔 복제 최소화.

### 모노레포 배치
```
MCM/
  frontend/            # 기존 Next.js (API 서버 겸용) — 유지
  backend/  scraper/  infra/  ...
  apps/
    mobile/            # 신규 Expo 앱 (독립 package.json, 독립 빌드)
```
> `frontend/`를 건드리지 않고 `apps/mobile/`를 병렬로 둔다. 배포 파이프라인(ECS next 이미지)과 무관 — 모바일은 EAS로 따로 빌드.

---

## 2. 인증 전환 — **최대 난관 (여기가 프로젝트의 심장)**

### 문제
현재 next-auth v5는 **HttpOnly 쿠키에 담긴 JWT 세션**(`session.strategy='jwt'`, maxAge 12h)이다. RN 앱은 브라우저 쿠키 저장소가 없어 이 방식이 그대로 동작하지 않는다.

### 해법 — Bearer 토큰 병행 수용 (백엔드 변경 최소)
현재 인증 관문이 `frontend/lib/auth/guards.ts`의 `requireSession()` **한 곳**이라는 사실이 결정적. 이 함수만 확장한다.

**백엔드 작업 (frontend/ 내부, 국소적)**
1. **로그인 검증 로직 추출**: `config.ts`의 `Credentials.authorize` 본문(사번/이메일 → bcrypt 검증 → throttle)을 `verifyCredentials(identifier, password, ip)` 순수 함수로 분리. 기존 웹 로그인은 이 함수를 그대로 호출(회귀 없음).
2. **신규 라우트** `POST /api/mobile/auth/login`:
   - `verifyCredentials` 재사용 → 성공 시 **자체 서명 JWT 2종** 발급.
     - `accessToken` (짧게, 예 30~60분) — role·userId·status 클레임 포함, `AUTH_SECRET`으로 HS256 서명.
     - `refreshToken` (길게, 예 30일) — DB 또는 서명 토큰. 외근 중 잦은 재로그인 방지가 목적.
3. **신규 라우트** `POST /api/mobile/auth/refresh`: refresh 검증 → 새 access 발급. **이때 `findUserById`로 status/role 재확인** → 정지된 계정이 토큰 만료까지 유효한 문제 차단.
4. **`requireSession()` 확장**: 요청에 `Authorization: Bearer <jwt>` 헤더가 있으면 그 토큰을 검증해 `AuthContext` 생성, 없으면 기존 `auth()` 쿠키 세션. → **나머지 모든 API 라우트는 수정 0.** RBAC(`requirePermission` 등)도 그대로 동작.

**앱 작업**
- `expo-secure-store`에 access/refresh 저장(Keychain/Keystore 하드웨어 보안).
- **fetch 래퍼**: 매 요청 Bearer 첨부 → 401 시 자동 refresh 후 1회 재시도 → refresh도 실패면 로그인 화면.
- 로그인 화면(사번/비밀번호), `mustChangePassword` 플래그 처리(웹과 동일 정책 — 변경 화면으로 유도하거나 앱에서 안내).

> **주의**: 웹 미들웨어의 `authorized` 콜백(UA 리다이렉트 등)은 쿠키 세션 전제이므로 네이티브 요청과 무관. 모바일 API는 미들웨어 matcher를 통과하되 `requireSession`이 Bearer로 인증한다. `/api/auth/*`, `/api/mobile/auth/login|refresh`는 비인증 허용 경로로 authorized에 추가.

---

## 3. 화면 매핑 (`/m` → RN)

| 웹 (`components/mobile/*`) | RN 스크린 | 재사용 API | 비고 |
|---|---|---|---|
| MobileHome | `(tabs)/index` | `/api/sales/upcoming-activities`, `/api/sales/pending-reports` | 일정 카드 + 미입력 경과 |
| MobileSchedule | `(tabs)/schedule` | `/api/sales/schedule?month=` | 월 미니캘린더 + 일 리스트 |
| MobileFacilities | `(tabs)/facilities` | `/api/facilities` (+ `browse-stats`, `?includeFilters=1`), `/api/facilities/[id]/contacts` | 탐색 C안(최근·관계·업종 그리드·필터칩) |
| MobileContacts | `(tabs)/contacts` | `/api/sales/contacts` | engagement 필터, tel:/sms: |
| MobileCard | `card` (모달/스택) | `/api/facilities/business-card/parse`, `/[id]/contacts/card`, `/api/facilities/manual`, `/api/facilities?q=` | **네이티브 카메라로 대폭 개선** |
| mobile-shared (ActivityDetailSheet 등) | 공용 컴포넌트 | `/api/sales/activities/[id]/progress` | 경과 입력 바텀시트 |

**라우팅**: `expo-router`(파일 기반, Next App Router와 유사) + 하단 탭 4개(홈·일정·사업장·담당자) — MobileShell 탭 구조 계승.

**디자인 시스템 이식**: cdash `--cd-*` CSS 변수를 **RN 테마 객체**(라이트/다크 2벌)로 1:1 변환. primary `#5D87FF`, Plus Jakarta Sans + Pretendard(폰트는 `expo-font`로 번들). 스타일 도구는 아래 §7 논점.

---

## 4. 네이티브 기능 개선 (마이그레이션의 실익 = 여기)

웹에서 불가능했거나 열악했던 것들. **이게 네이티브로 가는 명분**이다.

1. **네이티브 카메라(명함)** — `expo-camera`. 웹 `<input capture>` 대비 프리뷰·재촬영·연속촬영·플래시·자동초점. 파싱 API는 그대로.
2. **푸시 알림** — `expo-notifications` + APNs(iOS)/FCM(Android). 신규 일정 배정·미입력 경과 리마인드·사업분야 매칭 알림([[universal-scraper-framework]] 077 알림)을 폰으로. 서버는 디바이스 토큰 등록 엔드포인트 + 발송 시 Expo Push API 호출 추가.
3. **생체인증 세션 잠금** — `expo-local-authentication`(Face ID/지문). 앱 재진입 시 잠금 → 분실 단말 보호. 12시간 세션보다 안전·편리.
4. **오프라인 캐시(선택·후순위)** — 최근 조회 사업장/일정 로컬 캐시(SQLite/MMKV)로 지하·현장 무신호 대응. 쓰기는 큐잉 후 복귀 시 동기화(복잡도 큼 → 별도 판단).
5. **딥링크·공유** — `expo-linking`. 알림 탭 → 해당 일정/사업장 직행.
6. **연락처·전화 연동** — tel:/sms:는 이미 되지만, 네이티브에서 통화 후 자동 경과 입력 유도 등 확장 여지.

---

## 5. 단계별 로드맵 (N = Native)

각 단계 끝에 **게이트(gate)** = 넘어가기 전 통과해야 할 검증.

- **N0 · 스택 부트스트랩 & "실기기에 뜬다" 게이트**
  - `apps/mobile` Expo 앱 스캐폴딩(expo-router, TS), EAS 계정·프로젝트 연결.
  - EAS Build로 **dev client**를 안드로이드 + iOS(실 아이폰) 양쪽에 설치, 빈 화면이라도 실행 확인.
  - Apple Developer 가입($99), 인증서·프로비저닝은 **EAS 자동 관리**에 위임.
  - 게이트: 물리 iPhone·Android에서 앱이 열림.
- **N1 · 인증 (§2 전부)**
  - 백엔드: `verifyCredentials` 추출 + `/api/mobile/auth/login|refresh` + `requireSession` Bearer 수용.
  - 앱: 로그인 화면 + SecureStore + fetch 래퍼(자동 refresh).
  - 게이트: 실기기 로그인 → 보호 API 1개(예 `/api/sales/schedule`) 200 응답 렌더.
- **N2 · 열람 4종 포팅** (홈·일정·사업장·담당자, 읽기 전용)
  - 디자인 토큰 이식 + 탭 셸 + 4화면. `/m`과 동일 데이터·플로우.
  - 게이트: 실데이터로 4탭 렌더·다크모드·페이지네이션 확인.
- **N3 · 쓰기 & 네이티브 카메라**
  - 명함 촬영(expo-camera) → 파싱 → 연락처/간이 사업장 등록, 일정 경과 입력.
  - 게이트: 실명함 촬영→파싱→저장 라운드트립, 경과 입력 반영.
- **N4 · 네이티브 강화**
  - 푸시(디바이스 토큰 등록 + 서버 발송) → 생체인증 잠금 → 딥링크.
  - 게이트: 실기기 푸시 수신→탭→해당 화면 딥링크.
- **N5 · 배포 파이프라인 정식화**
  - EAS 빌드 프로파일(dev/preview/production), `eas submit`으로 TestFlight 자동 업로드, Android internal track.
  - 사내 배포 안내(설치 방법·TestFlight 초대) 문서화.
  - 게이트: 영업팀원 1인이 TestFlight/Play로 설치·로그인 성공.

> 오프라인 캐시(§4-4)는 로드맵에서 **의도적으로 빠짐** — N4 이후 필요성 재평가.

---

## 6. 배포 / EAS 파이프라인 (Windows-only 대응)

- **eas.json 프로파일**: `development`(dev client·internal dist), `preview`(내부 배포용 ad-hoc/internal), `production`(스토어 제출).
- **iOS**: `eas build -p ios --profile production` → `eas submit -p ios` → **TestFlight**. 인증서·프로비저닝 프로파일은 EAS가 Apple 계정 연동해 자동 생성(Mac 불필요). TestFlight 빌드 90일 만료 주의 → 정기 재빌드.
- **Android**: `eas build -p android` → `eas submit -p android`(Play Internal testing track) 또는 preview APK 직접 배포(사내 링크).
- **OTA 업데이트**: `expo-updates`로 JS 변경은 스토어 재심사 없이 배포 가능(네이티브 모듈 추가 시엔 재빌드 필요). 사내 배포에서 반복 속도 크게 향상.
- **비용 요약**: Apple $99/년 + Google $25(1회) + EAS 무료→필요 시 Production $99/월.

---

## 7. 미해결 논점 (진행 전 확정 필요)

1. ~~**RN 스타일 도구**~~ → **NativeWind 확정**(2026-07-21). 호환 문제 시 StyleSheet 폴백.
2. ~~**테스트 아이폰 확보**~~ → **확보됨**(2026-07-21).
3. **refresh 정책**: access TTL(30분?) / refresh TTL(30일?) / refresh 저장을 서명 토큰 vs DB 화이트리스트(로그아웃·강제만료 지원 여부). 정지 계정 즉시 차단 요구 강도에 따라 결정.
4. **푸시 인프라**: Expo Push(무료·간단) vs 직접 APNs/FCM. 초기엔 Expo Push 권장. 발송 트리거를 기존 크론/알림 파이프라인 어디에 붙일지.
5. **앱 식별자·브랜딩**: bundle id(예 `com.mcm.permitiq`), 앱 이름·아이콘·스플래시. 기존 mcm-192/512 재활용 가능.
6. **웹 `/m`의 운명**: 네이티브 출시 후 (a) 유지(로그인 안 된 빠른 열람·데스크톱 폴백) vs (b) 폐지. → 당분간 병행 권장.

---

## 8. 리스크

- **iOS 디버깅 병목**: Mac 없음 → 미묘한 iOS 이슈는 EAS 빌드 왕복(수 분~십수 분)으로만 확인. 안드 우선 개발로 완화하되, iOS 전용 버그(Safari WebView·권한 다이얼로그·세이프에어리어)는 시간 소요 각오.
- **인증 회귀**: `requireSession` 확장이 전 API 공통 관문 → 실수 시 광범위 영향. Bearer 분기·쿠키 분기 각각 테스트 필수. (웹 세션 회귀 없음을 우선 확인)
- **RBAC 반영 지연**: 토큰에 role 담으면 권한 변경이 access 만료까지 미반영 → refresh 시 재조회로 완화(짧은 access TTL).
- **스토어 정책**: 사내 비공개라도 TestFlight 리뷰(외부 테스터 그룹 시) 있음. 카메라·알림 권한 사유 명시 필요.
```
