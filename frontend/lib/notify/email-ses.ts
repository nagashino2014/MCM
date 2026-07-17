/**
 * 메일 발송 어댑터 — AWS SES. 자격증명은 ECS 태스크 롤(IAM), 발신 주소는 env.
 * BID_NOTIFY_EMAIL_FROM 미설정이면 skipped(발송 시도 안 함) — 배포 없이 채널만 잠가둘 수 있다.
 * ⚠ SES sandbox 상태면 검증된 수신자에게만 발송된다(운영 전 발신 도메인/주소 검증 필요).
 */
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

export interface ChannelSendResult {
  ok: boolean;
  skipped?: string;
  error?: string;
  sentTo?: number;
}

let client: SESClient | null = null;

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
