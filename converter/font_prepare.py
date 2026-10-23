"""회사소개서 업로드 서체 준비(POST /fonts/prepare) — 블루프린트 §5-3·5-5.

업로드한 서체(TTF·OTF·WOFF·WOFF2, 정적·가변)를 PDF 에 부분 포함(Type0)되는 '정적 TrueType 윤곽 WOFF'로 바꾼다.
- Chromium(Skia) PDF 는 CFF 윤곽 서체와 가변 서체를 Type 3 으로 넣는다(2026-10-22 P4 실측) — 그래서
  CFF·CFF2 윤곽은 2차 곡선(cu2qu)으로 바꾸고, 가변 서체는 요청 굵기로 고정(instancer)한다.
  방식은 scripts/catalog/pretendard_otf2ttf.py(CFF → TrueType)·noto_static_woff.py(가변 → 정적)와 같다.
- 글자 범위·이름·OS/2(fsType 포함)는 그대로 둔다 — 라이선스 표시를 바꾸지 않는다. 고정한 굵기만 이름(PostScript·전체 이름)에 붙인다.
- 결과 형식은 print-kit 기본 서체와 같은 WOFF(zlib). 서체 분석(이름·fsType·글자 범위·수치)은 앱(fontkit)이 한다.
"""
from __future__ import annotations

import base64
import io
import time

