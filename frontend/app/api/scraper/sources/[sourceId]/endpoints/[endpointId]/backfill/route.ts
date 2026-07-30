import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getEndpoint, getSource, updateEndpoint } from "@/lib/scraper/sources-store";
import {
  buildChunkConfig,
  doneMonths,
  isFreshProgress,
  isValidYm,
  nextYm,
  totalMonths,
  type BackfillState,
  type ChunkProgress,
} from "@/lib/scraper/backfill";
import { collectBidSource } from "@/lib/bid/bid-sink";
import { collectCustomSource } from "@/lib/intel/custom-sink";
import type { ScraperEndpointRow, ScraperSourceRow } from "@/lib/scraper/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// step 은 즉시 반환(202)하고 청크 수집은 백그라운드에서 이어진다 — ALB 300s 한도와 무관.
export const maxDuration = 300;

interface Ctx {
  params: Promise<{ sourceId: string; endpointId: string }>;
}

function asState(v: unknown): BackfillState | null {
  const s = v as BackfillState | null;
  if (!s || typeof s !== "object" || !s.from || !s.to || !s.cursor) return null;
  return s;
}

// step 동시 실행 방지(단일 컨테이너) — 백그라운드 실행 중 재요청이 같은 달을 이중 수집하지 않게 막는다.
const inFlight = new Set<string>();

function progressOf(s: BackfillState) {
  const total = totalMonths(s.from, s.to);
  const done = s.status === "done" ? total : Math.min(total, doneMonths(s.from, s.cursor));
  return { done, total };
}

/** 진행 중(백그라운드 실행 또는 최근 갱신된 chunk_progress) 여부. */
function isRunningNow(endpointId: string, s: BackfillState | null): boolean {
  return inFlight.has(endpointId) || isFreshProgress(s?.chunk_progress);
}

/**
 * 청크 1개를 백그라운드에서 수집한다(응답과 분리 — 클라이언트는 폴링으로 진행률을 본다).
 * 진행 상황은 backfill.chunk_progress 에 주기적으로 기록하고, 완료 시 커서를 전진시킨다.
 */
function runChunkInBackground(
  source: ScraperSourceRow,
  endpoint: ScraperEndpointRow,
  state: BackfillState,
  chunk: string
): void {
  const endpointId = endpoint.endpointId;
  inFlight.add(endpointId);
  const startedAt = new Date().toISOString();
  let lastWrite = 0;
  let progress: ChunkProgress = {
    chunk,
    phase: "fetch",
    page: 0,
    items: 0,
    started_at: startedAt,
    updated_at: startedAt,
  };

  // 진행 기록은 throttle(2초) — 페이지/건수마다 DB 쓰기가 몰리지 않게.
  const writeProgress = (next: Partial<ChunkProgress>, force = false) => {
    progress = { ...progress, ...next, updated_at: new Date().toISOString() };
    const now = Date.now();
    if (!force && now - lastWrite < 2000) return;
    lastWrite = now;
    const snapshot = { ...state, chunk_progress: progress, updated_at: progress.updated_at };
    void updateEndpoint(endpointId, { backfill: snapshot as unknown as Record<string, unknown> }).catch(() => undefined);
  };

  void (async () => {
    try {
      const cfg = buildChunkConfig(endpoint.apiConfig!, chunk);
      const chunkEp: ScraperEndpointRow = { ...endpoint, apiConfig: cfg };
      const onProgress = (p: { phase: "fetch" | "save"; page: number; items: number; total?: number }) =>
        writeProgress(p);
      const result =
        source.purpose === "bid"
          ? await collectBidSource(source, chunkEp, { onProgress })
          : await collectCustomSource(source, chunkEp, { onProgress });

      // 완전 실패(수집 0 + 오류)면 커서를 전진하지 않는다 — 인증키 누락 같은 지속 오류가
      // "빈 완주(done)"로 끝나는 것을 방지. 클라이언트는 stalled 를 보고 중단한다.
      if (result.error && result.scanned === 0) {
        const stalled: BackfillState = {
          ...state,
          status: "idle",
          chunk_progress: null,
          updated_at: new Date().toISOString(),
          last_result: { chunk, scanned: 0, inserted: 0, updated: 0, error: result.error },
        };
        await updateEndpoint(endpointId, { backfill: stalled as unknown as Record<string, unknown> });
        return;
      }
      const nextCursor = nextYm(chunk);
      const finished = totalMonths(nextCursor, state.to) === 0;
      const nextState: BackfillState = {
        ...state,
        cursor: nextCursor,
        status: finished ? "done" : "running",
        chunk_progress: null,
        updated_at: new Date().toISOString(),
        last_result: {
          chunk,
          scanned: result.scanned,
          inserted: result.inserted,
          updated: (result as { updated?: number }).updated ?? 0,
          ...(result.error ? { error: result.error } : {}),
        },
      };
      await updateEndpoint(endpointId, { backfill: nextState as unknown as Record<string, unknown> });
    } catch (err) {
      // 예외(네트워크·파싱 등) — 커서 보존하고 중단 상태로 남긴다(재시작 시 같은 달부터).
      const failed: BackfillState = {
        ...state,
        status: "idle",
        chunk_progress: null,
        updated_at: new Date().toISOString(),
        last_result: {
          chunk,
          scanned: 0,
          inserted: 0,
          updated: 0,
          error: err instanceof Error ? err.message : String(err),
        },
      };
      await updateEndpoint(endpointId, { backfill: failed as unknown as Record<string, unknown> }).catch(() => undefined);
    } finally {
      inFlight.delete(endpointId);
    }
  })();
}

