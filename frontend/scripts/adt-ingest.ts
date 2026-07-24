// ADT 근태 인제스트 배치 엔트리. 스테이징(adt_attendance_raw) → 일별/주별 정규화·초과근무 산정.
// next 이미지의 node_modules(pg 등)를 쓰고, 소스는 esbuild 단일 번들(.next/adt-ingest.cjs).
//
// 실행 모드(ADT_INGEST_MODE):
//   db(기본)  : 컨트롤러 "근태결과 DB 전송"이 스테이징에 직접 INSERT → 이 배치가 주기적으로 정규화. (클라우드 EventBridge→ECS)
//   file      : 컨트롤러 "근태결과 파일생성"의 txt 를 읽어 스테이징에 upsert 후 정규화.
//               ▸ S3 경유(권장): 사내 PC 가 `aws s3 sync` 로 올린 txt 를 이 클라우드 배치가 S3 에서 읽음.
//                 env ADT_FILE_S3_BUCKET(필수), ADT_FILE_S3_PREFIX(예 incoming/). 사내→AWS 는 아웃바운드 HTTPS 만.
//               ▸ 로컬 디렉토리(사내 러너 직접): ADT_FILE_DIR. UNC 공유는 클라우드 Fargate 에서 접근 불가.
//   both      : db + file.
// 파일 공통 env: ADT_FILE_DELIMITER(tab|space|comma|<문자>, 기본 tab), ADT_FILE_HAS_HEADER(true 면 첫 줄 스킵).
// 공통 env: ADT_INGEST_BATCH_LIMIT(1회 처리 스테이징 행 수, 기본 5000). DB(PG*)·AWS_REGION 은 next task def env 재사용.
import { runAdtIngest } from "@/lib/adt/ingest";

function resolveDelimiter(raw: string | undefined): string | undefined {
  if (raw == null || raw === "") return undefined;
  if (raw === "tab") return "\t";
  if (raw === "space") return " ";
  if (raw === "comma") return ",";
  return raw;
}

async function main() {
  const mode = ((process.env.ADT_INGEST_MODE ?? "db").trim().toLowerCase() as "db" | "file" | "both");
  const dir = process.env.ADT_FILE_DIR;
  const s3Bucket = process.env.ADT_FILE_S3_BUCKET?.trim();
  const s3Prefix = process.env.ADT_FILE_S3_PREFIX?.trim() || undefined;
  const delimiter = resolveDelimiter(process.env.ADT_FILE_DELIMITER);
  const hasHeader = process.env.ADT_FILE_HAS_HEADER === "true";
  const batchLimit = Number(process.env.ADT_INGEST_BATCH_LIMIT) > 0 ? Number(process.env.ADT_INGEST_BATCH_LIMIT) : undefined;

  const started = Date.now();
  console.log(`[adt-ingest] start mode=${mode}${s3Bucket ? ` s3=${s3Bucket}/${s3Prefix ?? ""}` : ""}${dir ? ` dir=${dir}` : ""}`);

  const res = await runAdtIngest({
    mode,
    s3: s3Bucket ? { bucket: s3Bucket, prefix: s3Prefix, delimiter, hasHeader } : undefined,
    file: dir ? { dir, delimiter, hasHeader } : undefined,
    batchLimit,
  });

  console.log(
    `[adt-ingest] done in ${Math.round((Date.now() - started) / 1000)}s`,
    JSON.stringify(res)
  );
  if (res.collectErrors?.length) {
    console.error(`[adt-ingest] collect errors (${res.collectErrors.length})`, JSON.stringify(res.collectErrors.slice(0, 20)));
  }
  if (res.unmatched > 0) {
    console.warn(`[adt-ingest] unmatched rows=${res.unmatched} — employee_profiles.adt_emp_no 매핑 필요`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[adt-ingest] error", err);
  process.exit(1);
});
