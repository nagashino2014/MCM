/**
 * facilities.region_sido / region_sigungu 백필 스크립트.
 *
 * 배경:
 * - 기존 `extractRegion()` 의 시군구 정규식이 `(?=\s|$)` 로 공백/끝을 강제했는데,
 *   site_address 가 공백 압축된 형태("경기도연천군양연로...")로 적재된 데이터가 다수 있어
 *   `region_sigungu` 가 비어 있는 사업장이 604건 중 381건(63%) 에 달함.
 * - region.ts 의 사전 기반 매칭으로 교체한 뒤, 기존 facilities 의 시도/시군구를 재계산해 갱신.
 *
 * 사용:
 *   - dry-run (기본): `npm exec ts-node scripts/backfill-region.ts`
 *   - 실제 적용:     `npm exec ts-node scripts/backfill-region.ts -- --apply`
 *   - JSON 리포트:   `npm exec ts-node scripts/backfill-region.ts -- --json`
 *
 * 안전 규칙:
 * - 기존 값이 NOT NULL 인데 새 계산이 NULL 이면 회귀로 간주, 그 컬럼은 갱신하지 않음 (KEEP).
 * - 기존 값이 NOT NULL 이고 새 값도 NOT NULL 이지만 다르면 정정으로 간주 (FIX).
 * - 기존 값이 NULL 이고 새 값이 NOT NULL 이면 채우기 (FILL).
 * - 기존 값과 새 값이 같으면 변경 없음 (SAME).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getDbAsync, flushDbToDisk } from "../lib/scraper/scraper-db";
import { extractRegion } from "../lib/ieps/region";

interface FacilityRow {
  facility_id: string;
  company_name: string;
  site_address: string | null;
  region_sido: string | null;
  region_sigungu: string | null;
}

interface BackfillRow {
  facility_id: string;
  company_name: string;
  site_address: string | null;
  oldSido: string | null;
  oldSgg: string | null;
  newSido: string | null;
  newSgg: string | null;
  sidoAction: "SAME" | "FILL" | "FIX" | "KEEP";
  sggAction: "SAME" | "FILL" | "FIX" | "KEEP";
}

function classify(
  oldV: string | null,
  newV: string | null
): "SAME" | "FILL" | "FIX" | "KEEP" {
  if (oldV === newV) return "SAME";
  if (oldV == null && newV != null) return "FILL";
  if (oldV != null && newV == null) return "KEEP";
  return "FIX";
}

async function runMain() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const asJson = args.includes("--json");

  const db = await getDbAsync();
  const result = db.exec(
    "SELECT facility_id, company_name, site_address, region_sido, region_sigungu FROM facilities ORDER BY company_name"
  );

  if (!result.length) {
    console.log("facilities 비어 있음. 종료.");
    return;
  }

  const cols = result[0].columns;
  const rows: FacilityRow[] = result[0].values.map((r) => {
    const o: any = {};
    cols.forEach((c, i) => (o[c] = r[i]));
    return o as FacilityRow;
  });

  const decisions: BackfillRow[] = rows.map((r) => {
    const region = extractRegion(r.site_address);
    return {
      facility_id: r.facility_id,
      company_name: r.company_name,
      site_address: r.site_address,
      oldSido: r.region_sido,
      oldSgg: r.region_sigungu,
      newSido: region.sido,
      newSgg: region.sigungu,
      sidoAction: classify(r.region_sido, region.sido),
      sggAction: classify(r.region_sigungu, region.sigungu),
    };
  });

  const summary = {
    total: decisions.length,
    sido: { SAME: 0, FILL: 0, FIX: 0, KEEP: 0 },
    sigungu: { SAME: 0, FILL: 0, FIX: 0, KEEP: 0 },
  } as const as {
    total: number;
    sido: Record<"SAME" | "FILL" | "FIX" | "KEEP", number>;
    sigungu: Record<"SAME" | "FILL" | "FIX" | "KEEP", number>;
  };
  for (const d of decisions) {
    summary.sido[d.sidoAction]++;
    summary.sigungu[d.sggAction]++;
  }

  if (asJson) {
    console.log(JSON.stringify({ apply, summary, decisions }, null, 2));
    return;
  }

  console.log(`\n=== 백필 요약 (총 ${summary.total}건) ===`);
  console.log(
    `  sido    : SAME ${summary.sido.SAME}  FILL ${summary.sido.FILL}  FIX ${summary.sido.FIX}  KEEP(회귀회피) ${summary.sido.KEEP}`
  );
  console.log(
    `  sigungu : SAME ${summary.sigungu.SAME}  FILL ${summary.sigungu.FILL}  FIX ${summary.sigungu.FIX}  KEEP(회귀회피) ${summary.sigungu.KEEP}`
  );

  const willChange = decisions.filter(
    (d) =>
      (d.sidoAction === "FILL" || d.sidoAction === "FIX") ||
      (d.sggAction === "FILL" || d.sggAction === "FIX")
  );

  console.log(`\n=== 변경 대상 (FILL / FIX) — ${willChange.length}건 ===`);
  for (const d of willChange) {
    const sidoTag = d.sidoAction === "SAME" ? "·" : `[${d.sidoAction}]`;
    const sggTag = d.sggAction === "SAME" ? "·" : `[${d.sggAction}]`;
    console.log(
      `  ${d.facility_id}  ${d.company_name}\n` +
        `     addr  : ${d.site_address ?? "(null)"}\n` +
        `     sido    ${sidoTag}  ${d.oldSido} → ${d.newSido}\n` +
        `     sigungu ${sggTag}  ${d.oldSgg} → ${d.newSgg}`
    );
  }

  const keptRegressions = decisions.filter(
    (d) => d.sidoAction === "KEEP" || d.sggAction === "KEEP"
  );
  if (keptRegressions.length) {
    console.log(
      `\n=== 회귀 회피 (기존 값 보존, ${keptRegressions.length}건) — 변경 안 함 ===`
    );
    for (const d of keptRegressions) {
      console.log(
        `  ${d.facility_id}  ${d.company_name}` +
          (d.sidoAction === "KEEP" ? `  sido 보존:${d.oldSido}↛${d.newSido}` : "") +
          (d.sggAction === "KEEP" ? `  sigungu 보존:${d.oldSgg}↛${d.newSgg}` : "")
      );
    }
  }

  if (!apply) {
    console.log(
      `\n--apply 가 지정되지 않았습니다. 실제 갱신은 수행되지 않았습니다 (dry-run).` +
        `\n실제 적용: npm exec ts-node scripts/backfill-region.ts -- --apply`
    );
    return;
  }

  const now = new Date().toISOString();
  let updated = 0;
  for (const d of willChange) {
    const newSidoForDb =
      d.sidoAction === "FILL" || d.sidoAction === "FIX" ? d.newSido : d.oldSido;
    const newSggForDb =
      d.sggAction === "FILL" || d.sggAction === "FIX" ? d.newSgg : d.oldSgg;
    db.run(
      "UPDATE facilities SET region_sido = ?, region_sigungu = ?, updated_at = ? WHERE facility_id = ?",
      [newSidoForDb, newSggForDb, now, d.facility_id]
    );
    updated++;
  }
  flushDbToDisk();
  console.log(`\n적용 완료 — ${updated}건 UPDATE.`);
}

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outPath = outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1] : null;

  // PowerShell `>` 리디렉션이 콘솔 인코딩을 깨뜨리는 문제를 회피하기 위해 --out 사용 시
  // 모든 console.log 출력을 UTF-8 로 파일에 직접 기록한다.
  const buffer: string[] = [];
  const origLog = console.log.bind(console);
  if (outPath) {
    console.log = ((...a: unknown[]) => {
      buffer.push(
        a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")
      );
    }) as typeof console.log;
  }

  try {
    await runMain();
  } finally {
    if (outPath) {
      const abs = path.isAbsolute(outPath)
        ? outPath
        : path.resolve(process.cwd(), outPath);
      fs.writeFileSync(abs, buffer.join("\n") + "\n", { encoding: "utf-8" });
      console.log = origLog;
      origLog(`보고서 저장: ${abs}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
