"""pdftocairo 가 만든 SVG 를 읽어 대지 좌표(pt, 왼쪽 위 원점)의 기본 도형 목록으로 바꾸고, 영역을 잘라 낸다.

cairo SVG 는 본문에 path·rect·use(glyph·image·compositing-group) 를 두고 defs 에 글리프·클립·마스크를 둔다.
마스크·필터·클립 내부는 그리는 내용이 아니므로 건너뛰고, 클립 사각형은 도형 bbox 를 자르는 데 쓴다.
"""
import copy
import math
import re
import xml.etree.ElementTree as ET

from am_common import parse_color

SVG_NS = 'http://www.w3.org/2000/svg'
XLINK_NS = 'http://www.w3.org/1999/xlink'
ET.register_namespace('', SVG_NS)
ET.register_namespace('xlink', XLINK_NS)
HREF = '{%s}href' % XLINK_NS
SKIP_TAGS = {'defs', 'clipPath', 'mask', 'filter', 'pattern', 'linearGradient', 'radialGradient',
             'symbol', 'style', 'metadata', 'title', 'desc', 'marker'}
INHERIT = ('fill', 'stroke', 'fill-opacity', 'stroke-opacity', 'stroke-width', 'opacity')

_TOK = re.compile(r'[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?')
_TF = re.compile(r'(matrix|translate|scale|rotate)\s*\(([^)]*)\)')
_NUM = re.compile(r'[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?')
_URL = re.compile(r'url\(#([^)]+)\)')

ID = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


def local(tag):
    return tag.rsplit('}', 1)[-1] if isinstance(tag, str) else ''


def mmul(m, n):
    a, b, c, d, e, f = m
    A, B, C, D, E, F = n
    return (a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f)


def mapply(m, x, y):
    a, b, c, d, e, f = m
    return a * x + c * y + e, b * x + d * y + f


def mscale(m):
    a, b, c, d, _, _ = m
    return math.sqrt(abs(a * d - b * c)) or 1.0


def parse_transform(s):
    m = ID
    if not s:
        return m
    for name, args in _TF.findall(s):
        v = [float(x) for x in _NUM.findall(args)]
        if name == 'matrix' and len(v) == 6:
            t = tuple(v)
        elif name == 'translate':
            t = (1, 0, 0, 1, v[0], v[1] if len(v) > 1 else 0)
        elif name == 'scale':
            t = (v[0], 0, 0, v[1] if len(v) > 1 else v[0], 0, 0)
        elif name == 'rotate':
            r = math.radians(v[0])
            t = (math.cos(r), math.sin(r), -math.sin(r), math.cos(r), 0, 0)
            if len(v) == 3:
                t = mmul(mmul((1, 0, 0, 1, v[1], v[2]), t), (1, 0, 0, 1, -v[1], -v[2]))
        else:
            continue
        m = mmul(m, t)
    return m


def parse_path(d):
    """경로 → (부분경로별 점 목록, 직선 수, 곡선 수, 닫힘 수). 곡선은 제어점까지 점에 넣는다(bbox 근사)."""
    toks = _TOK.findall(d or '')
    subs, cur = [], []
    nl = nc = nz = 0
    x = y = sx = sy = 0.0
    i, cmd = 0, None
    lastc = None

    def nums(k):
        nonlocal i
        out = []
        for _ in range(k):
            out.append(float(toks[i]))
            i += 1
        return out

    try:
        while i < len(toks):
            t = toks[i]
            if t.isalpha():
                cmd = t
                i += 1
                if cmd in 'Zz':
                    nz += 1
                    x, y = sx, sy
                    if cur:
                        subs.append(cur)
                        cur = []
                    continue
            elif cmd is None:
                break
            rel = cmd.islower()
            C = cmd.upper()
            ox, oy = (x, y) if rel else (0.0, 0.0)
            if C == 'M':
                px, py = nums(2)
                x, y = px + ox, py + oy
                sx, sy = x, y
                if cur:
                    subs.append(cur)
                cur = [(x, y)]
                cmd = 'l' if rel else 'L'
            elif C == 'L':
                px, py = nums(2)
                x, y = px + ox, py + oy
                cur.append((x, y))
                nl += 1
            elif C == 'H':
                (px,) = nums(1)
                x = px + (ox if rel else 0)
                cur.append((x, y))
                nl += 1
            elif C == 'V':
                (py,) = nums(1)
                y = py + (oy if rel else 0)
                cur.append((x, y))
                nl += 1
            elif C == 'C':
                v = nums(6)
                cur += [(v[0] + ox, v[1] + oy), (v[2] + ox, v[3] + oy)]
                lastc = (v[2] + ox, v[3] + oy)
                x, y = v[4] + ox, v[5] + oy
                cur.append((x, y))
                nc += 1
            elif C in 'SQ':
                v = nums(4)
                cur.append((v[0] + ox, v[1] + oy))
                x, y = v[2] + ox, v[3] + oy
                cur.append((x, y))
                nc += 1
            elif C == 'T':
                px, py = nums(2)
                x, y = px + ox, py + oy
                cur.append((x, y))
                nc += 1
            elif C == 'A':
                v = nums(7)
                x, y = v[5] + ox, v[6] + oy
                cur.append((x, y))
                nc += 1
            else:
                i += 1
    except (IndexError, ValueError):
        pass
    if cur:
        subs.append(cur)
    return subs, nl, nc, nz


