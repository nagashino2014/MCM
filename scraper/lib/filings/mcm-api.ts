/**
 * MCM API 클라이언트 — 신고 대기열(/api/filings) 읽기·상태 변경.
 *
 * 인증은 모바일 앱과 같은 Bearer 토큰(/api/mobile/auth/login → access 60분 / refresh 30일).
 * refresh 토큰만 `data/filings/mcm-auth.json` 에 보관하고, 비밀번호는 저장하지 않는다(프롬프트 입력).
 */
import fs from "node:fs";
import path from "node:path";
import { FILINGS_DIR } from "./config";

export interface FilingField {
  label: string;
  value: string;
  hint?: string;
}
export interface FilingPayload {
  site: "ieps" | "etis";
  screen: string;
  fields: FilingField[];
}
export interface FilingRow {
  filingId: string;
  filingKind: "ieps_staff" | "ieps_agency" | "etis_career";
  triggerKind: string;
  title: string;
  subtitle: string | null;
  occurredOn: string;
  dueOn: string | null;
  status: "pending" | "submitted" | "skipped";
  payload: FilingPayload;
  daysLeft: number | null;
  receiptNo: string | null;
}

interface AuthFile {
  baseUrl: string;
  accessToken: string;
  refreshToken: string;
  /** access 만료 예상(epoch ms) — 여유를 두고 갱신 */
  accessExpiresAt: number;
  user?: { id: string; name: string; email: string };
}

export function authFile(): string {
  return path.join(FILINGS_DIR, "mcm-auth.json");
}

function readAuth(): AuthFile | null {
  try {
    return JSON.parse(fs.readFileSync(authFile(), "utf-8")) as AuthFile;
  } catch {
    return null;
  }
}

function writeAuth(a: AuthFile): void {
  fs.mkdirSync(FILINGS_DIR, { recursive: true });
  fs.writeFileSync(authFile(), JSON.stringify(a, null, 2), { encoding: "utf-8", mode: 0o600 });
}

export function hasMcmAuth(): boolean {
  return readAuth() !== null;
}

/**
 * 터미널 입력 — readline 을 쓰지 않는다.
 * readline 은 파이프 입력을 한꺼번에 삼켜 다음 프롬프트가 굶고, Windows 콘솔에서는 두 번째 인터페이스의
 * 프롬프트가 찍히지 않아 "사번 입력 직후 멈춤"처럼 보였다. stdin 을 직접 읽고 에코도 직접 한다.
 * - TTY: raw 모드로 글자 단위(Enter 완료, Ctrl+C 취소, Backspace 지우기). mask 면 에코하지 않는다.
 * - 파이프: 공유 버퍼에서 줄 단위로 꺼낸다(남은 줄은 다음 프롬프트가 쓴다).
 */
let pipeBuffer = "";

function readInput(question: string, mask: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const out = process.stdout;
    out.write(question);
    stdin.setEncoding("utf8");

    if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
      const takeLine = (): string | null => {
        const nl = pipeBuffer.indexOf("\n");
        if (nl < 0) return null;
        const line = pipeBuffer.slice(0, nl).replace(/\r$/, "");
        pipeBuffer = pipeBuffer.slice(nl + 1);
        return line;
      };
      const ready = takeLine();
      if (ready !== null) {
        out.write(mask ? "\n" : `${ready}\n`);
        resolve(ready);
        return;
      }
      const onData = (chunk: string) => {
        pipeBuffer += chunk;
        const line = takeLine();
        if (line === null) return;
        stdin.removeListener("data", onData);
        stdin.removeListener("end", onEnd);
        stdin.pause();
        out.write(mask ? "\n" : `${line}\n`);
        resolve(line);
      };
      const onEnd = () => {
        stdin.removeListener("data", onData);
        const rest = pipeBuffer;
        pipeBuffer = "";
        out.write("\n");
        resolve(rest.replace(/\r$/, ""));
      };
      stdin.on("data", onData);
      stdin.once("end", onEnd);
      stdin.resume();
      return;
    }

    let value = "";
    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          cleanup();
          out.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          cleanup();
          out.write("\n");
          reject(new Error("입력을 취소했습니다."));
          return;
        }
        if (ch === "\u007f" || ch === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            if (!mask) out.write("\b \b");
          }
          continue;
        }
        if (ch < " ") continue; // 방향키 등 제어 시퀀스는 무시
        value += ch;
        if (!mask) out.write(ch);
      }
    };
    stdin.setRawMode(true);
    stdin.on("data", onData);
    stdin.resume();
  });
}

