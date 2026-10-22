"""저해상 래스터(PPM)로 배경을 걷어 내고, 한 대지 안의 그림 덩어리(영역)를 나누고, 주요 색을 뽑는다."""
import os

from am_common import color_dist, is_neutral, rgb_to_hex, run, tool


def render_ppm(pdf, page, out_prefix, long_side=500):
    rc, _, err = run([tool('pdftoppm'), '-f', str(page), '-l', str(page), '-scale-to', str(long_side),
                      '-singlefile', pdf, out_prefix])
    if rc != 0:
        raise RuntimeError('pdftoppm 실패: ' + err.strip())
    return load_ppm(out_prefix + '.ppm')


def load_ppm(path):
    with open(path, 'rb') as f:
        data = f.read()
    parts, pos = [], 0
    while len(parts) < 4:
        while data[pos:pos + 1].isspace():
            pos += 1
        if data[pos:pos + 1] == b'#':
            pos = data.index(b'\n', pos) + 1
            continue
        end = pos
        while not data[end:end + 1].isspace():
            end += 1
        parts.append(data[pos:end])
        pos = end
    pos += 1
    if parts[0] != b'P6':
        raise ValueError('P6 PPM 만 지원')
    w, h = int(parts[1]), int(parts[2])
    return w, h, data[pos:pos + w * h * 3]


def _px(data, i):
    return data[3 * i], data[3 * i + 1], data[3 * i + 2]


def _mode_color(data, idxs):
    hist = {}
    for i in idxs:
        r, g, b = _px(data, i)
        k = (r >> 3, g >> 3, b >> 3)
        hist[k] = hist.get(k, 0) + 1
    k = max(hist, key=hist.get)
    return (k[0] * 8 + 4, k[1] * 8 + 4, k[2] * 8 + 4), hist[k] / max(1, len(idxs))


def foreground_mask(w, h, data, thr=34):
    """테두리 최빈색을 배경으로 보고, 그와 다른 픽셀을 전경으로 표시한다. 전경이 85%를 넘으면 전체 최빈색을 배경으로 바꾼다."""
    border = [x for x in range(w)] + [(h - 1) * w + x for x in range(w)] + \
             [y * w for y in range(h)] + [y * w + w - 1 for y in range(h)]
    bg, _ = _mode_color(data, border)
    mask = _mask(w, h, data, bg, thr)
    cov = sum(mask) / float(w * h)
    if cov > 0.85:
        bg, _ = _mode_color(data, range(0, w * h, 3))
        mask = _mask(w, h, data, bg, thr)
    return mask, bg


def _mask(w, h, data, bg, thr):
    br, bgc, bb = bg
    t2 = thr * thr
    out = bytearray(w * h)
    for i in range(w * h):
        r, g, b = data[3 * i], data[3 * i + 1], data[3 * i + 2]
        if (r - br) ** 2 + (g - bgc) ** 2 + (b - bb) ** 2 > t2:
            out[i] = 1
    return out


def dilate(mask, w, h, r):
    """정사각 팽창(가로·세로 누적합 두 번)."""
    tmp = bytearray(w * h)
    for y in range(h):
        row = mask[y * w:(y + 1) * w]
        pre = [0]
        for v in row:
            pre.append(pre[-1] + v)
        for x in range(w):
            if pre[min(w, x + r + 1)] - pre[max(0, x - r)] > 0:
                tmp[y * w + x] = 1
    out = bytearray(w * h)
    for x in range(w):
        pre = [0]
        for y in range(h):
            pre.append(pre[-1] + tmp[y * w + x])
        for y in range(h):
            if pre[min(h, y + r + 1)] - pre[max(0, y - r)] > 0:
                out[y * w + x] = 1
    return out


def components(mask, w, h, orig):
    """4-이웃 연결 성분 → [(bbox[x0,y0,x1,y1], 원 전경 픽셀 수)]."""
    lab = [0] * (w * h)
    comps = []
    cur = 0
    for start in range(w * h):
        if not mask[start] or lab[start]:
            continue
        cur += 1
        stack = [start]
        lab[start] = cur
        x0 = y0 = 10 ** 9
        x1 = y1 = -1
        n = 0
        while stack:
            i = stack.pop()
            y, x = divmod(i, w)
            if x < x0: x0 = x
            if x > x1: x1 = x
            if y < y0: y0 = y
            if y > y1: y1 = y
            if orig[i]:
                n += 1
            for j in (i - 1 if x > 0 else -1, i + 1 if x < w - 1 else -1, i - w, i + w):
                if 0 <= j < w * h and mask[j] and not lab[j]:
                    lab[j] = cur
                    stack.append(j)
        comps.append(([x0, y0, x1 + 1, y1 + 1], n))
    return comps


