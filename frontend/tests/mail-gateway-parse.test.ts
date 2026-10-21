import assert from "node:assert/strict";
import test from "node:test";
import {
  compressUids,
  imapDateTime,
  ImapWireReader,
  joinOut,
  parseImapDateTime,
  parseSequenceSet,
  tokenize,
  type WireSegment,
} from "../lib/mail/gateway/imap-wire";
import { decodeMutf7, encodeMutf7 } from "../lib/mail/gateway/mutf7";
import {
  describeStructure,
  envelopeFromHeaders,
  extractSection,
  headerOnlySection,
  parseAddressList,
  parseMime,
  parseSection,
  serializeEnvelope,
  serializeStructure,
} from "../lib/mail/gateway/mime-tree";
import { collectBodyTerms, evalSearch, parseSearch, type SearchMsg } from "../lib/mail/gateway/imap-search";
import { parseProxyV2 } from "../lib/mail/gateway/proxy-protocol";
import { prepareSubmission, SmtpReject } from "../lib/mail/gateway/smtp-prepare";
import type { GwUser } from "../lib/mail/gateway/types";

function readAll(input: string | Buffer, chunk = 7): { cmds: WireSegment[][]; continues: number } {
  const cmds: WireSegment[][] = [];
  let continues = 0;
  const r = new ImapWireReader({
    maxLiteral: 1000,
    maxLine: 1000,
    onContinue: () => continues++,
    onCommand: (s) => cmds.push(s),
    onError: (m) => {
      throw new Error(m);
    },
  });
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  for (let i = 0; i < buf.length; i += chunk) r.feed(buf.subarray(i, i + chunk));
  return { cmds, continues };
}

test("명령 읽기: 동기·비동기 리터럴, 조각 경계와 무관", () => {
  const { cmds, continues } = readAll('a1 LOGIN {5}\r\nkim@x {3+}\r\npw!\r\na2 NOOP\r\n', 3);
  assert.equal(cmds.length, 2);
  assert.equal(continues, 1); // {3+} 는 계속 응답이 없다
  const toks = tokenize(cmds[0]);
  assert.deepEqual(
    toks.map((t) => (t.t === "string" ? t.v.toString() : t.t === "atom" ? t.v : t.t)),
    ["a1", "LOGIN", "kim@x", "pw!"]
  );
});

test("토큰: 대괄호 구간·부분 범위·따옴표 이스케이프·NIL·중첩 목록", () => {
  const [cmd] = readAll('t UID FETCH 1:* (UID BODY.PEEK[HEADER.FIELDS (FROM "TO")]<0.100> FLAGS) "a\\"b" NIL\r\n').cmds;
  const toks = tokenize(cmd);
  assert.equal(toks.length, 7);
  const list = toks[4];
  assert.equal(list.t, "list");
  if (list.t !== "list") return;
  assert.deepEqual(
    list.v.map((t) => (t.t === "atom" ? t.v : "?")),
    ["UID", 'BODY.PEEK[HEADER.FIELDS (FROM "TO")]<0.100>', "FLAGS"]
  );
  assert.equal(toks[5].t, "string");
  assert.deepEqual(tokenize(readAll("x A NIL\r\n").cmds[0])[2], { t: "nil" });
});

test("시퀀스 집합·UID 압축·날짜", () => {
  assert.deepEqual(parseSequenceSet("1:3,7,9:*", 12), [[1, 3], [7, 7], [9, 12]]);
  assert.deepEqual(parseSequenceSet("*:4", 2), [[2, 4]]);
  assert.equal(parseSequenceSet("1:a", 3), null);
  assert.equal(compressUids([5, 1, 2, 3, 9, 10]), "1:3,5,9:10");
  const d = parseImapDateTime("17-Jul-1996 02:44:25 -0700")!;
  assert.equal(d.toISOString(), "1996-07-17T09:44:25.000Z");
  assert.equal(imapDateTime(d), "17-Jul-1996 09:44:25 +0000");
});

test("변형 UTF-7 폴더 이름", () => {
  // RFC 3501 §5.1.3 예시
  assert.equal(decodeMutf7("~peter/mail/&U,BTFw-/&ZeVnLIqe-"), "~peter/mail/台北/日本語");
  assert.equal(encodeMutf7("~peter/mail/台北/日本語"), "~peter/mail/&U,BTFw-/&ZeVnLIqe-");
  assert.ok(encodeMutf7("R&D 자료").startsWith("R&-D &"));
  assert.equal(decodeMutf7(encodeMutf7("보낸편지함")), "보낸편지함");
  assert.equal(decodeMutf7(encodeMutf7("R&D 자료/2026")), "R&D 자료/2026");
});

