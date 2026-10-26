"""회사소개서 스톡 일러스트(.ai 등) 분석·변환·추천 파이프라인.

  python -I asset_matcher.py ingest  --src <에셋 폴더> --work <작업 폴더>
  python -I asset_matcher.py convert --work <작업 폴더>          # PDF 호환 아님 → Illustrator 2026 COM
  python -I asset_matcher.py analyze --work <작업 폴더>
  python -I asset_matcher.py match   --work <작업 폴더>
  python -I asset_matcher.py report  --work <작업 폴더> [--stock stock_candidates.json]
  python -I asset_matcher.py recolor <in.svg> --out <out.svg> [--palette ci|area|mono] [--map #hex=#hex] [--strip-text]
  python -I asset_matcher.py export  --work <작업 폴더> --out <묶음 폴더> [--only <영역 id…>]   # 앱 '일러스트 가져오기'용 묶음
  python -I asset_matcher.py all     --src <에셋 폴더> --work <작업 폴더>

에셋은 신뢰하지 않는 데이터로 다룬다: 각 파일을 <작업>/_inputs/<slug>/src.<ext> 로 따로 복사해 처리하고,
이 스크립트 폴더에서는 아무것도 읽어 들이지 않는다(-I 실행, 경로는 인자로만).
"""
import argparse
import os
import re
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I 는 스크립트 폴더를 경로에 넣지 않는다

from am_common import HERE, make_slug, read_json, run, sha1_file, sniff_kind, tool, write_json  # noqa: E402

EXTS = ('.ai', '.eps', '.svg', '.pdf')
PRINT_LONG_PX = 3508      # A4 가로 전폭 300dpi(842pt) 긴 변 — 큰 대지는 이 값을 상한으로
THUMB_PX = 360


def out(msg):
    print(msg, flush=True)


# ---------- ingest ----------

def cmd_ingest(a):
    src = os.path.abspath(a.src)
    work = os.path.abspath(a.work)
    man = read_json(os.path.join(work, 'manifest.json'), {'source': src, 'assets': {}})
    man['source'] = src
    names = []
    if a.recursive:
        for d, _, fs in os.walk(src):
            names += [os.path.join(d, f) for f in fs if f.lower().endswith(EXTS)]
    else:
        names = [os.path.join(src, f) for f in os.listdir(src) if f.lower().endswith(EXTS)]
    used = {v['rel']: k for k, v in man['assets'].items()}
    n_new = 0
    for path in sorted(names):
        rel = os.path.relpath(path, src)
        slug = used.get(rel) or make_slug(os.path.basename(rel))
        while slug in man['assets'] and man['assets'][slug]['rel'] != rel:
            slug += '-2'
        sha = sha1_file(path)
        ent = man['assets'].get(slug)
        if ent and ent.get('sha1') == sha:
            continue
        ext = os.path.splitext(path)[1].lower()
        dst_dir = os.path.join(work, '_inputs', slug)
        os.makedirs(dst_dir, exist_ok=True)
        dst = os.path.join(dst_dir, 'src' + ext)
        shutil.copyfile(path, dst)
        kind = sniff_kind(dst)
        route = 'poppler' if kind == 'pdf' else ('illustrator' if kind in ('eps', 'svg') else 'skip')
        man['assets'][slug] = {'name': os.path.basename(rel), 'rel': rel, 'size': os.path.getsize(dst),
                               'sha1': sha, 'kind': kind, 'route': route, 'input': os.path.relpath(dst, work),
                               'status': 'ingested'}
        n_new += 1
    write_json(os.path.join(work, 'manifest.json'), man)
    kinds = {}
    for v in man['assets'].values():
        kinds[v['kind']] = kinds.get(v['kind'], 0) + 1
    out('ingest: 새로 복사 %d개, 전체 %d개 %s' % (n_new, len(man['assets']), kinds))


# ---------- convert ----------

