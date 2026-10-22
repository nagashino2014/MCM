"""회사소개서 스톡 일러스트 매처 — 공통 유틸(경로·poppler 실행·JSON·색)."""
import colorsys
import hashlib
import json
import os
import re
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
POPPLER_BIN = os.environ.get('AM_POPPLER_BIN', r'C:\poppler\poppler-24.08.0\Library\bin')

# KESI CI 팔레트(tokens.json·kc-tokens.css 와 같은 값)
CI = {
    'navy': '#102543',
    'green': '#72af2d',
    'blue': '#0093b8',
    'gray': '#595757',
    'gray-light': '#b5b5b6',
}
AREA = {
    'area-1': ('#00698a', '#0093b8', '#e1f1f6'),
    'area-2': ('#985000', '#e39b42', '#fbefdf'),
    'area-3': ('#674a90', '#a48fd0', '#eee9f6'),
    'area-4': ('#3a7614', '#72af2d', '#ebf4e1'),
    'area-5': ('#595757', '#b5b5b6', '#efefef'),
    'area-6': ('#1d5cc4', '#6f9be6', '#e6eefb'),  # 응용소프트웨어(소개서 전용 6번째 분야, 10-22)
}

TYPES16 = ['Process', 'Cycle', 'Hub', 'Pillars', 'Layers', 'Matrix', 'Timeline', 'Roadmap',
           'Stats', 'Compare', 'BarChart', 'Share', 'RegionMap', 'IconGrid', 'OrgTree', 'Network']
TYPE_KO = {
    'Process': '단계 흐름', 'Cycle': '순환', 'Hub': '허브·방사', 'Pillars': '기둥', 'Layers': '층위',
    'Matrix': '2×2 매트릭스', 'Timeline': '시간축', 'Roadmap': '로드맵', 'Stats': '큰 숫자',
    'Compare': '전후 비교', 'BarChart': '막대', 'Share': '구성비', 'RegionMap': '지도',
    'IconGrid': '아이콘 격자', 'OrgTree': '조직·체계', 'Network': '협력 관계',
}


def tool(name):
    exe = os.path.join(POPPLER_BIN, name + '.exe')
    return exe if os.path.exists(exe) else os.path.join(POPPLER_BIN, name)


def run(args, timeout=600):
    """명령을 실행하고 (returncode, stdout, stderr) 를 돌려준다. 셸을 거치지 않는다."""
    p = subprocess.run(args, capture_output=True, timeout=timeout)
    return p.returncode, p.stdout.decode('utf-8', 'replace'), p.stderr.decode('utf-8', 'replace')


def read_json(path, default=None):
    if not os.path.exists(path):
        return default
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def sha1_file(path):
    h = hashlib.sha1()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def make_slug(filename):
    """파일 이름 → ASCII 슬러그. AdobeStock_123.ai → as-123, 한글 이름은 ASCII 부분 + 해시 6자리."""
    stem, _ = os.path.splitext(filename)
    m = re.match(r'AdobeStock_(\d+)', stem)
    if m:
        return 'as-' + m.group(1)
    ascii_part = re.sub(r'[^a-z0-9]+', '-', stem.lower()).strip('-')[:24]
    h = hashlib.sha1(stem.encode('utf-8')).hexdigest()[:6]
    return (ascii_part + '-' if ascii_part else 'f-') + h


def sniff_kind(path):
    """파일 머리로 형식을 판정: pdf(PDF 호환 AI·PDF) / eps(EPS 형식 AI·PDF 호환 꺼짐) / svg / unknown."""
    with open(path, 'rb') as f:
        head = f.read(1024)
    if head.startswith(b'%PDF-'):
        return 'pdf'
    if head.startswith(b'%!PS') or head.startswith(b'\xc5\xd0\xd3\xc6'):
        return 'eps'
    low = head.lower()
    if b'<svg' in low or (low.lstrip().startswith(b'<?xml') and path.lower().endswith('.svg')):
        return 'svg'
    return 'unknown'


# ---------- 색 ----------

def hex_to_rgb(h):
    h = h.lstrip('#')
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def rgb_to_hex(rgb):
    return '#%02x%02x%02x' % tuple(max(0, min(255, int(round(c)))) for c in rgb)


_RGB_PCT = re.compile(r'rgb\(\s*([\d.]+)%\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)')
_RGB_INT = re.compile(r'rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)')


def parse_color(v):
    """SVG 색 문자열 → (r,g,b) 0~255, 없거나 none·url 이면 None."""
    if not v:
        return None
    v = v.strip()
    m = _RGB_PCT.fullmatch(v)
    if m:
        return tuple(float(x) * 2.55 for x in m.groups())
    m = _RGB_INT.fullmatch(v)
    if m:
        return tuple(float(x) for x in m.groups())
    if v.startswith('#') and len(v) in (4, 7):
        return hex_to_rgb(v)
    named = {'black': (0, 0, 0), 'white': (255, 255, 255)}
    return named.get(v.lower())


def rgb_hls(rgb):
    return colorsys.rgb_to_hls(*(c / 255.0 for c in rgb))


def hls_rgb(h, l, s):
    return tuple(c * 255.0 for c in colorsys.hls_to_rgb(h, l, s))


def is_neutral(rgb, sat_cut=0.12):
    h, l, s = rgb_hls(rgb)
    chroma = (max(rgb) - min(rgb)) / 255.0
    return chroma < sat_cut or l > 0.97 or l < 0.04


def color_dist(a, b):
    return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5
