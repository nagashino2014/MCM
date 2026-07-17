/**
 * Next 서버 기동 훅(Next 15 instrumentation) — 공공입찰 매칭 알림 발송 타이머.
 * next 서비스는 ECS 상시 1태스크라 인프로세스 주기 체크로 충분하다(별도 스케줄러 불요).
 * 5분마다 내부 라우트(/api/internal/bid-notify-tick)를 자기호출 — 설정된 발송 시각(KST)
 * 도달 시 pending 큐를 발송(일 1회 멱등). DB 모듈(pg)을 직접 import 하면 edge 번들이
 * 깨지므로(instrumentation 은 edge 로도 컴파일됨) fetch 위임만 한다.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const g = globalThis as { __bidNotifyTimer?: ReturnType<typeof setInterval> };
  if (g.__bidNotifyTimer) return; // dev HMR·중복 register 방어
  const port = process.env.PORT ?? "3000";
  const tick = async () => {
    try {
      await fetch(`http://127.0.0.1:${port}/api/internal/bid-notify-tick`, {
        method: "POST",
        headers: { "x-cron-key": process.env.AUTH_SECRET ?? "" },
      });
    } catch (err) {
      console.error("[bid-notify] tick fetch error", err);
    }
  };
  g.__bidNotifyTimer = setInterval(tick, 5 * 60 * 1000);
  setTimeout(tick, 30 * 1000); // 기동 직후 1회(서버 리슨 대기 여유 30초)
}
