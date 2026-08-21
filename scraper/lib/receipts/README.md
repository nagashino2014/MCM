# 전자상거래 카드영수증 수집 (스파이크)

부가세 신고 증빙용으로 쇼핑몰 주문 건의 **신용카드 매출전표를 PDF 로 일괄 수집**한다.

| 사이트 | `--site` | 상태 |
|---|---|---|
| 11번가 | `11st` (기본) | ✅ 무인 수집 동작 — 로그인만 사람이 한다 |
| G마켓 | `gmarket` | ✅ 무인 수집 동작(실계정 확인) |
| 옥션 | `auction` | 🔶 실측 반영 완료. 실계정 전표 저장 검증만 남음 |
| 네이버페이 | `naver` | ✅ 2단계 수집 동작(실계정 확인) |
| 쿠팡 | `coupang` | ✅ 묶음 전표 수집(일괄 신청 기능 활용) |

사이트별 차이는 전부 `config.ts` 의 `SiteConfig` 로 표현하고, 수집 절차(`collector.ts`)는 공통이다.

## 왜 이 형태인가

- 쿠팡(Akamai Bot Manager)·네이버는 headless 브라우저를 탐지해 막는다. 11번가도 자동 로그인은 봇으로 잡힐 수 있다.
  → **로그인은 사람이 직접**(캡차·2차인증 포함), 스크립트는 그 뒤의 **브라우저 프로필**만 재사용한다.
  (storageState 파일 방식은 저장할 때마다 Playwright 가 origin 마다 임시 페이지를 열고 닫아 로그인 중 창이 깜빡였다)
  단, Chromium 은 만료 없는 **세션 쿠키를 프로필에 저장하지 않으므로** 쿠키만 따로 떠서(`cookies.json`)
  다음 실행에 주입한다. 쿠키만 읽는 `context.cookies()` 는 임시 페이지를 열지 않아 깜빡임이 없다.
- 영수증 화면은 4개 몰 모두 **PC 웹에만** 있다(모바일 앱에는 없음). 그래서 데스크톱 UA·뷰포트로 접근한다.
- 무인 실행(ECS worker)에는 맞지 않는다. **로컬 CLI** 로 신고철에 돌리는 용도다.

## 사용 순서

```bash
cd scraper
npm run receipts -- login                 # 브라우저에서 직접 로그인 → 주문목록까지 이동 후 창 닫기
npm run receipts -- check                 # 세션이 살아있는지
npm run receipts -- probe                 # 주문목록 실측(셀렉터·영수증 진입점 확인)
npm run receipts -- probe --watch         # headed 로 띄워 직접 클릭 → 팝업 주소·XHR 기록
npm run receipts -- collect --from 2026-07-01 --to 2026-07-31 --dry-run   # 목록 파싱만
npm run receipts -- collect --from 2026-07-01 --to 2026-07-31 --limit 1   # 1건만 실제 저장
npm run receipts -- collect --from 2026-07-01 --to 2026-07-31 --pages 5   # 전량
npm run receipts -- summary               # 대장 요약
```

산출물은 전부 `data/receipts/11st/` 아래(.gitignore 대상):

```
browser-profile/        브라우저 프로필 — 외부 공유·커밋 금지
inbox/                  손으로 받은 전표 PDF 를 넣어 두는 곳(import 가 읽어 간다)
cookies.json            세션 쿠키 — 로그인 상태 그 자체. 외부 공유·커밋 금지
session-check.json      세션이 실제로 살아 있는지 마지막으로 확인한 결과(앱 화면이 이 값을 보여준다)
site-config.json        probe/login 이 실측한 URL·셀렉터(기본값보다 우선 적용)
receipts/YYYY-MM/*.pdf  영수증
ledger.csv              수집 대장(주문번호·품명·금액·영수증종류·파일경로)
probe/                  실측 덤프(HTML·스크린샷·probe-*.json)
failed/                 실패 건 진단 덤프
```

## 실측으로 확정된 것 (11번가, 2026-08)

- **headless 접근이 막히지 않는다.** 저장된 세션으로 `buy.11st.co.kr/my11st/order/OrderList.tmall` 에 HTTP 200, 로그인 유지.
- **영수증은 주문번호만으로 열린다.**
  `https://buy.11st.co.kr/my11st/receipt/viewReceipt.tmall?method=orderReceipt&ordNo={ordNo}&isSSL=Y`
  → 목록에서 버튼을 클릭할 필요가 없다. `config.receiptUrlTemplate` 가 이 경로를 쓴다.
