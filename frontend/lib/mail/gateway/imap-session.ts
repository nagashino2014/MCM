/**
 * 외부 메일 프로그램 게이트웨이 — IMAP4rev1 세션(연결 1개 = 세션 1개).
 * 아웃룩·Thunderbird·iOS/안드로이드 메일이 쓰는 범위를 구현한다:
 *   CAPABILITY·ID·NOOP·LOGOUT / LOGIN·AUTHENTICATE(PLAIN·LOGIN) / LIST·LSUB·STATUS·NAMESPACE·
 *   SELECT·EXAMINE·CREATE·DELETE·RENAME·(UN)SUBSCRIBE·APPEND / CHECK·CLOSE·UNSELECT·EXPUNGE·
 *   SEARCH·FETCH·STORE·COPY·MOVE(+UID 형) / IDLE.
 * TLS 는 앞단(NLB)이 끝내므로 STARTTLS 는 없다. 다른 연결(웹·다른 클라이언트)의 변경은
 * NOOP·IDLE(주기 조회)·UID 명령 끝에서 EXISTS·EXPUNGE·FETCH FLAGS 로 알린다.
 */
import {
  astring,
  compressUids,
  imapDateTime,
  inRanges,
  joinOut,
  literal,
  parseImapDateTime,
  parseSequenceSet,
  tokenize,
  tokenText,
  ImapParseError,
  type ImapToken,
  type Out,
  type WireSegment,
} from "@/lib/mail/gateway/imap-wire";
import { decodeMutf7, encodeMutf7 } from "@/lib/mail/gateway/mutf7";
import {
  envelopeFromHeaders,
  extractSection,
  headerOnlySection,
  parseHeaderFields,
  parseMime,
  parseSection,
  serializeEnvelope,
  serializeStructure,
  type MimeNode,
} from "@/lib/mail/gateway/mime-tree";
import { collectBodyTerms, evalSearch, parseSearch, SearchSyntaxError, type SearchMsg } from "@/lib/mail/gateway/imap-search";
import { GwUserError, type FlagMode, type GwFolder, type GwMeta, type GwStore, type GwUser } from "@/lib/mail/gateway/types";

export const CAPABILITIES =
  "IMAP4rev1 LITERAL+ SASL-IR AUTH=PLAIN AUTH=LOGIN ID IDLE NAMESPACE UIDPLUS MOVE UNSELECT SPECIAL-USE CHILDREN";

const SYSTEM_FLAGS = ["\\Answered", "\\Flagged", "\\Deleted", "\\Seen", "\\Draft"];
const SPECIAL_USE: Record<string, string> = {
  sent: "\\Sent",
  drafts: "\\Drafts",
  trash: "\\Trash",
  spam: "\\Junk",
  archive: "\\Archive",
};
const DELIM = "/";

export interface SessionIo {
  write(data: Buffer): Promise<void>;
  close(): void;
  remoteIp: string;
  log(event: string, detail?: Record<string, unknown>): void;
}

export interface SessionOptions {
  /** IDLE 중 변경 확인 주기(ms). */
  idlePollMs: number;
  /** 세션 유효성(앱 비밀번호 폐기·퇴사) 재확인 주기(ms). */
  revalidateMs: number;
  /** 무활동 자동 종료(ms). RFC 3501 은 최소 30분. */
  autoLogoutMs: number;
  /** 로그인 실패 응답 지연(ms) — 무차별 대입 속도를 늦춘다. */
  authFailDelayMs: number;
}

export const DEFAULT_SESSION_OPTIONS: SessionOptions = {
  idlePollMs: 10_000,
  revalidateMs: 60_000,
  autoLogoutMs: 30 * 60_000,
  authFailDelayMs: 1_000,
};

interface Selected {
  folder: GwFolder;
  readOnly: boolean;
  uids: number[];
  ids: Map<number, string>;
  flags: Map<number, string[]>;
}

type Pending =
  | { kind: "idle"; tag: string; timer: NodeJS.Timeout }
  | { kind: "auth-plain"; tag: string }
  | { kind: "auth-login-user"; tag: string }
  | { kind: "auth-login-pass"; tag: string; username: string };

class CmdError extends Error {
  constructor(public readonly status: "NO" | "BAD", message: string, public readonly code?: string) {
    super(message);
  }
}

function flagsOut(flags: string[]): string {
  return "(" + flags.join(" ") + ")";
}

function normFlag(f: string): string {
  const sys = SYSTEM_FLAGS.find((s) => s.toLowerCase() === f.toLowerCase());
  return sys ?? f;
}

/** LIST 패턴(* = 모두, % = 구분자 제외) → 정규식. 비교는 mUTF-7 인코딩 이름으로 한다. */
function patternRegex(pattern: string): RegExp {
  const esc = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/%/g, "[^/]*");
  return new RegExp("^" + esc + "$", "i");
}

export class ImapSession {
  private state: "notauth" | "auth" | "selected" | "logout" = "notauth";
  private user: GwUser | null = null;
  private selected: Selected | null = null;
  private pending: Pending | null = null;
  private queue: Promise<void> = Promise.resolve();
  private lastValidated = 0;
  private logoutTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private readonly opts: SessionOptions;

