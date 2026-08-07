// 착수계·준공계 문서(contract_deliverables, 142) DB 접근.
// 결재를 태우지 않으므로(공문 결재로 갈음) 이 테이블의 field_values 가 곧 문서 원본이다.
// 발주처 자체양식(deliverable_templates)도 여기서 함께 다룬다.

import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import type {
  DeliverableKind,
  DeliverableRow,
  DeliverableSpec,
  DeliverableStatus,
  DeliverableTemplateRow,
  DeliverableUnlocked,
  DeliverableValues,
  TemplateProfile,
  TemplateRenderMode,
  TemplateSourceKind,
} from "./types";

function newId(prefix: string): string {
  return prefix + crypto.randomUUID().replace(/-/g, "").slice(0, 14);
}

const s = (v: unknown): string => (v == null ? "" : String(v));
const sn = (v: unknown): string | null => (v == null ? null : String(v));

function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function mapRow(r: Record<string, unknown>): DeliverableRow {
  return {
    deliverableId: s(r.deliverable_id),
    contractId: s(r.contract_id),
    kind: s(r.kind) === "start" ? "start" : "completion",
    templateId: sn(r.template_id),
    templateName: sn(r.template_name),
    docTypes: parseJson<string[]>(r.doc_types, []),
    title: s(r.title),
    values: parseJson<DeliverableValues>(r.field_values, {}),
    unlocked: parseJson<DeliverableUnlocked>(r.unlocked, {}),
    pdfKey: sn(r.pdf_key),
    hwpxKey: sn(r.hwpx_key),
    generatedAt: sn(r.generated_at),
    letterDocId: sn(r.letter_doc_id),
    letterNo: sn(r.letter_no),
    status: (s(r.status) || "draft") as DeliverableStatus,
    drafterName: sn(r.drafter_name),
    createdAt: s(r.created_at),
    updatedAt: s(r.updated_at),
  };
}

const SELECT_COLS = `d.*, t.name AS template_name`;
const FROM_JOIN = `FROM contract_deliverables d LEFT JOIN deliverable_templates t ON t.template_id = d.template_id`;

export async function createDeliverable(params: {
  contractId: string;
  kind: DeliverableKind;
  templateId?: string | null;
  docTypes: string[];
  title: string;
  values: DeliverableValues;
  unlocked?: DeliverableUnlocked;
  drafterName?: string | null;
  createdBy?: string | null;
}): Promise<string> {
  const id = newId("dlv-");
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    await txn.run(
      `INSERT INTO contract_deliverables
         (deliverable_id, contract_id, kind, template_id, doc_types, title, field_values, unlocked,
          status, drafter_name, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8::jsonb, 'draft', $9, $10, $11, $11)`,
      [
        id,
        params.contractId,
        params.kind,
        params.templateId ?? null,
        JSON.stringify(params.docTypes ?? []),
        params.title,
        JSON.stringify(params.values ?? {}),
        JSON.stringify(params.unlocked ?? {}),
        params.drafterName ?? null,
        params.createdBy ?? null,
        now,
      ]
    );
  });
  return id;
}

export async function updateDeliverable(
  deliverableId: string,
  patch: {
    docTypes?: string[];
    templateId?: string | null;
    title?: string;
    values?: DeliverableValues;
    unlocked?: DeliverableUnlocked;
    status?: DeliverableStatus;
  }
): Promise<void> {
  const sets: string[] = [];
  const args: unknown[] = [deliverableId];
  const put = (sql: string, value: unknown) => {
    args.push(value);
    sets.push(sql.replace("$n", `$${args.length}`));
  };
  if (patch.docTypes !== undefined) put("doc_types = $n::jsonb", JSON.stringify(patch.docTypes));
  if (patch.templateId !== undefined) put("template_id = $n", patch.templateId);
  if (patch.title !== undefined) put("title = $n", patch.title);
  if (patch.values !== undefined) put("field_values = $n::jsonb", JSON.stringify(patch.values));
  if (patch.unlocked !== undefined) put("unlocked = $n::jsonb", JSON.stringify(patch.unlocked));
  if (patch.status !== undefined) put("status = $n", patch.status);
  if (!sets.length) return;
  put("updated_at = $n", new Date().toISOString());
  await withDbWrite(async (txn) => {
    await txn.run(`UPDATE contract_deliverables SET ${sets.join(", ")} WHERE deliverable_id = $1`, args);
  });
}

