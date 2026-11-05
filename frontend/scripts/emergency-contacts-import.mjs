import { build } from "esbuild";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// 비상 연락망 일회성 이관 — 회사 엑셀의 소속 표시·직책·순서를 emergency_contact_entries(340)로 옮긴다.
//   node scripts/emergency-contacts-import.mjs --xlsx <엑셀> --report <대조표.csv>                 대조만(읽기 전용, 기본)
//   ... --apply [--contacts keep|fill|overwrite] [--hide-unlisted] [--hide-unlisted-group <소속>] [--actor <user_id>]   적재(한 트랜잭션)
// 접속은 PGHOST·PGPORT·PGUSER·PGPASSWORD·PGDATABASE·PGSSL(disable 이면 평문) 환경변수.
// 콘솔에는 건수만 찍는다. 이름·번호는 --report 파일에만 쓴다(개인정보 — 확인 뒤 지울 것).
// --contacts: 인사카드 번호·메일 처리. keep=그대로(기본), fill=빈 칸만 엑셀로 채움, overwrite=엑셀 값으로 덮음.
// --hide-unlisted: 엑셀에 없는 재직자를 표에서 숨긴다(기본은 같은 소속 끝에 표시). --hide-unlisted-group 은 그 소속의 재직자만 숨긴다.
// 엑셀에 같은 직원이 두 번 나오면(겸직) 첫 행은 직원 행, 다음 행은 겸직 줄(same_as_employee_id)로 넣는다.

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
}
const flag = (name) => process.argv.includes(`--${name}`);

const xlsxPath = arg("xlsx");
const reportPath = arg("report");
const apply = flag("apply");
const contactsMode = arg("contacts") ?? "keep";
const hideUnlisted = flag("hide-unlisted");
const hideUnlistedGroup = arg("hide-unlisted-group") ?? null;
const actor = arg("actor") ?? null;
if (!xlsxPath || !reportPath || !["keep", "fill", "overwrite"].includes(contactsMode)) {
  console.error("사용법: --xlsx <엑셀> --report <대조표.csv> [--apply] [--contacts keep|fill|overwrite] [--hide-unlisted] [--hide-unlisted-group <소속>] [--actor <user_id>]");
  process.exit(2);
}

// 앱과 같은 판정(기본 소속·직책)을 쓰려고 순수 모듈을 번들해 불러온다.
const outfile = path.resolve(".next/emergency-contacts-import/rules.cjs");
mkdirSync(path.dirname(outfile), { recursive: true });
await build({ entryPoints: ["lib/emergency-contacts-rules.ts"], outfile, bundle: true, platform: "node", format: "cjs", packages: "external", tsconfig: "tsconfig.json" });
const require = createRequire(path.resolve("package.json"));
const { EMERGENCY_EMPLOYEE_SQL, buildEmergencyRows, emergencyEmployeeFromRow } = require(outfile);
const ExcelJS = require("exceljs");
const pg = require("pg");

/** 엑셀 칸 값을 글자로 — 서식 있는 글자(richText)·링크·수식 칸도 표시되는 글자를 돌려준다. */
function plain(v) {
  if (v && typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    return plain(v.text ?? v.result ?? "");
  }
  return v;
}
const compact = (v) => String(v ?? "").replace(/\s+/g, "");
const label = (v) => String(plain(v) ?? "").replace(/\s+/g, " ").trim();
const digits = (v) => String(v ?? "").replace(/\D/g, "");
/** '-' 는 빈 값으로 본다. */
function cellText(cell) {
  const t = String(plain(cell.value) ?? "").trim();
  return t === "-" ? "" : t;
}

async function readWorkbook(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  let header = 0;
  for (let r = 1; r <= ws.rowCount && !header; r++) if (label(ws.getCell(r, 1).value) === "소속") header = r;
  if (!header) throw new Error("머리글(소속) 행을 찾지 못했습니다.");
  const expected = ["소속", "이름", "직책", "직급", "연락처", "직통번호", "이메일"];
  expected.forEach((h, i) => {
    if (label(ws.getCell(header, i + 1).value) !== h) throw new Error(`${i + 1}열 머리글이 '${h}'가 아닙니다.`);
  });
  const rows = [];
  // 인쇄 범위 아래의 사본 표는 읽지 않는다 — '총 인원' 행에서 멈춘다.
  for (let r = header + 1; r <= ws.rowCount; r++) {
    const group = label(ws.getCell(r, 1).value); // 병합 칸은 대표 칸 값을 돌려준다.
    if (group.startsWith("총 인원")) break;
    const name = cellText(ws.getCell(r, 2));
    if (!name) continue;
    rows.push({
      row: r,
      group,
      name,
      title: cellText(ws.getCell(r, 3)),
      position: cellText(ws.getCell(r, 4)),
      mobile: cellText(ws.getCell(r, 5)),
      direct: cellText(ws.getCell(r, 6)),
      email: cellText(ws.getCell(r, 7)),
    });
  }
  return rows;
}