  constructor(
    private readonly store: GwStore,
    private readonly io: SessionIo,
    opts?: Partial<SessionOptions>
  ) {
    this.opts = { ...DEFAULT_SESSION_OPTIONS, ...(opts ?? {}) };
  }

  async start(): Promise<void> {
    this.touch();
    await this.send(`* OK [CAPABILITY ${CAPABILITIES}] Koensain Mail IMAP ready\r\n`);
  }

  /** 소켓이 닫혔을 때(타이머 정리). */
  dispose(): void {
    this.closed = true;
    if (this.pending?.kind === "idle") clearInterval(this.pending.timer);
    this.pending = null;
    if (this.logoutTimer) clearTimeout(this.logoutTimer);
  }

  /** 계속 응답("+ ...") — 동기 리터럴 수신 전. */
  continueLiteral(): void {
    void this.send("+ Ready for literal data\r\n");
  }

  /** 읽기 계층에서 완성된 명령 한 건. 순서대로 처리한다. */
  onCommand(segments: WireSegment[]): void {
    this.touch();
    // IDLE·AUTHENTICATE 진행 중의 줄은 명령이 아니라 응답이다 — 큐를 기다리지 않고 바로 처리.
    if (this.pending) {
      const line = segments.map((s) => s.data.toString("utf8")).join("").trim();
      void this.onPendingLine(line);
      return;
    }
    this.queue = this.queue.then(() => this.handle(segments)).catch((err) => {
      this.io.log("imap.error", { error: err instanceof Error ? err.message : String(err) });
    });
  }

  private touch(): void {
    if (this.logoutTimer) clearTimeout(this.logoutTimer);
    this.logoutTimer = setTimeout(() => {
      void this.send("* BYE Autologout; idle for too long\r\n").then(() => this.io.close());
    }, this.opts.autoLogoutMs);
    this.logoutTimer.unref?.();
  }

  private async send(data: string | Out[]): Promise<void> {
    if (this.closed) return;
    await this.io.write(typeof data === "string" ? Buffer.from(data, "utf8") : joinOut(data));
  }

  private async handle(segments: WireSegment[]): Promise<void> {
    if (this.closed || this.state === "logout") return;
    let tokens: ImapToken[];
    try {
      tokens = tokenize(segments);
    } catch (err) {
      const tag = segments[0]?.kind === "text" ? segments[0].data.toString("latin1").split(" ")[0] || "*" : "*";
      await this.send(`${tag} BAD ${err instanceof ImapParseError ? "Syntax error" : "Error"}\r\n`);
      return;
    }
    const tag = tokens[0]?.t === "atom" ? tokens[0].v : null;
    if (!tag || !/^[\x21-\x7e]+$/.test(tag) || tag.includes("+")) {
      await this.send("* BAD Invalid tag\r\n");
      return;
    }
    let name = tokenText(tokens[1])?.toUpperCase() ?? "";
    let args = tokens.slice(2);
    let uidMode = false;
    if (name === "UID") {
      uidMode = true;
      name = tokenText(args[0])?.toUpperCase() ?? "";
      args = args.slice(1);
    }
    try {
      if (this.user && Date.now() - this.lastValidated > this.opts.revalidateMs) {
        if (!(await this.revalidate())) return;
      }
      const code = await this.dispatch(tag, name, args, uidMode);
      if (code === null) return; // 명령이 직접 완료 응답을 보냄(IDLE·AUTHENTICATE 대기 등)
      await this.send(`${tag} OK ${code}\r\n`);
    } catch (err) {
      if (err instanceof CmdError) {
        await this.send(`${tag} ${err.status} ${err.code ? `[${err.code}] ` : ""}${err.message}\r\n`);
      } else if (err instanceof GwUserError) {
        await this.send(`${tag} NO ${err.message}\r\n`);
      } else {
        this.io.log("imap.command_failed", { command: name, error: err instanceof Error ? err.message : String(err) });
        await this.send(`${tag} NO [SERVERBUG] Internal error\r\n`);
      }
    }
  }

  private async revalidate(): Promise<boolean> {
    if (!this.user) return true;
    const ok = await this.store.stillValid(this.user).catch(() => true);
    this.lastValidated = Date.now();
    if (!ok) {
      this.io.log("imap.revoked", { mailboxId: this.user.mailboxId });
      await this.send("* BYE Access revoked\r\n");
      this.state = "logout";
      this.io.close();
      return false;
    }
    return true;
  }

  private need(state: "auth" | "selected"): void {
    if (state === "auth" && this.state === "notauth") throw new CmdError("BAD", "Not authenticated");
    if (state === "selected" && this.state !== "selected") throw new CmdError("BAD", "No mailbox selected");
  }

