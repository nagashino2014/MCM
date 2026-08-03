// 홈 캘린더 일정(HC-A) — 휴가(annual_leave_ledger) + 차량(자산 이용 현황) 월 단위 조회.
// ?month=YYYY-MM&scopes=self,dept,refs,vehicle  (refs 는 home_layouts.calendar_refs 를 사용)
// 영업 일정은 기존 /api/sales/schedule 을 그대로 쓰고, 여기서는 인적·차량 일정을 담당한다.
// 차량(scope=vehicle)은 출장신청서 상신 건의 법인차량 + 직접 예약(lib/assets/usage)에서 온다(G6-C).
// 통합 일정 화면(/calendar)은 별도 API(/api/calendar)를 쓴다 — 이 라우트는 홈 위젯·모바일 전용.

import { NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";
import { loadHomeSettings } from "@/lib/home/layout";
import { listAssetUsage } from "@/lib/assets/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface HomeCalendarEntry {
  entryId: string;
  /** self=본인 / dept=부서원 / refs=참조 지정 인원 / vehicle=법인차량 */
  scope: "self" | "dept" | "refs" | "vehicle";
  employeeId: string;
  name: string;
  positionName: string | null;
  deptName: string | null;
  /** YYYY-MM-DD */
  date: string;
  /** 휴가 종류 표시명(없으면 '연차') / 차량은 이용 내역(목적지·시간) — 상세 팝업에 쓴다. */
  label: string;
  /** 격자 태그의 2자 종류명. */
  kind: "휴가" | "차량";
  days: number;
}

export async function GET(req: Request) {
  try {
    const ctx = await requireSession();
    const url = new URL(req.url);
    const month = url.searchParams.get("month") ?? "";
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: "month=YYYY-MM 형식이 필요합니다." }, { status: 400 });
    }
    const scopes = new Set((url.searchParams.get("scopes") ?? "self").split(",").map((s) => s.trim()));

    const db = await getDb();
    // 내 직원 레코드(사번·부서) — 계정과 조직은 employee_profiles.user_id 로 연결된다.
    const meRows = rowsToObjects(
      await db.exec(`SELECT employee_id, dept_id FROM employee_profiles WHERE user_id = $1`, [ctx.userId])
    );
    const myEmployeeId = meRows.length ? String(meRows[0].employee_id) : null;
    const myDeptId = meRows.length && meRows[0].dept_id != null ? String(meRows[0].dept_id) : null;

    // 대상 인원 집합 — scope 별로 employee_id 를 모아 한 번에 조회한다.
    const targets = new Map<string, HomeCalendarEntry["scope"]>();
    if (scopes.has("self") && myEmployeeId) targets.set(myEmployeeId, "self");

    if (scopes.has("dept") && myDeptId) {
      const deptRows = rowsToObjects(
        await db.exec(
          `SELECT employee_id FROM employee_profiles WHERE dept_id = $1 AND status = 'active'`,
          [myDeptId]
        )
      );
      for (const r of deptRows) {
        const id = String(r.employee_id);
        if (!targets.has(id)) targets.set(id, "dept");
      }
    }

    if (scopes.has("refs")) {
      const { calendarRefs } = await loadHomeSettings(ctx.userId);
      for (const id of calendarRefs) if (!targets.has(id)) targets.set(id, "refs");
    }

    // 차량 — 자산 이용 현황(출장 유래 + 직접 예약) 중 법인차량. 기간을 일자별로 전개한다
    // (위젯·모바일 캘린더가 단일 date 구조라 복수일 출장은 날짜마다 1건씩 놓는다).
    const vehicleEntries: HomeCalendarEntry[] = [];
    if (scopes.has("vehicle")) {
      const usage = (await listAssetUsage(month)).filter((u) => u.assetKind === "vehicle");
      for (const u of usage) {
        const from = u.startDate < `${month}-01` ? `${month}-01` : u.startDate;
        const days =
          Math.round((new Date(u.endDate).getTime() - new Date(u.startDate).getTime()) / 86400000) + 1;
        const cursor = new Date(from);
        while (true) {
          const date = cursor.toISOString().slice(0, 10);
          if (date > u.endDate || date.slice(0, 7) !== month) break;
          vehicleEntries.push({
            entryId: `${u.id}:${date}`,
            scope: "vehicle",
            employeeId: "",
            name: u.assetName,
            positionName: null,
            deptName: null,
            date,
            label: [u.userName, u.purpose].filter(Boolean).join(" · ") || "예약",
            kind: "차량",
            days,
          });
          cursor.setDate(cursor.getDate() + 1);
        }
      }
    }

    if (targets.size === 0) return NextResponse.json({ entries: vehicleEntries });

    const ids = [...targets.keys()];
    const rows = rowsToObjects(
      await db.exec(
        `SELECT l.entry_id, l.employee_id, l.used_on, l.days, l.leave_type_key,
                e.name, d.dept_name, p.position_name, lt.label AS type_label
           FROM annual_leave_ledger l
           JOIN employee_profiles e ON e.employee_id = l.employee_id
           LEFT JOIN departments d ON d.dept_id = e.dept_id
           LEFT JOIN positions p ON p.position_id = e.position_id
           LEFT JOIN leave_types lt ON lt.key = l.leave_type_key
          WHERE l.entry_type = 'use'
            AND l.used_on IS NOT NULL
            AND substr(l.used_on, 1, 7) = $1
            AND l.employee_id = ANY($2::text[])
          ORDER BY l.used_on ASC`,
        [month, ids]
      )
    );

    const entries: HomeCalendarEntry[] = rows.map((r) => ({
      entryId: String(r.entry_id),
      scope: (targets.get(String(r.employee_id)) ?? "dept") as HomeCalendarEntry["scope"],
      employeeId: String(r.employee_id),
      name: String(r.name ?? ""),
      positionName: r.position_name != null ? String(r.position_name) : null,
      deptName: r.dept_name != null ? String(r.dept_name) : null,
      date: String(r.used_on).slice(0, 10),
      label: r.type_label != null ? String(r.type_label) : "연차",
      kind: "휴가",
      days: Number(r.days ?? 0),
    }));

    return NextResponse.json({ entries: [...entries, ...vehicleEntries] });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