def _illustrator(work, man, slugs):
    jobdir = os.path.join(work, '_jobs')
    os.makedirs(jobdir, exist_ok=True)
    job = os.path.join(jobdir, 'ai_job.js')
    log = os.path.join(jobdir, 'ai_job.log')
    if os.path.exists(log):
        os.remove(log)

    def js(v):
        return '"' + v.replace('\\', '/').replace('"', '\\"') + '"'

    lines = ['var JOB = [']
    for s in slugs:
        src = os.path.join(work, man['assets'][s]['input'])
        dst = os.path.join(work, 'pdf', s + '.pdf')
        lines.append(' {slug: %s, src: %s, dst: %s},' % (js(s), js(os.path.abspath(src)), js(os.path.abspath(dst))))
    lines.append('];')
    lines.append('var LOG_FILE = %s;' % js(os.path.abspath(log)))
    with open(job, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    ps1 = os.path.join(HERE, 'ai_to_pdf.ps1')
    out('convert: Illustrator 로 %d개 변환 중(파일당 10~30초)…' % len(slugs))
    rc, so, se = run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-JobFile', job],
                     timeout=60 * 60)
    if rc != 0:
        out('  Illustrator 실행 실패: ' + (se or so).strip()[:400])
    res = {}
    if os.path.exists(log):
        with open(log, encoding='utf-8-sig') as f:
            for line in f:
                p = line.rstrip('\n').split('\t')
                if len(p) >= 6:
                    res[p[1]] = p
    for s in slugs:
        ent = man['assets'][s]
        p = res.get(s)
        if p and p[0] == 'OK' and os.path.exists(os.path.join(work, 'pdf', s + '.pdf')):
            ent['ai'] = {'artboards': int(p[2]), 'text_frames': int(p[3]), 'raster_items': int(p[4]),
                         'artboard_rects': p[5]}
            ent['status'] = 'pdf'
        else:
            ent['status'] = 'failed'
            ent['error'] = (p[5] if p else 'Illustrator 결과 없음')


def _pdf_pages(pdf):
    rc, so, _ = run([tool('pdfinfo'), '-f', '1', '-l', '9999', '-box', pdf])
    pages = {}
    for m in re.finditer(r'Page\s+(\d+)\s+CropBox:\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)', so):
        n = int(m.group(1))
        x0, y0, x1, y1 = (float(m.group(i)) for i in range(2, 6))
        pages[n] = {'w': round(x1 - x0, 2), 'h': round(y1 - y0, 2)}
    return [pages[k] for k in sorted(pages)]


