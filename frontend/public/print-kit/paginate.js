/* print-kit — 쪽 나누기·쪽 번호·링크·넘침 검사(회사소개서 블루프린트 §9).
   화면 미리보기(스튜디오)와 서버 발행(converter /render/html-pdf)이 이 파일 하나를 같이 쓴다.
   이식 출처: ESG-KESI apps/api/app/report_render/static/paginate.js @ f48d0bd(origin/main, 2026-10-21).
     바꾼 점 — 접두사 kr- → pk-, 묶음 띠는 클래스 대신 [data-band], 4축 절 반복은 [data-repeat-head]로 일반화,
     쪽 번호 자릿수·'(계속)' 문구는 window.__pkConfig, 서체 외에 이미지 로드도 기다림,
     넘침 검사를 쪽 높이 외에 '쪽 밖으로 나간 글자'·'상자에 잘린 글자'·'칸 폭을 넘는 표'까지 넓힘.
   1) 흐름 쪽(.pk-sheet--flow)의 항목을 칸(.pk-col)에 차례로 채우고, 넘치면 다음 칸·다음 쪽으로 넘긴다.
      - 빈 칸에는 들어가는 항목은 통째로 넘기고, 바로 앞의 '다음과 함께'(data-keep-next) 제목도 함께 옮긴다.
      - 빈 칸보다 큰 표(data-split="rows")는 [data-split-box] 의 행 단위로 나눈다.
        이어지는 조각은 머리행(thead)을 그대로 반복하고 [data-cont-label] 에 '(계속)'을 붙이며, 각주(data-tail)는 마지막 조각에만 둔다.
        묶음 띠 행([data-band])은 조각 끝에 홀로 남기지 않고, 이어지는 조각 첫머리에 다시 둔다.
      - 절 제목([data-repeat-head="키"])의 절이 쪽을 넘으면 새 쪽 첫머리에 같은 제목을 흐린 글자(.is-continued)로 반복한다.
   2) 모든 쪽에 번호를 매기고([data-folio]), 목차·관련 쪽(data-ref)의 쪽 번호와 링크를 렌더 결과로 채운다.
      - data-ref-fmt: folio(09) · p(p.09) · range(09–12). data-ref-alt: data-ref 에 쪽이 없을 때 차례로 볼 앵커.
   3) window.__pkResult = {pages, anchors: {anchor: [첫 쪽, 끝 쪽]}, warnings} — converter 가 읽어 쪽 지도로 쓴다.
      준비가 끝나면 <html data-pk-ready="1">(실패 "error").
   4) window.__pkCheckSheet(쪽) — 쪽 하나의 넘침 검사 결과(스튜디오 캔버스). __pkConfig.manual 이면 1)~3)을 하지 않는다. */
