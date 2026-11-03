import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "pg";
import { applySenderRuleToNewMail, listSenderRules, normalizeSender, senderGroup, setSenderRule } from "../lib/mail/sender-rules";
import { invalidateDb } from "../lib/db";

// 보낸 사람 [메일 분류 지정] 소급·해제(11-03, 마이그 337).
// 통합 시험은 MAIL_SENDER_RULES_TEST_DATABASE_URL(로컬 일회용 PG, 305·337 적용된 스키마)이 있을 때만 돈다.

test("주소 정규화 — 표시 이름·대소문자·공백 무시", () => {
  assert.equal(normalizeSender("MCM <No-Reply@Koensain.APP>"), "no-reply@koensain.app");
  assert.equal(normalizeSender("  a@b.co "), "a@b.co");
  assert.equal(normalizeSender("이름만"), null);
});

test("MCM 시스템 발신 묶음 — no-reply@·noreply@ 는 한 규칙 키", () => {
  const a = senderGroup("no-reply@koensain.app");
  const b = senderGroup("noreply@koensain.app");
  assert.equal(a.key, b.key);
  assert.deepEqual(new Set(a.addrs), new Set(["no-reply@koensain.app", "noreply@koensain.app"]));
  assert.deepEqual(senderGroup("x@y.com"), { key: "x@y.com", addrs: ["x@y.com"] });
});

const URL_ENV = process.env.MAIL_SENDER_RULES_TEST_DATABASE_URL;

