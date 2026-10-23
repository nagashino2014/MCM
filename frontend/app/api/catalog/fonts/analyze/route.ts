import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { analyzeUploads } from "@/lib/catalog/font-library";
import type { FontClass } from "@/lib/catalog/font-types";
import { readFontFiles } from "../upload-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLASSES = new Set(["sans", "serif", "decorative"]);

// POST: 서체 미리 분석(multipart files[], classification?) — 저장하지 않는다. 패밀리·굵기·포함 허용(fsType)·글자 범위·용도 판정·크기 보정
export async function POST(req: NextRequest) {
  try {
    await requirePermission("catalog.manage");
    const form = await req.formData();
    const files = await readFontFiles(form);
    const cls = String(form.get("classification") ?? "");
    return NextResponse.json(await analyzeUploads(files, CLASSES.has(cls) ? (cls as FontClass) : null));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