(function () {
  "use strict";
  var cfg = window.__pkConfig || {};
  var DIGITS = cfg.folioDigits || 2;
  var CONT = cfg.continuedLabel == null ? " (계속)" : cfg.continuedLabel;
  var warnings = [];
  var slice = Array.prototype.slice;

  function pad(n) { var s = String(n); while (s.length < DIGITS) s = "0" + s; return s; }
  function cols(sheet) { return slice.call(sheet.querySelectorAll(".pk-col")); }
  function fits(col) { return col.scrollHeight <= col.clientHeight + 0.5; }
  function firstAnchor(el) { return ((el.getAttribute("data-anchors") || "").split(/\s+/)[0]) || ""; }
  function sheetOf(el) { return el.closest ? el.closest(".pk-sheet") : null; }
  function headingToP(h) {
    if (!/^H[1-6]$/.test(h.tagName)) return h;
    var p = document.createElement("p");
    for (var i = 0; i < h.attributes.length; i++) p.setAttribute(h.attributes[i].name, h.attributes[i].value);
    p.innerHTML = h.innerHTML; h.parentNode.replaceChild(p, h);
    return p;
  }
  function warn(kind, el, message, extra) {
    var s = sheetOf(el) || el;
    var w = { kind: kind, page: Number(s.getAttribute && s.getAttribute("data-page")) || 0, anchor: firstAnchor(s), message: message };
    if (extra) for (var k in extra) w[k] = extra[k];
    if (cfg.manual) Object.defineProperty(w, "el", { value: el, enumerable: false }); // 스튜디오가 경고 자리를 표시(직렬화에는 안 들어감)
    warnings.push(w);
  }

  function shellOf(first) {
    // 이어지는 쪽 틀: 머리 영역·쪽 제목은 복제하고 본문 칸은 비운다.
    // 쪽 제목은 흐린 글자의 p 로 바꾸고 숨은 목차 제목(.pk-outline)은 지워 PDF 북마크가 겹치지 않게 한다.
    var s = first.cloneNode(true);
    cols(s).forEach(function (c) { c.innerHTML = ""; });
    slice.call(s.querySelectorAll(".pk-outline, [data-first-only]")).forEach(function (el) { el.parentNode.removeChild(el); });
    slice.call(s.querySelectorAll("[data-continued-title]")).forEach(function (t) { headingToP(t).classList.add("is-continued"); });
    slice.call(s.querySelectorAll("[id]")).forEach(function (el) { el.removeAttribute("id"); });
    s.setAttribute("data-continued", "1");
    return s;
  }

  function continuedHead(head) {
    var c = head.cloneNode(true);
    c.removeAttribute("data-repeat-head"); c.removeAttribute("data-keep-next");
    c.classList.add("is-continued");
    slice.call(c.querySelectorAll("h1,h2,h3,h4,h5,h6")).forEach(headingToP);
    slice.call(c.querySelectorAll("[data-first-only]")).forEach(function (el) { el.parentNode.removeChild(el); });
    return c;
  }

  function isHeading(el) { return el.hasAttribute("data-keep-next") || el.classList.contains("is-continued"); }
  function isBand(el) { return el.hasAttribute("data-band"); }

  function split(it, col, alone) {
    var box = it.querySelector("[data-split-box]");
    if (!box || box.children.length < 2) return null;
    var tails = slice.call(it.querySelectorAll("[data-tail]"));
    tails.forEach(function (t) { t.parentNode.removeChild(t); });
    var moved = [];
    function back() {
      moved.forEach(function (m) { box.appendChild(m); });
      tails.forEach(function (t) { it.appendChild(t); });
      return null;
    }
    while (!fits(col) && box.children.length > 1) moved.unshift(box.removeChild(box.lastElementChild));
    if (fits(col) && !moved.length && box.children.length > 1) moved.unshift(box.removeChild(box.lastElementChild)); // 꼬리 때문에만 넘친 경우
    // 다음 조각에 한 행만 가지 않게(과부 행), 묶음 띠가 조각 끝에 홀로 남지 않게 한다
    if (moved.length === 1 && box.children.length > 2) moved.unshift(box.removeChild(box.lastElementChild));
    while (box.children.length > 1 && isBand(box.lastElementChild)) moved.unshift(box.removeChild(box.lastElementChild));
    if (!fits(col) || !moved.length) return back();
    // 칸에 다른 내용이 있는데 첫 조각이 한 행뿐이면(고아 행) 나누지 않고 표째 다음 칸으로 보낸다
    if (!alone && box.children.length < 2) return back();
    // 이어지는 조각 첫머리에 지금 묶음 띠를 다시 둔다
    if (!isBand(moved[0])) {
      var bands = slice.call(box.children).filter(isBand);
      if (bands.length) {
        var band = bands[bands.length - 1].cloneNode(true);
        var bl = band.querySelector("[data-band-label]") || band.lastElementChild || band;
        if (CONT && !band.querySelector(".pk-cont")) { var bs = document.createElement("span"); bs.className = "pk-cont"; bs.textContent = CONT; bl.appendChild(bs); }
        moved.unshift(band);
      }
    }
    var cont = it.cloneNode(true);
    var cbox = cont.querySelector("[data-split-box]");
    cbox.innerHTML = "";
    moved.forEach(function (m) { cbox.appendChild(m); });
    var head = cont.querySelector("[data-split-head]");
    if (head) head.parentNode.removeChild(head);
    var lab = cont.querySelector("[data-cont-label]");
    if (lab && CONT && !lab.querySelector(".pk-cont")) {
      var sp = document.createElement("span");
      sp.className = "pk-cont"; sp.textContent = CONT; lab.appendChild(sp);
    }
    tails.forEach(function (t) { cont.appendChild(t); });
    cont.setAttribute("data-continued", "1");
    return cont;
  }

  function paginateFlow(first) {
    var items = [];
    cols(first).forEach(function (c) { while (c.firstElementChild) items.push(c.removeChild(c.firstElementChild)); });
    var tpl = shellOf(first);
    var last = first, cs = cols(first), ci = 0, col = cs[0], fresh = false, sectionHead = null, guard = 0;
    if (!col) return;
    function newSheet() {
      var s = tpl.cloneNode(true);
      last.parentNode.insertBefore(s, last.nextSibling);
      last = s; cs = cols(s); ci = 0; col = cs[0]; fresh = true;
    }
    function advance() { if (ci < cs.length - 1) { ci += 1; col = cs[ci]; } else newSheet(); }
    var queue = items;
    while (queue.length) {
      if (++guard > 20000) { warn("loop", first, "쪽 나누기를 끝내지 못했습니다."); break; }
      var it = queue.shift();
      if (it.hasAttribute("data-repeat-head")) sectionHead = it;
      else if (fresh && sectionHead && col.children.length === 0 && it.getAttribute("data-repeat-of") === sectionHead.getAttribute("data-repeat-head")) {
        col.appendChild(continuedHead(sectionHead));
      }
      fresh = false;
      col.appendChild(it);
      if (fits(col)) continue;
      var others = slice.call(col.children).filter(function (c) { return c !== it; });
      var alone = others.every(isHeading);
      if (!alone && it.offsetHeight <= col.clientHeight) {
        col.removeChild(it);
        var moved = [it];
        while (col.lastElementChild && col.lastElementChild.hasAttribute("data-keep-next")) moved.unshift(col.removeChild(col.lastElementChild));
        advance(); queue = moved.concat(queue); continue;
      }
      var rest = split(it, col, alone);
      if (rest) { advance(); queue.unshift(rest); continue; }
      if (!alone) { col.removeChild(it); advance(); queue.unshift(it); continue; }
      warn("overflow", col, "한 칸보다 큰 항목이 잘렸습니다(나눌 수 없는 블록).", { anchor: firstAnchor(it) });
      advance();
    }
  }

  function setFolio(el, r, fmt) {
    var slot = el.querySelector("[data-folio-slot]") || el;
    if (fmt === "range") slot.textContent = r[0] === r[1] ? pad(r[0]) : pad(r[0]) + "–" + pad(r[1]);
    else slot.textContent = fmt === "p" ? "p." + pad(r[0]) : pad(r[0]);
  }

  function lookup(el, anchors) {
    var keys = [el.getAttribute("data-ref")].concat((el.getAttribute("data-ref-alt") || "").split(/\s+/));
    for (var i = 0; i < keys.length; i++) if (keys[i] && anchors[keys[i]]) return anchors[keys[i]];
    return null;
  }

  // ── 넘침 검사: 쪽 밖으로 나간 글자, 상자(overflow:hidden)에 잘린 글자, 칸 폭을 넘는 표 ──
  var styleCache = typeof WeakMap === "function" ? new WeakMap() : null;
  function cs(el) {
    if (!styleCache) return getComputedStyle(el);
    var v = styleCache.get(el);
    if (!v) { v = getComputedStyle(el); styleCache.set(el, v); }
    return v;
  }
  function hasOwnText(el) {
    for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && /\S/.test(n.nodeValue)) return true;
    return false;
  }
  function snippet(el) { return (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40); }
  function checkSheet(s) {
    if (s.scrollHeight > s.clientHeight + 1) warn("overflow", s, "쪽 내용이 쪽 높이를 넘습니다.");
    var sr = s.getBoundingClientRect(), st = cs(s);
    var inner = { top: sr.top + parseFloat(st.paddingTop), bottom: sr.bottom - parseFloat(st.paddingBottom), left: sr.left + parseFloat(st.paddingLeft), right: sr.right - parseFloat(st.paddingRight) };
    // 쪽 바로 아래 블록(흐름 안) — 글자가 자기 블록 아래로 넘쳐 다음 블록(각주 등)과 겹치는지 본다(flex 칸이 줄어 넘치는 경우)
    var blocks = slice.call(s.children).filter(function (c) { var p = cs(c).position; return p !== "absolute" && p !== "fixed"; });
    var seen = 0;
    slice.call(s.querySelectorAll("*")).forEach(function (el) {
      if (seen >= 6 || !hasOwnText(el)) return;
      if (el.closest("[aria-hidden='true'], [data-overflow-ok], .pk-outline, svg")) return;
      var r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      // 가장 가까운 잘림 상자와 절대 위치 여부
      var abs = false, clip = null;
      for (var a = el; a && a !== s; a = a.parentElement) {
        var as = cs(a);
        if (as.position === "absolute" || as.position === "fixed") abs = true;
        if (!clip && a !== el && (as.overflowY === "hidden" || as.overflowX === "hidden" || as.overflow === "hidden") && !a.classList.contains("pk-col")) clip = a;
      }
      var lim = abs ? { top: sr.top, bottom: sr.bottom, left: sr.left, right: sr.right } : inner;
      if (r.bottom > lim.bottom + 0.75 || r.right > lim.right + 0.75 || r.left < lim.left - 0.75 || r.top < lim.top - 0.75) {
        seen += 1; warn("overflow", el, abs ? "글자가 쪽 밖으로 나갔습니다." : "글자가 쪽 여백을 넘었습니다.", { text: snippet(el) });
        return;
      }
      if (clip) {
        var c = clip.getBoundingClientRect();
        if (r.bottom > c.bottom + 0.75 || r.right > c.right + 0.75) { seen += 1; warn("overflow", el, "글자가 상자에 잘렸습니다.", { text: snippet(el) }); return; }
      }
      if (!abs) {
        for (var bi = 0; bi < blocks.length; bi++) {
          if (!blocks[bi].contains(el)) continue;
          if (r.bottom > blocks[bi].getBoundingClientRect().bottom + 0.75) { seen += 1; warn("overflow", el, "글자가 칸 아래로 넘쳐 다음 내용과 겹칩니다.", { text: snippet(el) }); return; }
          break;
        }
      }
      var es = cs(el);
      if ((es.overflow === "hidden" || es.textOverflow === "ellipsis") && el.scrollWidth > el.clientWidth + 1) {
        seen += 1; warn("overflow", el, "글자가 칸 폭에 잘렸습니다.", { text: snippet(el) });
      }
    });
    slice.call(s.querySelectorAll("table")).forEach(function (t) {
      var box = t.parentElement;
      if (box && t.offsetWidth > box.clientWidth + 1) warn("overflow", t, "표가 칸 폭을 넘습니다(열이 너무 많음).", { text: snippet(t.querySelector("th, td") || t) });
    });
  }

  function finish() {
    var sheets = slice.call(document.querySelectorAll(".pk-sheet"));
    var anchors = {};
    sheets.forEach(function (s, i) {
      var n = i + 1;
      s.id = "p-" + pad(n); s.setAttribute("data-page", String(n));
      slice.call(s.querySelectorAll("[data-folio]")).forEach(function (f) { f.textContent = pad(n); });
      var prev = s.querySelector('[data-nav="prev"]'), next = s.querySelector('[data-nav="next"]');
      if (prev) { if (n > 1) prev.setAttribute("href", "#p-" + pad(n - 1)); else prev.parentNode.removeChild(prev); }
      if (next) { if (n < sheets.length) next.setAttribute("href", "#p-" + pad(n + 1)); else next.parentNode.removeChild(next); }
      [s].concat(slice.call(s.querySelectorAll("[data-anchors]"))).forEach(function (el) {
        (el.getAttribute("data-anchors") || "").split(/\s+/).forEach(function (a) {
          if (!a) return;
          var r = anchors[a];
          if (!r) anchors[a] = [n, n]; else { r[0] = Math.min(r[0], n); r[1] = Math.max(r[1], n); }
        });
      });
    });
    slice.call(document.querySelectorAll("[data-ref]")).forEach(function (el) {
      var r = lookup(el, anchors), fmt = el.getAttribute("data-ref-fmt"), miss = el.getAttribute("data-ref-missing") || "dash";
      if (r) {
        if (fmt) setFolio(el, r, fmt);
        if (el.tagName === "A") el.setAttribute("href", "#p-" + pad(r[0]));
      } else if (miss === "hide") {
        el.parentNode.removeChild(el);
      } else {
        el.removeAttribute("href");
        if (miss === "dash" && fmt) { (el.querySelector("[data-folio-slot]") || el).textContent = "—"; el.classList.add("is-missing"); }
        warn("ref", el, "참조한 쪽(" + el.getAttribute("data-ref") + ")을 찾지 못했습니다.");
      }
    });
    slice.call(document.querySelectorAll("[data-hide-empty]")).reverse().forEach(function (el) {
      if (!el.querySelector("[data-ref]") && el.parentNode) el.parentNode.removeChild(el);
    });
    sheets.forEach(checkSheet);
    return { pages: sheets.length, anchors: anchors, warnings: warnings };
  }

  function waitAssets() {
    void document.body.offsetHeight; // 레이아웃을 먼저 돌려 웹폰트 내려받기를 시작시킨다
    var jobs = [];
    if (document.fonts) {
      if (document.fonts.forEach) document.fonts.forEach(function (f) { jobs.push(f.load().catch(function () {})); });
      if (document.fonts.ready) jobs.push(document.fonts.ready);
    }
    slice.call(document.images).forEach(function (img) {
      if (img.complete) return;
      jobs.push(new Promise(function (res) { img.addEventListener("load", res); img.addEventListener("error", res); }));
    });
    var limit = new Promise(function (res) { setTimeout(res, cfg.assetTimeoutMs || 15000); });
    return Promise.race([Promise.all(jobs), limit]);
  }

  function run() {
    try {
      waitAssets().then(function () {
        try {
          slice.call(document.querySelectorAll(".pk-sheet--flow")).forEach(paginateFlow);
          window.__pkResult = finish();
          document.documentElement.setAttribute("data-pk-ready", "1");
        } catch (e) {
          window.__pkResult = { error: String((e && e.stack) || e) };
          document.documentElement.setAttribute("data-pk-ready", "error");
        }
      });
    } catch (e) {
      window.__pkResult = { error: String((e && e.stack) || e) };
      document.documentElement.setAttribute("data-pk-ready", "error");
    }
  }
  // 스튜디오 캔버스(P5): 쪽 하나를 React 가 그리므로 쪽 나누기는 하지 않고 넘침 검사만 빌려 쓴다(__pkConfig.manual).
  window.__pkCheckSheet = function (s) { var start = warnings.length; checkSheet(s); return warnings.splice(start, warnings.length - start); };
  if (cfg.manual) return;
  if (document.readyState === "complete") run(); else window.addEventListener("load", run);
})();