  private async dispatch(tag: string, name: string, args: ImapToken[], uid: boolean): Promise<string | null> {
    if (uid && !["FETCH", "STORE", "COPY", "MOVE", "SEARCH", "EXPUNGE"].includes(name)) {
      throw new CmdError("BAD", "Unknown UID command");
    }
    switch (name) {
      case "CAPABILITY":
        await this.send(`* CAPABILITY ${CAPABILITIES}\r\n`);
        return "CAPABILITY completed";
      case "NOOP":
      case "CHECK":
        if (this.state === "selected") await this.sync(true);
        return `${name} completed`;
      case "LOGOUT":
        await this.send("* BYE Logging out\r\n");
        await this.send(`${tag} OK LOGOUT completed\r\n`);
        this.state = "logout";
        this.io.close();
        return null;
      case "ID":
        await this.send(`* ID ("name" "Koensain Mail")\r\n`);
        return "ID completed";
      case "STARTTLS":
        throw new CmdError("BAD", "TLS is already active");
      case "LOGIN":
        return this.cmdLogin(args);
      case "AUTHENTICATE":
        return this.cmdAuthenticate(tag, args);
      case "NAMESPACE":
        this.need("auth");
        await this.send(`* NAMESPACE (("" "${DELIM}")) NIL NIL\r\n`);
        return "NAMESPACE completed";
      case "LIST":
      case "LSUB":
        this.need("auth");
        await this.cmdList(name, args);
        return `${name} completed`;
      case "STATUS":
        this.need("auth");
        await this.cmdStatus(args);
        return "STATUS completed";
      case "SELECT":
      case "EXAMINE":
        this.need("auth");
        return this.cmdSelect(name === "EXAMINE", args);
      case "CREATE":
        this.need("auth");
        await this.cmdCreate(args);
        return "CREATE completed";
      case "DELETE":
        this.need("auth");
        await this.cmdDelete(args);
        return "DELETE completed";
      case "RENAME":
        this.need("auth");
        await this.cmdRename(args);
        return "RENAME completed";
      case "SUBSCRIBE":
      case "UNSUBSCRIBE":
        this.need("auth");
        return `${name} completed`;
      case "APPEND":
        this.need("auth");
        return this.cmdAppend(args);
      case "IDLE":
        this.need("auth");
        return this.cmdIdle(tag);
      case "CLOSE":
        this.need("selected");
        if (!this.selected!.readOnly) await this.store.expunge(this.user!, this.selected!.folder.folderId);
        this.selected = null;
        this.state = "auth";
        return "CLOSE completed";
      case "UNSELECT":
        this.need("selected");
        this.selected = null;
        this.state = "auth";
        return "UNSELECT completed";
      case "EXPUNGE":
        this.need("selected");
        return this.cmdExpunge(args, uid);
      case "SEARCH":
        this.need("selected");
        await this.cmdSearch(args, uid);
        if (uid) await this.sync(true);
        return `${uid ? "UID " : ""}SEARCH completed`;
      case "FETCH":
        this.need("selected");
        await this.cmdFetch(args, uid);
        if (uid) await this.sync(true);
        return `${uid ? "UID " : ""}FETCH completed`;
      case "STORE":
        this.need("selected");
        await this.cmdStore(args, uid);
        if (uid) await this.sync(true);
        return `${uid ? "UID " : ""}STORE completed`;
      case "COPY":
        this.need("selected");
        return this.cmdCopy(args, uid, false);
      case "MOVE":
        this.need("selected");
        return this.cmdCopy(args, uid, true);
      default:
        throw new CmdError("BAD", "Unknown command");
    }
  }

  // ── 인증 ──────────────────────────────────────────────────────────

  private async login(username: string, password: string): Promise<string> {
    if (this.state !== "notauth") throw new CmdError("BAD", "Already authenticated");
    const res = await this.store.authenticate(username.trim(), password, this.io.remoteIp, "imap");
    if (!res.ok) {
      this.io.log("imap.auth_failed", { username: username.trim().toLowerCase(), reason: res.reason, ip: this.io.remoteIp });
      if (this.opts.authFailDelayMs > 0) await new Promise((r) => setTimeout(r, this.opts.authFailDelayMs));
      throw new CmdError("NO", "Authentication failed", "AUTHENTICATIONFAILED");
    }
    this.user = res.user;
    this.state = "auth";
    this.lastValidated = Date.now();
    this.io.log("imap.login", { mailboxId: res.user.mailboxId, ip: this.io.remoteIp });
    return `[CAPABILITY ${CAPABILITIES}] Logged in`;
  }

  private async cmdLogin(args: ImapToken[]): Promise<string> {
    const u = tokenText(args[0]);
    const p = tokenText(args[1]);
    if (u == null || p == null) throw new CmdError("BAD", "LOGIN needs username and password");
    return this.login(u, p);
  }

  private async cmdAuthenticate(tag: string, args: ImapToken[]): Promise<string | null> {
    if (this.state !== "notauth") throw new CmdError("BAD", "Already authenticated");
    const mech = tokenText(args[0])?.toUpperCase();
    const initial = tokenText(args[1]);
    if (mech === "PLAIN") {
      if (initial != null && initial !== "=") return this.finishPlain(initial);
      this.pending = { kind: "auth-plain", tag };
      await this.send("+ \r\n");
      return null;
    }
    if (mech === "LOGIN") {
      this.pending = { kind: "auth-login-user", tag };
      await this.send("+ VXNlcm5hbWU6\r\n");
      return null;
    }
    throw new CmdError("NO", "Unsupported authentication mechanism");
  }

