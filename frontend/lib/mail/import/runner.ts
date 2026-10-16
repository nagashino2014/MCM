/**
 * 메일 가져오기 — 틱 처리 공용 타입(jobs.ts ↔ imap.ts 순환 import 방지용).
 */
import type { ImportTarget } from "@/lib/mail/import/store";

export interface ImportCounts {
  imported: number;
  duplicate: number;
  failed: number;
  excluded: number;
  link: number;
  bytes: number;
}

export interface ImportFolders {
  importFolder: string;
  inboxFolder: string;
  sentFolder: string;
  myAddrs: Set<string>;
}

export interface JobRunner {
  jobId: string;
  mailboxId: string;
  sourceLabel: string;
  options: { inboxPlacement?: boolean; folders?: { path: string; name: string; sent: boolean }[]; since?: string | null };
  /** 진행 위치 — 처리하면서 고치고 save() 로 저장한다. */
  cursor: Record<string, unknown>;
  counts: ImportCounts;
  folders: ImportFolders;
  /** 틱 시간 예산을 넘었는지. */
  overBudget(): boolean;
  isCancelled(): Promise<boolean>;
  save(status: string, extra?: { lastError?: string | null; finished?: boolean; wipeSecret?: boolean }): Promise<void>;
  /** 1통 가져오기 — 항목 오류(손상·크기)는 실패로 세고, 저장소·DB 오류는 던진다(작업 일시 중지). */
  importOne(raw: Buffer, target: ImportTarget, where: { file: string; entry: string }, fallbackDate?: Date): Promise<void>;
  fail(where: { file: string; entry: string }, reason: string): void;
}
