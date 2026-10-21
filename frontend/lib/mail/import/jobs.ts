/**
 * 메일 가져오기 — 작업(job) 생성·조회·취소와 틱 처리.
 * - 파일(I-1·I-2): 브라우저가 presigned PUT 으로 S3 에 올린 .zip/.eml/.mbox 를 틱마다 조금씩(40초 예산) 처리.
 * - IMAP(I-3): imap.ts 가 폴더·UID 순으로 처리. 비밀번호는 처리 기간에만 암호화 보관(완료·실패·취소·7일 경과 시 삭제, D-1).
 * 진행 위치(cursor)와 집계를 항목마다 저장 → Next 가 밤에 정지돼도 다음 틱에 이어서 처리. 동시 처리는 전체 1건(running 임대).
 * 집계 규칙: 원본 항목 수 = 가져옴 + 중복 + 실패 + 제외. 설계: docs/mail-import-blueprint.md §2·§4·§5.
 */
import crypto from "node:crypto";
import { open, stat } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { getS3Client } from "@/lib/storage/logo-storage";
import { sanitizeFilename, sanitizePathSegment } from "@/lib/storage/contract-document-storage";
import { decryptSecret, encryptSecret } from "@/lib/scraper/secret-crypto";
import { ensureMailbox, getMailboxAddresses, getSystemFolderId } from "@/lib/mail/mailbox";
import { readZipDirectory, readZipEntry, ZipFormatError, type RangeSource, type ZipEntry } from "@/lib/mail/import/zip-reader";
import { gmailLabels, MboxFormatError, readMboxMessage } from "@/lib/mail/import/mbox-reader";
import { importRawMessage, ImportItemError, type ImportTarget } from "@/lib/mail/import/store";
import { countImapPending, IMAP_PRESETS, listImapFolders, processImapJob, type ImapConfig, type ImapFolderInfo } from "@/lib/mail/import/imap";
import type { ImportCounts, ImportFolders, JobRunner } from "@/lib/mail/import/runner";

export const IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024; // 업로드 파일당 2GB
export const IMPORT_MAX_MESSAGE_BYTES = 100 * 1024 * 1024; // 한 통 100MB(아마란스 수신 최대 크기)
const PUT_EXPIRES_SEC = 60 * 60;
// 틱 1회 시간 예산 40초. MAIL_IMPORT_TICK_BUDGET_MS 는 중단·이어서 처리 검증용(운영에서는 설정하지 않음).
const TICK_BUDGET_MS = Number(process.env.MAIL_IMPORT_TICK_BUDGET_MS) > 0 ? Number(process.env.MAIL_IMPORT_TICK_BUDGET_MS) : 40 * 1000;
const LEASE_STALE_MS = 3 * 60 * 1000; // running 이 3분 넘게 갱신 없으면 죽은 틱으로 보고 이어받는다
const MAX_CONSECUTIVE_ERRORS = 5;
const FAILURE_KEEP = 100;
const SECRET_TTL_MS = 7 * 24 * 60 * 60 * 1000; // IMAP 비밀번호 최대 보관 7일(D-1)

export type FolderKind = "inbox" | "sent" | "custom";

export interface ImportUpload {
  key: string;
  name: string;
  size: number;
  folderKind: FolderKind;
  folderName: string;
}

export interface ImportOptions {
  inboxPlacement?: boolean;
  /** IMAP: 가져올 폴더(sent = 보낸 메일 폴더). */
  folders?: { path: string; name: string; sent: boolean }[];
  /** IMAP: 이 날짜 이후 메일만(YYYY-MM-DD). */
  since?: string | null;
}

