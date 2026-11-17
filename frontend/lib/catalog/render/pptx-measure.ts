/*
 * 갑지 편집형 PPT(사용자 요청 2026-11-17) — converter Chromium 안에서 표지 글자를 재는 스크립트.
 *   paginate.js 가 쪽을 다 나누고 <html data-pk-ready="1"> 을 붙이는 순간(MutationObserver, Playwright 가 결과를 읽기 전 마이크로태스크)
 *   1) 첫 쪽(.pk-sheet)의 글 노드를 글자 단위로 재어 줄마다 글·위치·서체·굵기·크기·색·자간·정렬을 모으고
 *   2) 그 결과를 window.__pkResult.warnings 에 kind "pptx-text" 한 줄(JSON)로 넣은 뒤
 *   3) 글자 칠만 투명하게 바꾼다(-webkit-text-fill-color) — 이어지는 쪽 캡처(PNG)가 글 없는 바탕 그림이 된다.
 *      잘리지 않은 그림(로고 등)도 재어 두고 감춘다 — PPT 에 따로 옮길 수 있는 그림으로 넣는다.
 *      color 는 그대로라 currentColor 로 그린 점·선·아이콘은 남는다. ::before/::after 글(번호 등)은 바탕에 남긴다.
 *   converter 를 바꾸지 않고(경고 목록은 그대로 돌려준다) 표지 한 쪽만 그린 HTML 에만 붙인다.
 * 좌표는 쪽 기준 CSS px(= pt, 쪽 842×595). baseline = 글자 상자 위 + 서체 ascent(캔버스로 같은 서체를 재서).
 */

export const PPTX_TEXT_KIND = "pptx-text";

export interface MeasuredLine {
  /** 같은 글 노드의 줄끼리 같은 값 — 한 글상자의 문단들로 묶는다 */
  node: number;
  text: string;
  /** 쪽 기준 px */
  left: number;
  right: number;
  top: number;
  baseline: number;
  /** 줄 상자 높이(px) */
  height: number;
  family: string;
  weight: number;
  size: number;
  italic: boolean;
  /** "rgb(r, g, b)" 또는 "rgba(r, g, b, a)" */
  color: string;
  /** px, 없으면 0 */
  spacing: number;
  align: "left" | "center" | "right";
  /** 줄 간격(px) — 같은 노드의 다음 줄 baseline 차이를 쓰고, 한 줄이면 CSS line-height */
  lineHeight: number;
}

/** 잘리지 않고 그대로 보이는 그림(로고 등) — PPT 에 따로 옮길 수 있는 그림으로 넣고 바탕에서는 뺀다 */
export interface MeasuredPicture {
  /** img src(converter 에서는 https://print.local/<자산 경로>) */
  src: string;
  left: number;
  top: number;
  width: number;
  height: number;
  alt: string;
}

export interface MeasuredSheet {
  width: number;
  height: number;
  lines: MeasuredLine[];
  pictures?: MeasuredPicture[];
}