- **주문 목록은 iframe 안에 그려진다.** 메인 문서만 보면 아무것도 안 잡힌다. 그래서 주문번호 수집·페이지네이션은 모든 프레임을 훑는다.
- **`viewReceipt.tmall` 이 주는 "결제영수증"은 증빙으로 쓸 수 없다.** 품목·카드번호는 찍히지만,
  문서 본문에 "소득공제용 영수증 및 매입 세금계산서로 활용할 수 없으며 … 세무상의 지출증빙 효력이 없습니다"라고
  명시돼 있다. 부가세 증빙은 '나의11번가 > 증빙서류 발급'(`documentaryEvidence.tmall`)에서 나오는
  신용카드 매출전표·지출증빙 현금영수증이어야 한다 → **수집 대상 문서를 그쪽으로 바꿔야 한다(실측 중).**
- **신용카드 매출전표는 폼 POST 로만 열린다.** '증빙서류 발급 > 영수증' 의 발급 버튼이 보내는 요청:
  ```
  POST https://buy.11st.co.kr/remittance/documentaryEvidencePop.tmall
  method=displayCardPop&ordNo={ordNo}&ordPrdSeq=1&prdSeqCnt=&prdSeq=0&prdTypCd=01&prfItmClfCd=
  ```
  주문번호만 있으면 되므로, 증빙 페이지로 이동한 뒤 폼을 만들어 제출하는 방식으로 자동화했다(`config.receiptRequest`).
- **기간 조회는 URL 파라미터로 된다**(증빙서류 발급 화면):
  ```
  https://buy.11st.co.kr/my11st/remittance/documentaryEvidence.tmall
    ?method=displayDocumentaryEvidenceIssue&docTyp=ord
    &stDate=20240701&endDate=20260821
    &startYY=2024&startMM=07&startDD=01&endYY=2026&endMM=08&endDD=21
    &pageNo=1&limit=10
  ```
  `config.listRequest` 가 이 요청을 쓴다. `limit` 을 키워 한 번에 많이 받고, 넘치면 `pageNo` 를 올린다
  — 목록의 '다음' 버튼에 기대지 않으므로 페이지 이동이 훨씬 견고하다.
- **전표는 주문 내 상품별로 나뉜다.** `ordPrdSeq` 를 1부터 올리면 상품마다 처리일련번호가 다른 전표가 나오고,
  상품 수를 넘기면 값이 비어 있는 양식이 나온다. 그래서 수집기는 순번을 올려가며 받다가
  **본문에 주문번호가 없는 빈 양식**이 나오면 그 주문을 끝낸다.
- **주문번호 앞 8자리가 주문일이다**(`20251027006519699` → 2025-10-27). 목록의 날짜 칸을 파싱하지 않고 기간 필터를 건다.

## 이 스파이크로 확인하려는 것

1. **세션 재사용이 되는가** — 저장한 세션으로 headless 접근 시 로그인 페이지로 튕기지 않는지. 튕기면 `--headed`.
2. ~~어떤 방식으로 PDF 가 만들어지는가~~ — 확정. 실측(Playwright 1.59 / Chromium)에서 `page.pdf` 가
   headless 는 물론 **headed 에서도 동작**한다. 봇 확인 때문에 화면을 띄워야 하는 사이트에서도 PDF 가 그대로 나온다.
   버전·환경에 따라 막힐 수 있어 `cdp.printToPDF` → `html-snapshot` 폴백은 남겨 뒀고, 성공한 방식은 대장의 `method` 열에 남는다.
3. ~~영수증이 어떻게 뜨는가~~ — 확정. 11번가는 주문번호로 직접 여는 경로를 쓴다(위 참고).
   버튼 클릭 경로(팝업/이동/레이어)는 `receiptUrlTemplate` 이 없는 다른 몰을 위해 남겨 뒀다.
4. **품목이 실제로 찍히는가** — 11번가의 "카드영수증"은 결제 전표라 품목이 없고 "거래명세서" 쪽에 품목이 있을 수 있다.
   둘 다 받아 보고 세무 제출 요건에 맞는 쪽을 고른다.

## 아직 확정되지 않은 것

