import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission, requireSession } from "@/lib/auth/guards";
import {
  buildExpenseAlerts,
  buildVatLedger,
  buildVatReturnWorkbook,
  deactivateRentalDeposit,
  latestClosedPeriod,
  listRentalDeposits,
  saveRentalDeposit,
  updateHometaxInvoice,
  vatPeriod,
  vatPeriodsOfYear,
  type VatPeriod,
  type VatReturnForm,
} from "@/lib/finance/vat-return";
import {
  buildBasisVatReturn,
  confirmBasisVatReturn,
  listVatReturnBases,
  listVatReturnRecords,
  loadVatReturnRecord,
  saveBasisVatReturn,
} from "@/lib/finance/vat-return-basis";
import { parseVatFollowupSelection, readVatFollowupJson } from "@/lib/finance/vat-followup-workspace";
import { parseSameSupplySelection } from "@/lib/finance/vat-same-supply";
import { sameSupplyErrorResponse } from "@/lib/finance/vat-same-supply-diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parsePeriod(sp: URLSearchParams): VatPeriod | null {
  const year = Number(sp.get("year") ?? 0);
  const term = Number(sp.get("term") ?? 0);
  const kind = sp.get("kind") ?? "";
  if (!year || (term !== 1 && term !== 2) || (kind !== "pre" && kind !== "final")) return null;
  return vatPeriod(year, term as 1 | 2, kind);
}

