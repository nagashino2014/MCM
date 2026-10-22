"""SVG 색을 KESI CI 팔레트로 바꾼다.

- 유채색은 색상(hue)이 가까운 것끼리 무리 짓고, 무리마다 팔레트 색 하나를 배정한다(쓰임이 많은 무리부터).
  무리 안의 밝기 차이(명암·그림자)는 대상 색 기준으로 그대로 옮긴다.
- 무채색: 아주 밝으면 그대로, 아주 어두우면(글자·윤곽) 네이비, 그 밖은 CI 회색 단계로.
- --map '#e94e3c=area-2' 처럼 직접 지정이 자동 배정보다 앞선다.
- 필터·클립 안은 건드리지 않는다. cairo 마스크는 색을 지우는 필터를 거친 알파만 쓰므로 색을 바꿔도 투명도는 그대로다.
- 래스터 이미지는 바꿀 수 없어 경고만 낸다. 윤곽선으로 바뀐 글자는 도형이라 --strip-text 로 지워지지 않는다.
- --strip-text: 글리프(글자)를 지운다. 숫자·글자는 HTML 로 덧씌우는 전제.
"""
import re
import xml.etree.ElementTree as ET

from am_common import AREA, CI, hex_to_rgb, hls_rgb, is_neutral, parse_color, rgb_hls, rgb_to_hex
from am_svg import SvgDoc, local, strip_text

COLOR_ATTRS = ('fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color')
SKIP = {'filter', 'clipPath'}
PALETTES = {
    'ci': [CI['navy'], CI['blue'], CI['green'], CI['gray'], AREA['area-1'][0], AREA['area-4'][0]],
    'area': [AREA['area-%d' % i][1] for i in range(1, 7)] + [CI['navy']],
    'mono': [CI['navy']],
}
NAMED = {'navy': CI['navy'], 'green': CI['green'], 'blue': CI['blue'], 'gray': CI['gray'],
         'gray-light': CI['gray-light']}
for k, (dark, mid, tint) in AREA.items():
    NAMED[k] = mid
    NAMED[k + '-dark'] = dark
    NAMED[k + '-tint'] = tint
NEUTRAL_CUT = 0.2  # 회청색 글자색(채도 0.12~0.2)도 무채색으로 보고 회색·네이비 단계로 보낸다
_RGBV = re.compile(r'rgb\([^)]*\)|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b')


def _iter(el, inside=False):
    skip = inside or local(el.tag) in SKIP
    yield el, skip
    for ch in el:
        yield from _iter(ch, skip)


def _values(el):
    for a in COLOR_ATTRS:
        v = el.get(a)
        if v:
            yield a, v
    st = el.get('style')
    if st:
        for part in st.split(';'):
            if ':' in part:
                k, v = part.split(':', 1)
                if k.strip() in COLOR_ATTRS:
                    yield 'style:' + k.strip(), v.strip()


def collect(root, area_by_color=None):
    """색별 쓰임 = 등장 횟수 + 대지 위 면적 비중(1000분율). 큰 면이 팔레트 앞 색을 먼저 받는다."""
    raw, images = {}, 0
    for el, skip in _iter(root):
        if local(el.tag) == 'image':
            images += 1
        if skip:
            continue
        for _, v in _values(el):
            rgb = parse_color(v)
            if rgb is None:
                continue
            h = rgb_to_hex(rgb)
            raw[h] = raw.get(h, 0) + 1
    area_by_color = area_by_color or {}
    total = sum(area_by_color.values()) or 1.0
    use = {h: n + 1000.0 * area_by_color.get(h, 0.0) / total for h, n in raw.items()}
    return use, images


def color_areas(path):
    """SvgDoc 으로 변환·클립을 반영한 색별 면적(채움 bbox, 선은 10%)."""
    areas = {}
    for p in SvgDoc(path).prims:
        w, h = p['bb'][2] - p['bb'][0], p['bb'][3] - p['bb'][1]
        if p.get('fill') is not None:
            k = rgb_to_hex(p['fill'])
            areas[k] = areas.get(k, 0.0) + w * h
        if p.get('stroke') is not None:
            k = rgb_to_hex(p['stroke'])
            areas[k] = areas.get(k, 0.0) + 0.1 * w * h
    return areas


def _hue_dist(a, b):
    d = abs(a - b) % 1.0
    return min(d, 1.0 - d)