def poly_area(pts):
    s = 0.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]):
        s += x0 * y1 - x1 * y0
    return abs(s) / 2.0


def bb_of(points):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return [min(xs), min(ys), max(xs), max(ys)]


def bb_inter(a, b):
    r = [max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])]
    return r if r[0] < r[2] and r[1] < r[3] else None


def bb_union(a, b):
    if a is None:
        return list(b)
    return [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]


def _style(el, parent):
    st = dict(parent)
    for k in INHERIT:
        v = el.get(k)
        if v is not None:
            st[k] = v
    s = el.get('style')
    if s:
        for part in s.split(';'):
            if ':' in part:
                k, v = part.split(':', 1)
                k = k.strip()
                if k in INHERIT:
                    st[k] = v.strip()
    return st


class SvgDoc:
    """SVG 한 장을 읽어 prims(도형 목록)와 본문 요소별 bbox 를 만든다."""

    def __init__(self, path):
        self.path = path
        self.tree = ET.parse(path)
        self.root = self.tree.getroot()
        vb = self.root.get('viewBox')
        if vb:
            v = [float(x) for x in _NUM.findall(vb)]
            self.W, self.H = v[2], v[3]
        else:
            self.W = float(_NUM.findall(self.root.get('width', '0'))[0])
            self.H = float(_NUM.findall(self.root.get('height', '0'))[0])
        self.ids = {}
        for el in self.root.iter():
            i = el.get('id')
            if i:
                self.ids[i] = el
        self._glyph_bb = {}
        self.prims = []
        self.elem_bb = {}          # 본문 요소 경로(tuple) → 그 아래 도형 bbox 합
        self.stats = {'masks': 0, 'filters': 0, 'gradients': 0, 'images': 0, 'patterns': 0}
        for el in self.root.iter():
            t = local(el.tag)
            if t == 'mask':
                self.stats['masks'] += 1
            elif t == 'filter':
                self.stats['filters'] += 1
            elif t in ('linearGradient', 'radialGradient'):
                self.stats['gradients'] += 1
            elif t == 'image':
                self.stats['images'] += 1
            elif t == 'pattern':
                self.stats['patterns'] += 1
        page = [0.0, 0.0, self.W, self.H]
        st0 = {'fill': 'black'}
        for idx, ch in enumerate(list(self.root)):
            if local(ch.tag) in SKIP_TAGS:
                continue
            self._walk(ch, ID, st0, page, (idx,), set())

    # ---- 걷기 ----
    def _clip_bb(self, el, m, clip):
        cp = el.get('clip-path')
        if not cp:
            return clip
        mm = _URL.search(cp)
        target = self.ids.get(mm.group(1)) if mm else None
        if target is None:
            return clip
        bb = None
        for sub in target.iter():
            if local(sub.tag) in ('path', 'rect'):
                pts = self._shape_points(sub)
                if pts:
                    mt = mmul(m, parse_transform(sub.get('transform')))
                    tb = bb_of([mapply(mt, x, y) for x, y in pts])
                    bb = bb_union(bb, tb)
        if bb is None:
            return clip
        return bb_inter(clip, bb) or [0, 0, 0, 0]

    def _shape_points(self, el):
        t = local(el.tag)
        if t == 'path':
            subs, _, _, _ = parse_path(el.get('d'))
            return [p for s in subs for p in s]
        if t == 'rect':
            x, y = float(el.get('x', 0)), float(el.get('y', 0))
            w, h = float(el.get('width', 0)), float(el.get('height', 0))
            return [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
        return None

    def _glyph_box(self, gid):
        if gid in self._glyph_bb:
            return self._glyph_bb[gid]
        el = self.ids.get(gid)
        bb = None
        if el is not None:
            for sub in el.iter():
                if local(sub.tag) == 'path':
                    subs, _, _, _ = parse_path(sub.get('d'))
                    pts = [p for s in subs for p in s]
                    if pts:
                        m = parse_transform(sub.get('transform'))
                        bb = bb_union(bb, bb_of([mapply(m, x, y) for x, y in pts]))
        self._glyph_bb[gid] = bb
        return bb

    def _add(self, prim, key, clip):
        bb = bb_inter(prim['bb'], clip)
        if bb is None:
            return
        prim['bb'] = bb
        prim['key'] = key
        self.prims.append(prim)
        for n in range(1, len(key) + 1):
            k = key[:n]
            self.elem_bb[k] = bb_union(self.elem_bb.get(k), bb)

    def _walk(self, el, m, st, clip, key, using, inref=False):
        t = local(el.tag)
        if t in SKIP_TAGS:
            return
        flt = el.get('filter') or ''
        if 'remove-color' in flt:
            return
        m2 = mmul(m, parse_transform(el.get('transform')))
        st2 = _style(el, st)
        clip2 = self._clip_bb(el, m2, clip)
        if clip2[2] <= clip2[0] or clip2[3] <= clip2[1]:
            return
        masked = bool(el.get('mask'))
        if t in ('g', 'svg', 'a', 'switch'):
            for i, ch in enumerate(list(el)):
                self._walk(ch, m2, st2, clip2, key if inref else key + (i,), using, inref)
        elif t == 'use':
            ref = (el.get(HREF) or el.get('href') or '').lstrip('#')
            m3 = mmul(m2, (1, 0, 0, 1, float(el.get('x', 0) or 0), float(el.get('y', 0) or 0)))
            target = self.ids.get(ref)
            if ref.startswith('glyph'):
                gb = self._glyph_box(ref)
                if gb:
                    pts = [(gb[0], gb[1]), (gb[2], gb[1]), (gb[2], gb[3]), (gb[0], gb[3])]
                    bb = bb_of([mapply(m3, x, y) for x, y in pts])
                    self._add({'k': 'glyph', 'bb': bb, 'fill': parse_color(st2.get('fill')),
                               'stroke': None, 'nl': 0, 'nc': 0, 'ns': 1, 'nz': 1, 'area': 0.0}, key, clip2)
            elif target is not None and local(target.tag) == 'image':
                w, h = float(target.get('width', 0)), float(target.get('height', 0))
                mt = mmul(m3, parse_transform(target.get('transform')))
                bb = bb_of([mapply(mt, x, y) for x, y in [(0, 0), (w, 0), (w, h), (0, h)]])
                self._add({'k': 'image', 'bb': bb, 'fill': None, 'stroke': None, 'nl': 0, 'nc': 0,
                           'ns': 0, 'nz': 0, 'area': (bb[2] - bb[0]) * (bb[3] - bb[1])}, key, clip2)
            elif target is not None and ref not in using:
                self._walk_ref(target, m3, st2, clip2, key, using | {ref})
        elif t in ('path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'):
            self._shape(el, t, m2, st2, clip2, key, masked)
        elif t == 'image':
            w, h = float(el.get('width', 0)), float(el.get('height', 0))
            x, y = float(el.get('x', 0)), float(el.get('y', 0))
            bb = bb_of([mapply(m2, px, py) for px, py in [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]])
            self._add({'k': 'image', 'bb': bb, 'fill': None, 'stroke': None, 'nl': 0, 'nc': 0,
                       'ns': 0, 'nz': 0, 'area': (bb[2] - bb[0]) * (bb[3] - bb[1])}, key, clip2)

    def _walk_ref(self, target, m, st, clip, key, using):
        # defs 안 그룹을 그 자리(use 위치)에 그린다. key 는 본문 use 요소에 귀속한다.
        t = local(target.tag)
        if t in ('mask', 'clipPath', 'filter', 'pattern'):
            return
        if t in ('g', 'symbol', 'svg'):
            m2 = mmul(m, parse_transform(target.get('transform')))
            st2 = _style(target, st)
            clip2 = self._clip_bb(target, m2, clip)
            for ch in list(target):
                self._walk(ch, m2, st2, clip2, key, using, True)
        else:
            self._walk(target, m, st, clip, key, using, True)

    def _shape(self, el, t, m, st, clip, key, masked):
        if t == 'path':
            subs, nl, nc, nz = parse_path(el.get('d'))
        elif t == 'rect':
            subs, nl, nc, nz = [self._shape_points(el)], 4, 0, 1
        elif t in ('circle', 'ellipse'):
            cx, cy = float(el.get('cx', 0)), float(el.get('cy', 0))
            rx = float(el.get('r', el.get('rx', 0)))
            ry = float(el.get('r', el.get('ry', 0)))
            subs, nl, nc, nz = [[(cx - rx, cy - ry), (cx + rx, cy - ry), (cx + rx, cy + ry), (cx - rx, cy + ry)]], 0, 4, 1
        elif t == 'line':
            subs = [[(float(el.get('x1', 0)), float(el.get('y1', 0))), (float(el.get('x2', 0)), float(el.get('y2', 0)))]]
            nl, nc, nz = 1, 0, 0
        else:
            v = [float(x) for x in _NUM.findall(el.get('points', ''))]
            subs = [list(zip(v[0::2], v[1::2]))]
            nl, nc, nz = max(0, len(subs[0]) - 1), 0, 1 if t == 'polygon' else 0
        subs = [s for s in subs if s]
        if not subs:
            return
        tsubs = [[mapply(m, x, y) for x, y in s] for s in subs]
        bb = bb_of([p for s in tsubs for p in s])
        fill_raw = st.get('fill', 'black')
        stroke_raw = st.get('stroke')
        fill = None if fill_raw in ('none', None) else parse_color(fill_raw)
        stroke = None if stroke_raw in ('none', None) else parse_color(stroke_raw)
        fill_url = bool(fill_raw and fill_raw.startswith('url('))
        if fill is None and stroke is None and not fill_url:
            return
        sw = float(_NUM.findall(st.get('stroke-width', '1'))[0]) * mscale(m) if stroke is not None else 0.0
        op = 1.0
        for k in ('opacity', 'fill-opacity'):
            try:
                op *= float(st.get(k, 1))
            except ValueError:
                pass
        area = sum(poly_area(s) for s in tsubs) if fill is not None or fill_url else 0.0
        self._add({'k': 'path', 'bb': bb, 'fill': fill, 'fill_url': fill_url, 'stroke': stroke, 'sw': sw,
                   'op': op, 'nl': nl, 'nc': nc, 'ns': len(subs), 'nz': nz, 'area': area,
                   'masked': masked}, key, clip)


def crop_svg(src_path, dst_path, region, margin=0.0, elem_bb=None):
    """region(pt bbox) 만 보이도록 viewBox 를 바꾸고, 영역 밖 본문 요소·안 쓰는 defs 를 지운다."""
    tree = ET.parse(src_path)
    root = tree.getroot()
    x0, y0, x1, y1 = region
    x0 -= margin
    y0 -= margin
    x1 += margin
    y1 += margin
    if elem_bb is not None:
        _prune(root, (), elem_bb, [x0, y0, x1, y1])
        _prune_defs(root)
    w, h = x1 - x0, y1 - y0
    root.set('viewBox', '%.3f %.3f %.3f %.3f' % (x0, y0, w, h))
    root.set('width', '%.3f' % w)
    root.set('height', '%.3f' % h)
    tree.write(dst_path, encoding='utf-8', xml_declaration=True)


def _prune(el, key, elem_bb, box):
    for i, ch in reversed(list(enumerate(list(el)))):
        if not key and local(ch.tag) in SKIP_TAGS:
            continue
        k = key + (i,)
        bb = elem_bb.get(k)
        if bb is None:
            continue  # 그린 도형이 없는 요소(마스크 보조 등)는 그대로 둔다.
        if bb_inter(bb, box) is None:
            el.remove(ch)
        elif not (bb[0] >= box[0] and bb[1] >= box[1] and bb[2] <= box[2] and bb[3] <= box[3]):
            _prune(ch, k, elem_bb, box)


def _refs(el):
    out = set()
    for e in el.iter():
        for k, v in e.attrib.items():
            if k == HREF or k == 'href':
                if v.startswith('#'):
                    out.add(v[1:])
            elif 'url(#' in v:
                out.update(_URL.findall(v))
    return out


def _prune_defs(root):
    defs = [ch for ch in root if local(ch.tag) == 'defs']
    if not defs:
        return
    body_refs = set()
    for ch in root:
        if local(ch.tag) != 'defs':
            body_refs |= _refs(ch)
    ids = {}
    parent = {}
    for d in defs:
        for p in d.iter():
            for c in p:
                parent[c] = p
                if c.get('id'):
                    ids[c.get('id')] = c
    keep = set()
    todo = list(body_refs)
    while todo:
        i = todo.pop()
        if i in keep or i not in ids:
            continue
        keep.add(i)
        todo.extend(_refs(ids[i]) - keep)
    for i, el in ids.items():
        if i not in keep:
            # 조상 중 남길 id 가 있으면(그 일부) 지우지 않는다.
            p, inside_kept = parent.get(el), False
            while p is not None:
                if p.get('id') in keep:
                    inside_kept = True
                    break
                p = parent.get(p)
            if not inside_kept and parent.get(el) is not None:
                try:
                    parent[el].remove(el)
                except ValueError:
                    pass


def strip_text(root):
    """글리프 use(글자)를 지운다. 숫자·글자는 HTML 로 덧씌우는 전제."""
    removed = 0
    for p in list(root.iter()):
        for ch in list(p):
            if local(ch.tag) == 'use' and (ch.get(HREF) or ch.get('href') or '').startswith('#glyph'):
                p.remove(ch)
                removed += 1
    return removed


def deepcopy_tree(tree):
    return ET.ElementTree(copy.deepcopy(tree.getroot()))
