import assert from "node:assert/strict";
import test from "node:test";
import { ImapWireReader } from "../lib/mail/gateway/imap-wire";
import { ImapSession } from "../lib/mail/gateway/imap-session";
import { encodeMutf7 } from "../lib/mail/gateway/mutf7";
import { describeStructure, parseMime } from "../lib/mail/gateway/mime-tree";
import {
  GwUserError,
  type FlagMode,
  type GwAuthResult,
  type GwFolder,
  type GwMeta,
  type GwSearchInfo,
  type GwSnapshot,
  type GwStore,
  type GwUser,
} from "../lib/mail/gateway/types";

// ── 메모리 저장소(프로토콜 검증용) ───────────────────────────────────

interface MemFolder extends GwFolder {
  entries: Map<number, { messageId: string; flags: string[] }>;
}

const USER: GwUser = {
  userId: "u1",
  mailboxId: "mbx-1",
  address: "kim@koensain.app",
  sendAddresses: ["kim@koensain.app"],
  displayName: "김",
  appPasswordId: "mapw-1",
};

function msg(subject: string, body: string): Buffer {
  return Buffer.from(`From: lee@x.com\r\nTo: kim@koensain.app\r\nSubject: ${subject}\r\nMessage-ID: <${subject}@x.com>\r\n\r\n${body}\r\n`);
}

class MemStore implements GwStore {
  folders: MemFolder[] = [];
  raws = new Map<string, Buffer>();
  valid = true;
  private seq = 0;

  constructor() {
    const mk = (folderId: string, name: string, systemKind: string | null): MemFolder => ({
      folderId,
      name,
      systemKind,
      uidValidity: 1700000000,
      uidNext: 1,
      entries: new Map(),
    });
    this.folders.push(mk("f-in", "INBOX", "inbox"), mk("f-sent", "보낸편지함", "sent"), mk("f-trash", "휴지통", "trash"), mk("f-p", "프로젝트", null));
  }

  put(folderId: string, raw: Buffer, flags: string[] = []): number {
    const id = `m${++this.seq}`;
    this.raws.set(id, raw);
    return this.place(folderId, id, flags);
  }

  private place(folderId: string, messageId: string, flags: string[]): number {
    const f = this.folders.find((x) => x.folderId === folderId)!;
    const uid = f.uidNext++;
    f.entries.set(uid, { messageId, flags: [...flags] });
    return uid;
  }

  private folder(id: string): MemFolder {
    const f = this.folders.find((x) => x.folderId === id);
    if (!f) throw new GwUserError("Mailbox does not exist");
    return f;
  }

