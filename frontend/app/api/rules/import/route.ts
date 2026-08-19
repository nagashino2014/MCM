// POST /api/rules/import — 사규 HWPX 업로드 → 조문 IR 파싱 → draft 판 생성(RB-P0).
// 파싱은 결정론적이라(lib/rules/import.ts) 실패해도 재현된다. 경고는 저장해 두고
// 검수 화면(/rules/admin)에서 사람이 확인·수정한 뒤 발행한다.

import { NextRequest, NextResponse } from "next/server";
import { recordAuditLog } from "@/lib/auth/audit";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { importRuleHwpx } from "@/lib/rules/import";
import { createDraftVersion } from "@/lib/rules/store";
import { putContractDocument, sanitizeFilename } from "@/lib/storage/contract-document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 30 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission("rules.manage");
    const form = await req.formData();
    const file = form.get("file");
    const docId = String(form.get("docId") ?? "work-rules").trim() || "work-rules";
    const revisionNote = String(form.get("revisionNote") ?? "").trim() || null;
    const effectiveDate = String(form.get("effectiveDate") ?? "").trim() || null;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "HWPX 파일을 선택해 주세요." }, { status: 400 });
    }
    if (!/\.hwpx$/i.test(file.name)) {
      return NextResponse.json(
        { error: "HWPX 파일만 임포트할 수 있습니다. 한글에서 '다른 이름으로 저장 → HWPX'로 변환해 주세요." },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "파일이 너무 큽니다(최대 30MB)." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    let parsed;
    try {
      parsed = await importRuleHwpx(new Uint8Array(buffer));
    } catch (err) {
      const message = err instanceof Error ? err.message : "원문을 해석하지 못했습니다.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (!parsed.stats.articles) {
      return NextResponse.json(
        { error: "조문을 하나도 찾지 못했습니다. 사규 원문(HWPX)인지 확인해 주세요." },
        { status: 400 },
      );
    }

    // 원본 보관 — 발행 후에도 원문 대조가 가능해야 한다.
    const storageKey = `rules/${docId}/${Date.now()}-${sanitizeFilename(file.name)}`;
    const stored = await putContractDocument(storageKey, buffer, file.type || "application/octet-stream");

    const version = await createDraftVersion({
      docId,
      body: parsed.body,
      warnings: parsed.warnings,
      effectiveDate,
      revisionNote,
      sourceFileKey: stored.storageKey,
      actorUserId: ctx.userId,
    });

    await recordAuditLog({
      actorUserId: ctx.userId,
      action: "rule_version_import",
      targetTable: "rule_versions",
      targetId: version.versionId,
      after: { docId, version: version.version, stats: parsed.stats, warnings: parsed.warnings.length },
    });

    return NextResponse.json({ version, stats: parsed.stats, warnings: parsed.warnings });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