/** 표지 한 쪽 HTML 에 붙이는 스크립트(ES5) */
export const PPTX_MEASURE_SCRIPT = `(function(){
  var KIND = ${JSON.stringify(PPTX_TEXT_KIND)};
  function firstFamily(ff){ var f = String(ff || '').split(',')[0] || ''; return f.replace(/^\\s*["']?|["']?\\s*$/g, ''); }
  function transformText(t, tt){ if (tt === 'uppercase') return t.toUpperCase(); if (tt === 'lowercase') return t.toLowerCase(); if (tt === 'capitalize') return t.replace(/(^|\\s)(\\S)/g, function(m, a, b){ return a + b.toUpperCase(); }); return t; }
  function visible(el){ for (var e = el; e && e.nodeType === 1; e = e.parentElement){ var cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false; } return true; }
  function measure(){
    var sheet = document.querySelector('.pk-sheet'); if (!sheet) return null;
    var sr = sheet.getBoundingClientRect();
    var canvas = document.createElement('canvas').getContext('2d');
    var walker = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT);
    var range = document.createRange();
    var lines = []; var nodeNo = 0;
    for (var n = walker.nextNode(); n; n = walker.nextNode()){
      var raw = n.nodeValue; if (!raw || !raw.replace(/\\s+/g, '')) continue;
      var el = n.parentElement; if (!el || el.closest('svg')) continue;
      var cs = getComputedStyle(el); var size = parseFloat(cs.fontSize) || 0;
      if (size < 4 || !visible(el)) continue;
      var tf = cs.transform; if (tf && tf !== 'none' && !/^matrix\\(1, 0, 0, 1,/.test(tf)) continue;
      canvas.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
      var asc = canvas.measureText('H').fontBoundingBoxAscent; if (!(asc > 0)) asc = size * 0.95;
      var ls = parseFloat(cs.letterSpacing); if (!isFinite(ls)) ls = 0;
      var lh = parseFloat(cs.lineHeight); if (!isFinite(lh)) lh = size * 1.2;
      var ta = cs.textAlign; var align = ta === 'center' ? 'center' : (ta === 'right' || ta === 'end') ? 'right' : 'left';
      var cur = null; var mine = [];
      for (var i = 0; i < raw.length; i++){
        range.setStart(n, i); range.setEnd(n, i + 1);
        var rs = range.getClientRects(); var r = rs.length ? rs[0] : null;
        if (!r || (r.width === 0 && r.height === 0)){ if (cur && /\\s/.test(raw[i])) cur.text += ' '; continue; }
        if (!cur || Math.abs(r.top - cur.top) > r.height / 2){
          cur = { text: '', left: r.left, right: r.right, top: r.top, bottom: r.bottom }; mine.push(cur);
        }
        cur.text += /\\s/.test(raw[i]) ? ' ' : raw[i];
        cur.left = Math.min(cur.left, r.left); cur.right = Math.max(cur.right, r.right); cur.top = Math.min(cur.top, r.top); cur.bottom = Math.max(cur.bottom, r.bottom);
      }
      var kept = 0;
      for (var j = 0; j < mine.length; j++){
        var m = mine[j]; var text = transformText(m.text.replace(/\\s+/g, ' ').trim(), cs.textTransform);
        if (!text) continue;
        if (m.right < sr.left || m.left > sr.right || m.bottom < sr.top || m.top > sr.bottom) continue;
        kept++;
        lines.push({ node: nodeNo, text: text, left: m.left - sr.left, right: m.right - sr.left, top: m.top - sr.top, baseline: m.top - sr.top + asc, height: m.bottom - m.top,
          family: firstFamily(cs.fontFamily), weight: parseInt(cs.fontWeight, 10) || 400, size: size, italic: cs.fontStyle === 'italic' || cs.fontStyle === 'oblique',
          color: cs.color, spacing: ls, align: align, lineHeight: lh });
      }
      if (kept) nodeNo++;
    }
    // 그림 — 둥근 모서리·잘림(부모 overflow)·object-fit 잘림이 없는 것만(물방울 틀 사진은 바탕에 남긴다)
    var pictures = [];
    var imgs = sheet.querySelectorAll('img');
    for (var q = 0; q < imgs.length; q++){
      var im = imgs[q]; if (!visible(im)) continue;
      var ir = im.getBoundingClientRect(); if (ir.width < 4 || ir.height < 4) continue;
      var ics = getComputedStyle(im);
      if (parseFloat(ics.borderTopLeftRadius) || parseFloat(ics.borderBottomRightRadius)) continue;
      if (ics.objectFit === 'cover' && im.naturalWidth && Math.abs(im.naturalWidth / im.naturalHeight - ir.width / ir.height) > 0.01) continue;
      var clipped = false;
      for (var a = im.parentElement; a && a !== sheet.parentElement; a = a.parentElement){
        var acs = getComputedStyle(a);
        if (acs.overflow !== 'visible' || acs.clipPath !== 'none'){ var ar = a.getBoundingClientRect(); if (ir.left < ar.left - 0.5 || ir.top < ar.top - 0.5 || ir.right > ar.right + 0.5 || ir.bottom > ar.bottom + 0.5 || (a !== sheet && (parseFloat(acs.borderTopLeftRadius) || parseFloat(acs.borderBottomRightRadius) || acs.clipPath !== 'none'))){ clipped = true; break; } }
      }
      if (clipped) continue;
      im.setAttribute('data-pptx-pic', '1');
      pictures.push({ src: im.currentSrc || im.src, left: ir.left - sr.left, top: ir.top - sr.top, width: ir.width, height: ir.height, alt: im.alt || '' });
    }
    return { width: sr.width, height: sr.height, lines: lines, pictures: pictures };
  }
  function hide(){
    var st = document.createElement('style');
    st.textContent = '.pk-sheet, .pk-sheet * { -webkit-text-fill-color: transparent !important; text-shadow: none !important; } .pk-sheet *::before, .pk-sheet *::after { -webkit-text-fill-color: currentcolor !important; } [data-pptx-pic] { visibility: hidden !important; }';
    document.head.appendChild(st);
  }
  var done = false;
  new MutationObserver(function(){
    if (done || document.documentElement.getAttribute('data-pk-ready') !== '1') return;
    done = true;
    try {
      var out = measure();
      var res = window.__pkResult || (window.__pkResult = {});
      if (!res.warnings) res.warnings = [];
      res.warnings.push({ kind: KIND, page: 0, anchor: '', message: JSON.stringify(out) });
      hide();
    } catch (e) {
      var r2 = window.__pkResult || (window.__pkResult = {}); if (!r2.warnings) r2.warnings = [];
      r2.warnings.push({ kind: KIND, page: 0, anchor: '', message: JSON.stringify({ error: String(e && e.message || e) }) });
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-pk-ready'] });
})();`;
