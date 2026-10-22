"""영역별 구조 특징을 뽑고 인포그래픽 16유형 중 하나로 분류한다(휴리스틱 점수 + 한국어 근거).

특징: 반복 도형 무리와 배치(원형·가로줄·세로줄·격자·층·막대·지그재그), 중심 요소, 화살표·연결선·원호,
글자 자리(살아 있는 글자 + 윤곽선으로 바뀐 글자 줄), 큰 숫자, 색 수, 그라데이션·이미지·마스크(평면성).
"""
import math
import re
import statistics as stx

from am_common import TYPES16

YEAR = re.compile(r'^(19|20)\d\d$')
STEPNUM = re.compile(r'^(0?[1-9]|1[0-2])[.)]?$')
STEPWORD = re.compile(r'^(step|option|phase|stage|단계)', re.I)
PCT = re.compile(r'^\d{1,3}([.,]\d+)?%$')


def _wh(bb):
    return bb[2] - bb[0], bb[3] - bb[1]


def _ctr(bb):
    return (bb[0] + bb[2]) / 2.0, (bb[1] + bb[3]) / 2.0


def _std(v):
    return stx.pstdev(v) if len(v) > 1 else 0.0


def _cv(v):
    m = sum(v) / len(v) if v else 0
    return _std(v) / m if m else 0.0


def select(prims, region, pad=0.0):
    x0, y0, x1, y1 = region
    out = []
    for p in prims:
        cx, cy = _ctr(p['bb'])
        if x0 - pad <= cx <= x1 + pad and y0 - pad <= cy <= y1 + pad:
            out.append(p)
    return out


# ---------- 글자 ----------

def text_lines(prims, D):
    cand = []
    for i, p in enumerate(prims):
        w, h = _wh(p['bb'])
        if h <= 0 or w <= 0:
            continue
        if p['k'] == 'glyph':
            cand.append(i)
        elif p['k'] == 'path' and p['fill'] is not None and not p.get('masked') and h <= 0.03 * D:
            cx = p['nl'] + p['nc']
            if (max(w, h) <= 0.03 * D and cx >= 2) or (w / h >= 2.5 and cx >= 12):
                cand.append(i)
    cand.sort(key=lambda i: prims[i]['bb'][0])
    lines = []
    for i in cand:
        bb = prims[i]['bb']
        h = bb[3] - bb[1]
        best, bo = None, 0.0
        for ln in lines:
            lh = ln['bb'][3] - ln['bb'][1]
            ov = min(bb[3], ln['bb'][3]) - max(bb[1], ln['bb'][1])
            if ov <= 0:
                continue
            ratio = ov / min(h, lh)
            if ratio < 0.5 or max(h, lh) / max(1e-6, min(h, lh)) > 2.6:
                continue
            if bb[0] - ln['bb'][2] > 1.1 * max(h, ln['h']):
                continue
            if ratio > bo:
                best, bo = ln, ratio
        if best is None:
            lines.append({'bb': list(bb), 'h': h, 'n': 1, 'idx': [i]})
        else:
            b = best['bb']
            best['bb'] = [min(b[0], bb[0]), min(b[1], bb[1]), max(b[2], bb[2]), max(b[3], bb[3])]
            best['h'] = max(best['h'], h)
            best['n'] += 1
            best['idx'].append(i)
    out = []
    for ln in lines:
        w, h = _wh(ln['bb'])
        glyph = any(prims[i]['k'] == 'glyph' for i in ln['idx'])
        if (ln['n'] >= 4 and w >= 2.5 * h) or (glyph and ln['n'] >= 2) or (ln['n'] >= 1 and w >= 4 * h and h <= 0.03 * D):
            out.append(ln)
    return out


