"""
문서 변환 서비스 (mcm-ieps-staging-converter)

전자결재 첨부서류를 결재자가 브라우저에서 그대로 확인할 수 있도록 PDF 로 변환한다.
OCR 백엔드(15GB, 상시 미가동)와 분리된 경량 서비스 — LibreOffice 만 담는다.

엔드포인트:
  POST /convert/pdf     multipart file → application/pdf
  POST /render/url-pdf  {url} → 해당 웹 페이지를 Chromium 으로 열어 PDF 캡처(바로빌 계산서 인쇄 화면 전용)
  GET  /health          변환기 설치 여부(배포 확인용)

호출자는 Next.js 뿐이고, VPC 내부 service discovery(converter.local)로만 접근한다.
"""
import asyncio
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
# 계산서 본문("전자세금계산서"+"공급가액"+"합계금액"을 모두 담는 가장 깊은 요소)만 남기고
# 나머지를 비워 PDF 에 표만 실리게 한다(2026-08-26 사용자 요청). 본문을 못 찾으면 아무것도
# 바꾸지 않고 false 를 돌려 전체 페이지 캡처(종전 동작)로 남는다.
EXTRACT_INVOICE_JS = """
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
  // 표 내부 태그(tbody 등)가 잡히면 표 골격째 들어내야 스타일이 산다.
  if (["TBODY", "THEAD", "TFOOT", "TR", "TD", "TH", "COLGROUP"].includes(root.tagName)) {
    root = root.closest("table") || root;
  }
  // 국세청승인번호 표기가 본문 컨테이너 밖(위 형제)에 있으면 그것까지 담는 부모로 확장하되,
  // 인쇄 옵션 UI("인쇄하기" 버튼 영역)를 삼키는 확장은 하지 않는다.
  const hasNts = (document.body.textContent || "").includes("국세청승인번호");
  for (
    let i = 0;
    hasNts && i < 4 && !(root.textContent || "").includes("국세청승인번호");
    i++
  ) {
    const parent = root.parentElement;
    if (!parent || parent === document.body) break;
    if ((parent.textContent || "").includes("인쇄하기")) break;
    root = parent;
  }
  document.body.innerHTML = "";
  document.body.appendChild(root);
  document.body.style.background = "#ffffff";
  document.body.style.margin = "0";
  document.body.style.padding = "0";
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
                page = await browser.new_page(viewport={"width": 900, "height": 1400})
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
                extracted = await page.evaluate(EXTRACT_INVOICE_JS)
                if not extracted:
                    print("[render] 계산서 본문 미검출 — 전체 페이지 캡처로 폴백")
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
