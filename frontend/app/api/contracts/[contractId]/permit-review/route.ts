import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import {
  putContractDocument,
  sanitizeFilename,
  sanitizePathSegment,
} from "@/lib/storage/contract-document-storage";
import { parsePermitReviewWithLlm, type PermitReviewFields } from "@/lib/contracts/permit-review-llm";
import { cleanProductName } from "@/lib/ieps/formatters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // LLM 파싱(최대 2분) 포함

const MAX_BYTES = 30 * 1024 * 1024;

interface RouteContext {
  params: Promise<{ contractId: string }>;
}

/**
 * 허가 검토결과서 업로드(2026-08-24) — 계약 상세 > 허가 정보의 '검토결과서 업로드'.
 * ① PDF 를 S3(계약 문서함, document_type='permit_review')에 저장하고
 * ② Claude 로 파싱해 허가번호·허가일자·대기/수질 종규모·배출량·주요 생산품을 추출한 뒤
 * ③ 계약 허가 정보(permit_issued_at/permit_no)와 대상사업장의 허가 정보
 *    (permits/permit_scales/product_outputs)에 자동 기입한다.
 * 파싱 실패 시에도 문서 저장은 유지된다(응답 parsed=null — 수동 입력 안내).
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const { contractId } = await ctx.params;
    const actor = await requirePermission("contract.edit", { fallbackRoles: ["editor"], target: { contractId } });

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "파일이 필요합니다." }, { status: 400 });
    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: "PDF 파일만 업로드할 수 있습니다." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "파일이 30MB 를 초과합니다." }, { status: 400 });
    }

    const db = await getDb();
    const contractRows = rowsToObjects(
      await db.exec(
        `SELECT contract_title, contract_date FROM contracts WHERE contract_id = $1 AND deleted_at IS NULL`,
        [contractId]
      )
    );
    if (!contractRows.length) return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });
    const contractTitle = String(contractRows[0].contract_title ?? "계약");
    const contractDate = String(contractRows[0].contract_date ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10);

    // 대상사업장 — 검토결과서의 허가 정보가 기입될 사업장(통상 1개, 첫 연결 사용).
    const facilityRows = rowsToObjects(
      await db.exec(`SELECT facility_id FROM contract_facilities WHERE contract_id = $1 LIMIT 1`, [contractId])
    );
    const facilityId = facilityRows.length ? String(facilityRows[0].facility_id) : null;

    const buf = Buffer.from(await file.arrayBuffer());
    const sha256 = crypto.createHash("sha256").update(buf).digest("hex");

    // 저장 키 — 계약 문서함 폴더 규약을 따른다: contracts/documents/{YYYY}/(계약일) {계약명}/…
    const year = contractDate.slice(0, 4);
    const folderName = sanitizePathSegment(`(${contractDate}) ${contractTitle}`);
    const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const fileName = sanitizeFilename(`(${today})${contractTitle} 검토결과서.pdf`);
    const storageKey = `contracts/documents/${year}/${folderName}/${fileName}`;

    // 같은 파일 재업로드는 저장·문서행 생성을 건너뛰고 파싱만 다시 한다(재파싱 용도).
    const dupRows = rowsToObjects(
      await db.exec(
        `SELECT document_id FROM contract_documents
          WHERE contract_id = $1 AND document_type = 'permit_review' AND sha256 = $2 LIMIT 1`,
        [contractId, sha256]
      )
    );
    let documentId = dupRows.length ? String(dupRows[0].document_id) : null;

    if (!documentId) {
      const stored = await putContractDocument(storageKey, buf, "application/pdf");
      documentId = "cdoc_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      const now = new Date().toISOString();
      await withDbWrite(async (wdb) => {
        await wdb.run(
          `INSERT INTO contract_documents
             (document_id, contract_id, document_type, display_name, original_filename, content_type,
              byte_size, sha256, storage_provider, storage_bucket, storage_key, public_path, source,
              created_by, created_at, updated_at)
           VALUES ($1, $2, 'permit_review', $3, $4, $5, $6, $7, $8, $9, $10, $11, 'manual_upload', $12, $13, $13)`,
          [
            documentId,
            contractId,
            fileName,
            file.name,
            "application/pdf",
            buf.length,
            sha256,
            stored.storageProvider,
            stored.storageBucket,
            stored.storageKey,
            stored.publicPath,
            actor.userId,
            now,
          ]
        );
        await recordAuditLogInline(wdb, {
          actorUserId: actor.userId,
          action: "contract_document_upload",
          targetTable: "contract_documents",
          targetId: documentId!,
          after: { contractId, documentType: "permit_review", fileName },
        });
      });
    }

    // ── Claude 파싱 → 계약·사업장 허가 정보 자동 기입 ──
    const parsed = await parsePermitReviewWithLlm(buf);
    let facilityApplied = false;
    let skippedReason: string | null = null;

    if (parsed && (parsed.permitNo || parsed.permitDate)) {
      await withDbWrite(async (wdb) => {
        // 계약 허가 정보 — 파싱된 값만 덮어쓴다(빈 값으로 기존 값을 지우지 않는다).
        const sets: string[] = [];
        const params: unknown[] = [contractId];
        if (parsed.permitDate) {
          params.push(parsed.permitDate);
          sets.push(`permit_issued_at = $${params.length}`);
        }
        if (parsed.permitNo) {
          params.push(parsed.permitNo);
          sets.push(`permit_no = $${params.length}`);
        }
        if (sets.length) {
          await wdb.run(`UPDATE contracts SET ${sets.join(", ")}, updated_at = $${params.length + 1} WHERE contract_id = $1`, [
            ...params,
            new Date().toISOString(),
          ]);
        }

        // 사업장 허가 정보 — 결정번호가 있어야 중복(재업로드) 판별이 가능하므로 그때만 기입.
        if (facilityId && parsed.permitNo) {
          facilityApplied = await upsertFacilityPermit(wdb, facilityId, parsed);
        } else if (!facilityId) {
          skippedReason = "no-facility";
        } else {
          skippedReason = "no-permit-no";
        }

        await recordAuditLogInline(wdb, {
          actorUserId: actor.userId,
          action: "contract_update",
          targetTable: "contracts",
          targetId: contractId,
          after: { permitReviewParsed: { permitNo: parsed.permitNo, permitDate: parsed.permitDate, facilityApplied } },
        });
      });
    } else if (!parsed) {
      skippedReason = "parse-failed";
    }

    return NextResponse.json({
      ok: true,
      documentId,
      parsed,
      facilityApplied,
      ...(skippedReason ? { skippedReason } : {}),
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

const numOrNull = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * 사업장 허가 upsert — 결정번호(전역 유니크)가 같은 허가가 있으면 그 행을 갱신하고,
 * 없으면 새 허가를 만든다. 종규모·생산품은 통째 교체(재업로드 시 중복 누적 방지).
 * facilities API 의 수동 입력 경로(app/api/facilities/[id]/permits)와 같은 테이블 규약.
 */
