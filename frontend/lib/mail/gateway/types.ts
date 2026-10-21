/**
 * 외부 메일 프로그램 게이트웨이 — 저장소 인터페이스.
 * IMAP 세션·SMTP 제출은 이 인터페이스만 쓰고, 실제 구현(pg-store.ts)은 DB(mail_*)·S3 를 다룬다.
 * 테스트는 메모리 구현으로 프로토콜만 검증한다.
 */
import type { StructNode } from "@/lib/mail/gateway/mime-tree";

export type GwProto = "imap" | "smtp";

export interface GwUser {
  userId: string;
  mailboxId: string;
  /** 대표 주소(로그인 이름으로도 쓴다). */
  address: string;
  /** 이 메일함이 발신에 쓸 수 있는 주소(소문자). */
  sendAddresses: string[];
  displayName: string;
  appPasswordId: string;
}

export type GwAuthResult =
  | { ok: true; user: GwUser }
  | { ok: false; reason: "invalid" | "blocked" | "disabled" };

export interface GwFolder {
  folderId: string;
  /** 표시 이름(유니코드). 받은편지함은 "INBOX". */
  name: string;
  systemKind: string | null;
  uidValidity: number;
  uidNext: number;
}

export interface GwEntry {
  uid: number;
  messageId: string;
  flags: string[];
}

export interface GwSnapshot {
  folder: GwFolder;
  /** UID 오름차순. */
  entries: GwEntry[];
}

/** FETCH 에 필요한 확정 원문 정보(크기·헤더·구조). */
export interface GwMeta {
  internalDate: Date;
  size: number;
  header: Buffer;
  structure: StructNode;
}

export interface GwSearchInfo {
  internalDate: Date;
  sentDate: Date | null;
  size: number;
  subject: string;
  from: string;
  to: string;
  cc: string;
  bcc: string;
  messageId: string;
}

export type FlagMode = "set" | "add" | "remove";

export interface GwStore {
  authenticate(username: string, password: string, ip: string, proto: GwProto): Promise<GwAuthResult>;
  /** 세션 유지 중 재확인 — 앱 비밀번호 폐기·퇴사(계정 비활성)·기능 끔이면 false. */
  stillValid(user: GwUser): Promise<boolean>;
  listFolders(user: GwUser): Promise<GwFolder[]>;
  snapshot(user: GwUser, folderId: string): Promise<GwSnapshot>;
  loadMeta(user: GwUser, messageIds: string[]): Promise<Map<string, GwMeta>>;
  loadRaw(user: GwUser, messageId: string): Promise<Buffer>;
  searchInfo(user: GwUser, folderId: string): Promise<Map<number, GwSearchInfo>>;
  bodySearch(user: GwUser, folderId: string, term: string, withHeaders: boolean): Promise<Set<number>>;
  /** 플래그 변경 후 UID → 새 플래그. 없는 UID 는 빠진다. */
  setFlags(user: GwUser, folderId: string, uids: number[], mode: FlagMode, flags: string[]): Promise<Map<number, string[]>>;
  /** [원본 UID, 대상 UID] 쌍. */
  copy(user: GwUser, srcFolderId: string, uids: number[], destFolderId: string): Promise<[number, number][]>;
  move(user: GwUser, srcFolderId: string, uids: number[], destFolderId: string): Promise<[number, number][]>;
  /** \Deleted 표시된 배치를 지운다(uids 지정 시 그 안에서만). 지운 UID 목록. */
  expunge(user: GwUser, folderId: string, uids?: number[]): Promise<number[]>;
  append(user: GwUser, folderId: string, raw: Buffer, flags: string[], date: Date | null): Promise<{ uid: number; uidValidity: number }>;
  createFolder(user: GwUser, name: string): Promise<void>;
  renameFolder(user: GwUser, folderId: string, newName: string): Promise<void>;
  deleteFolder(user: GwUser, folderId: string): Promise<void>;
}

/** 저장소가 사용자에게 보여 줄 수 있는 거절(IMAP NO 응답 문구로 전달). */
export class GwUserError extends Error {}
