// 계약서 대장(contract_agreements)·양식 템플릿(agreement_templates, 147) DB 접근.
// 문서 원본은 approval_docs.field_values(frm-agreement)이고 대장은 발송·산출물 메타 + 승인 스냅이다.
// 표준 셋은 DB 에 시드하지 않는다 — 세분류별 조회 시 DB 활성 행이 우선하고 없으면
// 코드 시드(catalog.ts)가 폴백된다. 시드 편집 = DB 로 fork(upsertTemplate).
// ⚠ lib/approval/docs.ts 와의 순환 import 금지 — 여기서는 db 만 사용한다(공문·견적 store 관례).

import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import type { TemplateProfile } from "@/lib/deliverable/types";
import { SEED_TEMPLATES, seedForSubtype, seedAsTemplateRow } from "./catalog";
import {
  AGREEMENT_FORM_ID,
  type AgreementFieldValues,
  type AgreementRenderMode,
  type AgreementRow,
  type AgreementSendStatus,
  type AgreementSpec,
  type AgreementTemplateRow,
} from "./types";

function newId(prefix: string): string {
  return prefix + crypto.randomUUID().replace(/-/g, "").slice(0, 14);
}

const sn = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number | null => (v == null ? null : Number(v));

function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

// ── 템플릿 ──

function mapTemplate(r: Record<string, unknown>): AgreementTemplateRow {
  return {
    templateId: String(r.template_id ?? ""),
    name: String(r.name ?? ""),
    kind: String(r.kind) === "custom" ? "custom" : "standard",
    serviceType: sn(r.service_type),
    serviceSubtype: sn(r.service_subtype),
    version: Number(r.version ?? 1),
    status: (["active", "draft", "archived"].includes(String(r.status)) ? String(r.status) : "active") as AgreementTemplateRow["status"],
    originFacilityId: sn(r.origin_facility_id),
    originFacilityName: sn(r.origin_facility_name),
    spec: parseJson<AgreementSpec>(r.spec, { coverBlocks: [], terms: { orderer: "발주자", contractor: "과업수행자" } }),
    renderMode: String(r.render_mode) === "overlay" ? "overlay" : "spec",
    profile: parseJson<TemplateProfile | null>(r.profile, null),
    sourceKind: sn(r.source_kind),
    sourceKey: sn(r.source_key),
    analyzedAt: sn(r.analyzed_at),
    analyzeNote: sn(r.analyze_note),
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  };
}

const TPL_SELECT = `t.*, f.company_name AS origin_facility_name
   FROM agreement_templates t
   LEFT JOIN facilities f ON f.facility_id = t.origin_facility_id`;

export async function listTemplates(params?: { kind?: string | null }): Promise<AgreementTemplateRow[]> {
  const db = await getDb();
  const where = params?.kind ? `WHERE t.kind = $1 AND t.status <> 'archived'` : `WHERE t.status <> 'archived'`;
  const rows = rowsToObjects(
    await db.exec(
      `SELECT ${TPL_SELECT} ${where} ORDER BY t.service_type, t.service_subtype, t.version DESC, t.updated_at DESC`,
      params?.kind ? [params.kind] : []
    )
  );
  return rows.map(mapTemplate);
}

export async function getTemplate(templateId: string): Promise<AgreementTemplateRow | null> {
  // 코드 시드 가상 id — DB 조회 없이 시드를 그대로 돌려준다
  if (templateId.startsWith("agt-std-")) {
    const seed = SEED_TEMPLATES.find((t) => t.templateId === templateId);
    return seed ? seedAsTemplateRow(seed, seed.serviceSubtypes[0]) : null;
  }
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT ${TPL_SELECT} WHERE t.template_id = $1`, [templateId]));
  return rows.length ? mapTemplate(rows[0]) : null;
}

/** 세분류의 활성 템플릿 — DB(최신 버전) 우선, 없으면 코드 시드 폴백, 그것도 없으면 null(미지정) */
export async function resolveTemplateForSubtype(
  serviceType: string,
  serviceSubtype: string
): Promise<AgreementTemplateRow | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT ${TPL_SELECT}
        WHERE t.kind = 'standard' AND t.status = 'active' AND t.service_type = $1 AND t.service_subtype = $2
        ORDER BY t.version DESC LIMIT 1`,
      [serviceType, serviceSubtype]
    )
  );
  if (rows.length) return mapTemplate(rows[0]);
  const seed = seedForSubtype(serviceType, serviceSubtype);
  return seed ? seedAsTemplateRow(seed, serviceSubtype) : null;
}