const SAMPLE = Buffer.from(
  [
    'From: "홍길동" <hong@example.com>',
    "To: kim@koensain.app, Group: a@b.c, d@e.f;",
    "Subject: =?UTF-8?B?7ZWc6riA?=",
    "Date: Tue, 20 Oct 2026 10:00:00 +0900",
    "Message-ID: <m1@example.com>",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="XYZ"',
    "",
    "preamble",
    "--XYZ",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    "Hello",
    "world",
    "--XYZ",
    'Content-Type: application/pdf; name="a.pdf"',
    'Content-Disposition: attachment; filename="a.pdf"',
    "Content-Transfer-Encoding: base64",
    "",
    "QUJD",
    "--XYZ--",
    "",
  ].join("\r\n"),
  "utf8"
);

test("MIME: BODYSTRUCTURE·섹션·헤더 필드", () => {
  const tree = parseMime(SAMPLE);
  const st = describeStructure(SAMPLE, tree);
  assert.equal(
    joinOut(serializeStructure(st, true)).toString(),
    '(("text" "plain" ("charset" "UTF-8") NIL NIL "7bit" 12 2 NIL NIL NIL NIL)' +
      '("application" "pdf" ("name" "a.pdf") NIL NIL "base64" 4 NIL ("attachment" ("filename" "a.pdf")) NIL NIL)' +
      ' "mixed" ("boundary" "XYZ") NIL NIL NIL)'
  );
  assert.equal(
    joinOut(serializeStructure(st, false)).toString(),
    '(("text" "plain" ("charset" "UTF-8") NIL NIL "7bit" 12 2)("application" "pdf" ("name" "a.pdf") NIL NIL "base64" 4) "mixed")'
  );
  const sec = (s: string) => extractSection(SAMPLE, tree, parseSection(s)!).toString();
  assert.equal(sec("1"), "Hello\r\nworld");
  assert.equal(sec("2"), "QUJD");
  assert.ok(sec("2.MIME").startsWith("Content-Type: application/pdf") && sec("2.MIME").endsWith("\r\n\r\n"));
  assert.equal(sec("HEADER.FIELDS (SUBJECT MESSAGE-ID)"), "Subject: =?UTF-8?B?7ZWc6riA?=\r\nMessage-ID: <m1@example.com>\r\n\r\n");
  assert.ok(sec("TEXT").startsWith("preamble\r\n--XYZ"));
  assert.equal(sec(""), SAMPLE.toString());
  assert.equal(sec("3"), "");
  const header = SAMPLE.subarray(0, tree.headerEnd);
  assert.equal(headerOnlySection(header, parseSection("HEADER.FIELDS (SUBJECT)")!)!.toString(), "Subject: =?UTF-8?B?7ZWc6riA?=\r\n\r\n");
  assert.equal(headerOnlySection(header, parseSection("1")!), null);
  assert.equal(parseSection("MIME"), null);
});

test("MIME: 단일 파트 본문 1 = 본문 자체, Content-Type 없으면 text/plain us-ascii", () => {
  const raw = Buffer.from("Subject: x\r\n\r\nbody\r\n");
  const tree = parseMime(raw);
  assert.equal(extractSection(raw, tree, parseSection("1")!).toString(), "body\r\n");
  assert.equal(
    joinOut(serializeStructure(describeStructure(raw, tree), true)).toString(),
    '("text" "plain" ("charset" "us-ascii") NIL NIL "7bit" 6 1 NIL NIL NIL NIL)'
  );
});

test("ENVELOPE: 그룹·한글 이름(리터럴)·주소 없는 헤더", () => {
  const tree = parseMime(SAMPLE);
  const env = joinOut(serializeEnvelope(envelopeFromHeaders(tree.headers))).toString();
  assert.ok(env.startsWith('("Tue, 20 Oct 2026 10:00:00 +0900" "=?UTF-8?B?7ZWc6riA?=" (({9}\r\n홍길동 NIL "hong" "example.com"))'), env);
  assert.ok(env.includes('((NIL NIL "kim" "koensain.app")(NIL NIL "Group" NIL)(NIL NIL "a" "b.c")(NIL NIL "d" "e.f")(NIL NIL NIL NIL))'), env);
  assert.ok(env.endsWith('NIL NIL "<m1@example.com>")'), env);
  assert.deepEqual(parseAddressList("x@y.z (Kim)"), [{ name: "Kim", mailbox: "x", host: "y.z" }]);
  assert.equal(parseAddressList("   "), null);
});