/** 한 줄 입력(에코). */
export function promptLine(question: string): Promise<string> {
  return readInput(question, false).then((v) => v.trim());
}

/** 비밀번호 입력(에코 없음). */
export function promptSecret(question: string): Promise<string> {
  return readInput(question, true);
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(url, init);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body: body as T };
}

/** 사번/이메일 + 비밀번호로 토큰 발급 후 저장. */
export async function mcmLogin(baseUrl: string, identifier: string, password: string): Promise<AuthFile> {
  const { status, body } = await fetchJson<{
    accessToken?: string;
    refreshToken?: string;
    user?: { id: string; name: string; email: string };
    error?: string;
  }>(`${baseUrl.replace(/\/$/, "")}/api/mobile/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });
  if (status !== 200 || !body?.accessToken || !body.refreshToken) {
    throw new Error(body?.error ?? `MCM 로그인 실패 (HTTP ${status})`);
  }
  const auth: AuthFile = {
    baseUrl: baseUrl.replace(/\/$/, ""),
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    accessExpiresAt: Date.now() + 55 * 60 * 1000,
    user: body.user,
  };
  writeAuth(auth);
  return auth;
}

async function refreshAccess(auth: AuthFile): Promise<AuthFile> {
  const { status, body } = await fetchJson<{ accessToken?: string; refreshToken?: string; error?: string }>(
    `${auth.baseUrl}/api/mobile/auth/refresh`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: auth.refreshToken }),
    }
  );
  if (status !== 200 || !body?.accessToken) {
    throw new Error(
      `MCM 토큰 갱신 실패 (HTTP ${status}) — 'npm run filings -- mcm-login' 으로 다시 로그인하세요.`
    );
  }
  const next: AuthFile = {
    ...auth,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken || auth.refreshToken,
    accessExpiresAt: Date.now() + 55 * 60 * 1000,
  };
  writeAuth(next);
  return next;
}

async function withAuth(): Promise<AuthFile> {
  let auth = readAuth();
  if (!auth) throw new Error("MCM 로그인 정보가 없습니다. 먼저 'npm run filings -- mcm-login' 을 실행하세요.");
  if (Date.now() >= auth.accessExpiresAt) auth = await refreshAccess(auth);
  return auth;
}

async function api<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  let auth = await withAuth();
  const run = (a: AuthFile) =>
    fetchJson<T & { error?: string }>(`${a.baseUrl}${pathname}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${a.accessToken}` },
    });
  let r = await run(auth);
  if (r.status === 401) {
    auth = await refreshAccess(auth);
    r = await run(auth);
  }
  if (r.status < 200 || r.status >= 300) {
    throw new Error(r.body?.error ?? `MCM API ${pathname} 실패 (HTTP ${r.status})`);
  }
  return r.body;
}

export function mcmBaseUrl(): string | null {
  return readAuth()?.baseUrl ?? null;
}

/** 대기 목록(호출 시 MCM 이 재파생) — kind 로 종류 필터. */
export async function listPendingFilings(kind?: string): Promise<FilingRow[]> {
  const qs = new URLSearchParams({ status: "pending", kind: kind || "all" });
  const body = await api<{ filings: FilingRow[] }>(`/api/filings?${qs.toString()}`);
  return body.filings;
}

export async function getFiling(filingId: string): Promise<FilingRow> {
  const body = await api<{ filing: FilingRow }>(`/api/filings/${encodeURIComponent(filingId)}`);
  return body.filing;
}

export async function markFiling(
  filingId: string,
  input: { status: "submitted" | "skipped" | "pending"; receiptNo?: string | null; submittedAt?: string | null; note?: string | null }
): Promise<FilingRow> {
  const body = await api<{ filing: FilingRow }>(`/api/filings/${encodeURIComponent(filingId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return body.filing;
}
