/**
 * 메일 발송 어댑터 — AWS SES. 자격증명은 ECS 태스크 롤(IAM), 발신 주소는 env.
 * BID_NOTIFY_EMAIL_FROM 미설정이면 skipped(발송 시도 안 함) — 배포 없이 채널만 잠가둘 수 있다.
 * ⚠ SES sandbox 상태면 검증된 수신자에게만 발송된다(운영 전 발신 도메인/주소 검증 필요).
 */
import { SESClient, SendEmailCommand, SendRawEmailCommand } from "@aws-sdk/client-ses";

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

export interface RawSendResult {
  ok: boolean;
  error?: string;
  sesMessageId?: string;
}

/**
 * 원문 MIME 발송(SES SendRawEmail) — 코넨사인 메일 발송(HTML·첨부·스레딩 헤더 지원).
 * source 는 발신 mailbox 주소(검증 도메인), destinations 는 To+Cc+Bcc 전체.
 * 자격증명은 ECS 태스크 롤(ses:SendRawEmail 이미 부여됨).
 */
export async function sendRawEmail(input: {
  raw: Buffer;
  source: string;
  destinations: string[];
}): Promise<RawSendResult> {
  const dests = input.destinations.map((s) => s.trim()).filter((s) => /.+@.+\..+/.test(s));
  if (!dests.length) return { ok: false, error: "수신자 이메일 없음" };
  try {
    const out = await getClient().send(
      new SendRawEmailCommand({
        Source: input.source,
        Destinations: dests,
        RawMessage: { Data: input.raw },
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