def segment(w, h, data):
    """대지를 그림 영역들로 나눈다. 돌려주는 bbox 는 픽셀 좌표, 정보 dict 를 함께 준다."""
    mask, bg = foreground_mask(w, h, data)
    cov = sum(mask) / float(w * h)
    info = {'bg': rgb_to_hex(bg), 'coverage': round(cov, 3)}
    if cov < 0.002:
        return [], info
    r = max(2, int(round(0.018 * max(w, h))))
    comps = components(dilate(mask, w, h, r), w, h, mask)
    page_area = float(w * h)
    # 비슷한 크기의 작은 조각이 많으면(아이콘 세트) 하나로 묶는다. 큰 조각이 많으면(슬라이드 묶음) 각각 둔다.
    sig = [c for c in comps if (c[0][2] - c[0][0]) * (c[0][3] - c[0][1]) >= 0.002 * page_area]
    if len(sig) >= 8:
        areas = [(c[0][2] - c[0][0]) * (c[0][3] - c[0][1]) for c in sig]
        mean = sum(areas) / len(areas)
        cv = (sum((a - mean) ** 2 for a in areas) / len(areas)) ** 0.5 / mean
        if cv < 0.9 and mean < 0.03 * page_area:
            info['n_components'] = len(sig)
            info['merged_items'] = len(sig)
            info['mask'] = mask
            return [[min(c[0][0] for c in sig), min(c[0][1] for c in sig),
                     max(c[0][2] for c in sig), max(c[0][3] for c in sig)]], info
    big, small = [], []
    for bb, n in comps:
        a = (bb[2] - bb[0]) * (bb[3] - bb[1])
        (big if (a >= 0.015 * page_area or n >= 0.004 * page_area) else small).append([bb, n])
    if not big:
        big = sorted(comps, key=lambda c: -c[1])[:1]
        big = [list(c) for c in big]
    # 작은 조각은 가까운 큰 영역에 붙이거나 버린다.
    for bb, n in small:
        best, bd = None, None
        for c in big:
            d = _gap(bb, c[0])
            if bd is None or d < bd:
                best, bd = c, d
        if best is not None and bd <= 4 * r:
            best[0] = [min(best[0][0], bb[0]), min(best[0][1], bb[1]), max(best[0][2], bb[2]), max(best[0][3], bb[3])]
            best[1] += n
    info['n_components'] = len(big)
    big.sort(key=lambda c: (round(c[0][1] / (0.15 * h)), c[0][0]))
    info['mask'] = mask
    return [c[0] for c in big], info


def _gap(a, b):
    dx = max(0, max(a[0], b[0]) - min(a[2], b[2]))
    dy = max(0, max(a[1], b[1]) - min(a[3], b[3]))
    return max(dx, dy)


def region_colors(w, h, data, mask, bb, top=6, merge=48, min_frac=0.01):
    """영역 안 전경 픽셀의 주요 색(hex, 비율)과 유채색 무리 수. 덩어리용은 merge·min_frac 를 낮춰 잘게 나눈다."""
    hist = {}
    total = 0
    for y in range(bb[1], bb[3]):
        for x in range(bb[0], bb[2]):
            i = y * w + x
            if not mask[i]:
                continue
            r, g, b = _px(data, i)
            k = (r >> 4, g >> 4, b >> 4)
            hist[k] = hist.get(k, 0) + 1
            total += 1
    if not total:
        return [], 0
    bins = sorted(hist.items(), key=lambda kv: -kv[1])
    merged = []
    for k, n in bins:
        rgb = (k[0] * 16 + 8, k[1] * 16 + 8, k[2] * 16 + 8)
        for m in merged:
            if color_dist(m[0], rgb) < merge:
                m[1] += n
                break
        else:
            merged.append([rgb, n])
    merged.sort(key=lambda m: -m[1])
    out = [(rgb_to_hex(c), round(n / float(total), 3)) for c, n in merged if n / float(total) >= min_frac][:top]
    chroma = [c for c, n in merged if n / float(total) >= 0.03 and not is_neutral(c)]
    return out, len(chroma)


def color_blobs(w, h, data, mask, bb, palette, min_frac=0.002):
    """영역 안 전경 픽셀을 주요 색에 배정하고 색별 연결 성분(덩어리)을 돌려준다.
    벡터로 잡히지 않는 효과(그림자·흐림·이미지)가 많은 파일의 보조 도형 출처."""
    x0, y0, x1, y1 = bb
    rw, rh = x1 - x0, y1 - y0
    if rw <= 0 or rh <= 0 or not palette:
        return []
    pal = [tuple(int(hx[i:i + 2], 16) for i in (1, 3, 5)) for hx, _ in palette]
    lab = [-1] * (rw * rh)
    for y in range(rh):
        for x in range(rw):
            i = (y + y0) * w + (x + x0)
            if not mask[i]:
                continue
            px = _px(data, i)
            best, bd = -1, 40.0
            for k, c in enumerate(pal):
                d = color_dist(px, c)
                if d < bd:
                    best, bd = k, d
            lab[y * rw + x] = best
    seen = bytearray(rw * rh)
    out = []
    min_n = max(4, int(min_frac * rw * rh))
    for start in range(rw * rh):
        k = lab[start]
        if k < 0 or seen[start]:
            continue
        stack = [start]
        seen[start] = 1
        bx0 = by0 = 10 ** 9
        bx1 = by1 = -1
        n = 0
        while stack:
            i = stack.pop()
            y, x = divmod(i, rw)
            n += 1
            if x < bx0: bx0 = x
            if x > bx1: bx1 = x
            if y < by0: by0 = y
            if y > by1: by1 = y
            for j in (i - 1 if x > 0 else -1, i + 1 if x < rw - 1 else -1, i - rw, i + rw):
                if 0 <= j < rw * rh and not seen[j] and lab[j] == k:
                    seen[j] = 1
                    stack.append(j)
        if n >= min_n:
            area = (bx1 - bx0 + 1) * (by1 - by0 + 1)
            out.append({'bb': [bx0 + x0, by0 + y0, bx1 + x0 + 1, by1 + y0 + 1], 'n': n,
                        'fill_ratio': round(n / float(area), 3), 'color': palette[k][0]})
    return out


def cleanup(prefix):
    p = prefix + '.ppm'
    if os.path.exists(p):
        os.remove(p)