def text_blocks(lines):
    lines = sorted(lines, key=lambda l: (l['bb'][1], l['bb'][0]))
    blocks = []
    for ln in lines:
        lh = ln['bb'][3] - ln['bb'][1]
        for b in blocks:
            bb = b['bb']
            if 0 <= ln['bb'][1] - bb[3] <= 1.2 * max(lh, b['lh']) and \
                    min(bb[2], ln['bb'][2]) - max(bb[0], ln['bb'][0]) > -lh:
                b['bb'] = [min(bb[0], ln['bb'][0]), bb[1], max(bb[2], ln['bb'][2]), max(bb[3], ln['bb'][3])]
                b['n'] += 1
                break
        else:
            blocks.append({'bb': list(ln['bb']), 'n': 1, 'lh': lh})
    return blocks


# ---------- 도형 ----------

def shape_kind(p, D):
    w, h = _wh(p['bb'])
    mx, mn = max(w, h), min(w, h)
    nl, nc, ns, nz = p['nl'], p['nc'], p['ns'], p['nz']
    asp = mn / mx if mx else 0.0
    filled = p['fill'] is not None or p.get('fill_url')
    if not filled:
        if nc == 0 and (mn <= 0.012 * D or nl <= 1):
            if w >= 4 * h:
                return 'line_h'
            if h >= 4 * w:
                return 'line_v'
            return 'line_d'
        if nc >= 1:
            if nz and asp >= 0.9 and nc in (4, 8):
                return 'circle_o'
            return 'arc'
        return 'poly_o'
    if ns == 1 and nc == 4 and nl <= 1 and asp >= 0.9:
        return 'circle'
    if ns == 2 and nc == 8 and asp >= 0.9:
        return 'ring'
    if ns == 1 and nc == 0 and nl in (3, 4, 5):
        return 'rect' if nl >= 4 or not nz else 'tri'
    if ns == 1 and nc == 0 and nl == 2 and nz:
        return 'tri'
    if ns == 1 and nc in (4, 8) and nl in (3, 4, 5):
        return 'rrect'
    if ns == 1 and nc == 0 and nl in (6, 7, 8):
        return 'poly6'
    if nl + nc >= 150:
        return 'complex'
    if ns == 1 and nc >= 2 and 1 <= nl <= 3:
        return 'seg'
    if nc >= 2:
        return 'blob'
    return 'poly'


CLS = {'circle': 'round', 'ring': 'round', 'circle_o': 'round', 'rect': 'box', 'rrect': 'box',
       'seg': 'seg', 'blob': 'blob', 'poly6': 'poly6', 'poly': 'poly', 'complex': 'complex'}


def major_shapes(prims, text_idx, R, D):
    RA = max(1.0, (R[2] - R[0]) * (R[3] - R[1]))
    shapes = []
    for i, p in enumerate(prims):
        if i in text_idx or p['k'] != 'path':
            continue
        w, h = _wh(p['bb'])
        k = shape_kind(p, D)
        a = w * h
        if k.startswith('line') or k in ('arc', 'poly_o', 'tri'):
            shapes.append({'kind': k, 'bb': p['bb'], 'fill': p['fill'], 'stroke': p['stroke'], 'i': i})
            continue
        if a < 0.0015 * RA or a > 0.85 * RA:
            continue
        shapes.append({'kind': k, 'bb': p['bb'], 'fill': p['fill'], 'stroke': p['stroke'], 'i': i})
    # 같은 자리의 겹친 도형(채움+선, 그림자) 하나로
    tol = 0.012 * D
    uniq = []
    for s in sorted(shapes, key=lambda s: -(_wh(s['bb'])[0] * _wh(s['bb'])[1])):
        for u in uniq:
            if all(abs(a - b) <= tol for a, b in zip(s['bb'], u['bb'])):
                break
        else:
            uniq.append(s)
    return uniq


def group_shapes(shapes, D):
    groups = []
    for s in shapes:
        c = CLS.get(s['kind'])
        if c is None:
            continue
        w, h = _wh(s['bb'])
        if w <= 0 or h <= 0:
            continue
        for g in groups:
            if g['cls'] == c and abs(math.log(w / g['w'])) < 0.22 and abs(math.log(h / g['h'])) < 0.22:
                g['m'].append(s)
                break
        else:
            groups.append({'cls': c, 'w': w, 'h': h, 'm': [s]})
    # 같은 중심(동심원 등) 중복 제거
    for g in groups:
        keep = []
        for s in g['m']:
            cx, cy = _ctr(s['bb'])
            if all(math.hypot(cx - _ctr(k['bb'])[0], cy - _ctr(k['bb'])[1]) > 0.03 * D for k in keep):
                keep.append(s)
        g['m'] = keep
        g['n'] = len(keep)
    return [g for g in groups if g['n'] >= 2]


