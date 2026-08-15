import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import {
  COMPANY_HOLIDAY_REASONS,
  deleteAnnualHoliday,
  deleteCompanyHoliday,
  listAnnualHolidays,
  listOffDays,
  saveAnnualHoliday,
  saveCompanyHoliday,
} from "@/lib/hr/holidays";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** GET ?year= — 그 해 휴무일 전체(법정 + 사내 지정). 휴무일 지정 화면의 캘린더가 쓴다. */
export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const yearRaw = Number(req.nextUrl.searchParams.get("year"));
    const year = Number.isInteger(yearRaw) && yearRaw >= 2000 && yearRaw <= 2100 ? yearRaw : new Date().getFullYear();
    const [holidays, annual] = await Promise.all([listOffDays(year), listAnnualHolidays()]);
    return NextResponse.json({ year, holidays, annual, reasons: COMPANY_HOLIDAY_REASONS });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/**
 * POST — 사내 휴무일 지정/수정.
 *  - 특정일: { date, name, reason, note? }
 *  - 매년 반복(창립기념일 등): { annual: { month, day, name, reason } }
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const body = (await req.json().catch(() => ({}))) as {
      date?: string; name?: string; reason?: string; note?: string | null;
      annual?: { month?: number; day?: number; name?: string; reason?: string };
    };

    if (body.annual) {
      const { month, day } = body.annual;
      const nm = (body.annual.name ?? "").trim();
      if (!Number.isInteger(month) || month! < 1 || month! > 12 || !Number.isInteger(day) || day! < 1 || day! > 31) {
        return NextResponse.json({ error: "월(1~12)·일(1~31)을 확인하세요." }, { status: 400 });
      }
      if (!nm) return NextResponse.json({ error: "휴무일명을 입력하세요." }, { status: 400 });
      if (!COMPANY_HOLIDAY_REASONS.some((r) => r.key === body.annual!.reason)) {
        return NextResponse.json({ error: "지정 사유를 선택하세요." }, { status: 400 });
      }
      await saveAnnualHoliday({ month: month!, day: day!, name: nm, reason: body.annual.reason! }, actor.userId);
      await recordAuditLog({
        actorUserId: actor.userId,
        action: "company_holiday_set",
        targetTable: "company_annual_holidays",
        targetId: `${month}-${day}`,
        after: { name: nm, reason: body.annual.reason, recurring: true },
      });
      return NextResponse.json({ ok: true });
    }

    if (!isDate(body.date)) return NextResponse.json({ error: "날짜(YYYY-MM-DD)가 필요합니다." }, { status: 400 });
    const name = (body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "휴무일명을 입력하세요." }, { status: 400 });
    if (!COMPANY_HOLIDAY_REASONS.some((r) => r.key === body.reason)) {
      return NextResponse.json({ error: "지정 사유를 선택하세요." }, { status: 400 });
    }
    await saveCompanyHoliday({ date: body.date, name, reason: body.reason!, note: body.note ?? null }, actor.userId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "company_holiday_set",
      targetTable: "company_holidays",
      targetId: body.date,
      after: { name, reason: body.reason },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** DELETE ?date= (특정일) 또는 ?month=&day= (매년 반복 규칙) — 사내 휴무일 해제. */
export async function DELETE(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const sp = req.nextUrl.searchParams;
    const month = Number(sp.get("month"));
    const day = Number(sp.get("day"));
    if (Number.isInteger(month) && Number.isInteger(day) && month >= 1 && day >= 1) {
      await deleteAnnualHoliday(month, day);
      await recordAuditLog({
        actorUserId: actor.userId,
        action: "company_holiday_set",
        targetTable: "company_annual_holidays",
        targetId: `${month}-${day}`,
        after: { removed: true },
      });
      return NextResponse.json({ ok: true });
    }
    const date = sp.get("date");
    if (!isDate(date)) return NextResponse.json({ error: "날짜(YYYY-MM-DD)가 필요합니다." }, { status: 400 });
    await deleteCompanyHoliday(date);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "company_holiday_set",
      targetTable: "company_holidays",
      targetId: date,
      after: { removed: true },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
