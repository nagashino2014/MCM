"""
문서 변환 서비스 (mcm-ieps-staging-converter)

전자결재 첨부서류를 결재자가 브라우저에서 그대로 확인할 수 있도록 PDF 로 변환한다.
OCR 백엔드(15GB, 상시 미가동)와 분리된 경량 서비스 — LibreOffice 만 담는다.

엔드포인트:
  POST /convert/pdf      multipart file → application/pdf
  POST /render/url-pdf   {url} → 해당 웹 페이지를 Chromium 으로 열어 PDF 캡처(바로빌 계산서 인쇄 화면 전용)
  POST /render/url-meta  {url} → 상품 페이지를 Chromium 으로 열어 {title, price} 추출
                         (⚠현재 호출처 없음 — 구매품의서 자동 기입용이었으나 쿠팡·네이버·G마켓의
                          상용 봇 방어로 실효성이 없어 08-26 폐기, 추후 재활용 대비 엔드포인트만 유지)
  GET  /health           변환기 설치 여부(배포 확인용)

호출자는 Next.js 뿐이고, VPC 내부 service discovery(converter.local)로만 접근한다.
"""
import asyncio
import re
from urllib.parse import urlparse

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import office_convert

app = FastAPI(title="MCM 문서 변환", version="1.1.0")

# URL 캡처는 바로빌 호스팅 화면 전용 — 내부 서비스라도 SSRF 방지로 도메인을 제한한다.
RENDER_ALLOWED_SUFFIXES = (".baroservice.com", ".barobill.co.kr", ".barobill.com")


class RenderUrlBody(BaseModel):
    url: str


# 바로빌 인쇄 화면에는 인쇄 옵션 UI(인쇄옵션·인쇄방식·스탬프·인쇄하기)가 계산서와 함께 있다.
# 계산서 본문("전자세금계산서"+"공급가액"+"합계금액"을 모두 담는 가장 깊은 요소)에 표식을 남겨
# 그 영역만 스크린샷으로 잘라 PDF 에 앉힌다(2026-08-26 사용자 요청). ⚠DOM 을 들어내는 방식은
# 스타일이 조상 선택자에 걸려 있어 표 서식이 전부 사라졌다(실측) — 렌더된 화면을 자르는 것만 안전.
# 본문을 못 찾으면 false 를 돌려 전체 페이지 캡처(종전 동작)로 남는다.
MARK_INVOICE_JS = """
(() => {
  const MUST = ["전자세금계산서", "공급가액", "합계금액"];
  let best = null;
  for (const el of document.querySelectorAll("body *")) {
    if (el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.tagName === "IFRAME") continue;
    const t = el.textContent || "";
    if (MUST.every((k) => t.includes(k))) best = el; // 문서순 마지막 매치 = 가장 깊은 컨테이너
  }
  if (!best) return false;
  let root = best;
  // 표 내부 태그(tbody 등)가 잡히면 표 전체를 캡처 대상으로 승격한다.
  if (["TBODY", "THEAD", "TFOOT", "TR", "TD", "TH", "COLGROUP"].includes(root.tagName)) {
    root = root.closest("table") || root;
  }
  // 계산서 주변 표기(위: 국세청승인번호 / 아래: 법적 효력 안내 문구)를 모두 담는 부모까지 확장한다.
  // 원본 팝업은 form-container 가 스탬프 하단·안내 문구를 잘라내므로 invoice-view 까지 올라가야
  // 스탬프가 온전히 담긴다(2026-08-26 실측). 인쇄 옵션 UI("인쇄하기")를 삼키는 확장은 하지 않는다.
  const WANT = ["국세청승인번호", "법적 효력을 갖습니다"];
  const pageText = document.body.textContent || "";
  for (let i = 0; i < 6; i++) {
    const rootText = root.textContent || "";
    const missing = WANT.filter((k) => pageText.includes(k) && !rootText.includes(k));
    if (!missing.length) break;
    const parent = root.parentElement;
    if (!parent || parent === document.body) break;
    if ((parent.textContent || "").includes("인쇄하기")) break;
    root = parent;
  }
  root.setAttribute("data-mcm-capture", "1");
  return true;
})()
"""


