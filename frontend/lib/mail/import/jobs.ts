/**
 * 메일 가져오기(I-1) — 작업(job) 생성·조회·취소와 틱 처리.
 * 파일 방식: 브라우저가 presigned PUT 으로 S3 에 올린 .zip/.eml 을 틱마다 조금씩(40초 예산) 처리한다.
 * 진행 위치(cursor = 파일 순번·항목 순번)와 집계를 항목마다 저장 → Next 가 밤에 정지돼도 다음 틱에 이어서 처리.
 * 동시에 처리하는 작업은 전체 1건(running 임대). 설계: docs/mail-import-blueprint.md §2, §4.
 */
import crypto from "node:crypto";
import { open, stat } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { getS3Client } from "@/lib/storage/logo-storage";
import { sanitizeFilename, sanitizePathSegment } from "@/lib/storage/contract-document-storage";
import { ensureMailbox, getMailboxAddresses, getSystemFolderId } from "@/lib/mail/mailbox";
import { readZipDirectory, readZipEntry, ZipFormatError, type RangeSource, type ZipEntry } from "@/lib/mail/import/zip-reader";
import { importRawMessage, ImportItemError, type ImportTarget } from "@/lib/mail/import/store";

export const IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024; // 업로드 파일당 2GB
export const IMPORT_MAX_MESSAGE_BYTES = 100 * 1024 * 1024; // 한 통 100MB(아마란스 수신 최대 크기)
const PUT_EXPIRES_SEC = 60 * 60;
// 틱 1회 시간 예산 40초. MAIL_IMPORT_TICK_BUDGET_MS 는 중단·이어서 처리 검증용(운영에서는 설정하지 않음).
const TICK_BUDGET_MS = Number(process.env.MAIL_IMPORT_TICK_BUDGET_MS) > 0 ? Number(process.env.MAIL_IMPORT_TICK_BUDGET_MS) : 40 * 1000;
const LEASE_STALE_MS = 3 * 60 * 1000; // running 이 3분 넘게 갱신 없으면 죽은 틱으로 보고 이어받는다
const MAX_CONSECUTIVE_ERRORS = 5;
const FAILURE_KEEP = 100;

export type FolderKind = "inbox" | "sent" | "custom";

export interface ImportUpload {
  key: string;
  name: string;
  size: number;
  folderKind: FolderKind;
  folderName: string;
}