def _clusters(vals, tol):
    vals = sorted(vals)
    out = [[vals[0]]]
    for v in vals[1:]:
        if v - out[-1][-1] <= tol:
            out[-1].append(v)
        else:
            out.append([v])
    return out


def arrangement(g, R):
    Rw, Rh = max(1.0, R[2] - R[0]), max(1.0, R[3] - R[1])
    pts = [_ctr(s['bb']) for s in g['m']]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    N = len(pts)
    hs = [_wh(s['bb'])[1] for s in g['m']]
    ws = [_wh(s['bb'])[0] for s in g['m']]
    mean_h, mean_w = sum(hs) / N, sum(ws) / N
    out = {'arr': 'scatter'}
    if N >= 3:
        cx, cy = sum(xs) / N, sum(ys) / N
        ds = [math.hypot(x - cx, y - cy) for x, y in pts]
        md = sum(ds) / N
        if md > 0.6 * max(mean_w, mean_h) and _cv(ds) < 0.13:
            angs = sorted(math.atan2(y - cy, x - cx) for x, y in pts)
            gaps = [b - a for a, b in zip(angs, angs[1:])] + [angs[0] + 2 * math.pi - angs[-1]]
            if max(gaps) < 2 * math.pi / N * 1.9:
                out.update(arr='radial', center=(cx, cy), radius=md, gap_cv=round(_cv(gaps), 3))
                return out
            if max(gaps) >= math.pi * 0.8 and N >= 3:
                out.update(arr='arc', center=(cx, cy), radius=md)
                return out
    col_cl = _clusters(xs, 0.04 * Rw)
    row_cl = _clusters(ys, 0.04 * Rh)
    if len(col_cl) >= 2 and len(row_cl) >= 2 and N >= 4 and len(col_cl) * len(row_cl) * 0.75 <= N <= len(col_cl) * len(row_cl):
        if len(row_cl) == 2 and N >= 4:
            order = sorted(range(N), key=lambda i: xs[i])
            mid = sum(ys) / N
            sides = [ys[i] > mid for i in order]
            if all(a != b for a, b in zip(sides, sides[1:])):
                out.update(arr='zigzag')
                return out
        out.update(arr='grid', rows=len(row_cl), cols=len(col_cl))
        return out
    spread_x = max(xs) - min(xs)
    spread_y = max(ys) - min(ys)
    if _std(ys) <= 0.25 * mean_h + 0.02 * Rh and spread_x >= 0.25 * Rw:
        order = sorted(range(N), key=lambda i: xs[i])
        gaps = [xs[b] - xs[a] for a, b in zip(order, order[1:])]
        bottoms = [g['m'][i]['bb'][3] for i in range(N)]
        if N >= 3 and _std(bottoms) <= 0.02 * Rh and _cv(hs) >= 0.15:
            out.update(arr='bars', even=round(_cv(gaps), 3))
        else:
            out.update(arr='row', even=round(_cv(gaps), 3))
        return out
    if _std(xs) <= 0.25 * mean_w + 0.02 * Rw and spread_y >= 0.25 * Rh:
        order = sorted(range(N), key=lambda i: ys[i])
        tops = [g['m'][i]['bb'] for i in order]
        gaps = [b[1] - a[3] for a, b in zip(tops, tops[1:])]
        wseq = [_wh(b)[0] for b in tops]
        if all(gp <= 0.3 * mean_h for gp in gaps):
            inc = all(b > a * 1.05 for a, b in zip(wseq, wseq[1:]))
            dec = all(b < a / 1.05 for a, b in zip(wseq, wseq[1:]))
            out.update(arr='pyramid' if (inc or dec) and N >= 3 else 'stack')
        else:
            out.update(arr='column', even=round(_cv(gaps), 3) if gaps else 0)
        return out
    if len(row_cl) == 2 and N >= 4:
        order = sorted(range(N), key=lambda i: xs[i])
        mid = sum(ys) / N
        sides = [ys[i] > mid for i in order]
        if sum(a != b for a, b in zip(sides, sides[1:])) >= N - 2:
            out.update(arr='zigzag')
    return out


