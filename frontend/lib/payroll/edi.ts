import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";

/**
 * 4대보험 EDI 개인별 고지산출내역 CSV 업로드 (PL-P4, EDI_ANALYSIS.md §2-1 실증 포맷)
 * - 건강보험 파일: 한 행에 건강(idx5~17)·장기요양(idx18~30) 2세트.
 *   대장 반영: 건강보험=산출보험료(idx6), 정산-건강=정산보험료(idx7), 장기요양=산출(idx19), 정산-장기요양=정산(idx20).
 * - 연금보험 파일: 결정보험료(idx6)=총액(9%) → 대장 국민연금 = ÷2(근로자 4.5%).
 * - 인코딩 cp949(euc-kr), 상단 공백 행 존재. 귀속월 = 고지월(시프트 없음, 실증).
 */

export interface EdiParsedRow {
  name: string;
  rrnPrefix: string | null;
  bosuWolak: number | null;
  amounts: Record<string, unknown>;
}

export interface EdiParsed {
  insurer: "nhis" | "nps";
  rows: EdiParsedRow[];
}

function toInt(v: string | undefined): number {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** CSV 한 줄 분해(따옴표 없는 단순 CSV — EDI 산출물 실측 기준) */
function splitCsv(line: string): string[] {
  return line.split(",").map((c) => c.trim());
}

/** cp949 버퍼 → 종류 자동 감지 파싱 */
export function parseEdiCsv(buf: ArrayBuffer | Buffer): EdiParsed {
  const text = new TextDecoder("euc-kr").decode(buf instanceof Buffer ? new Uint8Array(buf) : buf);
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const headerIdx = lines.findIndex((l) => l.includes("주민번호") || l.includes("성명") || l.includes("가입자명"));
  if (headerIdx < 0) throw Object.assign(new Error("EDI CSV 헤더를 찾을 수 없습니다."), { status: 400 });
  const header = splitCsv(lines[headerIdx]);
  const isNhis = header.includes("증번호") || header.includes("보수월액");
  const isNps = header.includes("국민연금번호") || header.includes("결정보험료");
  if (!isNhis && !isNps) {
    throw Object.assign(new Error("건강보험/연금보험 고지산출내역 형식이 아닙니다."), { status: 400 });
  }

  const rows: EdiParsedRow[] = [];
  for (const line of lines.slice(headerIdx + 1)) {
    const c = splitCsv(line);
    if (!c[0] || !/^\d+$/.test(c[0])) continue; // 순번 없는 행(합계 등) 제외
    const name = (c[3] ?? "").trim();
    if (!name) continue;
    const rrnPrefix = (c[2] ?? "").slice(0, 6) || null;
    if (isNhis) {
      rows.push({
        name,
        rrnPrefix,
        bosuWolak: toInt(c[4]),
        amounts: {
          nhis: { calc: toInt(c[6]), settle: toInt(c[7]), notice: toInt(c[13]) },
          ltc: { calc: toInt(c[19]), settle: toInt(c[20]), notice: toInt(c[26]) },
        },
      });
    } else {
      rows.push({ name, rrnPrefix, bosuWolak: null, amounts: { total: toInt(c[6]) } });
    }
  }
  if (!rows.length) throw Object.assign(new Error("EDI CSV에서 인원 행을 찾지 못했습니다."), { status: 400 });
  return { insurer: isNhis ? "nhis" : "nps", rows };
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 장기요양 요율 자동 학습 — 건강보험 파일의 (요양÷건보) 산출보험료 비율 중앙값을
 * 해당 연도 요율로 역산해 payroll_insurance_rates 에 upsert (수동 입력이 있으면 유지).
 */
async function deriveLtcRate(payYear: number, rows: EdiParsedRow[]): Promise<number | null> {
  const ratios = rows
    .map((r) => {
      const a = r.amounts as { nhis?: { calc?: number }; ltc?: { calc?: number } };
      const nhis = Number(a.nhis?.calc ?? 0);
      const ltc = Number(a.ltc?.calc ?? 0);
      return nhis > 0 && ltc > 0 ? (ltc / nhis) * 100 : null;
    })
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b);
  if (ratios.length < 5) return null; // 표본 부족 시 갱신 보류
  const median = ratios[Math.floor(ratios.length / 2)];
  const rate = Math.round(median * 100) / 100;
  const validFrom = `${payYear}-01`;
  await withDbWrite(async (db) => {
    await db.exec(
      `INSERT INTO payroll_insurance_rates (rate_id, kind, valid_from, rate, source, note, updated_at)
       VALUES ($1,'ltc',$2,$3,'edi-derived',$4,$5)
       ON CONFLICT (kind, valid_from) DO UPDATE SET
         rate = EXCLUDED.rate, source = 'edi-derived', note = EXCLUDED.note, updated_at = EXCLUDED.updated_at
       WHERE payroll_insurance_rates.source <> 'manual'`,
      [`ltc-${validFrom}`, validFrom, rate, `EDI ${payYear}년 고지 역산(표본 ${ratios.length})`, new Date().toISOString()]
    );
  });
  return rate;
}

/** 업로드 저장 — 같은 (연월, 보험) 재업로드 시 교체. 직원 매칭은 재직자 성명 유일 기준. */
export async function saveEdiNotices(
  payYear: number,
  payMonth: number,
  parsed: EdiParsed,
  sourceFile: string | null
): Promise<{ saved: number; matched: number; unmatched: string[]; ltcRate?: number | null }> {
  const db = await getDb();
  const emps = rowsToObjects(
    await db.exec(`SELECT employee_id, name FROM employee_profiles WHERE status = 'active'`)
  );
  const byName = new Map<string, string[]>();
  for (const e of emps) {
    const list = byName.get(String(e.name)) ?? [];
    list.push(String(e.employee_id));
    byName.set(String(e.name), list);
  }

  const now = new Date().toISOString();
  let matched = 0;
  const unmatched: string[] = [];
  await withDbWrite(async (txn) => {
    await txn.exec(
      `DELETE FROM payroll_edi_notices WHERE pay_year = $1 AND pay_month = $2 AND insurer = $3`,
      [payYear, payMonth, parsed.insurer]
    );
    for (const r of parsed.rows) {
      const cands = byName.get(r.name) ?? [];
      const employeeId = cands.length === 1 ? cands[0] : null;
      if (employeeId) matched += 1;
      else unmatched.push(r.name);
      await txn.exec(
        `INSERT INTO payroll_edi_notices
           (notice_id, pay_year, pay_month, insurer, employee_id, name, rrn_prefix, bosu_wolak, amounts, source_file, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)`,
        [
          newId("edi"), payYear, payMonth, parsed.insurer, employeeId,
          r.name, r.rrnPrefix, r.bosuWolak, JSON.stringify(r.amounts), sourceFile, now,
        ]
      );
    }
  });
  // 건강보험 파일이면 장기요양 요율 자동 학습(§162 — 요율 변동 자동 반영)
  const ltcRate = parsed.insurer === "nhis" ? await deriveLtcRate(payYear, parsed.rows) : undefined;
  return { saved: parsed.rows.length, matched, unmatched, ltcRate };
}

export interface EdiStatus {
  nhis: { uploaded: boolean; count: number; sourceFile: string | null };
  nps: { uploaded: boolean; count: number; sourceFile: string | null };
}

export async function getEdiStatus(payYear: number, payMonth: number): Promise<EdiStatus> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT insurer, count(*) AS n, max(source_file) AS f
         FROM payroll_edi_notices WHERE pay_year = $1 AND pay_month = $2 GROUP BY insurer`,
      [payYear, payMonth]
    )
  );
  const st: EdiStatus = {
    nhis: { uploaded: false, count: 0, sourceFile: null },
    nps: { uploaded: false, count: 0, sourceFile: null },
  };
  for (const r of rows) {
    const key = String(r.insurer) as "nhis" | "nps";
    st[key] = { uploaded: true, count: Number(r.n), sourceFile: r.f ? String(r.f) : null };
  }
  return st;
}

/** 대장 생성용 — 직원별 고지액 맵(name 폴백 포함) */
export async function getEdiAmounts(
  payYear: number,
  payMonth: number
): Promise<Map<string, { nps?: number; nhis?: number; nhisSettle?: number; ltc?: number; ltcSettle?: number }>> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT insurer, employee_id, name, amounts FROM payroll_edi_notices
        WHERE pay_year = $1 AND pay_month = $2`,
      [payYear, payMonth]
    )
  );
  const map = new Map<string, { nps?: number; nhis?: number; nhisSettle?: number; ltc?: number; ltcSettle?: number }>();
  for (const r of rows) {
    const key = r.employee_id ? String(r.employee_id) : `name:${String(r.name)}`;
    const cur = map.get(key) ?? {};
    const a = (r.amounts ?? {}) as Record<string, { calc?: number; settle?: number } | number>;
    if (String(r.insurer) === "nps") {
      const total = Number((a as Record<string, number>).total ?? 0);
      cur.nps = Math.floor(total / 2 / 10) * 10; // 총액(9%) → 근로자 4.5%, 10원 절사
    } else {
      const nhis = a.nhis as { calc?: number; settle?: number } | undefined;
      const ltc = a.ltc as { calc?: number; settle?: number } | undefined;
      cur.nhis = Number(nhis?.calc ?? 0);
      cur.nhisSettle = Number(nhis?.settle ?? 0);
      cur.ltc = Number(ltc?.calc ?? 0);
      cur.ltcSettle = Number(ltc?.settle ?? 0);
    }
    map.set(key, cur);
  }
  return map;
}
