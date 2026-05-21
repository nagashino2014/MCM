import { NextRequest } from "next/server";
import { startCollectJob } from "@/lib/ieps/job-runner";
import { enqueueAwsJob, isAwsJobQueueEnabled } from "@/lib/ieps/aws-job-queue";
import type { CollectionConfig } from "@/lib/ieps/types";
import { requireEditor, AuthError } from "@/lib/auth/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StartRequestBody {
  config: CollectionConfig;
  maxPages?: number;
  backendUrl?: string;
  dryRun?: boolean;
  /**
   * @deprecated UI 분리 이후 이 라우트는 항상 `downloadOnly`(스크래핑 + 다운로드까지) 만 수행한다.
   * 옛 호출자가 보내도 무시되며, 파싱은 별도 `/api/parse/start` 라우트로 카테고리별 호출.
   */
  skipParse?: boolean;
}

export async function POST(req: NextRequest) {
  try {
    await requireEditor();
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 500;
    const message = (err as Error).message;
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  let body: StartRequestBody;
  try {
    body = (await req.json()) as StartRequestBody;
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  if (!body || !body.config) {
    return new Response(JSON.stringify({ error: "config is required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  if (isAwsJobQueueEnabled()) {
    try {
      const queued = await enqueueAwsJob({
        type: "collect",
        config: body.config,
        maxPages: body.maxPages,
        backendUrl: body.backendUrl,
        dryRun: body.dryRun,
      });
      return new Response(
        JSON.stringify({ event: "queued", jobId: queued.jobId, mode: "sqs" }),
        { status: 202, headers: { "content-type": "application/json" } }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ error: "queue failed: " + (err as Error).message }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }
  }

  let job;
  try {
    // UI 워크플로 분리 — "수집 시작" 은 이제 스크래핑 + PDF 다운로드까지만 수행하고,
    // OCR 추출/사업장 적재는 카테고리별 `/api/parse/start` 가 담당한다. 여기서 무조건
    // downloadOnly 를 강제해 옛 호출자가 skipParse 를 안 보내도 안전하게 동작하게 한다.
    job = startCollectJob({
      config: body.config,
      maxPages: body.maxPages,
      backendUrl: body.backendUrl,
      dryRun: body.dryRun,
      downloadOnly: true,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "spawn failed: " + (err as Error).message }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // 이미 닫힌 controller 에 enqueue 시 ERR_INVALID_STATE 가 throw 되어 잡 전체가 죽는다.
      // 클라이언트 abort / child exit / cancel() 등 어느 경로로든 close 가 먼저 일어날 수 있고,
      // 그 시점에 stdout/stderr 루프가 아직 다음 라인을 받아 send() 를 부를 수 있어 race 가 흔하다.
      // closed 플래그 + try/catch 로 close 이후 호출은 silent drop.
      let closed = false;
      const send = (event: object) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode("data: " + JSON.stringify(event) + "\n\n"));
        } catch {
          closed = true;
        }
      };
      const closeOnce = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already-closed 등 무시.
        }
      };

      // 클라이언트 abort 시 child kill
      const onAbort = () => {
        // Windows + npx.cmd + shell:true 조합은 SIGTERM 으로 cmd.exe만 죽고
        // 손자 node 프로세스가 orphan 으로 살아남아 backend 호출을 이어가므로
        // 프로세스 트리 전체를 taskkill 로 강제 종료한다.
        try {
          job.killTree();
        } catch {}
        closeOnce();
      };
      req.signal.addEventListener("abort", onAbort);

      send({ event: "started", pid: job.process.pid });

      // stdout: NDJSON 라인을 그대로 SSE 이벤트로
      (async () => {
        for await (const line of job.stdout as AsyncIterable<string>) {
          if (closed) return;
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith("{")) {
            try {
              const parsed = JSON.parse(trimmed);
              send(parsed);
              continue;
            } catch {
              // JSON 파싱 실패 시 그대로 log로
            }
          }
          send({ event: "log", level: "info", message: trimmed });
        }
      })().catch((err) => send({ event: "error", message: String(err) }));

      // stderr: 사람용 로그 — log 이벤트로 노출 (SSE 클라이언트에서 노란색 표시)
      (async () => {
        for await (const line of job.stderr as AsyncIterable<string>) {
          if (closed) return;
          const trimmed = line.trim();
          if (!trimmed) continue;
          const level = /\[error\]/i.test(trimmed)
            ? "error"
            : /\[warn\]/i.test(trimmed)
            ? "warn"
            : "info";
          send({ event: "log", level, message: trimmed });
        }
      })().catch(() => {});

      job.process.on("exit", (code, signal) => {
        send({ event: "exit", code, signal });
        closeOnce();
      });

      job.process.on("error", (err) => {
        send({ event: "error", message: err.message });
      });
    },
    cancel() {
      try {
        job.killTree();
      } catch {}
      job.cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
