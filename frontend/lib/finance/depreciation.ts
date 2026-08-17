// 고정자산 상각 엔진 (블루프린트 P6-A) — 월할 상각(세무법인 실측: 매월 말 기표) + 전표 소스 제공.
// 정액 = 취득가 × (1/내용연수) / 12, 정률 = 연초 미상각잔액 × 상각률(depreciation_rates 시드) / 12.
// 비망가액(residual_value, 기본 1,000원)에 도달하면 중단. 처분월부터 중단(처분 손익 분개는 수동).
// 앱 기표 구간 = opening_as_of(기왕 누계 기준일)가 속한 달의 다음 달부터 — 그 이전은 opening_accum 으로 인수.

import { createHash } from "node:crypto";
import { getDb, withDbWrite, rowsToObjects } from "@/lib/db";

const KST_NOW = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");

const hashId = (prefix: string, source: string) =>
  `${prefix}-${createHash("sha256").update(source).digest("hex").slice(0, 12)}`;

/** 카테고리 → (취득 계정, 감가상각누계액 계정) — 178 계정 체계. */
export const FA_ACCOUNTS: Record<string, { asset: string; accum: string; label: string }> = {
  building: { asset: "202", accum: "203", label: "건물" },
  machine: { asset: "206", accum: "207", label: "기계장치" },
  vehicle: { asset: "208", accum: "209", label: "차량운반구" },
  fixture: { asset: "212", accum: "213", label: "비품" },
};

export interface FixedAsset {
  faId: string;
  name: string;
  category: string;
  acquisitionDate: string;
  acquisitionCost: number;
  method: "straight" | "declining";
  usefulLifeYears: number;
  residualValue: number;
  openingAccum: number;
  openingAsOf: string | null;
  disposedAt: string | null;
  disposalMemo: string | null;
  linkedAssetId: string | null;
  memo: string | null;
  isActive: boolean;
}

function mapAsset(r: Record<string, unknown>): FixedAsset {
  return {
    faId: String(r.fa_id),
    name: String(r.name),
    category: String(r.category),
    acquisitionDate: String(r.acquisition_date),
    acquisitionCost: Number(r.acquisition_cost || 0),
    method: r.method === "declining" ? "declining" : "straight",
    usefulLifeYears: Number(r.useful_life_years || 0),
    residualValue: Number(r.residual_value || 0),
    openingAccum: Number(r.opening_accum || 0),
    openingAsOf: r.opening_as_of ? String(r.opening_as_of) : null,
    disposedAt: r.disposed_at ? String(r.disposed_at) : null,
    disposalMemo: r.disposal_memo ? String(r.disposal_memo) : null,
    linkedAssetId: r.linked_asset_id ? String(r.linked_asset_id) : null,
    memo: r.memo ? String(r.memo) : null,
    isActive: Number(r.is_active || 0) === 1,
  };
}

export async function listFixedAssets(): Promise<FixedAsset[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT * FROM fixed_assets ORDER BY is_active DESC, category, acquisition_date`),
  );
  return rows.map(mapAsset);
}

export async function saveFixedAsset(input: {
  faId?: string;
  name: string;
  category: string;
  acquisitionDate: string;
  acquisitionCost: number;
  method: string;
  usefulLifeYears: number;
  residualValue?: number;
  openingAccum?: number;
  openingAsOf?: string | null;
  linkedAssetId?: string | null;
  memo?: string | null;
}): Promise<string> {
  if (!FA_ACCOUNTS[input.category]) throw Object.assign(new Error("자산 구분이 올바르지 않습니다."), { status: 400 });
  // 건물은 세법상 정액법 강제
  const method = input.category === "building" ? "straight" : input.method === "declining" ? "declining" : "straight";
  const faId = input.faId || hashId("fa", `${input.name}:${input.acquisitionDate}:${Date.now()}`);
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO fixed_assets
         (fa_id, name, category, acquisition_date, acquisition_cost, method, useful_life_years,
          residual_value, opening_accum, opening_as_of, linked_asset_id, memo, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULLIF($10, ''), NULLIF($11, ''), NULLIF($12, ''), $13)
       ON CONFLICT (fa_id) DO UPDATE SET
         name = EXCLUDED.name, category = EXCLUDED.category, acquisition_date = EXCLUDED.acquisition_date,
         acquisition_cost = EXCLUDED.acquisition_cost, method = EXCLUDED.method,
         useful_life_years = EXCLUDED.useful_life_years, residual_value = EXCLUDED.residual_value,
         opening_accum = EXCLUDED.opening_accum, opening_as_of = EXCLUDED.opening_as_of,
         linked_asset_id = EXCLUDED.linked_asset_id, memo = EXCLUDED.memo, is_active = 1, updated_at = $13`,
      [
        faId,
        input.name.trim(),
        input.category,
        input.acquisitionDate,
        input.acquisitionCost,
        method,
        input.usefulLifeYears,
        input.residualValue ?? 1000,
        input.openingAccum ?? 0,
        input.openingAsOf ?? "",
        input.linkedAssetId ?? "",
        input.memo ?? "",
        KST_NOW(),
      ],
    );
  });
  return faId;
}

export async function disposeFixedAsset(faId: string, disposedAt: string, memo?: string | null): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(
      `UPDATE fixed_assets SET disposed_at = $2, disposal_memo = NULLIF($3, ''), updated_at = $4 WHERE fa_id = $1`,
      [faId, disposedAt, memo ?? "", KST_NOW()],
    );
  });
}

