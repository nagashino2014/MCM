/**
 * 메일 가져오기(I-3) — IMAP(네이버·다음·지메일 등) 연결·폴더 조회·틱 처리.
 * - 암호화 연결만: 993 즉시 TLS, 143 은 STARTTLS 필수. 인증서 검증을 끄지 않는다.
 * - 직접 입력 호스트는 DNS 해석 뒤 사설·루프백·링크로컬 대역이면 거절하고, 해석한 IP 로 접속(DNS 재바인딩 방지).
 * - 인증 실패는 재시도하지 않는다(원 서버 계정 잠김 방지 — 아마란스는 24시간 10회 실패 시 잠김).
 * - 원 메일함은 읽기 전용(BODY.PEEK, 읽음 표시·삭제·이동 없음).
 * 설계: docs/mail-import-blueprint.md §5.
 */
import { lookup } from "node:dns/promises";
import net from "node:net";
import { ImapFlow, type FetchMessageObject } from "imapflow";
import type { JobRunner } from "@/lib/mail/import/runner";

export const IMAP_PRESETS: Record<string, { label: string; host: string; port: number }> = {
  naver: { label: "네이버", host: "imap.naver.com", port: 993 },
  daum: { label: "다음", host: "imap.daum.net", port: 993 },
  gmail: { label: "지메일", host: "imap.gmail.com", port: 993 },
};

export interface ImapConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
}

export interface ImapFolderInfo {
  path: string;
  name: string;
  specialUse: string | null;
  messages: number;
}

/** 원 서버 로그인 실패 — 사용자 오류(400). 자동 재시도하지 않는다. */
export class ImapAuthError extends Error {
  status = 400;
}

const IMAP_MAX_MESSAGE_BYTES = 100 * 1024 * 1024; // 파일 가져오기와 같은 한 통 상한

/** 사설·루프백·링크로컬·CGNAT·ULA 등 내부 대역인지(IPv4-mapped IPv6 포함). */
export function isPrivateAddress(ip: string): boolean {
  let a = ip.toLowerCase();
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) a = mapped[1];
  if (net.isIPv4(a)) {
    const [p, q] = a.split(".").map(Number);
    return (
      p === 0 || p === 10 || p === 127 || (p === 169 && q === 254) || (p === 172 && q >= 16 && q <= 31) ||
      (p === 192 && q === 168) || (p === 100 && q >= 64 && q <= 127) || p >= 224
    );
  }
  if (net.isIPv6(a)) {
    return a === "::" || a === "::1" || a.startsWith("fe80:") || a.startsWith("fc") || a.startsWith("fd") || a.startsWith("ff");
  }
  return true;
}

/** 호스트·포트 검사 후 접속할 IP 를 돌려준다. */
export async function resolveImapHost(host: string, port: number): Promise<string> {
  const h = String(host ?? "").trim().toLowerCase();
  if (!h || h.length > 253 || !/^[a-z0-9.-]+$/.test(h) || h === "localhost") {
    throw Object.assign(new Error("메일 서버 주소가 올바르지 않습니다."), { status: 400 });
  }
  if (port !== 993 && port !== 143) {
    throw Object.assign(new Error("포트는 993(SSL) 또는 143(STARTTLS)만 쓸 수 있습니다."), { status: 400 });
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(h, { all: true });
  } catch {
    throw Object.assign(new Error(`메일 서버 주소를 찾을 수 없습니다: ${h}`), { status: 400 });
  }
  if (!addrs.length || addrs.some((x) => isPrivateAddress(x.address))) {
    throw Object.assign(new Error("내부망 주소로는 연결할 수 없습니다."), { status: 400 });
  }
  return addrs[0].address;
}

async function connect(cfg: ImapConfig): Promise<ImapFlow> {
  const ip = await resolveImapHost(cfg.host, cfg.port);
  const client = new ImapFlow({
    host: ip,
    servername: cfg.host, // TLS 인증서 검증은 원래 호스트 이름으로
    port: cfg.port,
    secure: cfg.port === 993,
    doSTARTTLS: cfg.port === 143 ? true : undefined,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 120000,
  });
  try {
    await client.connect();
  } catch (err) {
    const e = err as { authenticationFailed?: boolean; responseText?: string; message?: string };
    if (e?.authenticationFailed) {
      throw new ImapAuthError(
        "로그인에 실패했습니다. 메일 계정의 IMAP 사용 설정과 앱 비밀번호를 확인하세요. (자동으로 다시 시도하지 않습니다)"
      );
    }
    throw Object.assign(new Error(`메일 서버에 연결하지 못했습니다: ${e?.responseText || e?.message || "알 수 없는 오류"}`), { status: 400 });
  }
  return client;
}

/** 연결 확인 + 폴더 목록(메일 수 포함). 비밀번호는 저장하지 않는다. */
export async function listImapFolders(cfg: ImapConfig): Promise<ImapFolderInfo[]> {
  const client = await connect(cfg);
  try {
    const list = await client.list({ statusQuery: { messages: true } });
    return list
      .filter((f) => !f.flags.has("\\Noselect") && !f.flags.has("\\NonExistent"))
      .map((f) => ({ path: f.path, name: f.name, specialUse: f.specialUse ?? null, messages: Number(f.status?.messages ?? 0) }));
  } finally {
    await client.logout().catch(() => client.close());
  }
}

