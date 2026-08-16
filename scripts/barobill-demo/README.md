# 바로빌(Barobill) 연동 테스트 (은행 자동대조 / 지출결의 PoC)

CODEF에서 **바로빌로 벤더 전환**(종량제·기본료 없음) 후, 계좌 입출금내역 자동수집을 검증하는 스크립트.
외부 npm 의존성 없음(Node 18+ 내장 fetch). 바로빌은 **SOAP(.asmx) 웹서비스**.

## 바로빌 연동 구조 (CODEF와 다름)

```
계좌 등록(자격·은행 빠른조회) → 바로빌이 수집주기대로 은행에서 배치 수집 → 바로빌 DB 저장
                                                                        → API로 조회(GetPeriodBankAccountTransLog)
```
- CODEF(요청 시 실시간 스크래핑)와 달리 **바로빌이 미리 배치 수집**한 걸 조회. 미수금 대조(일 배치)에 적합.
- 인증 = **CERTKEY(연동인증키) + CorpNum(사업자번호) + ID(바로빌 회원 아이디)**.
- 반환값이 **음수 5자리면 오류코드**.

## 구성
- `barobill.js` — SOAP 호출 헬퍼(엔드포인트·XML 빌드·간단 파싱)
- `get-manage-url.js` — 계좌 등록/관리 URL 발급(권장 등록 경로)
- `test-bank-list.js` — 등록 계좌 목록(GetBankAccountEx2)
- `test-bank-translog.js` — 입출금내역(GetPeriodBankAccountTransLog, 페이징)
- `.env.example` / `.env`(git 제외)

## 선결 작업 (실행 전 사용자 준비)
1. **바로빌 가입 + 연동인증키(CERTKEY) 발급** — 견적 준 (주)케이넷/바로빌 개발자센터. 테스트는 **테스트베드 CERTKEY**.
2. **`.env` 채우기** — `BAROBILL_CERTKEY`, `BAROBILL_CORPNUM`(사업자번호), `BAROBILL_ID`.
3. **각 은행 빠른조회/간편조회 서비스 등록** — 은행 인터넷뱅킹에서. (국민·기업·농협·하나=빠른조회, 신한=간편조회, 우리=스피드조회)
4. **바로빌에 계좌 등록** — `node get-manage-url.js test` 로 관리 URL 받아 브라우저에서 계좌·자격 등록(권장), 또는 `RegistBankAccountEx`.

## 실행
```bash
node scripts/barobill-demo/get-manage-url.js test          # 계좌 등록 URL 발급
node scripts/barobill-demo/test-bank-list.js test 1        # 사용중 계좌 목록
node scripts/barobill-demo/test-bank-translog.js test <계좌번호> 20260601 20260722
```

## 핵심 사양(요약)
| 항목 | 값 |
|---|---|
| 엔드포인트 | 테스트 `testws.baroservice.com` / 운영 `ws.baroservice.com`, `/BANKACCOUNT.asmx` |
| 은행코드 | IBK·KB·SHINHAN·HANA·WOORI·NH |
| 수집주기 | DAY1(1일)·HOUR4·HOUR1·MINUTE30·MINUTE10 |
| 입출금 필드 | TransDT(일시)·Deposit(입금)·Withdraw(출금)·**TransRefKey(중복키)** |
| 중복체크 | **BankAccountNum + TransRefKey** → 원장 dedup_key |
| 조회범위 | 최대 200일, 페이징(최대 100건/페이지) |

## CODEF 실증 자산 재사용
- 은행별 입금자명 필드 매핑·매칭엔진·원장 모델은 [은행 자동대조 블루프린트](../../docs/bank-reconciliation-blueprint.md) 그대로.
- 바뀌는 건 **수집 커넥터만**(CODEF connectedId → 바로빌 SOAP).

## 실측 확정 (2026-08-15, 테스트베드 CERTKEY)
- **SOAP 네임스페이스 = `http://ws.baroservice.com/`** (테스트베드 포함. tempuri.org 아님 — SOAPAction 불일치 시 HTTP 500 SoapException). WSDL: `{host}/BANKACCOUNT.asmx?WSDL`.
- CERTKEY 인증 왕복 정상: `GetBankAccountEx2` 빈 목록(계좌 미등록 상태) · `GetErrString` 동작 · `CheckCERTIsValid` → `-31100`(등록된 공동인증서 없음 — 세금계산서 발행 전 인증서 등록 필요, 계좌·카드 조회와는 무관).
- 카드는 **매입내역(PURCHASE) 전용 확정** — CARD.asmx `GetPurchaseHistories` 계열로 확장 예정(승인내역 미사용). 상세는 [바로빌 재무 연동 블루프린트](../../docs/barobill-finance-blueprint.md).
