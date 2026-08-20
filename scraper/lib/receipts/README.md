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

## 이 스파이크로 확인하려는 것

1. **세션 재사용이 되는가** — 저장한 세션으로 headless 접근 시 로그인 페이지로 튕기지 않는지. 튕기면 `--headed`.
2. **어떤 방식으로 PDF 가 만들어지는가** — `lib/receipts/pdf.ts` 가 아래 순서로 시도하고 성공한 방식을 대장의 `method` 열에 남긴다.
   - `page.pdf` — headless Chromium 전용. 가장 깔끔.
   - `cdp.printToPDF` — headed 에서도 되는지가 미확인 쟁점.
   - `html-snapshot` — 위 둘이 막혔을 때. PDF 가 아니므로 후처리(별도 headless 렌더)가 필요하다.
3. **영수증이 어떻게 뜨는가** — 팝업 / 같은 탭 이동 / 레이어 모달. 세 경우 다 처리하지만 실제로 어느 쪽인지는 로그의 `(popup|navigation|layer)` 로 남는다.
4. **품목이 실제로 찍히는가** — 11번가의 "카드영수증"은 결제 전표라 품목이 없고 "거래명세서" 쪽에 품목이 있을 수 있다.
   둘 다 받아 보고 세무 제출 요건에 맞는 쪽을 고른다.

## 아직 확정되지 않은 것

- `config.ts` 의 11번가 `orderListUrl`·`orderRowSelectors` 는 **추정값**이다. 마크업이 바뀌어도 버티도록
  "영수증/거래명세서 텍스트 + 9자리 이상 숫자(주문번호) + YYYY.MM.DD(주문일)" 휴리스틱을 우선 쓰지만,
  빗나가면 `probe` 결과를 보고 `site-config.json` 을 고친다.
- 기간 조회 UI 조작은 다루지 않는다. 화면에 보이는 목록을 페이지네이션으로 훑으며 **주문일 텍스트로 필터**한다.
  기간 파라미터 URL 이 실측되면 config 에 템플릿을 추가하는 편이 낫다.

## 주의

- 각 몰 약관은 자동화 접근을 제한한다. 본인 계정의 본인 결제내역이라도 계정 차단 가능성이 있으니
  건당 딜레이(`--delay`, 기본 2초)를 유지하고 저빈도(신고철 월 1회)로 돌린다. 캡차 우회 도구는 쓰지 않는다.
- `RECEIPTS_CHROME_PATH` 로 실제 설치된 Chrome 을 지정할 수 있다(번들 Chromium 보다 탐지를 덜 받는 경우가 있음).
