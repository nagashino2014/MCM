"""시각 판정을 마친 그림 영역을 회사소개서 일러스트 묶음으로 내보낸다(관리 화면 '일러스트 가져오기'로 폴더째 올린다).

  <out>/<영역 키>/illust.svg   정리한 벡터 — Illustrator SVG(필터 합성 없음)에서 영역만 남기고 글자 레이어·배경·효과를 걷어 낸다
  <out>/<영역 키>/thumb.png    목록 미리보기(Edge 헤드리스)
  <out>/<영역 키>/meta.json    판정 유형·항목 수·품질·글자 자리·색 팔레트·라이선스·소개서 자리 적합도
  <out>/index.json             묶음 목록

글자 자리(slots): Illustrator 의 글자 레이어(Text·Title…)를 지우기 전에 글자 덩어리마다 상자·줄 수·크기·정렬을 재고,
역할(title 제목·sub 머리글·desc 설명·number 번호/숫자·center 중심)과 항목 순서(item)를 붙인다. 앱은 이 자리에 HTML 글자를 얹는다.
색: 색 값마다 CSS 변수 `var(--il-cN, #원래색)` 으로 바꾼다. 앱이 변수만 바꿔 KESI 토큰·분야 색으로 칠한다(파일은 그대로 원래 색).
팔레트의 group 은 색상(hue)이 가까운 유채색 무리 순위(쓰임 순), shade 는 무리 안 밝기 차이(-1~1)다.
"""
import math
import os
import re
import shutil
import xml.etree.ElementTree as ET

from am_common import HERE, hex_to_rgb, is_neutral, parse_color, read_json, rgb_hls, rgb_to_hex, run, write_json
from am_svg import HREF, SKIP_TAGS, SvgDoc, _prune, _prune_defs, bb_inter, bb_union, local

TEXT_LAYER = re.compile(r'^(text|texts|txt|title|titles|headline|heading|header|copy|caption|captions|label|labels|lorem|'
                        r'number|numbers|글자|텍스트|문구|제목)$', re.I)
BG_LAYER = re.compile(r'^(background|backgrounds|bg|배경|name|logo|watermark)$', re.I)  # 배경·템플릿 이름 로고
COLOR_ATTRS = ('fill', 'stroke', 'stop-color', 'flood-color')
NO_RECOLOR = {'mask', 'clipPath', 'filter'}
TYPE_KEYS = {  # 매처 16유형 → 앱 인포그래픽 유형(lib/catalog/render/infographic/types.ts)
    'Process': 'process', 'Cycle': 'cycle', 'Hub': 'hub', 'Pillars': 'pillars', 'Layers': 'layers',
    'Matrix': 'matrix', 'Timeline': 'timeline', 'Roadmap': 'roadmap', 'Stats': 'stats', 'Compare': 'compare',
    'BarChart': 'bar', 'Share': 'share', 'RegionMap': 'map', 'IconGrid': 'iconGrid', 'OrgTree': 'pillars',
    'Network': 'network',
}
RADIAL = {'Hub', 'Cycle', 'Network'}
LINEAR = {'Process', 'Timeline', 'Roadmap'}
MAX_SVG_BYTES = 3 * 1024 * 1024


def layer_name(i):
    """Illustrator 레이어 id → 이름(_x5F_ 같은 이스케이프와 _1_·_000…_ 꼬리 제거)."""
    s = re.sub(r'_x([0-9A-Fa-f]{2})_', lambda m: chr(int(m.group(1), 16)), i or '')
    s = re.sub(r'_0{5,}\d*_?$', '', s)
    s = re.sub(r'_\d+_$', '', s)
    return s.strip(' _')


# ---------- Illustrator SVG ----------

