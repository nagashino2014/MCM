import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, withDbWrite } from "@/lib/db";
import { createRun, rows, runSummary, processAuditRun } from "@/lib/ieps/facility-quality-store";
import { enqueueAwsJob, isFacilityQualityQueueEnabled } from "@/lib/ieps/aws-job-queue";
import { FIELDS } from "@scraper/lib/facility-quality/rules";
import { hasPermission } from "@/lib/auth/rbac";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function dispatch(runId: string, mode: string) {
  if (mode === "audit") await processAuditRun(runId);
  else if (isFacilityQualityQueueEnabled()) {
    try { await enqueueAwsJob({ type: "facility-enrich", runId }); }
    catch { await (await getDb()).run("UPDATE facility_quality_runs SET status='interrupted',error='작업 전달 실패. 재개를 눌러 다시 전달하세요' WHERE run_id=$1", [runId]); }
  }
}
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("facility.edit");
    const body = await req.json();
    const mode = body.mode === "enrich" ? "enrich" : "audit";
    const sources = mode === "enrich" ? (Array.isArray(body.sources) ? [...new Set<string>(body.sources)] : ["naver","dart","fsc","bizno"]) : [];
    if (sources.some(s => !["naver","dart","fsc","bizno"].includes(s))) return NextResponse.json({ error: "알 수 없는 정보원" }, { status: 400 });
    if (mode === "enrich" && !sources.length) return NextResponse.json({ error: "정보원을 선택하세요" }, { status: 400 });
    const ids = body.facilityIds === undefined ? undefined : Array.isArray(body.facilityIds) && body.facilityIds.length && body.facilityIds.length <= 10000 && body.facilityIds.every((s: unknown) => typeof s === "string" && s.length < 200) ? body.facilityIds : null;
    if (ids === null) return NextResponse.json({ error: "사업장 목록이 올바르지 않습니다" }, { status: 400 });
    const limit = body.limit == null ? undefined : Number(body.limit);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 10000)) return NextResponse.json({ error: "표본 크기를 확인하세요" }, { status: 400 });
    const runId = await withDbWrite(db => createRun(db, actor.userId, mode, { sources, limit }, ids));
    await dispatch(runId, mode);
    return NextResponse.json({ runId, queueEnabled: isFacilityQualityQueueEnabled(), ...await runSummary(await getDb(), runId) });
  } catch (e) { return authErrorToResponse(e); }
}

export async function GET(req: NextRequest) {
  try {
    if (req.nextUrl.searchParams.get("capabilities") === "1") {
      const actor=await requirePermission("facility.view");
      return NextResponse.json({canEdit:await hasPermission(actor.userId,"facility.edit")});
    }
    await requirePermission("facility.edit");
    const db = await getDb();
    const p = req.nextUrl.searchParams;
    const runId = p.get("runId");
    if (!runId) return NextResponse.json({ runs: await rows(db, "SELECT run_id,mode,status,created_at,error FROM facility_quality_runs ORDER BY created_at DESC LIMIT 30"), queueEnabled: isFacilityQualityQueueEnabled() });
    const field = p.get("field") || null;
    if (field && !FIELDS.includes(field as any)) return NextResponse.json({ error: "알 수 없는 항목" }, { status: 400 });
    const status = p.get("status") || null;
    const offset = Math.max(0, Math.min(10000000, Math.floor(Number(p.get("offset")) || 0)));
    const summary = await runSummary(db, runId);
    const candidateMode = p.get("view") !== "items";
    const condition = candidateMode ? "(run_id=$1 OR ($4::boolean AND run_id IS NULL)) AND ($2::text IS NULL OR field=$2) AND ($3::text IS NULL OR status=$3) AND ($5::text IS NULL OR source=$5)" : "run_id=$1 AND ($2::text IS NULL OR diagnosis ? $2) AND ($3::text IS NULL OR EXISTS(SELECT 1 FROM jsonb_each(diagnosis) d WHERE d.key<>'secondary' AND ($2::text IS NULL OR d.key=$2) AND d.value->>'status'=$3)) AND (NOT $4::boolean OR status='needs_attention') AND ($5::text IS NULL OR outcomes ? $5)";
    const table = candidateMode ? "facility_enrichment_candidates" : "facility_quality_items";
    const params = [runId,field,status,candidateMode ? p.get("ingestion")==="true" : p.get("needsAttention")==="true",p.get("source")||null];
    const records = await rows(db, `SELECT * FROM ${table} WHERE ${condition} ORDER BY ${candidateMode ? "created_at,candidate_id" : "facility_id"} LIMIT 50 OFFSET $6`, [...params,offset]);
    const count = (await rows<{ total: number }>(db, `SELECT count(*)::int AS total FROM ${table} WHERE ${condition}`, params))[0].total;
    return NextResponse.json({ ...summary, records, total: count });
  } catch (e) { return authErrorToResponse(e); }
}

export async function PATCH(req: NextRequest) {
  try {
    await requirePermission("facility.edit");
    const body = await req.json();
    if (typeof body.runId !== "string") return NextResponse.json({ error: "작업 ID 필요" }, { status: 400 });
    const resumed = await withDbWrite(async db => {
      const run = (await rows<{ mode: string }>(db, `UPDATE facility_quality_runs SET status='queued',lease_until=NULL,error=NULL,updated_at=now()
        WHERE run_id=$1 AND (lease_until IS NULL OR lease_until<now()) RETURNING mode`, [body.runId]))[0];
      if (!run) throw Object.assign(new Error("실행 중인 작업은 중복 재개할 수 없습니다"), { status: 409 });
      await db.run("UPDATE facility_quality_items SET status='pending' WHERE run_id=$1 AND status='needs_attention'", [body.runId]);
      return run;
    });
    await dispatch(body.runId, resumed.mode);
    return NextResponse.json({ runId: body.runId, queueEnabled: isFacilityQualityQueueEnabled() });
  } catch (e) { return authErrorToResponse(e); }
}