@app.get("/health")
async def health():
    return {"status": "healthy", "available": office_convert.is_available(), "soffice": office_convert.soffice_path()}


@app.post("/render/url-pdf")
async def render_url_pdf(body: RenderUrlBody):
    url = (body.url or "").strip()
    host = (urlparse(url).hostname or "").lower()
    if not url.startswith("https://") or not any(host == s.lstrip(".") or host.endswith(s) for s in RENDER_ALLOWED_SUFFIXES):
        raise HTTPException(status_code=400, detail="허용되지 않은 URL 입니다(바로빌 화면만 캡처할 수 있습니다).")
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        raise HTTPException(status_code=503, detail="Chromium 캡처 모듈(playwright)이 설치되어 있지 않습니다.")
    try:
        async with async_playwright() as p:
            # 시스템 chromium 사용(MCM_CHROMIUM_PATH) — playwright 배포 브라우저는 설치하지 않는다(Dockerfile 참고).
            import os

            executable = os.environ.get("MCM_CHROMIUM_PATH") or None
            browser = await p.chromium.launch(
                executable_path=executable, args=["--no-sandbox", "--disable-dev-shm-usage"]
            )
            try:
                # device_scale_factor 2 — 요소 스크린샷을 인쇄 품질(약 240dpi)로 뜬다.
                page = await browser.new_page(viewport={"width": 900, "height": 1400}, device_scale_factor=2)
                await page.goto(url, wait_until="networkidle", timeout=30000)
                # 계산서가 iframe 안에 있으면 그 프레임 문서를 직접 연다(같은 바로빌 도메인만).
                for frame in page.frames:
                    if frame == page.main_frame:
                        continue
                    try:
                        fhost = (urlparse(frame.url).hostname or "").lower()
                        if not any(fhost == s.lstrip(".") or fhost.endswith(s) for s in RENDER_ALLOWED_SUFFIXES):
                            continue
                        if "전자세금계산서" in (await frame.content()):
                            await page.goto(frame.url, wait_until="networkidle", timeout=30000)
                            break
                    except Exception:  # noqa: BLE001 — 프레임 접근 실패는 무시(본문 발췌가 폴백)
                        continue
                pdf = None
                marked = await page.evaluate(MARK_INVOICE_JS)
                if marked:
                    # 렌더된 화면에서 계산서 영역만 스크린샷 → 빈 페이지에 앉혀 PDF 로.
                    import base64

                    png = await page.locator('[data-mcm-capture="1"]').screenshot(type="png")
                    b64 = base64.b64encode(png).decode("ascii")
                    view = await browser.new_page()
                    await view.set_content(
                        '<html><head><style>body{margin:0}img{display:block;width:100%}</style></head>'
                        f'<body><img src="data:image/png;base64,{b64}"></body></html>',
                        wait_until="load",
                    )
                    pdf = await view.pdf(
                        format="A4",
                        print_background=True,
                        margin={"top": "10mm", "bottom": "10mm", "left": "8mm", "right": "8mm"},
                    )
                else:
                    print("[render] 계산서 본문 미검출 — 전체 페이지 캡처로 폴백")
                if pdf is None:
                    pdf = await page.pdf(
                        format="A4",
                        print_background=True,
                        prefer_css_page_size=True,
                        margin={"top": "10mm", "bottom": "10mm", "left": "8mm", "right": "8mm"},
                    )
            finally:
                await browser.close()
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — 캡처 실패는 호출자가 폴백한다
        raise HTTPException(status_code=422, detail=f"페이지 캡처 실패: {exc}")
    return StreamingResponse(iter([pdf]), media_type="application/pdf")