def illustrator_svgs(work, man, slugs, force, log):
    """slug 마다 <work>/aisvg/<slug>/abNN.svg 를 만든다(원본 sha1 이 같으면 다시 만들지 않는다)."""
    todo = []
    for s in slugs:
        e = man['assets'][s]
        d = os.path.join(work, 'aisvg', s)
        stamp = read_json(os.path.join(d, 'stamp.json'), {})
        if not force and stamp.get('sha1') == e.get('sha1') and any(f.endswith('.svg') for f in os.listdir(d)):
            continue
        todo.append(s)
    if not todo:
        return
    jobdir = os.path.join(work, '_jobs')
    os.makedirs(jobdir, exist_ok=True)
    job = os.path.join(jobdir, 'ai_svg_job.js')
    logf = os.path.join(jobdir, 'ai_svg_job.log')
    if os.path.exists(logf):
        os.remove(logf)

    def js(v):
        return '"' + os.path.abspath(v).replace('\\', '/').replace('"', '\\"') + '"'

    lines = ['var JOB = [']
    for s in todo:
        d = os.path.join(work, 'aisvg', s)
        shutil.rmtree(d, ignore_errors=True)
        os.makedirs(d, exist_ok=True)
        lines.append(' {slug: "%s", src: %s, dir: %s},' % (s, js(os.path.join(work, man['assets'][s]['input'])), js(d)))
    lines.append('];')
    lines.append('var LOG_FILE = %s;' % js(logf))
    with open(job, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    log('export: Illustrator 로 SVG %d개 내보내는 중(파일당 10~30초)…' % len(todo))
    rc, so, se = run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', os.path.join(HERE, 'ai_to_pdf.ps1'),
                      '-JobFile', job, '-Script', 'ai_to_svg.jsx'], timeout=60 * 60)
    if rc != 0:
        log('  Illustrator 실행 실패: ' + (se or so).strip()[:400])
    ok = set()
    if os.path.exists(logf):
        with open(logf, encoding='utf-8-sig') as f:
            for line in f:
                p = line.rstrip('\n').split('\t')
                if p[0] == 'OK':
                    ok.add((p[1], int(p[2])))
                elif p[0] == 'ERR':
                    log('  %s 실패: %s' % (p[1], p[3] if len(p) > 3 else ''))
    for s in todo:
        d = os.path.join(work, 'aisvg', s)
        for name in sorted(os.listdir(d)):
            sub = os.path.join(d, name)
            if not (os.path.isdir(sub) and re.fullmatch(r'ab\d+', name)):
                continue
            svgs = [f for f in os.listdir(sub) if f.lower().endswith('.svg')]
            if svgs:
                os.replace(os.path.join(sub, svgs[0]), os.path.join(d, name + '.svg'))
            shutil.rmtree(sub, ignore_errors=True)
        if any((s, k) in ok for k in range(1, 100)):
            write_json(os.path.join(d, 'stamp.json'), {'sha1': man['assets'][s].get('sha1')})


# ---------- 글자 자리 ----------

def _units(el, key):
    """글자 레이어 아래 '글자 덩어리'(자식에 g 가 없는 g, 또는 g 와 섞인 도형) 목록 → [(key, el)]."""
    kids = list(el)
    if local(el.tag) != 'g' or not any(local(k.tag) == 'g' for k in kids):
        return [(key, el)]
    out = []
    for i, k in enumerate(kids):
        if local(k.tag) in SKIP_TAGS:
            continue
        out += _units(k, key + (i,))
    return out


def _measure(doc, key):
    prims = [p for p in doc.prims if p['key'][:len(key)] == key]
    if not prims:
        return None
    bb = None
    for p in prims:
        bb = bb_union(bb, p['bb'])
    hs = sorted(p['bb'][3] - p['bb'][1] for p in prims)
    gh = hs[int(len(hs) * 0.9)] if len(hs) > 1 else hs[0]  # 위쪽 큰 글자(대문자·오름) 높이
    # 줄: 글자 중심 y 를 정렬해 글자 높이 60% 넘게 벌어지면 새 줄
    cys = sorted((((p['bb'][1] + p['bb'][3]) / 2, p) for p in prims), key=lambda t: t[0])
    lines = [[cys[0][1]]]
    for (y0, _), (y1, p) in zip(cys, cys[1:]):
        if y1 - y0 > 0.6 * gh:
            lines.append([])
        lines[-1].append(p)
    lbbs = []
    for ln in lines:
        b = None
        for p in ln:
            b = bb_union(b, p['bb'])
        lbbs.append(b)
    fs = gh / 0.72
    lh = 1.3
    if len(lines) >= 2:
        pitch = ((lbbs[-1][1] + lbbs[-1][3]) / 2 - (lbbs[0][1] + lbbs[0][3]) / 2) / (len(lines) - 1)
        lh = max(1.0, min(2.0, pitch / fs))
    cols = {}
    for p in prims:
        if p.get('fill') is not None:
            k = rgb_to_hex(p['fill'])
            cols[k] = cols.get(k, 0) + 1
    color = max(cols, key=cols.get) if cols else None
    return {'bb': bb, 'lines': len(lines), 'fs': fs, 'lh': lh, 'glyphs': len(prims), 'lbbs': lbbs, 'color': color}


def _align_of(edges):
    """[(x0, x1)] 묶음 → 가장 잘 맞는 정렬(left|center|right)."""
    if len(edges) < 2:
        return None
    spread = {
        'left': max(e[0] for e in edges) - min(e[0] for e in edges),
        'center': max((e[0] + e[1]) / 2 for e in edges) - min((e[0] + e[1]) / 2 for e in edges),
        'right': max(e[1] for e in edges) - min(e[1] for e in edges),
    }
    return min(spread, key=lambda k: (spread[k], ['left', 'center', 'right'].index(k)))


