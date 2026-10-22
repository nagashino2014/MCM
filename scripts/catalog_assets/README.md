# 회사소개서 스톡 일러스트 매처

회사가 가진 Adobe Stock·자체 제작 일러스트(.ai·.eps·.svg·.pdf)를 대지·그림 단위로 나눠 변환합니다.
그다음 인포그래픽 16유형으로 판정하고, 회사소개서 쪽(`catalog_items.json`)마다 맞는 후보를 추천하는 독립 파이프라인입니다.
필요한 것은 Python 3.11+ 표준 라이브러리, poppler 24(`AM_POPPLER_BIN`, 기본 `C:\poppler\poppler-24.08.0\Library\bin`),
PDF 호환이 꺼진 AI 를 위한 Illustrator 2026(COM)입니다.

```powershell
$W = "<작업 폴더>"
python -I scripts\catalog_assets\asset_matcher.py all --src "V:\업무자료\홈페이지&브로슈어 관리\디자인, 아이콘 파일" --recursive --work $W --stock $W\stock_candidates.json
# 단계별: ingest → convert → analyze → match → report. 새로 산 에셋(하위 폴더 포함)은 바뀐 파일만 복사하고, analyze --only <slug…> 로 그것만 분석한다
python -I scripts\catalog_assets\asset_matcher.py recolor $W\assets\<slug>\ab01\r1\region.svg --palette area --strip-text --out out.svg
```

## 단계
| 단계 | 하는 일 | 산출 |
|---|---|---|
| ingest | 파일마다 `_inputs/<slug>/src.<ext>` 로 따로 복사(신뢰하지 않는 데이터 격리), 머리 바이트로 형식 판정 | `manifest.json` |
| convert | PDF 호환 AI 는 그대로, EPS 형식 AI·SVG 는 Illustrator COM(`ai_to_pdf.ps1`→`ai_to_pdf.jsx`)으로 대지별 쪽 PDF 저장 → poppler 로 쪽 SVG·썸네일·글자 bbox | `pdf/`, `assets/<slug>/abNN/page.svg` |
| analyze | 저해상 래스터로 배경을 걷고 그림 영역을 나눔(글자만 있는 조각은 가까운 그림에 합침) → 영역마다 벡터 도형·래스터 색 덩어리로 반복·배치·중심·화살표·글자 자리·색·평면성 특징 → 16유형 점수 | `analysis.json`, `abNN/rK/region.svg·print.png·thumb.png·slots.json` |
| match | `review.json`(시각 판정)으로 덮어쓴 뒤 항목별 적합도 | `matches.json` |
| report | 항목별 상위 후보 + 재채색 미리보기 + 구매 후보 + 전체 접촉 시트 | `report.html`, `report_artifact.html`, `recolor/` |

## 시각 판정(review.json)
자동 판정은 휴리스틱이라 틀릴 수 있습니다. 썸네일을 보고 `<작업>/review.json` 에 덮어씁니다.
```json
{"as-123/ab01/r1": {"type": "Hub", "count": 5, "center": true, "quality": 4, "note": "중심 원 + 5갈래"},
 "kesi-logo-ai-8b8b49": {"exclude": true, "note": "로고"}}
```
키는 영역 id 또는 slug(파일 전체)입니다. `quality`는 1~5, `exclude`는 인포그래픽이 아님을 뜻합니다. `alt`·`loop`도 덮어쓸 수 있습니다.

## 재채색
유채색을 색상별로 묶어 팔레트(`ci` 네이비·블루·그린…, `area` 분야 6색, `mono` 네이비)에 배정하고 명암 차이는 유지합니다.
무채색은 흰색이면 그대로 두고, 아주 어두우면 네이비, 그 밖은 CI 회색 단계로 바꿉니다. `--map "#e94e3c=area-2"` 로 직접 지정할 수 있습니다.
필터·클립 안은 건드리지 않습니다. cairo 마스크는 알파만 쓰므로 색을 바꿔도 투명도는 그대로입니다. 그림자·흐림이 이미지로 굳은 부분은 바뀌지 않습니다.
`--strip-text` 는 살아 있는 글자(글리프)만 지웁니다. 윤곽선으로 바뀐 글자는 도형이라 Illustrator 에서 지웁니다. 숫자·글자는 HTML 로 덧씌우고, 자리 좌표는 `slots.json` 에 있습니다.
`report` 는 항목별 상위 후보를 재채색하고 Edge 헤드리스(`AM_EDGE`)로 PNG 미리보기를 굽습니다(`recolor/index.json` 캐시, `--force-recolor` 로 다시).

## 한계
- 윤곽선으로 바뀐 글자는 내용을 읽지 못해(줄 단위 자리만) 연도·번호 단서는 살아 있는 글자에만 쓰입니다.
- 한 대지에 여러 그림이 붙어 있으면 한 영역으로 묶일 수 있습니다. 반대로 멀리 떨어진 요소는 나뉠 수 있습니다.
- Illustrator 효과(그림자·흐림·투명 그룹)는 PDF 에서 이미지·필터로 굳어 벡터 분석과 재채색이 제한됩니다.
