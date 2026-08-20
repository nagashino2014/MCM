# 전자상거래 카드영수증 수집 (스파이크)

부가세 신고 증빙용으로 쇼핑몰 주문 건의 **카드영수증·거래명세서를 PDF 로 일괄 수집**한다.
첫 대상은 난이도가 가장 낮은 **11번가**. 여기서 통한 방식을 확인한 뒤 다른 몰로 넓힌다.

## 왜 이 형태인가

- 쿠팡(Akamai Bot Manager)·네이버는 headless 브라우저를 탐지해 막는다. 11번가도 자동 로그인은 봇으로 잡힐 수 있다.
  → **로그인은 사람이 직접**(캡차·2차인증 포함), 스크립트는 그 뒤의 세션(storageState)만 재사용한다. `lib/daou` 와 같은 구조.
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
session.json            로그인 세션 — 외부 공유·커밋 금지
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
- **주문번호 앞 8자리가 주문일이다**(`20251027006519699` → 2025-10-27). 목록의 날짜 칸을 파싱하지 않고 기간 필터를 건다.

## 이 스파이크로 확인하려는 것

1. **세션 재사용이 되는가** — 저장한 세션으로 headless 접근 시 로그인 페이지로 튕기지 않는지. 튕기면 `--headed`.
2. **어떤 방식으로 PDF 가 만들어지는가** — `lib/receipts/pdf.ts` 가 아래 순서로 시도하고 성공한 방식을 대장의 `method` 열에 남긴다.
   - `page.pdf` — headless Chromium 전용. 가장 깔끔.
   - `cdp.printToPDF` — headed 에서도 되는지가 미확인 쟁점.
   - `html-snapshot` — 위 둘이 막혔을 때. PDF 가 아니므로 후처리(별도 headless 렌더)가 필요하다.
3. ~~영수증이 어떻게 뜨는가~~ — 확정. 11번가는 주문번호로 직접 여는 경로를 쓴다(위 참고).
   버튼 클릭 경로(팝업/이동/레이어)는 `receiptUrlTemplate` 이 없는 다른 몰을 위해 남겨 뒀다.
4. **품목이 실제로 찍히는가** — 11번가의 "카드영수증"은 결제 전표라 품목이 없고 "거래명세서" 쪽에 품목이 있을 수 있다.
   둘 다 받아 보고 세무 제출 요건에 맞는 쪽을 고른다.

## 아직 확정되지 않은 것

- **기간 조회 UI 조작.** 목록의 기본 조회 기간 밖 주문은 화면에 없으니 주문번호도 안 잡힌다.
  당장은 `--headed` 로 띄워 직접 기간을 조회한 뒤 진행하면 되고, 조회 URL 파라미터가 실측되면
  config 에 템플릿을 추가해 무인화할 수 있다.
- **대장의 품목·금액이 비어 있다.** 값은 영수증 PDF 안에 있는데, 목록에서 추정해 틀린 값을 넣느니 비워 뒀다.
  영수증 페이지 구조를 실측하면 채운다.
- **"영수증" 과 "거래명세서" 중 어느 쪽에 품목이 찍히는지** 아직 확인되지 않았다. 세무 제출 요건에 맞는 쪽을 골라야 한다.

## 주의

- 각 몰 약관은 자동화 접근을 제한한다. 본인 계정의 본인 결제내역이라도 계정 차단 가능성이 있으니
  건당 딜레이(`--delay`, 기본 2초)를 유지하고 저빈도(신고철 월 1회)로 돌린다. 캡차 우회 도구는 쓰지 않는다.
- `RECEIPTS_CHROME_PATH` 로 실제 설치된 Chrome 을 지정할 수 있다(번들 Chromium 보다 탐지를 덜 받는 경우가 있음).