/** 발주처의 자체양식(custom) 목록 — 작성 화면 추천용 */
export async function listCustomTemplatesForFacility(facilityId: string): Promise<AgreementTemplateRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT ${TPL_SELECT}
        WHERE t.kind = 'custom' AND t.status = 'active' AND t.origin_facility_id = $1
        ORDER BY t.updated_at DESC`,
      [facilityId]
    )
  );
  return rows.map(mapTemplate);
}

export async function upsertTemplate(params: {
  templateId?: string | null; // null = 신규
  name: string;
  kind: "standard" | "custom";
  serviceType?: string | null;
  serviceSubtype?: string | null;
  status?: string;
  originFacilityId?: string | null;
  spec: AgreementSpec;
  renderMode?: AgreementRenderMode;
  profile?: TemplateProfile | null;
  sourceKind?: string | null;
  sourceKey?: string | null;
  createdBy?: string | null;
}): Promise<string> {
  const id = params.templateId && !params.templateId.startsWith("agt-std-") ? params.templateId : newId("agt-");
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    await txn.run(
      `INSERT INTO agreement_templates
         (template_id, name, kind, service_type, service_subtype, version, status, origin_facility_id,
          spec, render_mode, profile, source_kind, source_key, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5,
               COALESCE((SELECT MAX(version) + 1 FROM agreement_templates
                          WHERE service_type = $4 AND service_subtype = $5 AND template_id <> $1), 1),
               $6, $7, $8::jsonb, $13, $14::jsonb, $9, $10, $11, $12, $12)
       ON CONFLICT (template_id) DO UPDATE SET
         name = EXCLUDED.name,
         status = EXCLUDED.status,
         origin_facility_id = EXCLUDED.origin_facility_id,
         spec = EXCLUDED.spec,
         render_mode = EXCLUDED.render_mode,
         profile = EXCLUDED.profile,
         source_kind = COALESCE(EXCLUDED.source_kind, agreement_templates.source_kind),
         source_key = COALESCE(EXCLUDED.source_key, agreement_templates.source_key),
         updated_at = EXCLUDED.updated_at`,
      [
        id,
        params.name,
        params.kind,
        params.serviceType ?? null,
        params.serviceSubtype ?? null,
        params.status ?? "active",
        params.originFacilityId ?? null,
        JSON.stringify(params.spec),
        params.sourceKind ?? null,
        params.sourceKey ?? null,
        params.createdBy ?? null,
        now,
        params.renderMode ?? "spec",
        JSON.stringify(params.profile ?? {}),
      ]
    );
    // 같은 세분류의 다른 활성 표준 셋은 보관 처리(세분류당 활성 1개)
    if (params.kind === "standard" && params.serviceType && params.serviceSubtype && (params.status ?? "active") === "active") {
      await txn.run(
        `UPDATE agreement_templates SET status = 'archived', updated_at = $4
          WHERE kind = 'standard' AND service_type = $1 AND service_subtype = $2
            AND template_id <> $3 AND status = 'active'`,
        [params.serviceType, params.serviceSubtype, id, now]
      );
    }
  });
  return id;
}

// ── 대장 ──

function mapAgreement(r: Record<string, unknown>): AgreementRow {
  return {
    agreementId: String(r.agreement_id ?? ""),
    docId: String(r.doc_id ?? ""),
    templateId: sn(r.template_id),
    templateName: sn(r.template_name),
    contractId: sn(r.contract_id),
    quotationId: sn(r.quotation_id),
    counterpartyFacilityId: sn(r.counterparty_facility_id),
    title: String(r.title ?? ""),
    serviceType: sn(r.service_type),
    serviceSubtype: sn(r.service_subtype),
    amountSupply: num(r.amount_supply),
    amountVat: num(r.amount_vat),
    amountTotal: num(r.amount_total),
    drafterName: sn(r.drafter_name),
    fieldSnapshot: parseJson<AgreementFieldValues | null>(r.field_snapshot, null),
    pdfKey: sn(r.pdf_key),
    hwpxKey: sn(r.hwpx_key),
    generatedAt: sn(r.generated_at),
    sendStatus: (["draft", "approved", "sending", "sent", "failed"].includes(String(r.send_status))
      ? String(r.send_status)
      : "draft") as AgreementSendStatus,
    sendError: sn(r.send_error),
    sendAttempts: Number(r.send_attempts ?? 0),
    sentAt: sn(r.sent_at),
    sentTo: parseJson<unknown>(r.sent_to, null),
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  };
}

const AGR_SELECT = `a.*, t.name AS template_name
   FROM contract_agreements a
   LEFT JOIN agreement_templates t ON t.template_id = a.template_id`;

/**
 * 최종 승인 시 대장 등록(actOnDoc 트랜잭션 내 — 가벼운 upsert 만).
 * 계약서 양식 문서가 아니면 no-op. 승인 후에도 자동 발송하지 않는다(수동 발송 — ① 확정).
 * 이미 발송 완료(sent)면 상태를 되돌리지 않는다(재승인 케이스).
 */
export async function markAgreementApproved(txn: PgDatabase, docId: string): Promise<void> {
  const rows = rowsToObjects(
    await txn.exec(
      `SELECT d.title, d.drafter_name, d.field_values FROM approval_docs d
        WHERE d.doc_id = $1 AND d.form_id = $2`,
      [docId, AGREEMENT_FORM_ID]
    )
  );
  if (!rows.length) return;
  const r = rows[0];
  const values = parseJson<Partial<AgreementFieldValues>>(r.field_values, {});
  const supply = Math.max(0, Math.floor(Number(values.amountSupply) || 0));
  const vat = Math.floor(supply * 0.1);
  const now = new Date().toISOString();
  const templateId =
    values.templateId && !String(values.templateId).startsWith("agt-std-") ? String(values.templateId) : null;
  await txn.run(
    `INSERT INTO contract_agreements
       (agreement_id, doc_id, template_id, contract_id, quotation_id, counterparty_facility_id,
        title, service_type, service_subtype, amount_supply, amount_vat, amount_total,
        drafter_name, field_snapshot, send_status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, 'approved', $15, $15)
     ON CONFLICT (doc_id) DO UPDATE SET
       template_id = EXCLUDED.template_id,
       contract_id = EXCLUDED.contract_id,
       quotation_id = EXCLUDED.quotation_id,
       counterparty_facility_id = EXCLUDED.counterparty_facility_id,
       title = EXCLUDED.title,
       service_type = EXCLUDED.service_type,
       service_subtype = EXCLUDED.service_subtype,
       amount_supply = EXCLUDED.amount_supply,
       amount_vat = EXCLUDED.amount_vat,
       amount_total = EXCLUDED.amount_total,
       field_snapshot = EXCLUDED.field_snapshot,
       send_status = CASE WHEN contract_agreements.send_status = 'sent' THEN 'sent' ELSE 'approved' END,
       updated_at = EXCLUDED.updated_at`,
    [
      newId("agr-"),
      docId,
      templateId,
      values.contractId ?? null,
      values.quotationId ?? null,
      values.orderer?.facilityId ?? null,
      String(r.title ?? values.title ?? ""),
      values.serviceType ?? null,
      values.serviceSubtype ?? null,
      supply,
      vat,
      supply + vat,
      r.drafter_name != null ? String(r.drafter_name) : null,
      JSON.stringify(values),
      now,
    ]
  );
}

/** 발송 선점 — approved|failed → sending. 0행이면 이미 진행 중(중복 실행 가드). */
export async function claimAgreementSend(docId: string): Promise<AgreementRow | null> {
  let claimed: AgreementRow | null = null;
  await withDbWrite(async (txn) => {
    const rows = rowsToObjects(
      await txn.exec(
        `UPDATE contract_agreements SET send_status = 'sending', send_attempts = send_attempts + 1,
                send_error = NULL, updated_at = $2
          WHERE doc_id = $1 AND send_status IN ('approved', 'failed')
          RETURNING agreement_id`,
        [docId, new Date().toISOString()]
      )
    );
    if (!rows.length) return;
    const full = rowsToObjects(await txn.exec(`SELECT ${AGR_SELECT} WHERE a.doc_id = $1`, [docId]));
    claimed = full.length ? mapAgreement(full[0]) : null;
  });
  return claimed;
}

export async function setAgreementArtifacts(docId: string, pdfKey: string | null, hwpxKey: string | null): Promise<void> {
  await withDbWrite(async (txn) => {
    await txn.run(
      `UPDATE contract_agreements SET pdf_key = COALESCE($2, pdf_key), hwpx_key = COALESCE($3, hwpx_key),
              generated_at = $4, updated_at = $4
        WHERE doc_id = $1`,
      [docId, pdfKey, hwpxKey, new Date().toISOString()]
    );
  });
}

export async function finishAgreementSend(
  docId: string,
  result: { ok: true; sentTo: unknown; messageId?: string | null } | { ok: false; error: string }
): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    if (result.ok) {
      await txn.run(
        `UPDATE contract_agreements SET send_status = 'sent', sent_at = $2, sent_to = $3::jsonb,
                sent_message_id = $4, send_error = NULL, updated_at = $2
          WHERE doc_id = $1`,
        [docId, now, JSON.stringify(result.sentTo ?? null), result.messageId ?? null]
      );
    } else {
      await txn.run(
        `UPDATE contract_agreements SET send_status = 'failed', send_error = $2, updated_at = $3
          WHERE doc_id = $1`,
        [docId, result.error.slice(0, 2000), now]
      );
    }
  });
}

/** 대장 행 삭제 — 계약서 삭제(문서와 함께) 시. S3 산출물은 보존한다(감사 추적). */
export async function deleteAgreement(docId: string): Promise<void> {
  await withDbWrite(async (txn) => {
    await txn.run(`DELETE FROM contract_agreements WHERE doc_id = $1`, [docId]);
  });
}

export async function getAgreementByDocId(docId: string): Promise<AgreementRow | null> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT ${AGR_SELECT} WHERE a.doc_id = $1`, [docId]));
  return rows.length ? mapAgreement(rows[0]) : null;
}

