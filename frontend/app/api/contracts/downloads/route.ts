import JSZip from "jszip";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import {
  binaryResponse,
  loadBundles,
  mergeFiles,
  readStorageObject,
  sanitizeDownloadName,
  type DownloadScope,
} from "@/lib/contracts/document-bundle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DownloadMode = "singleRaw" | "individualZip" | "mergedSingle" | "perContractMergedZip" | "mergedAll";

interface DownloadRequestBody {
  contractIds?: string[];
  mode?: DownloadMode;
  scope?: DownloadScope;
}

export async function POST(req: NextRequest) {
  try {
    await requireAuthenticated();
    const body = (await req.json()) as DownloadRequestBody;
    const contractIds = [...new Set((body.contractIds ?? []).map((id) => String(id).trim()).filter(Boolean))];
    const mode = body.mode ?? "individualZip";
    const scope = body.scope ?? { kind: "all" };

    if (contractIds.length === 0) {
      return NextResponse.json({ error: "다운로드할 계약을 선택하세요." }, { status: 400 });
    }
    if (mode === "mergedSingle" && contractIds.length !== 1) {
      return NextResponse.json({ error: "단일 병합은 계약 1건만 선택할 수 있습니다." }, { status: 400 });
    }
    if (contractIds.length > 100) {
      return NextResponse.json({ error: "한 번에 최대 100건까지 다운로드할 수 있습니다." }, { status: 400 });
    }

    const bundles = await loadBundles(contractIds, scope);
    const files = bundles.flatMap((bundle) => bundle.files);
    if (files.length === 0) {
      return NextResponse.json({ error: "다운로드할 PDF 파일이 없습니다." }, { status: 404 });
    }

    // 단일 파일이면 폴더/zip 없이 원본 PDF를 그대로 내려준다(태그 클릭 등 단건 다운로드).
    if (mode === "singleRaw") {
      if (files.length === 1) {
        const only = files[0];
        const bytes = await readStorageObject(only.storageKey);
        return binaryResponse(bytes, "application/pdf", only.displayName);
      }
      // 복수 파일이면 폴더 없이 평면 zip으로 묶는다.
      const flat = new JSZip();
      for (const bundle of bundles) {
        for (const file of bundle.files) {
          flat.file(sanitizeDownloadName(file.displayName), await readStorageObject(file.storageKey));
        }
      }
      const zipped = await flat.generateAsync({ type: "uint8array" });
      return binaryResponse(zipped, "application/zip", `계약증빙_${new Date().toISOString().slice(0, 10)}.zip`);
    }

    if (mode === "mergedSingle" || mode === "mergedAll") {
      const merged = await mergeFiles(bundles);
      const fileName = mode === "mergedSingle"
        ? `${bundles[0].contractTitle}_증빙자료.pdf`
        : `선택계약_증빙자료.pdf`;
      return binaryResponse(merged, "application/pdf", fileName);
    }

    const zip = new JSZip();
    if (mode === "perContractMergedZip") {
      for (const bundle of bundles) {
        if (bundle.files.length === 0) continue;
        const merged = await mergeFiles([bundle]);
        zip.file(`${sanitizeDownloadName(bundle.contractTitle)}_증빙자료.pdf`, merged);
      }
    } else {
      for (const bundle of bundles) {
        const folder = zip.folder(sanitizeDownloadName(bundle.contractTitle));
        for (const file of bundle.files) {
          folder?.file(sanitizeDownloadName(file.displayName), await readStorageObject(file.storageKey));
        }
      }
    }

    const zipped = await zip.generateAsync({ type: "uint8array" });
    return binaryResponse(zipped, "application/zip", `계약증빙_${new Date().toISOString().slice(0, 10)}.zip`);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