test("SEARCH: 조건 해석과 평가", () => {
  const toks = tokenize(readAll('s SEARCH UNSEEN OR FROM "kim" SUBJECT 보고 SINCE 1-Oct-2026 NOT DELETED BODY 계약\r\n').cmds[0]).slice(2);
  const crit = parseSearch(toks);
  const terms = collectBodyTerms(crit);
  assert.equal(terms.size, 1);
  const key = [...terms.keys()][0];
  const base: SearchMsg = {
    seq: 1,
    uid: 10,
    flags: [],
    internalDate: new Date("2026-10-05T00:00:00Z"),
    sentDate: null,
    size: 100,
    subject: "주간 보고",
    from: "lee@x.com",
    to: "",
    cc: "",
    bcc: "",
    messageId: "<a@b>",
  };
  const ctx = { maxSeq: 1, maxUid: 10, bodyHits: new Map([[key, new Set([10])]]) };
  assert.equal(evalSearch(crit, base, ctx), true);
  assert.equal(evalSearch(crit, { ...base, flags: ["\\Seen"] }, ctx), false);
  assert.equal(evalSearch(crit, { ...base, internalDate: new Date("2026-09-30T23:00:00Z") }, ctx), false);
  assert.equal(evalSearch(crit, base, { ...ctx, bodyHits: new Map() }), false);
  const uidCrit = parseSearch(tokenize(readAll("s SEARCH UID 5:*\r\n").cmds[0]).slice(2));
  assert.equal(evalSearch(uidCrit, base, ctx), true);
});

test("PROXY v2 헤더", () => {
  const sig = Buffer.from([0x0d, 0x0a, 0x0d, 0x0a, 0x00, 0x0d, 0x0a, 0x51, 0x55, 0x49, 0x54, 0x0a]);
  const v4 = Buffer.concat([sig, Buffer.from([0x21, 0x11, 0x00, 0x0c, 203, 0, 113, 7, 10, 0, 0, 5, 0xc3, 0x50, 0x03, 0xe1]), Buffer.from("A1 ")]);
  const r = parseProxyV2(v4);
  assert.ok(r && r !== "more");
  assert.deepEqual(r.info, { remoteAddress: "203.0.113.7", remotePort: 50000 });
  assert.equal(r.length, 28);
  assert.equal(parseProxyV2(v4.subarray(0, 20)), "more");
  assert.equal(parseProxyV2(Buffer.from("A1 LOGIN x y\r\n")), null);
});

const USER: GwUser = {
  userId: "u1",
  mailboxId: "mbx-1",
  address: "kim@koensain.app",
  sendAddresses: ["kim@koensain.app", "kim@koensain.com"],
  displayName: "김",
  appPasswordId: "mapw-1",
};

test("SMTP 제출: 발신자 확인·Bcc 제거·사본 Bcc·Message-ID 보충", () => {
  const raw = Buffer.from(
    ["From: Kim <kim@koensain.com>", "To: a@x.com", "Bcc: secret@y.com", "Subject: hi", "", "body", ""].join("\r\n")
  );
  const p = prepareSubmission(raw, USER, "kim@koensain.com", ["a@x.com", "secret@y.com"], new Date("2026-10-21T01:02:03Z"));
  const out = p.outgoing.toString();
  assert.ok(!/^Bcc:/im.test(out));
  assert.ok(/^Message-ID: <[0-9a-f]{32}@koensain\.com>\r\n/.test(out));
  assert.ok(out.includes("Date: Wed, 21 Oct 2026 01:02:03 +0000\r\n"));
  assert.ok(p.sentCopy.toString().includes("Bcc: secret@y.com"));
  assert.equal(p.fromAddress, "kim@koensain.com");

  const noBccHeader = Buffer.from(["From: kim@koensain.app", "To: a@x.com", "Message-ID: <z@koensain.app>", "Date: x", "", "b"].join("\r\n"));
  const q = prepareSubmission(noBccHeader, USER, "kim@koensain.app", ["a@x.com", "hidden@y.com"]);
  assert.equal(q.messageIdHeader, "<z@koensain.app>");
  assert.ok(q.sentCopy.toString().startsWith("Bcc: hidden@y.com\r\n"));
  assert.equal(q.outgoing.toString(), noBccHeader.toString());

  assert.throws(
    () => prepareSubmission(Buffer.from("From: boss@koensain.app\r\n\r\nx"), USER, "kim@koensain.app", ["a@x.com"]),
    (e: unknown) => e instanceof SmtpReject && e.responseCode === 553
  );
  assert.throws(
    () => prepareSubmission(Buffer.from("From: kim@koensain.app\r\n\r\nx"), USER, "other@koensain.app", ["a@x.com"]),
    (e: unknown) => e instanceof SmtpReject && e.responseCode === 553
  );
});
