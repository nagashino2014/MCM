# 스토어 배포 전환 계획 — iOS Unlisted + Android 비공개 테스트

TestFlight/APK 수동 설치 → 스토어 설치(링크 클릭 → 설치 → 자동 업데이트)로 전환.
직원(고령자·비숙련 포함) 배포 장벽 제거가 목적. 확정 경로:

- **iOS**: App Store **Unlisted App Distribution** — 검색 미노출, 링크로만 설치. 일반 App Store 심사 통과 필요.
- **Android**: Google Play **비공개 테스트(Closed testing)** 트랙 — 등록된 구글 계정만 Play 스토어에서 설치.

## 저장소에서 완료된 준비 (2026-08-10)

| 항목 | 내용 |
|---|---|
| ATS 예외 축소 | `app.json` — `NSAllowsArbitraryLoads` 제거 → `NSAllowsLocalNetworking`(개발 LAN http 전용). 심사 소명 리스크 제거 |
| 미사용 권한 제거 | `RECORD_AUDIO` → `blockedPermissions`, expo-camera `microphonePermission:false`·`recordAudioAndroid:false` (앱은 오디오 미사용) |
| 개인정보처리방침 | `frontend/public/privacy.html` → **https://koensain.app/privacy.html** (미들웨어 비인증 허용). 스토어 등록 필수 URL |

⚠ app.json 변경은 **네이티브 변경** — OTA로 반영 불가, 새 스토어 빌드에 포함됨.
⚠ privacy.html 은 **next 이미지 재배포** 후에 공개 URL이 살아난다. 스토어 제출 전에 배포할 것.

## 사용자(계정) 측 절차 — 코드 밖 작업

### 공통
- [ ] **심사용 데모 계정** 생성 (실데이터 노출 없는 시연 계정 — 심사관이 로그인 게이트를 통과해야 함)
- [ ] 스토어 등록 자산: 스크린샷(iOS 6.7" 필수 / Android 폰), 앱 설명문, 지원 URL(= koensain.app 가능)
- [ ] privacy.html 내용 법무/대표 검토 (초안은 Claude 작성 — 보유기간·문의처 등 확인)

### iOS (기존 Apple Developer Program 계정 그대로)
1. [ ] App Store Connect 앱(`ascAppId 6793355848`)에 스토어 등록정보·개인정보 라벨 입력
   - 개인정보 라벨: 연락처 정보(이름·이메일·전화 — 계정), 사용자 콘텐츠(사진·문서), 식별자(사용자 ID), 위치는 **수집 안 함**(기기 내 사용, 서버 미전송)
2. [ ] production 빌드 → 심사 제출 (아래 명령)
3. [ ] 심사 승인 후 **Unlisted 신청**: https://developer.apple.com/kr/support/unlisted-app-distribution/ 폼 제출
   - "회사 임직원 전용 사내 업무 앱, 일반 사용자 대상 아님" 명시
4. [ ] 승인되면 발급된 링크를 직원에게 공유 (링크는 영구 유지)

### Android (Play Console 조직 계정 신규)
1. [ ] **D-U-N-S 번호** 확인/발급 (사업자번호 557-86-00306 기준, 무료 — 소요 최대 30일, 가장 먼저 시작)
2. [ ] Play Console **조직 개발자 계정** 등록 ($25 일회) — 조직 계정이라 "테스터 N명×14일" 요건 면제
3. [ ] 앱 생성(`app.koensain.mcm`) → 정책 설문(데이터 보안 섹션: 위 iOS 라벨과 동일 기준) + privacy.html URL 입력
4. [ ] **비공개 테스트 트랙** 생성 → 테스터 이메일 목록(직원 구글 계정) 등록
5. [ ] AAB 업로드(아래 명령) → 심사 후 참여 링크를 직원에게 공유
   - 직원 절차: 참여 링크 1회 수락 → Play 스토어에서 설치. 이후 업데이트 자동

## 빌드·제출 명령 (apps/mobile)

```bash
# iOS: 빌드 + App Store Connect 업로드 (기존 TestFlight 흐름과 동일 프로필)
eas build --platform ios --profile production --auto-submit

# Android: AAB 빌드 (production 프로필은 buildType 미지정 = AAB 기본)
eas build --platform android --profile production
# 최초 1회는 AAB를 Play Console에 수동 업로드(서명키 등록).
# 이후 서비스 계정 키를 만들면 eas submit -p android 자동화 가능
```

- 버전: `runtimeVersion.policy = appVersion` — 네이티브 변경(ATS·권한)이 있는 이번 빌드는 **빌드 직전에 version을 1.2.0으로** 올린다. ⚠ **미리 올려두면 안 됨**: version을 올린 상태로 `eas update`를 발행하면 runtimeVersion 1.2.0 번들이 되어 기존 1.1.0 설치본(현 TestFlight/APK 직원)이 OTA를 못 받는다. 순서 = ① 1.1.0 유지한 채 OTA 운영 → ② 스토어 빌드 시점에 1.2.0 인상+빌드 → ③ 이후 OTA는 `--branch production --environment production`으로 발행(AGENTS.md 사고 이력 참조, 1.1.0·1.2.0 두 런타임에 각각 발행 필요할 수 있음).
- OTA 워크플로는 스토어 전환 후에도 동일 — JS 변경은 OTA, 네이티브 변경만 스토어 재심사.

## 직원 안내(전환 시점)
- 기존 TestFlight/APK 설치본과 스토어 설치본은 같은 번들 ID — 스토어 설치가 덮어쓰며 데이터(로그인 등)는 유지됨. TestFlight 앱은 이후 삭제 안내.