/** 보드 목록 — frm-agreement 결재 문서(작성중·진행·승인·반려) + 대장 발송 상태 join */
export interface AgreementDocRow {
  docId: string;
  docNo: string | null;
  title: string;
  docStatus: string; // draft | in_progress | approved | rejected
  drafterName: string | null;
  drafterUserId: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  completedAt: string | null; // 최종 승인(또는 반려) 시각
  serviceType: string | null;
  serviceSubtype: string | null;
  ordererName: string | null;
  amountSupply: number | null;
  templateName: string | null;
  sendStatus: AgreementSendStatus | null; // 승인 전엔 null
  sendError: string | null;
  sentAt: string | null;
  pdfKey: string | null;
  hwpxKey: string | null;
}

export async function listAgreementDocs(params: { q?: string | null; limit?: number }): Promise<AgreementDocRow[]> {
  const db = await getDb();
  const args: unknown[] = [AGREEMENT_FORM_ID];
  // ⚠ approval_docs 에는 deleted_at 컬럼이 없다(084 스키마) — 참조하면 SQL 에러로 목록이 통째 비어버린다.
  let where = `d.form_id = $1`;
  if (params.q) {
    args.push(`%${params.q}%`);
    where += ` AND (d.title ILIKE $${args.length} OR d.field_values->'orderer'->>'name' ILIKE $${args.length})`;
  }
  args.push(Math.min(Math.max(Number(params.limit) || 200, 1), 500));
  const rows = rowsToObjects(
    await db.exec(
      `SELECT d.doc_id, d.doc_no, d.title, d.status AS doc_status, d.drafter_name, d.drafter_user_id,
              d.created_at, d.updated_at, d.submitted_at, d.completed_at,
              d.field_values->>'serviceType' AS service_type,
              d.field_values->>'serviceSubtype' AS service_subtype,
              d.field_values->'orderer'->>'name' AS orderer_name,
              (d.field_values->>'amountSupply')::bigint AS amount_supply,
              t.name AS template_name,
              a.send_status, a.send_error, a.sent_at, a.pdf_key, a.hwpx_key
         FROM approval_docs d
         LEFT JOIN contract_agreements a ON a.doc_id = d.doc_id
         LEFT JOIN agreement_templates t ON t.template_id = a.template_id
        WHERE ${where}
        ORDER BY d.updated_at DESC
        LIMIT $${args.length}`,
      args
    )
  );
  return rows.map((r) => ({
    docId: String(r.doc_id ?? ""),
    docNo: sn(r.doc_no),
    title: String(r.title ?? ""),
    docStatus: String(r.doc_status ?? "draft"),
    drafterName: sn(r.drafter_name),
    drafterUserId: sn(r.drafter_user_id),
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
    submittedAt: sn(r.submitted_at),
    completedAt: sn(r.completed_at),
    serviceType: sn(r.service_type),
    serviceSubtype: sn(r.service_subtype),
    ordererName: sn(r.orderer_name),
    amountSupply: num(r.amount_supply),
    templateName: sn(r.template_name),
    sendStatus: r.send_status != null ? (String(r.send_status) as AgreementSendStatus) : null,
    sendError: sn(r.send_error),
    sentAt: sn(r.sent_at),
    pdfKey: sn(r.pdf_key),
    hwpxKey: sn(r.hwpx_key),
  }));
}

export async function listAgreements(params: {
  q?: string | null;
  status?: string | null;
  limit?: number;
}): Promise<AgreementRow[]> {
  const db = await getDb();
  const cond: string[] = [];
  const args: unknown[] = [];
  if (params.q) {
    args.push(`%${params.q}%`);
    cond.push(`(a.title ILIKE $${args.length} OR t.name ILIKE $${args.length})`);
  }
  if (params.status) {
    args.push(params.status);
    cond.push(`a.send_status = $${args.length}`);
  }
  args.push(Math.min(Math.max(Number(params.limit) || 200, 1), 500));
  const rows = rowsToObjects(
    await db.exec(
      `SELECT ${AGR_SELECT} ${cond.length ? `WHERE ${cond.join(" AND ")}` : ""}
        ORDER BY a.created_at DESC LIMIT $${args.length}`,
      args
    )
  );
  return rows.map(mapAgreement);
}
