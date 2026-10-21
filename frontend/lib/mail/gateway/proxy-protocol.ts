/**
 * 외부 메일 프로그램 게이트웨이 — PROXY protocol v2 헤더(NLB 대상 그룹 proxy_protocol_v2) 해석.
 * NLB 가 TLS 를 끝내고 평문 TCP 로 넘기면 소켓의 상대 주소는 NLB 가 된다. 실패 잠금·접속기록에
 * 실제 클라이언트 IP 가 필요하므로 연결 첫머리의 v2 헤더에서 원 주소를 꺼낸다.
 * IMAP·SMTP 모두 서버가 먼저 말하므로 헤더 뒤에 클라이언트 바이트가 붙어 오는 일은 없지만, 오면 되돌려 놓는다.
 */
import type { Socket } from "node:net";

const SIG = Buffer.from([0x0d, 0x0a, 0x0d, 0x0a, 0x00, 0x0d, 0x0a, 0x51, 0x55, 0x49, 0x54, 0x0a]);
const MAX_WAIT_MS = 5_000;

export interface ProxyInfo {
  remoteAddress: string;
  remotePort: number;
}

/** v2 헤더 바이트 → 원 주소. 헤더가 덜 왔으면 "more", 형식이 아니면 null. */
export function parseProxyV2(buf: Buffer): { info: ProxyInfo | "local"; length: number } | "more" | null {
  if (buf.length < 16) return SIG.subarray(0, buf.length).equals(buf.subarray(0, Math.min(buf.length, 12))) ? "more" : null;
  if (!buf.subarray(0, 12).equals(SIG)) return null;
  const verCmd = buf[12];
  if (verCmd >> 4 !== 2) return null;
  const fam = buf[13];
  const len = buf.readUInt16BE(14);
  if (buf.length < 16 + len) return "more";
  const total = 16 + len;
  if ((verCmd & 0x0f) === 0) return { info: "local", length: total }; // LOCAL(헬스 체크 등)
  if (fam >> 4 === 1 && len >= 12) {
    const a = buf.subarray(16, 20);
    return { info: { remoteAddress: `${a[0]}.${a[1]}.${a[2]}.${a[3]}`, remotePort: buf.readUInt16BE(24) }, length: total };
  }
  if (fam >> 4 === 2 && len >= 36) {
    const parts: string[] = [];
    for (let i = 0; i < 8; i++) parts.push(buf.readUInt16BE(16 + i * 2).toString(16));
    return { info: { remoteAddress: parts.join(":"), remotePort: buf.readUInt16BE(48) }, length: total };
  }
  return { info: "local", length: total };
}

/**
 * 소켓 첫머리의 v2 헤더를 읽어 원 주소를 돌려준다. 헤더가 없거나 깨졌으면 소켓을 닫고 null.
 * enabled=false 면(로컬 개발) 소켓 주소를 그대로 쓴다.
 */
export function readProxyHeader(socket: Socket, enabled: boolean): Promise<ProxyInfo | null> {
  const direct: ProxyInfo = {
    remoteAddress: String(socket.remoteAddress ?? "unknown").replace(/^::ffff:/, ""),
    remotePort: socket.remotePort ?? 0,
  };
  if (!enabled) return Promise.resolve(direct);
  return new Promise((resolve) => {
    let buf = Buffer.alloc(0);
    let done = false;
    const finish = (v: ProxyInfo | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.removeListener("data", onData);
      socket.removeListener("close", onClose);
      if (!v) socket.destroy();
      resolve(v);
    };
    const onClose = () => finish(null);
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const r = parseProxyV2(buf);
      if (r === "more") return;
      if (r === null) return finish(null);
      socket.pause();
      const rest = buf.subarray(r.length);
      if (rest.length) socket.unshift(rest);
      finish(r.info === "local" ? direct : r.info);
    };
    const timer = setTimeout(() => finish(null), MAX_WAIT_MS);
    socket.on("data", onData);
    socket.once("close", onClose);
  });
}
