# CODEF 데모 연동 테스트 (은행 자동대조 PoC)

은행 계좌 자동수집 → 미수금 자동대조 블루프린트([../../docs/bank-reconciliation-blueprint.md](../../docs/bank-reconciliation-blueprint.md)) P0 착수 전,
CODEF API 연동 가능성을 데모/샌드박스로 검증하는 최소 스크립트. **외부 npm 의존성 없음**(Node 18+ 내장 fetch/crypto).

## 구성
- `codef.js` — 공통 헬퍼: OAuth 토큰 발급, API 호출(URL 인코딩 바디/응답 디코딩), RSA 암호화, 은행코드 맵
- `test-token.js` — OAuth 액세스 토큰 발급 테스트
- `test-account-list.js` — 보유계좌 조회 호출로 요청·응답 파이프라인 검증
- `.env.example` — 키 템플릿(커밋됨) / `.env` — 실제 키(git 제외)

## 사용법
```bash
# 1) 키 준비 (이미 .env 에 데모/샌드박스 키가 채워져 있음)
#    새 환경이면: cp .env.example .env 후 CODEF 콘솔 > 키 관리 값으로 채운다

# 2) 토큰 발급 테스트
node scripts/codef-demo/test-token.js demo
node scripts/codef-demo/test-token.js sandbox

# 3) 요청/응답 파이프라인 검증 (connectedId 없으면 CF-04015가 정상 — 경로 검증됨)
node scripts/codef-demo/test-account-list.js demo TEST_CONNECTED_ID ibk
node scripts/codef-demo/test-account-list.js sandbox TEST_CONNECTED_ID ibk
```

## 검증 결과(2026-07-22)
- ✅ 데모·샌드박스 **OAuth 토큰 발급 성공** (`expires_in≈604799`, 약 7일)
- ✅ 데모: `CF-04015`(connectedId 미존재) — **인증·전송·응답 디코딩 전 경로 정상**
- ✅ 샌드박스: CODEF 제공 마스킹 데모 계좌 반환 — 응답 필드 구조 확인

## 핵심 사양(요약)
| 항목 | 값 |
|---|---|
| OAuth | `POST https://oauth.codef.io/oauth/token` · Basic base64(id:secret) · `grant_type=client_credentials&scope=read` |
| 데모 Host | `https://development.codef.io` (샌드박스 `sandbox`, 정식 `api`) |
| API 바디 | `encodeURIComponent(JSON.stringify(body))` |
| 응답 | `+`→공백 치환 후 `decodeURIComponent` → `JSON.parse`. 200이라도 `result.code=CF-*`면 업무오류 |
| 보유계좌 | `POST /v1/kr/bank/b/account/account-list` (body: `connectedId`, `organization`) |
| 은행코드 | 기업 0003 · 국민 0004 · 신한 0088 · 하나 0081 · 우리 0020 · 농협 0011 |

## 다음 단계 (실데이터 조회)
실제 거래내역을 받으려면 **connectedId 발급(계정 등록)**이 필요:
- `POST /v1/account/create` 에 은행 로그인 자격(아이디/비번 또는 공동인증서 der/key) 전달, 비밀번호는 `publicEncRSA(publicKey, 원문)`로 암호화.
- 데모/샌드박스에서는 CODEF가 안내하는 **테스트 계정/인증서**로 발급. 정식버전에서 회사 6개 은행 계좌를 실제 등록.
- `.env`의 `CODEF_PUBLIC_KEY`(콘솔 public_key 본문)를 채우면 계정등록 스크립트로 확장 가능.

> ⚠ `.env`에는 실제 자격증명이 있으니 공유 금지. 노출이 우려되면 CODEF 콘솔에서 키 재발급.
