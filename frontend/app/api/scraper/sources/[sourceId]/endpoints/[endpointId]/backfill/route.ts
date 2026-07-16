import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getEndpoint, getSource, updateEndpoint } from "@/lib/scraper/sources-store";
import { buildChunkConfig, doneMonths, isValidYm, nextYm, totalMonths, type BackfillState } from "@/lib/scraper/backfill";
import { collectBidSource } from "@/lib/bid/bid-sink";
import { collectCustomSource } from "@/lib/intel/custom-sink";
import type { ScraperEndpointRow } from "@/lib/scraper/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 한 step = 한 달 청크 수집(페이지네이션 포함) — 입찰공고급 대량 월도 커버하도록 여유.
export const maxDuration = 300;

interface Ctx {
  params: Promise<{ sourceId: string; endpointId: string }>;
}

function asState(v: unknown): BackfillState | null {
  const s = v as BackfillState | null;
  if (!s || typeof s !== "object" || !s.from || !s.to || !s.cursor) return null;
  return s;
}

// step 동시 실행 방지(단일 컨테이너 구조) — 대량 월 청크가 ALB 한도(300s)를 넘어 클라이언트가
// 504를 받아도 서버는 수집을 계속한다. 그 사이 재요청이 같은 달을 이중 수집하지 않게 막는다.
const inFlight = new Set<string>();

function progressOf(s: BackfillState) {
  const total = totalMonths(s.from, s.to);
  const done = s.status === "done" ? total : Math.min(total, doneMonths(s.from, s.cursor));
  return { done, total };
}

/** 백필 상태 조회. */
export async function GET(_: NextRequest, ctx: Ctx) {
  try {
    await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const { endpointId } = await ctx.params;
    const ep = await getEndpoint(endpointId);
    if (!ep) return NextResponse.json({ error: "엔드포인트를 찾을 수 없습니다." }, { status: 404 });
    const state = asState(ep.backfill);
    return NextResponse.json({ backfill: state, progress: state ? progressOf(state) : null });
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
      const state: BackfillState = { from, to, cursor, status: "running", updated_at: new Date().toISOString() };
      await updateEndpoint(endpointId, { backfill: state as unknown as Record<string, unknown> });
      return NextResponse.json({ backfill: state, progress: progressOf(state) });
    }

    if (action === "stop") {
      const state = asState(endpoint.backfill);
      if (!state) return NextResponse.json({ error: "백필 상태가 없습니다." }, { status: 400 });
      const next: BackfillState = { ...state, status: "idle", updated_at: new Date().toISOString() };
      await updateEndpoint(endpointId, { backfill: next as unknown as Record<string, unknown> });
      return NextResponse.json({ backfill: next, progress: progressOf(next) });
    }

    if (action === "step") {
      const state = asState(endpoint.backfill);
      if (!state || state.status !== "running") {
        return NextResponse.json({ error: "진행 중인 백필이 없습니다. 먼저 시작하세요." }, { status: 400 });
      }
      // 이 엔드포인트의 step 이 이미 실행 중(504 이후 서버는 계속 수집 중일 수 있음) — 이중 수집 방지.
      if (inFlight.has(endpointId)) {
        return NextResponse.json({ backfill: state, progress: progressOf(state), busy: true });
      }
      if (totalMonths(state.cursor, state.to) === 0) {
        const doneState: BackfillState = { ...state, status: "done", updated_at: new Date().toISOString() };
        await updateEndpoint(endpointId, { backfill: doneState as unknown as Record<string, unknown> });
        return NextResponse.json({ backfill: doneState, progress: progressOf(doneState), done: true });
      }
      const chunk = state.cursor;
      // 청크 실행 — date_filters 를 해당 월 고정값으로 치환(페이지당 500건·상한 100p 는 buildChunkConfig 가 처리).
      const cfg = buildChunkConfig(endpoint.apiConfig!, chunk);
      const chunkEp: ScraperEndpointRow = { ...endpoint, apiConfig: cfg };
      inFlight.add(endpointId);
      let result: Awaited<ReturnType<typeof collectBidSource>> | Awaited<ReturnType<typeof collectCustomSource>>;
      try {
        result =
          source.purpose === "bid"
            ? await collectBidSource(source, chunkEp)
            : await collectCustomSource(source, chunkEp);
      } finally {
        inFlight.delete(endpointId);
      }
      // 완전 실패(수집 0 + 오류)면 커서를 전진하지 않는다 — 인증키 누락 같은 지속 오류가
      // "빈 완주(done)"로 끝나는 것을 방지. 클라이언트는 이 응답을 보고 중단한다.
      if (result.error && result.scanned === 0) {
        const stalled: BackfillState = {
          ...state,
          updated_at: new Date().toISOString(),
          last_result: { chunk, scanned: 0, inserted: 0, updated: 0, error: result.error },
        };
        await updateEndpoint(endpointId, { backfill: stalled as unknown as Record<string, unknown> });
        return NextResponse.json({
          backfill: stalled,
          progress: progressOf(stalled),
          chunk,
          result: stalled.last_result,
          done: false,
          stalled: true,
        });
      }
      const nextCursor = nextYm(chunk);
      const finished = totalMonths(nextCursor, state.to) === 0;
      const nextState: BackfillState = {
        ...state,
        cursor: nextCursor,
        status: finished ? "done" : "running",
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
      return NextResponse.json({
        backfill: nextState,
        progress: progressOf(nextState),
        chunk,
        result: nextState.last_result,
        done: finished,
      });
    }

    return NextResponse.json({ error: "action 은 start|step|stop 이어야 합니다." }, { status: 400 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