MAX_BYTES = 20 * 1024 * 1024
WEIGHT_NAMES = {100: "Thin", 200: "ExtraLight", 300: "Light", 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold", 900: "Black"}


class PrepareError(ValueError):
    """읽을 수 없는 서체·지원하지 않는 형식 — 호출자에게 사유를 그대로 넘긴다."""


def _load(data: bytes):
    from fontTools.ttLib import TTFont, TTLibError

    if data[:4] == b"ttcf":
        raise PrepareError("글꼴 모음(TTC)은 굵기별 파일로 풀어 올려 주세요.")
    try:
        font = TTFont(io.BytesIO(data), lazy=False)
        font.getGlyphOrder()
    except (TTLibError, Exception) as exc:  # noqa: BLE001 — 깨진 파일은 사유만 돌려준다
        raise PrepareError(f"서체 파일을 읽지 못했습니다: {exc}") from exc
    return font


def _outline(font) -> str:
    if "glyf" in font:
        return "truetype"
    if "CFF2" in font:
        return "cff2"
    if "CFF " in font:
        return "cff"
    raise PrepareError("윤곽(glyf·CFF) 테이블이 없는 서체입니다(비트맵·색 서체는 쓸 수 없습니다).")


def _cff_to_glyf(font) -> None:
    """CFF·CFF2 윤곽 → TrueType 윤곽(2차 곡선). 글자 순서·폭은 그대로, 왼쪽 여백만 새 윤곽에 맞춘다."""
    from fontTools.pens.cu2quPen import Cu2QuPen
    from fontTools.pens.ttGlyphPen import TTGlyphPen
    from fontTools.ttLib import newTable

    order = font.getGlyphOrder()
    glyph_set = font.getGlyphSet()
    glyphs = {}
    for name in order:
        pen = TTGlyphPen(glyph_set)
        glyph_set[name].draw(Cu2QuPen(pen, 1.0, reverse_direction=True))
        glyphs[name] = pen.glyph()
    font["loca"] = newTable("loca")
    font["glyf"] = glyf = newTable("glyf")
    glyf.glyphOrder = order
    glyf.glyphs = glyphs
    for tag in ("CFF ", "CFF2", "VORG"):
        if tag in font:
            del font[tag]
    # 왼쪽 여백 = 새 윤곽의 xMin(표 전체를 미리 컴파일하지 않고 글자마다 경계만 잰다 — 저장 때 한 번만 컴파일)
    hmtx = font["hmtx"]
    for name in order:
        g = glyphs[name]
        adv, _ = hmtx[name]
        if g.numberOfContours != 0:
            g.recalcBounds(glyf)
            hmtx[name] = (adv, g.xMin)
        else:
            hmtx[name] = (adv, 0)
    # maxp 1.0 — 점·윤곽 수는 저장할 때 다시 센다
    font["maxp"] = maxp = newTable("maxp")
    maxp.tableVersion = 0x00010000
    maxp.numGlyphs = len(order)
    maxp.maxZones = 1
    maxp.maxTwilightPoints = maxp.maxStorage = maxp.maxFunctionDefs = maxp.maxInstructionDefs = 0
    maxp.maxStackElements = maxp.maxSizeOfInstructions = 0
    maxp.maxComponentElements = 0
    # 글자 이름은 넣지 않는다(CID 서체는 이름이 cid00001 꼴이라 의미가 없고, 한글 서체는 이름만 수백 KB)
    post = font["post"]
    post.formatType = 3.0
    font["head"].glyphDataFormat = 0
    font.sfntVersion = "\000\001\000\000"


def _set_weight_names(font, weight: int) -> None:
    """가변 서체를 고정한 굵기 — PDF 에 'AAAAAA+NotoSansKR-Bold' 처럼 들어가게 PostScript·전체 이름에 굵기를 붙인다."""
    name = font["name"]
    style = WEIGHT_NAMES.get(weight, f"W{weight}")
    ps = name.getDebugName(6) or name.getDebugName(1) or "Font"
    base = ps.split("-")[0]
    family = name.getDebugName(16) or name.getDebugName(1) or base
    for rec in list(name.names):
        if rec.nameID in (4, 6, 17, 25):
            name.removeNames(nameID=rec.nameID)
    name.setName(f"{base}-{style}", 6, 3, 1, 0x409)
    name.setName(f"{family} {style}", 4, 3, 1, 0x409)
    name.setName(style, 17, 3, 1, 0x409)
    font["OS/2"].usWeightClass = weight


def _instance(data: bytes, weight: int):
    from fontTools.varLib.instancer import instantiateVariableFont

    font = _load(data)
    axes = {a.axisTag: a for a in font["fvar"].axes}
    # 모든 축을 고정해야 정적 서체가 된다(굵기 외 축은 기본값)
    loc = {tag: a.defaultValue for tag, a in axes.items()}
    used = weight
    if "wght" in axes:
        a = axes["wght"]
        used = int(round(max(a.minValue, min(a.maxValue, weight))))
        loc["wght"] = used
    # inplace — 사본을 두 벌 두지 않는다(converter 는 메모리 1GB: 한글 가변 서체 한 벌 ≈ 200MB)
    static = instantiateVariableFont(font, loc, inplace=True, updateFontNames=False)
    _set_weight_names(static, used)
    return static, used


def _save_woff(font) -> bytes:
    if "DSIG" in font:
        del font["DSIG"]
    font.flavor = "woff"
    buf = io.BytesIO()
    font.save(buf)
    return buf.getvalue()


def prepare(data: bytes, weights: list[int] | None = None) -> dict:
    """서체 바이트 → [{weight, data_b64, …}]. 가변 서체는 weights(없으면 기본값) 마다 하나씩, 정적 서체는 하나."""
    if not data:
        raise PrepareError("빈 파일입니다.")
    if len(data) > MAX_BYTES:
        raise PrepareError("서체 파일은 20MB 이하만 받습니다.")
    started = time.perf_counter()
    font = _load(data)
    outline = _outline(font)
    variable = "fvar" in font
    files = []

    def emit(used: int, f) -> None:
        out = _save_woff(f)
        files.append({"weight": used, "data_b64": base64.b64encode(out).decode("ascii"), "bytes": len(out), "glyphs": len(f.getGlyphOrder())})

    if variable:
        axes = {a.axisTag: a for a in font["fvar"].axes}
        targets = sorted({int(w) for w in (weights or [])}) or [int(round(axes["wght"].defaultValue)) if "wght" in axes else 400]
        del font
        # 굵기마다 새로 읽어 고정한다(한 번에 한 벌만 메모리에 둔다)
        for w in targets:
            static, used = _instance(data, w)
            if _outline(static) != "truetype":
                _cff_to_glyf(static)
            emit(used, static)
            del static
    else:
        if outline != "truetype":
            _cff_to_glyf(font)
        emit(int(font["OS/2"].usWeightClass or 400), font)
    return {
        "outline": outline,
        "converted": outline != "truetype",
        "variable": variable,
        "files": files,
        "ms": int((time.perf_counter() - started) * 1000),
    }


def is_available() -> bool:
    try:
        import fontTools.varLib.instancer  # noqa: F401
        from fontTools.pens.cu2quPen import Cu2QuPen  # noqa: F401
    except ImportError:
        return False
    return True