  private async finishPlain(b64: string): Promise<string> {
    const parts = Buffer.from(b64, "base64").toString("utf8").split("\0");
    if (parts.length !== 3) throw new CmdError("BAD", "Invalid SASL response");
    return this.login(parts[1], parts[2]);
  }

  private async onPendingLine(line: string): Promise<void> {
    const p = this.pending!;
    if (p.kind === "idle") {
      if (line.toUpperCase() !== "DONE") return;
      clearInterval(p.timer);
      this.pending = null;
      await this.send(`${p.tag} OK IDLE terminated\r\n`);
      return;
    }
    this.pending = null;
    const finish = async (fn: () => Promise<string>) => {
      try {
        await this.send(`${p.tag} OK ${await fn()}\r\n`);
      } catch (err) {
        if (err instanceof CmdError) await this.send(`${p.tag} ${err.status} ${err.code ? `[${err.code}] ` : ""}${err.message}\r\n`);
        else await this.send(`${p.tag} NO Authentication failed\r\n`);
      }
    };
    if (line === "*") {
      await this.send(`${p.tag} BAD Authentication cancelled\r\n`);
      return;
    }
    if (p.kind === "auth-plain") {
      await finish(() => this.finishPlain(line));
    } else if (p.kind === "auth-login-user") {
      this.pending = { kind: "auth-login-pass", tag: p.tag, username: Buffer.from(line, "base64").toString("utf8") };
      await this.send("+ UGFzc3dvcmQ6\r\n");
    } else if (p.kind === "auth-login-pass") {
      await finish(() => this.login(p.username, Buffer.from(line, "base64").toString("utf8")));
    }
  }

  // ── 폴더 ──────────────────────────────────────────────────────────

  private wireName(f: GwFolder): string {
    return f.systemKind === "inbox" ? "INBOX" : encodeMutf7(f.name);
  }

  private async findFolder(rawName: string): Promise<GwFolder> {
    const folders = await this.store.listFolders(this.user!);
    const name = rawName.replace(/\/+$/, "");
    const hit =
      name.toUpperCase() === "INBOX"
        ? folders.find((f) => f.systemKind === "inbox")
        : folders.find((f) => f.systemKind !== "inbox" && f.name === decodeMutf7(name));
    if (!hit) throw new CmdError("NO", "Mailbox does not exist", "NONEXISTENT");
    return hit;
  }

  private async cmdList(name: string, args: ImapToken[]): Promise<void> {
    const ref = tokenText(args[0]) ?? "";
    const pat = tokenText(args[1]);
    if (pat == null) throw new CmdError("BAD", "LIST needs reference and pattern");
    if (pat === "") {
      await this.send(`* ${name} (\\Noselect) "${DELIM}" ""\r\n`);
      return;
    }
    const re = patternRegex(ref + pat);
    const folders = await this.store.listFolders(this.user!);
    const names = folders.map((f) => this.wireName(f));
    for (const f of folders) {
      const wire = this.wireName(f);
      if (!re.test(wire)) continue;
      const attrs: string[] = [];
      attrs.push(names.some((n) => n.startsWith(wire + DELIM)) ? "\\HasChildren" : "\\HasNoChildren");
      if (f.systemKind && SPECIAL_USE[f.systemKind]) attrs.push(SPECIAL_USE[f.systemKind]);
      await this.send([`* ${name} (${attrs.join(" ")}) "${DELIM}" `, ...astring(wire), "\r\n"]);
    }
  }

  private async cmdStatus(args: ImapToken[]): Promise<void> {
    const name = tokenText(args[0]);
    const items = args[1]?.t === "list" ? args[1].v.map((t) => tokenText(t)?.toUpperCase() ?? "") : [];
    if (name == null || !items.length) throw new CmdError("BAD", "STATUS needs mailbox and items");
    const folder = await this.findFolder(name);
    const snap = await this.store.snapshot(this.user!, folder.folderId);
    const out: string[] = [];
    for (const it of items) {
      if (it === "MESSAGES") out.push(`MESSAGES ${snap.entries.length}`);
      else if (it === "RECENT") out.push("RECENT 0");
      else if (it === "UIDNEXT") out.push(`UIDNEXT ${snap.folder.uidNext}`);
      else if (it === "UIDVALIDITY") out.push(`UIDVALIDITY ${snap.folder.uidValidity}`);
      else if (it === "UNSEEN") out.push(`UNSEEN ${snap.entries.filter((e) => !e.flags.includes("\\Seen")).length}`);
      else throw new CmdError("BAD", `Unknown status item ${it}`);
    }
    await this.send(["* STATUS ", ...astring(this.wireName(folder)), ` (${out.join(" ")})\r\n`]);
  }

