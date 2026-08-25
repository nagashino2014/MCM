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
            browser = await p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
            try:
                page = await browser.new_page(viewport={"width": 900, "height": 1400})
                await page.goto(url, wait_until="networkidle", timeout=30000)
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
