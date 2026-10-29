import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/rbac";
import { recordAuditLog } from "@/lib/auth/audit";
import {
  IMPORT_MAX_BYTES,
  IMPORT_MAX_FILES,
  cleanRemap,
  importLedgerFile,
  listImportItems,
  previewLedgerFile,
  validTarget,
  type ImportResult,
  type ImportTarget,
} from "@/lib/payroll/ledger-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 급여대장 엑셀 가져오기 — multipart: files[] + targets(JSON, 파일 순서대로 {year,month,kind,overwrite,remap}) + mode.
 * mode=preview: 파싱·검증·충돌 계획만(쓰기 없음, payroll.edit)
 * mode=import : 확정 대장으로 적재(payroll.close — 엑셀분은 확정 상태로 들어가므로 확정 권한과 같은 무게)
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission("payroll.edit");
    const form = await req.formData();
    const mode = String(form.get("mode") ?? "preview");
    const files = form.getAll("files").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f);
    if (!files.length) return NextResponse.json({ error: "엑셀 파일을 골라 주세요." }, { status: 400 });
    if (files.length > IMPORT_MAX_FILES) {
      return NextResponse.json({ error: `한 번에 ${IMPORT_MAX_FILES}개까지 올릴 수 있습니다.` }, { status: 400 });
    }
    for (const f of files) {
      if (!/\.(xlsx|xlsm|xls)$/i.test(f.name)) return NextResponse.json({ error: `${f.name}: 엑셀 파일(.xlsx·.xls)만 올릴 수 있습니다.` }, { status: 400 });
      if (f.size > IMPORT_MAX_BYTES) return NextResponse.json({ error: `${f.name}: 파일이 10MB를 넘습니다.` }, { status: 400 });
    }
    let targets: Array<Partial<ImportTarget> | null> = [];
    try {
      const raw = JSON.parse(String(form.get("targets") ?? "[]"));
      if (Array.isArray(raw)) targets = raw;
    } catch {
      return NextResponse.json({ error: "대상 연·월 정보가 올바르지 않습니다." }, { status: 400 });
    }

    if (mode === "preview") {
      const results = [];
      for (const [i, f] of files.entries()) {
        results.push(await previewLedgerFile(f.name, Buffer.from(await f.arrayBuffer()), targets[i] ?? null));
      }
      return NextResponse.json({ files: results, items: await listImportItems() });
    }

    if (mode !== "import") return NextResponse.json({ error: "알 수 없는 mode 입니다." }, { status: 400 });
    if (!(await hasPermission(ctx.userId, "payroll.close"))) {
      return NextResponse.json({ error: "엑셀 대장은 확정 상태로 들어갑니다 — 급여대장 확정 권한(payroll.close)이 필요합니다." }, { status: 403 });
    }
    const results: ImportResult[] = [];
    for (const [i, f] of files.entries()) {
      const t = targets[i] ?? {};
      if (!validTarget(t)) {
        results.push({ fileName: f.name, ledgerId: "", action: "invalid", headcount: 0, matched: 0, reason: "귀속 연·월·종류가 올바르지 않습니다." });
        continue;
      }
      try {
        results.push(await importLedgerFile(f.name, Buffer.from(await f.arrayBuffer()), { ...t, overwrite: !!t.overwrite, remap: cleanRemap(t.remap) }));
      } catch (err) {
        results.push({ fileName: f.name, ledgerId: "", action: "invalid", headcount: 0, matched: 0, reason: (err as Error).message || "적재 실패" });
      }
    }
    const loaded = results.filter((r) => r.action === "new" || r.action === "overwrite");
    if (loaded.length) {
      await recordAuditLog({
        actorUserId: ctx.userId,
        action: "payroll_ledger_import",
        targetTable: "payroll_ledgers",
        targetId: loaded.map((r) => r.ledgerId).join(","),
        after: loaded.map((r) => ({ ledgerId: r.ledgerId, fileName: r.fileName, action: r.action, headcount: r.headcount })),
      });
    }
    return NextResponse.json({ results });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