export interface ImportJob {
  jobId: string;
  kind: string;
  sourceLabel: string;
  status: string;
  uploads: ImportUpload[];
  options: { inboxPlacement?: boolean };
  totalCount: number | null;
  importedCount: number;
  duplicateCount: number;
  failedCount: number;
  linkAttachmentCount: number;
  bytesImported: number;
  lastError: string | null;
  failures: { file: string; entry: string; reason: string }[];
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

interface Cursor {
  file?: number;
  entry?: number;
  errors?: number;
}

function bucketOrThrow(): string {
  const bucket = process.env.MCM_STORAGE_BUCKET?.trim();
  if (!bucket || process.env.CONTRACT_DOCUMENT_STORAGE_ROOT?.trim()) {
    throw Object.assign(new Error("메일 가져오기는 S3 스토리지에서만 사용할 수 있습니다."), { status: 500 });
  }
  return bucket;
}

function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

function toJob(r: Record<string, unknown>): ImportJob {
  return {
    jobId: String(r.job_id),
    kind: String(r.kind),
    sourceLabel: String(r.source_label),
    status: String(r.status),
    uploads: parseJson<ImportUpload[]>(r.uploads, []),
    options: parseJson<{ inboxPlacement?: boolean }>(r.options, {}),
    totalCount: r.total_count != null ? Number(r.total_count) : null,
    importedCount: Number(r.imported_count ?? 0),
    duplicateCount: Number(r.duplicate_count ?? 0),
    failedCount: Number(r.failed_count ?? 0),
    linkAttachmentCount: Number(r.link_attachment_count ?? 0),
    bytesImported: Number(r.bytes_imported ?? 0),
    lastError: r.last_error != null ? String(r.last_error) : null,
    failures: parseJson<{ file: string; entry: string; reason: string }[]>(r.failures, []),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    finishedAt: r.finished_at != null ? String(r.finished_at) : null,
  };
}

/** S3 객체 범위 읽기 원본. */
function s3Source(bucket: string, key: string): RangeSource {
  let cached: number | null = null;
  return {
    size: async () => {
      if (cached == null) {
        const head = await getS3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        cached = Number(head.ContentLength ?? 0);
      }
      return cached;
    },
    read: async (start, length) => {
      if (length <= 0) return Buffer.alloc(0);
      const out = await getS3Client().send(
        new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=${start}-${start + length - 1}` })
      );
      const bytes = await out.Body?.transformToByteArray();
      return Buffer.from(bytes ?? new Uint8Array());
    },
  };
}

/** 로컬 파일 범위 읽기 원본 — CONTRACT_DOCUMENT_STORAGE_ROOT(로컬 문서 저장) 모드용. */
function localSource(root: string, key: string): RangeSource {
  const base = path.resolve(root);
  const target = path.resolve(base, key);
  if (!target.startsWith(base + path.sep)) throw new Error("업로드 경로가 올바르지 않습니다.");
  return {
    size: async () => (await stat(target)).size,
    read: async (start, length) => {
      if (length <= 0) return Buffer.alloc(0);
      const fh = await open(target, "r");
      try {
        const buf = Buffer.alloc(length);
        await fh.read(buf, 0, length, start);
        return buf;
      } finally {
        await fh.close();
      }
    },
  };
}

/** 업로드 파일 원본 — 문서 저장소와 같은 규칙(로컬 루트가 있으면 로컬, 아니면 S3). */
function storageSource(key: string): RangeSource {
  const localRoot = process.env.CONTRACT_DOCUMENT_STORAGE_ROOT?.trim();
  if (localRoot) return localSource(localRoot, key);
  const bucket = process.env.MCM_STORAGE_BUCKET?.trim();
  if (!bucket) throw new Error("CONTRACT_DOCUMENT_STORAGE_ROOT 또는 MCM_STORAGE_BUCKET 환경변수가 필요합니다.");
  return s3Source(bucket, key);
}

function isZip(name: string): boolean {
  return /\.zip$/i.test(name);
}

function isEml(name: string): boolean {
  return /\.eml$/i.test(name);
}

/** ZIP 항목 중 가져올 대상(.eml, 폴더 아님)만. */
function emlEntries(entries: ZipEntry[]): ZipEntry[] {
  return entries.filter((e) => !e.name.endsWith("/") && isEml(e.name));
}

/** 업로드 발급 — 본인 접두어 아래 presigned PUT. */
export async function createImportUpload(
  userId: string,
  input: { fileName: string; byteSize: number }
): Promise<{ key: string; url: string }> {
  const name = sanitizeFilename(input.fileName || "mail.zip");
  if (!isZip(name) && !isEml(name)) {
    throw Object.assign(new Error("ZIP 또는 EML 파일만 올릴 수 있습니다."), { status: 400 });
  }
  if (!(input.byteSize > 0) || input.byteSize > IMPORT_MAX_FILE_BYTES) {
    throw Object.assign(new Error("파일당 2GB 까지 올릴 수 있습니다."), { status: 413 });
  }
  const bucket = bucketOrThrow();
  const key = ["mail-import-uploads", sanitizePathSegment(userId), crypto.randomBytes(8).toString("hex"), name].join("/");
  const url = await getSignedUrl(
    getS3Client(),
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: isZip(name) ? "application/zip" : "message/rfc822" }),
    { expiresIn: PUT_EXPIRES_SEC }
  );
  return { key, url };
}

/** 파일 가져오기 작업 생성 — 업로드 확인·항목 수 집계 후 pending 으로 등록. */
export async function createFileImportJob(
  userId: string,
  input: { sourceLabel: string; inboxPlacement: boolean; uploads: { key: string; name: string; folderKind: FolderKind; folderName: string }[] }
): Promise<ImportJob> {
  const sourceLabel = String(input.sourceLabel ?? "").trim().slice(0, 40);
  if (!sourceLabel) throw Object.assign(new Error("원본 이름을 입력하세요."), { status: 400 });
  if (!input.uploads?.length) throw Object.assign(new Error("가져올 파일이 없습니다."), { status: 400 });
  const prefix = ["mail-import-uploads", sanitizePathSegment(userId), ""].join("/");
  const mailbox = await ensureMailbox(userId);

  const uploads: ImportUpload[] = [];
  let total = 0;
  for (const u of input.uploads) {
    const key = String(u.key ?? "");
    if (!key.startsWith(prefix) || key.includes("..")) throw Object.assign(new Error("업로드 정보가 올바르지 않습니다."), { status: 400 });
    const src = storageSource(key);
    let size = 0;
    try {
      size = await src.size();
    } catch {
      throw Object.assign(new Error(`'${u.name}' 업로드가 끝나지 않았습니다. 다시 시도해 주세요.`), { status: 400 });
    }
    if (size > IMPORT_MAX_FILE_BYTES) throw Object.assign(new Error(`'${u.name}' — 파일당 2GB 까지 올릴 수 있습니다.`), { status: 413 });
    const kind: FolderKind = u.folderKind === "sent" || u.folderKind === "custom" ? u.folderKind : "inbox";
    const folderName = String(u.folderName ?? "").trim().slice(0, 60) || (kind === "sent" ? "보낸메일함" : kind === "inbox" ? "받은메일함" : "기타");
    if (isZip(key)) {
      try {
        total += emlEntries(await readZipDirectory(src)).length;
      } catch (err) {
        const msg = err instanceof ZipFormatError ? err.message : "ZIP 을 읽지 못했습니다.";
        throw Object.assign(new Error(`'${u.name}' — ${msg}`), { status: 400 });
      }
    } else {
      total += 1;
    }
    uploads.push({ key, name: String(u.name ?? key.split("/").pop()), size, folderKind: kind, folderName });
  }

  const jobId = "mij-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14);
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO mail_import_jobs (job_id, mailbox_id, user_id, kind, source_label, status, options, uploads, total_count, created_at, updated_at)
       VALUES ($1,$2,$3,'file',$4,'pending',$5::jsonb,$6::jsonb,$7,$8,$8)`,
      [jobId, mailbox.mailboxId, userId, sourceLabel, JSON.stringify({ inboxPlacement: !!input.inboxPlacement }), JSON.stringify(uploads), total, now]
    );
  });
  const job = await getImportJob(userId, jobId);
  if (!job) throw new Error("작업을 만들지 못했습니다.");
  return job;
}

export async function listImportJobs(userId: string): Promise<ImportJob[]> {
  const db = await getDb();
  return rowsToObjects(
    await db.exec(`SELECT * FROM mail_import_jobs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [userId])
  ).map(toJob);
}

export async function getImportJob(userId: string, jobId: string): Promise<ImportJob | null> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT * FROM mail_import_jobs WHERE job_id = $1 AND user_id = $2`, [jobId, userId]));
  return rows.length ? toJob(rows[0]) : null;
}

/** 취소 — 진행 중이면 다음 항목 처리 전에 멈춘다. 이미 가져온 메일은 남는다. */
export async function cancelImportJob(userId: string, jobId: string): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run(
      `UPDATE mail_import_jobs SET status = 'cancelled', updated_at = $3, finished_at = $3, imap_secret_enc = NULL
        WHERE job_id = $1 AND user_id = $2 AND status IN ('pending', 'running', 'paused')`,
      [jobId, userId, now]
    );
  });
}

