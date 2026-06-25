import { NextRequest } from "next/server";
import { startCollectJob, type ParseCategory } from "@/lib/ieps/job-runner";
import { enqueueAwsJob, isAwsJobQueueEnabled } from "@/lib/ieps/aws-job-queue";
import { DEFAULT_COLLECTION_CONFIG } from "@/lib/ieps/defaults";
import type { CollectionConfig } from "@/lib/ieps/types";
import { requirePermission, AuthError } from "@/lib/auth/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ParseRequestBody {
  /** 통합허가 / 변경허가 / 연간보고서 중 하나. cli-collect --parse-only 와 동일 어휘. */
  category: ParseCategory;
  /** 선택. 미지정 시 DEFAULT_COLLECTION_CONFIG 사용 (parse-only 모드는 룰을 백엔드 BUILTIN_RULES로 강제). */
  config?: CollectionConfig;
  backendUrl?: string;
  dryRun?: boolean;
}

const ALLOWED_CATEGORIES: readonly ParseCategory[] = [
  "integratedFirst",
  "integratedChange",
  "annualReport",
] as const;

/**
 * data/ieps/raw 아래 이미 다운로드된 PDF 중 카테고리에 해당하는 파일만 파싱+적재한다.
 * - 스크래핑/다운로드 단계는 모두 skip
 * - cli-collect.ts --parse-only=<category> 모드를 spawn 하고 NDJSON → SSE 로 전달
 * - "수집 시작" (다운로드 전용) 과 별도 잡으로 분리해 재파싱 효율을 높인다.
 */
export async function POST(req: NextRequest) {
  try {
    await requirePermission("data.collect", { fallbackRoles: ["editor"] });
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 500;
    const message = (err as Error).message;
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  let body: ParseRequestBody;
  try {
    body = (await req.json()) as ParseRequestBody;
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  if (!body || !ALLOWED_CATEGORIES.includes(body.category)) {
    return new Response(
      JSON.stringify({
        error:
          "category 는 integratedFirst | integratedChange | annualReport 중 하나여야 합니다.",
      }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  if (isAwsJobQueueEnabled()) {
    try {
      const queued = await enqueueAwsJob({
        type: "parse",
        config: body.config ?? DEFAULT_COLLECTION_CONFIG,
        backendUrl: body.backendUrl,
        dryRun: body.dryRun,
        parseOnly: body.category,
      });
      return new Response(
        JSON.stringify({
          event: "queued",
          jobId: queued.jobId,
          mode: "sqs",
          category: body.category,
        }),
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
    job = startCollectJob({
      config: body.config ?? DEFAULT_COLLECTION_CONFIG,
      backendUrl: body.backendUrl,
      dryRun: body.dryRun,
      parseOnly: body.category,
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
          // controller 가 이미 닫힌 경우(레이스). 다음 send 부턴 위 closed 플래그로 막힘.
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

      const onAbort = () => {
        // Windows + npx.cmd + shell:true 조합에서는 SIGTERM 으로 cmd.exe만 죽고 손자 node 가
        // 살아남는 orphan 현상이 있어 프로세스 트리 전체를 taskkill 로 종료한다.
        try {
          job.killTree();
        } catch {}
        closeOnce();
      };
      req.signal.addEventListener("abort", onAbort);

      send({ event: "started", pid: job.process.pid, mode: "parse-only", category: body.category });

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
