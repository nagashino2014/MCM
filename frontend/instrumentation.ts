/**
 * Next 서버 기동 훅(Next 15 instrumentation) — 공공입찰 매칭 알림 발송 타이머.
 * next 서비스는 ECS 상시 1태스크라 인프로세스 주기 체크로 충분하다(별도 스케줄러 불요).
 * 5분마다 내부 라우트(/api/internal/bid-notify-tick)를 자기호출 — 설정된 발송 시각(KST)
 * 도달 시 pending 큐를 발송(일 1회 멱등). DB 모듈(pg)을 직접 import 하면 edge 번들이
 * 깨지므로(instrumentation 은 edge 로도 컴파일됨) fetch 위임만 한다.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const g = globalThis as {
    __bidNotifyTimer?: ReturnType<typeof setInterval>;
    __bidCollectTimer?: ReturnType<typeof setInterval>;
    __approvalRemindTimer?: ReturnType<typeof setInterval>;
    __mailInboundTimer?: ReturnType<typeof setInterval>;
    __fileRetentionTimer?: ReturnType<typeof setInterval>;
    __cardSlipTimer?: ReturnType<typeof setInterval>;
  };
  const port = process.env.PORT ?? "3000";
  const callTick = async (path: string, tag: string) => {
    try {
      await fetch(`http://127.0.0.1:${port}${path}`, {
        method: "POST",
        headers: { "x-cron-key": process.env.AUTH_SECRET ?? "" },
      });
    } catch (err) {
      console.error(`[${tag}] tick fetch error`, err);
    }
  };

  if (!g.__bidNotifyTimer) {
    const tick = () => callTick("/api/internal/bid-notify-tick", "bid-notify");
    g.__bidNotifyTimer = setInterval(tick, 5 * 60 * 1000);
    setTimeout(tick, 30 * 1000); // 기동 직후 1회(서버 리슨 대기 여유 30초)
  }

  // 공공입찰 수집 — 5분마다 체크, 소스별 설정 시각(KST, 기본 07시)에 1회 수집(일 1회 멱등).
  // 야간 배치(03시)에서 분리: 나라장터가 새벽 시간대 무응답(60초 타임아웃) 실측.
  if (!g.__bidCollectTimer) {
    const collectTick = () => callTick("/api/internal/bid-collect-tick", "bid-collect");
    g.__bidCollectTimer = setInterval(collectTick, 5 * 60 * 1000);
    setTimeout(collectTick, 40 * 1000); // 기동 직후 1회
  }

  // 미결재 리마인드(AX-P1) — 30분마다 체크(디스패처가 스텝×일자 dedup 이라 과발송 없음).
  if (!g.__approvalRemindTimer) {
    const remindTick = () => callTick("/api/internal/approval-remind-tick", "approval-remind");
    g.__approvalRemindTimer = setInterval(remindTick, 30 * 60 * 1000);
    setTimeout(remindTick, 60 * 1000); // 기동 직후 1회(60초 여유)
  }

  // 파일 저장 정책 자동 삭제 — 6시간마다 체크, KST 일 1회 실행(라우트가 멱등 판정).
  // 정책 전부 '영구'면 캐시로 no-op(Aurora auto-pause 보호).
  if (!g.__fileRetentionTimer) {
    const retentionTick = () => callTick("/api/internal/file-retention-tick", "file-retention");
    g.__fileRetentionTimer = setInterval(retentionTick, 6 * 60 * 60 * 1000);
    setTimeout(retentionTick, 90 * 1000); // 기동 직후 1회
  }

  // 법인카드 전자 전표 사전 생성 — 1시간마다 체크, 실제 생성은 KST 02~04시 일 1회(라우트가 판정).
  // 지출결의서·출장보고서 작성 때 전표를 만들지 않기 위한 사전 작업이다.
  if (!g.__cardSlipTimer) {
    const slipTick = () => callTick("/api/internal/card-slip-tick", "card-slip");
    g.__cardSlipTimer = setInterval(slipTick, 60 * 60 * 1000);
    setTimeout(slipTick, 120 * 1000); // 기동 직후 1회
  }

  // 코넨사인 메일 수신(P2) — 1분마다 SQS 폴링(큐 미생성 시 no-op). 처리 멱등.
  if (!g.__mailInboundTimer) {
    const mailTick = () => callTick("/api/internal/mail-inbound-tick", "mail-inbound");
    g.__mailInboundTimer = setInterval(mailTick, 60 * 1000);
    setTimeout(mailTick, 45 * 1000); // 기동 직후 1회
  }
}