  async authenticate(u: string, p: string): Promise<GwAuthResult> {
    return u === "kim@koensain.app" && p.replace(/\s/g, "") === "abcdefghijkmnopq" ? { ok: true, user: USER } : { ok: false, reason: "invalid" };
  }
  async stillValid(): Promise<boolean> {
    return this.valid;
  }
  async listFolders(): Promise<GwFolder[]> {
    return this.folders.map(({ entries: _e, ...f }) => ({ ...f }));
  }
  async snapshot(_u: GwUser, folderId: string): Promise<GwSnapshot> {
    const f = this.folder(folderId);
    const { entries, ...folder } = f;
    return {
      folder: { ...folder },
      entries: [...entries].sort((a, b) => a[0] - b[0]).map(([uid, e]) => ({ uid, messageId: e.messageId, flags: [...e.flags] })),
    };
  }
  async loadMeta(_u: GwUser, ids: string[]): Promise<Map<string, GwMeta>> {
    const out = new Map<string, GwMeta>();
    for (const id of ids) {
      const raw = this.raws.get(id);
      if (!raw) continue;
      const tree = parseMime(raw);
      out.set(id, { internalDate: new Date("2026-10-20T01:00:00Z"), size: raw.length, header: raw.subarray(0, tree.headerEnd), structure: describeStructure(raw, tree) });
    }
    return out;
  }
  async loadRaw(_u: GwUser, id: string): Promise<Buffer> {
    return this.raws.get(id)!;
  }
  async searchInfo(_u: GwUser, folderId: string): Promise<Map<number, GwSearchInfo>> {
    const out = new Map<number, GwSearchInfo>();
    for (const [uid, e] of this.folder(folderId).entries) {
      const raw = this.raws.get(e.messageId)!.toString();
      out.set(uid, {
        internalDate: new Date("2026-10-20T01:00:00Z"),
        sentDate: null,
        size: raw.length,
        subject: raw.match(/Subject: (.*)/)![1],
        from: "lee@x.com",
        to: "kim@koensain.app",
        cc: "",
        bcc: "",
        messageId: "",
      });
    }
    return out;
  }
  async bodySearch(_u: GwUser, folderId: string, term: string): Promise<Set<number>> {
    const out = new Set<number>();
    for (const [uid, e] of this.folder(folderId).entries) if (this.raws.get(e.messageId)!.toString().includes(term)) out.add(uid);
    return out;
  }
  async setFlags(_u: GwUser, folderId: string, uids: number[], mode: FlagMode, flags: string[]): Promise<Map<number, string[]>> {
    const out = new Map<number, string[]>();
    const f = this.folder(folderId);
    for (const uid of uids) {
      const e = f.entries.get(uid);
      if (!e) continue;
      if (mode === "set") e.flags = [...flags];
      else if (mode === "add") e.flags = [...new Set([...e.flags, ...flags])];
      else e.flags = e.flags.filter((x) => !flags.includes(x));
      out.set(uid, [...e.flags]);
    }
    return out;
  }
  async copy(_u: GwUser, src: string, uids: number[], dest: string): Promise<[number, number][]> {
    const f = this.folder(src);
    return uids.filter((u) => f.entries.has(u)).map((u) => [u, this.place(dest, f.entries.get(u)!.messageId, f.entries.get(u)!.flags)]);
  }
  async move(u: GwUser, src: string, uids: number[], dest: string): Promise<[number, number][]> {
    const pairs = await this.copy(u, src, uids, dest);
    for (const [s] of pairs) this.folder(src).entries.delete(s);
    return pairs;
  }
  async expunge(_u: GwUser, folderId: string, uids?: number[]): Promise<number[]> {
    const f = this.folder(folderId);
    const gone: number[] = [];
    for (const [uid, e] of f.entries) {
      if (e.flags.includes("\\Deleted") && (!uids || uids.includes(uid))) {
        f.entries.delete(uid);
        gone.push(uid);
      }
    }
    return gone;
  }
  async append(_u: GwUser, folderId: string, raw: Buffer, flags: string[]): Promise<{ uid: number; uidValidity: number }> {
    return { uid: this.put(folderId, raw, flags), uidValidity: this.folder(folderId).uidValidity };
  }
  async createFolder(_u: GwUser, name: string): Promise<void> {
    this.folders.push({ folderId: `f-${name}`, name, systemKind: null, uidValidity: 1700000001, uidNext: 1, entries: new Map() });
  }
  async renameFolder(_u: GwUser, folderId: string, newName: string): Promise<void> {
    this.folder(folderId).name = newName;
  }
  async deleteFolder(_u: GwUser, folderId: string): Promise<void> {
    this.folders = this.folders.filter((f) => f.folderId !== folderId);
  }
}

// ── 세션 하네스 ─────────────────────────────────────────────────────

class Client {
  out = "";
  closed = false;
  session: ImapSession;
  reader: ImapWireReader;
  private n = 0;

  constructor(store: GwStore) {
    this.session = new ImapSession(
      store,
      {
        write: async (b) => {
          this.out += b.toString("utf8");
        },
        close: () => {
          this.closed = true;
        },
        remoteIp: "127.0.0.1",
        log: () => undefined,
      },
      { idlePollMs: 15, revalidateMs: 1_000_000, autoLogoutMs: 1_000_000, authFailDelayMs: 0 }
    );
    this.reader = new ImapWireReader({
      maxLiteral: 1_000_000,
      maxLine: 100_000,
      onContinue: () => this.session.continueLiteral(),
      onCommand: (s) => this.session.onCommand(s),
      onError: (m) => {
        throw new Error(m);
      },
    });
  }