def text_slots(doc, text_layers, R, kind, art_bb):
    """글자 레이어(최상위 요소 [(idx, el)]) → 자리 목록(쪽 좌표 pt). kind = 매처 유형(Hub 등)."""
    blocks = []
    for idx, el in text_layers:
        for i, ch in enumerate(list(el)):
            if local(ch.tag) in SKIP_TAGS:
                continue
            units = []
            for k, u in _units(ch, (idx, i)):
                m = _measure(doc, k)
                if m and bb_inter(m['bb'], R):
                    units.append(m)
            if units:
                bb = None
                for u in units:
                    bb = bb_union(bb, u['bb'])
                blocks.append({'units': units, 'bb': bb})
    if not blocks:
        return [], []
    # 쪽 머리 제목(다른 덩어리보다 훨씬 큰 글자 하나)은 항목이 아니다
    tops = sorted(max(u['fs'] for u in b['units']) for b in blocks)
    med = tops[len(tops) // 2]
    for b in blocks:
        b['heading'] = len(blocks) >= 3 and len(b['units']) == 1 and max(u['fs'] for u in b['units']) >= 1.6 * med
    cx0 = (art_bb[0] + art_bb[2]) / 2
    cy0 = (art_bb[1] + art_bb[3]) / 2
    size = min(art_bb[2] - art_bb[0], art_bb[3] - art_bb[1])
    slots, notes = [], []
    for b in blocks:
        us = sorted(b['units'], key=lambda u: (u['bb'][1], u['bb'][0]))
        bx, by = (b['bb'][0] + b['bb'][2]) / 2, (b['bb'][1] + b['bb'][3]) / 2
        b['center'] = kind in RADIAL and math.hypot(bx - cx0, by - cy0) <= 0.14 * size
        b['number'] = len(us) == 1 and us[0]['lines'] == 1 and us[0]['glyphs'] <= 3
        al = _align_of([(u['bb'][0], u['bb'][2]) for u in us])
        top = max(u['fs'] for u in us)
        for u in us:
            ua = _align_of([(lb[0], lb[2]) for lb in u['lbbs']]) or al or ('center' if b['center'] or b['number'] else 'left')
            if b['heading']:
                role = 'heading'
            elif b['center']:
                role = 'center'
            elif b['number']:
                role = 'number'
            elif u['lines'] >= 2:
                role = 'desc'
            elif u['fs'] >= top * 0.97 and not any(s.get('_b') is b and s['role'] == 'title' for s in slots):
                role = 'title'
            else:
                role = 'sub' if u['fs'] < top * 0.97 else 'desc'
            slots.append({'_b': b, 'bb': u['bb'], 'role': role, 'lines': u['lines'], 'fs': u['fs'], 'lh': u['lh'],
                          'align': ua, 'glyphs': u['glyphs'], 'color': u['color']})
        # 한 줄 제목·머리글은 덩어리 폭까지 넓힌다(원래 영문 자리 표시보다 긴 한글이 들어간다) — 정렬 기준은 그대로
        bx0, bx1 = b['bb'][0], b['bb'][2]
        for sl in slots:
            if sl.get('_b') is not b or sl['role'] not in ('title', 'sub') or sl['lines'] != 1:
                continue
            x0, y0, x1, y1 = sl['bb']
            if sl['align'] == 'left':
                sl['bb'] = [x0, y0, max(x1, bx1), y1]
            elif sl['align'] == 'right':
                sl['bb'] = [min(x0, bx0), y0, x1, y1]
            else:
                half = max((x1 - x0) / 2, (x0 + x1) / 2 - bx0, bx1 - (x0 + x1) / 2)
                sl['bb'] = [(x0 + x1) / 2 - half, y0, (x0 + x1) / 2 + half, y1]
    # 중심 덩어리는 한 자리로 합친다(중심 이름 + 보조 줄)
    cen = [s for s in slots if s['role'] == 'center']
    if len(cen) > 1:
        bb = None
        for s in cen:
            bb = bb_union(bb, s['bb'])
        merged = dict(cen[0], bb=bb, lines=sum(s['lines'] for s in cen), fs=max(s['fs'] for s in cen), align='center')
        slots = [s for s in slots if s['role'] != 'center'] + [merged]
    # 항목 순서 — 방사형은 위에서 시계 방향, 흐름형은 왼쪽부터, 나머지는 줄(높이 15%) 단위 읽기 순서.
    # 중심 없이 네 귀퉁이에 놓인 방사형(2×2)은 읽기 순서(왼쪽 위 → 오른쪽 위 → 왼쪽 아래 → 오른쪽 아래)가 자연스럽다
    items = [b for b in blocks if not b['center'] and not b['heading'] and not b['number']]
    grid2 = False
    if kind in RADIAL and len(items) == 4 and not any(b['center'] for b in blocks):
        xs = [(b['bb'][0] + b['bb'][2]) / 2 for b in items]
        ys = [(b['bb'][1] + b['bb'][3]) / 2 for b in items]
        grid2 = sum(1 for v in xs if v < cx0) == 2 and sum(1 for v in ys if v < cy0) == 2 and             len({(x < cx0, y < cy0) for x, y in zip(xs, ys)}) == 4

    def order_key(b):
        x, y = (b['bb'][0] + b['bb'][2]) / 2, (b['bb'][1] + b['bb'][3]) / 2
        if grid2:
            return (y >= cy0, x >= cx0)
        if kind in RADIAL:
            return ((math.degrees(math.atan2(y - cy0, x - cx0)) + 90) % 360, 0)
        if kind in LINEAR:
            return (x, y)
        band = 0.15 * (art_bb[3] - art_bb[1]) or 1
        return (round(y / band), x)

    for flag in (False, True):  # 글 덩어리, 번호 덩어리 따로 번호를 매긴다(같은 순서면 n 번째끼리 같은 항목)
        group = sorted([b for b in blocks if not b['center'] and not b['heading'] and b['number'] == flag], key=order_key)
        for n, b in enumerate(group, 1):
            b['item'] = n
    n_text = len([b for b in blocks if not b['center'] and not b['heading'] and not b['number']])
    n_num = len([b for b in blocks if not b['center'] and not b['heading'] and b['number']])
    if n_num and n_text and n_num != n_text:
        notes.append('번호 자리 %d개와 글 덩어리 %d개 수가 달라 항목 짝이 어긋날 수 있음' % (n_num, n_text))
    for s in slots:
        s['item'] = 0 if s['role'] in ('center', 'heading') else s['_b'].get('item', 0)
        del s['_b']
    slots.sort(key=lambda s: (s['item'] or 99, ROLE_ORDER.index(s['role']), s['bb'][1]))
    return slots, notes


ROLE_ORDER = ['title', 'sub', 'number', 'desc', 'center', 'heading']


def placeholder_bars(doc, R, skip_keys):
    """설명 자리 표시 막대(회색 가는 줄 여러 개 — lorem 대신 그린 선) → (덩어리 목록, 지울 요소 키)."""
    H = R[3] - R[1]
    bars = []
    for p in doc.prims:
        if p['key'][0] in skip_keys or p['k'] != 'path' or not bb_inter(p['bb'], R):
            continue
        w, h = p['bb'][2] - p['bb'][0], p['bb'][3] - p['bb'][1]
        col = p.get('fill') if p.get('fill') is not None else p.get('stroke')
        if col is None or h <= 0 or h > 0.02 * H or w < 8 * h or p['nc'] > 8:
            continue
        if not is_neutral(col, 0.2):
            continue
        if 0.5 <= rgb_hls(col)[1] <= 0.97:
            bars.append(p)
    bars.sort(key=lambda p: (p['bb'][1], p['bb'][0]))
    blocks = []
    for p in bars:
        bb = p['bb']
        h = bb[3] - bb[1]
        for b in blocks:
            g = b['bb']
            gap = bb[1] - g[3]
            if -h <= gap <= 3.5 * max(h, b['h']) and min(g[2], bb[2]) - max(g[0], bb[0]) > 0.3 * (bb[2] - bb[0]):
                b['bb'] = bb_union(g, bb)
                b['n'] += 1
                b['keys'].append(p['key'])
                break
        else:
            blocks.append({'bb': list(bb), 'h': h, 'n': 1, 'keys': [p['key']]})
    blocks = [b for b in blocks if b['n'] >= 2 and b['bb'][2] - b['bb'][0] >= 0.06 * (R[2] - R[0])]
    return blocks, {k for b in blocks for k in b['keys']}


def _el_at(root, key):
    el = root
    try:
        for i in key:
            el = list(el)[i]
    except IndexError:
        return None
    return el


def fallback_slots(doc, R):
    """글자 레이어가 없는 파일 — 휴리스틱(am_analyze.text_lines)으로 윤곽선 글자 줄을 찾는다. (자리, 지울 요소 키)"""
    from am_analyze import select, text_blocks, text_lines
    prims = select(doc.prims, R)
    lines = text_lines(prims, max(R[2] - R[0], R[3] - R[1]))
    keys = {prims[i]['key'] for ln in lines for i in ln['idx']}
    slots = []
    for b in text_blocks(lines):
        h = (b['bb'][3] - b['bb'][1]) / max(1, b['n'])
        slots.append({'bb': b['bb'], 'role': 'desc' if b['n'] >= 2 else 'title', 'lines': b['n'], 'fs': h / 1.1,
                      'lh': 1.3, 'align': 'left', 'glyphs': 0, 'item': 0})
    return slots, keys


# ---------- 색 ----------

def _iter_color(el, skip=False):
    s = skip or local(el.tag) in NO_RECOLOR
    yield el, s
    for ch in el:
        yield from _iter_color(ch, s)


def _color_values(el):
    for a in COLOR_ATTRS:
        v = el.get(a)
        if v and parse_color(v) is not None:
            yield v
    st = el.get('style')
    if st:
        for part in st.split(';'):
            if ':' in part:
                k, v = part.split(':', 1)
                if k.strip() in COLOR_ATTRS and parse_color(v.strip()) is not None:
                    yield v.strip()


def palette_vars(root, doc):
    """색 → CSS 변수. 쓰임(면적·횟수) 큰 색부터 c1, c2 … 유채색은 색상 무리 순위(group)와 무리 안 밝기 차(shade)."""
    count = {}
    for el, skip in _iter_color(root):
        if skip:
            continue
        for v in _color_values(el):
            h = rgb_to_hex(parse_color(v))
            count[h] = count.get(h, 0) + 1
    area = {}
    for p in doc.prims:
        w, h = p['bb'][2] - p['bb'][0], p['bb'][3] - p['bb'][1]
        if p.get('fill') is not None:
            k = rgb_to_hex(p['fill'])
            area[k] = area.get(k, 0.0) + w * h
        if p.get('stroke') is not None:
            k = rgb_to_hex(p['stroke'])
            area[k] = area.get(k, 0.0) + 0.1 * w * h
    tot = sum(area.values()) or 1.0
    use = {h: n + 1000.0 * area.get(h, 0.0) / tot for h, n in count.items()}
    order = sorted(use, key=lambda h: -use[h])
    # 거의 같은 색(블렌드·흐림을 풀어 생긴 미세한 단계)은 많이 쓴 색 하나로 묶는다
    alias, reps = {}, []
    for h in order:
        rgb = hex_to_rgb(h)
        hit = next((r for r in reps if sum((a - b) ** 2 for a, b in zip(rgb, hex_to_rgb(r))) ** 0.5 < 12), None)
        if hit:
            alias[h] = hit
            use[hit] += use[h]
        else:
            reps.append(h)
    order = reps
    clusters = []
    for h in order:
        rgb = hex_to_rgb(h)
        if is_neutral(rgb, 0.2):
            continue
        hh, ll, _ = rgb_hls(rgb)
        for c in clusters:
            d = abs(c['h'] - hh) % 1.0
            if min(d, 1.0 - d) < 0.04:
                c['m'].append(h)
                c['n'] += use[h]
                break
        else:
            clusters.append({'h': hh, 'm': [h], 'n': use[h]})
    clusters.sort(key=lambda c: -c['n'])
    group_of, shade_of = {}, {}
    for g, c in enumerate(clusters):
        ls = sorted(rgb_hls(hex_to_rgb(h))[1] for h in c['m'])
        ref = ls[len(ls) // 2]
        for h in c['m']:
            group_of[h] = g
            shade_of[h] = round(max(-1.0, min(1.0, (rgb_hls(hex_to_rgb(h))[1] - ref) / 0.5)), 3)
    pal = []
    for i, h in enumerate(order, 1):
        _, ll, _ = rgb_hls(hex_to_rgb(h))
        ent = {'v': 'c%d' % i, 'hex': h, 'use': round(use[h] / (sum(use.values()) or 1), 4), 'l': round(ll, 3)}
        if h in group_of:
            ent['group'] = group_of[h]
            ent['shade'] = shade_of[h]
        else:
            ent['neutral'] = True
        pal.append(ent)
    for h, r in alias.items():
        pal.append({'v': next(p['v'] for p in pal if p['hex'] == r), 'hex': h, 'alias': r})
    return pal


def apply_vars(root, pal):
    var = {p['hex']: (p['v'], p.get('alias', p['hex'])) for p in pal}

    def sub(v):
        rgb = parse_color(v.strip())
        if rgb is None:
            return None
        h = rgb_to_hex(rgb)
        return 'var(--il-%s,%s)' % var[h] if h in var else None

    for el, skip in _iter_color(root):
        if skip:
            continue
        decl = []
        st = el.get('style')
        if st:
            for part in st.split(';'):
                if ':' not in part:
                    continue
                k, v = part.split(':', 1)
                k = k.strip()
                r = sub(v) if k in COLOR_ATTRS else None
                decl.append('%s:%s' % (k, r if r else v.strip()))
        for a in COLOR_ATTRS:
            v = el.get(a)
            r = sub(v) if v else None
            if r:
                del el.attrib[a]
                decl.append('%s:%s' % (a, r))
        if decl:
            el.set('style', ';'.join(decl))


# ---------- 정리 ----------

def _refs_of(el):
    out = set()
    for e in el.iter():
        for k, v in e.attrib.items():
            if k in (HREF, 'href') and v.startswith('#'):
                out.add(v[1:])
            elif 'url(#' in v:
                out.update(re.findall(r'url\(#([^)]+)\)', v))
    return out


def tidy_ids(root):
    """참조되지 않는 id 를 지우고, 참조되는 id 는 짧게(d1, d2 …) 바꾼다."""
    refs = _refs_of(root)
    ren = {}
    for e in root.iter():
        i = e.get('id')
        if i is None:
            continue
        if i in refs:
            ren[i] = 'd%d' % (len(ren) + 1)
            e.set('id', ren[i])
        else:
            del e.attrib['id']
    for e in root.iter():
        for k, v in list(e.attrib.items()):
            if k in (HREF, 'href') and v.startswith('#') and v[1:] in ren:
                e.set(k, '#' + ren[v[1:]])
            elif 'url(#' in v:
                e.set(k, re.sub(r'url\(#([^)]+)\)', lambda m: 'url(#%s)' % ren.get(m.group(1), m.group(1)), v))


def strip_effects(root):
    """평면화(디자인 시스템: 그림자·흐림 없음) — 래스터 이미지와 필터·마스크를 쓰는 요소를 지운다. 지운 수."""
    n = 0
    for p in list(root.iter()):
        for ch in list(p):
            t = local(ch.tag)
            if t == 'image' or (t not in ('mask', 'filter', 'clipPath', 'defs') and (ch.get('filter') or ch.get('mask'))):
                p.remove(ch)
                n += 1
    for p in list(root.iter()):
        for ch in list(p):
            if local(ch.tag) in ('mask', 'filter'):
                p.remove(ch)
    return n


def _parents(root):
    return {c: p for p in root.iter() for c in p}


# ---------- 영역 하나 ----------

def export_region(reg, review, svg_in, out_dir, opts, log):
    rid = reg['id']
    rv = review
    kind = rv.get('type') or reg['features'].get('auto', {}).get('type') or 'Process'
    doc = SvgDoc(svg_in)
    # 쪽 PDF(매처 좌표) ↔ Illustrator SVG 좌표 배율
    pw, ph = reg['page_size']
    sx, sy = doc.W / pw if pw else 1.0, doc.H / ph if ph else 1.0
    R = [reg['region'][0] * sx, reg['region'][1] * sy, reg['region'][2] * sx, reg['region'][3] * sy]
    R0 = list(R)
    if rv.get('crop'):  # review.json 의 crop = 영역 안 비율 상자 [x0, y0, x1, y1] — 장식만 있는 가장자리를 덜어낸다
        c = rv['crop']
        Rw, Rh = R[2] - R[0], R[3] - R[1]
        R = [R[0] + c[0] * Rw, R[1] + c[1] * Rh, R[0] + c[2] * Rw, R[1] + c[3] * Rh]
    root = doc.root
    layers = [(i, ch) for i, ch in enumerate(list(root)) if local(ch.tag) == 'g']
    keep_names = {n.lower() for n in rv.get('keep_layers', [])}
    text_names = {n.lower() for n in rv.get('text_layers', [])}
    drop_names = {n.lower() for n in rv.get('drop_layers', [])}

    def lname(ch):
        return layer_name(ch.get('id', '')).lower()

    text_layers = [(i, ch) for i, ch in layers if lname(ch) not in keep_names and (TEXT_LAYER.match(lname(ch)) or lname(ch) in text_names)]
    drop = [ch for _, ch in layers if lname(ch) not in keep_names and (BG_LAYER.match(lname(ch)) or lname(ch) in drop_names)]
    text_keys = {i for i, _ in text_layers}
    art = [p for p in doc.prims if p['key'][0] not in text_keys and bb_inter(p['bb'], R)
           and not any(p['key'][0] == i for i, ch in layers if ch in drop)]
    art_bb = None
    for p in art:
        art_bb = bb_union(art_bb, bb_inter(p['bb'], R))
    art_bb = art_bb or R
    notes = []
    if text_layers:
        slots, n2 = text_slots(doc, text_layers, R, kind, art_bb)
        notes += n2
        fallback_keys = set()
    else:
        slots, fallback_keys = fallback_slots(doc, R)
        notes.append('글자 레이어가 없어 윤곽선 글자를 추정으로 찾음 — 자리를 관리 화면에서 확인')
    # 설명 자리 표시 막대 → 설명 자리(가장 가까운 제목의 항목)
    bar_blocks, bar_keys = placeholder_bars(doc, R, text_keys | {i for i, ch in layers if ch in drop})
    for b in bar_blocks:
        bx, by = (b['bb'][0] + b['bb'][2]) / 2, (b['bb'][1] + b['bb'][3]) / 2
        near = min((s for s in slots if s['role'] == 'title'), default=None,
                   key=lambda s: math.hypot((s['bb'][0] + s['bb'][2]) / 2 - bx, (s['bb'][1] + s['bb'][3]) / 2 - by))
        slots.append({'bb': b['bb'], 'role': 'desc', 'lines': b['n'], 'fs': b['h'] * 4.0, 'lh': 1.4,
                      'align': near['align'] if near else 'left', 'glyphs': 0, 'item': near['item'] if near else 0})
    if bar_blocks:
        slots.sort(key=lambda s: (s['item'] or 99, ROLE_ORDER.index(s['role']), s['bb'][1]))
        notes.append('설명 자리 표시 막대 %d묶음을 설명 자리로 바꿈' % len(bar_blocks))
    # 글자 자리 아래 도형 색(그리는 순서상 맨 위 채움) — 앱이 바꿔 칠한 뒤 글자 대비를 잰다
    drop_idx = {i for i, ch in layers if ch in drop}
    under = [p for p in doc.prims if p['key'][0] not in text_keys and p['key'][0] not in drop_idx and p['key'] not in bar_keys
             and (p.get('fill') is not None or p.get('fill_url')) and not p.get('masked') and bb_inter(p['bb'], R)]
    for sl in slots:
        cx, cy = (sl['bb'][0] + sl['bb'][2]) / 2, (sl['bb'][1] + sl['bb'][3]) / 2
        hit = None
        for p in under:
            b = p['bb']
            if b[0] <= cx <= b[2] and b[1] <= cy <= b[3]:
                hit = p
        if hit is not None and hit.get('fill') is not None and not hit.get('fill_url'):  # 그라데이션 위면 모른다
            sl['bg'] = rgb_to_hex(hit['fill'])
    parent = _parents(root)
    remove = [ch for _, ch in text_layers] + drop
    for k in fallback_keys | bar_keys:  # 키 → 요소(최상위부터 순번으로 내려간다)
        el = _el_at(root, k)
        if el is not None and el is not root:
            remove.append(el)
    # 영역 가장자리에 걸쳐 절반 넘게 밖에 있는 도형(옆 그림·배경 장식의 잘린 조각)과 review.json drop_boxes(원래 영역 비율 상자) 안 도형은 지운다
    W0, H0 = R0[2] - R0[0], R0[3] - R0[1]
    boxes = [[R0[0] + d[0] * W0, R0[1] + d[1] * H0, R0[0] + d[2] * W0, R0[1] + d[3] * H0] for d in rv.get('drop_boxes', [])]
    n_edge = 0
    for p in doc.prims:
        b = p['bb']
        area = (b[2] - b[0]) * (b[3] - b[1])
        hit = bb_inter(b, R)
        if hit is None or p['key'][0] in text_keys:
            continue
        cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
        boxed = any(x0 <= cx <= x1 and y0 <= cy <= y1 for x0, y0, x1, y1 in boxes)
        if boxed or (area > 0 and (hit[2] - hit[0]) * (hit[3] - hit[1]) < 0.5 * area):
            el = _el_at(root, p['key'])
            if el is not None and el is not root and el not in remove:
                remove.append(el)
                n_edge += 1
    if n_edge:
        notes.append('가장자리 조각 %d개를 지움' % n_edge)
    _prune(root, (), doc.elem_bb, R)
    for el in remove:
        p = parent.get(el)
        if p is not None and el in list(p):
            p.remove(el)
    n_fx = 0 if opts.get('keep_effects') or rv.get('keep_effects') else strip_effects(root)
    _prune_defs(root)
    for k in ('x', 'y', 'enable-background', '{http://www.w3.org/XML/1998/namespace}space', 'version', 'style'):
        root.attrib.pop(k, None)
    tmp = os.path.join(out_dir, '_tmp.svg')
    os.makedirs(out_dir, exist_ok=True)
    ET.ElementTree(root).write(tmp, encoding='utf-8', xml_declaration=False)
    # 남은 그림의 실제 범위 + 글자 자리로 viewBox 를 조인다
    doc2 = SvgDoc(tmp)
    vb = None
    for p in doc2.prims:
        b = bb_inter(p['bb'], R)
        if b:
            vb = bb_union(vb, b)
    for s in slots:
        vb = bb_union(vb, s['bb'])
    vb = vb or R
    m = 0.01 * max(vb[2] - vb[0], vb[3] - vb[1])
    vb = [max(R[0], vb[0] - m), max(R[1], vb[1] - m), min(R[2], vb[2] + m), min(R[3], vb[3] + m)]
    W, H = vb[2] - vb[0], vb[3] - vb[1]
    # 판 배경(밝은 무채색 큰 면) — 쪽 바탕이 비치도록 지운다
    n_bg = 0
    par_of = _parents(root)
    for p in doc2.prims:
        b = bb_inter(p['bb'], vb)
        col = p.get('fill')
        if b and col is not None and is_neutral(col, 0.2) and rgb_hls(col)[1] >= 0.9 and \
                (b[2] - b[0]) * (b[3] - b[1]) >= 0.5 * W * H:
            el = _el_at(root, p['key'])
            par = par_of.get(el) if el is not None else None
            if par is not None and el in list(par):
                par.remove(el)
                n_bg += 1
    if n_bg:
        notes.append('판 배경 %d개를 지움' % n_bg)
    pal = palette_vars(root, doc2)
    apply_vars(root, pal)
    tidy_ids(root)
    root.set('viewBox', '%.2f %.2f %.2f %.2f' % (vb[0], vb[1], W, H))
    root.set('width', '%.2f' % W)
    root.set('height', '%.2f' % H)
    os.remove(tmp)
    svg_path = os.path.join(out_dir, 'illust.svg')
    body = ET.tostring(root, encoding='unicode')
    body = re.sub(r'>\s+<', '><', body)
    with open(svg_path, 'w', encoding='utf-8') as f:
        f.write(body)
    size = os.path.getsize(svg_path)
    if size > MAX_SVG_BYTES:
        notes.append('SVG %.1fMB — 앱 상한(3MB)을 넘어 올라가지 않음' % (size / 1048576))
    out_slots = []
    for n, s in enumerate(slots, 1):
        b = s['bb']
        out_slots.append({
            'id': 's%d' % n, 'role': s['role'], 'item': s['item'],
            'x': round((b[0] - vb[0]) / W, 4), 'y': round((b[1] - vb[1]) / H, 4),
            'w': round((b[2] - b[0]) / W, 4), 'h': round((b[3] - b[1]) / H, 4),
            'lines': s['lines'], 'fs': round(s['fs'] / W, 5), 'lh': round(s['lh'], 2), 'align': s['align'],
            **({'color': s['color']} if s.get('color') else {}),
            **({'bg': s['bg']} if s.get('bg') else {}),
        })
    return {
        'svg_bytes': size, 'view': [round(W, 2), round(H, 2)], 'slots': out_slots, 'palette': pal,
        'effects_removed': n_fx, 'notes': notes,
    }


def _license(slug, ent):
    m = re.match(r'as-(\d+)$', slug)
    if m:
        return {'provider': 'Adobe Stock', 'stockId': m.group(1), 'license': 'Standard',
                'url': 'https://stock.adobe.com/images/id/%s' % m.group(1), 'file': ent.get('rel')}
    return {'provider': '보유 파일', 'stockId': '', 'license': '', 'file': ent.get('rel')}


def run_export(work, out, only, min_quality, keep_effects, no_illustrator, force, log):
    from am_report import svg_png
    man = read_json(os.path.join(work, 'manifest.json'))
    ana = read_json(os.path.join(work, 'analysis.json'), {'regions': []})
    review = read_json(os.path.join(work, 'review.json'), {})
    matches = read_json(os.path.join(work, 'matches.json'), {'items': []})
    fits = {}
    for it in matches.get('items', []):
        for c in it.get('candidates', []):
            fits.setdefault(c['id'], []).append({'item': it['id'], 'page': it['page'], 'title': it.get('title'),
                                                 'score': c.get('score'), 'fit': c.get('fit')})
    chosen = []
    for reg in ana['regions']:
        rv = dict(review.get(reg['slug'], {}))
        rv.update(review.get(reg['id'], {}))
        if rv.get('exclude') or not rv.get('type'):
            continue
        if only and reg['id'] not in only and reg['slug'] not in only:
            continue
        if not only and (rv.get('quality') or 0) < min_quality:
            continue
        chosen.append((reg, rv))
    if not chosen:
        log('export: 내보낼 영역이 없습니다(review.json 판정·--only 확인)')
        return
    slugs = sorted({reg['slug'] for reg, _ in chosen})
    if not no_illustrator:
        illustrator_svgs(work, man, slugs, force, log)
    os.makedirs(out, exist_ok=True)
    profile = os.path.join(work, '_jobs', 'edge-profile')
    index = read_json(os.path.join(out, 'index.json'), {'items': []})
    done = {i['key']: i for i in index['items']}
    for reg, rv in chosen:
        key = reg['id'].replace('/', '__')
        svg_in = os.path.join(work, 'aisvg', reg['slug'], 'ab%02d.svg' % reg['page'])
        if not os.path.exists(svg_in):
            log('export: %s — Illustrator SVG 없음(건너뜀)' % reg['id'])
            continue
        d = os.path.join(out, key)
        res = export_region(reg, rv, svg_in, d, {'keep_effects': keep_effects}, log)
        W, H = res['view']
        tw = 480
        th = max(120, min(480, int(round(tw * H / W))))
        svg_png(os.path.join(d, 'illust.svg'), os.path.join(d, 'thumb.png'), profile, tw, th)
        ent = man['assets'][reg['slug']]
        meta = {
            'v': 1, 'key': reg['id'], 'title': rv.get('title') or '%s %s' % (ent['name'], reg['id'].split('/', 1)[1]),
            'type': TYPE_KEYS.get(rv['type'], 'process'), 'matcherType': rv['type'],
            'count': rv.get('count'), 'center': bool(rv.get('center')), 'loop': bool(rv.get('loop')),
            'quality': rv.get('quality'), 'note': rv.get('note', ''), 'alt': [TYPE_KEYS.get(t) for t in rv.get('alt', []) if TYPE_KEYS.get(t)],
            'view': res['view'], 'slots': res['slots'], 'palette': [p for p in res['palette'] if 'alias' not in p],
            'license': _license(reg['slug'], ent), 'fits': fits.get(reg['id'], [])[:6],
            'source': {'slug': reg['slug'], 'name': ent['name'], 'artboard': reg['page'], 'regionPt': reg['region']},
            'effectsRemoved': res['effects_removed'], 'warnings': res['notes'],
        }
        write_json(os.path.join(d, 'meta.json'), meta)
        done[key] = {'key': key, 'id': reg['id'], 'title': meta['title'], 'type': meta['type'], 'count': meta['count'],
                     'slots': len(res['slots']), 'svgBytes': res['svg_bytes']}
        log('export: %s → %s · 자리 %d · %.0fKB%s' % (reg['id'], meta['type'], len(res['slots']), res['svg_bytes'] / 1024,
                                                      (' · ' + '; '.join(res['notes'])) if res['notes'] else ''))
    write_json(os.path.join(out, 'index.json'), {'v': 1, 'items': sorted(done.values(), key=lambda i: i['key'])})
    log('export: %d개 → %s (관리 화면 [일러스트 가져오기]에서 이 폴더를 고릅니다)' % (len(chosen), out))