def _parse_bbox_html(path):
    """pdftotext -bbox-layout 결과 → 쪽별 [(word, [x0,y0,x1,y1])]."""
    with open(path, encoding='utf-8', errors='replace') as f:
        s = f.read()
    pages = []
    for pm in re.finditer(r'<page[^>]*>(.*?)</page>', s, re.S):
        words = []
        for wm in re.finditer(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>', pm.group(1)):
            t = re.sub(r'&amp;', '&', re.sub(r'&lt;', '<', re.sub(r'&gt;', '>', wm.group(5))))
            words.append([t, [float(wm.group(i)) for i in range(1, 5)]])
        pages.append(words)
    return pages


def cmd_convert(a):
    work = os.path.abspath(a.work)
    man = read_json(os.path.join(work, 'manifest.json'))
    os.makedirs(os.path.join(work, 'pdf'), exist_ok=True)
    todo_ai = [s for s, e in man['assets'].items()
               if e['route'] == 'illustrator' and (a.force or e['status'] in ('ingested', 'failed'))]
    for s, e in man['assets'].items():
        if e['route'] == 'poppler' and (a.force or e['status'] == 'ingested'):
            shutil.copyfile(os.path.join(work, e['input']), os.path.join(work, 'pdf', s + '.pdf'))
            e['status'] = 'pdf'
        elif e['route'] == 'skip':
            e['status'] = 'unsupported'
    if todo_ai:
        if a.no_illustrator:
            for s in todo_ai:
                man['assets'][s]['status'] = 'needs-illustrator'
        else:
            _illustrator(work, man, todo_ai)
    write_json(os.path.join(work, 'manifest.json'), man)
    n_pages = 0
    for s, e in sorted(man['assets'].items()):
        if e['status'] not in ('pdf', 'converted') or (e['status'] == 'converted' and not a.force):
            continue
        pdf = os.path.join(work, 'pdf', s + '.pdf')
        pages = _pdf_pages(pdf)
        e['pages'] = pages
        adir = os.path.join(work, 'assets', s)
        os.makedirs(adir, exist_ok=True)
        tx = os.path.join(adir, 'text.html')
        run([tool('pdftotext'), '-bbox-layout', '-enc', 'UTF-8', pdf, tx])
        words = _parse_bbox_html(tx) if os.path.exists(tx) else []
        for i, pg in enumerate(pages, 1):
            pdir = os.path.join(adir, 'ab%02d' % i)
            os.makedirs(pdir, exist_ok=True)
            rc, _, err = run([tool('pdftocairo'), '-svg', '-f', str(i), '-l', str(i), pdf, os.path.join(pdir, 'page.svg')])
            if rc != 0:
                pg['error'] = err.strip()[:300]
                continue
            run([tool('pdftocairo'), '-png', '-f', str(i), '-l', str(i), '-scale-to', str(THUMB_PX), '-singlefile',
                 pdf, os.path.join(pdir, 'thumb')])
            write_json(os.path.join(pdir, 'words.json'), words[i - 1] if i - 1 < len(words) else [])
            n_pages += 1
        e['status'] = 'converted'
        out('convert: %s (%s) 대지 %d' % (s, e['name'], len(pages)))
    write_json(os.path.join(work, 'manifest.json'), man)
    st = {}
    for e in man['assets'].values():
        st[e['status']] = st.get(e['status'], 0) + 1
    out('convert: 새 대지 %d, 상태 %s' % (n_pages, st))


# ---------- analyze ----------

def _crop_png(pdf, page, R, dst_prefix, long_px, transparent):
    w, h = R[2] - R[0], R[3] - R[1]
    res = min(300.0, long_px * 72.0 / max(w, h))
    k = res / 72.0
    args = [tool('pdftocairo'), '-png', '-f', str(page), '-l', str(page), '-r', '%.3f' % res,
            '-x', str(int(R[0] * k)), '-y', str(int(R[1] * k)), '-W', str(max(1, int(w * k))), '-H', str(max(1, int(h * k))),
            '-singlefile']
    if transparent:
        args.append('-transp')
    rc, _, err = run(args + [pdf, dst_prefix])
    return rc == 0, round(res, 1)


def _merge_text_regions(doc, rects, sx, sy, page_area):
    """글자만 있는 조각(설명문·제목)을 가장 가까운 그림 조각에 붙인다(대지 긴 변의 8% 이내)."""
    from am_analyze import analyze_region, select
    if len(rects) < 2:
        return rects
    lim = 0.08 * max(doc.W, doc.H) / max(sx, sy)
    info = []
    for rp in rects:
        R = [rp[0] * sx, rp[1] * sy, rp[2] * sx, rp[3] * sy]
        f = analyze_region(select(doc.prims, R), R, [], {})
        info.append(f['n_shapes'] <= 2 and f['group'] is None and f['text_lines'] >= 1)
    fig = [list(r) for r, t in zip(rects, info) if not t]
    if not fig:
        return rects
    out = fig
    for r, t in zip(rects, info):
        if not t:
            continue
        best, bd = None, None
        for g in out:
            dx = max(0, max(r[0], g[0]) - min(r[2], g[2]))
            dy = max(0, max(r[1], g[1]) - min(r[3], g[3]))
            d = max(dx, dy)
            if bd is None or d < bd:
                best, bd = g, d
        if best is not None and bd <= lim:
            best[:] = [min(best[0], r[0]), min(best[1], r[1]), max(best[2], r[2]), max(best[3], r[3])]
        else:
            out.append(list(r))
    return out


def cmd_analyze(a):
    from am_analyze import analyze_region, select
    from am_raster import cleanup, color_blobs, region_colors, render_ppm, segment
    from am_svg import SvgDoc, crop_svg

    work = os.path.abspath(a.work)
    man = read_json(os.path.join(work, 'manifest.json'))
    prev = read_json(os.path.join(work, 'analysis.json'), {'regions': []})
    keep = [r for r in prev['regions'] if a.only and r['slug'] not in a.only]
    regions = list(keep)
    for s, e in sorted(man['assets'].items()):
        if e.get('status') != 'converted' or (a.only and s not in a.only):
            continue
        pdf = os.path.join(work, 'pdf', s + '.pdf')
        for i, pg in enumerate(e.get('pages', []), 1):
            pdir = os.path.join(work, 'assets', s, 'ab%02d' % i)
            svgp = os.path.join(pdir, 'page.svg')
            if not os.path.exists(svgp):
                continue
            for old in os.listdir(pdir):
                if re.fullmatch(r'r\d+', old):
                    shutil.rmtree(os.path.join(pdir, old))
            doc = SvgDoc(svgp)
            ppm = os.path.join(pdir, '_lowres')
            W, H, data = render_ppm(pdf, i, ppm)
            rects, info = segment(W, H, data)
            mask = info.pop('mask', None)
            sx, sy = doc.W / W, doc.H / H
            words = read_json(os.path.join(pdir, 'words.json'), [])
            page_area = doc.W * doc.H
            rects = _merge_text_regions(doc, rects, sx, sy, page_area)
            k = 0
            queue = [([rp[0] * sx, rp[1] * sy, rp[2] * sx, rp[3] * sy], 0) for rp in rects]
            while queue:
                R, depth = queue.pop(0)
                rp = [max(0, int(R[0] / sx)), max(0, int(R[1] / sy)), min(W, int(R[2] / sx + 0.999)), min(H, int(R[3] / sy + 0.999))]
                if (R[2] - R[0]) * (R[3] - R[1]) < 0.01 * page_area:
                    continue
                pad = 0.01 * max(R[2] - R[0], R[3] - R[1])
                prims = select(doc.prims, R, pad)
                ws = [(w, bb) for w, bb in words
                      if R[0] - pad <= (bb[0] + bb[2]) / 2 <= R[2] + pad and R[1] - pad <= (bb[1] + bb[3]) / 2 <= R[3] + pad]
                colors, n_chroma = region_colors(W, H, data, mask, rp) if mask else ([], 0)
                raster = {'colors': colors, 'n_chroma': n_chroma}
                if 'merged_items' in info and len(rects) == 1:
                    raster['merged_items'] = info['merged_items']
                fine, _ = region_colors(W, H, data, mask, rp, top=12, merge=26, min_frac=0.004) if mask else ([], 0)
                blobs = []
                if mask:  # 거친 팔레트(인접 같은 계열 합침)와 세밀 팔레트(조각별 분리) 덩어리를 따로 무리 짓는다
                    for set_i, pal in enumerate((colors, fine)):
                        for b in color_blobs(W, H, data, mask, rp, pal):
                            b['set'] = set_i
                            blobs.append(b)
                for b in blobs:
                    b['bb'] = [b['bb'][0] * sx, b['bb'][1] * sy, b['bb'][2] * sx, b['bb'][3] * sy]
                f = analyze_region(prims, R, ws, raster, blobs, doc.stats)
                cells = f.pop('cells', None)
                if cells and depth == 0:
                    queue[0:0] = [(c, 1) for c in sorted(cells, key=lambda c: (round(c[1] / (0.1 * doc.H)), c[0]))]
                    continue
                f['text_only'] = f['n_shapes'] <= 2 and f['group'] is None and f['text_lines'] >= 1 and not f['icon_items']
                k += 1
                rid = '%s/ab%02d/r%d' % (s, i, k)
                rdir = os.path.join(pdir, 'r%d' % k)
                os.makedirs(rdir, exist_ok=True)
                m = 0.02 * max(R[2] - R[0], R[3] - R[1])
                C = [max(0, R[0] - m), max(0, R[1] - m), min(doc.W, R[2] + m), min(doc.H, R[3] + m)]
                crop_svg(svgp, os.path.join(rdir, 'region.svg'), C, 0.0, doc.elem_bb)
                _crop_png(pdf, i, C, os.path.join(rdir, 'thumb'), THUMB_PX, False)
                ok, dpi = (True, None)
                if not a.no_print_png:
                    ok, dpi = _crop_png(pdf, i, C, os.path.join(rdir, 'print'), PRINT_LONG_PX, True)
                write_json(os.path.join(rdir, 'slots.json'), {
                    'region_pt': [round(v, 2) for v in C],
                    'note': '글자 자리(영역 대비 비율 x,y,w,h, 줄 수). 글자는 HTML 로 덧씌운다.',
                    'slots': f['slots'],
                    'words': [[w, [round((bb[0] - C[0]) / (C[2] - C[0]), 4), round((bb[1] - C[1]) / (C[3] - C[1]), 4)]] for w, bb in ws][:400],
                })
                regions.append({
                    'id': rid, 'slug': s, 'name': e['name'], 'page': i, 'n_pages': len(e['pages']),
                    'page_size': [round(doc.W, 1), round(doc.H, 1)], 'region': [round(v, 2) for v in C],
                    'page_bg': info.get('bg'), 'svg_stats': doc.stats,
                    'files': {
                        'thumb': os.path.relpath(os.path.join(rdir, 'thumb.png'), work).replace('\\', '/'),
                        'svg': os.path.relpath(os.path.join(rdir, 'region.svg'), work).replace('\\', '/'),
                        'print_png': None if a.no_print_png else os.path.relpath(os.path.join(rdir, 'print.png'), work).replace('\\', '/'),
                        'page_svg': os.path.relpath(svgp, work).replace('\\', '/'),
                        'page_thumb': os.path.relpath(os.path.join(pdir, 'thumb.png'), work).replace('\\', '/'),
                        'slots': os.path.relpath(os.path.join(rdir, 'slots.json'), work).replace('\\', '/'),
                    },
                    'print_dpi': dpi,
                    'features': f,
                })
            cleanup(ppm)
            out('analyze: %s ab%02d 영역 %d %s' % (s, i, k, [r['features']['auto']['type'] for r in regions[-k:]] if k else ''))
    write_json(os.path.join(work, 'analysis.json'), {'regions': regions})
    out('analyze: 영역 %d개 기록' % len(regions))


# ---------- 나머지 ----------

def cmd_match(a):
    from am_match import run_match
    run_match(os.path.abspath(a.work), a.items, a.review, out)


def cmd_report(a):
    from am_report import build_report
    build_report(os.path.abspath(a.work), a.stock, a.review, out, recolor_top=a.recolor_top, force_recolor=a.force_recolor)


def cmd_recolor(a):
    from am_recolor import recolor_file
    rep = recolor_file(a.input, a.out, palette=a.palette, maps=a.map or [], strip=a.strip_text,
                       list_only=a.list)
    for line in rep:
        out(line)


def cmd_export(a):
    from am_export import run_export
    run_export(os.path.abspath(a.work), os.path.abspath(a.out), a.only or [], a.min_quality, a.keep_effects,
               a.no_illustrator, a.force, out)


def cmd_all(a):
    cmd_ingest(a)
    cmd_convert(a)
    cmd_analyze(a)
    cmd_match(a)
    cmd_report(a)


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser(description='회사소개서 스톡 일러스트 분석·변환·추천')
    sub = ap.add_subparsers(dest='cmd', required=True)

    def common(p, src=False):
        p.add_argument('--work', required=True, help='작업·산출 폴더')
        if src:
            p.add_argument('--src', required=True, help='에셋 폴더(.ai·.eps·.svg·.pdf)')
            p.add_argument('--recursive', action='store_true', help='하위 폴더까지')

    def conv_opts(p):
        p.add_argument('--force', action='store_true', help='이미 변환한 것도 다시')
        p.add_argument('--no-illustrator', action='store_true', help='Illustrator 를 띄우지 않음(PDF 호환본만)')

    def ana_opts(p):
        p.add_argument('--only', nargs='*', help='이 slug 만 다시 분석')
        p.add_argument('--no-print-png', action='store_true', help='인쇄용 투명 PNG 생략')

    def match_opts(p):
        p.add_argument('--items', default=os.path.join(HERE, 'catalog_items.json'), help='소개서 항목 정의')
        p.add_argument('--review', default=None, help='시각 판정 덮어쓰기(review.json, 기본: <work>/review.json)')

    def rep_opts(p):
        p.add_argument('--stock', default=None, help='Adobe Stock 구매 후보 JSON')
        p.add_argument('--recolor-top', type=int, default=3, help='항목별 상위 N개 재채색 미리보기')
        p.add_argument('--force-recolor', action='store_true', help='재채색 미리보기를 캐시 없이 다시 굽기')

    p = sub.add_parser('ingest'); common(p, True)
    p = sub.add_parser('convert'); common(p); conv_opts(p)
    p = sub.add_parser('analyze'); common(p); ana_opts(p)
    p = sub.add_parser('match'); common(p); match_opts(p)
    p = sub.add_parser('report'); common(p); match_opts(p); rep_opts(p)
    p = sub.add_parser('all'); common(p, True); conv_opts(p); ana_opts(p); match_opts(p); rep_opts(p)
    p = sub.add_parser('recolor')
    p.add_argument('input')
    p.add_argument('--out')
    p.add_argument('--palette', default='ci', choices=['ci', 'area', 'mono'])
    p.add_argument('--map', action='append', help='#원래색=#새색 또는 #원래색=area-2 (여러 번)')
    p.add_argument('--strip-text', action='store_true', help='글자(글리프) 지우기')
    p.add_argument('--list', action='store_true', help='색 목록만 출력')
    p = sub.add_parser('export', help='판정한 영역을 회사소개서 일러스트 묶음(illust.svg·thumb.png·meta.json)으로')
    common(p)
    p.add_argument('--out', required=True, help='묶음 폴더(관리 화면에서 이 폴더를 통째로 고른다)')
    p.add_argument('--only', nargs='*', help='이 영역 id(as-123/ab01/r2) 또는 slug 만')
    p.add_argument('--min-quality', type=int, default=3, help='--only 가 없을 때 이 품질(1~5) 이상만')
    p.add_argument('--keep-effects', action='store_true', help='그림자·흐림(이미지·필터·마스크)을 남김(기본: 평면화)')
    p.add_argument('--no-illustrator', action='store_true', help='Illustrator 를 띄우지 않음(이미 만든 aisvg 만)')
    p.add_argument('--force', action='store_true', help='Illustrator SVG 를 다시 만듦')

    a = ap.parse_args()
    if getattr(a, 'only', None) is None and hasattr(a, 'only'):
        a.only = []
    {'ingest': cmd_ingest, 'convert': cmd_convert, 'analyze': cmd_analyze, 'match': cmd_match,
     'report': cmd_report, 'recolor': cmd_recolor, 'export': cmd_export, 'all': cmd_all}[a.cmd](a)


if __name__ == '__main__':
    main()