  async waitFor(pred: (s: string) => boolean, from: number): Promise<string> {
    for (let i = 0; i < 300; i++) {
      const s = this.out.slice(from);
      if (pred(s)) return s;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error("응답 대기 시간 초과:\n" + this.out.slice(from));
  }

  /** 태그 붙여 보내고 완료 응답까지의 출력. */
  async cmd(text: string): Promise<string> {
    const tag = `T${++this.n}`;
    const from = this.out.length;
    this.reader.feed(Buffer.from(`${tag} ${text}\r\n`));
    const s = await this.waitFor((x) => new RegExp(`^${tag} (OK|NO|BAD)`, "m").test(x), from);
    return s;
  }

  raw(text: string): void {
    this.reader.feed(Buffer.from(text));
  }
}

async function loggedIn(store: MemStore): Promise<Client> {
  const c = new Client(store);
  await c.session.start();
  assert.match(c.out, /^\* OK \[CAPABILITY IMAP4rev1 .*\] Koensain Mail IMAP ready\r\n$/);
  const r = await c.cmd('LOGIN kim@koensain.app "abcd efgh ijkm nopq"');
  assert.match(r, /OK \[CAPABILITY .*\] Logged in/);
  return c;
}

test("인증: 틀린 비밀번호·AUTHENTICATE PLAIN(SASL-IR)·LOGIN 메커니즘", async () => {
  const store = new MemStore();
  const c = new Client(store);
  await c.session.start();
  assert.match(await c.cmd("SELECT INBOX"), /BAD Not authenticated/);
  assert.match(await c.cmd("LOGIN kim@koensain.app wrong"), /NO \[AUTHENTICATIONFAILED\]/);
  const plain = Buffer.from("\0kim@koensain.app\0abcdefghijkmnopq").toString("base64");
  assert.match(await c.cmd(`AUTHENTICATE PLAIN ${plain}`), /OK \[CAPABILITY/);
  c.session.dispose();

  const d = new Client(store);
  await d.session.start();
  const from = d.out.length;
  d.raw("A AUTHENTICATE LOGIN\r\n");
  await d.waitFor((s) => s.includes("+ VXNlcm5hbWU6"), from);
  d.raw(Buffer.from("kim@koensain.app").toString("base64") + "\r\n");
  await d.waitFor((s) => s.includes("+ UGFzc3dvcmQ6"), from);
  d.raw(Buffer.from("abcdefghijkmnopq").toString("base64") + "\r\n");
  await d.waitFor((s) => /^A OK/m.test(s), from);
  d.session.dispose();
});

test("LIST·STATUS·SELECT·UID FETCH·STORE·SEARCH", async () => {
  const store = new MemStore();
  store.put("f-in", msg("first", "hello body"), ["\\Seen"]);
  store.put("f-in", msg("second", "계약 검토"));
  const c = await loggedIn(store);

  const list = await c.cmd('LIST "" "*"');
  assert.ok(list.includes('* LIST (\\HasNoChildren) "/" "INBOX"'));
  assert.ok(list.includes(`* LIST (\\HasNoChildren \\Sent) "/" "${encodeMutf7("보낸편지함")}"`), list);
  assert.ok(list.includes("\\Trash"));
  assert.match(await c.cmd('LIST "" ""'), /\* LIST \(\\Noselect\) "\/" ""/);

  assert.match(await c.cmd("STATUS INBOX (MESSAGES UNSEEN UIDNEXT UIDVALIDITY)"), /\* STATUS "INBOX" \(MESSAGES 2 UNSEEN 1 UIDNEXT 3 UIDVALIDITY 1700000000\)/);

  const sel = await c.cmd("SELECT INBOX");
  assert.ok(sel.includes("* 2 EXISTS"));
  assert.ok(sel.includes("* OK [UNSEEN 2]"));
  assert.ok(sel.includes("* OK [UIDVALIDITY 1700000000]"));
  assert.match(sel, /OK \[READ-WRITE\] SELECT completed/);

  const f1 = await c.cmd("UID FETCH 1:* (FLAGS RFC822.SIZE BODY.PEEK[HEADER.FIELDS (SUBJECT)])");
  assert.ok(f1.includes('* 1 FETCH (UID 1 FLAGS (\\Seen) RFC822.SIZE '), f1);
  assert.ok(f1.includes("BODY[HEADER.FIELDS (SUBJECT)] {19}\r\nSubject: second\r\n\r\n)"), f1);

  // 본문 FETCH(PEEK 아님)는 \Seen 을 붙인다.
  const f2 = await c.cmd("FETCH 2 (BODY[TEXT])");
  assert.ok(f2.includes("FLAGS (\\Seen)"), f2);
  assert.ok(f2.includes("BODY[TEXT] {15}\r\n계약 검토\r\n"), f2);

  assert.match(await c.cmd("STORE 2 -FLAGS (\\Seen)"), /\* 2 FETCH \(FLAGS \(\)\)/);
  assert.match(await c.cmd("UID STORE 1 +FLAGS.SILENT (\\Flagged $Label1)"), /^T\d+ OK/m);
  assert.deepEqual(store.folders[0].entries.get(1)!.flags, ["\\Seen", "\\Flagged", "$Label1"]);

  assert.match(await c.cmd("SEARCH UNSEEN"), /\* SEARCH 2\r\n/);
  assert.match(await c.cmd("UID SEARCH CHARSET UTF-8 BODY 계약"), /\* SEARCH 2\r\n/);
  assert.match(await c.cmd("SEARCH FLAGGED SUBJECT first"), /\* SEARCH 1\r\n/);
  assert.match(await c.cmd("FETCH 9 FLAGS"), /BAD Invalid message sequence number/);
  c.session.dispose();
});

test("COPY·MOVE·EXPUNGE·APPEND(동기 리터럴)·폴더 관리", async () => {
  const store = new MemStore();
  store.put("f-in", msg("a", "1"));
  store.put("f-in", msg("b", "2"));
  store.put("f-in", msg("c", "3"));
  const c = await loggedIn(store);
  await c.cmd("SELECT INBOX");

  assert.match(await c.cmd(`UID COPY 1 "${encodeMutf7("프로젝트")}"`), /OK \[COPYUID 1700000000 1 1\] UID COPY completed/);
  const mv = await c.cmd(`UID MOVE 2 ${encodeMutf7("휴지통")}`);
  assert.ok(mv.includes("* OK [COPYUID 1700000000 2 1] Moved\r\n* 2 EXPUNGE\r\n"), mv);
  assert.equal(store.folders[2].entries.size, 1);

  assert.match(await c.cmd("STORE 1 +FLAGS (\\Deleted)"), /\* 1 FETCH \(FLAGS \(\\Deleted\)\)/);
  assert.ok((await c.cmd("EXPUNGE")).includes("* 1 EXPUNGE\r\n"));
  assert.equal(store.folders[0].entries.size, 1);

  assert.match(await c.cmd("COPY 1 NoSuchBox"), /NO \[TRYCREATE\]/);

  // APPEND — 동기 리터럴: "+" 계속 응답 뒤 본문
  const body = "From: kim@koensain.app\r\nSubject: sent\r\n\r\nhi\r\n";
  const from = c.out.length;
  c.raw(`A9 APPEND "${encodeMutf7("보낸편지함")}" (\\Seen) "21-Oct-2026 09:00:00 +0900" {${Buffer.byteLength(body)}}\r\n`);
  await c.waitFor((s) => s.includes("+ Ready"), from);
  c.raw(body + "\r\n");
  const ap = await c.waitFor((s) => /^A9 (OK|NO|BAD)/m.test(s), from);
  assert.match(ap, /A9 OK \[APPENDUID 1700000000 1\] APPEND completed/);
  assert.deepEqual(store.folders[1].entries.get(1)!.flags, ["\\Seen"]);

  assert.match(await c.cmd(`CREATE 2026/${encodeMutf7("정산")}`), /OK CREATE/);
  assert.ok((await c.cmd('LIST "" "2026/%"')).includes(`"2026/${encodeMutf7("정산")}"`));
  assert.match(await c.cmd("RENAME INBOX x"), /NO \[CANNOT\]/);
  assert.match(await c.cmd(`DELETE ${encodeMutf7("휴지통")}`), /NO \[CANNOT\]/);
  assert.match(await c.cmd(`DELETE 2026/${encodeMutf7("정산")}`), /OK DELETE/);
  c.session.dispose();
});

test("IDLE: 다른 연결의 새 메일·플래그·삭제를 알리고 DONE 으로 끝난다", async () => {
  const store = new MemStore();
  store.put("f-in", msg("a", "1"));
  store.put("f-in", msg("b", "2"));
  const c = await loggedIn(store);
  await c.cmd("SELECT INBOX");
  const from = c.out.length;
  c.raw("I1 IDLE\r\n");
  await c.waitFor((s) => s.includes("+ idling"), from);
  store.put("f-in", msg("new", "3"));
  store.folders[0].entries.get(2)!.flags = ["\\Seen"];
  store.folders[0].entries.delete(1);
  const s = await c.waitFor((x) => x.includes("EXISTS"), from);
  assert.ok(s.includes("* 1 EXPUNGE\r\n"), s);
  assert.ok(s.includes("* 1 FETCH (UID 2 FLAGS (\\Seen))"), s);
  assert.ok(s.includes("* 2 EXISTS"), s);
  c.raw("DONE\r\n");
  await c.waitFor((x) => x.includes("I1 OK IDLE terminated"), from);
  c.session.dispose();
});

test("앱 비밀번호 폐기·퇴사 시 다음 확인에서 BYE", async () => {
  const store = new MemStore();
  const c = new Client(store);
  (c.session as unknown as { opts: { revalidateMs: number } }).opts.revalidateMs = 0;
  await c.session.start();
  await c.cmd("LOGIN kim@koensain.app abcdefghijkmnopq");
  store.valid = false;
  const from = c.out.length;
  c.raw("X1 NOOP\r\n");
  await c.waitFor((s) => s.includes("* BYE Access revoked"), from);
  assert.equal(c.closed, true);
  c.session.dispose();
});