/** 백필 상태 조회 — 폴링 대상(진행률 바). */
export async function GET(_: NextRequest, ctx: Ctx) {
  try {
    await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const { endpointId } = await ctx.params;
    const ep = await getEndpoint(endpointId);
    if (!ep) return NextResponse.json({ error: "엔드포인트를 찾을 수 없습니다." }, { status: 404 });
    const state = asState(ep.backfill);
    return NextResponse.json({
      backfill: state,
      progress: state ? progressOf(state) : null,
      running: isRunningNow(endpointId, state),
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/**
 * 백필 실행 — 기간(from~to, "YYYY-MM")을 월 단위 청크로 순차 수집.
 * action:
 * - "start" { from, to }: cursor=from 으로 상태 저장(running). 수집은 step 이 수행.
 * - "step": cursor 월 1개 청크 수집 → cursor 전진, 끝나면 done. (UI가 done 까지 반복 호출·중단 재개 가능)
 * - "stop": status=idle (cursor 보존 — 재시작 시 이어서).
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const { sourceId, endpointId } = await ctx.params;
    const source = await getSource(sourceId);
    const endpoint = await getEndpoint(endpointId);
    if (!source || !endpoint || endpoint.sourceId !== sourceId) {
      return NextResponse.json({ error: "소스/엔드포인트를 찾을 수 없습니다." }, { status: 404 });
    }
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");

    if (action === "start") {
      const from = String(body?.from ?? "").trim();
      const to = String(body?.to ?? "").trim();
      if (!isValidYm(from) || !isValidYm(to) || totalMonths(from, to) === 0) {
        return NextResponse.json({ error: "기간은 YYYY-MM 형식이며 from ≤ to 여야 합니다." }, { status: 400 });
      }
      if (totalMonths(from, to) > 60) {
        return NextResponse.json({ error: "백필 기간은 최대 60개월까지입니다." }, { status: 400 });
      }
      if (!endpoint.apiConfig?.date_filters?.length) {
        return NextResponse.json({ error: "엔드포인트에 조회기간(날짜) 필터가 설정돼 있어야 백필할 수 있습니다." }, { status: 400 });
      }
      // 동일 기간 재시작이면 cursor 보존(중단 재개), 기간이 바뀌면 처음부터.
      const prev = asState(endpoint.backfill);
      const cursor = prev && prev.from === from && prev.to === to && prev.status !== "done" ? prev.cursor : from;
      const state: BackfillState = {
        from,
        to,
        cursor,
        status: "running",
        chunk_progress: null,
        updated_at: new Date().toISOString(),
      };
      await updateEndpoint(endpointId, { backfill: state as unknown as Record<string, unknown> });
      return NextResponse.json({ backfill: state, progress: progressOf(state) });
    }

    if (action === "stop") {
      const state = asState(endpoint.backfill);
      if (!state) return NextResponse.json({ error: "백필 상태가 없습니다." }, { status: 400 });
      // 진행 중인 청크는 그대로 완주시킨다(중단해도 데이터 정합은 유지) — 상태만 idle 로.
      // 실행 중이면 chunk_progress 는 백그라운드가 계속 갱신하다 완료 시 커서를 전진시킨다.
      const next: BackfillState = { ...state, status: "idle", updated_at: new Date().toISOString() };
      await updateEndpoint(endpointId, { backfill: next as unknown as Record<string, unknown> });
      return NextResponse.json({
        backfill: next,
        progress: progressOf(next),
        running: isRunningNow(endpointId, next),
      });
    }

    if (action === "step") {
      const state = asState(endpoint.backfill);
      if (!state || state.status !== "running") {
        return NextResponse.json({ error: "진행 중인 백필이 없습니다. 먼저 시작하세요." }, { status: 400 });
      }
      // 이미 백그라운드로 이 엔드포인트의 청크를 수집 중 — 이중 수집 방지(폴링으로 진행 확인).
      if (isRunningNow(endpointId, state)) {
        return NextResponse.json(
          { backfill: state, progress: progressOf(state), busy: true, running: true },
          { status: 202 }
        );
      }
      if (totalMonths(state.cursor, state.to) === 0) {
        const doneState: BackfillState = {
          ...state,
          status: "done",
          chunk_progress: null,
          updated_at: new Date().toISOString(),
        };
        await updateEndpoint(endpointId, { backfill: doneState as unknown as Record<string, unknown> });
        return NextResponse.json({ backfill: doneState, progress: progressOf(doneState), done: true });
      }
      // 청크 수집은 백그라운드에서 — 응답은 즉시(202). 대량 월(1~2만 건)도 ALB 300s 한도와 무관.
      const chunk = state.cursor;
      runChunkInBackground(source, endpoint, state, chunk);
      return NextResponse.json(
        { backfill: state, progress: progressOf(state), chunk, accepted: true, running: true },
        { status: 202 }
      );
    }

    return NextResponse.json({ error: "action 은 start|step|stop 이어야 합니다." }, { status: 400 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