def org_rows(shapes, R, D):
    RA = max(1.0, (R[2] - R[0]) * (R[3] - R[1]))
    boxes = [s for s in shapes if CLS.get(s['kind']) in ('box', 'round') and
             0.002 * RA <= _wh(s['bb'])[0] * _wh(s['bb'])[1] <= 0.2 * RA]
    if len(boxes) < 4:
        return None
    ys = [_ctr(b['bb'])[1] for b in boxes]
    rows = _clusters(ys, 0.035 * (R[3] - R[1]))
    counts = [len(r) for r in rows]
    if len(rows) >= 2 and counts[0] <= 2 and max(counts[1:]) >= 2 and counts[-1] >= counts[0] + 1:
        return counts
    return None


# ---------- 영역 분석 ----------

def analyze_region(prims, R, words, raster, blobs=None, svg_stats=None):
    """R: 영역 bbox(pt). words: [(text, bb)]. raster: {'colors', 'n_chroma'}. blobs: 래스터 색 덩어리(pt bbox)."""
    Rw, Rh = max(1.0, R[2] - R[0]), max(1.0, R[3] - R[1])
    D = max(Rw, Rh)
    RA = Rw * Rh
    lines = text_lines(prims, D)
    text_idx = {i for ln in lines for i in ln['idx']}
    blocks = text_blocks(lines)
    lh = sorted(ln['bb'][3] - ln['bb'][1] for ln in lines)
    med_h = lh[len(lh) // 2] if lh else 0
    big = [ln for ln in lines if med_h and (ln['bb'][3] - ln['bb'][1]) >= 2.0 * med_h and ln['n'] <= 8]
    shapes = major_shapes(prims, text_idx, R, D)
    kinds = {}
    for s in shapes:
        kinds[s['kind']] = kinds.get(s['kind'], 0) + 1
    arrows = sum(1 for s in shapes if s['kind'] == 'tri' and max(_wh(s['bb'])) <= 0.07 * D)
    arrows += sum(1 for s in shapes if s['kind'] == 'poly6' and max(_wh(s['bb'])) <= 0.12 * D)
    long_h = any(s['kind'] in ('line_h', 'rect') and _wh(s['bb'])[0] >= 0.55 * Rw and _wh(s['bb'])[1] <= 0.02 * D
                 for s in shapes)
    long_v = any(s['kind'] in ('line_v', 'rect') and _wh(s['bb'])[1] >= 0.55 * Rh and _wh(s['bb'])[0] <= 0.02 * D
                 for s in shapes)
    long_curve = any(s['kind'] == 'arc' and _wh(s['bb'])[0] >= 0.5 * Rw and _wh(s['bb'])[1] >= 0.12 * Rh
                     for s in shapes)
    loop_arc = any(s['kind'] in ('arc', 'poly_o') and _wh(s['bb'])[0] >= 0.35 * Rw for s in shapes)
    hv_lines = kinds.get('line_h', 0) + kinds.get('line_v', 0)
    diag = kinds.get('line_d', 0)
    complex_area = sum(_wh(s['bb'])[0] * _wh(s['bb'])[1] for s in shapes if s['kind'] == 'complex') / RA
    rshapes = []
    for b in blobs or []:
        w, h = _wh(b['bb'])
        if w <= 0 or h <= 0 or not (0.0015 * RA <= w * h <= 0.85 * RA):
            continue
        fr, asp = b['fill_ratio'], min(w, h) / max(w, h)
        kind = 'rect' if fr >= 0.9 else ('circle' if 0.68 <= fr <= 0.86 and asp >= 0.85 else 'blob')
        rshapes.append({'kind': kind, 'bb': b['bb'], 'fill': b['color'], 'stroke': None, 'src': 'r', 'set': b.get('set', 0)})
    vgroups = group_shapes([s for s in shapes if not s['kind'].startswith('line') and s['kind'] not in ('arc', 'poly_o', 'tri')], D)
    rgroups = []
    for set_i in sorted({s['set'] for s in rshapes}):
        rgroups += group_shapes([s for s in rshapes if s['set'] == set_i], D)
    best, best_sc = None, 0.0
    for g, w_src in [(g, 1.0) for g in vgroups] + [(g, 0.85) for g in rgroups]:
        g.update(arrangement(g, R))
        n = g['n']
        if n > 30:
            continue
        sc = w_src * (n ** 0.7) * math.sqrt(g['w'] * g['h'] / RA) * (1.6 if g['arr'] != 'scatter' else 1.0)
        if sc > best_sc:
            best, best_sc = g, sc
    center = False
    if best and best['arr'] == 'radial':
        cx, cy = best['center']
        msz = max(best['w'], best['h'])
        for s in shapes + rshapes:
            if s in best['m'] or CLS.get(s['kind']) is None:
                continue
            sx, sy = _ctr(s['bb'])
            if math.hypot(sx - cx, sy - cy) <= 0.2 * best['radius'] and max(_wh(s['bb'])) >= 0.5 * msz:
                center = True
                break
        if not center:
            for b in blocks:
                bx, by = _ctr(b['bb'])
                if math.hypot(bx - cx, by - cy) <= 0.2 * best['radius']:
                    center = True
                    break
    ws = [w for w, _ in words]
    years = sum(1 for w in ws if YEAR.match(w))
    stepn = sum(1 for w in ws if STEPNUM.match(w) or STEPWORD.match(w))
    pcts = sum(1 for w in ws if PCT.match(w))
    filled = [p for p in prims if p['k'] == 'path' and (p['fill'] is not None or p.get('fill_url'))]
    farea = sum(p['area'] for p in filled) or 1.0
    grad = sum(p['area'] for p in filled if p.get('fill_url')) / farea
    img = sum(p['area'] for p in prims if p['k'] == 'image') / RA
    masked = sum(1 for p in prims if p.get('masked'))
    f = {
        'bbox': [round(v, 2) for v in R], 'aspect': round(Rw / Rh, 3),
        'n_prims': len(prims), 'n_shapes': len(shapes), 'kinds': kinds,
        'text_lines': len(lines), 'text_slots': len(blocks), 'big_text': len(big),
        'live_words': len(words), 'years': years, 'step_words': stepn, 'percents': pcts,
        'arrows': arrows, 'hv_lines': hv_lines, 'diag_lines': diag, 'long_h_line': long_h,
        'long_v_line': long_v, 'long_curve': long_curve, 'loop_arc': loop_arc,
        'complex_area': round(complex_area, 3), 'center': center,
        'gradient_frac': round(grad, 3), 'image_frac': round(img, 3), 'masked': masked,
        'colors': raster.get('colors', []), 'n_chroma': raster.get('n_chroma', 0),
        'icon_items': raster.get('merged_items', 0),
        'org_rows': org_rows(shapes, R, D),
        'group': None,
        'slots': [[round((b['bb'][0] - R[0]) / Rw, 4), round((b['bb'][1] - R[1]) / Rh, 4),
                   round(_wh(b['bb'])[0] / Rw, 4), round(_wh(b['bb'])[1] / Rh, 4), b['n']] for b in blocks],
    }
    if best:
        gi = {'cls': best['cls'], 'n': best['n'], 'arr': best['arr'], 'src': 'raster' if best['m'][0].get('src') == 'r' else 'vector',
              'member_w': round(best['w'] / Rw, 3), 'member_h': round(best['h'] / Rh, 3),
              'tall': best['h'] / best['w'] if best['w'] else 0}
        for k in ('rows', 'cols', 'even', 'gap_cv'):
            if k in best:
                gi[k] = best[k]
        if best['cls'] == 'seg' and best['arr'] == 'radial':
            sizes = [_wh(s['bb'])[0] * _wh(s['bb'])[1] for s in best['m']]
            gi['seg_cv'] = round(_cv(sizes), 3)
        f['group'] = gi
    f['n_blobs'] = sum(1 for s in rshapes if s['set'] == 0)
    for g in vgroups + rgroups:
        # 격자로 놓인 큰 판(슬라이드·표지 묶음) → 칸별로 다시 분석
        if g.get('arr') == 'grid' and g['cls'] in ('box', 'blob') and g['n'] >= 6 and g['w'] * g['h'] >= 0.05 * RA:
            f['cells'] = [list(s['bb']) for s in g['m']]
            break
    f['auto'] = classify(f)
    f['style'] = style_score(f, svg_stats or {})
    return f


def classify(f):
    S = {t: 0.0 for t in TYPES16}
    why = {t: [] for t in TYPES16}

    def add(t, v, msg):
        S[t] += v
        why[t].append(msg)

    g = f['group']
    count = None
    if f['icon_items'] >= 8:
        add('IconGrid', 0.85, '비슷한 크기 조각 %d개가 흩어져 있음(아이콘 세트·격자)' % f['icon_items'])
        count = f['icon_items']
    if g:
        N, arr, cls = g['n'], g['arr'], g['cls']
        if arr == 'radial':
            if f['center']:
                add('Hub', 0.85, '%d개 요소가 원형으로 놓이고 가운데에 중심 요소가 있음' % N)
                add('Cycle', 0.5, '%d개 요소의 원형 배치' % N)
            else:
                add('Cycle', 0.7, '%d개 요소가 원형으로 놓임(중심 요소 없음)' % N)
                add('Hub', 0.45, '%d개 요소의 원형 배치' % N)
            if f['arrows'] >= max(2, N - 1) or f['kinds'].get('arc', 0) >= 2:
                add('Cycle', 0.2, '둘레를 따라 화살표·원호가 있음')
            if cls == 'seg':
                add('Cycle', 0.1, '고리를 나눈 조각 모양')
                add('Share', 0.35 + (0.3 if g.get('seg_cv', 0) > 0.25 else 0), '고리 조각' + (' 크기가 서로 다름' if g.get('seg_cv', 0) > 0.25 else ''))
            if f['diag_lines'] >= N and f['center']:
                add('Hub', 0.1, '중심에서 뻗는 연결선 %d개' % f['diag_lines'])
                add('Network', 0.35, '중심과 이어진 연결선')
            count = N
        elif arr == 'arc':
            add('Process', 0.45, '%d개 요소가 반원·호를 따라 놓임' % N)
            add('Cycle', 0.35, '호 배치')
            add('Roadmap', 0.3, '곡선 경로 배치')
            count = N
        elif arr == 'grid':
            if g['rows'] == 2 and g['cols'] == 2 and g['member_w'] * g['member_h'] >= 0.1:
                add('Matrix', 0.85, '큰 칸 네 개가 2×2 로 놓임')
                count = 4
            else:
                add('IconGrid', 0.7, '%d×%d 격자(%d개)' % (g['rows'], g['cols'], N))
                add('Pillars', 0.25 if g['rows'] == 1 else 0, '')
                count = count or N
        elif arr in ('row', 'bars'):
            if arr == 'bars':
                add('BarChart', 0.85, '바닥이 맞춰진 막대 %d개의 높이가 서로 다름' % N)
            pillar = (g['tall'] >= 1.6 and cls == 'box') or (g['tall'] >= 1.1 and cls in ('box', 'blob') and g['member_h'] >= 0.5 and 3 <= N <= 6)
            if pillar:
                add('Pillars', 0.75, '세로로 긴 판 %d개가 나란히 섬(영역 높이의 %d%%)' % (N, int(g['member_h'] * 100)))
            if f['long_h_line'] and cls == 'round' and g['member_w'] <= 0.12:
                add('Timeline', 0.75, '긴 가로선 위에 원형 표지 %d개' % N)
            if N == 2:
                add('Compare', 0.6, '같은 모양 두 개가 좌우로 놓임')
                add('Process', 0.3, '두 단계')
            else:
                bonus = 0.15 if (f['arrows'] >= N - 1 or cls == 'poly6') else 0.0
                add('Process', (0.5 if pillar else 0.6) + bonus, '%d개 요소가 가로로 고르게 놓임' % N + (' + 단계 화살표' if bonus else ''))
            count = N
        elif arr in ('column', 'stack', 'pyramid'):
            if arr == 'pyramid':
                add('Layers', 0.85, '%d층이 폭을 바꿔 가며 쌓임(피라미드·깔때기)' % N)
            elif arr == 'stack':
                add('Layers', 0.7, '%d층이 붙어 쌓임' % N)
            if f['long_v_line']:
                add('Timeline', 0.6, '긴 세로선을 따라 %d개 표지' % N)
            add('Process', 0.5, '%d개 요소가 세로 목록으로 놓임' % N)
            count = N
        elif arr == 'zigzag':
            add('Timeline', 0.7, '%d개 요소가 위아래로 번갈아 놓임' % N)
            add('Roadmap', 0.4, '지그재그 경로')
            count = N
        elif arr == 'scatter' and N >= 6 and cls == 'round' and f['diag_lines'] >= 4:
            add('Network', 0.6, '원형 마디 %d개가 사선으로 이어짐' % N)
            count = N
    if f['org_rows']:
        rows = f['org_rows']
        add('OrgTree', 0.6 + (0.25 if f['hv_lines'] >= 3 else 0), '상자 줄 수 %s(위가 적고 아래가 많음)' % '-'.join(map(str, rows))
            + (' + 직각 연결선' if f['hv_lines'] >= 3 else ''))
        if S['OrgTree'] >= max(S.values()):
            count = sum(rows)
    if f['complex_area'] >= 0.25:
        add('RegionMap', 0.75, '복잡한 외곽선이 영역의 %d%%를 차지(지도 모양)' % int(f['complex_area'] * 100))
    if f['big_text'] >= 2:
        add('Stats', 0.5, '크게 쓴 글자·숫자 줄 %d개' % f['big_text'])
    if f['long_curve']:
        add('Roadmap', 0.55, '영역을 가로지르는 긴 곡선 길')
    if f['percents'] >= 2:
        add('Share', 0.15, '퍼센트 글자 %d개' % f['percents'])
        add('Stats', 0.15, '퍼센트 글자')
    if f['years'] >= 3:
        add('Timeline', 0.35, '연도 글자 %d개' % f['years'])
    if f['loop_arc'] and g and g['arr'] in ('row', 'column'):
        add('Cycle', 0.15, '줄 배치에 되돌아가는 긴 곡선')
    ranked = sorted(TYPES16, key=lambda t: -S[t])
    top = ranked[0]
    if S[top] <= 0:
        return {'type': None, 'score': 0.0, 'alt': [], 'count': None, 'reasons': ['뚜렷한 반복 구조를 찾지 못함']}
    return {
        'type': top,
        'score': round(min(1.0, S[top]), 3),
        'alt': [[t, round(min(1.0, S[t]), 3)] for t in ranked[1:4] if S[t] > 0],
        'count': count,
        'reasons': [m for m in why[top] if m],
        'loop': bool(f['loop_arc']),
    }


def style_score(f, svg_stats):
    """회사소개서 시각 언어(무광 평면·단순 색) 적합도 0~1 과 감점 사유."""
    s, why = 1.0, []
    if svg_stats.get('filters', 0) > 20 or svg_stats.get('images', 0) > 3:
        s -= 0.25
        why.append('Illustrator 효과(그림자·흐림)가 이미지·필터로 굳음')
    if f['gradient_frac'] > 0.2:
        s -= 0.25
        why.append('그라데이션 면 %d%%' % int(f['gradient_frac'] * 100))
    if f['image_frac'] > 0.1:
        s -= 0.3
        why.append('래스터 이미지 포함')
    if f['masked'] > 20:
        s -= 0.15
        why.append('그림자·투명 효과 많음')
    if f['n_chroma'] > 6:
        s -= 0.1
        why.append('유채색 %d가지' % f['n_chroma'])
    return {'score': round(max(0.0, s), 2), 'penalties': why}