function compare(xl, app, same) {
  if (!xl) return app ? "엑셀만 빈 칸" : "둘 다 빈 칸";
  if (!app) return "앱만 빈 칸";
  return same(xl, app) ? "같음" : "다름";
}

const xlRows = await readWorkbook(xlsxPath);
const client = new pg.Client({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false },
  application_name: "emergency-contacts-import",
});
await client.connect();

try {
  if (!apply) await client.query("SET default_transaction_read_only = on");
  const facts = (await client.query(EMERGENCY_EMPLOYEE_SQL)).rows.map((r) => emergencyEmployeeFromRow(r, process.env.MAIL_DOMAIN || "koensain.app"));
  const inactive = new Set((await client.query(`SELECT name FROM employee_profiles WHERE status <> 'active'`)).rows.map((r) => compact(r.name)));
  const appRows = buildEmergencyRows(facts, []);
  const byName = new Map();
  for (const r of appRows) byName.set(compact(r.name), [...(byName.get(compact(r.name)) ?? []), r]);

  const plan = xlRows.map((x, i) => {
    const hits = byName.get(compact(x.name)) ?? [];
    const app = hits.length === 1 ? hits[0] : null;
    const verdict = hits.length > 1 ? "동명이인" : app ? "직원" : inactive.has(compact(x.name)) ? "비재직 직원" : "인사카드 없음";
    return { x, app, verdict, displayOrder: (i + 1) * 10 };
  });
  const matched = new Set(plan.filter((p) => p.app).map((p) => p.app.key));
  const unlisted = appRows.filter((r) => !matched.has(r.key));
  const repeated = plan.filter((p) => p.app).length - matched.size;

  // 대조표(개인정보 포함) — 콘솔에는 건수만 남긴다.
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["엑셀 행", "판정", "이름", "소속(엑셀)", "소속(앱)", "직책(엑셀)", "직책(앱)", "직급(엑셀)", "직급(앱)", "연락처(엑셀)", "연락처(앱)", "연락처 판정", "직통(엑셀)", "직통(앱)", "직통 판정", "메일(엑셀)", "메일(앱)", "메일 판정"].map(q).join(",")];
  const count = {};
  const tally = (k) => (count[k] = (count[k] ?? 0) + 1);
  const sameDigits = (a, b) => digits(a) === digits(b);
  const sameMail = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
  for (const { x, app, verdict } of plan) {
    tally(`행:${verdict}`);
    const m = compare(x.mobile, app?.mobilePhone, sameDigits);
    const d = compare(x.direct, app?.directPhone, sameDigits);
    const e = compare(x.email, app?.email, sameMail);
    if (app) {
      tally(`연락처:${m}`);
      tally(`직통:${d}`);
      tally(`메일:${e}`);
      tally(`소속:${x.group === app.defaultGroupLabel ? "기본값과 같음" : "표시 설정 필요"}`);
      tally(`직책:${x.title === app.defaultTitle ? "기본값과 같음" : "표시 설정 필요"}`);
      tally(`직급:${x.position === app.positionName ? "같음" : "다름"}`);
    }
    lines.push([x.row, verdict, x.name, x.group, app?.defaultGroupLabel, x.title, app?.defaultTitle, x.position, app?.positionName, x.mobile, app?.mobilePhone, app ? m : "", x.direct, app?.directPhone, app ? d : "", x.email, app?.email, app ? e : ""].map(q).join(","));
  }
  for (const r of unlisted) {
    lines.push(["", "엑셀에 없는 재직자", r.name, "", r.defaultGroupLabel, "", r.defaultTitle, "", r.positionName, "", r.mobilePhone, "", "", r.directPhone, "", "", r.email, ""].map(q).join(","));
  }
  writeFileSync(reportPath, "﻿" + lines.join("\r\n"), "utf8");

  console.log(JSON.stringify({ 엑셀행: xlRows.length, 재직자: appRows.length, 엑셀에없는재직자: unlisted.length, 같은직원반복행: repeated, ...count }, null, 2));

  if (!apply) {
    console.log("대조만 했습니다(읽기 전용). 적재는 --apply 로 합니다.");
  } else {
    if (plan.some((p) => p.verdict === "동명이인")) throw new Error("동명이인 행이 있어 적재하지 않았습니다. 대조표를 확인하세요.");
    const now = new Date().toISOString();
    await client.query("BEGIN");
    const result = { 직원설정: 0, 겸직줄: 0, 직접입력: 0, 인사카드수정: 0, 숨김: 0 };
    const seen = new Set();
    for (const { x, app, displayOrder } of plan) {
      if (app && seen.has(app.key)) {
        // 겸직 둘째 줄 — 소속·직책·순서만 담는다. 번호는 첫 행에서 처리했다.
        if (!x.group) throw new Error(`${x.row}행의 소속이 비어 있습니다.`);
        await client.query(
          `INSERT INTO emergency_contact_entries (entry_id, same_as_employee_id, group_label, title, display_order, hidden, created_by, updated_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 0, $6, $6, $7, $7)
           ON CONFLICT (same_as_employee_id, group_label) WHERE same_as_employee_id IS NOT NULL
           DO UPDATE SET title = EXCLUDED.title, display_order = EXCLUDED.display_order, hidden = 0, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
          [randomUUID(), app.employeeId, x.group, x.title === app.defaultTitle ? null : x.title, displayOrder, actor, now]
        );
        result.겸직줄 += 1;
      } else if (app) {
        seen.add(app.key);
        const groupLabel = x.group === app.defaultGroupLabel ? null : x.group;
        const title = x.title === app.defaultTitle ? null : x.title;
        await client.query(
          `INSERT INTO emergency_contact_entries (entry_id, employee_id, group_label, title, display_order, hidden, created_by, updated_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 0, $6, $6, $7, $7)
           ON CONFLICT (employee_id) WHERE employee_id IS NOT NULL
           DO UPDATE SET group_label = EXCLUDED.group_label, title = EXCLUDED.title, display_order = EXCLUDED.display_order, hidden = 0, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
          [randomUUID(), app.employeeId, groupLabel, title, displayOrder, actor, now]
        );
        result.직원설정 += 1;
        if (contactsMode !== "keep") {
          const pick = (xlValue, appValue) => (xlValue && (contactsMode === "overwrite" || !appValue) ? xlValue : null);
          const mobile = pick(x.mobile, app.mobilePhone);
          const direct = pick(x.direct, app.directPhone);
          const email = pick(x.email, app.email);
          if (mobile || direct || email) {
            await client.query(
              `UPDATE employee_profiles
                  SET mobile_phone = COALESCE($2, mobile_phone), company_phone = COALESCE($3, company_phone), email = COALESCE($4, email), updated_at = $5
                WHERE employee_id = $1`,
              [app.employeeId, mobile, direct, email, now]
            );
            result.인사카드수정 += 1;
          }
        }
      } else {
        const fields = [x.group || null, x.title || null, displayOrder, x.position || null, x.mobile || null, x.direct || null, x.email || null, actor, now];
        const updated = await client.query(
          `UPDATE emergency_contact_entries
              SET group_label = $2, title = $3, display_order = $4, position_name = $5, mobile_phone = $6, direct_phone = $7, email = $8, updated_by = $9, updated_at = $10
            WHERE employee_id IS NULL AND same_as_employee_id IS NULL AND name = $1`,
          [x.name, ...fields]
        );
        if (!updated.rowCount) {
          await client.query(
            `INSERT INTO emergency_contact_entries
               (entry_id, name, group_label, title, display_order, position_name, mobile_phone, direct_phone, email, created_by, updated_by, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11, $11)`,
            [randomUUID(), x.name, ...fields]
          );
        }
        result.직접입력 += 1;
      }
    }
    if (hideUnlisted || hideUnlistedGroup) {
      for (const r of unlisted.filter((u) => hideUnlisted || u.defaultGroupLabel === hideUnlistedGroup)) {
        await client.query(
          `INSERT INTO emergency_contact_entries (entry_id, employee_id, hidden, created_by, updated_by, created_at, updated_at)
           VALUES ($1, $2, 1, $3, $3, $4, $4)
           ON CONFLICT (employee_id) WHERE employee_id IS NOT NULL
           DO UPDATE SET hidden = 1, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
          [randomUUID(), r.employeeId, actor, now]
        );
        result.숨김 += 1;
      }
    }
    // 감사 로그에는 건수만 남긴다.
    await client.query(
      `INSERT INTO audit_log (actor_user_id, action, target_table, target_id, after_json, created_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [actor, "emergency_contact_import", "emergency_contact_entries", "bulk", JSON.stringify({ ...result, contactsMode, hideUnlisted, hideUnlistedGroup }), now]
    );
    await client.query("COMMIT");
    console.log(JSON.stringify(result));
  }
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  throw err;
} finally {
  await client.end();
}