  private async cmdSelect(readOnly: boolean, args: ImapToken[]): Promise<string> {
    const name = tokenText(args[0]);
    if (name == null) throw new CmdError("BAD", "Mailbox name required");
    this.selected = null;
    this.state = "auth";
    const folder = await this.findFolder(name);
    const snap = await this.store.snapshot(this.user!, folder.folderId);
    const sel: Selected = { folder: snap.folder, readOnly, uids: [], ids: new Map(), flags: new Map() };
    for (const e of snap.entries) {
      sel.uids.push(e.uid);
      sel.ids.set(e.uid, e.messageId);
      sel.flags.set(e.uid, e.flags);
    }
    this.selected = sel;
    this.state = "selected";
    const firstUnseen = sel.uids.findIndex((u) => !(sel.flags.get(u) ?? []).includes("\\Seen"));
    await this.send(
      `* FLAGS (${SYSTEM_FLAGS.join(" ")})\r\n` +
        `* OK [PERMANENTFLAGS (${readOnly ? "" : SYSTEM_FLAGS.join(" ") + " \\*"})] Flags permitted\r\n` +
        `* ${sel.uids.length} EXISTS\r\n` +
        `* 0 RECENT\r\n` +
        (firstUnseen >= 0 ? `* OK [UNSEEN ${firstUnseen + 1}] First unseen\r\n` : "") +
        `* OK [UIDVALIDITY ${snap.folder.uidValidity}] UIDs valid\r\n` +
        `* OK [UIDNEXT ${snap.folder.uidNext}] Predicted next UID\r\n`
    );
    return `[${readOnly ? "READ-ONLY" : "READ-WRITE"}] ${readOnly ? "EXAMINE" : "SELECT"} completed`;
  }

  private async cmdCreate(args: ImapToken[]): Promise<void> {
    const name = tokenText(args[0]);
    if (!name) throw new CmdError("BAD", "Mailbox name required");
    const clean = decodeMutf7(name.replace(/\/+$/, ""));
    if (clean.toUpperCase() === "INBOX") throw new CmdError("NO", "Mailbox already exists", "ALREADYEXISTS");
    const folders = await this.store.listFolders(this.user!);
    if (folders.some((f) => f.name === clean)) throw new CmdError("NO", "Mailbox already exists", "ALREADYEXISTS");
    await this.store.createFolder(this.user!, clean);
  }

  private async cmdDelete(args: ImapToken[]): Promise<void> {
    const name = tokenText(args[0]);
    if (name == null) throw new CmdError("BAD", "Mailbox name required");
    const folder = await this.findFolder(name);
    if (folder.systemKind) throw new CmdError("NO", "System mailbox cannot be deleted", "CANNOT");
    if (this.selected?.folder.folderId === folder.folderId) {
      this.selected = null;
      this.state = "auth";
    }
    await this.store.deleteFolder(this.user!, folder.folderId);
  }

  private async cmdRename(args: ImapToken[]): Promise<void> {
    const from = tokenText(args[0]);
    const to = tokenText(args[1]);
    if (from == null || !to) throw new CmdError("BAD", "RENAME needs two names");
    const folder = await this.findFolder(from);
    if (folder.systemKind) throw new CmdError("NO", "System mailbox cannot be renamed", "CANNOT");
    const clean = decodeMutf7(to.replace(/\/+$/, ""));
    const folders = await this.store.listFolders(this.user!);
    if (clean.toUpperCase() === "INBOX" || folders.some((f) => f.name === clean)) {
      throw new CmdError("NO", "Mailbox already exists", "ALREADYEXISTS");
    }
    await this.store.renameFolder(this.user!, folder.folderId, clean);
  }

  private async cmdAppend(args: ImapToken[]): Promise<string> {
    const name = tokenText(args[0]);
    if (name == null) throw new CmdError("BAD", "Mailbox name required");
    let i = 1;
    let flags: string[] = [];
    let date: Date | null = null;
    if (args[i]?.t === "list") {
      flags = (args[i] as { t: "list"; v: ImapToken[] }).v.map((t) => normFlag(tokenText(t) ?? "")).filter(Boolean);
      i++;
    }
    const maybeDate = args[i]?.t === "string" && args[i + 1] ? tokenText(args[i]) : null;
    if (maybeDate != null) {
      date = parseImapDateTime(maybeDate);
      if (!date) throw new CmdError("BAD", "Invalid date-time");
      i++;
    }
    const msg = args[i];
    if (!msg || msg.t !== "string") throw new CmdError("BAD", "Message literal required");
    let folder: GwFolder;
    try {
      folder = await this.findFolder(name);
    } catch {
      throw new CmdError("NO", "Mailbox does not exist", "TRYCREATE");
    }
    const res = await this.store.append(this.user!, folder.folderId, msg.v, flags, date);
    if (this.selected?.folder.folderId === folder.folderId) await this.sync(false);
    return `[APPENDUID ${res.uidValidity} ${res.uid}] APPEND completed`;
  }

  private async cmdIdle(tag: string): Promise<null> {
    const timer = setInterval(() => {
      this.queue = this.queue
        .then(async () => {
          if (this.pending?.kind !== "idle") return;
          if (Date.now() - this.lastValidated > this.opts.revalidateMs && !(await this.revalidate())) return;
          if (this.state === "selected") await this.sync(true);
        })
        .catch((err) => this.io.log("imap.idle_poll_failed", { error: err instanceof Error ? err.message : String(err) }));
    }, this.opts.idlePollMs);
    timer.unref?.();
    // DONE 이 계속 응답보다 먼저 처리되지 않도록 대기 상태를 먼저 둔다.
    this.pending = { kind: "idle", tag, timer };
    await this.send("+ idling\r\n");
    return null;
  }

