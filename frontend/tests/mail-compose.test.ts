import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildMimeMessage } from "../lib/mail/mime";
import { formatAddrList, recipientHeaders, resendSeed, tableMarginCss, tableOpenTag } from "../lib/mail/compose-layout";

// 메일 쓰기 개선(2026-11-12 직원 요청 2·7·14·16) — 개인별 보내기 헤더·다시보내기 초기값·표 정렬 인라인 스타일.

const from = { name: "보내는이", address: "me@koensain.com" };
const to = [
  { name: "가", address: "a@x.com" },
  { address: "b@y.com" },
];
const cc = [{ address: "c@z.com" }];

function headerBlock(raw: Buffer): string {
  const text = raw.toString("utf8");
  return text.slice(0, text.indexOf("\r\n\r\n"));
}

test("개인별 보내기 — 사본마다 To 는 그 사람 하나, Cc 없음", () => {
  for (const r of to) {
    const h = headerBlock(
      buildMimeMessage({ from, ...recipientHeaders(true, r, to, []), subject: "s", text: "t", html: "<p>t</p>", messageId: "<m@koensain.com>" })
    );
    const toLine = h.split("\r\n").find((l) => l.startsWith("To: ")) ?? "";
    assert.ok(toLine.includes(r.address), toLine);
    for (const other of to.filter((o) => o !== r)) assert.ok(!h.includes(other.address), `${other.address} 가 보이면 안 된다`);
    assert.ok(!/^Cc:/m.test(h));
  }
});

test("일반 보내기 — To·Cc 전원이 헤더에 남는다", () => {
  const hd = recipientHeaders(false, to[0], to, cc);
  assert.deepEqual(hd, { to, cc });
  const h = headerBlock(buildMimeMessage({ from, ...hd, subject: "s", text: "t", html: "t", messageId: "<m@koensain.com>" }));
  assert.ok(h.includes("a@x.com") && h.includes("b@y.com") && /^Cc: .*c@z\.com/m.test(h));
});

test("다시보내기 초기값 — 받는 사람·참조·숨은참조·제목·본문·개인별 표시를 그대로", () => {
  const seed = resendSeed({
    toAddrs: [{ name: "홍길동", address: "h@x.com" }, { address: "k@y.com" }],
    ccAddrs: [{ address: "c@z.com" }],
    bccAddrs: [{ name: 'A, "B"', address: "b@z.com" }],
    subject: "[한국환경안전연구원] 견적 송부",
    bodyHtml: "<div>본문<img src=\"cid:abc@x\"></div>",
    bodyText: "본문",
    sendIndividual: true,
  });
  assert.equal(seed.to, "홍길동 <h@x.com>, k@y.com");
  assert.equal(seed.cc, "c@z.com");
  assert.equal(seed.bcc, "A B <b@z.com>"); // 쉼표·따옴표는 입력값(쉼표 구분)을 깨므로 지운다
  assert.equal(seed.subject, "[한국환경안전연구원] 견적 송부"); // 접두어를 다시 붙이지 않는다
  assert.equal(seed.bodyHtml, "<div>본문<img src=\"cid:abc@x\"></div>");
  assert.equal(seed.individual, true);
});

test("다시보내기 — HTML 본문이 없으면 평문을 이스케이프해 싣는다", () => {
  const seed = resendSeed({ toAddrs: [{ address: "a@x.com" }], ccAddrs: [], subject: "s", bodyHtml: null, bodyText: "<b>1 & 2</b>" });
  assert.equal(seed.bodyHtml, '<div style="white-space:pre-wrap">&lt;b&gt;1 &amp; 2&lt;/b&gt;</div>');
  assert.equal(seed.bcc, "");
  assert.equal(seed.individual, false);
});

test("주소 목록 포맷 — 빈 주소는 빠진다", () => {
  assert.equal(formatAddrList([{ address: "" }, { name: " ", address: "x@y.com" }]), "x@y.com");
});

test("표 정렬 — 받는 쪽 호환 margin 인라인 스타일, 가운데만 align 속성", () => {
  assert.equal(tableMarginCss("left"), "margin:8px auto 8px 0px");
  assert.equal(tableMarginCss("left", 40), "margin:8px auto 8px 40px");
  assert.equal(tableMarginCss("center"), "margin:8px auto");
  assert.equal(tableMarginCss("right"), "margin:8px 0 8px auto");
  assert.ok(tableOpenTag("center").startsWith('<table align="center" '));
  assert.ok(!tableOpenTag("left").includes("align="), "align=left 는 표를 띄워 뒤 글이 흘러든다");
  assert.ok(!tableOpenTag("right").includes("align="));
  assert.ok(tableOpenTag("left").includes("margin:8px auto 8px 0px"));
});

test("서명 삽입에 '--' 구분선이 없다(웹 메일 쓰기·모바일 조립)", () => {
  const compose = readFileSync("components/mail/MailComposePage.tsx", "utf8");
  const assemble = readFileSync("lib/mail/compose-assemble.ts", "utf8");
  assert.ok(!/<div>--<br>/.test(compose), "MailComposePage 서명 앞 구분선");
  assert.ok(!/<div>--<br/.test(assemble), "compose-assemble 서명 앞 구분선");
});

test("편집기 결과 HTML 을 발송 MIME 으로 조립해도 그림·표 배치 인라인 스타일이 그대로다", () => {
  // 하네스에서 그림 [가운데]·스페이스바 4번, 표 [표 앞 띄우기] 2번을 누른 뒤의 편집기 HTML(blob → cid 는 MailComposePage.send 와 같은 치환).
  const blob = "blob:http://localhost/abc";
  const editorHtml =
    `<div>안녕하세요.</div><div style="text-align: center;">&nbsp;&nbsp;&nbsp;&nbsp;<img src="${blob}" style="max-width:100%"></div>` +
    `<table style="margin: 8px auto 8px 40px; width: 92%; table-layout: fixed;"><tbody><tr><td>1</td></tr></tbody></table>` +
    `<table align="center" style="margin: 8px auto; width: 92%;"><tbody><tr><td>2</td></tr></tbody></table>`;
  const cid = "img1@koensain.com";
  const html = editorHtml.split(blob).join(`cid:${cid}`);
  const raw = buildMimeMessage({
    from,
    ...recipientHeaders(true, to[1], to, []),
    subject: "배치 시험",
    text: "안녕하세요.",
    html,
    messageId: "<m@koensain.com>",
    attachments: [{ filename: "a.png", contentType: "image/png", content: Buffer.from([137, 80, 78, 71]), contentId: cid }],
  }).toString("utf8");
  assert.match(raw, /multipart\/related/);
  assert.match(raw, new RegExp(`Content-ID: <${cid.replace(/\./g, "\.")}>`));
  const parts = raw.split(/\r\n--/);
  const htmlPart = parts.find((p) => /Content-Type: text\/html/.test(p));
  assert.ok(htmlPart, "html 파트");
  const body = Buffer.from(htmlPart!.split("\r\n\r\n")[1].replace(/\s+/g, ""), "base64").toString("utf8");
  assert.ok(body.includes('<div style="text-align: center;">&nbsp;&nbsp;&nbsp;&nbsp;<img src="cid:img1@koensain.com"'), body);
  assert.ok(body.includes("margin: 8px auto 8px 40px"));
  assert.ok(body.includes('<table align="center" style="margin: 8px auto;'));
  assert.ok(!raw.includes("a@x.com"), "개인별 사본에 다른 받는 사람이 없다");
});
