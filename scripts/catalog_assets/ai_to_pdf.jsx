// PDF 호환이 꺼진 .ai(EPS 형식 AI 포함)·.svg·.eps 를 Illustrator 로 열어 대지별 쪽 PDF 로 저장한다.
// ai_to_pdf.ps1 이 앞에 `var JOB_FILE = "...";` 를 붙여 DoJavaScript 로 실행한다.
// JOB_FILE(UTF-8) 은 `var JOB = [{slug, src, dst}, ...]; var LOG_FILE = "...";` 를 정의한다.

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
        var abs = [];
        for (var a = 0; a < doc.artboards.length; a++) {
            var r = doc.artboards[a].artboardRect;
            abs.push(esc(doc.artboards[a].name) + '@' + [r[0], r[1], r[2], r[3]].join(','));
        }
        var opts = new PDFSaveOptions();
        opts.compatibility = PDFCompatibility.ACROBAT7;
        opts.preserveEditability = false;
        opts.generateThumbnails = false;
        opts.viewAfterSaving = false;
        opts.artboardRange = '';
        doc.saveAs(new File(job.dst), opts);
        log.writeln(['OK', job.slug, doc.artboards.length, doc.textFrames.length, doc.rasterItems.length, abs.join('|')].join('\t'));
    } catch (e) {
        log.writeln(['ERR', job.slug, 0, 0, 0, esc(e.message || e)].join('\t'));
    }
    if (doc) {
        try { doc.close(SaveOptions.DONOTSAVECHANGES); } catch (e2) {}
    }
}

log.close();
app.userInteractionLevel = prevLevel;
'done';
