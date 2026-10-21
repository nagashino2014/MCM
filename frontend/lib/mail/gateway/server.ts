/**
 * 외부 메일 프로그램 게이트웨이 — 소켓 서버(IMAP·SMTP 제출·헬스 체크).
 * NLB 가 993/465 에서 TLS 를 끝내고 PROXY v2 헤더를 붙여 평문으로 넘긴다(infra/aws/mail-gateway.tf).
 * 포트·한도는 환경변수로 바꾼다:
 *   MAIL_GW_IMAP_PORT(기본 1143) · MAIL_GW_SMTP_PORT(1465) · MAIL_GW_HEALTH_PORT(8025)
 *   MAIL_GW_PROXY_PROTOCOL(기본 1 — 로컬 개발에서 0) · MAIL_GW_HOSTNAME(SMTP 인사말 이름)
 */
import net from "node:net";
import http from "node:http";
import { SMTPServer, type SMTPServerAuthentication, type SMTPServerSession } from "smtp-server";
import { ImapWireReader } from "@/lib/mail/gateway/imap-wire";
import { ImapSession, type SessionIo } from "@/lib/mail/gateway/imap-session";
import { readProxyHeader } from "@/lib/mail/gateway/proxy-protocol";
import { SMTP_MAX_BYTES, SMTP_MAX_RECIPIENTS, submitMessage } from "@/lib/mail/gateway/smtp-submit";
import { SmtpReject } from "@/lib/mail/gateway/smtp-prepare";
import type { GwStore, GwUser } from "@/lib/mail/gateway/types";

const IMAP_MAX_LITERAL = 50 * 1024 * 1024;
const IMAP_MAX_LINE = 64 * 1024;
const MAX_CONN_PER_IP = 40;
const MAX_CONN_TOTAL = 1000;
const AUTH_FAIL_DELAY_MS = 1_000;

export function gwLog(event: string, detail?: Record<string, unknown>): void {
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...(detail ?? {}) }));
}

function smtpError(code: number, message: string): Error {
  return Object.assign(new Error(message), { responseCode: code });
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** IP 별·전체 동시 연결 수 제한. */
class ConnLimiter {
  private perIp = new Map<string, number>();
  private total = 0;
  acquire(ip: string): boolean {
    const n = this.perIp.get(ip) ?? 0;
    if (n >= MAX_CONN_PER_IP || this.total >= MAX_CONN_TOTAL) return false;
    this.perIp.set(ip, n + 1);
    this.total++;
    return true;
  }
  release(ip: string): void {
    const n = (this.perIp.get(ip) ?? 1) - 1;
    if (n <= 0) this.perIp.delete(ip);
    else this.perIp.set(ip, n);
    this.total = Math.max(0, this.total - 1);
  }
}

function socketWriter(socket: net.Socket): (data: Buffer) => Promise<void> {
  return (data) =>
    new Promise((resolve) => {
      if (socket.destroyed || !socket.writable) return resolve();
      if (socket.write(data)) return resolve();
      const done = () => {
        socket.removeListener("drain", done);
        socket.removeListener("close", done);
        resolve();
      };
      socket.once("drain", done);
      socket.once("close", done);
    });
}

export function createImapServer(store: GwStore, opts: { proxy: boolean }): net.Server {
  const limiter = new ConnLimiter();
  const sessions = new Set<ImapSession>();
  const server = net.createServer(async (socket) => {
    socket.on("error", () => undefined);
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 60_000);
    const info = await readProxyHeader(socket, opts.proxy);
    if (!info) return;
    const ip = info.remoteAddress;
    if (!limiter.acquire(ip)) {
      socket.end("* BYE Too many connections\r\n");
      return;
    }
    const io: SessionIo = {
      write: socketWriter(socket),
      close: () => socket.end(),
      remoteIp: ip,
      log: gwLog,
    };
    const session = new ImapSession(store, io, { authFailDelayMs: AUTH_FAIL_DELAY_MS });
    sessions.add(session);
    const reader = new ImapWireReader({
      maxLiteral: IMAP_MAX_LITERAL,
      maxLine: IMAP_MAX_LINE,
      onContinue: () => session.continueLiteral(),
      onCommand: (segs) => session.onCommand(segs),
      onError: (msg) => {
        gwLog("imap.wire_error", { ip, error: msg });
        void io.write(Buffer.from("* BYE Command too long\r\n")).then(() => socket.destroy());
      },
    });
    socket.on("data", (c: Buffer) => reader.feed(c));
    socket.once("close", () => {
      session.dispose();
      sessions.delete(session);
      limiter.release(ip);
    });
    socket.resume();
    await session.start();
  });
  server.on("close", () => sessions.forEach((s) => s.dispose()));
  return server;
}

