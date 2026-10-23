# 회사소개서 print-kit 서체 만들기 — Noto Sans KR · Noto Serif KR 가변 서체(TrueType 윤곽) → 굵기별 정적 WOFF(부분 집합).
# 왜: 스튜디오(P5) 서체 세트(노토 산스·명조 제목)를 PDF 에 부분 포함(Type0)하려면 TrueType 윤곽 정적 서체가 필요하다
#     (CFF 는 Chromium 이 Type 3 으로 넣는다 — pretendard_otf2ttf.py 주석 참고). 가변 서체는 굵기를 고정해 정적 서체로 만든다.
# 원본: Noto Sans KR / Noto Serif KR 가변 서체(SIL OFL 1.1, Google Fonts 배포본과 같은 파일 — Windows 11 에 기본 설치된 것을 썼다).
# 글자 범위: 영문·기호·한글 완성형 11,172자·자모(한자는 넣지 않는다 — 프리텐다드와 같이 대체 서체가 그린다. 넣으면 굵기당 +0.9MB).
#   --hanja 를 붙이면 KS X 1001 한자 4,888자를 넣는다.
# 굵기: 노토 산스 400·600·700(본문·라벨·제목), 노토 세리프 700(명조 제목 세트는 제목에만 쓴다 — 디자인 시스템 CSS 의 제목 서체 굵기는 모두 700).
# 사용: python -P scripts/catalog/noto_static_woff.py <NotoSansKR-VF.ttf> <NotoSerifKR-VF.ttf> <출력 폴더> [--hanja]
# 결과: NotoSansKR-{Regular,SemiBold,Bold}.woff · NotoSerifKR-Bold.woff (frontend/public/print-kit/fonts/, 라이선스 LICENSE-Noto.txt)
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools import subset

SANS_WEIGHTS = [(400, "Regular"), (600, "SemiBold"), (700, "Bold")]
SERIF_WEIGHTS = [(700, "Bold")]
WITH_HANJA = "--hanja" in sys.argv


def ksx1001_hanja() -> list[int]:
    out = []
    for hi in range(0xCA, 0xFE):
        for lo in range(0xA1, 0xFF):
            try:
                ch = bytes([hi, lo]).decode("euc_kr")
            except UnicodeDecodeError:
                continue
            if 0x4E00 <= ord(ch) <= 0x9FFF or 0xF900 <= ord(ch) <= 0xFAFF:
                out.append(ord(ch))
    return out


RANGES = [
    (0x20, 0x7E), (0xA0, 0x17F), (0x2000, 0x206F), (0x20A9, 0x20A9), (0x2100, 0x214F), (0x2150, 0x218F),
    (0x2190, 0x21FF), (0x2200, 0x22FF), (0x2460, 0x24FF), (0x2500, 0x25FF), (0x2600, 0x26FF), (0x2700, 0x27BF),
    (0x1100, 0x11FF), (0x3000, 0x303F), (0x3130, 0x318F), (0x3200, 0x32FF), (0x3300, 0x33FF),
    (0xAC00, 0xD7A3), (0xFF00, 0xFFEF),
]


def unicodes() -> list[int]:
    out = set()
    for a, b in RANGES:
        out.update(range(a, b + 1))
    if WITH_HANJA:
        out.update(ksx1001_hanja())
    return sorted(out)


def set_names(font: TTFont, family: str, family_file: str, style: str) -> None:
    # 굵기를 고정한 정적 서체 이름 — PDF 에 'AAAAAA+NotoSansKR-Bold' 처럼 들어간다
    name = font["name"]
    for rec in list(name.names):
        if rec.nameID in (2, 3, 4, 6, 16, 17, 25):
            name.removeNames(nameID=rec.nameID)
    simple = style if style in ("Regular", "Bold") else "Regular"
    name.setName(family if style in ("Regular", "Bold") else f"{family} {style}", 1, 3, 1, 0x409)
    name.setName(simple, 2, 3, 1, 0x409)
    name.setName(f"{family_file}-{style}", 3, 3, 1, 0x409)
    name.setName(f"{family} {style}", 4, 3, 1, 0x409)
    name.setName(f"{family_file}-{style}", 6, 3, 1, 0x409)
    name.setName(family, 16, 3, 1, 0x409)
    name.setName(style, 17, 3, 1, 0x409)


def build(vf_path: str, family_file: str, out_dir: str, weights: list[tuple[int, str]]) -> None:
    for wght, style in weights:
        vf = TTFont(vf_path)
        st = instantiateVariableFont(vf, {"wght": wght}, updateFontNames=False)
        family = vf["name"].getDebugName(1) or family_file
        set_names(st, family, family_file, style)
        opts = subset.Options()
        opts.layout_features = ["*"]
        opts.name_IDs = ["*"]
        opts.name_languages = ["*"]
        opts.hinting = False
        opts.notdef_outline = True
        opts.glyph_names = False
        opts.flavor = "woff"
        sub = subset.Subsetter(opts)
        sub.populate(unicodes=unicodes())
        sub.subset(st)
        # 이름 테이블: 패밀리 = 원래 이름(CSS @font-face 의 family 와 맞춘다), 굵기는 usWeightClass 로
        st["OS/2"].usWeightClass = wght
        dst = f"{out_dir}/{family_file}-{style}.woff"
        st.flavor = "woff"
        st.save(dst)
        print("ok", dst)


if __name__ == "__main__":
    sans, serif, out = sys.argv[1], sys.argv[2], sys.argv[3]
    build(sans, "NotoSansKR", out, SANS_WEIGHTS)
    build(serif, "NotoSerifKR", out, SERIF_WEIGHTS)
