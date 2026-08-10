# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## Controlled TextInput 에 정규화 함수 금지 (사고 이력 있음)

`parseTimeRange`·`htmlToPlain` 같은 **저장 계약 정규화 함수를 controlled TextInput 의 `value=` 에
직접 물리지 말 것.** 완성형만 통과시키는 필터는 부분 입력("1", "18:3", 끝 공백)을 리렌더에서
즉시 되돌려 **타이핑 자체가 불가능**해진다(2026-08-10 초과근무 "시간" 입력 실측 — 웹 AutoTimeInput 의
로컬 버퍼를 빼고 이식해 발생). 마스킹·검증 입력은 로컬 useState 버퍼를 두고 유효값일 때만
상위로 커밋한다(`FormField.tsx` 의 `TimeInput` 참조). effect 가 자동 계산해 덮어쓰는 필드는
편집 UI 로 두지 말고 `readOnly` 잠금으로 렌더한다(초과근무 기사용·잔여시간).

## OTA 발행 시 API 주소 (사고 이력 있음)

`eas update` 는 `eas.json` 의 `build.*.env` 를 **쓰지 않는다**. 그건 빌드 전용이다.
업데이트 번들은 `--environment <env>` 로 지정한 **EAS 서버 환경변수**를 주입받고,
거기에 값이 없으면 로컬 `.env`(개발 PC LAN 주소)가 그대로 구워진다.
2026-07-30 이 경로로 프로덕션 번들에 `http://192.168.0.58:3001` 이 실려
앱의 모든 API 요청이 죽었다.

- 발행: `eas update --branch <b> --environment <production|preview>` — `--environment` 생략 금지.
- `EXPO_PUBLIC_API_URL` 의 진실원은 EAS 프로젝트 환경변수(`eas env:list --environment production`).
  저장소는 `**/.env.*` 를 무시하므로 `.env.production` 같은 파일로는 해결되지 않는다.
- 발행 후 검증: `eas update` 가 남긴 `dist/_expo/static/js/<platform>/*.hbc` 를
  `grep -a` 로 열어 의도한 호스트가 들어갔는지 확인한다(Hermes 바이트코드에도 문자열은 남는다).