/** 받은 메일을 넣을 사용자 폴더 "가져온 메일(원본)" — 없으면 만든다. */
async function importFolderId(mailboxId: string, sourceLabel: string): Promise<string> {
  const name = `가져온 메일(${sourceLabel})`;
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO mail_folders (folder_id, mailbox_id, name, system_kind, sort, created_at)
       VALUES ($1,$2,$3,NULL,100,$4)
       ON CONFLICT (mailbox_id, name) WHERE system_kind IS NULL DO NOTHING`,
      ["mfd-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14), mailboxId, name, new Date().toISOString()]
    );
  });
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT folder_id FROM mail_folders WHERE mailbox_id = $1 AND name = $2 AND system_kind IS NULL LIMIT 1`, [mailboxId, name])
  );
  if (!rows.length) throw new Error("가져온 메일 폴더를 만들지 못했습니다.");
  return String(rows[0].folder_id);
}

/** 한 틱에 처리할 작업 1건을 임대한다(전체 동시 1건). */
async function claimJob(): Promise<Record<string, unknown> | null> {
  const now = new Date();
  const stale = new Date(now.getTime() - LEASE_STALE_MS).toISOString();
  let claimed: Record<string, unknown> | null = null;
  await withDbWrite(async (db) => {
    const busy = rowsToObjects(
      await db.exec(`SELECT 1 FROM mail_import_jobs WHERE status = 'running' AND updated_at >= $1 LIMIT 1`, [stale])
    );
    if (busy.length) return;
    const rows = rowsToObjects(
      await db.exec(
        `UPDATE mail_import_jobs SET status = 'running', updated_at = $2
          WHERE job_id = (
            SELECT job_id FROM mail_import_jobs
             WHERE kind = 'file' AND (status IN ('pending', 'paused') OR (status = 'running' AND updated_at < $1))
             ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
          RETURNING *`,
        [stale, now.toISOString()]
      )
    );
    claimed = rows.length ? rows[0] : null;
  });
  return claimed;
}