interface FolderState {
  uidValidity: string;
  lastUid: number;
}

/** 폴더에서 이번에 가져올 UID 목록(기간·직전 위치 반영). */
async function pendingUids(client: ImapFlow, since: string | null, state: FolderState | undefined): Promise<{ uids: number[]; uidValidity: string }> {
  const uidValidity = String(client.mailbox && typeof client.mailbox === "object" ? client.mailbox.uidValidity : "");
  const last = state && state.uidValidity === uidValidity ? state.lastUid : 0;
  const query: { all?: boolean; since?: Date } = since ? { since: new Date(since) } : { all: true };
  const found = (await client.search(query, { uid: true })) || [];
  return { uids: found.filter((u) => u > last).sort((a, b) => a - b), uidValidity };
}

/** 작업 생성 전 집계 — 선택 폴더의 가져올 메일 수(직전 작업 위치 이후만). */
export async function countImapPending(
  cfg: ImapConfig,
  folders: string[],
  since: string | null,
  prevState: Record<string, FolderState>
): Promise<{ total: number; state: Record<string, FolderState> }> {
  const client = await connect(cfg);
  let total = 0;
  const state: Record<string, FolderState> = {};
  try {
    for (const path of folders) {
      const lock = await client.getMailboxLock(path, { readOnly: true });
      try {
        const r = await pendingUids(client, since, prevState[path]);
        total += r.uids.length;
        // 직전 작업과 같은 UIDVALIDITY 면 이어받고, 바뀌었으면 처음부터(중복은 저장 단계가 걸러 낸다).
        const prev = prevState[path];
        state[path] = { uidValidity: r.uidValidity, lastUid: prev && prev.uidValidity === r.uidValidity ? prev.lastUid : 0 };
      } finally {
        lock.release();
      }
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
  return { total, state };
}

/**
 * IMAP 작업 1틱 — 폴더를 차례로, UID 오름차순으로 50통씩 받아 저장한다.
 * 반환: 'paused'(예산 초과) / 'done' / 'failed'(인증 실패 등) / 'cancelled'.
 */
export async function processImapJob(runner: JobRunner, cfg: ImapConfig): Promise<"paused" | "done" | "failed" | "cancelled"> {
  let client: ImapFlow;
  try {
    client = await connect(cfg);
  } catch (err) {
    if (err instanceof ImapAuthError) {
      await runner.save("failed", { lastError: err.message, finished: true, wipeSecret: true });
      return "failed";
    }
    throw err; // 연결 오류 → 일시 중지 후 재시도
  }
  const folders = runner.options.folders ?? [];
  const state = (runner.cursor.folderState as Record<string, FolderState> | undefined) ?? {};
  let idx = Number(runner.cursor.folder ?? 0);
  try {
    while (idx < folders.length) {
      const f = folders[idx];
      const lock = await client.getMailboxLock(f.path, { readOnly: true });
      try {
        const { uids, uidValidity } = await pendingUids(client, runner.options.since ?? null, state[f.path]);
        if (!state[f.path] || state[f.path].uidValidity !== uidValidity) state[f.path] = { uidValidity, lastUid: 0 };
        for (let i = 0; i < uids.length; i += 50) {
          const batch = uids.slice(i, i + 50);
          for await (const msg of client.fetch(batch.join(","), { uid: true, flags: true, source: true, internalDate: true, size: true }, { uid: true })) {
            await handleMessage(runner, f, msg);
            state[f.path].lastUid = Math.max(state[f.path].lastUid, msg.uid);
            runner.cursor = { ...runner.cursor, folder: idx, folderState: state };
            await runner.save("running");
            if (runner.overBudget() || (await runner.isCancelled())) break;
          }
          if (runner.overBudget()) {
            await runner.save("paused");
            return "paused";
          }
          if (await runner.isCancelled()) return "cancelled";
        }
      } finally {
        lock.release();
      }
      idx += 1;
      runner.cursor = { ...runner.cursor, folder: idx, folderState: state };
      await runner.save("running");
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
  return "done";
}

async function handleMessage(runner: JobRunner, f: { path: string; name: string; sent: boolean }, msg: FetchMessageObject): Promise<void> {
  const where = { file: f.name, entry: `UID ${msg.uid}` };
  if (!msg.source) {
    runner.fail(where, "원문을 받지 못했습니다");
    return;
  }
  if (msg.source.length > IMAP_MAX_MESSAGE_BYTES) {
    runner.fail(where, `크기 초과(${Math.round(msg.source.length / 1048576)}MB)`);
    return;
  }
  const flags = msg.flags ?? new Set<string>();
  // Date 헤더가 없는 메일은 서버 수신 시각(INTERNALDATE)으로.
  const fallbackDate = msg.internalDate ? new Date(msg.internalDate) : undefined;
  await runner.importOne(
    msg.source,
    {
      mailboxId: runner.mailboxId,
      folderId: f.sent ? runner.folders.sentFolder : runner.options.inboxPlacement ? runner.folders.inboxFolder : runner.folders.importFolder,
      direction: f.sent ? "out" : "in",
      isRead: f.sent || flags.has("\\Seen"),
      labels: [`import:${runner.sourceLabel}/${f.name}`],
    },
    where,
    fallbackDate
  );
}
