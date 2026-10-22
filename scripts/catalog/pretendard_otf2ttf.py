# 회사소개서 print-kit 서체 변환 — Pretendard(CFF 윤곽 OTF/WOFF) → TrueType 윤곽 WOFF.
# 왜: Chromium(Skia) PDF 는 CFF 서체를 Type 3 으로 넣고, TrueType 윤곽 서체만 부분 포함(Type0/CIDFontType2, AAAAAA+이름)한다(2026-10-22 실측).
# 사용: python -P scripts/catalog/pretendard_otf2ttf.py <원본.woff|otf> <결과.woff> [...쌍]
# 결과는 frontend/public/print-kit/fonts/ 에 둔다(converter 이미지도 같은 파일을 COPY). 라이선스: SIL OFL 1.1(수정본 표기는 LICENSE-Pretendard.txt).
import sys
from fontTools.ttLib import TTFont, newTable
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen

def glyphs_to_quadratic(glyphs, max_err=1.0, reverse_direction=True):
    out = {}
    for name in glyphs.keys():
        g = glyphs[name]
        ttpen = TTGlyphPen(glyphs)
        g.draw(Cu2QuPen(ttpen, max_err, reverse_direction=reverse_direction))
        out[name] = ttpen.glyph()
    return out

def convert(src, dst, flavor):
    f = TTFont(src)
    order = f.getGlyphOrder()
    f["loca"] = newTable("loca")
    f["glyf"] = glyf = newTable("glyf")
    glyf.glyphOrder = order
    glyf.glyphs = glyphs_to_quadratic(f.getGlyphSet())
    del f["CFF "]
    if "VORG" in f: del f["VORG"]
    glyf.compile(f)
    # hmtx 왼쪽 여백을 새 윤곽에 맞춘다
    hmtx = f["hmtx"]
    for name in order:
        g = glyf[name]
        adv, _ = hmtx[name]
        hmtx[name] = (adv, g.xMin if hasattr(g, "xMin") and g.numberOfContours != 0 else 0)
    f["maxp"] = maxp = newTable("maxp")
    maxp.tableVersion = 0x00010000
    maxp.maxZones = 1
    maxp.maxTwilightPoints = maxp.maxStorage = maxp.maxFunctionDefs = maxp.maxInstructionDefs = maxp.maxStackElements = maxp.maxSizeOfInstructions = 0
    maxp.maxComponentElements = max(len(g.components if hasattr(g, "components") else []) for g in glyf.glyphs.values())
    maxp.compile(f)
    post = f["post"]
    post.formatType = 2.0
    post.extraNames = []
    post.mapping = {}
    post.glyphOrder = order
    f.sfntVersion = "\000\001\000\000"
    f.flavor = flavor
    f.save(dst)

for src, dst in zip(sys.argv[1::2], sys.argv[2::2]):
    convert(src, dst, "woff")
    print("ok", dst)