- (해결) ~~기간 조회 파라미터~~ — 아래 "실측으로 확정된 것" 참고.
- **페이지네이션이 실제로 동작하는지** 확인되지 않았다. 지금은 '다음' 을 눌러도 목록이 그대로면
  이동 실패로 보고 종료한다(같은 목록을 반복해 읽지 않는다). 주문이 많아 목록이 여러 장인 경우를
  아직 만나지 못해, 그때 `nextPageSelectors` 가 맞는지는 미검증이다.

## 손으로 받은 전표 넣기 (import)

쿠팡은 로그인 화면이 봇 확인(Akamai)에 막혀 **자동 수집을 하지 않는다**. 대신 원래도 사람이 해야 하는
일괄 신청 결과 페이지를 브라우저에서 PDF 로 저장하고(분기당 두 장 남짓), 그 파일을 대장에 올린다.

```bash
# data/receipts/coupang/inbox/ 에 PDF 를 넣고
npm run receipts -- import --site coupang          # 대장 기록 + receipts/<YYYY-MM>/ 로 이동
npm run receipts -- import --site coupang --keep   # 원본을 inbox 에 남기고 싶을 때
```

- 한 파일에 여러 건이 들어 있는 묶음 전표는 **건별로 쪼개** 기록한다. 건마다 반복되는 머리글
  (`receiptKeywords`)을 경계로 삼고, 머리글 수와 주문번호 수가 맞을 때만 그 경계를 믿는다.
  안 맞으면 주문번호 위치에서 자른다.
- PDF 텍스트는 좌표를 보고 같은 줄끼리 묶어 뽑는다(`pdf-text.ts`). 조각을 공백으로만 이으면
  `매 출 전 표` 처럼 자간이 벌어져 라벨 정규식이 전부 빗나간다.
- 추출한 텍스트는 PDF 옆에 `.txt` 로 남는다 — 품목·금액이 비면 그 파일을 열어 실제 문구를 확인한다.
- 이미 대장에 있는 건만 들어 있는 파일은 옮기지 않고 inbox 에 그대로 둔다.
- 스캔 이미지 PDF 는 글자가 없어 읽지 못한다(브라우저에서 인쇄한 PDF 는 글자가 들어 있다).

## 스테이징으로 올리기

수집은 개인 PC 에서만 되지만 **부가세 신고는 스테이징에서** 한다. 그래서 대장과 PDF 를 서버로 올린다.

- 앱(로컬)에서 **[스테이징으로 올리기]** → `POST /api/receipts/shop/sync`
  - 대장 행은 `shop_receipts` 테이블로(`infra/aws/196_shop_receipts.sql`),
    PDF 는 계약문서 스토리지에 `shop-receipts/<몰>/<YYYY-MM>/<파일명>` 으로 올라간다.
  - `receipt_id = sha256(몰|주문번호|전표종류)` 라 다시 올려도 한 행이다.
    품목·금액은 갱신되고, 새 값이 없으면 기존 storage_key 를 지우지 않는다.
  - 쿠팡 묶음처럼 여러 행이 한 파일을 가리키면 파일은 한 번만 올린다.
- 조회는 **어디서든** 된다 — 스테이징 화면의 "올라온 전표" 목록이 같은 데이터를 본다.

### 카드 원장 매칭 (197_shop_receipt_match.sql)

부가세 신고의 완성형은 "법인카드 원장의 결제 건마다 품목이 나오는 전표가 붙어 있는가" 다.
전표에서 승인번호·카드끝4 를 함께 뽑아(`extractPaymentFields`) 올리고, 화면의 **[자동 매칭]** 이
`card_transactions` 와 잇는다. 단계는 위가 강하고 **유일 후보일 때만** 확정한다:

