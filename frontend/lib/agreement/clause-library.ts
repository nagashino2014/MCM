// 계약서 조항 라이브러리(149) — 과거 계약서·표준 셋의 조문을 모아 작성 화면에서 검색·삽입한다.
// 같은 조문이 여러 양식에 중복 존재하므로 body_hash(제목+본문 정규화 md5)로 적재를 막는다.
// ⚠ lib/approval/docs.ts 와의 순환 import 금지 — 여기서는 db 만 사용한다(계약서 store 관례).

import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { SEED_TEMPLATES } from "./catalog";
import type { AgreementClause } from "./types";

/** 분류 — 작성 화면 필터·관리 화면 그룹의 단일 목록 */
export const CLAUSE_CATEGORIES = [
  "목적·범위",
  "기간·착수",
  "대금",
  "성과물·검수",
  "보안",
  "책임·하자",
  "지재권",
  "해지·분쟁",
  "기타",
] as const;
export type ClauseCategory = (typeof CLAUSE_CATEGORIES)[number];

export interface ClauseLibraryRow {
  clauseId: string;
  title: string;
  body: string;
  category: string;
  tags: string[];
  serviceType: string | null;
  source: "seed" | "harvested" | "manual";
  sourceTemplateId: string | null;
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function newId(): string {
  return "acl-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14);
}

/** 중복 판정 키 — 공백·문장부호 차이는 같은 조문으로 본다(양식마다 자간이 다르다) */
export function clauseHash(title: string, body: string): string {
  const norm = (s: string) => s.replace(/\s+/g, "").replace(/[·․.,'"“”‘’()（）]/g, "").toLowerCase();
  return crypto.createHash("md5").update(`${norm(title)}|${norm(body)}`).digest("hex");
}

/** 제목으로 분류 추정 — 수확 시 사람 손을 덜기 위한 규칙(사용자가 관리 화면에서 고칠 수 있다) */
export function guessCategory(title: string): ClauseCategory {
  const t = title.replace(/\s/g, "");
  if (/목적|업무범위|계약의업무|과업/.test(t)) return "목적·범위";
  if (/기간|착수|공기/.test(t)) return "기간·착수";
  if (/대금|지급|금액|선급|기성|지체상금/.test(t)) return "대금";
  if (/성과|납품|검수|보고|결과물/.test(t)) return "성과물·검수";
  if (/보안|비밀|기밀|보호/.test(t)) return "보안";
  if (/책임|하자|손해|배상|보증/.test(t)) return "책임·하자";
  if (/지식재산|지적재산|저작권|특허/.test(t)) return "지재권";
  if (/해제|해지|분쟁|관할|중지/.test(t)) return "해지·분쟁";
  return "기타";
}

function mapRow(r: Record<string, unknown>): ClauseLibraryRow {
  return {
    clauseId: String(r.clause_id ?? ""),
    title: String(r.title ?? ""),
    body: String(r.body ?? ""),
    category: String(r.category ?? "기타"),
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    serviceType: r.service_type != null ? String(r.service_type) : null,
    source: (["seed", "harvested", "manual"].includes(String(r.source)) ? String(r.source) : "manual") as ClauseLibraryRow["source"],
    sourceTemplateId: r.source_template_id != null ? String(r.source_template_id) : null,
    usageCount: Number(r.usage_count ?? 0),
    lastUsedAt: r.last_used_at != null ? String(r.last_used_at) : null,
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  };
}

export async function listClauses(params: {
  q?: string | null;
  category?: string | null;
  serviceType?: string | null;
  limit?: number;
}): Promise<ClauseLibraryRow[]> {
  const db = await getDb();
  const cond: string[] = [];
  const args: unknown[] = [];
  if (params.q?.trim()) {
    args.push(`%${params.q.trim()}%`);
    cond.push(`(title ILIKE $${args.length} OR body ILIKE $${args.length})`);
  }
  if (params.category) {
    args.push(params.category);
    cond.push(`category = $${args.length}`);
  }
  if (params.serviceType) {
    // 공통 조항(service_type NULL)은 항상 포함한다
    args.push(params.serviceType);
    cond.push(`(service_type IS NULL OR service_type = $${args.length})`);
  }
  args.push(Math.min(Math.max(Number(params.limit) || 200, 1), 500));
  const rows = rowsToObjects(
    await db.exec(
      `SELECT * FROM agreement_clause_library
        ${cond.length ? `WHERE ${cond.join(" AND ")}` : ""}
        ORDER BY usage_count DESC, updated_at DESC
        LIMIT $${args.length}`,
      args
    )
  );
  return rows.map(mapRow);
}

export interface ClauseInput {
  title: string;
  body: string;
  category?: string;
  tags?: string[];
  serviceType?: string | null;
  source?: ClauseLibraryRow["source"];
  sourceTemplateId?: string | null;
  createdBy?: string | null;
}

/** 단건 등록 — 같은 조문이 이미 있으면 건너뛴다(등록 여부를 반환) */
export async function addClause(input: ClauseInput): Promise<{ clauseId: string | null; duplicated: boolean }> {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || !body) throw new Error("조항 제목과 본문을 입력하세요.");
  const hash = clauseHash(title, body);
  const now = new Date().toISOString();
  let clauseId: string | null = null;
  let duplicated = false;
  await withDbWrite(async (txn) => {
    const rows = rowsToObjects(
      await txn.exec(
        `INSERT INTO agreement_clause_library
           (clause_id, title, body, category, tags, service_type, source, source_template_id,
            body_hash, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8, $9, $10, $11, $11)
         ON CONFLICT (body_hash) DO NOTHING
         RETURNING clause_id`,
        [
          newId(),
          title,
          body,
          input.category?.trim() || guessCategory(title),
          input.tags?.length ? input.tags : null,
          input.serviceType ?? null,
          input.source ?? "manual",
          input.sourceTemplateId ?? null,
          hash,
          input.createdBy ?? null,
          now,
        ]
      )
    );
    if (rows.length) clauseId = String(rows[0].clause_id);
    else duplicated = true;
  });
  return { clauseId, duplicated };
}

export async function updateClause(
  clauseId: string,
  patch: { title?: string; body?: string; category?: string; tags?: string[]; serviceType?: string | null }
): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    const rows = rowsToObjects(await txn.exec(`SELECT title, body FROM agreement_clause_library WHERE clause_id = $1`, [clauseId]));
    if (!rows.length) throw new Error("조항을 찾을 수 없습니다.");
    const title = patch.title?.trim() || String(rows[0].title);
    const body = patch.body?.trim() || String(rows[0].body);
    await txn.run(
      `UPDATE agreement_clause_library
          SET title = $2, body = $3, body_hash = $4,
              category = COALESCE($5, category),
              tags = COALESCE($6::text[], tags),
              service_type = $7,
              updated_at = $8
        WHERE clause_id = $1`,
      [clauseId, title, body, clauseHash(title, body), patch.category ?? null, patch.tags?.length ? patch.tags : null, patch.serviceType ?? null, now]
    );
  });
}