  // ── 선택된 폴더 ────────────────────────────────────────────────────

  /**
   * 다른 연결의 변경을 알린다. allowExpunge=false 면(비 UID FETCH·STORE·SEARCH 중) 지워진 메일은 다음 기회로 미룬다.
   */
  private async sync(allowExpunge: boolean): Promise<void> {
    const sel = this.selected;
    if (!sel) return;
    const snap = await this.store.snapshot(this.user!, sel.folder.folderId);
    if (this.selected !== sel) return;
    const now = new Map(snap.entries.map((e) => [e.uid, e]));
    if (allowExpunge) {
      for (let i = sel.uids.length - 1; i >= 0; i--) {
        const u = sel.uids[i];
        if (now.has(u)) continue;
        await this.send(`* ${i + 1} EXPUNGE\r\n`);
        sel.uids.splice(i, 1);
        sel.ids.delete(u);
        sel.flags.delete(u);
      }
    }
    for (let i = 0; i < sel.uids.length; i++) {
      const u = sel.uids[i];
      const e = now.get(u);
      if (!e) continue;
      const prev = sel.flags.get(u) ?? [];
      if (prev.length !== e.flags.length || prev.some((f) => !e.flags.includes(f))) {
        sel.flags.set(u, e.flags);
        await this.send(`* ${i + 1} FETCH (UID ${u} FLAGS ${flagsOut(e.flags)})\r\n`);
      }
    }
    const maxUid = sel.uids.length ? sel.uids[sel.uids.length - 1] : 0;
    let added = false;
    for (const e of snap.entries) {
      if (e.uid <= maxUid || sel.ids.has(e.uid)) continue;
      sel.uids.push(e.uid);
      sel.ids.set(e.uid, e.messageId);
      sel.flags.set(e.uid, e.flags);
      added = true;
    }
    if (added) await this.send(`* ${sel.uids.length} EXISTS\r\n`);
    sel.folder = snap.folder;
  }

  /** 시퀀스/UID 집합 → 대상 [seq, uid] 목록(오름차순). */
  private resolveSet(set: string | null, uid: boolean): [number, number][] {
    const sel = this.selected!;
    if (set == null) throw new CmdError("BAD", "Sequence set required");
    const max = uid ? (sel.uids.length ? sel.uids[sel.uids.length - 1] : 0) : sel.uids.length;
    const ranges = parseSequenceSet(set, max);
    if (!ranges) throw new CmdError("BAD", "Invalid sequence set");
    const out: [number, number][] = [];
    sel.uids.forEach((u, i) => {
      if (inRanges(uid ? u : i + 1, ranges)) out.push([i + 1, u]);
    });
    if (!uid && ranges.some(([, hi]) => hi > sel.uids.length)) throw new CmdError("BAD", "Invalid message sequence number");
    return out;
  }

  private async cmdExpunge(args: ImapToken[], uid: boolean): Promise<string> {
    const sel = this.selected!;
    if (sel.readOnly) throw new CmdError("NO", "Mailbox is read-only", "READ-ONLY");
    let only: number[] | undefined;
    if (uid) only = this.resolveSet(tokenText(args[0]), true).map(([, u]) => u);
    const gone = new Set(await this.store.expunge(this.user!, sel.folder.folderId, only));
    for (let i = sel.uids.length - 1; i >= 0; i--) {
      const u = sel.uids[i];
      if (!gone.has(u)) continue;
      await this.send(`* ${i + 1} EXPUNGE\r\n`);
      sel.uids.splice(i, 1);
      sel.ids.delete(u);
      sel.flags.delete(u);
    }
    return `${uid ? "UID " : ""}EXPUNGE completed`;
  }

  private async cmdSearch(args: ImapToken[], uid: boolean): Promise<void> {
    const sel = this.selected!;
    let rest = args;
    if (tokenText(rest[0])?.toUpperCase() === "CHARSET") {
      const cs = tokenText(rest[1])?.toUpperCase();
      if (cs !== "UTF-8" && cs !== "US-ASCII") throw new CmdError("NO", "Unsupported charset", "BADCHARSET (UTF-8 US-ASCII)");
      rest = rest.slice(2);
    }
    let crit;
    try {
      crit = parseSearch(rest);
    } catch (err) {
      throw new CmdError("BAD", err instanceof SearchSyntaxError ? "Invalid search criteria" : "Search error");
    }
    const info = await this.store.searchInfo(this.user!, sel.folder.folderId);
    const bodyHits = new Map<string, Set<number>>();
    for (const [key, term] of collectBodyTerms(crit)) {
      bodyHits.set(key, await this.store.bodySearch(this.user!, sel.folder.folderId, term.value, term.withHeaders));
    }
    const hits: number[] = [];
    const maxUid = sel.uids.length ? sel.uids[sel.uids.length - 1] : 0;
    sel.uids.forEach((u, i) => {
      const meta = info.get(u);
      if (!meta) return;
      const m: SearchMsg = { seq: i + 1, uid: u, flags: sel.flags.get(u) ?? [], ...meta };
      if (evalSearch(crit, m, { maxSeq: sel.uids.length, maxUid, bodyHits })) hits.push(uid ? u : i + 1);
    });
    await this.send(`* SEARCH${hits.length ? " " + hits.join(" ") : ""}\r\n`);
  }

