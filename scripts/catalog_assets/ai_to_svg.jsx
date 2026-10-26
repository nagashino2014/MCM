// .ai·.eps·.svg·.pdf 를 Illustrator 로 열어 대지마다 SVG 로 내보낸다(asset_matcher.py export 가 호출).
// cairo SVG(pdftocairo)는 투명·혼합 모드를 필터 합성 체인으로 그려 PDF 에서 래스터로 굳으므로, 회사소개서용 벡터는 이 경로로 만든다.
// Illustrator SVG 는 레이어 이름(Text·Background 등)이 g id 로 남아 글자 자리를 정확히 찾을 수 있다.
// ai_to_pdf.ps1 -Script ai_to_svg.jsx 가 앞에 `var JOB_FILE = "...";` 를 붙여 실행한다.
// JOB_FILE(UTF-8) 은 `var JOB = [{slug, src, dir}, ...]; var LOG_FILE = "...";` — dir/abNN/ 아래에 대지별 SVG 가 생긴다.

function readUtf8(path) {
    var f = new File(path);
    f.encoding = 'UTF-8';
    f.open('r');
    var s = f.read();
    f.close();
    return s;
}

function esc(s) {
    return String(s).replace(/[\t\r\n]+/g, ' ');
}

function pad2(n) {
    return (n < 10 ? '0' : '') + n;
}

eval(readUtf8(JOB_FILE));

var prevLevel = app.userInteractionLevel;
app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;

var log = new File(LOG_FILE);
log.encoding = 'UTF-8';
log.open('w');

for (var i = 0; i < JOB.length; i++) {
    var job = JOB[i];
    var doc = null;
    try {
        doc = app.open(new File(job.src));
        var n = doc.artboards.length;
        for (var a = 0; a < n; a++) {
            var folder = new Folder(job.dir + '/ab' + pad2(a + 1));
            if (!folder.exists) folder.create();
            var old = folder.getFiles('*.svg');
            for (var k = 0; k < old.length; k++) old[k].remove();
            var o = new ExportOptionsSVG();
            o.embedRasterImages = true;
            o.fontType = SVGFontType.OUTLINEFONT;
            o.cssProperties = SVGCSSPropertyLocation.PRESENTATIONATTRIBUTES;
            o.documentEncoding = SVGDocumentEncoding.UTF8;
            o.coordinatePrecision = 2;
            o.preserveEditability = false;
            o.saveMultipleArtboards = true;
            o.artboardRange = String(a + 1);
            doc.exportFile(new File(folder.fsName + '/x.svg'), ExportType.SVG, o);
            var r = doc.artboards[a].artboardRect;
            log.writeln(['OK', job.slug, a + 1, [r[0], r[1], r[2], r[3]].join(',')].join('\t'));
        }
    } catch (e) {
        log.writeln(['ERR', job.slug, 0, esc(e.message || e)].join('\t'));
    }
    if (doc) {
        try { doc.close(SaveOptions.DONOTSAVECHANGES); } catch (e2) {}
    }
}

log.close();
app.userInteractionLevel = prevLevel;
'done';
