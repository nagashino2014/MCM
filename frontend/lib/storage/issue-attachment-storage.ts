import { putContractDocument, sanitizeFilename, sanitizePathSegment, type StoredContractDocument } from "@/lib/storage/contract-document-storage";

/**
 * 이슈 보고 첨부파일 S3 키. 용역/Task 별로 분류한다:
 *   issues/{contract|task}/{subjectId}/{issueId}/{파일명}
 */
export function getIssueAttachmentStorageKey(params: {
  subjectKind: "contract" | "task";
  subjectId: string;
  issueId: string;
  fileName: string;
}): { storageKey: string; fileName: string } {
  const fileName = sanitizeFilename(params.fileName || "attachment");
  const subj = params.subjectKind === "task" ? "task" : "contract";
  const sid = sanitizePathSegment(params.subjectId) || "unknown";
  const iid = sanitizePathSegment(params.issueId) || "unknown";
  const storageKey = ["issues", subj, sid, iid, fileName].join("/");
  return { storageKey, fileName };
}

/** S3(또는 로컬)에 저장. 다운로드 publicPath 는 이슈 첨부 전용 라우트로 둔다. */
export async function putIssueAttachment(
  storageKey: string,
  body: Buffer,
  contentType: string
): Promise<StoredContractDocument> {
  const stored = await putContractDocument(storageKey, body, contentType);
  return { ...stored, publicPath: "/api/work-plan/issue-attachments?key=" + encodeURIComponent(storageKey) };
}
