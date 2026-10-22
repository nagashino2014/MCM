import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { CLIENT_CATEGORIES, type CatalogClient, type ClientCandidate, type ClientCategory } from "./client-types";

/*
 * 회사소개서 고객사·협력 기관(C17 로고 월) + 자산(catalog_assets). 블루프린트 §6-2.
 * 로고 파일은 계약 문서 저장소의 catalog/assets/{asset_id}/ 프리픽스에 둔다.
 * 계약 거래처(facilities)와 연결할 수 있지만 필수는 아니다(협회·공공기관은 계약이 없을 수 있다).
 */

export { CLIENT_CATEGORIES } from "./client-types";
export type { CatalogClient, ClientCandidate, ClientCategory } from "./client-types";

const s = (v: unknown): string => (v == null ? "" : String(v).trim());
const normCategory = (v: unknown): ClientCategory => ((CLIENT_CATEGORIES as readonly string[]).includes(s(v)) ? (s(v) as ClientCategory) : "민간");

export async function listClients(): Promise<CatalogClient[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT cl.*, COALESCE(cc.n, 0) AS contract_count
         FROM catalog_clients cl
         LEFT JOIN (
           SELECT counterparty_facility_id AS facility_id, COUNT(*) AS n
             FROM contracts WHERE deleted_at IS NULL GROUP BY counterparty_facility_id
         ) cc ON cc.facility_id = cl.facility_id
        ORDER BY cl.category ASC, cl.order_no ASC, cl.name ASC`
    )
  );
  return rows.map((r) => ({
    clientId: s(r.client_id),
    facilityId: r.facility_id != null ? String(r.facility_id) : null,
    name: s(r.name),
    category: normCategory(r.category),
    logoAssetId: r.logo_asset_id != null ? String(r.logo_asset_id) : null,
    orderNo: Number(r.order_no ?? 0),
    isPublic: Number(r.is_public ?? 1) === 1,
    contractCount: Number(r.contract_count ?? 0),
  }));
}

/** 아직 등록하지 않은 계약 거래처 — 계약 수 많은 순(로고 월 후보). */
export async function listClientCandidates(limit = 60): Promise<ClientCandidate[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT f.facility_id, f.company_name, COUNT(*) AS n,
              MAX(COALESCE(NULLIF(c.contract_date, ''), c.started_at, c.created_at)) AS last_date
         FROM contracts c
         JOIN facilities f ON f.facility_id = c.counterparty_facility_id
        WHERE c.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM catalog_clients cl WHERE cl.facility_id = f.facility_id)
        GROUP BY f.facility_id, f.company_name
        ORDER BY n DESC, last_date DESC
        LIMIT $1`,
      [Math.min(200, Math.max(1, limit))]
    )
  );
  return rows.map((r) => ({
    facilityId: s(r.facility_id),
    name: s(r.company_name),
    contractCount: Number(r.n ?? 0),
    lastContractDate: s(r.last_date).slice(0, 10),
  }));
}

export async function saveClient(
  input: { clientId?: string | null; facilityId?: string | null; name: string; category?: string; orderNo?: number; isPublic?: boolean },
  actorUserId: string | null
): Promise<string> {
  const name = s(input.name);
  if (!name) throw Object.assign(new Error("고객사 이름을 입력하세요."), { status: 400 });
  const clientId = s(input.clientId) || "ccl_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    await txn.run(
      `INSERT INTO catalog_clients (client_id, facility_id, name, category, order_no, is_public, created_at, updated_at, updated_by)
       VALUES ($1, (SELECT facility_id FROM facilities WHERE facility_id = $2), $3, $4, $5, $6, $7, $7, $8)
       ON CONFLICT (client_id) DO UPDATE SET
         facility_id = EXCLUDED.facility_id, name = EXCLUDED.name, category = EXCLUDED.category,
         order_no = EXCLUDED.order_no, is_public = EXCLUDED.is_public,
         updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
      [
        clientId,
        s(input.facilityId) || null,
        name.slice(0, 200),
        normCategory(input.category),
        Number.isFinite(Number(input.orderNo)) ? Math.round(Number(input.orderNo)) : 0,
        input.isPublic === false ? 0 : 1,
        now,
        actorUserId,
      ]
    );
  });
  return clientId;
}

export async function deleteClient(clientId: string): Promise<void> {
  await withDbWrite(async (txn) => {
    // 로고 자산은 다른 문서(발행본)가 참조할 수 있어 지우지 않는다 — 고객사 행만 삭제.
    await txn.run("DELETE FROM catalog_clients WHERE client_id = $1", [s(clientId)]);
  });
}

// ─────────────────────────────── 자산 ───────────────────────────────

export interface CatalogAsset {
  assetId: string;
  kind: "photo" | "logo" | "certificate" | "map";
  storageKey: string;
  fileName: string;
  contentType: string;
}

// SVG 는 스크립트를 품을 수 있어 받지 않는다(같은 출처에서 열리면 XSS). 사진도 같은 형식만 받는다.
export const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
export const IMAGE_TYPES = LOGO_TYPES;

/** 이미지 자산 업로드(로고·사진·증서) → catalog_assets 등록. 자산 행은 지우지 않는다(발행본 재현). */
export async function uploadCatalogAsset(params: {
  kind: CatalogAsset["kind"];
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
  actorUserId: string | null;
}): Promise<CatalogAsset> {
  const { putContractDocument, sanitizeFilename } = await import("@/lib/storage/contract-document-storage");
  const assetId = "cas_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const fileName = sanitizeFilename(params.fileName) || `${params.kind}.png`;
  const stored = await putContractDocument(["catalog", "assets", assetId, fileName].join("/"), Buffer.from(params.bytes), params.contentType);
  await withDbWrite(async (txn) => {
    await txn.run(
      `INSERT INTO catalog_assets (asset_id, kind, storage_key, file_name, content_type, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [assetId, params.kind, stored.storageKey, fileName, params.contentType, params.actorUserId, new Date().toISOString()]
    );
  });
  return { assetId, kind: params.kind, storageKey: stored.storageKey, fileName, contentType: params.contentType };
}

/** 로고 업로드 → 자산 등록 → 고객사에 연결(기존 로고는 교체, 자산 행은 발행본 재현을 위해 남긴다). */
export async function uploadClientLogo(params: {
  clientId: string;
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
  actorUserId: string | null;
}): Promise<CatalogAsset> {
  const asset = await uploadCatalogAsset({ ...params, kind: "logo" });
  await withDbWrite(async (txn) => {
    await txn.run("UPDATE catalog_clients SET logo_asset_id = $2, updated_at = $3, updated_by = $4 WHERE client_id = $1", [
      s(params.clientId),
      asset.assetId,
      new Date().toISOString(),
      params.actorUserId,
    ]);
  });
  return asset;
}

export async function getCatalogAsset(assetId: string): Promise<CatalogAsset | null> {
  const db = await getDb();
  const r = rowsToObjects(await db.exec("SELECT * FROM catalog_assets WHERE asset_id = $1", [s(assetId)]))[0];
  if (!r) return null;
  return {
    assetId: s(r.asset_id),
    kind: s(r.kind) as CatalogAsset["kind"],
    storageKey: s(r.storage_key),
    fileName: s(r.file_name),
    contentType: s(r.content_type) || "application/octet-stream",
  };
}
