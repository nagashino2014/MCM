"""자체 완결 HTML(print-kit) → A4 가로 PDF·쪽 지도(·쪽 PNG). 회사소개서 블루프린트 §9.

이식 출처: ESG-KESI apps/api/app/report_render/pdf.py @ f48d0bd(origin/main, 2026-10-21) — 동기 → 비동기 Playwright,
브라우저 찾기는 이 서비스의 /render/url-pdf 설정(MCM_CHROMIUM_PATH, --no-sandbox·--disable-dev-shm-usage)을 그대로 쓴다.

- 쪽은 1px = 1pt 로 842×595 에 그린다. PDF 는 A4 가로(297×210mm)에 배율 ≈4/3 으로 인쇄해 쪽 한 장이 종이 한 장을 꽉 채운다.
- 문서는 https://print.local/ 주소로 연다(page.route 가 HTML 을 직접 응답) — 서체·이미지가 같은 출처라 CORS 가 필요 없다.
  그 주소 아래 자산은 요청에 담겨 온 것(assets)과 이미지에 넣어 둔 기본 서체(MCM_PRINT_FONT_DIR)로만 응답하고,
  다른 모든 네트워크 요청은 막는다(외부 네트워크 차단 원칙, §5-5).
- 쪽 나누기는 print 매체로 레이아웃한 뒤 페이지 스크립트(paginate.js)가 끝내고(window.__pkResult),
  그 결과(쪽 수·앵커 → 쪽 지도·넘침 경고)를 PDF 와 함께 돌려준다.
- PDF 는 Chromium 이 바로 만든 그대로 돌려준다(북마크 outline·태그 PDF·내부 링크) — 다른 PDF 엔진으로 다시 저장하지 않는다.
"""
from __future__ import annotations

import base64
import os
import re
import time

PRINT_ORIGIN = "https://print.local/"
SHEET_W, SHEET_H = 842, 595
PDF_SCALE = (297 / 25.4 * 96) / SHEET_W  # A4 가로 폭(CSS px) ÷ 쪽 폭 ≈ 1.3332
LAUNCH_ARGS = ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"]
FONT_DIR = os.environ.get("MCM_PRINT_FONT_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "print-fonts")
MAX_ASSETS = 600
MAX_ASSET_BYTES = 80 * 1024 * 1024
_PATH_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._\-/]{0,255}$")
_FONT_TYPES = {".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf"}


class RenderError(RuntimeError):
    """쪽 나누기 실패·시간 초과 등 — 호출자에게 사유를 그대로 넘긴다."""


def bundled_font_names() -> list[str]:
    try:
        return sorted(f for f in os.listdir(FONT_DIR) if os.path.splitext(f)[1].lower() in _FONT_TYPES)
    except OSError:
        return []


def decode_assets(items: list[dict]) -> dict[str, tuple[str, bytes]]:
    """[{path, content_type, data_b64}] → {path: (content_type, bytes)}. 경로·개수·크기를 검사한다."""
    if len(items) > MAX_ASSETS:
        raise ValueError(f"자산이 너무 많습니다({len(items)} > {MAX_ASSETS}).")
    out: dict[str, tuple[str, bytes]] = {}
    total = 0
    for it in items:
        p = str(it.get("path") or "").lstrip("/")
        if not _PATH_RE.match(p) or ".." in p:
            raise ValueError(f"자산 경로가 올바르지 않습니다: {p[:80]}")
        try:
            data = base64.b64decode(it.get("data_b64") or "", validate=True)
        except Exception as exc:  # noqa: BLE001
            raise ValueError(f"자산 내용(base64)이 올바르지 않습니다: {p}") from exc
        total += len(data)
        if total > MAX_ASSET_BYTES:
            raise ValueError("자산 크기 합계가 상한(80MB)을 넘습니다.")
        out[p] = (str(it.get("content_type") or "application/octet-stream"), data)
    return out


