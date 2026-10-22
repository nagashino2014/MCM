"""추천 보고서(HTML 접촉 시트)를 만든다.

report.html          — 로컬에서 바로 여는 완전한 문서
report_artifact.html — 같은 내용(문서 껍데기 없이), claude.ai 아티팩트로 올릴 때 쓴다
recolor/*.svg        — 항목별 상위 후보를 항목 팔레트로 재채색·글자 제거한 미리보기
"""
import datetime
import html
import os
import subprocess
import time

from am_common import TYPE_KO, TYPES16, read_json, write_json
from am_recolor import recolor_file

E = html.escape
EDGE = os.environ.get('AM_EDGE', r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe')


def svg_png(svg, png, profile, w=480, h=360, timeout=60):
    """재채색 SVG 를 Edge 헤드리스로 작은 PNG 미리보기로 굽는다(무거운 SVG 를 보고서에 직접 싣지 않으려고).
    Edge 는 분리 실행되므로 PNG 가 생길 때까지 기다린다. 실패하면 False."""
    if not os.path.exists(EDGE):
        return False
    page = svg[:-4] + '.preview.html'
    with open(page, 'w', encoding='utf-8') as f:
        f.write('<!doctype html><html><body style="margin:0;background:#fff"><img src="%s" '
                'style="width:%dpx;height:%dpx;object-fit:contain;display:block"></body></html>' % (
                    os.path.basename(svg), w, h))
    if os.path.exists(png):
        os.remove(png)
    subprocess.run([EDGE, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--user-data-dir=' + profile,
                    '--screenshot=' + png, '--window-size=%d,%d' % (w, h),
                    'file:///' + os.path.abspath(page).replace(os.sep, '/')], capture_output=True, timeout=timeout)
    t0, last = time.time(), -1
    while time.time() - t0 < timeout:
        if os.path.exists(png):
            size = os.path.getsize(png)
            if size > 0 and size == last:
                break
            last = size
        time.sleep(0.5)
    time.sleep(0.5)
    try:
        os.remove(page)
    except OSError:
        pass
    return os.path.exists(png)

CSS = """
/* 배치: 도구형 접촉 시트 — 머리 요약 → 항목별 추천(우선순위 순) → 구매 후보 → 전체 시트 → 변환 기록 */
:root {
  --bg: #f3f5f8; --surface: #ffffff; --paper: #ffffff; --ink: #14233a; --muted: #5a6575; --faint: #8a94a3;
  --rule: #d8dde5; --accent: #102543; --accent-2: #0093b8; --leaf: #3a7614; --warn: #985000; --bad: #9b2f22;
  --chip: #e8edf4; --hi: #e1f1f6; --mid: #fbefdf; --lo: #efefef;
  --font-body: "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif;
  --font-data: "IBM Plex Mono", ui-monospace, Consolas, monospace;
  --r: 8px;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0f141b; --surface: #161d27; --paper: #f4f5f7; --ink: #e6ebf2; --muted: #a3adbb; --faint: #7d8796;
  --rule: #2b3442; --accent: #a9bde0; --accent-2: #39b3d4; --leaf: #95cf63; --warn: #f0a65a; --bad: #f08a7a;
  --chip: #212a37; --hi: #13303a; --mid: #3a2a17; --lo: #2a2a2b; color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #0f141b; --surface: #161d27; --paper: #f4f5f7; --ink: #e6ebf2; --muted: #a3adbb; --faint: #7d8796;
  --rule: #2b3442; --accent: #a9bde0; --accent-2: #39b3d4; --leaf: #95cf63; --warn: #f0a65a; --bad: #f08a7a;
  --chip: #212a37; --hi: #13303a; --mid: #3a2a17; --lo: #2a2a2b; color-scheme: dark; }
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--ink); font-family: var(--font-body); font-size: 14px; line-height: 1.55; margin: 0; }
.wrap { max-width: 1280px; margin: 0 auto; padding-block: 28px 64px;
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
h1 { font-size: 26px; margin: 0; letter-spacing: -0.01em; text-wrap: balance; }
h2 { font-size: 19px; margin: 0; text-wrap: balance; }
h3 { font-size: 15px; margin: 0; }
.lede { color: var(--muted); margin: 6px 0 0; max-width: 70ch; }
.mono { font-family: var(--font-data); font-size: 12px; }
.muted { color: var(--muted); }
header.top { display: grid; gap: 14px; border-bottom: 1px solid var(--rule); padding-bottom: 18px; }
.kpis { display: flex; flex-wrap: wrap; gap: 8px 22px; font-variant-numeric: tabular-nums; }
.kpis div { display: grid; }
.kpis b { font-size: 20px; color: var(--accent); }
.kpis span { font-size: 12px; color: var(--muted); }
nav.toc { display: flex; flex-wrap: wrap; gap: 6px; }
nav.toc a, .chip, button.chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: var(--r);
  background: var(--chip); color: var(--ink); text-decoration: none; font-size: 12.5px; border: 1px solid transparent; font-family: inherit; }
button.chip { cursor: pointer; }
button.chip[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); background: var(--surface); }
a { color: var(--accent-2); }
:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
section.block { display: grid; gap: 18px; margin-top: 34px; }
.item { background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r); padding: 16px; display: grid; gap: 12px; }
.item-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 12px; }
.page-tag { font-family: var(--font-data); font-size: 12px; color: var(--surface); background: var(--accent); padding: 1px 7px; border-radius: 6px; }
.want { display: flex; flex-wrap: wrap; gap: 6px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
.card { border: 1px solid var(--rule); border-radius: var(--r); display: grid; grid-template-rows: auto 1fr; overflow: hidden; background: var(--surface); min-width: 0; }
.card.dim { opacity: 0.55; }
.thumbs { display: grid; grid-template-columns: 1fr; background: var(--paper); border-bottom: 1px solid var(--rule); }
.thumbs.two { grid-template-columns: 1fr 1fr; gap: 1px; background: var(--rule); }
.thumbs figure { margin: 0; background: var(--paper); display: grid; }
.thumbs img { width: 100%; aspect-ratio: 4 / 3; object-fit: contain; padding: 6px; display: block; max-width: 100%; }
.thumbs figcaption { font-size: 11px; color: #5a6575; padding: 0 6px 4px; }
.body { padding: 10px 12px 12px; display: grid; gap: 6px; align-content: start; min-width: 0; }
.name { font-weight: 600; overflow-wrap: anywhere; }
.row { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; }
.fit { font-weight: 700; font-size: 12px; padding: 1px 8px; border-radius: 6px; font-variant-numeric: tabular-nums; }
.fit.상 { background: var(--hi); color: var(--accent-2); }
.fit.중 { background: var(--mid); color: var(--warn); }
.fit.하 { background: var(--lo); color: var(--muted); }
.type { font-size: 12px; font-weight: 600; color: var(--accent); }
.src { font-size: 11px; color: var(--faint); }
ul.why { margin: 0; padding-left: 16px; color: var(--muted); font-size: 12.5px; }
ul.why li { margin: 1px 0; }
.sw { display: inline-block; width: 14px; height: 14px; border-radius: 3px; border: 1px solid var(--rule); vertical-align: middle; }
.pen { color: var(--warn); font-size: 12px; }
.files { color: var(--faint); overflow-wrap: anywhere; }
.empty { color: var(--muted); font-size: 13px; }
.filters { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.filters input { font: inherit; padding: 4px 10px; border: 1px solid var(--rule); border-radius: var(--r); background: var(--surface); color: var(--ink); min-width: 0; width: 220px; max-width: 100%; }
.tablewrap { overflow-x: auto; border: 1px solid var(--rule); border-radius: var(--r); background: var(--surface); }
table { border-collapse: collapse; width: 100%; font-size: 13px; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--rule); vertical-align: top; }
th { color: var(--muted); font-weight: 600; font-size: 12px; }
.ok { color: var(--leaf); } .bad { color: var(--bad); }
.notes { display: grid; gap: 8px; max-width: 80ch; color: var(--muted); }
.notes p { margin: 0; }
.stock-thumb { width: 100%; aspect-ratio: 4 / 3; object-fit: contain; background: var(--paper); display: block; max-width: 100%; }
.ph { display: grid; place-items: center; aspect-ratio: 4 / 3; background: var(--paper); color: #5a6575; font-size: 12px; }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto; } }
"""

JS = """
(function () {
  var chips = document.querySelectorAll('[data-type-filter]');
  var q = document.getElementById('sheet-q');
  var cards = document.querySelectorAll('#sheet .card');
  var cur = 'all';
  function apply() {
    var s = (q && q.value || '').trim().toLowerCase();
    cards.forEach(function (c) {
      var okT = cur === 'all' || c.getAttribute('data-type') === cur;
      var okQ = !s || c.getAttribute('data-search').indexOf(s) >= 0;
      c.hidden = !(okT && okQ);
    });
  }
  chips.forEach(function (b) {
    b.addEventListener('click', function () {
      cur = b.getAttribute('data-type-filter');
      chips.forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      apply();
    });
  });
  if (q) q.addEventListener('input', apply);
  function swap(img) {
    var d = document.createElement('div'); d.className = 'ph'; d.textContent = '미리보기는 Adobe Stock 링크에서';
    img.replaceWith(d);
  }
  document.querySelectorAll('img[data-fallback]').forEach(function (img) {
    if (img.complete && img.naturalWidth === 0) { swap(img); return; }
    img.addEventListener('error', function () { swap(img); });
  });
})();
"""


def _type_label(t):
    return '%s · %s' % (t, TYPE_KO.get(t, '')) if t else '판정 없음'


def _safe(rid):
    return rid.replace('/', '_')


def build_report(work, stock_path, review_path, out, recolor_top=3, force_recolor=False):
    man = read_json(os.path.join(work, 'manifest.json'))
    ana = read_json(os.path.join(work, 'analysis.json'))
    mt = read_json(os.path.join(work, 'matches.json'))
    stock = read_json(stock_path) if stock_path else None
    regions = {r['id']: r for r in ana['regions']}
    eff = mt['effective']

    # 재채색 미리보기
    rec = {}
    rdir = os.path.join(work, 'recolor')
    os.makedirs(rdir, exist_ok=True)
    profile = os.path.join(work, '_jobs', 'edge-profile')
    cache_path = os.path.join(rdir, 'index.json')
    cache = read_json(cache_path, {}) or {}
    for it in mt['items']:
        for c in it['candidates'][:recolor_top]:
            r = regions[c['id']]
            src = os.path.join(work, r['files']['svg'])
            name = '%s__%s' % (it['id'], _safe(c['id']))
            png = os.path.join(rdir, name + '.png')
            if not force_recolor and name in cache and os.path.exists(png) and os.path.getmtime(png) >= os.path.getmtime(src):
                rec[(it['id'], c['id'])] = ('recolor/' + name + '.png', cache[name])
                continue
            st = {}
            try:
                recolor_file(src, os.path.join(rdir, name + '.svg'), palette=it.get('palette', 'ci'), strip=True, stats=st)
            except Exception as ex:  # 손상된 SVG 등은 미리보기만 건너뛴다
                out('report: 재채색 실패 %s — %s' % (c['id'], ex))
                continue
            png_ok = svg_png(os.path.join(rdir, name + '.svg'), png, profile)
            cap = 'KESI 색·글자 제거' if st.get('stripped') else 'KESI 색'
            rec[(it['id'], c['id'])] = ('recolor/' + name + ('.png' if png_ok else '.svg'), cap)
            if png_ok:
                cache[name] = cap
    write_json(cache_path, cache)

    assets = man['assets']
    n_files = len(assets)
    st = {}
    for e in assets.values():
        st[e['status']] = st.get(e['status'], 0) + 1
    n_pages = sum(len(e.get('pages', [])) for e in assets.values())
    n_ai = sum(1 for e in assets.values() if e['route'] == 'illustrator')
    live = [r for r in ana['regions'] if not eff[r['id']]['exclude']]
    tcount = {}
    for r in live:
        t = eff[r['id']]['type']
        tcount[t] = tcount.get(t, 0) + 1
    n_visual = sum(1 for r in ana['regions'] if eff[r['id']]['source'] == 'visual')

    P = []
    P.append('<div class="wrap">')
    P.append('<header class="top"><div><h1>KESI 스톡 일러스트 추천</h1>'
             '<p class="lede">회사가 산 Adobe Stock·자체 제작 AI 파일을 대지·그림 단위로 나누어 인포그래픽 16유형으로 판정하고, '
             '회사소개서 쪽마다 데이터 모양(항목 수·중심·되돌이)이 맞는 후보를 골랐습니다. 재채색 미리보기는 KESI 팔레트로 바꾸고 글자를 지운 모습입니다.</p>'
             '<p class="lede mono">원본: %s · 생성 %s</p></div>' % (E(man.get('source', '')), datetime.date.today().isoformat()))
    P.append('<div class="kpis">')
    for v, k in [(n_files, '파일'), (n_ai, 'Illustrator 변환'), (st.get('failed', 0) + st.get('unsupported', 0), '변환 실패'),
                 (n_pages, '대지'), (len(ana['regions']), '그림 영역'), (len(live), '추천 대상'), (n_visual, '시각 판정')]:
        P.append('<div><b>%d</b><span>%s</span></div>' % (v, k))
    P.append('</div><nav class="toc" aria-label="목차"><a href="#items">항목별 추천</a>')
    if stock:
        P.append('<a href="#stock">Adobe Stock 구매 후보</a>')
    P.append('<a href="#sheet">전체 접촉 시트</a><a href="#log">변환 기록</a><a href="#howto">읽는 법·한계</a></nav></header>')

    # 1. 항목별 추천
    P.append('<section class="block" id="items"><div><h2>항목별 추천</h2>'
             '<p class="lede">적합도 = 유형 일치 55% + 항목 수 25% + 중심·되돌이·품질·평면성 가감, 판정 확신도로 보정. 상 ≥ 0.85(항목 수까지 맞을 때만), 중 ≥ 0.65.</p></div>')
    for it in sorted(mt['items'], key=lambda i: (i.get('priority', 9), i['id'])):
        want = ''.join('<span class="chip">%s %s</span>' % (E(t), '1순위' if w >= 1 else '%.1f' % w)
                       for t, w in sorted(it['types'].items(), key=lambda kv: -kv[1]))
        cnt = it['count'] if isinstance(it['count'], int) else '%d~%d' % tuple(it['count'])
        P.append('<article class="item" id="item-%s"><div class="item-head"><span class="page-tag">%s</span><h3>%s</h3>'
                 '<span class="muted">%s · 항목 %s%s%s</span></div><div class="want">%s</div>' % (
                     E(it['id']), E(it['page']), E(it['title']), E(it['need']), cnt,
                     ' · 중심 필요' if it.get('center') else '', ' · 되돌이 필요' if it.get('loop') else '', want))
        cands = it['candidates'][:3]
        if not cands:
            P.append('<p class="empty">보유 에셋 중 맞는 후보가 없습니다. 아래 구매 후보를 보세요.</p>')
        else:
            P.append('<div class="grid">')
            for c in cands:
                r = regions[c['id']]
                e = eff[c['id']]
                rc = rec.get((it['id'], c['id']))
                thumbs = '<figure><img loading="lazy" src="%s" alt="%s 미리보기"><figcaption>원본</figcaption></figure>' % (
                    E(r['files']['thumb']), E(r['name']))
                if rc:
                    thumbs += '<figure><img loading="lazy" src="%s" alt="KESI 색 재채색"><figcaption>%s</figcaption></figure>' % (E(rc[0]), E(rc[1]))
                P.append('<div class="card"><div class="thumbs%s">%s</div><div class="body">'
                         '<div class="row"><span class="fit %s">%s %.2f</span><span class="type">%s</span>'
                         '<span class="src">%s</span></div><div class="name">%s</div><div class="mono muted">%s</div>'
                         '<ul class="why">%s</ul>%s</div></div>' % (
                             ' two' if rc else '', thumbs, c['fit'], c['fit'], c['score'], E(_type_label(e['type'])),
                             '시각 판정' if e['source'] == 'visual' else '자동 %.2f' % e['conf'],
                             E(r['name']), E(c['id']), ''.join('<li>%s</li>' % E(w) for w in c['why'][:4]),
                             '<div class="muted" style="font-size:12.5px">%s</div>' % E(e['note']) if e['note'] else ''))
            P.append('</div>')
            if it['n_candidates'] > 3:
                P.append('<p class="muted" style="margin:0;font-size:12.5px">그 밖의 후보 %d개는 접촉 시트에서 유형으로 거르면 볼 수 있습니다.</p>' % (it['n_candidates'] - 3))
        P.append('</article>')
    P.append('</section>')

    # 2. 구매 후보
    if stock:
        P.append('<section class="block" id="stock"><div><h2>Adobe Stock 구매 후보</h2><p class="lede">'
                 '보유 에셋으로 채우기 어려운 항목을 중심으로, Adobe Stock 상세 페이지에서 ID·작가·벡터(AI/EPS) 여부를 확인한 후보입니다. '
                 '이미 산 에셋과 같은 작가(PixMarket·AKrasov)를 우선해 스타일을 맞췄습니다. 판단은 워터마크 미리보기 기준이라 '
                 '레이어 구성과 글자 객체 여부는 내려받은 뒤 이 도구로 다시 분석해 확정합니다.</p></div>')
        titles = {i['id']: i['title'] for i in mt['items']}
        titles.setdefault('C09-esg', 'ESG·탄소중립(Scope 층위·로드맵)')
        titles['C08-hub6'] = '사업 분야 개관 · 중심 + 6분야 허브'
        titles['C08-hub'] = '사업 분야 개관 · 5갈래(6분야 확정 전 조사)'
        if stock.get('sets'):
            P.append('<article class="item"><div class="item-head"><span class="page-tag">SET</span><h3>한 스타일 묶음(여러 유형)</h3></div><div class="grid">')
            for s in stock['sets']:
                P.append(_stock_card(s, ' · '.join(titles.get(x, x) for x in s.get('covers_items', []))))
            P.append('</div></article>')
        order = {'C08-hub6': 0}
        for si in sorted(stock.get('items', []), key=lambda x: order.get(x['item_id'], 1)):
            if not si.get('candidates'):
                continue
            P.append('<article class="item"><div class="item-head"><span class="page-tag">%s</span><h3>%s</h3>'
                     '<span class="muted mono">%s</span></div><div class="grid">' % (
                         E(si['item_id'].split('-')[0]), E(titles.get(si['item_id'], si['item_id'])), E(' · '.join(si.get('queries', [])[:3]))))
            for c in si['candidates']:
                P.append(_stock_card(c))
            P.append('</div></article>')
        if stock.get('other_sources'):
            P.append('<article class="item"><h3>다른 인포그래픽 소스</h3><ul class="why">')
            for o in stock['other_sources']:
                P.append('<li><a href="%s" target="_blank" rel="noopener">%s</a> — %s</li>' % (E(o.get('url', '')), E(o.get('name', '')), E(o.get('note', ''))))
            P.append('</ul></article>')
        P.append('</section>')

    # 3. 전체 접촉 시트
    P.append('<section class="block" id="sheet"><div><h2>전체 접촉 시트</h2><p class="lede">영역마다 판정 유형·항목 수·주요 색·감점과 잘 맞는 항목 둘. '
             '흐린 카드는 인포그래픽이 아니라고 판정해 추천에서 뺀 것입니다. 파일 경로는 작업 폴더 기준입니다.</p></div>')
    P.append('<div class="filters"><button class="chip" type="button" data-type-filter="all" aria-pressed="true">전체 %d</button>' % len(ana['regions']))
    for t in TYPES16:
        if tcount.get(t):
            P.append('<button class="chip" type="button" data-type-filter="%s" aria-pressed="false">%s %d</button>' % (t, E(TYPE_KO[t]), tcount[t]))
    P.append('<label class="muted" for="sheet-q" style="margin-left:6px">찾기</label><input id="sheet-q" type="search" placeholder="파일 이름·ID"></div>')
    P.append('<div class="grid">')
    titles = {i['id']: i['title'] for i in mt['items']}
    for r in sorted(ana['regions'], key=lambda r: (eff[r['id']]['exclude'], r['id'])):
        e = eff[r['id']]
        f = r['features']
        best = mt['by_region'].get(r['id'], [])[:2]
        sw = ''.join('<span class="sw" style="background:%s" title="%s %d%%"></span>' % (E(h), E(h), int(p * 100)) for h, p in f['colors'][:6])
        P.append('<div class="card%s" data-type="%s" data-search="%s"><div class="thumbs"><figure><img loading="lazy" src="%s" alt="%s"></figure></div>'
                 '<div class="body"><div class="row"><span class="type">%s</span><span class="src">%s</span></div>'
                 '<div class="name">%s</div><div class="mono muted">%s · 대지 %d/%d</div>'
                 '<div class="row muted" style="font-size:12.5px">항목 %s · 글자 자리 %d%s%s</div><div class="row">%s</div>%s%s%s'
                 '<div class="mono files">%s<br>%s</div></div></div>' % (
                     ' dim' if e['exclude'] else '', E(e['type'] or ''), E((r['name'] + ' ' + r['id']).lower()),
                     E(r['files']['thumb']), E(r['name']),
                     E(_type_label(e['type'])) if not e['exclude'] else '추천 제외',
                     '시각 판정' if e['source'] == 'visual' else '자동 %.2f' % e['conf'],
                     E(r['name']), E(r['id']), r['page'], r['n_pages'],
                     e['count'] if e['count'] is not None else '?', f['text_slots'],
                     ' · 중심' if e['center'] else '', ' · 되돌이' if e['loop'] and e['type'] != 'Cycle' else '', sw,
                     '<div class="pen">%s</div>' % E(', '.join(e['style_pen'])) if e['style_pen'] else '',
                     '<div class="muted" style="font-size:12.5px">%s</div>' % E(e['note'] or '; '.join(e['reasons'][:2])),
                     '<div class="row" style="font-size:12.5px">%s</div>' % ' '.join(
                         '<span class="fit %s">%s %.2f</span> %s' % (b['fit'], b['fit'], b['score'], E(titles.get(b['item'], b['item']))) for b in best) if best and not e['exclude'] else '',
                     E(r['files']['svg']), E(r['files']['print_png'] or '')))
    P.append('</div></section>')

    # 4. 변환 기록
    P.append('<section class="block" id="log"><h2>변환 기록</h2><div class="tablewrap"><table><thead><tr>'
             '<th>파일</th><th>형식</th><th>경로</th><th>상태</th><th>대지</th><th>비고</th></tr></thead><tbody>')
    kind_ko = {'pdf': 'PDF 호환 AI', 'eps': 'EPS 형식(PDF 호환 꺼짐)', 'svg': 'SVG', 'unknown': '알 수 없음'}
    for s, e in sorted(assets.items(), key=lambda kv: kv[1]['name']):
        okc = 'ok' if e['status'] == 'converted' else 'bad'
        note = e.get('error') or ''
        if e.get('ai'):
            note = (note + ' ' if note else '') + 'Illustrator 대지 %d, 살아 있는 글자 %d, 래스터 %d' % (
                e['ai']['artboards'], e['ai']['text_frames'], e['ai']['raster_items'])
        P.append('<tr><td>%s<br><span class="mono muted">%s</span></td><td>%s</td><td>%s</td><td class="%s">%s</td><td>%d</td><td>%s</td></tr>' % (
            E(e['name']), E(s), kind_ko.get(e['kind'], e['kind']), 'poppler' if e['route'] == 'poppler' else ('Illustrator 2026' if e['route'] == 'illustrator' else '처리 불가'),
            okc, E(e['status']), len(e.get('pages', [])), E(note)))
    P.append('</tbody></table></div></section>')

    # 5. 읽는 법
    P.append('<section class="block" id="howto"><h2>읽는 법·한계</h2><div class="notes">'
             '<p>판정은 벡터 도형의 반복·배치(원형·가로·세로·격자·층·막대·지그재그), 중심 요소, 화살표·연결선, 글자 줄, 색 덩어리로 매긴 휴리스틱입니다. '
             '"시각 판정"은 썸네일을 직접 보고 덮어쓴 값(review.json)이고, "자동 0.xx"는 휴리스틱 점수입니다.</p>'
             '<p>항목 수는 그림 안의 반복 요소 수입니다. 한두 개 차이는 Illustrator 에서 요소를 복제·삭제해 맞출 수 있어 감점만 했습니다.</p>'
             '<p>재채색은 색상이 가까운 색끼리 묶어 KESI 색(사업 분야는 분야 6색)에 배정하고 명암 차이는 유지합니다. 그림자·흐림 효과가 이미지로 굳은 파일은 그 부분 색이 바뀌지 않습니다. '
             '글자는 지우고 HTML 로 덧씌우는 전제이며, 글자 자리 좌표는 영역 폴더의 slots.json 에 있습니다.</p>'
             '<p>인쇄용 투명 PNG 는 300dpi 이되 긴 변 3508px(A4 가로 전폭)을 넘지 않게 맞췄습니다. 편집은 region.svg 나 pdf/ 의 원본 쪽 PDF 를 Illustrator 로 여는 편이 낫습니다.</p>'
             '</div></section>')
    P.append('</div>')
    body = '\n'.join(P)
    head = ('<title>KESI 스톡 일러스트 추천</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n'
            '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
            '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Noto+Sans+KR:wght@400;600;700&display=swap">\n'
            '<style>%s</style>\n' % CSS)
    art = head + body + '\n<script>%s</script>\n' % JS
    with open(os.path.join(work, 'report_artifact.html'), 'w', encoding='utf-8') as f:
        f.write(art)
    full = ('<!doctype html>\n<html lang="ko"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' + head +
            '</head><body>\n' + body + '\n<script>%s</script>\n</body></html>\n' % JS)
    with open(os.path.join(work, 'report.html'), 'w', encoding='utf-8') as f:
        f.write(full)
    out('report: %s (재채색 미리보기 %d개)' % (os.path.join(work, 'report.html'), len(rec)))


def _stock_card(c, covers=''):
    thumb = c.get('thumb')
    img = ('<img class="stock-thumb" loading="lazy" data-fallback src="%s" alt="%s">' % (E(thumb), E(c.get('title', '')))
           if thumb else '<div class="ph">미리보기는 Adobe Stock 링크에서</div>')
    fit = c.get('fit', '')
    fk = {'high': '상', 'mid': '중', 'low': '하'}.get(fit, '')
    return ('<div class="card"><div class="thumbs">%s</div><div class="body"><div class="row">%s<span class="type">%s</span>'
            '<span class="src">%s</span></div><div class="name">%s</div><div class="mono muted">ID %s · %s</div>'
            '%s<ul class="why"><li>%s</li>%s</ul><a href="%s" target="_blank" rel="noopener">Adobe Stock 에서 보기</a></div></div>') % (
        img, '<span class="fit %s">%s</span>' % (fk, fk) if fk else '', E(c.get('type16', '') or ''),
        '확인함' if c.get('verified') else '미확인', E(c.get('title', '')), E(str(c.get('id', ''))), E(c.get('contributor', '') or ''),
        '<div class="muted" style="font-size:12.5px">%s</div>' % E(covers) if covers else '',
        E(c.get('why', '')), '<li class="pen">%s</li>' % E(c['concerns']) if c.get('concerns') else '',
        E(c.get('url', '#')))
