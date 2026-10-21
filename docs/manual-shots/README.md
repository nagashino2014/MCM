# 매뉴얼 화면 캡처

`frontend/public/manual/shots/*.webp` 를 다시 찍는 스크립트(작성 가이드 §4.1).

1. `node docs/manual-shots/login.mjs <임시 프로필 폴더>` — 창이 뜨면 **본인이 직접** 스테이징에 로그인한다(스크립트는 자격증명을 다루지 않는다).
2. `node docs/manual-shots/capture.mjs <임시 프로필 폴더> <출력 폴더> [shotId...]` — 화면을 열고 메뉴·버튼·제목·표 머리글 외 글자와 이름·금액·전화·메일 패턴을 흐린 뒤 1440×900 으로 찍는다(.png 원본 + .webp).
3. 출력 그림을 한 장씩 열어 흐림이 빠진 곳이 없는지 확인한 뒤 `.webp` 만 `frontend/public/manual/shots/` 로 복사한다.
4. 임시 프로필 폴더는 지운다(로그인 쿠키가 남아 있다).

`scraper/node_modules`(playwright)와 `frontend/node_modules`(sharp)가 설치돼 있어야 한다. 워크트리처럼 node_modules 가 없는 체크아웃에서는 `MCM_DEPS_ROOT=C:/CodingProject/MCM/` 로 설치된 체크아웃을 가리킨다.

흐림 기준: 소스 코드에 문구로 적힌 글자(메뉴·버튼·제목·표 머리글)만 남기고 나머지 데이터는 흐린다. 이름·금액·전화·메일·사업자번호 패턴과 직원 이름, 직원 사진은 항상 흐린다. 매뉴얼 창·양식 고르기 창처럼 데이터가 아닌 창은 `keepWithin` 으로 남긴다.
