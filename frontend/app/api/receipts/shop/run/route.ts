/**
 * 쇼핑몰 전표 수집 — 명령 실행 (로그를 실시간으로 흘려보낸다)
 *
 * 실제 수집은 `scraper/` 의 CLI 가 한다. 로그인 세션과 브라우저가 이 PC 에 있어서
 * 배포 서버에서는 실행할 수 없다 — 로컬에서 띄운 앱에서만 동작한다.
 *
 * 명령·인자는 화이트리스트로만 받는다(임의 명령 실행이 되지 않도록).
 */

import { NextRequest } from "next/server";
import { spawn } from "node:child_process";

import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { shopByKey, scraperDir, localToolsEnabled } from "@/lib/receipts/shops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 허용하는 명령만 받는다 */
const COMMANDS = ["login", "check", "collect", "bulk", "import", "enrich"] as const;
type Command = (typeof COMMANDS)[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REQUEST_ID_RE = /^\d{1,20}$/;

interface RunBody {
  command?: string;
  site?: string;
  from?: string;
  to?: string;
  requestId?: string;
  withText?: boolean;
  pages?: number;
}

/** 요청을 CLI 인자로 옮긴다. 잘못된 값은 여기서 걸러 그대로 넘기지 않는다. */
function buildArgs(body: RunBody): { args: string[]; error?: string } {
  const command = body.command as Command;
  if (!COMMANDS.includes(command)) return { args: [], error: `허용되지 않은 명령입니다: ${body.command}` };

  const shop = shopByKey(body.site || "");
  if (!shop) return { args: [], error: `알 수 없는 사이트입니다: ${body.site}` };

  const args = [command, "--site", shop.key];

  if (command === "collect") {
    if (!body.from || !DATE_RE.test(body.from)) return { args: [], error: "시작일 형식이 올바르지 않습니다." };
    if (!body.to || !DATE_RE.test(body.to)) return { args: [], error: "종료일 형식이 올바르지 않습니다." };
    args.push("--from", body.from, "--to", body.to);

    if (body.pages && Number.isInteger(body.pages) && body.pages > 0 && body.pages <= 100) {
      args.push("--pages", String(body.pages));
    }
    if (body.withText !== false) args.push("--with-text");
  }

  if (command === "bulk") {
    if (!body.requestId || !REQUEST_ID_RE.test(body.requestId)) {
      return { args: [], error: "신청 ID 는 숫자만 입력합니다." };
    }
    args.push("--request-id", body.requestId);
    if (body.withText !== false) args.push("--with-text");
  }

  return { args };
}

export async function POST(req: NextRequest) {
  try {
    await requirePermission("finance.manage");
  } catch (err) {
    return authErrorToResponse(err);
  }

  if (!localToolsEnabled()) {
    return new Response(
      JSON.stringify({ error: "이 기능은 로컬에서 실행한 앱에서만 쓸 수 있습니다.", localOnly: true }),
      { status: 403, headers: { "content-type": "application/json" } }
    );
  }

  const body = (await req.json().catch(() => ({}))) as RunBody;
  const { args, error } = buildArgs(body);
  if (error) {
    return new Response(JSON.stringify({ error }), { status: 400, headers: { "content-type": "application/json" } });
  }

  // Windows 에서 npm 은 npm.cmd 다.
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(npm, ["run", "receipts", "--", ...args], {
    cwd: scraperDir(),
    env: process.env,
    shell: process.platform === "win32",
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      send("start", { command: body.command, site: body.site, args });

      const pipe = (chunk: Buffer) => {
        for (const line of chunk.toString("utf-8").split(/\r?\n/)) {
          if (line.trim()) send("log", { line });
        }
      };

      child.stdout.on("data", pipe);
      child.stderr.on("data", pipe);

      child.on("error", (err) => {
        send("log", { line: `실행 실패: ${err.message}` });
        send("done", { code: -1 });
        controller.close();
      });

      child.on("close", (code) => {
        send("done", { code });
        controller.close();
      });

      // 브라우저에서 창을 닫거나 취소하면 프로세스도 정리한다.
      req.signal.addEventListener("abort", () => {
        child.kill();
        try {
          controller.close();
        } catch {
          // 이미 닫혔으면 무시
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
