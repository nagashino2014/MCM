import { MAX_FONT_FILE_BYTES } from "@/lib/catalog/font-types";
import type { UploadFile } from "@/lib/catalog/font-library";

const MAX_FILES = 18;

/** 서체 업로드 폼(multipart files[]) → 파일 목록. 20MB 넘는 파일은 읽지 않고 크기만 넘겨 분석이 거부 사유를 단다 */
export async function readFontFiles(form: FormData): Promise<UploadFile[]> {
  const list = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!list.length) throw Object.assign(new Error("서체 파일을 고르세요."), { status: 400 });
  if (list.length > MAX_FILES) throw Object.assign(new Error(`한 번에 ${MAX_FILES}개 파일까지 올릴 수 있습니다.`), { status: 400 });
  const out: UploadFile[] = [];
  for (const f of list) {
    const name = (f.name || "font").slice(0, 200);
    out.push(f.size > MAX_FONT_FILE_BYTES ? { name, bytes: new Uint8Array(0), size: f.size } : { name, bytes: new Uint8Array(await f.arrayBuffer()), size: f.size });
  }
  return out;
}
