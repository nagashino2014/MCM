/**
 * 메일 발송 어댑터 — AWS SES. 자격증명은 ECS 태스크 롤(IAM), 발신 주소는 env.
 * BID_NOTIFY_EMAIL_FROM 미설정이면 skipped(발송 시도 안 함) — 배포 없이 채널만 잠가둘 수 있다.
 * ⚠ SES sandbox 상태면 검증된 수신자에게만 발송된다(운영 전 발신 도메인/주소 검증 필요).
 */
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { SESv2Client, SendEmailCommand as SendEmailV2Command } from "@aws-sdk/client-sesv2";

export interface ChannelSendResult {
  ok: boolean;
  skipped?: string;
  error?: string;
  sentTo?: number;
}

let client: SESClient | null = null;

function getClient(): SESClient {
  client ??= new SESClient({ region: process.env.AWS_REGION ?? "ap-northeast-2" });
  return client;
}

let clientV2: SESv2Client | null = null;

function getClientV2(): SESv2Client {
  clientV2 ??= new SESv2Client({ region: process.env.AWS_REGION ?? "ap-northeast-2" });
  return clientV2;
}

export interface RawSendResult {
  ok: boolean;
  error?: string;
  sesMessageId?: string;
}

/**
 * 원문 MIME 발송(SES v2 SendEmail/Raw) — 코넨사인 메일 발송(HTML·첨부·스레딩 헤더 지원).
 * source 는 발신 mailbox 주소(검증 도메인), destinations 는 To+Cc+Bcc 전체.
 * 자격증명은 ECS 태스크 롤(ses:SendEmail 부여됨 — v2 의 raw 발송도 같은 액션).
 *
 * ⚠ v1 SendRawEmail 은 메시지 상한이 10MB(base64 포함 → 실효 첨부 ~7MB)라 공문 동봉 서류가
 *   자주 걸렸다. v2 는 40MB 라 실효 ~28MB 까지 직접 첨부할 수 있다(2026-08-10 전환).
 */
export async function sendRawEmail(input: {
  raw: Buffer;
  source: string;
  destinations: string[];
}): Promise<RawSendResult> {
  const dests = input.destinations.map((s) => s.trim()).filter((s) => /.+@.+\..+/.test(s));
  if (!dests.length) return { ok: false, error: "수신자 이메일 없음" };
  try {
    const out = await getClientV2().send(
      new SendEmailV2Command({
        FromEmailAddress: input.source,
        Destination: { ToAddresses: dests },
        Content: { Raw: { Data: new Uint8Array(input.raw) } },
      })
    );
    return { ok: true, sesMessageId: out.MessageId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendNotifyEmail(input: {
  to: string[];
  subject: string;
  text: string;
}): Promise<ChannelSendResult> {
  const from = (process.env.BID_NOTIFY_EMAIL_FROM ?? "").trim();
  if (!from) return { ok: false, skipped: "BID_NOTIFY_EMAIL_FROM 미설정" };
  const to = input.to.map((s) => s.trim()).filter((s) => /.+@.+\..+/.test(s));
  if (!to.length) return { ok: false, skipped: "수신자 이메일 없음" };
  try {
    client ??= new SESClient({ region: process.env.AWS_REGION ?? "ap-northeast-2" });
    await client.send(
      new SendEmailCommand({
        Source: from,
        Destination: { ToAddresses: to },
        Message: {
          Subject: { Data: input.subject, Charset: "UTF-8" },
          Body: { Text: { Data: input.text, Charset: "UTF-8" } },
        },
      })
    );
    return { ok: true, sentTo: to.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
