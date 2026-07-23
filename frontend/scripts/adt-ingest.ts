// ADT 근태 인제스트 배치 엔트리. 스테이징(adt_attendance_raw) → 일별/주별 정규화·초과근무 산정.
// next 이미지의 node_modules(pg 등)를 쓰고, 소스는 esbuild 단일 번들(.next/adt-ingest.cjs).
//
// 실행 모드(ADT_INGEST_MODE):
//   db(기본)  : 컨트롤러 "근태결과 DB 전송"이 스테이징에 직접 INSERT → 이 배치가 주기적으로 정규화. (클라우드 EventBridge→ECS)
//   file      : 컨트롤러 "근태결과 파일생성"의 txt 를 읽어 스테이징에 upsert 후 정규화.
//               ※ 사내 네트워크 공유(UNC)는 클라우드 Fargate 에서 접근 불가 — file 모드는 사내 러너에서 실행할 것.
//   both      : 둘 다.
// 파일 모드 env: ADT_FILE_DIR(필수), ADT_FILE_DELIMITER(tab|space|comma|<문자>, 기본 tab), ADT_FILE_HAS_HEADER(true 면 첫 줄 스킵).
// 공통 env: ADT_INGEST_BATCH_LIMIT(1회 처리 스테이징 행 수, 기본 5000). DB(PG*) 설정은 next task def env 재사용.
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
  const delimiter = resolveDelimiter(process.env.ADT_FILE_DELIMITER);
  const hasHeader = process.env.ADT_FILE_HAS_HEADER === "true";
  const batchLimit = Number(process.env.ADT_INGEST_BATCH_LIMIT) > 0 ? Number(process.env.ADT_INGEST_BATCH_LIMIT) : undefined;

  const started = Date.now();
  console.log(`[adt-ingest] start mode=${mode}${dir ? ` dir=${dir}` : ""}`);

  const res = await runAdtIngest({
    mode,
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