# 상품 페이지에서 제목·가격 추출 — og:title/JSON-LD(schema.org Product)/가격 메타 순.
# 쇼핑몰 스크립트가 늦게 채우는 경우가 있어 호출부에서 짧은 대기 후 재평가한다.
EXTRACT_META_JS = """
(() => {
  const meta = (sel) => document.querySelector(sel)?.getAttribute("content")?.trim() || null;
  let title = meta('meta[property="og:title"]') || null;
  let price = meta('meta[property="product:price:amount"]') || meta('meta[property="og:price:amount"]') || null;
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(s.textContent || "null");
      const nodes = Array.isArray(parsed) ? parsed : parsed && parsed["@graph"] ? parsed["@graph"] : [parsed];
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        const types = [].concat(node["@type"] || []);
        if (!types.includes("Product")) continue;
        if (!title && typeof node.name === "string") title = node.name.trim();
        const offers = [].concat(node.offers || []);
        for (const offer of offers) {
          const p = offer && (offer.price ?? offer.lowPrice);
          if (!price && (typeof p === "number" || (typeof p === "string" && p))) price = String(p);
        }
      }
    } catch {}
  }
  if (!title) {
    const t = (document.title || "").trim();
    if (t) title = t;
  }
  return { title, price };
})()
"""

PRIVATE_HOST_RE = re.compile(r"^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)|\.local$", re.I)


@app.post("/render/url-meta")
async def render_url_meta(body: RenderUrlBody):
    url = (body.url or "").strip()
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    # 공개 웹 대상 — https 만, 사설/루프백 대역·IP 리터럴 호스트는 거부(SSRF 방지).
    if parsed.scheme != "https" or not host or PRIVATE_HOST_RE.search(host) or host.replace(".", "").isdigit():
        raise HTTPException(status_code=400, detail="허용되지 않은 URL 입니다.")
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        raise HTTPException(status_code=503, detail="Chromium 모듈(playwright)이 설치되어 있지 않습니다.")
    try:
        async with async_playwright() as p:
            import os

            executable = os.environ.get("MCM_CHROMIUM_PATH") or None
            browser = await p.chromium.launch(
                executable_path=executable,
                # AutomationControlled 비활성 — 쇼핑몰 headless 감지 완화(품명 수집 성공률).
                args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
            )
            try:
                page = await browser.new_page(
                    viewport={"width": 1280, "height": 900},
                    locale="ko-KR",
                    user_agent=(
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                        " (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
                    ),
                )
                # networkidle 은 쇼핑몰 트래커 때문에 타임아웃이 잦다 — DOM 로드 후 짧게 재평가.
                await page.goto(url, wait_until="domcontentloaded", timeout=20000)
                result = await page.evaluate(EXTRACT_META_JS)
                for _ in range(3):
                    if result and result.get("title") and result.get("price"):
                        break
                    await page.wait_for_timeout(1200)
                    result = await page.evaluate(EXTRACT_META_JS)
            finally:
                await browser.close()
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — 실패는 호출자가 직접 fetch 로 폴백
        raise HTTPException(status_code=422, detail=f"메타 추출 실패: {exc}")
    return {"title": (result or {}).get("title"), "price": (result or {}).get("price")}


@app.post("/convert/pdf")
async def convert_pdf(file: UploadFile = File(...)):
    if not office_convert.is_available():
        raise HTTPException(status_code=503, detail="문서 변환기(LibreOffice)가 이 서버에 설치되어 있지 않습니다.")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="빈 파일입니다.")
    try:
        # 변환은 CPU 동기 작업 — 이벤트 루프를 막지 않도록 스레드에서 실행한다.
        pdf = await asyncio.to_thread(office_convert.convert_to_pdf, data, file.filename or "attachment")
    except office_convert.ConvertError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return StreamingResponse(iter([pdf]), media_type="application/pdf")