export function createSmtpServer(store: GwStore, opts: { proxy: boolean; hostname: string }): net.Server {
  const limiter = new ConnLimiter();
  const smtp = new SMTPServer({
    // TLS 는 NLB 가 끝낸다 — secured 로 두면 STARTTLS 를 내세우지 않고 AUTH 를 받는다.
    secure: true,
    secured: true,
    name: opts.hostname,
    banner: "Koensain Mail submission",
    size: SMTP_MAX_BYTES,
    authMethods: ["PLAIN", "LOGIN"],
    disabledCommands: ["STARTTLS"],
    hideSTARTTLS: true,
    disableReverseLookup: true,
    logger: false,
    socketTimeout: 5 * 60_000,
    onAuth(auth: SMTPServerAuthentication, session: SMTPServerSession, cb) {
      store
        .authenticate(String(auth.username ?? ""), String(auth.password ?? ""), session.remoteAddress, "smtp")
        .then(async (r) => {
          if (r.ok) {
            gwLog("smtp.login", { mailboxId: r.user.mailboxId, ip: session.remoteAddress });
            return cb(null, { user: r.user });
          }
          gwLog("smtp.auth_failed", { username: String(auth.username ?? "").toLowerCase(), reason: r.reason, ip: session.remoteAddress });
          await delay(AUTH_FAIL_DELAY_MS);
          cb(smtpError(535, "Authentication failed"));
        })
        .catch((err) => {
          gwLog("smtp.auth_error", { error: (err as Error).message });
          cb(smtpError(454, "Temporary authentication failure"));
        });
    },
    onMailFrom(address, session, cb) {
      const user = session.user as GwUser | undefined;
      if (!user) return cb(smtpError(530, "Authentication required"));
      if (!user.sendAddresses.includes(String(address.address).toLowerCase())) return cb(smtpError(553, "Sender address is not yours"));
      cb();
    },
    onRcptTo(address, session, cb) {
      if (session.envelope.rcptTo.length >= SMTP_MAX_RECIPIENTS) return cb(smtpError(452, "Too many recipients"));
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(address.address))) return cb(smtpError(553, "Invalid recipient address"));
      cb();
    },
    onData(stream, session, cb) {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => {
        const user = session.user as GwUser | undefined;
        if (!user) return cb(smtpError(530, "Authentication required"));
        if ((stream as unknown as { sizeExceeded?: boolean }).sizeExceeded) return cb(smtpError(552, "Message too large"));
        const mailFrom = session.envelope.mailFrom ? String(session.envelope.mailFrom.address) : "";
        const rcpts = session.envelope.rcptTo.map((r) => String(r.address));
        submitMessage(user, mailFrom, rcpts, Buffer.concat(chunks))
          .then((r) => {
            gwLog("smtp.submitted", { mailboxId: user.mailboxId, rcpts: rcpts.length, duplicate: r.duplicate });
            cb(null);
          })
          .catch((err) => {
            if (err instanceof SmtpReject) return cb(smtpError(err.responseCode, err.message));
            gwLog("smtp.submit_error", { mailboxId: user.mailboxId, error: (err as Error).message });
            cb(smtpError(451, "Temporary failure, try again later"));
          });
      });
    },
  });

  return net.createServer(async (socket) => {
    socket.on("error", () => undefined);
    const info = await readProxyHeader(socket, opts.proxy);
    if (!info) return;
    if (!limiter.acquire(info.remoteAddress)) {
      socket.end("421 Too many connections\r\n");
      return;
    }
    socket.once("close", () => limiter.release(info.remoteAddress));
    (smtp as unknown as { connect(s: net.Socket, o: Record<string, unknown>): void }).connect(socket, {
      remoteAddress: info.remoteAddress,
      remotePort: info.remotePort,
    });
    socket.resume();
  });
}

/**
 * NLB 대상 그룹 헬스 체크(HTTP) — 프로세스 생존만 본다. DB 를 찌르면 연결된 클라이언트가 없는 밤에도
 * Aurora 자동 일시정지가 막히므로(30초 주기) DB 는 확인하지 않는다.
 */
export function createHealthServer(): http.Server {
  return http.createServer((req, res) => {
    if (req.url !== "/healthz") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
  });
}

export async function startGateway(store: GwStore): Promise<() => Promise<void>> {
  const proxy = (process.env.MAIL_GW_PROXY_PROTOCOL ?? "1").trim() !== "0";
  const imapPort = Number(process.env.MAIL_GW_IMAP_PORT) || 1143;
  const smtpPort = Number(process.env.MAIL_GW_SMTP_PORT) || 1465;
  const healthPort = Number(process.env.MAIL_GW_HEALTH_PORT) || 8025;
  const hostname = (process.env.MAIL_GW_HOSTNAME ?? "smtp.koensain.app").trim();

  const imap = createImapServer(store, { proxy });
  const smtp = createSmtpServer(store, { proxy, hostname });
  const health = createHealthServer();
  await Promise.all([
    new Promise<void>((r) => imap.listen(imapPort, r)),
    new Promise<void>((r) => smtp.listen(smtpPort, r)),
    new Promise<void>((r) => health.listen(healthPort, r)),
  ]);
  gwLog("gateway.started", { imapPort, smtpPort, healthPort, proxy });
  return async () => {
    await Promise.all([imap, smtp, health].map((s) => new Promise<void>((r) => s.close(() => r()))));
  };
}
