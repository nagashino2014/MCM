import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { getDb, withDbWrite } from "@/lib/db";
import {
  ContractServiceInputError,
  countContractServiceUsage,
  createServiceSubtype,
  createServiceType,
  deleteServiceItem,
  describeChanged,
  invalidateContractServiceCache,
  loadContractServiceTypesWithSource,
  renameServiceSubtype,
  renameServiceType,
  reorderServiceItems,
  setServiceActive,
} from "@/lib/contracts/service-categories-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PERM = "master.contract_service.manage";

/** 용역 분류 관리(/admin/contract-service-categories) — 목록 + 분류별 사용 건수. */
export async function GET() {
  try {
    await requirePermission(PERM, { fallbackRoles: ["admin"] });
    invalidateContractServiceCache();
    const db = await getDb();
    const { list, fromTable } = await loadContractServiceTypesWithSource(db);
    const usage = await countContractServiceUsage(db).catch((err) => {
      console.error("[contract-service-categories] usage count failed", err);
      return { types: {}, subtypes: {} };
    });
    return NextResponse.json({ types: list, fromTable, usage });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

type Kind = "type" | "subtype";

type Body =
  | { action: "createType"; label: string }
  | { action: "createSubtype"; typeId: string; label: string }
  | { action: "rename"; kind: Kind; id: string; label: string }
  | { action: "setActive"; kind: Kind; id: string; active: boolean }
  | { action: "reorder"; kind: Kind; ids: string[] }
  | { action: "delete"; kind: Kind; id: string };

function kindOf(value: unknown): Kind {
  if (value === "type" || value === "subtype") return value;
  throw new ContractServiceInputError("알 수 없는 요청입니다.");
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission(PERM, { fallbackRoles: ["admin"] });
    const body = (await req.json().catch(() => ({}))) as Body;
    const { fromTable } = await loadContractServiceTypesWithSource();
    if (!fromTable) {
      return NextResponse.json({ error: "용역 분류 표(348)가 아직 적용되지 않아 기본 목록으로 동작 중입니다. 마이그레이션 적용 후 편집하세요." }, { status: 409 });
    }
    let changed: Record<string, number> = {};
    let createdId: string | null = null;
    try {
      await withDbWrite(async (db) => {
        switch (body.action) {
          case "createType":
            createdId = await createServiceType(db, body.label, actor.userId);
            return;
          case "createSubtype":
            createdId = await createServiceSubtype(db, String(body.typeId ?? ""), body.label, actor.userId);
            return;
          case "rename":
            changed =
              kindOf(body.kind) === "type"
                ? await renameServiceType(db, String(body.id ?? ""), body.label, actor.userId)
                : await renameServiceSubtype(db, String(body.id ?? ""), body.label, actor.userId);
            return;
          case "setActive":
            await setServiceActive(db, kindOf(body.kind), String(body.id ?? ""), body.active === true, actor.userId);
            return;
          case "reorder":
            await reorderServiceItems(db, kindOf(body.kind), Array.isArray(body.ids) ? body.ids : [], actor.userId);
            return;
          case "delete":
            await deleteServiceItem(db, kindOf(body.kind), String(body.id ?? ""));
            return;
          default:
            throw new ContractServiceInputError("알 수 없는 요청입니다.");
        }
      });
    } catch (err) {
      if (err instanceof ContractServiceInputError) return NextResponse.json({ error: err.message }, { status: 400 });
      throw err;
    } finally {
      invalidateContractServiceCache();
    }
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "contract_service_category_change",
      targetTable: "contract_service_types",
      targetId: "id" in body ? String(body.id) : body.action === "reorder" ? "reorder" : String(createdId ?? ""),
      after: { ...body, createdId, changed },
    });
    return NextResponse.json({ ok: true, id: createdId, changed, changedText: describeChanged(changed) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
