# 전자상거래 카드영수증 수집 (스파이크)

부가세 신고 증빙용으로 쇼핑몰 주문 건의 **신용카드 매출전표를 PDF 로 일괄 수집**한다.

| 사이트 | `--site` | 상태 |
|---|---|---|
| 11번가 | `11st` (기본) | ✅ 무인 수집 동작 — 로그인만 사람이 한다 |
| G마켓 | `gmarket` | ✅ 무인 수집 동작(실계정 확인) |
| 옥션 | `auction` | 🔶 실측 반영 완료. 실계정 전표 저장 검증만 남음 |
| 네이버페이 | `naver` | 🔶 골격만. 주문내역 주소만 알고 있다 |

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
cookies.json            세션 쿠키 — 로그인 상태 그 자체. 외부 공유·커밋 금지
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

## 세션 수명

11번가 세션은 하루 남짓이면 만료된다(전날 로그인한 프로필로 다음 날 열면 로그인 페이지로 튕긴다).
그래서 **스케줄러로 방치하는 완전 무인 실행은 불가능**하고, 현실적인 형태는 "로그인 한 번 + 명령 몇 줄"이다.
`collect` 는 만료를 감지하면 무엇을 해야 하는지 안내하고 멈춘다.

## 주의

- 각 몰 약관은 자동화 접근을 제한한다. 본인 계정의 본인 결제내역이라도 계정 차단 가능성이 있으니
  건당 딜레이(`--delay`, 기본 2초)를 유지하고 저빈도(신고철 월 1회)로 돌린다. 캡차 우회 도구는 쓰지 않는다.
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