export interface ImportTickResult {
  jobId?: string;
  processed: number;
  status?: string;
  skipped?: string;
}

/**
 * 틱 1회 — 작업 1건을 40초 안에서 처리한다. 항목마다 cursor·집계를 저장해 정지 후 이어서 처리.
 * 항목 오류(손상·크기 초과)는 실패로 세고 넘어가고, 저장소·DB 오류는 작업을 paused 로 두고 다음 틱에 재시도(연속 5회면 failed).
 */
export async function processImportTick(): Promise<ImportTickResult> {
  if (!process.env.MCM_STORAGE_BUCKET?.trim() && !process.env.CONTRACT_DOCUMENT_STORAGE_ROOT?.trim()) {
    return { processed: 0, skipped: "no-storage" };
  }
  const row = await claimJob();
  if (!row) return { processed: 0 };
  const job = toJob(row);
  const mailboxId = String(row.mailbox_id);
  const cursor = parseJson<Cursor>(row.cursor, {});
  const started = Date.now();
  let processed = 0;

  const counts = {
    imported: job.importedCount,
    duplicate: job.duplicateCount,
    failed: job.failedCount,
    link: job.linkAttachmentCount,
    bytes: job.bytesImported,
  };
  const failures = [...job.failures];
  let fileIdx = cursor.file ?? 0;
  let entryIdx = cursor.entry ?? 0;

  const save = async (status: string, extra: { lastError?: string | null; errors?: number; finished?: boolean } = {}) => {
    const now = new Date().toISOString();
    await withDbWrite(async (db) => {
      await db.run(
        `UPDATE mail_import_jobs
            SET status = CASE WHEN status = 'cancelled' THEN 'cancelled' ELSE $2 END,
                cursor = $3::jsonb, imported_count = $4, duplicate_count = $5, failed_count = $6,
                link_attachment_count = $7, bytes_imported = $8, failures = $9::jsonb,
                last_error = COALESCE($10, last_error), updated_at = $11,
                finished_at = CASE WHEN $12 THEN $11 ELSE finished_at END
          WHERE job_id = $1`,
        [
          job.jobId,
          status,
          JSON.stringify({ file: fileIdx, entry: entryIdx, errors: extra.errors ?? 0 }),
          counts.imported,
          counts.duplicate,
          counts.failed,
          counts.link,
          counts.bytes,
          JSON.stringify(failures.slice(-FAILURE_KEEP)),
          extra.lastError ?? null,
          now,
          !!extra.finished,
        ]
      );
    });
  };

  const isCancelled = async (): Promise<boolean> => {
    const db = await getDb();
    const r = rowsToObjects(await db.exec(`SELECT status FROM mail_import_jobs WHERE job_id = $1`, [job.jobId]));
    return !r.length || String(r[0].status) === "cancelled";
  };

  try {
    const myAddrs = new Set((await getMailboxAddresses(mailboxId)).map((a) => a.address));
    const importFolder = await importFolderId(mailboxId, job.sourceLabel);
    const inboxFolder = await getSystemFolderId(mailboxId, "inbox");
    const sentFolder = await getSystemFolderId(mailboxId, "sent");

    while (fileIdx < job.uploads.length) {
      const u = job.uploads[fileIdx];
      const src = storageSource(u.key);
      // 항목 목록: ZIP 은 중앙 디렉터리의 .eml, EML 파일은 그 자체 1개.
      const items: { name: string; entry: ZipEntry | null }[] = isZip(u.key)
        ? emlEntries(await readZipDirectory(src)).map((e) => ({ name: e.name, entry: e }))
        : [{ name: u.name, entry: null }];

      while (entryIdx < items.length) {
        if (Date.now() - started > TICK_BUDGET_MS) {
          await save("paused");
          return { jobId: job.jobId, processed, status: "paused" };
        }
        if (processed > 0 && processed % 20 === 0 && (await isCancelled())) {
          return { jobId: job.jobId, processed, status: "cancelled" };
        }
        const it = items[entryIdx];
        try {
          let raw: Buffer;
          if (it.entry) {
            raw = await readZipEntry(src, it.entry, IMPORT_MAX_MESSAGE_BYTES);
          } else {
            const size = await src.size();
            if (size > IMPORT_MAX_MESSAGE_BYTES) throw new ImportItemError(`크기 초과(${Math.round(size / 1048576)}MB)`);
            raw = await src.read(0, size);
          }
          const target = buildTarget(u, job, { mailboxId, importFolder, inboxFolder, sentFolder, myAddrs }, raw);
          const r = await importRawMessage(raw, target);
          if (r.outcome === "imported") counts.imported += 1;
          else counts.duplicate += 1;
          counts.bytes += r.bytes;
          if (r.linkAttachment) counts.link += 1;
        } catch (err) {
          if (err instanceof ImportItemError || err instanceof ZipFormatError) {
            counts.failed += 1;
            failures.push({ file: u.name, entry: it.name.split("/").pop() ?? it.name, reason: err.message });
          } else {
            throw err; // 저장소·DB 오류 → 작업 일시 중지
          }
        }
        entryIdx += 1;
        processed += 1;
        await save("running");
      }
      fileIdx += 1;
      entryIdx = 0;
    }

    // 끝 — 집계 일치 검사.
    const total = job.totalCount ?? 0;
    const sum = counts.imported + counts.duplicate + counts.failed;
    if (sum !== total) {
      await save("failed", { lastError: `집계 불일치: 원본 ${total}건 ≠ 가져옴 ${counts.imported} + 중복 ${counts.duplicate} + 실패 ${counts.failed}`, finished: true });
      return { jobId: job.jobId, processed, status: "failed" };
    }
    await save("done", { finished: true });
    return { jobId: job.jobId, processed, status: "done" };
  } catch (err) {
    const errors = (cursor.errors ?? 0) + 1;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mail-import] tick error", job.jobId, message);
    if (errors >= MAX_CONSECUTIVE_ERRORS) {
      await save("failed", { lastError: `연속 ${errors}회 오류로 중단: ${message}`, errors, finished: true });
      return { jobId: job.jobId, processed, status: "failed" };
    }
    await save("paused", { lastError: message, errors });
    return { jobId: job.jobId, processed, status: "paused" };
  }
}

