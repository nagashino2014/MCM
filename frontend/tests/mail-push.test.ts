import assert from "node:assert/strict";
import { test } from "node:test";
import { simpleParser } from "mailparser";
import {
  MAIL_PUSH_COOLDOWN_MS,
  mailPushMessage,
  mailPushSkipReason,
  notifyNewInboxMails,
  type InboxMailForPush,
} from "../lib/mail/inbound-push";
import { dbCalls, setDbRows } from "./stubs/mail-push-db";
import { pushCalls } from "./stubs/mail-push-send";

// 새 메일 모바일 푸시 기준(2026-11-12). scripts/test-mail-push.mjs 가 @/lib/db·@/lib/notify/push-expo 를
// tests/stubs 로 바꿔 끼워 빌드한다 — DB·Expo 없이 묶음·간격 판정까지 본다.

const ME = "lee@koensain.app";

async function parse(headers: string, body = "본문"): Promise<Map<string, unknown>> {
  const raw = `${headers.trim()}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n`;
  const parsed = await simpleParser(Buffer.from(raw));
  return parsed.headers as Map<string, unknown>;
}

const base = { spam: false, categoryId: null, mailboxAddress: ME };

test("일반 메일(사내·외부)은 보낸다 — SES 가 붙이는 Feedback-ID 는 기준이 아니다", async () => {
  const h = await parse(`From: 김과장 <kim@koensain.app>\r\nTo: ${ME}\r\nSubject: 회의 자료\r\nFeedback-ID: 1.ap-northeast-2.abc:AmazonSES`);
  assert.equal(mailPushSkipReason({ ...base, headers: h, fromAddress: "kim@koensain.app" }), null);
  const ext = await parse(`From: client@example.com\r\nTo: ${ME}\r\nSubject: 견적 문의`);
  assert.equal(mailPushSkipReason({ ...base, headers: ext, fromAddress: "client@example.com" }), null);
});

test("스팸함·보낸 사람 자동 분류 메일은 보내지 않는다", () => {
  assert.equal(mailPushSkipReason({ ...base, spam: true, fromAddress: "x@y.z" }), "스팸함");
  assert.equal(mailPushSkipReason({ ...base, categoryId: "mfld-news", fromAddress: "x@y.z" }), "보낸 사람 자동 분류");
});

test("뉴스레터·메일링 리스트·대량 발송·자동 회신은 보내지 않는다", async () => {
  const cases: [string, string][] = [
    ["List-Unsubscribe: <mailto:unsub@news.example.com>", "메일링 리스트·뉴스레터"],
    ["List-Id: 환경부 소식 <news.me.go.kr>", "메일링 리스트·뉴스레터"],
    ["Precedence: bulk", "Precedence: bulk"],
    ["Precedence: List", "Precedence: list"],
    ["Auto-Submitted: auto-replied", "자동 발송(Auto-Submitted)"],
  ];
  for (const [line, reason] of cases) {
    const h = await parse(`From: news@example.com\r\nTo: ${ME}\r\nSubject: s\r\n${line}`);
    assert.equal(mailPushSkipReason({ ...base, headers: h, fromAddress: "news@example.com" }), reason, line);
  }
  const no = await parse(`From: a@example.com\r\nTo: ${ME}\r\nSubject: s\r\nAuto-Submitted: no`);
  assert.equal(mailPushSkipReason({ ...base, headers: no, fromAddress: "a@example.com" }), null);
});