test("독립 PostgreSQL: 분류 지정 소급·새 메일·해제 되돌리기·메일함 격리", { skip: !URL_ENV }, async () => {
  const url = new URL(URL_ENV!);
  assert(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "로컬 일회용 DB 에서만 실행");
  process.env.DATABASE_URL = url.toString();
  process.env.PGSSL = "disable";
  delete process.env.BID_NOTIFY_EMAIL_FROM;
  invalidateDb();
  const db = new Client({ connectionString: url.toString(), ssl: false });
  await db.connect();
  const now = new Date().toISOString();
  const cleanup = async () => {
    await db.query(`DELETE FROM mailboxes WHERE mailbox_id IN ('t-mbA','t-mbB')`);
    await db.query(`DELETE FROM users WHERE user_id IN ('t-uA','t-uB')`);
  };
  try {
    await cleanup();
    await db.query(
      `INSERT INTO users(user_id,email,password_hash,name,role,created_at,updated_at)
       VALUES('t-uA','ta@example.invalid','x','A','member',$1,$1),('t-uB','tb@example.invalid','x','B','member',$1,$1)`,
      [now]
    );
    await db.query(
      `INSERT INTO mailboxes(mailbox_id,user_id,address,local_part,created_at,updated_at)
       VALUES('t-mbA','t-uA','ta@koensain.app','ta',$1,$1),('t-mbB','t-uB','tb@koensain.app','tb',$1,$1)`,
      [now]
    );
    await db.query(
      `INSERT INTO mail_folders(folder_id,mailbox_id,name,system_kind,created_at) VALUES
        ('t-inA','t-mbA','받은편지함','inbox',$1),('t-arA','t-mbA','보관함','archive',$1),
        ('t-sysA','t-mbA','MCM 시스템 메일',NULL,$1),('t-impA','t-mbA','가져온 메일',NULL,$1),
        ('t-inB','t-mbB','받은편지함','inbox',$1),('t-catB','t-mbB','B 분류',NULL,$1)`,
      [now]
    );
    const msgs: [string, string, string, string, string | null, number][] = [
      // id, mailbox, folder, from, category, is_deleted
      ["t-m1", "t-mbA", "t-inA", "no-reply@koensain.app", null, 0],
      ["t-m2", "t-mbA", "t-inA", "NoReply@Koensain.app", null, 0],
      ["t-m3", "t-mbA", "t-inA", "MCM <noreply@koensain.app>", "t-impA", 0],
      ["t-m4", "t-mbA", "t-inA", "other@x.com", null, 0],
      ["t-m5", "t-mbA", "t-arA", "no-reply@koensain.app", null, 0],
      ["t-m6", "t-mbA", "t-inA", "no-reply@koensain.app", null, 1],
      ["t-b1", "t-mbB", "t-inB", "no-reply@koensain.app", null, 0],
    ];
    for (const [id, mb, folder, from, cat, del] of msgs) {
      await db.query(`INSERT INTO mail_messages(message_id,mailbox_id,direction,from_addr,created_at) VALUES($1,$2,'in',$3,$4)`, [id, mb, from, now]);
      await db.query(
        `INSERT INTO mail_message_state(message_id,folder_id,mailbox_id,category_id,is_deleted,created_at) VALUES($1,$2,$3,$4,$5,$6)`,
        [id, folder, mb, cat, del, now]
      );
    }
    const cats = async () =>
      Object.fromEntries(
        (await db.query(`SELECT message_id, category_id FROM mail_message_state WHERE message_id LIKE 't-%' ORDER BY 1`)).rows.map((r: { message_id: string; category_id: string | null }) => [
          r.message_id,
          r.category_id,
        ])
      );

    // 1) 지정 — 받은편지함의 같은 발신(대소문자·표시 이름·시스템 별칭 포함) 전부, 다른 분류에 있던 m3 도 옮긴다.
    assert.deepEqual(await setSenderRule("t-uA", "no-reply@koensain.app", "t-sysA"), { applied: 3, reverted: 0 });
    let c = await cats();
    assert.equal(c["t-m1"], "t-sysA");
    assert.equal(c["t-m2"], "t-sysA");
    assert.equal(c["t-m3"], "t-sysA");
    assert.equal(c["t-m4"], null);
    assert.equal(c["t-m5"], null, "보관함 메일은 그대로");
    assert.equal(c["t-m6"], null, "삭제 표시 메일은 그대로");
    assert.equal(c["t-b1"], null, "다른 사용자 메일함은 그대로");
    const rulesA = await listSenderRules("t-uA");
    assert.deepEqual(new Set(rulesA.map((r) => r.sender)), new Set(["no-reply@koensain.app", "noreply@koensain.app"]));
    assert.deepEqual(await listSenderRules("t-uB"), []);

    // 2) 별칭 주소에서 분류만 바꿔도 같은 규칙 — 처음 라벨(m3=가져온 메일)은 유지된다.
    assert.equal((await setSenderRule("t-uA", "noreply@koensain.app", "t-impA")).applied, 3);
    assert.equal((await db.query(`SELECT count(*)::int n FROM mail_sender_rules WHERE mailbox_id='t-mbA'`)).rows[0].n, 1);
    await setSenderRule("t-uA", "no-reply@koensain.app", "t-sysA");
    const prev = (await db.query(`SELECT message_id, prev_category_id FROM mail_sender_rule_marks WHERE mailbox_id='t-mbA' ORDER BY 1`)).rows;
    assert.deepEqual(prev, [
      { message_id: "t-m1", prev_category_id: null },
      { message_id: "t-m2", prev_category_id: null },
      { message_id: "t-m3", prev_category_id: "t-impA" },
    ]);

    // 3) 다른 사용자의 분류로는 지정 불가.
    await assert.rejects(setSenderRule("t-uA", "no-reply@koensain.app", "t-catB"), /메일 분류를 찾을 수 없습니다/);

    // 4) 새 메일(내부 배달) — 미분류면 규칙 분류로, 이미 다른 분류면 그대로.
    for (const [id, cat] of [["t-m7", null], ["t-m8", "t-impA"]] as const) {
      await db.query(`INSERT INTO mail_messages(message_id,mailbox_id,direction,from_addr,created_at) VALUES($1,'t-mbA','in','noreply@koensain.app',$2)`, [id, now]);
      await db.query(`INSERT INTO mail_message_state(message_id,folder_id,mailbox_id,category_id,created_at) VALUES($1,'t-inA','t-mbA',$2,$3)`, [id, cat, now]);
      await applySenderRuleToNewMail("t-mbA", id, "noreply@koensain.app");
    }
    await applySenderRuleToNewMail("t-mbB", "t-b1", "no-reply@koensain.app");
    c = await cats();
    assert.equal(c["t-m7"], "t-sysA");
    assert.equal(c["t-m8"], "t-impA");
    assert.equal(c["t-b1"], null, "규칙 없는 메일함은 그대로");

    // 5) 해제 전 사용자가 m2 를 직접 다른 분류로 바꿈 → 해제 때 그대로 둔다.
    await db.query(`UPDATE mail_message_state SET category_id='t-impA' WHERE message_id='t-m2'`);
    assert.deepEqual(await setSenderRule("t-uA", "NOREPLY@koensain.app", null), { applied: 0, reverted: 3 });
    c = await cats();
    assert.equal(c["t-m1"], null);
    assert.equal(c["t-m2"], "t-impA");
    assert.equal(c["t-m3"], "t-impA", "원래 분류로 복원");
    assert.equal(c["t-m7"], null);
    assert.equal(c["t-m8"], "t-impA");
    assert.equal((await db.query(`SELECT count(*)::int n FROM mail_sender_rule_marks WHERE mailbox_id='t-mbA'`)).rows[0].n, 0);
    assert.deepEqual(await listSenderRules("t-uA"), []);
  } finally {
    await cleanup();
    await db.end();
    invalidateDb();
  }
});