export async function deleteClause(clauseId: string): Promise<void> {
  await withDbWrite(async (txn) => {
    await txn.run(`DELETE FROM agreement_clause_library WHERE clause_id = $1`, [clauseId]);
  });
}

/** 삽입 시 사용 횟수 증가 — 자주 쓰는 조항이 검색 상단에 오도록 */
export async function markClauseUsed(clauseIds: string[]): Promise<void> {
  if (!clauseIds.length) return;
  await withDbWrite(async (txn) => {
    await txn.run(
      `UPDATE agreement_clause_library SET usage_count = usage_count + 1, last_used_at = $2 WHERE clause_id = ANY($1)`,
      [clauseIds, new Date().toISOString()]
    );
  });
}

/**
 * 일괄 수확 — 표준 셋 시드 + DB 템플릿(표준·자체양식)의 조문을 라이브러리에 적재한다.
 * 지급방법처럼 데이터에서 자동 생성되는 조(binding='payment')는 본문이 비어 있어 제외한다.
 */
export async function harvestClauses(createdBy?: string | null): Promise<{ added: number; skipped: number }> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT template_id, name, service_type, spec FROM agreement_templates WHERE status <> 'archived'`)
  );

  interface Src {
    clause: AgreementClause;
    templateId: string | null;
    serviceType: string | null;
    source: ClauseLibraryRow["source"];
  }
  const list: Src[] = [];

  // 코드 시드(표준 A·B형) — DB 에 fork 되지 않은 상태에서도 라이브러리는 채워져 있어야 한다
  for (const seed of SEED_TEMPLATES) {
    for (const c of seed.spec.clausePage?.clauses ?? []) {
      list.push({ clause: c, templateId: null, serviceType: seed.serviceType, source: "seed" });
    }
  }
  for (const r of rows) {
    let spec: { clausePage?: { clauses?: AgreementClause[] } } = {};
    try {
      spec = typeof r.spec === "string" ? JSON.parse(String(r.spec)) : ((r.spec ?? {}) as typeof spec);
    } catch {
      continue;
    }
    for (const c of spec.clausePage?.clauses ?? []) {
      list.push({
        clause: c,
        templateId: String(r.template_id),
        serviceType: r.service_type != null ? String(r.service_type) : null,
        source: "harvested",
      });
    }
  }

  let added = 0;
  let skipped = 0;
  for (const item of list) {
    const { title, body, binding } = item.clause;
    if (binding === "payment" || !body?.trim() || !title?.trim()) {
      skipped++;
      continue;
    }
    const res = await addClause({
      title,
      body,
      category: guessCategory(title),
      // 수확 조항은 공통으로 둔다 — 특정 대분류 전용 여부는 사용자가 관리 화면에서 지정
      serviceType: null,
      source: item.source,
      sourceTemplateId: item.templateId,
      createdBy,
    }).catch(() => ({ clauseId: null, duplicated: true }));
    if (res.clauseId) added++;
    else skipped++;
  }
  return { added, skipped };
}