def build_map(use, palette='ci', maps=None):
    mapping, notes = {}, []
    for m in maps or []:
        src, _, dst = m.partition('=')
        src = rgb_to_hex(hex_to_rgb(src.strip()))
        dst = dst.strip()
        dst = NAMED.get(dst, dst)
        mapping[src] = rgb_to_hex(hex_to_rgb(dst))
        notes.append('직접 지정 %s → %s' % (src, mapping[src]))
    chroma = [(h, n) for h, n in use.items() if h not in mapping and not is_neutral(hex_to_rgb(h), NEUTRAL_CUT)]
    neutral = [(h, n) for h, n in use.items() if h not in mapping and is_neutral(hex_to_rgb(h), NEUTRAL_CUT)]
    clusters = []
    for h, n in sorted(chroma, key=lambda x: -x[1]):
        hh, ll, ss = rgb_hls(hex_to_rgb(h))
        for c in clusters:
            if _hue_dist(c['h'], hh) < 0.03:
                c['m'].append((h, n, ll))
                c['n'] += n
                break
        else:
            clusters.append({'h': hh, 'm': [(h, n, ll)], 'n': n})
    clusters.sort(key=lambda c: -c['n'])
    pal = PALETTES[palette]
    for i, c in enumerate(clusters):
        target = pal[i % len(pal)]
        th, tl, ts = rgb_hls(hex_to_rgb(target))
        ls = sorted(l for _, _, l in c['m'])
        ref = ls[len(ls) // 2]
        for h, n, l in c['m']:
            nl = max(0.08, min(0.96, tl + (l - ref) * 0.9))
            mapping[h] = rgb_to_hex(hls_rgb(th, nl, ts))
        notes.append('무리 %d(%d색, 쓰임 %.0f) → %s' % (i + 1, len(c['m']), c['n'], target))
    for h, n in neutral:
        _, l, _ = rgb_hls(hex_to_rgb(h))
        if l >= 0.93:
            continue
        if l <= 0.16:
            mapping[h] = CI['navy']
        elif l < 0.5:
            mapping[h] = CI['gray']
        elif l < 0.82:
            mapping[h] = CI['gray-light']
        else:
            mapping[h] = AREA['area-5'][2]
    return mapping, notes


def apply_map(root, mapping):
    n = 0

    def sub(v):
        nonlocal n
        def rep(m):
            nonlocal n
            rgb = parse_color(m.group(0))
            if rgb is None:
                return m.group(0)
            h = rgb_to_hex(rgb)
            if h in mapping:
                n += 1
                return mapping[h]
            return m.group(0)
        return _RGBV.sub(rep, v)

    for el, skip in _iter(root):
        if skip:
            continue
        for a in COLOR_ATTRS:
            v = el.get(a)
            if v:
                el.set(a, sub(v))
        st = el.get('style')
        if st:
            el.set('style', sub(st))
    return n


def recolor_file(src, dst, palette='ci', maps=None, strip=False, list_only=False, stats=None):
    tree = ET.parse(src)
    root = tree.getroot()
    use, images = collect(root, color_areas(src))
    lines = ['색 %d가지(무채색 %d), 래스터 이미지 %d' % (
        len(use), sum(1 for h in use if is_neutral(hex_to_rgb(h), NEUTRAL_CUT)), images)]
    if list_only:
        for h, n in sorted(use.items(), key=lambda x: -x[1]):
            lines.append('  %s  쓰임 %.0f%s' % (h, n, '  (무채색)' if is_neutral(hex_to_rgb(h), NEUTRAL_CUT) else ''))
        return lines
    mapping, notes = build_map(use, palette, maps)
    lines += notes
    changed = apply_map(root, mapping)
    lines.append('바꾼 색 값 %d곳' % changed)
    if strip:
        n_strip = strip_text(root)
        if stats is not None:
            stats['stripped'] = n_strip
        lines.append('지운 글자(글리프) %d개' % n_strip + ('' if n_strip else ' — 글자가 윤곽선으로 바뀐 파일이면 Illustrator 에서 지운다'))
    if images:
        lines.append('주의: 래스터 이미지 %d개는 색을 바꿀 수 없음(효과·그림자일 수 있음)' % images)
    if dst:
        tree.write(dst, encoding='utf-8', xml_declaration=True)
    return lines