  private async cmdStore(args: ImapToken[], uid: boolean): Promise<void> {
    const sel = this.selected!;
    if (sel.readOnly) throw new CmdError("NO", "Mailbox is read-only", "READ-ONLY");
    const targets = this.resolveSet(tokenText(args[0]), uid);
    const op = tokenText(args[1])?.toUpperCase() ?? "";
    const m = op.match(/^([+-]?)FLAGS(\.SILENT)?$/);
    if (!m) throw new CmdError("BAD", "Invalid STORE item");
    const flagTokens = args[2]?.t === "list" ? args[2].v : args.slice(2);
    const flags = flagTokens.map((t) => normFlag(tokenText(t) ?? "")).filter(Boolean);
    if (flags.some((f) => f.startsWith("\\") && !SYSTEM_FLAGS.includes(f))) throw new CmdError("BAD", "Invalid flag");
    const mode: FlagMode = m[1] === "+" ? "add" : m[1] === "-" ? "remove" : "set";
    if (!targets.length) return;
    const updated = await this.store.setFlags(this.user!, sel.folder.folderId, targets.map(([, u]) => u), mode, flags);
    for (const [seq, u] of targets) {
      const f = updated.get(u);
      if (!f) continue;
      sel.flags.set(u, f);
      if (!m[2]) await this.send(`* ${seq} FETCH (${uid ? `UID ${u} ` : ""}FLAGS ${flagsOut(f)})\r\n`);
    }
  }

  private async cmdCopy(args: ImapToken[], uid: boolean, move: boolean): Promise<string> {
    const sel = this.selected!;
    if (move && sel.readOnly) throw new CmdError("NO", "Mailbox is read-only", "READ-ONLY");
    const targets = this.resolveSet(tokenText(args[0]), uid);
    const destName = tokenText(args[1]);
    if (destName == null) throw new CmdError("BAD", "Destination mailbox required");
    let dest: GwFolder;
    try {
      dest = await this.findFolder(destName);
    } catch {
      throw new CmdError("NO", "Mailbox does not exist", "TRYCREATE");
    }
    const name = move ? "MOVE" : "COPY";
    if (!targets.length) return `${uid ? "UID " : ""}${name} completed`;
    const srcUids = targets.map(([, u]) => u);
    const pairs =
      dest.folderId === sel.folder.folderId && move
        ? srcUids.map((u) => [u, u] as [number, number])
        : move
          ? await this.store.move(this.user!, sel.folder.folderId, srcUids, dest.folderId)
          : await this.store.copy(this.user!, sel.folder.folderId, srcUids, dest.folderId);
    const destSnap = pairs.length ? await this.store.snapshot(this.user!, dest.folderId) : null;
    const copyUid = pairs.length
      ? `COPYUID ${destSnap!.folder.uidValidity} ${compressUids(pairs.map((p) => p[0]))} ${compressUids(pairs.map((p) => p[1]))}`
      : "";
    if (move) {
      if (copyUid) await this.send(`* OK [${copyUid}] Moved\r\n`);
      if (dest.folderId !== sel.folder.folderId) {
        const moved = new Set(pairs.map((p) => p[0]));
        for (let i = sel.uids.length - 1; i >= 0; i--) {
          const u = sel.uids[i];
          if (!moved.has(u)) continue;
          await this.send(`* ${i + 1} EXPUNGE\r\n`);
          sel.uids.splice(i, 1);
          sel.ids.delete(u);
          sel.flags.delete(u);
        }
      }
      return `${uid ? "UID " : ""}MOVE completed`;
    }
    if (dest.folderId === sel.folder.folderId) await this.sync(false);
    return `${copyUid ? `[${copyUid}] ` : ""}${uid ? "UID " : ""}COPY completed`;
  }

  // ── FETCH ─────────────────────────────────────────────────────────

