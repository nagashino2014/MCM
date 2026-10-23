import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { fontUsage, listCatalogFonts, listFontSetRows, registerUploads, resolveCustomFontSets } from "@/lib/catalog/font-library";
import type { FontClass } from "@/lib/catalog/font-types";
import { FONT_SETS } from "@/lib/catalog/fonts";
import { readFontFiles } from "./upload-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 한글 가변 서체 변환은 converter 에서 수십 초 걸린다
export const maxDuration = 300;

const CLASSES = new Set(["sans", "serif", "decorative"]);

// GET: 서체 라이브러리 — 서체(기본 + 업로드, 비활성 포함)·사용자 세트(판정 포함)·기본 세트·쓰는 곳
export async function GET() {
  try {
    await requirePermission("catalog.manage");
    const [fonts, sets, resolved, usage] = await Promise.all([listCatalogFonts(), listFontSetRows(), resolveCustomFontSets(), fontUsage()]);
    return NextResponse.json({
      fonts,
      sets: sets.map((x) => {
        const r = resolved.find((d) => d.id === x.setId);
        return { ...x, available: r?.available ?? false, issues: r?.issues ?? [], warnings: r?.warnings ?? [] };
      }),
      presets: FONT_SETS.map((f) => ({ id: f.id, label: f.label, desc: f.desc, roles: f.roles, available: f.available, note: f.note ?? null })),
      usage,
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST: 서체 등록(multipart files[], licenseType, licenseSource, licenseScope[], licenseNote, licenseConfirmed=1, classification?, displayName?, instanceWeight?)
//   화면은 파일 하나씩(가변 서체는 instanceWeight 로 굵기 하나씩) 보낸다 — 한 요청이 converter 변환 한 번
//   다시 분석 → 포함 제한이면 거부 → converter 로 TrueType 윤곽 WOFF → 원본·변환본 저장 → catalog_fonts 기록
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const form = await req.formData();
    const files = await readFontFiles(form);
    const cls = String(form.get("classification") ?? "");
    const out = await registerUploads(
      files,
      {
        license: {
          type: String(form.get("licenseType") ?? ""),
          source: String(form.get("licenseSource") ?? ""),
          scope: form.getAll("licenseScope").map(String),
          note: String(form.get("licenseNote") ?? ""),
          confirmed: String(form.get("licenseConfirmed") ?? "") === "1",
        },
        classification: CLASSES.has(cls) ? (cls as FontClass) : null,
        displayName: String(form.get("displayName") ?? "") || null,
        instanceWeight: Number(form.get("instanceWeight")) || null,
      },
      actor.userId
    );
    for (const f of out.fonts) {
      await recordAuditLog({
        actorUserId: actor.userId,
        action: "catalog_update",
        targetTable: "catalog_fonts",
        targetId: f.fontId,
        after: { upload: files.map((x) => x.name), weights: f.weights, created: f.created, licenseType: String(form.get("licenseType") ?? "") },
      });
    }
    return NextResponse.json(out);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