def _font_file(rel: str) -> tuple[str, bytes] | None:
    name = os.path.basename(rel)
    ext = os.path.splitext(name)[1].lower()
    if rel != f"fonts/{name}" or ext not in _FONT_TYPES:
        return None
    full = os.path.join(FONT_DIR, name)
    if not os.path.isfile(full):
        return None
    with open(full, "rb") as fh:
        return _FONT_TYPES[ext], fh.read()


async def render(html: str, assets: dict[str, tuple[str, bytes]], *, png: bool = False, png_scale: float = 1.5,
                 timeout_ms: int = 90000) -> dict:
    from playwright.async_api import async_playwright

    started = time.monotonic()
    blocked: list[str] = []
    missing: list[str] = []

    async def handle(route):
        url = route.request.url
        if url == PRINT_ORIGIN or url.startswith(PRINT_ORIGIN + "?") or url.startswith(PRINT_ORIGIN + "#"):
            await route.fulfill(status=200, body=html.encode("utf-8"), headers={"content-type": "text/html; charset=utf-8"})
            return
        if url.startswith(PRINT_ORIGIN):
            rel = url[len(PRINT_ORIGIN):].split("?", 1)[0].split("#", 1)[0]
            hit = assets.get(rel) or _font_file(rel)
            if hit:
                await route.fulfill(status=200, body=hit[1], headers={"content-type": hit[0], "cache-control": "no-store"})
            else:
                missing.append(rel)
                await route.fulfill(status=404, body=b"", headers={"content-type": "text/plain"})
            return
        blocked.append(url[:200])
        await route.abort("blockedbyclient")

    async with async_playwright() as p:
        executable = os.environ.get("MCM_CHROMIUM_PATH") or None
        browser = await p.chromium.launch(executable_path=executable, args=LAUNCH_ARGS)
        try:
            context = await browser.new_context(
                viewport={"width": SHEET_W, "height": SHEET_H},
                device_scale_factor=png_scale if png else 1,
                java_script_enabled=True,
                service_workers="block",
            )
            await context.route("**/*", handle)
            page = await context.new_page()
            await page.emulate_media(media="print")
            await page.goto(PRINT_ORIGIN, wait_until="domcontentloaded", timeout=timeout_ms)
            try:
                await page.wait_for_function("document.documentElement.hasAttribute('data-pk-ready')", timeout=timeout_ms)
            except Exception as exc:  # noqa: BLE001
                raise RenderError(f"쪽 나누기가 제한 시간({timeout_ms // 1000}초) 안에 끝나지 않았습니다.") from exc
            res = await page.evaluate("window.__pkResult") or {}
            if res.get("error") or "pages" not in res:
                raise RenderError(f"쪽 나누기 실패: {res.get('error') or res}")
            pngs: list[str] = []
            if png:
                for el in await page.query_selector_all(".pk-sheet"):
                    pngs.append(base64.b64encode(await el.screenshot(type="png")).decode("ascii"))
            pdf = await page.pdf(
                width="297mm",
                height="210mm",
                scale=PDF_SCALE,
                print_background=True,
                margin={"top": "0", "right": "0", "bottom": "0", "left": "0"},
                outline=True,
                tagged=True,
            )
        finally:
            await browser.close()

    warnings = list(res.get("warnings") or [])
    for u in dict.fromkeys(blocked):
        warnings.append({"kind": "network", "page": 0, "anchor": "", "message": f"외부 주소 요청을 막았습니다: {u}"})
    for rel in dict.fromkeys(missing):
        warnings.append({"kind": "asset", "page": 0, "anchor": "", "message": f"자산이 없습니다: {rel}"})
    return {
        "pdf_b64": base64.b64encode(pdf).decode("ascii"),
        "pages": int(res.get("pages") or 0),
        "anchors": res.get("anchors") or {},
        "warnings": warnings,
        "pngs_b64": pngs,
        "render_ms": int((time.monotonic() - started) * 1000),
    }