export async function deactivateFixedAsset(faId: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(`UPDATE fixed_assets SET is_active = 0, updated_at = $2 WHERE fa_id = $1`, [faId, KST_NOW()]);
  });
}

// ── 상각 스케줄 ──

export interface DepreciationMonth {
  month: string; // YYYY-MM
  amount: number;
  accumAfter: number; // 월말 누계(opening 포함)
  bookValueAfter: number;
}

const ymOf = (date: string) => date.slice(0, 7);
const nextYm = (ym: string) => {
  let y = Number(ym.slice(0, 4));
  let m = Number(ym.slice(5, 7)) + 1;
  if (m > 12) { m = 1; y += 1; }
  return `${y}-${String(m).padStart(2, "0")}`;
};

/**
 * 자산의 앱 기표 상각 스케줄 — 시작월(취득월 또는 opening 다음 달)부터 toYm 까지.
 * 정률법의 "연초 미상각잔액"은 순차 시뮬레이션으로 유지한다.
 */
export function buildSchedule(
  asset: FixedAsset,
  toYm: string,
  decliningRates: Map<number, number>,
): DepreciationMonth[] {
  const out: DepreciationMonth[] = [];
  if (asset.acquisitionCost <= 0 || asset.usefulLifeYears <= 0) return out;
  const acqYm = ymOf(asset.acquisitionDate);
  let startYm = acqYm;
  if (asset.openingAsOf) {
    const openNext = nextYm(ymOf(asset.openingAsOf));
    if (openNext > startYm) startYm = openNext;
  }
  const endYm = asset.disposedAt ? ymOf(asset.disposedAt) : null; // 처분월부터 중단(전월까지 상각)
  const floorValue = Math.max(asset.residualValue, 0);
  const rate = decliningRates.get(asset.usefulLifeYears) ?? 1 / asset.usefulLifeYears;

  let accum = asset.openingAccum;
  // 정률: 해당 연도 1월(또는 시작월) 시점 잔액으로 연간 상각액 확정 → 매월 1/12
  let yearOpenBook = asset.acquisitionCost - accum;
  let currentYear = startYm.slice(0, 4);
  let ym = startYm;
  let guard = 0;
  while (ym <= toYm && guard < 1200) {
    guard += 1;
    if (endYm && ym >= endYm) break;
    const book = asset.acquisitionCost - accum;
    if (book <= floorValue) break;
    if (ym.slice(0, 4) !== currentYear) {
      currentYear = ym.slice(0, 4);
      yearOpenBook = book;
    }
    const annual =
      asset.method === "declining"
        ? Math.floor(yearOpenBook * rate)
        : Math.floor(asset.acquisitionCost / asset.usefulLifeYears);
    let monthly = Math.floor(annual / 12);
    if (monthly <= 0) monthly = book - floorValue; // 말기 잔액 소진
    if (monthly > book - floorValue) monthly = book - floorValue; // 비망가액 보호
    if (monthly > 0) {
      accum += monthly;
      out.push({ month: ym, amount: monthly, accumAfter: accum, bookValueAfter: asset.acquisitionCost - accum });
    }
    ym = nextYm(ym);
  }
  return out;
}

export async function loadDecliningRates(): Promise<Map<number, number>> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT years, declining_rate FROM depreciation_rates`));
  return new Map(rows.map((r) => [Number(r.years), Number(r.declining_rate)]));
}

/** 기간(YYYY-MM-DD ~) 내 월별 상각 목록 — journal 재생성이 소비한다. */
export interface DepreciationEntryRow {
  faId: string;
  name: string;
  category: string;
  month: string; // YYYY-MM
  entryDate: string; // 월말일
  amount: number;
}

const lastDayOf = (ym: string) => {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
};

export async function depreciationForRange(from: string, to: string): Promise<DepreciationEntryRow[]> {
  const db = await getDb();
  const assets = rowsToObjects(await db.exec(`SELECT * FROM fixed_assets WHERE is_active = 1`)).map(mapAsset);
  if (!assets.length) return [];
  const rates = await loadDecliningRates();
  // 미완료 월은 기표하지 않는다(월말 마감 성격) — to 와 이번 달 중 이른 쪽까지.
  const nowKst = new Date(Date.now() + 9 * 3600 * 1000);
  const currentYm = `${nowKst.getUTCFullYear()}-${String(nowKst.getUTCMonth() + 1).padStart(2, "0")}`;
  let toYm = ymOf(to);
  if (toYm >= currentYm) {
    // 이번 달은 말일이 지나야 확정 — 전월까지
    const prev = new Date(Date.UTC(nowKst.getUTCFullYear(), nowKst.getUTCMonth() - 1, 1));
    const prevYm = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
    toYm = prevYm < toYm ? prevYm : toYm;
  }
  const fromYm = ymOf(from);
  const out: DepreciationEntryRow[] = [];
  for (const asset of assets) {
    for (const row of buildSchedule(asset, toYm, rates)) {
      if (row.month < fromYm) continue;
      out.push({
        faId: asset.faId,
        name: asset.name,
        category: asset.category,
        month: row.month,
        entryDate: lastDayOf(row.month),
        amount: row.amount,
      });
    }
  }
  return out;
}
