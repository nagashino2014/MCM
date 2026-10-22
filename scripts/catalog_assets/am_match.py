"""분석 결과(+ 시각 판정 review.json)를 소개서 항목(catalog_items.json)과 맞춰 적합도를 매긴다.

review.json 형식(키 = 영역 id 'slug/ab01/r1' 또는 slug 전체):
  {"as-123/ab01/r1": {"type": "Hub", "count": 5, "center": true, "loop": false, "quality": 4,
                      "alt": ["Cycle"], "note": "판정 근거", "exclude": false}}
quality 1~5(디자인 품질·재사용 쉬움), exclude = 인포그래픽 아님(로고·배경 등).
"""
import os

from am_common import TYPE_KO, read_json, write_json


def effective(r, review):
    f = r['features']
    auto = f['auto']
    ov = {}
    ov.update(review.get(r['slug'], {}))
    ov.update(review.get(r['id'], {}))
    typ = ov.get('type', auto['type'])
    visual = 'type' in ov
    return {
        'type': typ,
        'alt': ov.get('alt', [t for t, _ in auto.get('alt', [])]),
        'count': ov.get('count', auto.get('count')),
        'center': ov.get('center', f.get('center', False)),
        'loop': ov.get('loop', bool(auto.get('loop')) or typ == 'Cycle'),
        'conf': 1.0 if visual else (auto.get('score') or 0.0),
        'source': 'visual' if visual else 'auto',
        'quality': ov.get('quality'),
        'exclude': bool(ov.get('exclude', False) or (f.get('text_only') and not visual)),
        'note': ov.get('note', ''),
        'style': f['style']['score'],
        'style_pen': f['style']['penalties'],
        'reasons': auto.get('reasons', []),
    }


def count_fit(c, want):
    lo, hi = (want, want) if isinstance(want, int) else (want[0], want[1])
    if c is None:
        return 0.4, '항목 수 미상'
    if lo <= c <= hi:
        return 1.0, '항목 수 %d = 필요 %s' % (c, _want(want))
    d = lo - c if c < lo else c - hi
    v = {1: 0.65, 2: 0.35}.get(d, 0.1)
    return v, '항목 수 %d(필요 %s, %s %d)' % (c, _want(want), '부족' if c < lo else '초과', d)


def _want(w):
    return str(w) if isinstance(w, int) else '%d~%d' % (w[0], w[1])


def score(e, item):
    tw = item['types'].get(e['type'], 0.0)
    why = []
    if tw:
        why.append('%s(%s) 유형%s' % (TYPE_KO.get(e['type'], e['type']), e['type'], ' — 1순위' if tw >= 1.0 else ' — 대체 %.2f' % tw))
    for t in e['alt'] or []:
        v = item['types'].get(t, 0.0) * 0.7
        if v > tw:
            tw = v
            why = ['다른 판정 %s(%s)로 대체 가능' % (TYPE_KO.get(t, t), t)]
    if tw <= 0:
        return None
    cf, cw = count_fit(e['count'], item['count'])
    why.append(cw)
    ex = 0.0
    if item.get('center'):
        ex += 0.1 if e['center'] else -0.1
        why.append('중심 요소 있음' if e['center'] else '중심 요소 없음')
    if item.get('loop') and e['loop']:
        ex += 0.08
        why.append('되돌이·순환 표현 있음')
    st = (e['style'] - 0.7) * 0.2
    if e['style_pen']:
        why.append('감점: ' + ', '.join(e['style_pen']))
    s = 0.55 * tw + 0.25 * cf + ex + st + 0.15
    s *= 0.65 + 0.35 * e['conf']
    # 디자인 품질(시각 판정 1~5)은 곱으로: 5 → 1.0, 2 → 0.85. 판정 없으면 0.9
    s *= (0.75 + 0.05 * e['quality']) if e['quality'] else 0.9
    if e['quality'] and e['quality'] <= 2:
        why.append('품질 %d/5(스타일 오래됨·효과 많음)' % e['quality'])
    raw = s
    # 항목 수가 다르면 요소 복제·삭제 손질이, 품질 2 이하면 다시 그리기가 필요하므로 '상'(0.85)에 닿지 않게 한다(정렬은 raw 로)
    full = cf >= 1.0 and not (e['quality'] and e['quality'] <= 2)
    s = max(0.0, min(1.0 if full else 0.84, s))
    fit = '상' if s >= 0.85 else ('중' if s >= 0.65 else '하')
    return round(s, 3), fit, why, raw


def run_match(work, items_path, review_path, out):
    ana = read_json(os.path.join(work, 'analysis.json'))
    items = read_json(items_path)['items']
    review = read_json(review_path or os.path.join(work, 'review.json'), {}) or {}
    review = {k: v for k, v in review.items() if not k.startswith('_')}
    eff = {r['id']: effective(r, review) for r in ana['regions']}
    res_items, by_region = [], {}
    for it in items:
        cands = []
        for r in ana['regions']:
            e = eff[r['id']]
            if e['exclude'] or not e['type']:
                continue
            sc = score(e, it)
            if sc is None:
                continue
            s, fit, why, raw = sc
            cands.append({'id': r['id'], 'score': s, 'fit': fit, 'why': why, 'raw': round(raw, 3), 'q': e['quality'] or 3})
            by_region.setdefault(r['id'], []).append({'item': it['id'], 'score': s, 'fit': fit, 'raw': round(raw, 3)})
        cands.sort(key=lambda c: (-c['score'], -c['q'], -c['raw']))  # 같은 점수(상한)면 품질 높은 것부터
        res_items.append(dict(it, candidates=cands[:8], n_candidates=len(cands)))
    for v in by_region.values():
        v.sort(key=lambda c: (-c['score'], -c['raw']))
    write_json(os.path.join(work, 'matches.json'), {'items': res_items, 'by_region': by_region, 'effective': eff})
    for it in res_items:
        top = it['candidates'][:3]
        out('match: %-16s %s' % (it['id'], ', '.join('%s %.2f(%s)' % (c['id'], c['score'], c['fit']) for c in top) or '후보 없음'))