  private async cmdFetch(args: ImapToken[], uid: boolean): Promise<void> {
    const sel = this.selected!;
    const targets = this.resolveSet(tokenText(args[0]), uid);
    const spec = args[1];
    let items: string[];
    if (!spec) throw new CmdError("BAD", "FETCH items required");
    if (spec.t === "list") items = spec.v.map((t) => tokenText(t) ?? "");
    else {
      const one = (tokenText(spec) ?? "").toUpperCase();
      if (one === "ALL") items = ["FLAGS", "INTERNALDATE", "RFC822.SIZE", "ENVELOPE"];
      else if (one === "FAST") items = ["FLAGS", "INTERNALDATE", "RFC822.SIZE"];
      else if (one === "FULL") items = ["FLAGS", "INTERNALDATE", "RFC822.SIZE", "ENVELOPE", "BODY"];
      else items = [tokenText(spec) ?? ""];
    }
    // UID FETCH 응답에는 UID 가 항상 들어간다.
    if (uid && !items.some((x) => x.toUpperCase() === "UID")) items.unshift("UID");

    interface BodyReq {
      label: string;
      section: ReturnType<typeof parseSection>;
      peek: boolean;
      partial: [number, number | null] | null;
      kind: "body" | "rfc822" | "rfc822.header" | "rfc822.text";
    }
    const plain: string[] = [];
    const bodies: BodyReq[] = [];
    for (const raw of items) {
      const up = raw.toUpperCase();
      const bm = raw.match(/^(BODY(?:\.PEEK)?)\[(.*)\](?:<(\d+)(?:\.(\d+))?>)?$/i);
      if (bm) {
        const section = parseSection(bm[2]);
        if (!section) throw new CmdError("BAD", "Invalid section");
        bodies.push({
          label: `BODY[${bm[2]}]`,
          section,
          peek: bm[1].toUpperCase() === "BODY.PEEK",
          partial: bm[3] != null ? [Number(bm[3]), bm[4] != null ? Number(bm[4]) : null] : null,
          kind: "body",
        });
      } else if (up === "RFC822") {
        bodies.push({ label: "RFC822", section: { path: [], part: "", fields: [] }, peek: false, partial: null, kind: "rfc822" });
      } else if (up === "RFC822.HEADER") {
        bodies.push({ label: "RFC822.HEADER", section: { path: [], part: "HEADER", fields: [] }, peek: true, partial: null, kind: "rfc822.header" });
      } else if (up === "RFC822.TEXT") {
        bodies.push({ label: "RFC822.TEXT", section: { path: [], part: "TEXT", fields: [] }, peek: false, partial: null, kind: "rfc822.text" });
      } else if (["UID", "FLAGS", "INTERNALDATE", "RFC822.SIZE", "ENVELOPE", "BODYSTRUCTURE", "BODY"].includes(up)) {
        plain.push(up);
      } else {
        throw new CmdError("BAD", `Unknown FETCH item ${raw}`);
      }
    }
    const needMeta = plain.some((p) => ["INTERNALDATE", "RFC822.SIZE", "ENVELOPE", "BODYSTRUCTURE", "BODY"].includes(p)) || bodies.length > 0;
    const setsSeen = bodies.some((b) => !b.peek) && !sel.readOnly;
    const metas: Map<string, GwMeta> = needMeta
      ? await this.store.loadMeta(this.user!, targets.map(([, u]) => sel.ids.get(u)!).filter(Boolean))
      : new Map();

    for (const [seq, u] of targets) {
      const messageId = sel.ids.get(u);
      if (!messageId) continue;
      const meta = metas.get(messageId);
      if (needMeta && !meta) continue; // 그 사이 지워진 메일
      let flags = sel.flags.get(u) ?? [];
      let flagsChanged = false;
      if (setsSeen && !flags.includes("\\Seen")) {
        const upd = await this.store.setFlags(this.user!, sel.folder.folderId, [u], "add", ["\\Seen"]);
        flags = upd.get(u) ?? [...flags, "\\Seen"];
        sel.flags.set(u, flags);
        flagsChanged = true;
      }
      const parts: Out[] = [`* ${seq} FETCH (`];
      let first = true;
      const sep = () => {
        if (!first) parts.push(" ");
        first = false;
      };
      for (const p of plain) {
        sep();
        if (p === "UID") parts.push(`UID ${u}`);
        else if (p === "FLAGS") parts.push(`FLAGS ${flagsOut(flags)}`);
        else if (p === "INTERNALDATE") parts.push(`INTERNALDATE "${imapDateTime(meta!.internalDate)}"`);
        else if (p === "RFC822.SIZE") parts.push(`RFC822.SIZE ${meta!.size}`);
        else if (p === "ENVELOPE") parts.push("ENVELOPE ", ...serializeEnvelope(envelopeFromHeaders(parseHeaderFields(meta!.header, 0, meta!.header.length))));
        else if (p === "BODYSTRUCTURE") parts.push("BODYSTRUCTURE ", ...serializeStructure(meta!.structure, true));
        else if (p === "BODY") parts.push("BODY ", ...serializeStructure(meta!.structure, false));
      }
      if (flagsChanged && !plain.includes("FLAGS")) {
        sep();
        parts.push(`FLAGS ${flagsOut(flags)}`);
      }
      let raw: Buffer | null = null;
      let tree: MimeNode | null = null;
      for (const b of bodies) {
        let data = headerOnlySection(meta!.header, b.section!);
        if (!data) {
          if (!raw) {
            raw = await this.store.loadRaw(this.user!, messageId);
            tree = parseMime(raw);
          }
          data = extractSection(raw, tree!, b.section!);
        }
        let label = b.label;
        if (b.partial) {
          const [start, len] = b.partial;
          data = data.subarray(Math.min(start, data.length), len != null ? Math.min(start + len, data.length) : data.length);
          label += `<${start}>`;
        }
        sep();
        parts.push(`${label} `, ...literal(data));
      }
      parts.push(")\r\n");
      await this.send(parts);
    }
  }
}
