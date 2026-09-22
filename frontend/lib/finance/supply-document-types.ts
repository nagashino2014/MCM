/** 문서 전체의 등록이다. 공급 승인·분개·부가세 공제에는 사용하지 않는다. */
export type SupplyDocumentSourceKind = "card" | "hometax" | "tax_invoice";
export interface SupplyDocumentInput {
  subjectId: string;
  reviewRevisionId: string;
  sourceKind: SupplyDocumentSourceKind;
  sourceId: string;
}
export interface SupplyDocumentRegisterInput extends SupplyDocumentInput {
  expectedPreviewHash: string;
  expectedVersion: number;
  requestId: string;
}
export interface SupplyDocumentSummary {
  date: string;
  direction: string;
  approvalNumber: string | null;
  supply: number;
  tax: number;
  total: number;
}
export interface SupplyDocumentPreview {
  schemaVersion: "de1a-document-preview-v1";
  subjectId: string;
  reviewRevisionId: string;
  source: { kind: SupplyDocumentSourceKind; id: string };
  canRegister: boolean;
  issues: { code: string; message: string }[];
  documentId: string | null;
  portionId: string | null;
  version: number;
  identity: { namespace: string; keyHash: string; baseKeyHash: string | null; descriptorHash: string } | null;
  observation: (SupplyDocumentSummary & {
    subjectRevisionId: string;
    sources: { kind: SupplyDocumentSourceKind; id: string; sourceHash: string }[];
    snapshotHash: string;
  }) | null;
  previewHash: string;
}
export interface SupplyDocumentResult {
  documentId: string;
  portionId: string;
  observationId: string;
  version: number;
  replayed: boolean;
}
export interface SupplyDocumentList {
  documents: {
    documentId: string;
    portionId: string;
    version: number;
    latestObservation: SupplyDocumentSummary;
    observationCount: number;
  }[];
  hasMore: boolean;
  history?: {
    observationId: string;
    version: number;
    reviewRevisionId: string;
    createdAt: string;
    summary: SupplyDocumentSummary;
  }[];
  historyHasMore?: boolean;
}