async function upsertFacilityPermit(
  wdb: PgDatabase,
  facilityId: string,
  parsed: PermitReviewFields
): Promise<boolean> {
  const now = new Date().toISOString();
  const existing = rowsToObjects(
    await wdb.exec(`SELECT permit_id, facility_id FROM permits WHERE decision_no = $1 LIMIT 1`, [parsed.permitNo])
  );

  let permitId: string;
  if (existing.length) {
    permitId = String(existing[0].permit_id);
    await wdb.run(
      `UPDATE permits SET permit_date = COALESCE(NULLIF($2, ''), permit_date), updated_at = $3 WHERE permit_id = $1`,
      [permitId, parsed.permitDate, now]
    );
  } else {
    permitId = "permit_review_" + crypto.randomUUID();
    await wdb.run(
      `INSERT INTO permits
         (permit_id, facility_id, decision_no, permit_type, permit_date, is_first_permit, created_at, updated_at)
       VALUES ($1, $2, $3, 'review_doc', $4, 0, $5, $5)`,
      [permitId, facilityId, parsed.permitNo, parsed.permitDate || null, now]
    );
  }

  const airClass = numOrNull(parsed.airClass);
  const airAmount = numOrNull(parsed.airAmount);
  const waterClass = numOrNull(parsed.waterClass);
  const waterAmount = numOrNull(parsed.waterAmount);
  if (airClass != null || airAmount != null || waterClass != null || waterAmount != null) {
    await wdb.run(`DELETE FROM permit_scales WHERE permit_id = $1`, [permitId]);
    await wdb.run(
      `INSERT INTO permit_scales
         (permit_id, air_class, air_amount_ton_per_year, water_class, wastewater_amount_m3_per_day, source_page, source_text)
       VALUES ($1, $2, $3, $4, $5, NULL, 'permit_review_doc')`,
      [permitId, airClass, airAmount, waterClass, waterAmount]
    );
  }

  if (parsed.products.length) {
    await wdb.run(`DELETE FROM product_outputs WHERE permit_id = $1`, [permitId]);
    for (const product of parsed.products) {
      const name = cleanProductName(product.name);
      if (!name) continue;
      await wdb.run(
        `INSERT INTO product_outputs
           (permit_id, product_name, production_amount, production_unit, source_page, source_text)
         VALUES ($1, $2, $3, $4, NULL, 'permit_review_doc')`,
        [permitId, name, numOrNull(product.amount), product.unit.trim() || null]
      );
    }
  }

  // 연간보고서 스냅샷 무효화 — 수동 허가 입력 경로와 동일(최신 허가 기준 재계산 유도).
  await wdb.run(`DELETE FROM facility_annual_reports WHERE facility_id = $1`, [facilityId]);
  return true;
}
