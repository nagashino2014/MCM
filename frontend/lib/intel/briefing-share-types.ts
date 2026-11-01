export type BriefingShareChannel = "shared" | "inbox" | "push" | "messenger";
export type BriefingShareStatus = "pending" | "sending" | "sent" | "failed" | "skipped" | "unknown";
export interface BriefingShareInput {
  requestKey: string;
  recipients: Array<{ userId: string; name?: string }>;
  channels?: BriefingShareChannel[];
}
export interface BriefingShareDelivery {
  deliveryId: string;
  userId: string;
  channel: BriefingShareChannel;
  status: BriefingShareStatus;
  attempt: number;
  error: string | null;
  providerId: string | null;
  roomId: number | null;
}
export interface BriefingShareResult {
  ok: boolean;
  shared: number;
  requestId: string;
  requestKey: string;
  deliveries: BriefingShareDelivery[];
  summary: { sent: number; failed: number; skipped: number; unknown: number; pending: number };
}