/** 산출물(PDF/HWPX) 키 기록 — 생성 시마다 교체. */
export async function setDeliverableArtifacts(
  deliverableId: string,
  artifacts: { pdfKey?: string | null; hwpxKey?: string | null }
): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    await txn.run(
      `UPDATE contract_deliverables
          SET pdf_key = COALESCE($2, pdf_key),
              hwpx_key = COALESCE($3, hwpx_key),
              generated_at = $4,
              status = CASE WHEN status = 'draft' THEN 'ready' ELSE status END,
              updated_at = $4
        WHERE deliverable_id = $1`,
      [deliverableId, artifacts.pdfKey ?? null, artifacts.hwpxKey ?? null, now]
    );
  });
}

/** 공문 첨부 연계 기록(D3) — 공문 작성 화면에서 첨부 확정 시. */
export async function linkDeliverableToLetter(deliverableId: string, docId: string): Promise<void> {
  await withDbWrite(async (txn) => {
    await txn.run(
      `UPDATE contract_deliverables SET letter_doc_id = $2, status = 'attached', updated_at = $3
        WHERE deliverable_id = $1 AND status <> 'sent'`,
      [deliverableId, docId, new Date().toISOString()]
    );
  });
}

/** 공문 발송 완료 시 상태·시행번호 역기록(D3). */
export async function markDeliverablesSent(docId: string, letterNo: string | null): Promise<void> {
  await withDbWrite(async (txn) => {
    await txn.run(
      `UPDATE contract_deliverables SET status = 'sent', letter_no = $2, updated_at = $3 WHERE letter_doc_id = $1`,
      [docId, letterNo, new Date().toISOString()]
    );
  });
}