/** 원본 메일함 정보로 방향·폴더·라벨을 정한다(원본 정보 우선, 사용자 메일함만 보낸 사람으로 보조 판별). */
function buildTarget(
  u: ImportUpload,
  job: ImportJob,
  ctx: { mailboxId: string; importFolder: string; inboxFolder: string; sentFolder: string; myAddrs: Set<string> },
  raw: Buffer
): ImportTarget {
  const labels = [`import:${job.sourceLabel}/${u.folderName}`];
  if (u.folderKind === "sent") {
    return { mailboxId: ctx.mailboxId, folderId: ctx.sentFolder, direction: "out", isRead: true, labels };
  }
  if (u.folderKind === "custom") {
    // 사용자 메일함에는 보낸 메일이 섞일 수 있다 — 원문 From 헤더가 내 주소면 보낸 메일로 본다.
    const head = raw.subarray(0, Math.min(raw.length, 64 * 1024)).toString("latin1");
    const m = head.match(/^From:[^\r\n]*(?:\r?\n[ \t][^\r\n]*)*/im);
    const addr = m ? (m[0].match(/[\w.+-]+@[\w.-]+/) ?? [""])[0].toLowerCase() : "";
    // myAddrs = 메일함 주소 원장 전체(.app·.com) — 원 계정이 아마란스면 .com 주소가 여기에 있다.
    const mine = !!addr && ctx.myAddrs.has(addr);
    return {
      mailboxId: ctx.mailboxId,
      folderId: mine ? ctx.sentFolder : ctx.importFolder,
      direction: mine ? "out" : "in",
      isRead: true,
      labels,
    };
  }
  return {
    mailboxId: ctx.mailboxId,
    folderId: job.options.inboxPlacement ? ctx.inboxFolder : ctx.importFolder,
    direction: "in",
    isRead: true,
    labels,
  };
}
