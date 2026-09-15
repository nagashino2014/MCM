/**
 * 대외 신고 기한 알림(213) — 리마인드 틱(approval-remind-tick)에서 하루 한 번 대기열을 재파생하고,
 * 기한 임박(remindBeforeDays 이내)·초과 대기 건이 있으면 설정된 수신자에게 앱 푸시를 보낸다.
 * 이벤트 키 `filing.due` 하나, dedup 은 수신자×일자(sendPush 가 mobile_push_log 로 걸러 준다).
 * 실패해도 틱을 막지 않는다 — throw 하지 않고 콘솔 경고만 남긴다.
 */
import { sendPush } from "@/lib/notify/push-expo";
import { getFilingSummary, loadFilingSettings, syncFilings, todayKst } from "./store";

export async function dispatchFilingDueReminders(): Promise<{ notified: number; overdue: number; dueSoon: number }> {
  try {
    await syncFilings();
    const settings = await loadFilingSettings();
    if (settings.notifyUserIds.length === 0) return { notified: 0, overdue: 0, dueSoon: 0 };
    const summary = await getFilingSummary(3);
    if (summary.overdue === 0 && summary.dueSoon === 0) return { notified: 0, overdue: 0, dueSoon: 0 };
    const head = summary.items.map((f) => f.title).join(", ");
    const parts = [
      summary.overdue > 0 ? `기한 초과 ${summary.overdue}건` : "",
      summary.dueSoon > 0 ? `기한 임박 ${summary.dueSoon}건` : "",
    ].filter(Boolean);
    const result = await sendPush(settings.notifyUserIds, {
      event: "filing.due",
      title: "대외 신고 기한 확인",
      body: `${parts.join(" · ")} — ${head}${summary.pending > summary.items.length ? " 외" : ""}`,
      link: "/contracts/filings",
      targetRef: "filings",
      dedupKey: `filing.due:${todayKst()}`,
    });
    return { notified: result.sentTo ?? 0, overdue: summary.overdue, dueSoon: summary.dueSoon };
  } catch (err) {
    console.warn("[filings] due reminder failed", err);
    return { notified: 0, overdue: 0, dueSoon: 0 };
  }
}