export interface ImportJob {
  jobId: string;
  kind: string;
  sourceLabel: string;
  status: string;
  uploads: ImportUpload[];
  options: ImportOptions;
  imapUser: string | null;
  totalCount: number | null;
  importedCount: number;
  duplicateCount: number;
  failedCount: number;
  excludedCount: number;
  linkAttachmentCount: number;
  bytesImported: number;
  /** 0~1 진행률(원본 항목 수를 모르는 .mbox 는 파일 위치 기준). */
  progress: number | null;
  lastError: string | null;
  failures: { file: string; entry: string; reason: string }[];
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
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

function isZip(name: string): boolean {
  return /\.zip$/i.test(name);
}
function isEml(name: string): boolean {
  return /\.eml$/i.test(name);
}
function isMbox(name: string): boolean {
  return /\.mbox$/i.test(name);
}

function toJob(r: Record<string, unknown>): ImportJob {
  const uploads = parseJson<ImportUpload[]>(r.uploads, []);
  const cursor = parseJson<Record<string, unknown>>(r.cursor, {});
  const total = r.total_count != null ? Number(r.total_count) : null;
  const done = Number(r.imported_count ?? 0) + Number(r.duplicate_count ?? 0) + Number(r.failed_count ?? 0) + Number(r.excluded_count ?? 0);
  let progress: number | null = null;
  if (String(r.status) === "done") progress = 1;
  else if (total != null && total > 0) progress = Math.min(1, done / total);
  else if (total === 0) progress = 1;
  else if (uploads.length) {
    // 원본 항목 수를 모름(.mbox) — 끝난 파일 크기 + 현재 .mbox 위치로 대략 계산.
    const all = uploads.reduce((s, u) => s + (u.size || 0), 0);
    const fi = Number(cursor.file ?? 0);
    const before = uploads.slice(0, fi).reduce((s, u) => s + (u.size || 0), 0);
    const cur = uploads[fi] && isMbox(uploads[fi].key) ? Number(cursor.offset ?? 0) : 0;
    progress = all > 0 ? Math.min(1, (before + cur) / all) : null;
  }
  return {
    jobId: String(r.job_id),
    kind: String(r.kind),
    sourceLabel: String(r.source_label),
    status: String(r.status),
    uploads,
    options: parseJson<ImportOptions>(r.options, {}),
    imapUser: r.imap_user != null ? String(r.imap_user) : null,
    totalCount: total,
    importedCount: Number(r.imported_count ?? 0),
    duplicateCount: Number(r.duplicate_count ?? 0),
    failedCount: Number(r.failed_count ?? 0),
    excludedCount: Number(r.excluded_count ?? 0),
    linkAttachmentCount: Number(r.link_attachment_count ?? 0),
    bytesImported: Number(r.bytes_imported ?? 0),
    progress,
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
        const { bytesRead } = await fh.read(buf, 0, length, start);
        return bytesRead === length ? buf : buf.subarray(0, bytesRead);
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

/** ZIP 항목 중 가져올 대상(.eml, 폴더 아님)만. */
function emlEntries(entries: ZipEntry[]): ZipEntry[] {
  return entries.filter((e) => !e.name.endsWith("/") && isEml(e.name));
}

/** 업로드 발급 — 본인 접두어 아래 presigned PUT. */
export async function createImportUpload(
  userId: string,
  input: { fileName: string; byteSize: number }
): Promise<{ key: string; url: string; contentType: string }> {
  const name = sanitizeFilename(input.fileName || "mail.zip");
  if (!isZip(name) && !isEml(name) && !isMbox(name)) {
    throw Object.assign(new Error("ZIP·EML·MBOX 파일만 올릴 수 있습니다."), { status: 400 });
  }
  if (!(input.byteSize > 0) || input.byteSize > IMPORT_MAX_FILE_BYTES) {
    throw Object.assign(new Error("파일당 2GB 까지 올릴 수 있습니다."), { status: 413 });
  }
  const bucket = bucketOrThrow();
  const key = ["mail-import-uploads", sanitizePathSegment(userId), crypto.randomBytes(8).toString("hex"), name].join("/");
  const contentType = isZip(name) ? "application/zip" : isMbox(name) ? "application/mbox" : "message/rfc822";
  const url = await getSignedUrl(getS3Client(), new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), {
    expiresIn: PUT_EXPIRES_SEC,
  });
  return { key, url, contentType };
}

async function insertJob(values: {
  mailboxId: string;
  userId: string;
  kind: "file" | "imap";
  sourceLabel: string;
  options: ImportOptions;
  uploads?: ImportUpload[];
  total: number | null;
  imap?: { host: string; port: number; user: string; secretEnc: string };
  cursor?: Record<string, unknown>;
}): Promise<string> {
  const jobId = "mij-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14);
  const now = new Date();
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO mail_import_jobs (job_id, mailbox_id, user_id, kind, source_label, status, options, uploads, total_count,
                                     imap_host, imap_port, imap_user, imap_secret_enc, secret_expires_at, cursor, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,'pending',$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$15)`,
      [
        jobId,
        values.mailboxId,
        values.userId,
        values.kind,
        values.sourceLabel,
        JSON.stringify(values.options),
        JSON.stringify(values.uploads ?? []),
        values.total,
        values.imap?.host ?? null,
        values.imap?.port ?? null,
        values.imap?.user ?? null,
        values.imap?.secretEnc ?? null,
        values.imap ? new Date(now.getTime() + SECRET_TTL_MS).toISOString() : null,
        JSON.stringify(values.cursor ?? {}),
        now.toISOString(),
      ]
    );
  });
  return jobId;
}

/** 파일 가져오기 작업 생성 — 업로드 확인·항목 수 집계(.mbox 는 처리하며 셈) 후 pending 으로 등록. */
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
  let total: number | null = 0;
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
        if (total != null) total += emlEntries(await readZipDirectory(src)).length;
      } catch (err) {
        const msg = err instanceof ZipFormatError ? err.message : "ZIP 을 읽지 못했습니다.";
        throw Object.assign(new Error(`'${u.name}' — ${msg}`), { status: 400 });
      }
    } else if (isMbox(key)) {
      total = null; // .mbox 는 메일 수를 미리 알 수 없다 — 끝나면 처리한 수로 채운다
    } else if (total != null) {
      total += 1;
    }
    uploads.push({ key, name: String(u.name ?? key.split("/").pop()), size, folderKind: kind, folderName });
  }

  const jobId = await insertJob({
    mailboxId: mailbox.mailboxId,
    userId,
    kind: "file",
    sourceLabel,
    options: { inboxPlacement: !!input.inboxPlacement },
    uploads,
    total,
  });
  const job = await getImportJob(userId, jobId);
  if (!job) throw new Error("작업을 만들지 못했습니다.");
  return job;
}

/** IMAP 접속 정보 정리 — 프리셋 키면 그 서버, 아니면 직접 입력. */
export function imapConfigFrom(input: { preset?: string; host?: string; port?: number; user?: string; password?: string }): ImapConfig {
  const preset = input.preset ? IMAP_PRESETS[input.preset] : undefined;
  const user = String(input.user ?? "").trim();
  const pass = String(input.password ?? "");
  if (!user || !pass) throw Object.assign(new Error("계정과 비밀번호(앱 비밀번호)를 입력하세요."), { status: 400 });
  return {
    host: preset ? preset.host : String(input.host ?? "").trim(),
    port: preset ? preset.port : Number(input.port) || 993,
    user,
    pass,
  };
}

/** 연결 확인 + 폴더 목록. 비밀번호는 저장하지 않는다. */
export async function testImapImport(input: { preset?: string; host?: string; port?: number; user?: string; password?: string }): Promise<ImapFolderInfo[]> {
  return listImapFolders(imapConfigFrom(input));
}

/** IMAP 가져오기 작업 생성 — 선택 폴더의 가져올 수를 세고, 같은 계정의 직전 완료 작업이 있으면 그 위치 다음부터(증분). */
export async function createImapImportJob(
  userId: string,
  input: {
    preset?: string;
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    sourceLabel?: string;
    inboxPlacement?: boolean;
    since?: string | null;
    folders?: { path: string; name: string; sent: boolean }[];
  }
): Promise<ImportJob> {
  const cfg = imapConfigFrom(input);
  const folders = (input.folders ?? [])
    .filter((f) => f && typeof f.path === "string" && f.path)
    .map((f) => ({ path: String(f.path), name: String(f.name || f.path).slice(0, 60), sent: !!f.sent }));
  if (!folders.length) throw Object.assign(new Error("가져올 폴더를 하나 이상 고르세요."), { status: 400 });
  const since = input.since && /^\d{4}-\d{2}-\d{2}$/.test(input.since) ? input.since : null;
  const sourceLabel =
    String(input.sourceLabel ?? "").trim().slice(0, 40) || (input.preset && IMAP_PRESETS[input.preset]?.label) || cfg.host;
  const mailbox = await ensureMailbox(userId);

  // 같은 서버·계정의 직전 완료 작업 위치(폴더별 UIDVALIDITY·마지막 UID).
  const db = await getDb();
  const prev = rowsToObjects(
    await db.exec(
      `SELECT cursor FROM mail_import_jobs
        WHERE user_id = $1 AND kind = 'imap' AND imap_host = $2 AND lower(imap_user) = lower($3) AND status = 'done'
        ORDER BY created_at DESC LIMIT 1`,
      [userId, cfg.host, cfg.user]
    )
  );
  const prevState = prev.length ? (parseJson<Record<string, unknown>>(prev[0].cursor, {}).folderState as Record<string, { uidValidity: string; lastUid: number }>) ?? {} : {};
  const { total, state } = await countImapPending(cfg, folders.map((f) => f.path), since, prevState);

  const jobId = await insertJob({
    mailboxId: mailbox.mailboxId,
    userId,
    kind: "imap",
    sourceLabel,
    options: { inboxPlacement: !!input.inboxPlacement, folders, since },
    total,
    imap: { host: cfg.host, port: cfg.port, user: cfg.user, secretEnc: encryptSecret(cfg.pass) },
    cursor: { folder: 0, folderState: state },
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

/** 취소 — 진행 중이면 다음 항목 처리 전에 멈춘다. 이미 가져온 메일은 남는다. 비밀번호는 바로 지운다. */
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

/** 끝났거나 7일이 지난 작업의 IMAP 비밀번호를 지운다(D-1). */
async function wipeStaleSecrets(): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(
      `UPDATE mail_import_jobs SET imap_secret_enc = NULL
        WHERE imap_secret_enc IS NOT NULL
          AND (status IN ('done', 'failed', 'cancelled') OR secret_expires_at < $1)`,
      [new Date().toISOString()]
    );
  });
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
             WHERE status IN ('pending', 'paused') OR (status = 'running' AND updated_at < $1)
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
 * 틱 1회 — 작업 1건을 40초 안에서 처리한다. 항목 오류(손상·크기 초과)는 실패로 세고 넘어가고,
 * 저장소·DB·연결 오류는 작업을 paused 로 두고 다음 틱에 재시도(연속 5회면 failed).
 */
export async function processImportTick(): Promise<ImportTickResult> {
  await wipeStaleSecrets();
  const row = await claimJob();
  if (!row) return { processed: 0 };
  const job = toJob(row);
  const mailboxId = String(row.mailbox_id);
  const started = Date.now();
  let processed = 0;
  let cursor = parseJson<Record<string, unknown>>(row.cursor, {});
  const errorsBefore = Number(cursor.errors ?? 0);
  const counts: ImportCounts = {
    imported: job.importedCount,
    duplicate: job.duplicateCount,
    failed: job.failedCount,
    excluded: job.excludedCount,
    link: job.linkAttachmentCount,
    bytes: job.bytesImported,
  };
  const failures = [...job.failures];

  const runner: JobRunner = {
    jobId: job.jobId,
    mailboxId,
    sourceLabel: job.sourceLabel,
    options: job.options,
    get cursor() {
      return cursor;
    },
    set cursor(v) {
      cursor = v;
    },
    counts,
    folders: undefined as unknown as ImportFolders,
    overBudget: () => Date.now() - started > TICK_BUDGET_MS,
    isCancelled: async () => {
      const db = await getDb();
      const r = rowsToObjects(await db.exec(`SELECT status FROM mail_import_jobs WHERE job_id = $1`, [job.jobId]));
      return !r.length || String(r[0].status) === "cancelled";
    },
    save: async (status, extra = {}) => {
      const now = new Date().toISOString();
      const sum = counts.imported + counts.duplicate + counts.failed + counts.excluded;
      await withDbWrite(async (db) => {
        await db.run(
          `UPDATE mail_import_jobs
              SET status = CASE WHEN status = 'cancelled' THEN 'cancelled' ELSE $2 END,
                  cursor = $3::jsonb, imported_count = $4, duplicate_count = $5, failed_count = $6, excluded_count = $7,
                  link_attachment_count = $8, bytes_imported = $9, failures = $10::jsonb,
                  last_error = COALESCE($11, last_error), updated_at = $12,
                  finished_at = CASE WHEN $13 THEN $12 ELSE finished_at END,
                  total_count = CASE WHEN $13 AND (total_count IS NULL OR kind = 'imap') THEN $14 ELSE total_count END,
                  imap_secret_enc = CASE WHEN $15 THEN NULL ELSE imap_secret_enc END
            WHERE job_id = $1`,
          [
            job.jobId,
            status,
            JSON.stringify(cursor),
            counts.imported,
            counts.duplicate,
            counts.failed,
            counts.excluded,
            counts.link,
            counts.bytes,
            JSON.stringify(failures.slice(-FAILURE_KEEP)),
            extra.lastError ?? null,
            now,
            !!extra.finished,
            sum,
            !!extra.wipeSecret || !!extra.finished,
          ]
        );
      });
    },
    importOne: async (raw, target, where, fallbackDate) => {
      try {
        const r = await importRawMessage(raw, target, fallbackDate);
        if (r.outcome === "imported") counts.imported += 1;
        else counts.duplicate += 1;
        counts.bytes += r.bytes;
        if (r.linkAttachment) counts.link += 1;
      } catch (err) {
        if (err instanceof ImportItemError) runner.fail(where, err.message);
        else throw err; // 저장소·DB 오류 → 작업 일시 중지
      } finally {
        processed += 1;
      }
    },
    fail: (where, reason) => {
      counts.failed += 1;
      failures.push({ file: where.file, entry: where.entry, reason });
    },
  };

  try {
    runner.folders = {
      myAddrs: new Set((await getMailboxAddresses(mailboxId)).map((a) => a.address)),
      importFolder: await importFolderId(mailboxId, job.sourceLabel),
      inboxFolder: await getSystemFolderId(mailboxId, "inbox"),
      sentFolder: await getSystemFolderId(mailboxId, "sent"),
    };
    cursor = { ...cursor, errors: 0 };

    let result: "paused" | "done" | "failed" | "cancelled";
    if (job.kind === "imap") {
      const pass = decryptSecret(row.imap_secret_enc != null ? String(row.imap_secret_enc) : null);
      if (!pass) {
        await runner.save("failed", { lastError: "비밀번호 보관 기간(7일)이 지났습니다. 다시 시작해 주세요.", finished: true });
        return { jobId: job.jobId, processed, status: "failed" };
      }
      result = await processImapJob(runner, {
        host: String(row.imap_host ?? ""),
        port: Number(row.imap_port ?? 993),
        user: String(row.imap_user ?? ""),
        pass,
      });
    } else {
      result = await processFileJob(runner, job);
    }
    if (result !== "done") return { jobId: job.jobId, processed, status: result };

    // 끝 — 원본 항목 수를 미리 안 파일 작업은 집계 일치를 검사한다.
    const sum = counts.imported + counts.duplicate + counts.failed + counts.excluded;
    if (job.kind === "file" && job.totalCount != null && sum !== job.totalCount) {
      await runner.save("failed", {
        lastError: `집계 불일치: 원본 ${job.totalCount}건 ≠ 가져옴 ${counts.imported} + 중복 ${counts.duplicate} + 실패 ${counts.failed} + 제외 ${counts.excluded}`,
        finished: true,
      });
      return { jobId: job.jobId, processed, status: "failed" };
    }
    await runner.save("done", { finished: true });
    return { jobId: job.jobId, processed, status: "done" };
  } catch (err) {
    const errors = errorsBefore + 1;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mail-import] tick error", job.jobId, message);
    cursor = { ...cursor, errors };
    if (errors >= MAX_CONSECUTIVE_ERRORS) {
      await runner.save("failed", { lastError: `연속 ${errors}회 오류로 중단: ${message}`, finished: true });
      return { jobId: job.jobId, processed, status: "failed" };
    }
    await runner.save("paused", { lastError: message });
    return { jobId: job.jobId, processed, status: "paused" };
  }
}

// 지메일 Takeout 라벨 — 가져오지 않는 것(스팸·휴지통·채팅·임시보관)과 시스템 라벨(폴더 라벨로 남기지 않음).
const GMAIL_EXCLUDE = new Set(["spam", "trash", "chat", "drafts", "스팸", "휴지통", "채팅", "임시보관함"]);
const GMAIL_SYSTEM = new Set([
  "inbox", "sent", "important", "starred", "unread", "opened", "archived",
  "받은편지함", "보낸편지함", "중요", "별표편지함", "읽지 않음", "보관처리됨",
]);
const GMAIL_SENT = new Set(["sent", "보낸편지함"]);

/** 파일 작업 처리 — 업로드 파일을 차례로(.zip 항목 · .eml · .mbox 메일). */
async function processFileJob(runner: JobRunner, job: ImportJob): Promise<"paused" | "done" | "cancelled"> {
  let fileIdx = Number(runner.cursor.file ?? 0);
  let checks = 0;
  const step = async (): Promise<"paused" | "cancelled" | null> => {
    if (runner.overBudget()) {
      await runner.save("paused");
      return "paused";
    }
    checks += 1;
    if (checks % 20 === 0 && (await runner.isCancelled())) return "cancelled";
    return null;
  };

  while (fileIdx < job.uploads.length) {
    const u = job.uploads[fileIdx];
    const src = storageSource(u.key);
    if (isMbox(u.key)) {
      const size = await src.size();
      let offset = Number(runner.cursor.offset ?? 0);
      let n = Number(runner.cursor.entry ?? 0);
      while (offset < size) {
        const stop = await step();
        if (stop) return stop;
        n += 1;
        const where = { file: u.name, entry: `${n}번째 메일` };
        let r;
        try {
          r = await readMboxMessage(src, offset, size, IMPORT_MAX_MESSAGE_BYTES);
        } catch (err) {
          if (err instanceof MboxFormatError) {
            runner.fail(where, err.message);
            offset = size; // 이 파일은 더 읽지 않는다
            break;
          }
          throw err;
        }
        if (!r) break;
        if (!r.raw) {
          runner.fail(where, `크기 초과(${Math.round((r.tooLargeBytes ?? 0) / 1048576)}MB)`);
        } else {
          const labels = gmailLabels(r.raw);
          const lower = labels.map((l) => l.toLowerCase());
          if (lower.some((l) => GMAIL_EXCLUDE.has(l))) {
            runner.counts.excluded += 1;
          } else {
            await runner.importOne(r.raw, buildTarget(runner.mailboxId, u, job, runner.folders, r.raw, labels), where);
          }
        }
        offset = r.next;
        runner.cursor = { ...runner.cursor, file: fileIdx, entry: n, offset };
        await runner.save("running");
      }
    } else {
      // 항목 목록: ZIP 은 중앙 디렉터리의 .eml, EML 파일은 그 자체 1개.
      const items: { name: string; entry: ZipEntry | null }[] = isZip(u.key)
        ? emlEntries(await readZipDirectory(src)).map((e) => ({ name: e.name, entry: e }))
        : [{ name: u.name, entry: null }];
      let entryIdx = Number(runner.cursor.entry ?? 0);
      while (entryIdx < items.length) {
        const stop = await step();
        if (stop) return stop;
        const it = items[entryIdx];
        const where = { file: u.name, entry: it.name.split("/").pop() ?? it.name };
        try {
          let raw: Buffer;
          if (it.entry) {
            raw = await readZipEntry(src, it.entry, IMPORT_MAX_MESSAGE_BYTES);
          } else {
            const size = await src.size();
            if (size > IMPORT_MAX_MESSAGE_BYTES) throw new ImportItemError(`크기 초과(${Math.round(size / 1048576)}MB)`);
            raw = await src.read(0, size);
          }
          await runner.importOne(raw, buildTarget(runner.mailboxId, u, job, runner.folders, raw, []), where);
        } catch (err) {
          if (err instanceof ZipFormatError || err instanceof ImportItemError) runner.fail(where, err.message);
          else throw err;
        }
        entryIdx += 1;
        runner.cursor = { ...runner.cursor, file: fileIdx, entry: entryIdx };
        await runner.save("running");
      }
    }
    fileIdx += 1;
    runner.cursor = { ...runner.cursor, file: fileIdx, entry: 0, offset: 0 };
  }
  return "done";
}

/**
 * 방향·폴더·라벨 — 원본 정보 우선.
 * 지메일 Takeout 라벨이 있으면 라벨로(보낸 편지·읽음·사용자 라벨), 없으면 업로드 때 고른 원본 메일함으로.
 * 사용자 메일함만 보낸 사람이 내 주소인지로 보조 판별.
 */
function buildTarget(mailboxId: string, u: ImportUpload, job: ImportJob, ctx: ImportFolders, raw: Buffer, gmail: string[]): ImportTarget {
  if (gmail.length) {
    const lower = gmail.map((l) => l.toLowerCase());
    const sent = lower.some((l) => GMAIL_SENT.has(l));
    const userLabels = gmail.filter((l) => !GMAIL_SYSTEM.has(l.toLowerCase()) && !l.toLowerCase().startsWith("category "));
    return {
      mailboxId,
      folderId: sent ? ctx.sentFolder : job.options.inboxPlacement ? ctx.inboxFolder : ctx.importFolder,
      direction: sent ? "out" : "in",
      isRead: sent || !lower.includes("unread"),
      labels: (userLabels.length ? userLabels : [sent ? "보낸편지함" : "받은편지함"]).map((l) => `import:${job.sourceLabel}/${l}`),
    };
  }
  const labels = [`import:${job.sourceLabel}/${u.folderName}`];
  if (u.folderKind === "sent") {
    return { mailboxId, folderId: ctx.sentFolder, direction: "out", isRead: true, labels };
  }
  if (u.folderKind === "custom") {
    // 사용자 메일함에는 보낸 메일이 섞일 수 있다 — 원문 From 헤더가 내 주소면 보낸 메일로 본다.
    const head = raw.subarray(0, Math.min(raw.length, 64 * 1024)).toString("latin1");
    const m = head.match(/^From:[^\r\n]*(?:\r?\n[ \t][^\r\n]*)*/im);
    const addr = m ? (m[0].match(/[\w.+-]+@[\w.-]+/) ?? [""])[0].toLowerCase() : "";
    // myAddrs = 메일함 주소 원장 전체(.app·.com) — 원 계정이 아마란스면 .com 주소가 여기에 있다.
    const mine = !!addr && ctx.myAddrs.has(addr);
    return { mailboxId, folderId: mine ? ctx.sentFolder : ctx.importFolder, direction: mine ? "out" : "in", isRead: mine, labels };
  }
  // 아마란스 ZIP·eml 에는 읽음 정보가 없다(10-21 원문 251통 실측: Status·X-Status·플래그 헤더 0건, 파일명도 폴더명뿐).
  // 받은 메일은 안읽음으로 두어 사용자가 직접 읽으며 정리한다(사용자 지정). 보낸 메일만 읽음.
  return { mailboxId, folderId: job.options.inboxPlacement ? ctx.inboxFolder : ctx.importFolder, direction: "in", isRead: false, labels };
}
