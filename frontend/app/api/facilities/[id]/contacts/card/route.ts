import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { putEmployeeDocument } from "@/lib/storage/employee-document-storage";
import { sanitizeFilename, sanitizePathSegment } from "@/lib/storage/contract-document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface CardFieldsBody {
  personName?: string | null;
  title?: string | null;
  departmentName?: string | null; // 부서명 텍스트 — 동명 부서 있으면 연결, 없으면 신규
  deptType?: string | null; // contract | env
  mobilePhone?: string | null;
  officePhone?: string | null;
  email?: string | null;
  duties?: string | null;
}

const nullableText = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
};

// 명함 확정 저장 — 원본 이미지 S3(card_storage_*) + facility_contact_people upsert.
// 매칭: facility_id + 이름 + (휴대폰 일치 또는 기존 휴대폰 없음) → 갱신, 아니면 신규.
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("contact.edit", { fallbackRoles: ["editor"] });
    const { id: facilityId } = await ctx.params;
    const form = await req.formData();
    const file = form.get("file");
    const fieldsRaw = form.get("fields");
    if (typeof fieldsRaw !== "string") {
      return NextResponse.json({ error: "fields(JSON)가 필요합니다." }, { status: 400 });
    }
    const body = JSON.parse(fieldsRaw) as CardFieldsBody;
    const parsedRaw = form.get("parsed"); // 파싱 원본(수정 전) — card_parsed_json 에 보존
    const personName = nullableText(body.personName);
    if (!personName) {
      return NextResponse.json({ error: "이름은 필수입니다." }, { status: 400 });
    }

    const db = await getDb();
    const fac = rowsToObjects(
      await db.exec(`SELECT facility_id FROM facilities WHERE facility_id = $1 AND deleted_at IS NULL`, [facilityId])
    );
    if (!fac.length) return NextResponse.json({ error: "사업장을 찾을 수 없습니다." }, { status: 404 });

    // 원본 이미지 저장(선택) — 파일 없이 필드만 저장도 허용
    let stored: { storageProvider: string; storageBucket: string | null; storageKey: string; publicPath: string } | null = null;
    if (file instanceof File && file.size > 0) {
      if (!/^image\//.test(file.type)) {
        return NextResponse.json({ error: "이미지 파일만 지원합니다." }, { status: 400 });
      }
      const ext = path.extname(file.name || "").slice(0, 8) || ".jpg";
      const safeName = sanitizeFilename(`${sanitizePathSegment(personName)}${ext}`);
      const storageKey = ["business-cards", sanitizePathSegment(facilityId), `${Date.now()}-${safeName}`].join("/");
      stored = await putEmployeeDocument(storageKey, Buffer.from(await file.arrayBuffer()), file.type || "image/jpeg");
    }

    const title = nullableText(body.title);
    const departmentName = nullableText(body.departmentName);
    const deptType = nullableText(body.deptType);
    const mobilePhone = nullableText(body.mobilePhone);
    const officePhone = nullableText(body.officePhone);
    const email = nullableText(body.email);
    const duties = nullableText(body.duties);
    const now = new Date().toISOString();

    let personId = 0;
    let mode: "updated" | "created" = "created";
    await withDbWrite(async (wdb) => {
      // 부서: 동명 부서 연결, 없고 부서명이 있으면 신규
      let departmentId: number | null = null;
      if (departmentName) {
        const dep = rowsToObjects(
          await wdb.exec(
            `SELECT id FROM facility_contact_departments WHERE facility_id = $1 AND department_name = $2 LIMIT 1`,
            [facilityId, departmentName]
          )
        );
        if (dep.length) {
          departmentId = Number(dep[0].id);
        } else {
          const ins = rowsToObjects(
            await wdb.exec(
              `INSERT INTO facility_contact_departments (facility_id, department_name, created_at, updated_at)
               VALUES ($1, $2, $3, $3) RETURNING id`,
              [facilityId, departmentName, now]
            )
          );
          departmentId = Number(ins[0]?.id ?? 0) || null;
        }
      }

      // 기존 담당자 매칭 — 이름 일치 + (휴대폰 일치 or 기존 휴대폰 없음 or 입력 휴대폰 없음)
      const existing = rowsToObjects(
        await wdb.exec(
          `SELECT id, mobile_phone FROM facility_contact_people
            WHERE facility_id = $1 AND person_name = $2 AND status <> 'inactive'
            ORDER BY id ASC`,
          [facilityId, personName]
        )
      );
      const match = existing.find((p) => {
        const existingMobile = p.mobile_phone != null ? String(p.mobile_phone).replace(/[^0-9]/g, "") : "";
        const inputMobile = (mobilePhone ?? "").replace(/[^0-9]/g, "");
        return !existingMobile || !inputMobile || existingMobile === inputMobile;
      });

      const cardCols = {
        provider: stored?.storageProvider ?? null,
        bucket: stored?.storageBucket ?? null,
        key: stored?.storageKey ?? null,
        publicPath: stored?.publicPath ?? null,
        parsedJson: typeof parsedRaw === "string" && parsedRaw ? parsedRaw : null,
      };

      if (match) {
        mode = "updated";
        personId = Number(match.id);
        // 명함 값이 있는 필드만 갱신(COALESCE 역방향 — 새 값 우선, 없으면 기존 유지)
        await wdb.run(
          `UPDATE facility_contact_people SET
             title = COALESCE($2, title), department_id = COALESCE($3, department_id),
             mobile_phone = COALESCE($4, mobile_phone), office_phone = COALESCE($5, office_phone),
             email = COALESCE($6, email), duties = COALESCE($7, duties), dept_type = COALESCE($8, dept_type),
             card_storage_provider = COALESCE($9, card_storage_provider),
             card_storage_bucket = COALESCE($10, card_storage_bucket),
             card_storage_key = COALESCE($11, card_storage_key),
             card_public_path = COALESCE($12, card_public_path),
             card_parsed_json = COALESCE($13::jsonb, card_parsed_json),
             card_captured_at = $14, updated_at = $14
           WHERE id = $1`,
          [
            personId, title, departmentId, mobilePhone, officePhone, email, duties, deptType,
            cardCols.provider, cardCols.bucket, cardCols.key, cardCols.publicPath, cardCols.parsedJson, now,
          ]
        );
      } else {
        const ins = rowsToObjects(
          await wdb.exec(
            `INSERT INTO facility_contact_people
               (facility_id, department_id, person_name, title, office_phone, mobile_phone, email,
                duties, status, dept_type, card_storage_provider, card_storage_bucket, card_storage_key,
                card_public_path, card_parsed_json, card_captured_at, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,$10,$11,$12,$13,$14::jsonb,$15,$15,$15)
             RETURNING id`,
            [
              facilityId, departmentId, personName, title, officePhone, mobilePhone, email, duties, deptType,
              cardCols.provider, cardCols.bucket, cardCols.key, cardCols.publicPath, cardCols.parsedJson, now,
            ]
          )
        );
        personId = Number(ins[0]?.id ?? 0);
      }

      await recordAuditLogInline(wdb, {
        actorUserId: actor.userId,
        action: "facility_contact_update",
        targetTable: "facility_contact_people",
        targetId: String(personId),
        before: match ? { matchedId: personId } : null,
        after: { source: "business-card", personName, title, mobilePhone, officePhone, email, cardKey: cardCols.key },
      });
    });

    return NextResponse.json({ ok: true, personId, mode });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