export async function getDeliverable(deliverableId: string): Promise<DeliverableRow | null> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT ${SELECT_COLS} ${FROM_JOIN} WHERE d.deliverable_id = $1`, [deliverableId]));
  return rows.length ? mapRow(rows[0]) : null;
}

export async function listDeliverables(params: {
  contractId?: string | null;
  kind?: DeliverableKind | null;
  status?: DeliverableStatus | null;
  q?: string | null;
  limit?: number;
}): Promise<DeliverableRow[]> {
  const db = await getDb();
  const cond: string[] = [];
  const args: unknown[] = [];
  if (params.contractId) {
    args.push(params.contractId);
    cond.push(`d.contract_id = $${args.length}`);
  }
  if (params.kind) {
    args.push(params.kind);
    cond.push(`d.kind = $${args.length}`);
  }
  if (params.status) {
    args.push(params.status);
    cond.push(`d.status = $${args.length}`);
  }
  if (params.q?.trim()) {
    args.push(`%${params.q.trim()}%`);
    cond.push(`(d.title ILIKE $${args.length} OR d.letter_no ILIKE $${args.length})`);
  }
  args.push(Math.min(300, Math.max(1, params.limit ?? 100)));
  const rows = rowsToObjects(
    await db.exec(
      `SELECT ${SELECT_COLS} ${FROM_JOIN}
        ${cond.length ? "WHERE " + cond.join(" AND ") : ""}
        ORDER BY d.created_at DESC
        LIMIT $${args.length}`,
      args
    )
  );
  return rows.map(mapRow);
}

export async function deleteDeliverable(deliverableId: string): Promise<void> {
  await withDbWrite(async (txn) => {
    await txn.run(`DELETE FROM contract_deliverables WHERE deliverable_id = $1 AND status <> 'sent'`, [deliverableId]);
  });
}

// ── 발주처 자체양식(deliverable_templates) ──

function mapTemplate(r: Record<string, unknown>): DeliverableTemplateRow {
  return {
    templateId: s(r.template_id),
    name: s(r.name),
    kind: s(r.kind) === "start" ? "start" : "completion",
    ownerFacilityId: sn(r.owner_facility_id),
    ownerFacilityName: sn(r.owner_facility_name),
    sourceKind: (sn(r.source_kind) as TemplateSourceKind | null) ?? null,
    sourceKey: sn(r.source_key),
    sourcePages: r.source_pages != null ? Number(r.source_pages) : null,
    renderMode: s(r.render_mode) === "overlay" ? "overlay" : "spec",
    profile: parseJson<TemplateProfile | null>(r.profile, null),
    specs: parseJson<DeliverableSpec[]>(r.spec, []),
    analyzedAt: sn(r.analyzed_at),
    analyzeModel: sn(r.analyze_model),
    analyzeNote: sn(r.analyze_note),
    createdAt: s(r.created_at),
    updatedAt: s(r.updated_at),
  };
}

const TEMPLATE_SELECT = `t.*, cp.company_name AS owner_facility_name
   FROM deliverable_templates t
   LEFT JOIN facilities cp ON cp.facility_id = t.owner_facility_id`;

export async function createTemplate(params: {
  name: string;
  kind: DeliverableKind;
  ownerFacilityId?: string | null;
  sourceKind?: TemplateSourceKind | null;
  sourceKey?: string | null;
  sourcePages?: number | null;
  renderMode?: TemplateRenderMode;
  specs?: DeliverableSpec[];
  createdBy?: string | null;
}): Promise<string> {
  const id = newId("dtpl-");
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    await txn.run(
      `INSERT INTO deliverable_templates
         (template_id, name, kind, owner_facility_id, source_kind, source_key, source_pages,
          render_mode, spec, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $11)`,
      [
        id,
        params.name,
        params.kind,
        params.ownerFacilityId ?? null,
        params.sourceKind ?? null,
        params.sourceKey ?? null,
        params.sourcePages ?? null,
        params.renderMode ?? "spec",
        JSON.stringify(params.specs ?? []),
        params.createdBy ?? null,
        now,
      ]
    );
  });
  return id;
}

/** 업로드한 원본 파일 정보 기록 — 키는 template_id 를 알아야 정해지므로 생성 후에 채운다. */
export async function setTemplateSource(
  templateId: string,
  source: { sourceKind: TemplateSourceKind; sourceKey: string; sourcePages?: number | null }
): Promise<void> {
  await withDbWrite(async (txn) => {
    await txn.run(
      `UPDATE deliverable_templates
          SET source_kind = $2, source_key = $3, source_pages = $4, updated_at = $5
        WHERE template_id = $1`,
      [templateId, source.sourceKind, source.sourceKey, source.sourcePages ?? null, new Date().toISOString()]
    );
  });
}

/** overlay 템플릿의 값 자리 매핑 저장(D4) — 분석 결과이자 사용자 보정 결과가 같은 자리에 들어간다. */
export async function saveTemplateProfile(templateId: string, profile: TemplateProfile): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    await txn.run(
      `UPDATE deliverable_templates
          SET profile = $2::jsonb, render_mode = 'overlay',
              analyzed_at = $3, analyze_model = $4, analyze_note = $5, updated_at = $6
        WHERE template_id = $1`,
      [templateId, JSON.stringify(profile), profile.analyzedAt, profile.model, profile.note ?? null, now]
    );
  });
}

export async function saveTemplateSpec(
  templateId: string,
  specs: DeliverableSpec[],
  meta?: { analyzedAt?: string | null; analyzeModel?: string | null; analyzeNote?: string | null }
): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    await txn.run(
      `UPDATE deliverable_templates
          SET spec = $2::jsonb,
              analyzed_at = COALESCE($3, analyzed_at),
              analyze_model = COALESCE($4, analyze_model),
              analyze_note = COALESCE($5, analyze_note),
              updated_at = $6
        WHERE template_id = $1`,
      [templateId, JSON.stringify(specs), meta?.analyzedAt ?? null, meta?.analyzeModel ?? null, meta?.analyzeNote ?? null, now]
    );
  });
}

export async function getTemplate(templateId: string): Promise<DeliverableTemplateRow | null> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT ${TEMPLATE_SELECT} WHERE t.template_id = $1`, [templateId]));
  return rows.length ? mapTemplate(rows[0]) : null;
}

export async function listTemplates(params: { kind?: DeliverableKind | null; ownerFacilityId?: string | null } = {}): Promise<
  DeliverableTemplateRow[]
> {
  const db = await getDb();
  const cond: string[] = [];
  const args: unknown[] = [];
  if (params.kind) {
    args.push(params.kind);
    cond.push(`t.kind = $${args.length}`);
  }
  if (params.ownerFacilityId) {
    args.push(params.ownerFacilityId);
    cond.push(`t.owner_facility_id = $${args.length}`);
  }
  const rows = rowsToObjects(
    await db.exec(
      `SELECT ${TEMPLATE_SELECT} ${cond.length ? "WHERE " + cond.join(" AND ") : ""} ORDER BY t.updated_at DESC LIMIT 200`,
      args
    )
  );
  return rows.map(mapTemplate);
}

export async function deleteTemplate(templateId: string): Promise<void> {
  await withDbWrite(async (txn) => {
    await txn.run(`DELETE FROM deliverable_templates WHERE template_id = $1`, [templateId]);
  });
}