| 단계 | 기준 | basis |
|---|---|---|
| 1 | 승인번호 + 금액 | `approval` |
| 2 | 카드끝4 + 금액 + 날짜 ±1일 | `card` |
| 3 | 같은 주문(#순번 제거) 전표 합계 = 원장 1건 + 날짜 ±1일 — 11번가 상품별 분할 | `order-sum` |
| 4 | 금액 + 날짜만 맞는 건 → 확정하지 않고 [연결] 후보로만 제시 | `manual` |

- 원장 기준 커버리지: 가맹점명이 쇼핑몰/PG(`SHOP_STORE_KEYWORDS`)인데 전표가 안 붙은 결제 목록 —
  수집 누락을 여기서 잡는다.
- **묶음 전표 물리 분리**: import 는 쿠팡처럼 한 PDF 에 전표 수십 장이 든 파일을
  건별 1장짜리 PDF 로 쪼갠다(전표들이 서로 다른 페이지에서 시작할 때 — 쿠팡은 페이지당 1장).
  원장 1건 ↔ 전표 파일 1개가 되어야 매칭이 문서 단위로 완결되기 때문. 원본 묶음은
  `receipts/<월>/bundles/` 에 보관만 한다. 페이지를 공유하면 분리 없이 묶음 참조로 남긴다.
- 마이그레이션 적용: `powershell -ExecutionPolicy Bypass -File scripts\apply-sql.ps1 -Sql infra\aws\196_shop_receipts.sql`

## 세션 수명

11번가 세션은 하루 남짓이면 만료된다(전날 로그인한 프로필로 다음 날 열면 로그인 페이지로 튕긴다).
그래서 **스케줄러로 방치하는 완전 무인 실행은 불가능**하고, 현실적인 형태는 "로그인 한 번 + 명령 몇 줄"이다.
`collect` 는 만료를 감지하면 무엇을 해야 하는지 안내하고 멈춘다.

쿠키 파일이 있다고 로그인이 유지되는 것은 아니다. 만료되기도 하고, 도메인이 갈리면
(G마켓: `gmarket.co.kr` 은 통과하는데 `receipt.gmarket.co.kr` 은 다시 로그인 요구) 튕긴다.
그래서 **실제 접근 결과**를 `session-check.json` 에 남기고 화면은 그것을 기준으로 표시한다.

| 남기는 시점 | 결과 |
|---|---|
| `check` | 확인 URL 접근 결과 그대로 |
| `collect` | 주문목록이 열리면 유효, 로그인으로 튕기거나 전표가 로그인을 요구하면 만료 |
| `bulk` | 묶음 전표 화면이 열리면 유효, 로그인을 요구하면 만료 |
| `login` | 로그인 페이지에서 창을 닫았으면 만료, 아니면 판정을 지운다(=확인 필요) |

로그인 창을 닫았다고 대상 화면까지 열린다는 보장이 없어서, `login` 직후는 "유효"가 아니라
"확인 필요"로 둔다. 수집을 한 번 돌리면 그 결과로 자연히 갱신된다.

## 주의

- 각 몰 약관은 자동화 접근을 제한한다. 본인 계정의 본인 결제내역이라도 계정 차단 가능성이 있으니
  건당 딜레이(`--delay`, 기본 2초)를 유지하고 저빈도(신고철 월 1회)로 돌린다. 캡차 우회 도구는 쓰지 않는다.
- 봇 확인이 있는 사이트(`stealth: true`)는 Playwright 기본 인자 중 `--enable-automation` 을 뺀다.
  이 스위치가 "Chrome이 자동화된 테스트 소프트웨어에 의해 제어되고 있습니다" 안내줄을 띄우고
  그 자체가 판정 신호로 쓰인다(쿠팡 로그인 페이지가 Akamai Access Denied 로 막힌 적이 있다).
  그래도 막히면 잠시 뒤 다시 시도한다 — 계정·IP 평판 기반이라 시간이 지나면 풀리는 경우가 많다.
- `RECEIPTS_CHROME_PATH` 로 실제 설치된 Chrome 을 지정할 수 있다(번들 Chromium 보다 탐지를 덜 받는 경우가 있음).

## G마켓 실측 (2026-08)

주문목록의 '거래영수증'은 11번가 결제영수증과 마찬가지로 **세무 효력이 없다.**
매입세액공제용 신용카드 매출전표는 주문목록 우상단 **[영수증 조회]** 로 들어가는
`receipt.gmarket.co.kr` 화면에서 나온다.

```
나의 지마켓   https://my.gmarket.co.kr/ko/pc/list/all   (SPA)
전표 목록     POST https://receipt.gmarket.co.kr/Card/CardSalesSlipForm/
              sDay=20220101&eDay=20260831&pageNo=1&pageUnit=10
전표          GET  https://receipt.gmarket.co.kr/Card/CardReceiptFormCover
              ?seqNo=1924402893&custNo=<인코딩>&contrNo=3664897233
```

목록에서 전표를 여는 링크는 쿼리스트링이 아니라 **함수 호출** 형태다:

```html
<a href="javascript:openCardReceipt('2454083498', 'DEyNR38T…/Rw==', '4252259234');">
                     seqNo           custNo(base64)        contrNo(=주문번호)
```

11번가와 **전표를 여는 열쇠가 다르다** — 주문번호 하나가 아니라 `seqNo`·`custNo`·`contrNo` 세 값이다.
그래서 식별자를 `SiteConfig.receiptKey`(정규식 + 캡처 그룹 이름)로 일반화했고, 캡처한 값이
`receiptUrlTemplate`·`receiptRequest.fields` 의 `{이름}` 토큰으로 치환된다.

| | 11번가 | G마켓 |
|---|---|---|
| 식별자 | `{ordNo}` | `{seqNo}` `{custNo}` `{contrNo}` |
| 전표 여는 법 | 폼 POST | 주소로 GET |
| 상품별 전표 | 있음(`iterateItemSeq`) | 없음(목록 한 줄 = 전표 한 장) |
| 주문일 | 주문번호 앞 8자리 | 전표 문서의 거래일자(`orderDateFromDocument`) |

## 새 사이트 붙이기

`config.ts` 에 `SiteConfig` 를 하나 더 쓰면 된다. 알아내야 하는 것은 넷이고, 전부 `probe` 로 나온다.

```bash
npm run receipts -- login --site gmarket        # 로그인 후 [영수증/계산서조회] 화면까지 이동하고 창 닫기
                                                 # 창을 닫으면 그 화면 구조가 바로 출력된다
npm run receipts -- probe --site gmarket --url "<주문내역 주소>"
npm run receipts -- probe --site gmarket --watch --url "<주문내역 주소>"   # 전표 버튼을 눌러 여는 방식 확인
```

1. **주문/증빙 목록 주소** — `login` 이 끝날 때 머문 주소, 또는 probe 의 `최종 URL`.
2. **기간 조회 요청**(`listRequest`) — probe 출력의 `날짜 필드를 가진 폼` 블록, 또는 `--watch` 중의 `폼 제출:` 줄.
   URL 파라미터로 도는 사이트라면 조회 후 주소창만 봐도 된다(11번가가 그랬다).
3. **전표 여는 방식** — `--watch` 로 전표 버튼을 눌렀을 때
   `팝업 로드 완료:` 가 뜨면 그 주소를 `receiptUrlTemplate` 에,
   `폼 제출:` 이 뜨면 그 action·필드를 `receiptRequest` 에 넣는다.
4. **주문번호 형식**(`orderNoPattern`) — probe 의 `주문번호 후보` 를 보고 좁힌다.
   11번가처럼 앞 8자리가 주문일이면 `orderDateFromOrderNo: true` 를 켠다. 아니면 날짜는 비워 두는데,
   기간 조회로 이미 범위가 좁혀져 있어 수집 자체에는 지장이 없다(파일이 `unknown` 월 폴더로 갈 뿐).

## 봇 확인이 있는 사이트 (`stealth: true`)

G마켓은 접속하면 Cloudflare 봇 확인 화면이 뜬다. `SiteConfig.stealth` 를 켜면:

- **UA·viewport 를 덮어쓰지 않는다.** 덮어쓴 UA 는 브라우저가 함께 보내는 Client Hints 와 어긋나고,
  그 모순 자체가 봇 신호가 된다(우리 기본값이 `Chrome/120` 고정이라 오히려 해로웠다).
- 자동화 표식을 숨긴다(`--disable-blink-features=AutomationControlled`, `navigator.webdriver`).
- 번들 Chromium 대신 **설치된 Chrome**(`channel: "chrome"`)을 쓴다. `RECEIPTS_CHROME_PATH` 로 직접 지정해도 된다.
- headless 는 거의 확실히 막히므로 `collect` 도 화면을 띄워 실행한다(PDF 는 그대로 나온다 — 위 참고).

그래도 통과가 보장되지는 않는다. Cloudflare 가 막으면 그 사이트는 수동 수집으로 남기는 편이 낫다 —
캡차 우회 서비스는 약관 위반 강도와 계정 정지 위험을 함께 키운다.

## 옥션 (진행 중)

영수증은 마이옥션 주문내역의 [영수증/계산서 조회] 버튼이 여는 **별도 창**에서 뽑는다. 실측된 것:

```
창(현금영수증 탭)  https://accounting.auction.co.kr/Receipts/CashInfoList.aspx
신용카드전표 탭    https://accounting.auction.co.kr/Receipts/CardInfoList.aspx
기간 조회          .../CardInfoList.aspx?from=20220101&to=20260821&pageNum=1   ← GET 쿼리스트링
```

주문내역 화면(`escrow.auction.co.kr/Close/OrderProcessList.aspx`)은 ASP.NET WebForms 라 기간 조회가
postback(`__VIEWSTATE`)이지만, 전표는 위 창에서 뽑으므로 그쪽은 건드릴 필요가 없다.

전표는 **주문번호 하나로** 열린다(G마켓의 세 값과 다르다):

```
GET https://accounting.auction.co.kr/Card/CardReceiptRevised.aspx?orderNo=2486409195
```

주문번호를 뽑는 규칙은 좁은 것부터 시도한다 — 전표 주소에 박힌 형태 → `orderNo` 파라미터 → 화면의 10자리 숫자.

알려진 제약: 옥션은 **1년이 지난 구매내역의 영수증 출력이 막혀 있다**(고객센터 안내).

## 전표를 여는 세 가지 경로

사이트마다 다르고, config 에 정의된 것을 위에서부터 쓴다.

| 경로 | 설정 | 쓰는 곳 |
|---|---|---|
| 폼 POST | `receiptRequest` | 11번가 |
| 주소로 GET | `receiptUrlTemplate` | G마켓, 옥션 |
| 목록에서 링크 클릭 | (둘 다 없을 때) `receiptKey` 로 찾은 식별자를 담은 링크를 눌러 팝업을 잡는다 | 주소를 모르는 사이트의 폴백 |

## 네이버페이

전표까지 **두 단계**다. 목록에는 전표 열쇠가 없고 중간 화면에서만 나온다.

```
① 목록      https://pay.naver.com/pc/history?page=1
             → 주문 상세 링크에 주문번호: orders.pay.naver.com/order/status/2026052979829321
② 발급이력  https://pay.naver.com/receipts/issue-history?orderNo=2026052979829321
             → '구매영수증'과 '카드영수증' 링크
③ 카드영수증 https://pay.naver.com/receipts/preview/card
             ?tid=20260529162353665940&productOrderNo=PD2026052915794841
```

`SiteConfig.receiptKeyResolve` 가 ②를 표현한다 — 목록 키로 중간 화면을 열고 거기서 최종 열쇠를 뽑는다.
한 주문에 상품이 여러 개면 `productOrderNo` 가 여러 개 나오고 각각 저장한다.

주문번호 16자리의 **앞 8자리가 주문일**이라(11번가와 같은 성질) 기간 필터를 주문번호만으로 건다.

⚠ '구매영수증'은 11번가·G마켓의 결제영수증처럼 세무 효력이 없을 수 있어 **카드영수증만** 받는다.
네이버페이는 판매자가 개별 스마트스토어 사업자라, 판매자 명의 세금계산서가 필요한 건이면 전표로는 부족할 수 있다.

## 쿠팡 — 묶음 전표

쿠팡에는 **매출전표 일괄 신청** 기능이 있어 건별로 긁을 필요가 없다. 다른 몰과 접근이 다르다.

```
① 신청  영수증 조회/출력 화면에서 기간을 지정해 신청
        POST /ssr/api/payment-receipt/card/request-download-receipt
        {"from":"2026.01.01","to":"2026.08.22","totalCount":71, ...}
② 뷰어  https://payment.coupang.com/card-receipt-requests/5320399?page=0   (1~50건)
                                                            ?page=1   (51~71건)
        ← 이 페이지 자체가 전표 묶음 문서다
```

신청은 화면에서 한 번 누르고(처리에 시간이 걸린다), 결과는 명령으로 받는다:

```bash
npm run receipts -- bulk --site coupang --request-id 5320399 --with-text
```

빈 페이지가 나올 때까지 순회하며 각 페이지를 PDF 로 저장한다. 파일명에 그 묶음의 거래일자 범위가 들어가고,
대장에는 묶음별 건수가 남는다. 이미 받은 페이지는 건너뛴다.

**요청이 페이지 수만큼(보통 1~2회)으로 끝나** 봇 탐지 위험이 사실상 없고, 쿠팡이 공식 제공하는 기능이라
약관상으로도 안전하다. 건별 경로(`card-receipt/view?orderId=&vendorIds=`)는 일괄 신청이 막히거나
일부가 누락될 때의 폴백으로 config 에 남겨 뒀다.

⚠ Akamai Bot Manager 가 있어 stealth + 실제 Chrome(`RECEIPTS_CHROME_PATH`)을 쓰는 편이 안전하다.
