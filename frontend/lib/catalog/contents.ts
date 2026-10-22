import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import {
  isContentKey,
  sanitizeCeoMessage,
  sanitizeOrgChart,
  type CeoMessage,
  type ContentDataMap,
  type ContentKey,
  type ContentState,
  type ContentVersion,
} from "./content-types";
import { buildOrgChartFromMaster } from "./org-chart";

/*
 * 회사소개서 편집 콘텐츠(310 catalog_contents·catalog_content_versions) — 수시로 고치는 본문(대표이사 인사말, 조직도).
 * 사용자 요구(10-22): 언제든 고치고, 판(버전)을 기록하며, 소개서는 최신 확정판을 쓴다.
 * 편집 내용은 draft 에 임시 저장하고, [확정]하면 새 판으로 남긴다. 이전 판은 불러와서 다시 편집할 수 있다.
 * 타입·정리 함수는 클라이언트도 쓰도록 content-types.ts 에 있다.
 */

export * from "./content-types";

const s = (v: unknown): string => (v == null ? "" : String(v).trim());
const parse = (v: unknown): unknown => (typeof v === "string" ? JSON.parse(v) : v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function sanitizeFor<K extends ContentKey>(key: K, input: unknown): ContentDataMap[K] {
  return (key === "ceo_message" ? sanitizeCeoMessage(input) : sanitizeOrgChart(input)) as ContentDataMap[K];
}

async function defaultDraft<K extends ContentKey>(key: K): Promise<ContentDataMap[K]> {
  if (key === "org_chart") return (await buildOrgChartFromMaster()) as ContentDataMap[K];
  const db = await getDb();
  const ceo = s(rowsToObjects(await db.exec("SELECT ceo_name FROM company_profile WHERE profile_id = 'default'"))[0]?.ceo_name);
  const msg: CeoMessage = { title: "인사말", body: "", signTitle: "대표이사", signName: ceo, photoAssetId: null };
  return msg as ContentDataMap[K];
}

export async function getContent<K extends ContentKey>(key: K): Promise<ContentState<K>> {
  const db = await getDb();
  const row = rowsToObjects(await db.exec("SELECT * FROM catalog_contents WHERE content_key = $1", [key]))[0];
  const versions: ContentVersion<K>[] = rowsToObjects(
    await db.exec(
      `SELECT v.version, v.data, v.note, v.saved_at, COALESCE(u.name, '') AS saved_by_name
         FROM catalog_content_versions v
         LEFT JOIN users u ON u.user_id = v.saved_by
        WHERE v.content_key = $1
        ORDER BY v.version DESC`,
      [key]
    )
  ).map((r) => ({
    version: Number(r.version),
    data: sanitizeFor(key, parse(r.data)),
    note: s(r.note),
    savedAt: s(r.saved_at),
    savedByName: s(r.saved_by_name),
  }));
  const draft = row ? sanitizeFor(key, parse(row.draft)) : await defaultDraft(key);
  const latest = versions[0]?.data ?? null;
  return {
    key,
    draft,
    publishedVersion: row?.published_version != null ? Number(row.published_version) : null,
    draftDiffers: latest ? !same(draft, latest) : Boolean(row),
    updatedAt: row ? s(row.updated_at) : null,
    versions,
  };
}

/** 조직도 기본안 — MCM 조직 마스터에서 새로 만든 값(저장하지 않음). */
export async function getContentMaster(key: ContentKey): Promise<ContentDataMap[ContentKey] | null> {
  return key === "org_chart" ? buildOrgChartFromMaster() : null;
}

/** 소개서 생성용 — 최신 확정판(없으면 null). */
export async function getPublishedContent<K extends ContentKey>(key: K): Promise<ContentDataMap[K] | null> {
  const db = await getDb();
  const r = rowsToObjects(
    await db.exec("SELECT data FROM catalog_content_versions WHERE content_key = $1 ORDER BY version DESC LIMIT 1", [key])
  )[0];
  return r ? sanitizeFor(key, parse(r.data)) : null;
}

/** 인사말 사진은 존재하는 자산만 남긴다. */
async function checked<K extends ContentKey>(txn: PgDatabase, key: K, data: ContentDataMap[K]): Promise<ContentDataMap[K]> {
  if (key !== "ceo_message") return data;
  const msg = data as CeoMessage;
  if (!msg.photoAssetId) return data;
  const rows = rowsToObjects(await txn.exec("SELECT asset_id FROM catalog_assets WHERE asset_id = $1", [msg.photoAssetId]));
  return (rows.length ? msg : { ...msg, photoAssetId: null }) as ContentDataMap[K];
}

async function upsertDraft(txn: PgDatabase, key: ContentKey, data: unknown, now: string, actorUserId: string | null) {
  await txn.run(
    `INSERT INTO catalog_contents (content_key, draft, updated_at, updated_by) VALUES ($1, $2::jsonb, $3, $4)
     ON CONFLICT (content_key) DO UPDATE SET draft = EXCLUDED.draft, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
    [key, JSON.stringify(data), now, actorUserId]
  );
}

/** 임시 저장 */
export async function saveContentDraft(key: ContentKey, input: unknown, actorUserId: string | null): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    await upsertDraft(txn, key, await checked(txn, key, sanitizeFor(key, input)), now, actorUserId);
  });
}

/** 확정 — 보낸 내용을 임시 저장하고 새 판으로 기록한다. 돌려주는 값 = 새 판 번호. */
export async function publishContent(key: ContentKey, input: unknown, note: string, actorUserId: string | null): Promise<number> {
  const now = new Date().toISOString();
  return withDbWrite(async (txn) => {
    const data = await checked(txn, key, sanitizeFor(key, input));
    if (key === "ceo_message" && !(data as CeoMessage).body) {
      throw Object.assign(new Error("본문을 입력해야 확정할 수 있습니다."), { status: 400 });
    }
    if (key === "org_chart" && (data as ContentDataMap["org_chart"]).nodes.length === 0) {
      throw Object.assign(new Error("조직도에 상자가 하나 이상 있어야 확정할 수 있습니다."), { status: 400 });
    }
    // upsert 가 catalog_contents 행을 잠가 동시 확정이 와도 판 번호가 겹치지 않는다
    await upsertDraft(txn, key, data, now, actorUserId);
    const cur = rowsToObjects(
      await txn.exec("SELECT COALESCE(MAX(version), 0) AS v FROM catalog_content_versions WHERE content_key = $1", [key])
    )[0];
    const version = Number(cur?.v ?? 0) + 1;
    await txn.run(
      `INSERT INTO catalog_content_versions (content_key, version, data, note, saved_at, saved_by) VALUES ($1, $2, $3::jsonb, $4, $5, $6)`,
      [key, version, JSON.stringify(data), s(note).slice(0, 200) || null, now, actorUserId]
    );
    await txn.run("UPDATE catalog_contents SET published_version = $2 WHERE content_key = $1", [key, version]);
    return version;
  });
}

/** 이전 판을 임시 저장본으로 불러온다(확정은 따로). */
export async function restoreContentVersion(key: ContentKey, version: number, actorUserId: string | null): Promise<void> {
  const db = await getDb();
  const r = rowsToObjects(
    await db.exec("SELECT data FROM catalog_content_versions WHERE content_key = $1 AND version = $2", [key, version])
  )[0];
  if (!r) throw Object.assign(new Error("그 판을 찾을 수 없습니다."), { status: 404 });
  await saveContentDraft(key, parse(r.data), actorUserId);
}

