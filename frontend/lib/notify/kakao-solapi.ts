/**
 * 카카오 알림톡 발송 어댑터 — 솔라피(solapi.com) REST v4.
 * 필요 env(전부 없으면 skipped — 대행사 계약·발신프로필·템플릿 승인 후 등록):
 *   SOLAPI_API_KEY / SOLAPI_API_SECRET  — 솔라피 API 자격증명
 *   SOLAPI_KAKAO_PF_ID                  — 카카오 비즈니스 채널 발신프로필 ID
 *   SOLAPI_KAKAO_TEMPLATE_ID            — 사전 승인된 알림톡 템플릿 ID
 *   SOLAPI_SENDER                       — 등록 발신번호(SMS 대체발송용, 선택)
 * 템플릿 본문에는 #{content} 변수 하나를 두는 것을 전제로 요약 텍스트를 치환한다.
 */
import crypto from "node:crypto";
import type { ChannelSendResult } from "@/lib/notify/email-ses";

const API_URL = "https://api.solapi.com/messages/v4/send-many/detail";
/** 알림톡 본문 상한(1,000자) 대비 여유 자르기. */
const MAX_CONTENT = 900;

export async function sendAlimtalk(input: { to: string[]; text: string }): Promise<ChannelSendResult> {
  const apiKey = (process.env.SOLAPI_API_KEY ?? "").trim();
  const apiSecret = (process.env.SOLAPI_API_SECRET ?? "").trim();
  const pfId = (process.env.SOLAPI_KAKAO_PF_ID ?? "").trim();
  const templateId = (process.env.SOLAPI_KAKAO_TEMPLATE_ID ?? "").trim();
  if (!apiKey || !apiSecret || !pfId || !templateId) {
    return { ok: false, skipped: "솔라피 알림톡 자격증명 미설정(SOLAPI_*)" };
  }
  const to = input.to.map((s) => s.replace(/[^0-9]/g, "")).filter((s) => s.length >= 10);
  if (!to.length) return { ok: false, skipped: "수신자 휴대폰번호 없음" };

  const content = input.text.length > MAX_CONTENT ? `${input.text.slice(0, MAX_CONTENT)}…` : input.text;
  const from = (process.env.SOLAPI_SENDER ?? "").replace(/[^0-9]/g, "");
  const messages = to.map((phone) => ({
    to: phone,
    ...(from ? { from } : {}),
    kakaoOptions: {
      pfId,
      templateId,
      variables: { "#{content}": content },
      disableSms: true, // 알림톡 실패 시 SMS 대체발송 안 함(비용·중복 방지)
    },
  }));

  // HMAC-SHA256 인증 — signature = HMAC(secret, date + salt)
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString("hex");
  const signature = crypto.createHmac("sha256", apiSecret).update(date + salt).digest("hex");

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`,
      },
      body: JSON.stringify({ messages }),
    });
    const data = (await res.json().catch(() => ({}))) as { errorMessage?: string; failedMessageList?: unknown[] };
    if (!res.ok) {
      return { ok: false, error: data?.errorMessage ?? `HTTP ${res.status}` };
    }
    const failed = Array.isArray(data?.failedMessageList) ? data.failedMessageList.length : 0;
    if (failed >= to.length) return { ok: false, error: `전체 ${to.length}건 발송 실패` };
    return { ok: true, sentTo: to.length - failed };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