const inputError = (message: string) => Object.assign(new Error(message), { status: 400 });
function requiredId(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > 200) throw inputError(`${label}가 필요합니다.`);
  return value;
}
function requiredHash(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw inputError(`${label}가 필요합니다.`);
  return value;
}
function manualInput(value: unknown): Record<string, number> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw inputError("수동 보정 입력 형식이 올바르지 않습니다.");
  const values = Object.entries(value);
  if (values.some(([key]) => key === "prepaidNotice" || key === "prepaidUnrefunded")) throw inputError("예정고지·미환급 세액은 수기로 입력할 수 없습니다. 신고 근거를 확인하세요.");
  if (values.some(([key, amount]) => !["etaxCredit", "penalty"].includes(key) || !Number.isSafeInteger(amount) || (amount as number) < 0)) throw inputError("수동 보정은 허용된 항목의 0 이상 원 단위 정수로 입력하세요.");
  return Object.fromEntries(values) as Record<string, number>;
}
async function permissions() {
  try { await requirePermission("finance.manage"); return { manage: true }; }
  catch (error) { if ((error as { status?: number }).status === 403) return { manage: false }; throw error; }
}
function errorResponse(error: unknown, write = false) {
  const e = error as { status?: number; message?: string; code?: unknown; issues?: unknown };
  if (typeof e?.code === "string" && e.code.startsWith("vat_same_supply_")) {
    const safe = sameSupplyErrorResponse(error, write);
    return NextResponse.json(safe.body, { status: safe.status, headers: { "Cache-Control": "no-store" } });
  }
  if ((e?.status === 409 || e?.status === 503) && typeof e.message === "string") {
    const issues = Array.isArray(e.issues) ? e.issues.map(issue => {
      const value = issue && typeof issue === "object" ? issue as Record<string, unknown> : {};
      return Object.fromEntries(["code", "message", "reason", "sourceId", "factId", "revisionId"].filter(key => typeof value[key] === "string").map(key => [key, value[key]]));
    }).filter(issue => Object.keys(issue).length) : [];
    return NextResponse.json({ error: e.message, ...(typeof e.code === "string" ? { code: e.code } : {}), issues, canConfirm: false }, { status: e.status });
  }
  return authErrorToResponse(error);
}
async function workbookResponse(form: VatReturnForm) {
  const buf = await buildVatReturnWorkbook(form);
  const filename = encodeURIComponent(`부가세신고자료_${form.period.year}년${form.period.term}기${form.period.kind === "pre" ? "예정" : "확정"}.xlsx`);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// GET: view=periods(기수 목록)/ledger(매입매출장)/draft(신고서 계산)/list(저장본)/expense(경비 점검)
//      draft + format=xlsx → 신고 자료 엑셀 다운로드
export async function GET(req: NextRequest) {
  try {
    await requirePermission("finance.view");
    const sp = req.nextUrl.searchParams;
    const view = sp.get("view") ?? "draft";

    if (view === "periods") {
      const now = latestClosedPeriod();
      const years = [now.year - 1, now.year];
      return NextResponse.json({
        default: { year: now.year, term: now.term, kind: now.kind },
        periods: years.flatMap((y) => vatPeriodsOfYear(y)),
      });
    }
    if (view === "bases") {
      return NextResponse.json({ bases: await listVatReturnBases(), permissions: await permissions() });
    }
    if (view === "list") {
      return NextResponse.json({ returns: await listVatReturnRecords(), permissions: await permissions() });
    }
    if (view === "deposits") {
      return NextResponse.json({ deposits: await listRentalDeposits() });
    }
    if (view === "ledger") {
      const period = parsePeriod(sp);
      if (!period) return NextResponse.json({ error: "기수(year/term/kind)가 필요합니다." }, { status: 400 });
      const direction = sp.get("direction");
      return NextResponse.json(
        await buildVatLedger({
          from: period.from,
          to: period.to,
          direction: direction === "sales" || direction === "purchase" ? direction : undefined,
        }),
      );
    }
    if (view === "expense") {
      const period = parsePeriod(sp);
      if (!period) return NextResponse.json({ error: "기수(year/term/kind)가 필요합니다." }, { status: 400 });
      return NextResponse.json(await buildExpenseAlerts({ from: period.from, to: period.to }));
    }
    if (view !== "draft" && view !== "archive") throw inputError("조회 종류가 올바르지 않습니다.");
    // A stored form is read by ID before parsing current calculation inputs.
    const savedId = sp.get("returnId");
    if (view === "archive" && !savedId) throw inputError("저장본 returnId가 필요합니다.");
    const saved = savedId ? await loadVatReturnRecord(requiredId(savedId, "저장본 ID")) : null;
    if (savedId && !saved) return NextResponse.json({ error: "저장된 신고서를 찾을 수 없습니다." }, { status: 404 });
    let form;
    if (saved) form = saved.form;
    else {
      let manual: unknown;
      if (sp.has("manual")) {
        try { manual = JSON.parse(sp.get("manual")!); }
        catch { throw inputError("수동 보정 입력 형식이 올바르지 않습니다."); }
      }
      let followup: unknown;
      if (sp.has("followup")) {
        try { followup = JSON.parse(sp.get("followup")!); }
        catch { throw inputError("후행 검토 선택 형식이 올바르지 않습니다."); }
      }
      let sameSupply: unknown;
      if (sp.has("sameSupply")) {
        try { sameSupply = JSON.parse(sp.get("sameSupply")!); }
        catch { throw inputError("같은 공급 검토 선택 형식이 올바르지 않습니다."); }
      }
      form = await buildBasisVatReturn({
        basisSnapshotId: requiredId(sp.get("basisSnapshotId"), "봉인 근거 ID"),
        expectedScopeHash: requiredHash(sp.get("expectedScopeHash"), "확인한 신고 근거 지문"),
        manual: manualInput(manual),
        followup: parseVatFollowupSelection(followup),
        ...(sameSupply === undefined ? {} : { sameSupply: parseSameSupplySelection(sameSupply) }),
      });
      if (sp.has("expectedCalculationHash") && requiredHash(sp.get("expectedCalculationHash"), "계산 지문") !== form.filingBasis?.calculationHash) throw Object.assign(new Error("계산 결과가 변경되었습니다. 다시 계산한 뒤 다운로드하세요."), { status: 409 });
    }
    if (sp.get("format") === "xlsx") {
      return workbookResponse(form);
    }
    return NextResponse.json({ form, ...(saved ? { record: saved } : {}), permissions: await permissions() });
  } catch (err) {
    return errorResponse(err);
  }
}

interface PostBody {
  action?: "calculate" | "save" | "confirm" | "unconfirm" | "set_deductible" | "save_deposit" | "delete_deposit";
  year?: number;
  term?: number;
  kind?: string;
  manual?: Record<string, number>;
  followup?: unknown;
  sameSupply?: unknown;
  format?: "xlsx";
  basisSnapshotId?: string;
  expectedScopeHash?: string;
  expectedCalculationHash?: string;
  requestId?: string;
  returnId?: string;
  htiId?: string;
  vatDeductible?: number | null;
  excluded?: boolean;
  memo?: string | null;
  deposit?: {
    depositId?: string;
    propertyLabel?: string;
    tenantName?: string;
    tenantCorpNum?: string | null;
    depositAmount?: number;
    dateFrom?: string;
    dateTo?: string | null;
    memo?: string | null;
  };
  depositId?: string;
}

// POST: 신고서 저장/확정/확정취소, 매입 계산서 공제·제외 수정 (finance.manage)
export async function POST(req: NextRequest) {
  let write = false;
  try {
    await requireSession();
    const parsed = await readVatFollowupJson(req);
    const body = parsed as PostBody;
    // 선택 쌍이 많은 계산은 URL에 금액/원문을 싣지 않고 같은 읽기 권한으로 요청한다.
    if (body.action === "calculate") {
      await requirePermission("finance.view");
      if (body.format !== undefined && body.format !== "xlsx") throw inputError("지원하지 않는 계산 출력 형식입니다.");
      const form = await buildBasisVatReturn({
        basisSnapshotId: requiredId(body.basisSnapshotId, "봉인 근거 ID"),
        expectedScopeHash: requiredHash(body.expectedScopeHash, "확인한 신고 근거 지문"),
        manual: manualInput(body.manual),
        followup: parseVatFollowupSelection(body.followup),
        ...(body.sameSupply === undefined ? {} : { sameSupply: parseSameSupplySelection(body.sameSupply) }),
      });
      if (body.format === "xlsx") {
        if (requiredHash(body.expectedCalculationHash, "확인한 계산 지문") !== form.filingBasis?.calculationHash) throw Object.assign(new Error("계산 결과가 변경되었습니다. 다시 계산한 뒤 다운로드하세요."), { status: 409, code: "vat_return_calculation_changed" });
        return workbookResponse(form);
      }
      return NextResponse.json({ form, permissions: await permissions() }, { headers: { "Cache-Control": "no-store" } });
    }
    const ctx = await requirePermission("finance.manage");
    write = true;

    if (body.action === "save_deposit") {
      const d = body.deposit;
      if (!d?.propertyLabel?.trim() || !d?.tenantName?.trim() || !(Number(d.depositAmount) >= 0) || !/^\d{4}-\d{2}-\d{2}$/.test(String(d.dateFrom ?? ""))) {
        return NextResponse.json({ error: "물건지·임차인·보증금·시작일(YYYY-MM-DD)이 필요합니다." }, { status: 400 });
      }
      const depositId = await saveRentalDeposit({
        depositId: d.depositId,
        propertyLabel: d.propertyLabel,
        tenantName: d.tenantName,
        tenantCorpNum: d.tenantCorpNum,
        depositAmount: Number(d.depositAmount),
        dateFrom: String(d.dateFrom),
        dateTo: d.dateTo && /^\d{4}-\d{2}-\d{2}$/.test(d.dateTo) ? d.dateTo : null,
        memo: d.memo,
      });
      return NextResponse.json({ depositId });
    }
    if (body.action === "delete_deposit") {
      if (!body.depositId) return NextResponse.json({ error: "depositId 가 필요합니다." }, { status: 400 });
      await deactivateRentalDeposit(body.depositId);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "set_deductible") {
      if (!body.htiId) return NextResponse.json({ error: "htiId 가 필요합니다." }, { status: 400 });
      await updateHometaxInvoice(body.htiId, {
        vatDeductible: body.vatDeductible,
        excluded: body.excluded,
        memo: body.memo,
      });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "save") {
      if (!body.basisSnapshotId) throw Object.assign(new Error("기존 분기 형식의 신규 저장은 지원하지 않습니다. 봉인된 신고 근거로 새 계산을 시작하세요."), { status: 409 });
      return NextResponse.json(await saveBasisVatReturn({
        basisSnapshotId: requiredId(body.basisSnapshotId, "봉인 근거 ID"),
        expectedScopeHash: requiredHash(body.expectedScopeHash, "확인한 신고 근거 지문"),
        expectedCalculationHash: requiredHash(body.expectedCalculationHash, "확인한 계산 지문"),
        requestId: requiredId(body.requestId, "요청 ID"),
        manual: manualInput(body.manual),
        followup: parseVatFollowupSelection(body.followup),
        ...(body.sameSupply === undefined ? {} : { sameSupply: parseSameSupplySelection(body.sameSupply) }),
      }, ctx.userId));
    }
    if (body.action === "confirm" || body.action === "unconfirm") {
      if (body.followup !== undefined || body.sameSupply !== undefined) throw inputError("확정은 저장한 계산판의 검토 선택을 사용합니다. 선택을 바꾸려면 새로 계산하여 저장하세요.");
      const returnId = requiredId(body.returnId, "저장본 ID");
      if (body.action === "unconfirm") throw Object.assign(new Error("확정 취소·근거 사용 해제는 후행 정정 절차가 필요하여 현재 지원하지 않습니다."), { status: 409 });
      const record = await loadVatReturnRecord(returnId);
      if (!record) return NextResponse.json({ error: "저장된 신고서를 찾을 수 없습니다." }, { status: 404 });
      if (record.origin === "legacy") {
        if (record.status === "confirmed") return NextResponse.json({ ok: true, returnId, readOnly: true });
        throw Object.assign(new Error("기존 형식의 초안은 확정할 수 없습니다. 봉인된 근거로 별도 계산하세요."), { status: 409 });
      }
      return NextResponse.json({ ok: true, ...await confirmBasisVatReturn({
        returnId,
        requestId: requiredId(body.requestId, "요청 ID"),
        expectedCalculationHash: requiredHash(body.expectedCalculationHash, "확인한 계산 지문"),
      }, ctx.userId) });
    }
    return NextResponse.json({ error: "action 이 올바르지 않습니다." }, { status: 400 });
  } catch (err) {
    return errorResponse(err, write);
  }
}