test("반송 통지·내가 나에게 보낸 메일은 보내지 않는다", async () => {
  assert.equal(mailPushSkipReason({ ...base, fromAddress: "MAILER-DAEMON@amazonses.com" }), "반송 통지");
  const report = await simpleParser(
    Buffer.from(
      `From: bounce@example.com\r\nTo: ${ME}\r\nSubject: Undelivered\r\nContent-Type: multipart/report; report-type=delivery-status; boundary="b"\r\n\r\n--b\r\nContent-Type: text/plain\r\n\r\nfail\r\n--b--\r\n`
    )
  );
  assert.equal(
    mailPushSkipReason({ ...base, headers: report.headers as Map<string, unknown>, fromAddress: "bounce@example.com" }),
    "반송 통지"
  );
  assert.equal(mailPushSkipReason({ ...base, fromAddress: "LEE@koensain.app" }), "내가 나에게 보낸 메일");
});

const mail = (id: string, mailboxId = "mbx-lee", fromName: string | null = "김과장", subject = "회의 자료"): InboxMailForPush => ({
  mailboxId,
  messageId: id,
  fromName,
  fromAddress: "kim@koensain.app",
  subject,
});

test("문구 — 한 통은 보낸 사람·제목과 그 메일 링크, 여러 통은 묶음", () => {
  assert.deepEqual(mailPushMessage([mail("mmsg-1")]), {
    title: "새 메일 · 김과장",
    body: "회의 자료",
    link: "/mail?id=mmsg-1",
    dedupKey: "mail:mmsg-1",
  });
  assert.equal(mailPushMessage([mail("mmsg-1", "m", null, "")]).title, "새 메일 · kim@koensain.app");
  assert.equal(mailPushMessage([mail("mmsg-1", "m", null, "  ")]).body, "(제목 없음)");
  const many = mailPushMessage([mail("mmsg-1"), mail("mmsg-2"), mail("mmsg-3")]);
  assert.equal(many.title, "새 메일 3통");
  assert.equal(many.body, "김과장: 회의 자료 외 2통");
  assert.equal(many.link, "/mail");
});

test("발송 — 사람별로 묶고, 주인 없는 메일함은 건너뛰고, 직전 60초 안에 받은 사람은 생략한다", async () => {
  setDbRows((sql) => {
    if (sql.includes("FROM mailboxes")) {
      return [
        { mailbox_id: "mbx-lee", user_id: "u-lee" },
        { mailbox_id: "mbx-park", user_id: "u-park" },
        { mailbox_id: "mbx-choi", user_id: "u-choi" },
      ];
    }
    if (sql.includes("FROM mobile_push_log")) return [{ user_id: "u-choi" }];
    return [];
  });
  pushCalls.length = 0;
  dbCalls.length = 0;
  await notifyNewInboxMails([
    mail("mmsg-1", "mbx-lee"),
    mail("mmsg-2", "mbx-lee"),
    mail("mmsg-3", "mbx-park"),
    mail("mmsg-4", "mbx-choi"),
    mail("mmsg-5", "mbx-shared"),
  ]);
  assert.deepEqual(
    pushCalls.map((c) => [c.userIds, c.payload.event, c.payload.title, c.payload.link, c.payload.appBadge]),
    [
      [["u-lee"], "mail.received", "새 메일 2통", "/mail", true],
      [["u-park"], "mail.received", "새 메일 · 김과장", "/mail?id=mmsg-3", true],
    ]
  );
  // 간격 판정은 mail.received 의 성공 발송만 본다.
  const cooldown = dbCalls.find((c) => c.sql.includes("FROM mobile_push_log"));
  assert.ok(cooldown && /event_key = 'mail.received' AND ok = 1/.test(cooldown.sql));
  const since = Date.parse(String(cooldown.params[1]));
  assert.ok(Math.abs(Date.now() - MAIL_PUSH_COOLDOWN_MS - since) < 5000);
});

test("발송 — DB 오류가 나도 예외를 던지지 않는다(수신 처리 보호)", async () => {
  setDbRows(() => {
    throw new Error("db down");
  });
  pushCalls.length = 0;
  const err = console.error;
  console.error = () => {};
  try {
    await notifyNewInboxMails([mail("mmsg-9")]);
  } finally {
    console.error = err;
  }
  assert.equal(pushCalls.length, 0);
});
