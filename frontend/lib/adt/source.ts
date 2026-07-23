/**
 * ADT 근태 수신 계층 추상화(서버 전용).
 * 두 구현이 모두 스테이징 adt_attendance_raw 로 수렴시킨다:
 *   · DbStagingSource : 컨트롤러 "근태결과 DB 전송"이 이미 직접 INSERT → collect 는 no-op.
 *   · FileSource      : 컨트롤러 "근태결과 파일생성"의 txt(ovrwrk_YYYYMMDD.txt)를 파싱해 스테이징에 upsert.
 * 이후 정규화·산정은 lib/adt/ingest.ts 가 공통으로 수행한다.
 */

import { PgDatabase } from "@/lib/db";
import type { AdtRawRecord, AttendanceSourceKind } from "./types";

export interface CollectResult {
  ingested: number;
  files?: number;
  errors?: string[];
}

export interface AttendanceSource {
  readonly kind: AttendanceSourceKind;
  /** 원본을 스테이징(adt_attendance_raw)에 수렴시킨다. */
  collect(db: PgDatabase): Promise<CollectResult>;
}

/** 스테이징 무손실 upsert. 파일 경로가 재전송하는 최신값을 반영하고 재처리를 허용(processed=false). */
export async function upsertRawRecords(
  db: PgDatabase,
  records: AdtRawRecord[],
  source: AttendanceSourceKind
): Promise<number> {
  let n = 0;
  for (const r of records) {
    if (!r.e_idno || !/^\d{8}$/.test(String(r.d_date ?? "").replace(/\D/g, ""))) continue;
    await db.run(
      `INSERT INTO adt_attendance_raw
         (fpid, c_dept, c_pos, e_group, e_idno, e_name, d_date, n_date,
          in_time, out_time, leave_time, return_time, late_time, early_time,
          over_time, night_time, total_time, allow_time, source, ingested_at, processed)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19, now(), false)
       ON CONFLICT (e_idno, d_date) DO UPDATE SET
          fpid=EXCLUDED.fpid, c_dept=EXCLUDED.c_dept, c_pos=EXCLUDED.c_pos, e_group=EXCLUDED.e_group,
          e_name=EXCLUDED.e_name, n_date=EXCLUDED.n_date, in_time=EXCLUDED.in_time, out_time=EXCLUDED.out_time,
          leave_time=EXCLUDED.leave_time, return_time=EXCLUDED.return_time, late_time=EXCLUDED.late_time,
          early_time=EXCLUDED.early_time, over_time=EXCLUDED.over_time, night_time=EXCLUDED.night_time,
          total_time=EXCLUDED.total_time, allow_time=EXCLUDED.allow_time, source=EXCLUDED.source,
          ingested_at=now(), processed=false`,
      [
        r.fpid ?? null, r.c_dept ?? null, r.c_pos ?? null, r.e_group ?? null,
        String(r.e_idno), r.e_name ?? null, String(r.d_date).replace(/\D/g, ""), r.n_date ?? null,
        r.in_time ?? null, r.out_time ?? null, r.leave_time ?? null, r.return_time ?? null,
        r.late_time ?? null, r.early_time ?? null, r.over_time ?? null, r.night_time ?? null,
        r.total_time ?? null, r.allow_time ?? null, source,
      ]
    );
    n += 1;
  }
  return n;
}

/** DB 직접 전송: 컨트롤러가 스테이징에 이미 INSERT 하므로 별도 수집 없음. */
export class DbStagingSource implements AttendanceSource {
  readonly kind = "db" as const;
  async collect(): Promise<CollectResult> {
    return { ingested: 0 };
  }
}

/** 컨트롤러 txt 파일 생성분을 파싱해 스테이징으로. 구분자·컬럼순서는 벤더 설정에 맞춰 env 로 조정. */
export interface FileSourceOptions {
  dir: string; // 파일 디렉토리(로컬 또는 마운트된 UNC 공유)
  glob?: RegExp; // 대상 파일명(기본 ovrwrk_*.txt)
  delimiter?: string; // 필드 구분자(기본 탭)
  columns?: string[]; // 컬럼 순서(AdtRawRecord 키), 기본 문서 §4-1 순서
  encoding?: BufferEncoding; // 기본 utf-8 (EUC-KR 이면 후속 iconv 필요)
  hasHeader?: boolean; // 첫 줄 헤더 스킵
}

/** 문서 §4-1 기본 컬럼 순서(컨트롤러 "열 선택" 기본 나열 가정). 실측 후 env 로 조정. */
export const DEFAULT_FILE_COLUMNS: string[] = [
  "fpid", "c_dept", "c_pos", "e_group", "e_idno", "e_name", "d_date", "n_date",
  "in_time", "out_time", "leave_time", "return_time", "late_time", "early_time",
  "over_time", "night_time", "total_time", "allow_time",
];

const NUMERIC_KEYS = new Set(["fpid", "e_group"]);

/** 한 줄을 컬럼 순서에 맞춰 AdtRawRecord 로. */
export function parseLine(line: string, delimiter: string, columns: string[]): AdtRawRecord | null {
  const cells = delimiter === "" ? [line] : line.split(delimiter);
  const rec: Record<string, unknown> = {};
  columns.forEach((key, i) => {
    const v = (cells[i] ?? "").trim();
    if (v === "") { rec[key] = null; return; }
    rec[key] = NUMERIC_KEYS.has(key) ? Number(v.replace(/\D/g, "")) : v;
  });
  const r = rec as unknown as AdtRawRecord;
  if (!r.e_idno || !r.d_date) return null;
  return r;
}

export class FileSource implements AttendanceSource {
  readonly kind = "file" as const;
  constructor(private readonly opts: FileSourceOptions) {}

  async collect(db: PgDatabase): Promise<CollectResult> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const glob = this.opts.glob ?? /^ovrwrk_\d{8}\.txt$/i;
    const delimiter = this.opts.delimiter ?? "\t";
    const columns = this.opts.columns ?? DEFAULT_FILE_COLUMNS;
    const encoding = this.opts.encoding ?? "utf-8";
    const errors: string[] = [];
    let ingested = 0;
    let files = 0;

    let entries: string[];
    try {
      entries = await fs.readdir(this.opts.dir);
    } catch (err) {
      return { ingested: 0, files: 0, errors: [`readdir ${this.opts.dir}: ${(err as Error).message}`] };
    }

    for (const name of entries.filter((n) => glob.test(n))) {
      files += 1;
      try {
        const text = await fs.readFile(path.join(this.opts.dir, name), { encoding });
        const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
        const body = this.opts.hasHeader ? lines.slice(1) : lines;
        const records: AdtRawRecord[] = [];
        for (const line of body) {
          const rec = parseLine(line, delimiter, columns);
          if (rec) records.push(rec);
        }
        ingested += await upsertRawRecords(db, records, "file");
      } catch (err) {
        errors.push(`${name}: ${(err as Error).message}`);
      }
    }
    return { ingested, files, errors };
  }
}
